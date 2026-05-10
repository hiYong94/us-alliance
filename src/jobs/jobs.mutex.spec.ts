import { JobsMutex } from './jobs.mutex';

describe('JobsMutex', () => {
  it('runExclusive 콜백을 직렬 실행한다 (동시 두 호출이 서로 인터리브되지 않음)', async () => {
    const mutex = new JobsMutex();
    const log: string[] = [];

    await Promise.all([
      mutex.runExclusive(async () => {
        log.push('a-start');
        await new Promise((resolve) => setTimeout(resolve, 30));
        log.push('a-end');
      }),
      mutex.runExclusive(async () => {
        log.push('b-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        log.push('b-end');
      }),
    ]);

    // 직렬화되었으므로 a 가 끝난 후에야 b 가 시작
    expect(log).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runExclusive 의 반환값을 그대로 반환한다', async () => {
    const mutex = new JobsMutex();
    const result = await mutex.runExclusive(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('콜백 안에서 throw 한 예외는 그대로 전파되고 락이 해제된다', async () => {
    const mutex = new JobsMutex();

    await expect(mutex.runExclusive(() => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    // 다음 runExclusive 가 막히지 않아야 함 — 락이 풀렸다는 증거
    const result = await mutex.runExclusive(() => Promise.resolve('after-error'));
    expect(result).toBe('after-error');
  });
});
