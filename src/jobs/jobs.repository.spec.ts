import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Job, JobStatus } from './entities/job';
import { JobsMutex } from './jobs.mutex';
import { JobsRepository } from './jobs.repository';

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

describe('JobsRepository', () => {
  let repo: JobsRepository;
  let tmpFile: string;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-spec-'));
    tmpFile = path.join(tmpDir, 'jobs.test.json');

    const moduleRef = await Test.createTestingModule({
      providers: [
        JobsRepository,
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

    repo = moduleRef.get(JobsRepository);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('findAll: DB 가 비어 있으면 빈 배열 반환', async () => {
    expect(await repo.findAll()).toEqual([]);
  });

  it('create + findAll: 생성한 Job 이 조회된다', async () => {
    const job = makeJob({ id: 'a' });
    await repo.create(job);
    expect(await repo.findAll()).toEqual([job]);
  });

  it('create 여러 건은 추가 순서를 보존한다', async () => {
    const a = makeJob({ id: 'a' });
    const b = makeJob({ id: 'b' });
    await repo.create(a);
    await repo.create(b);

    const jobs = await repo.findAll();
    expect(jobs.map((job) => job.id)).toEqual(['a', 'b']);
  });

  it('findOne: 존재하는 id 면 Job 반환', async () => {
    const job = makeJob({ id: 'x' });
    await repo.create(job);
    expect(await repo.findOne('x')).toEqual(job);
  });

  it('findOne: 존재하지 않는 id 는 undefined', async () => {
    expect(await repo.findOne('missing')).toBeUndefined();
  });

  it('update 는 같은 id 의 항목만 교체하고 다른 항목은 유지한다', async () => {
    const a = makeJob({ id: 'a', title: 'before' });
    const b = makeJob({ id: 'b', title: 'other' });
    await repo.create(a);
    await repo.create(b);

    await repo.update('a', { ...a, title: 'after' });

    const jobs = await repo.findAll();
    const aFound = jobs.find((job) => job.id === 'a');
    const bFound = jobs.find((job) => job.id === 'b');
    expect(aFound?.title).toBe('after');
    expect(bFound?.title).toBe('other');
  });

  it('update 는 변경을 파일에 영속화한다', async () => {
    await repo.create(makeJob({ id: 'p', title: 'original' }));
    await repo.update('p', { ...makeJob({ id: 'p' }), title: 'persisted' });

    const raw = fs.readFileSync(tmpFile, 'utf8');
    expect(raw).toContain('persisted');
    expect(raw).not.toContain('original');
  });
});

describe('JobsMutex + JobsRepository 통합 — lost update 방지', () => {
  let repo: JobsRepository;
  let mutex: JobsMutex;
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-spec-'));
    tmpFile = path.join(tmpDir, 'jobs.test.json');

    const moduleRef = await Test.createTestingModule({
      providers: [
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

    repo = moduleRef.get(JobsRepository);
    mutex = moduleRef.get(JobsMutex);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mutex 안에서 직렬화된 RMW 두 건은 둘 다 반영된다 (lost update 없음)', async () => {
    await repo.create(makeJob({ id: 'race', title: 'initial', description: null }));

    // 두 동시 RMW: a 는 title 갱신, b 는 description 갱신
    await Promise.all([
      mutex.runExclusive(async () => {
        const current = await repo.findOne('race');
        await new Promise((resolve) => setTimeout(resolve, 20));
        await repo.update('race', { ...current!, title: 'updated-by-a' });
      }),
      mutex.runExclusive(async () => {
        const current = await repo.findOne('race');
        await new Promise((resolve) => setTimeout(resolve, 5));
        await repo.update('race', { ...current!, description: 'updated-by-b' });
      }),
    ]);

    // 직렬화되었으므로 두 변경이 모두 보존됨 (a 먼저 → b 가 a 결과 위에서 실행)
    const final = await repo.findOne('race');
    expect(final?.title).toBe('updated-by-a');
    expect(final?.description).toBe('updated-by-b');
  });
});
