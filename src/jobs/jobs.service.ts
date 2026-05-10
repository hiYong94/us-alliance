import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsQuery } from './dto/list-jobs.query';
import { PatchJobDto } from './dto/patch-job.dto';
import { SearchJobsQuery } from './dto/search-jobs.query';
import { Job, JobStatus, TriggerSource } from './entities/job';
import {
  JobAlreadyCanceledException,
  JobAlreadyClaimedException,
  JobNotEditableException,
  JobNotFoundException,
} from './exceptions/job.exceptions';
import { JobsMutex } from './jobs.mutex';
import { JobsRepository } from './jobs.repository';

interface PaginatedResult {
  items: Job[];
  total: number;
}

/**
 * Job 도메인 로직
 *
 * 모든 read-modify-write 는 JobsMutex.runExclusive 안에서 수행되어 lost update 가
 * 방지된다. 검색·조회 같은 read-only 경로는 락을 잡지 않는다.
 *
 * 외부 응답 변환(JobResponse) 은 Controller 책임 — Service 는 Job 도메인 모델만 다룬다.
 */
@Injectable()
export class JobsService {
  constructor(
    private readonly repo: JobsRepository,
    private readonly mutex: JobsMutex,
  ) {}

  /**
   * 새 Job 을 PENDING 상태로 생성한다 — id · createdAt · updatedAt 는 서버가 결정
   */
  async create(dto: CreateJobDto): Promise<Job> {
    return this.mutex.runExclusive(async () => {
      const now = new Date().toISOString();
      const job: Job = {
        id: randomUUID(),
        title: dto.title,
        description: dto.description ?? null,
        status: JobStatus.PENDING,
        triggeredBy: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await this.repo.create(job);
      return job;
    });
  }

  /**
   * 페이지네이션된 Job 목록 — soft-deleted 제외, createdAt desc 고정 정렬
   */
  async findAll(query: ListJobsQuery): Promise<PaginatedResult> {
    const jobs = await this.repo.findAll();
    const visible = jobs.filter((job) => job.deletedAt === null);
    visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const items = visible.slice(query.offset, query.offset + query.limit);
    return { items, total: visible.length };
  }

  /**
   * 검색 — title 부분일치(ci), status 다중, soft-deleted 제외, createdAt desc
   */
  async search(query: SearchJobsQuery): Promise<PaginatedResult> {
    const jobs = await this.repo.findAll();
    const filtered = jobs.filter((job) => this.matchesSearchQuery(job, query));
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const items = filtered.slice(query.offset, query.offset + query.limit);
    return { items, total: filtered.length };
  }

  /**
   * 단건 조회 — soft-deleted 도 404
   *
   * @throws JobNotFoundException 미존재 또는 soft-deleted
   */
  async findOne(id: string): Promise<Job> {
    const job = await this.repo.findOne(id);
    if (!job || job.deletedAt !== null) {
      throw new JobNotFoundException(id);
    }
    return job;
  }

  /**
   * Job 수정 또는 취소 — PENDING + 미취소일 때만 허용
   *
   * @throws BadRequestException 본문에 변경할 필드가 없음
   * @throws JobNotFoundException 미존재
   * @throws JobAlreadyCanceledException 이미 취소됨
   * @throws JobNotEditableException PENDING 아님
   */
  async patch(id: string, dto: PatchJobDto): Promise<Job> {
    if (dto.title === undefined && dto.description === undefined && dto.cancel === undefined) {
      throw new BadRequestException('PATCH 본문에 변경할 필드가 하나 이상 필요합니다');
    }
    return this.mutex.runExclusive(async () => {
      const current = await this.repo.findOne(id);
      if (!current) {
        throw new JobNotFoundException(id);
      }
      if (current.deletedAt !== null) {
        throw new JobAlreadyCanceledException();
      }
      if (current.status !== JobStatus.PENDING) {
        throw new JobNotEditableException(current.status);
      }

      const now = new Date().toISOString();
      const next: Job = {
        ...current,
        title: dto.title ?? current.title,
        description: dto.description ?? current.description,
        deletedAt: dto.cancel ? now : current.deletedAt,
        updatedAt: now,
      };
      await this.repo.update(id, next);
      return next;
    });
  }

  /**
   * 단일 Job 을 즉시 점유한다 (수동 실행 또는 분기 진입점)
   *
   * 처리(processOne) 자체는 호출자 책임 — 본 메소드는 PENDING → PROCESSING 전환만 수행
   *
   * @throws JobNotFoundException 미존재
   * @throws JobAlreadyCanceledException 이미 취소됨
   * @throws JobAlreadyClaimedException 이미 PROCESSING 또는 종료 상태
   */
  async claimOne(id: string, triggeredBy: TriggerSource): Promise<Job> {
    return this.mutex.runExclusive(async () => {
      const current = await this.repo.findOne(id);
      if (!current) {
        throw new JobNotFoundException(id);
      }
      if (current.deletedAt !== null) {
        throw new JobAlreadyCanceledException();
      }
      if (current.status !== JobStatus.PENDING) {
        throw new JobAlreadyClaimedException();
      }

      const next: Job = {
        ...current,
        status: JobStatus.PROCESSING,
        triggeredBy,
        updatedAt: new Date().toISOString(),
      };
      await this.repo.update(id, next);
      return next;
    });
  }

  /**
   * pending + 미취소 작업을 size 까지 점유한다 — FIFO (createdAt asc)
   *
   * 스케줄러 tick 진입점. 한 mutex critical section 안에서 모든 후보를 전환한다.
   */
  async claimPending(size: number, triggeredBy: TriggerSource): Promise<Job[]> {
    return this.mutex.runExclusive(async () => {
      const jobs = await this.repo.findAll();
      const claimable = jobs
        .filter((job) => job.status === JobStatus.PENDING && job.deletedAt === null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, size);

      const now = new Date().toISOString();
      const claimed: Job[] = [];
      for (const job of claimable) {
        const next: Job = {
          ...job,
          status: JobStatus.PROCESSING,
          triggeredBy,
          updatedAt: now,
        };
        await this.repo.update(job.id, next);
        claimed.push(next);
      }
      return claimed;
    });
  }

  /**
   * 처리 완료 마킹 — PROCESSING → DONE
   *
   * 호출자(스케줄러) 가 점유한 작업에 대해서만 호출하므로 status 검증은 생략한다
   *
   * @throws JobNotFoundException 미존재
   */
  async markDone(id: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const current = await this.repo.findOne(id);
      if (!current) {
        throw new JobNotFoundException(id);
      }
      const next: Job = {
        ...current,
        status: JobStatus.DONE,
        updatedAt: new Date().toISOString(),
      };
      await this.repo.update(id, next);
    });
  }

  /**
   * 처리 실패 마킹 — PROCESSING → FAILED
   *
   * 실패 사유는 호출자(스케줄러) 가 로깅한다 — 본 모델에는 보관 필드가 없다
   *
   * @throws JobNotFoundException 미존재
   */
  async markFailed(id: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const current = await this.repo.findOne(id);
      if (!current) {
        throw new JobNotFoundException(id);
      }
      const next: Job = {
        ...current,
        status: JobStatus.FAILED,
        updatedAt: new Date().toISOString(),
      };
      await this.repo.update(id, next);
    });
  }

  private matchesSearchQuery(job: Job, query: SearchJobsQuery): boolean {
    if (job.deletedAt !== null) {
      return false;
    }
    if (query.title !== undefined) {
      const normalizedTitle = job.title.toLowerCase();
      const normalizedQuery = query.title.toLowerCase();
      if (!normalizedTitle.includes(normalizedQuery)) {
        return false;
      }
    }
    if (query.status !== undefined && query.status.length > 0) {
      if (!query.status.includes(job.status)) {
        return false;
      }
    }
    return true;
  }
}
