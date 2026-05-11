import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { isDomainException } from '../../jobs/exceptions/job.exceptions';
import { LoggerService } from '../../logging/logger.service';
import { ErrorResponse } from '../dto/error-response.dto';

/**
 * 전역 예외 필터 — 모든 throw 값을 통일된 ErrorResponse 로 변환하고 로깅한다
 *
 * 매핑 규칙:
 * - DomainException → exception.code 그대로 + 본인 status
 * - 기타 HttpException → status 기반 fallback 코드 (VALIDATION_FAILED · HTTP_ERROR)
 * - 그 외 (예상치 못한 예외) → 500 INTERNAL_SERVER_ERROR
 *
 * 로깅:
 * - level 은 status 에 따라 (5xx: error / 4xx: warn)
 * - 본문 미로깅 (PII 회피)
 * - traceId 는 LoggerService 가 trace-context AsyncLocalStorage 에서 자동 주입
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status = this.resolveStatus(exception);
    const code = this.resolveCode(exception, status);
    const message = this.resolveMessage(exception);
    const details = this.resolveDetails(exception);

    const body: ErrorResponse = {
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    if (details) {
      body.details = details;
    }

    this.logger.append({
      type: 'http',
      level: status >= 500 ? 'error' : 'warn',
      method: request.method,
      path: request.url,
      status,
      code,
    });

    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveCode(exception: unknown, status: number): string {
    if (isDomainException(exception)) {
      return exception.code;
    }
    // HttpStatus 는 enum 인데 status 는 number 라 직접 비교 시 no-unsafe-enum-comparison 발생.
    // 의미 손실을 피하기 위해 Number() 로 enum 값을 number 로 평탄화한다.
    if (status === Number(HttpStatus.BAD_REQUEST)) {
      return 'VALIDATION_FAILED';
    }
    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      return 'INTERNAL_SERVER_ERROR';
    }
    return 'HTTP_ERROR';
  }

  private resolveMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return res;
      }
      const msg = (res as { message?: string | string[] }).message;
      if (Array.isArray(msg)) {
        return msg.join(', ');
      }
      if (typeof msg === 'string') {
        return msg;
      }
      return exception.message;
    }
    return '서버 내부 오류';
  }

  private resolveDetails(exception: unknown): Record<string, unknown> | undefined {
    if (typeof exception !== 'object' || exception === null) {
      return undefined;
    }
    if (!('details' in exception)) {
      return undefined;
    }
    const details = (exception as { details?: unknown }).details;
    if (typeof details !== 'object' || details === null) {
      return undefined;
    }
    return details as Record<string, unknown>;
  }
}
