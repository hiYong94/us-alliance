import { createParamDecorator } from '@nestjs/common';
import { getTraceId } from '../context/trace-context';

/**
 * Controller / handler 에서 현재 요청의 traceId 를 주입받는 파라미터 데코레이터
 *
 * TraceContextMiddleware 가 동작한 라우트에서만 값이 존재하며, 그 외에는 undefined
 *
 * @example
 *   @Get()
 *   handle(@TraceId() traceId: string | undefined) { ... }
 */
export const TraceId = createParamDecorator((): string | undefined => getTraceId());
