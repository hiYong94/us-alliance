import { RandomService } from '../common/random.service';
import { LoggerService } from '../logging/logger.service';
import { Job, JobStatus, TriggerSource } from './entities/job';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: 'job-' + Math.random().toString(36).slice(2),
    title: 'test',
    description: null,
    status: JobStatus.PROCESSING,
    triggeredBy: TriggerSource.SCHEDULER,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe('JobsScheduler', () => {
  let scheduler: JobsScheduler;
  let service: jest.Mocked<JobsService>;
  let logger: jest.Mocked<LoggerService>;
  let random: jest.Mocked<RandomService>;

  beforeEach(() => {
    jest.useFakeTimers();
    service = {
      claimPending: jest.fn(),
      markDone: jest.fn(),
      markFailed: jest.fn(),
    } as unknown as jest.Mocked<JobsService>;
    logger = { append: jest.fn() } as unknown as jest.Mocked<LoggerService>;
    random = { next: jest.fn() };
    scheduler = new JobsScheduler(service, logger, random);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('processOne', () => {
    it('random.next() < 0.1 일 때 markFailed 호출 + job.failed 로그', async () => {
      const job = makeJob({ id: 'p' });
      // sleep 시간 → 0, failure check → 0.05 (< 0.1, 실패)
      random.next.mockReturnValueOnce(0).mockReturnValueOnce(0.05);

      const promise = scheduler.processOne(job);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('failed');
      expect(service.markFailed).toHaveBeenCalledWith('p');
      expect(service.markDone).not.toHaveBeenCalled();
      expect(logger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scheduler',
          level: 'warn',
          event: 'job.failed',
          jobId: 'p',
          reason: 'simulated failure',
        }),
      );
    });

    it('random.next() >= 0.1 일 때 markDone 호출 + job.done 로그', async () => {
      const job = makeJob({ id: 'p' });
      random.next.mockReturnValueOnce(0).mockReturnValueOnce(0.5);

      const promise = scheduler.processOne(job);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('done');
      expect(service.markDone).toHaveBeenCalledWith('p');
      expect(service.markFailed).not.toHaveBeenCalled();
      expect(logger.append).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.done', jobId: 'p' }),
      );
    });

    it('내부 예외(markDone 실패) 를 흡수하여 throw 하지 않고 failed 반환', async () => {
      const job = makeJob({ id: 'p' });
      random.next.mockReturnValueOnce(0).mockReturnValueOnce(0.5);
      service.markDone.mockRejectedValueOnce(new Error('disk full'));

      const promise = scheduler.processOne(job);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('failed');
      expect(logger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scheduler',
          level: 'error',
          event: 'job.error',
          jobId: 'p',
          reason: 'disk full',
        }),
      );
    });
  });

  describe('tick', () => {
    it('claimPending(BATCH_SIZE=5, SCHEDULER) 호출 후 각 작업에 processOne', async () => {
      const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' })];
      service.claimPending.mockResolvedValue(jobs);
      // 두 job 모두 succeed: 각각 sleep + failureCheck 두 번씩 = 4 호출
      random.next.mockReturnValue(0.5);

      const promise = scheduler.tick();
      await jest.runAllTimersAsync();
      await promise;

      expect(service.claimPending).toHaveBeenCalledWith(5, TriggerSource.SCHEDULER);
      expect(service.markDone).toHaveBeenCalledWith('a');
      expect(service.markDone).toHaveBeenCalledWith('b');
    });

    it('tick.start, tick.end 로그 — failed 카운트 정확', async () => {
      const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' })];
      service.claimPending.mockResolvedValue(jobs);
      // Promise.allSettled 가 두 processOne 을 동시 시작 → sleep 단계 먼저(a, b),
      // 그 후 failure check 단계(a, b) 순으로 random.next() 가 소비된다.
      random.next
        .mockReturnValueOnce(0) // a sleep
        .mockReturnValueOnce(0) // b sleep
        .mockReturnValueOnce(0.5) // a 성공
        .mockReturnValueOnce(0.05); // b 실패

      const promise = scheduler.tick();
      await jest.runAllTimersAsync();
      await promise;

      expect(logger.append).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'tick.start', claimed: 2 }),
      );
      expect(logger.append).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'tick.end', processed: 2, failed: 1 }),
      );
    });

    it('이전 tick 미종료 시 두 번째 tick 즉시 skip', async () => {
      // Given — claimPending 이 resolve 되지 않도록 첫 tick 을 hang 시킴 (running=true 상태 유지)
      let resolveFirst!: (jobs: Job[]) => void;
      service.claimPending.mockReturnValueOnce(
        new Promise<Job[]>((resolve) => {
          resolveFirst = resolve;
        }),
      );
      const firstTick = scheduler.tick();

      // When — 두 번째 tick 호출
      await scheduler.tick();

      // Then — running flag 로 즉시 return → claimPending 은 첫 tick 의 1 회만 호출됨
      expect(service.claimPending).toHaveBeenCalledTimes(1);

      // Cleanup — 첫 tick 정리하여 다음 테스트가 영향받지 않게
      resolveFirst([]);
      await jest.runAllTimersAsync();
      await firstTick;
    });

    it('Promise.allSettled — 한 작업 시뮬레이션 실패가 다른 작업 처리를 막지 않음', async () => {
      // Given — 3 작업이 점유되어 있고, a 만 실패 분기로 진입하도록 random 시퀀스 고정
      //         (allSettled 가 동시 시작하므로 random 소비 순서: 세 sleep 먼저, 그 뒤 세 failure check)
      const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' }), makeJob({ id: 'c' })];
      service.claimPending.mockResolvedValue(jobs);
      random.next
        .mockReturnValueOnce(0) // a sleep
        .mockReturnValueOnce(0) // b sleep
        .mockReturnValueOnce(0) // c sleep
        .mockReturnValueOnce(0.05) // a 실패
        .mockReturnValueOnce(0.5) // b 성공
        .mockReturnValueOnce(0.5); // c 성공

      // When — tick 실행
      const promise = scheduler.tick();
      await jest.runAllTimersAsync();
      await promise;

      // Then — a 실패에도 b·c 처리가 격리되어 모두 mark 호출됨
      expect(service.markFailed).toHaveBeenCalledWith('a');
      expect(service.markDone).toHaveBeenCalledWith('b');
      expect(service.markDone).toHaveBeenCalledWith('c');
    });
  });
});
