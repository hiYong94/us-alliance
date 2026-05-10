import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Config as JsonDBConfig, JsonDB } from 'node-json-db';
import { Job } from './entities/job';

const DB_KEY = '/jobs';

/**
 * Job 데이터의 영속성(CRUD) 만 담당한다
 *
 * 동시성 제어는 보유하지 않는다 — Service 레이어의 JobsMutex 가 read-modify-write 를
 * 직렬화하므로 Repository 메소드는 자기 호출 안에서만 자족적이면 된다.
 *
 * node-json-db 의 saveOnPush=true 옵션으로 매 push 시 파일에 즉시 반영된다.
 * 파일 경로는 ConfigService 의 JOBS_DB_PATH 로 결정 (기본 'jobs.json').
 */
@Injectable()
export class JobsRepository {
  private readonly db: JsonDB;

  constructor(config: ConfigService) {
    const filePath = config.get<string>('JOBS_DB_PATH', 'jobs.json');
    // (filePath, saveOnPush, humanReadable, separator)
    this.db = new JsonDB(new JsonDBConfig(filePath, true, true, '/'));
  }

  /**
   * 모든 Job 을 반환한다 (soft-deleted 포함, 정렬 없음)
   *
   * 빈 DB 또는 첫 호출 시 빈 배열 반환
   */
  async findAll(): Promise<Job[]> {
    if (!(await this.db.exists(DB_KEY))) {
      return [];
    }
    return this.db.getObject<Job[]>(DB_KEY);
  }

  /**
   * id 로 단일 Job 을 조회한다 — 없으면 undefined
   *
   * soft-deleted 여부와 무관하게 반환 (필터링은 호출자 책임)
   */
  async findOne(id: string): Promise<Job | undefined> {
    const jobs = await this.findAll();
    return jobs.find((job) => job.id === id);
  }

  /**
   * 새 Job 을 추가한다 — 동일 id 중복 검사는 하지 않는다 (호출자 책임)
   */
  async create(job: Job): Promise<void> {
    const jobs = await this.findAll();
    await this.db.push(DB_KEY, [...jobs, job], true);
  }

  /**
   * id 와 일치하는 Job 을 교체한다 — 일치 항목이 없으면 변경 없이 반환
   *
   * 호출자가 mutex 안에서 read-modify-write 시퀀스를 구성한다는 전제
   */
  async update(id: string, job: Job): Promise<void> {
    const jobs = await this.findAll();
    const next = jobs.map((existingJob) => (existingJob.id === id ? job : existingJob));
    await this.db.push(DB_KEY, next, true);
  }
}
