import { AsyncLocalStorage } from 'async_hooks';

interface TraceStore {
  traceId: string;
}

/**
 * 요청 단위 trace 컨텍스트 저장소
 *
 * TraceContextMiddleware 가 inbound 요청 처리 직전에 traceId 를 store 로 등록하고,
 * 동일 비동기 컨텍스트(컨트롤러 · 서비스 · 인터셉터 · 필터) 어디서든 getTraceId() 로 조회 가능
 */
export const traceContext = new AsyncLocalStorage<TraceStore>();

/**
 * 현재 요청의 traceId 를 반환한다
 *
 * 요청 외부(예: 부팅 시 코드, 스케줄러 tick 진입 직전) 에서는 undefined
 *
 * @returns traceId 또는 undefined
 */
export const getTraceId = (): string | undefined => traceContext.getStore()?.traceId;
