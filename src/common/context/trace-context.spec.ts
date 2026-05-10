import { getTraceId, traceContext } from './trace-context';

describe('trace-context', () => {
  it('store 가 set 되지 않은 컨텍스트에서는 undefined 반환', () => {
    expect(getTraceId()).toBeUndefined();
  });

  it('traceContext.run 안에서는 store 의 traceId 반환', () => {
    let captured: string | undefined;

    traceContext.run({ traceId: 'test-trace-id' }, () => {
      captured = getTraceId();
    });

    expect(captured).toBe('test-trace-id');
  });

  it('run 종료 후에는 다시 undefined', () => {
    traceContext.run({ traceId: 'in-scope' }, () => {
      // 안에서는 값 존재
      expect(getTraceId()).toBe('in-scope');
    });

    expect(getTraceId()).toBeUndefined();
  });
});
