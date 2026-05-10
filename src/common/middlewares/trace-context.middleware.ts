import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { traceContext } from '../context/trace-context';

const TRACE_HEADER = 'x-trace-id';

/**
 * inbound 요청에 traceId 를 부여하여 AsyncLocalStorage 에 보관한다
 *
 * - 클라이언트가 X-Trace-Id 헤더를 보내면 그대로 사용 (분산 환경 cross-service 그룹핑)
 * - 없으면 randomUUID 생성
 * - 응답에도 X-Trace-Id 헤더를 set 하여 클라이언트가 자신의 요청을 추적 가능
 *
 * 후속 (회고): W3C Trace Context (`traceparent`) 호환은 README 에 기재
 */
@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(TRACE_HEADER);
    const traceId = incoming ?? randomUUID();
    res.setHeader(TRACE_HEADER, traceId);
    traceContext.run({ traceId }, () => next());
  }
}
