import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Request, Response } from 'express';
import { lastValueFrom, of, throwError } from 'rxjs';
import { LoggerService } from '../../logging/logger.service';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  let logger: jest.Mocked<LoggerService>;
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    logger = { append: jest.fn() } as unknown as jest.Mocked<LoggerService>;
    interceptor = new LoggingInterceptor(logger);
  });

  function makeContext(method: string, url: string, statusCode: number): ExecutionContext {
    const req = { method, url } as Partial<Request>;
    const res = { statusCode } as Partial<Response>;
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
  }

  it('성공 응답 시 type=http 메타데이터를 append 한다', async () => {
    const ctx = makeContext('POST', '/jobs', 201);
    const next: CallHandler = { handle: () => of({ data: { id: 'abc' } }) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    expect(logger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'http',
        method: 'POST',
        path: '/jobs',
        status: 201,
      }),
    );
  });

  it('durationMs 가 0 이상으로 기록된다', async () => {
    const ctx = makeContext('GET', '/jobs', 200);
    const next: CallHandler = { handle: () => of([]) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    const payload = logger.append.mock.calls[0][0];
    expect(payload.durationMs).toEqual(expect.any(Number));
    expect(payload.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('error 발생 시 logger.append 를 호출하지 않는다 (Filter 책임)', async () => {
    const ctx = makeContext('GET', '/jobs/x', 404);
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(lastValueFrom(interceptor.intercept(ctx, next))).rejects.toThrow('boom');

    expect(logger.append).not.toHaveBeenCalled();
  });
});
