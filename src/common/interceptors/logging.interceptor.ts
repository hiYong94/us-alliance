import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { LoggerService } from '../../logging/logger.service';
import { getTraceId } from '../context/trace-context';

/**
 * 성공 HTTP 요청 · 응답 로깅 인터셉터
 *
 * - 응답 직전(`tap.next`) 에 method · path · status · durationMs · traceId 를
 *   LoggerService 로 append
 * - 에러 케이스는 AllExceptionsFilter (#12) 의 책임이므로 본 인터셉터에서 다루지 않음
 *   (rxjs tap 의 error 분기 미사용 → 예외는 그대로 통과)
 * - 본문(body) 은 로깅하지 않는다 — PII 회피 (requirements §5.3)
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const res = http.getResponse<Response>();
        this.logger.append({
          type: 'http',
          method: req.method,
          path: req.url,
          status: res.statusCode,
          durationMs: Date.now() - start,
          traceId: getTraceId(),
        });
      }),
    );
  }
}
