import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Job, JobStatus, TriggerSource } from './entities/job';
import {
  JobAlreadyCanceledException,
  JobAlreadyClaimedException,
  JobNotEditableException,
  JobNotFoundException,
} from './exceptions/job.exceptions';
import { JobsMutex } from './jobs.mutex';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: 'job-' + Math.random().toString(36).slice(2),
    title: 'test',
    description: null,
    status: JobStatus.PENDING,
    triggeredBy: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe('JobsService', () => {
  let service: JobsService;
  let repo: JobsRepository;
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-spec-'));
    tmpFile = path.join(tmpDir, 'jobs.test.json');

    const moduleRef = await Test.createTestingModule({
      providers: [
        JobsService,
        JobsRepository,
        JobsMutex,
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string, defaultValue?: T): T | undefined => {
              if (key === 'JOBS_DB_PATH') {
                return tmpFile as unknown as T;
              }
              return defaultValue;
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(JobsService);
    repo = moduleRef.get(JobsRepository);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('PENDING 상태로 생성하고 id · 시각을 서버가 결정한다', async () => {
      const created = await service.create({ title: 'new-job', description: 'detail' });
      expect(created.status).toBe(JobStatus.PENDING);
      expect(created.triggeredBy).toBeNull();
      expect(created.deletedAt).toBeNull();
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.title).toBe('new-job');
      expect(created.description).toBe('detail');
    });
  });

  describe('findAll', () => {
    it('soft-deleted 항목은 제외된다', async () => {
      await repo.create(makeJob({ id: 'a' }));
      await repo.create(makeJob({ id: 'b', deletedAt: new Date().toISOString() }));

      const result = await service.findAll({ limit: 20, offset: 0 });
      expect(result.items.map((job) => job.id)).toEqual(['a']);
      expect(result.total).toBe(1);
    });

    it('createdAt desc 로 정렬된다', async () => {
      await repo.create(makeJob({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }));
      await repo.create(makeJob({ id: 'new', createdAt: '2026-05-01T00:00:00.000Z' }));

      const result = await service.findAll({ limit: 20, offset: 0 });
      expect(result.items.map((job) => job.id)).toEqual(['new', 'old']);
    });

    it('limit · offset 페이지네이션이 적용된다', async () => {
      for (let index = 0; index < 5; index++) {
        await repo.create(
          makeJob({ id: `j-${index}`, createdAt: `2026-01-0${index + 1}T00:00:00.000Z` }),
        );
      }
      const result = await service.findAll({ limit: 2, offset: 1 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(5);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await repo.create(makeJob({ id: 'a', title: 'Backup DB', status: JobStatus.PENDING }));
      await repo.create(makeJob({ id: 'b', title: 'Send Email', status: JobStatus.DONE }));
      await repo.create(makeJob({ id: 'c', title: 'backup S3', status: JobStatus.FAILED }));
      await repo.create(
        makeJob({ id: 'd', title: 'Backup logs', deletedAt: new Date().toISOString() }),
      );
    });

    it('title 부분일치는 case-insensitive', async () => {
      const result = await service.search({ title: 'backup', limit: 20, offset: 0 });
      const ids = result.items.map((job) => job.id).sort();
      expect(ids).toEqual(['a', 'c']); // 'd' 는 soft-deleted 라 제외
    });

    it('status 다중 필터', async () => {
      const result = await service.search({
        status: [JobStatus.DONE, JobStatus.FAILED],
        limit: 20,
        offset: 0,
      });
      expect(result.items.map((job) => job.id).sort()).toEqual(['b', 'c']);
    });

    it('title + status 결합 — 두 조건을 모두 만족', async () => {
      const result = await service.search({
        title: 'backup',
        status: [JobStatus.PENDING],
        limit: 20,
        offset: 0,
      });
      expect(result.items.map((job) => job.id)).toEqual(['a']);
    });
  });

  describe('findOne', () => {
    it('존재하는 Job 반환', async () => {
      const job = makeJob({ id: 'x' });
      await repo.create(job);
      expect(await service.findOne('x')).toEqual(job);
    });

    it('미존재 시 JobNotFoundException', async () => {
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(JobNotFoundException);
    });

    it('soft-deleted 시 JobNotFoundException (404 일관성)', async () => {
      await repo.create(makeJob({ id: 'd', deletedAt: new Date().toISOString() }));
      await expect(service.findOne('d')).rejects.toBeInstanceOf(JobNotFoundException);
    });
  });

  describe('patch', () => {
    it('title · description 수정', async () => {
      await repo.create(makeJob({ id: 'p', title: 'old', description: null }));
      const result = await service.patch('p', { title: 'new', description: 'd2' });
      expect(result.title).toBe('new');
      expect(result.description).toBe('d2');
    });

    it('cancel: true 가 deletedAt 을 set 하고 status 는 PENDING 유지', async () => {
      await repo.create(makeJob({ id: 'c' }));
      const result = await service.patch('c', { cancel: true });
      expect(result.deletedAt).not.toBeNull();
      expect(result.status).toBe(JobStatus.PENDING);
    });

    it('빈 body 면 BadRequestException (VALIDATION_FAILED 매핑)', async () => {
      await repo.create(makeJob({ id: 'e' }));
      await expect(service.patch('e', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('PENDING 아닌 Job 은 JobNotEditableException', async () => {
      await repo.create(makeJob({ id: 'p', status: JobStatus.PROCESSING }));
      await expect(service.patch('p', { title: 'x' })).rejects.toBeInstanceOf(
        JobNotEditableException,
      );
    });

    it('이미 취소된 Job 은 JobAlreadyCanceledException', async () => {
      await repo.create(makeJob({ id: 'd', deletedAt: new Date().toISOString() }));
      await expect(service.patch('d', { title: 'x' })).rejects.toBeInstanceOf(
        JobAlreadyCanceledException,
      );
    });

    it('미존재 Job 은 JobNotFoundException', async () => {
      await expect(service.patch('missing', { title: 'x' })).rejects.toBeInstanceOf(
        JobNotFoundException,
      );
    });
  });

  describe('claimOne', () => {
    it('PENDING → PROCESSING 전환하고 triggeredBy set', async () => {
      await repo.create(makeJob({ id: 'p' }));
      const claimed = await service.claimOne('p', TriggerSource.MANUAL);
      expect(claimed.status).toBe(JobStatus.PROCESSING);
      expect(claimed.triggeredBy).toBe(TriggerSource.MANUAL);
    });

    it('이미 PROCESSING 인 Job 은 JobAlreadyClaimedException', async () => {
      await repo.create(makeJob({ id: 'p', status: JobStatus.PROCESSING }));
      await expect(service.claimOne('p', TriggerSource.SCHEDULER)).rejects.toBeInstanceOf(
        JobAlreadyClaimedException,
      );
    });

    it('취소된 Job 은 JobAlreadyCanceledException', async () => {
      await repo.create(makeJob({ id: 'd', deletedAt: new Date().toISOString() }));
      await expect(service.claimOne('d', TriggerSource.MANUAL)).rejects.toBeInstanceOf(
        JobAlreadyCanceledException,
      );
    });

    it('미존재 Job 은 JobNotFoundException', async () => {
      await expect(service.claimOne('missing', TriggerSource.MANUAL)).rejects.toBeInstanceOf(
        JobNotFoundException,
      );
    });
  });

  describe('claimPending', () => {
    it('FIFO 로 size 만큼 점유한다', async () => {
      await repo.create(makeJob({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }));
      await repo.create(makeJob({ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' }));
      await repo.create(makeJob({ id: 'c', createdAt: '2026-01-03T00:00:00.000Z' }));

      const claimed = await service.claimPending(2, TriggerSource.SCHEDULER);
      expect(claimed.map((job) => job.id)).toEqual(['a', 'b']);
      expect(claimed.every((job) => job.status === JobStatus.PROCESSING)).toBe(true);
      expect(claimed.every((job) => job.triggeredBy === TriggerSource.SCHEDULER)).toBe(true);
    });

    it('PENDING 이고 미취소 인 Job 만 후보', async () => {
      await repo.create(makeJob({ id: 'p1' }));
      await repo.create(makeJob({ id: 'pr', status: JobStatus.PROCESSING }));
      await repo.create(makeJob({ id: 'do', status: JobStatus.DONE }));
      await repo.create(makeJob({ id: 'fa', status: JobStatus.FAILED }));
      await repo.create(makeJob({ id: 'de', deletedAt: new Date().toISOString() }));

      const claimed = await service.claimPending(10, TriggerSource.SCHEDULER);
      expect(claimed.map((job) => job.id)).toEqual(['p1']);
    });
  });

  describe('mark*', () => {
    it('markDone 은 status 를 DONE 으로 전환', async () => {
      await repo.create(makeJob({ id: 'm', status: JobStatus.PROCESSING }));
      await service.markDone('m');
      const job = await repo.findOne('m');
      expect(job?.status).toBe(JobStatus.DONE);
    });

    it('mark* 는 미존재 시 JobNotFoundException', async () => {
      await expect(service.markDone('missing')).rejects.toBeInstanceOf(JobNotFoundException);
      await expect(service.markFailed('missing')).rejects.toBeInstanceOf(JobNotFoundException);
    });
  });
});
