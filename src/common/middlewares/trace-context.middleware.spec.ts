import { NextFunction, Request, Response } from 'express';
import { getTraceId } from '../context/trace-context';
import { TraceContextMiddleware } from './trace-context.middleware';

describe('TraceContextMiddleware', () => {
  let middleware: TraceContextMiddleware;
  let setHeader: jest.Mock;
  let res: Partial<Response>;

  beforeEach(() => {
    middleware = new TraceContextMiddleware();
    setHeader = jest.fn();
    res = { setHeader };
  });

  function makeReq(headerValue?: string): Partial<Request> {
    return { header: jest.fn().mockReturnValue(headerValue) };
  }

  it('X-Trace-Id 헤더가 있으면 그대로 사용한다', () => {
    const req = makeReq('client-trace-id');
    let captured: string | undefined;

    middleware.use(
      req as Request,
      res as Response,
      (() => {
        captured = getTraceId();
      }) as NextFunction,
    );

    expect(captured).toBe('client-trace-id');
    expect(setHeader).toHaveBeenCalledWith('x-trace-id', 'client-trace-id');
  });

  it('X-Trace-Id 헤더가 없으면 UUID v4 를 생성한다', () => {
    const req = makeReq(undefined);
    let captured: string | undefined;

    middleware.use(
      req as Request,
      res as Response,
      (() => {
        captured = getTraceId();
      }) as NextFunction,
    );

    expect(captured).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-trace-id', captured);
  });

  it('run 외부에서는 traceId 가 격리된다', () => {
    const req = makeReq('isolated-id');

    middleware.use(
      req as Request,
      res as Response,
      (() => {
        expect(getTraceId()).toBe('isolated-id');
      }) as NextFunction,
    );

    // 미들웨어 실행 후에는 컨텍스트가 풀려야 함
    expect(getTraceId()).toBeUndefined();
  });
});
