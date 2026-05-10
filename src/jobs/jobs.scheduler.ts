import { Injectable } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { traceContext } from '../common/context/trace-context';
import { RandomService } from '../common/random.service';
import { LoggerService } from '../logging/logger.service';
import { Job, TriggerSource } from './entities/job';
import { JobsService } from './jobs.service';

const BATCH_SIZE = 5;
const FAILURE_RATE = 0.1;
const SLEEP_MIN_MS = 1000;
const SLEEP_MAX_MS = 3000;

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type ProcessResult = 'done' | 'failed';

/**
 * Job 처리 스케줄러
 *
 * - @Cron: 매분 0초에 tick 실행 — pending 작업을 BATCH_SIZE 까지 점유하여 병렬 처리
 * - @Timeout: 부팅 5초 후 첫 tick — 평가 시연성 확보
 * - 중복 실행 방지: running flag — 이전 tick 미종료 시 다음 tick 즉시 skip
 * - tick 단위 traceId 부여 — 같은 tick 의 모든 로그가 동일 traceId 로 묶임
 *
 * 처리 시뮬레이션:
 * - sleep 1~3초 (RandomService 로 결정성 통제 가능)
 * - 10% 확률로 simulated failure → markFailed
 * - 90% 확률로 markDone
 */
@Injectable()
export class JobsScheduler {
  private running = false;

  constructor(
    private readonly service: JobsService,
    private readonly logger: LoggerService,
    private readonly random: RandomService,
  ) {}

  /**
   * 부팅 5초 후 첫 tick — @Cron 의 1분 대기를 단축해 시연성을 높인다
   */
  @Timeout(5000)
  async firstRun(): Promise<void> {
    await this.tick();
  }

  /**
   * 매분 0초 tick — pending 작업을 BATCH_SIZE 만큼 점유 후 병렬 처리
   *
   * 이전 tick 이 1분 안에 끝나지 않은 경우 본 호출은 즉시 skip 된다 — 동일 인스턴스의
   * 동시 실행을 방지하여 lost update 와 중복 점유를 차단한다.
   */
  @Cron('0 * * * * *')
  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    const tickTraceId = `tick-${randomUUID()}`;

    try {
      await traceContext.run({ traceId: tickTraceId }, async () => {
        const jobs = await this.service.claimPending(BATCH_SIZE, TriggerSource.SCHEDULER);
        this.logger.append({
          type: 'scheduler',
          event: 'tick.start',
          claimed: jobs.length,
        });

        // Promise.allSettled — processOne 이 내부 try/catch 로 정상 resolve 하지만,
        // 외부 안전망으로 한 번 더 감싸 한 작업의 예외가 다른 처리를 막지 않게 한다.
        const results = await Promise.allSettled(jobs.map((job) => this.processOne(job)));
        const failed = results.filter(
          (result) =>
            result.status === 'rejected' ||
            (result.status === 'fulfilled' && result.value === 'failed'),
        ).length;

        this.logger.append({
          type: 'scheduler',
          event: 'tick.end',
          processed: jobs.length,
          failed,
        });
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * 단일 작업 처리 — sleep 시뮬레이션 후 결과 마킹
   *
   * 호출자가 이미 점유한 작업(PROCESSING 상태) 에 대해 호출하는 것이 전제.
   * 본 메소드는 절대 throw 하지 않는다 — 내부 try/catch 로 모든 예외를 흡수하고
   * 'failed' 를 반환한다 (Controller 의 fire-and-forget 호출에서 unhandled rejection 회피).
   *
   * @param job 점유된 작업
   * @returns 처리 결과 — 'done' (성공) 또는 'failed' (시뮬레이션 실패 또는 예외)
   */
  async processOne(job: Job): Promise<ProcessResult> {
    const start = Date.now();
    try {
      const sleepMs = SLEEP_MIN_MS + this.random.next() * (SLEEP_MAX_MS - SLEEP_MIN_MS);
      await sleep(sleepMs);

      const shouldFail = this.random.next() < FAILURE_RATE;
      const durationMs = Date.now() - start;

      if (shouldFail) {
        await this.service.markFailed(job.id);
        this.logger.append({
          type: 'scheduler',
          level: 'warn',
          event: 'job.failed',
          jobId: job.id,
          durationMs,
          triggeredBy: job.triggeredBy,
          reason: 'simulated failure',
        });
        return 'failed';
      }

      await this.service.markDone(job.id);
      this.logger.append({
        type: 'scheduler',
        event: 'job.done',
        jobId: job.id,
        durationMs,
        triggeredBy: job.triggeredBy,
      });
      return 'done';
    } catch (error) {
      // markDone/markFailed 가 throw 한 경우 — 현재 설계상 일어나지 않으나 방어적으로 흡수
      this.logger.append({
        type: 'scheduler',
        level: 'error',
        event: 'job.error',
        jobId: job.id,
        durationMs: Date.now() - start,
        triggeredBy: job.triggeredBy,
        reason: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  }
}
