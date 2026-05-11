import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { JobsScheduler } from '../src/jobs/jobs.scheduler';

describe('Concurrency (e2e)', () => {
  let app: INestApplication;
  let server: App;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrency-e2e-'));
    process.env.JOBS_DB_PATH = path.join(tmpDir, 'jobs.json');
    process.env.LOG_DIR = path.join(tmpDir, 'logs');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(JobsScheduler)
      .useValue({
        tick: jest.fn(),
        processOne: jest.fn().mockResolvedValue('done'),
        firstRun: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.JOBS_DB_PATH;
    delete process.env.LOG_DIR;
  });

  async function createJob(title: string): Promise<string> {
    const response = await request(server).post('/jobs').send({ title }).expect(201);
    return response.body.data.id as string;
  }

  // 동시 PATCH (다른 필드) — 두 변경 모두 보존 (lost update 없음)
  it('JobsMutex 가 동시 PATCH 두 건의 다른 필드 변경을 직렬 적용해 모두 보존한다', async () => {
    // Given — PENDING Job 한 건
    const id = await createJob('initial');

    // When — 두 PATCH 가 거의 동시에 도착 (한 쪽은 title, 다른 쪽은 description 갱신)
    const [first, second] = await Promise.all([
      request(server).patch(`/jobs/${id}`).send({ title: 'PATCHED-TITLE' }),
      request(server).patch(`/jobs/${id}`).send({ description: 'PATCHED-DESC' }),
    ]);

    // Then — 둘 다 200 + 최종 상태에 두 변경이 모두 누적되어 있음 (mutex 직렬화 효과)
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const final = await request(server).get(`/jobs/${id}`).expect(200);
    expect(final.body.data).toMatchObject({
      title: 'PATCHED-TITLE',
      description: 'PATCHED-DESC',
    });
  });

  // 동시 POST /jobs/:id/run — 한 쪽만 성공, 다른 쪽 409 JOB_ALREADY_CLAIMED
  it('동일 Job 의 동시 수동 실행 두 건 중 한 쪽만 점유에 성공하고 다른 쪽은 JOB_ALREADY_CLAIMED 를 받는다', async () => {
    const id = await createJob('to-run');

    // 같은 Job 에 대한 두 동시 수동 실행 — JobsMutex 로 직렬화 → 한 쪽만 PENDING 점유 성공
    const responses = await Promise.all([
      request(server).post(`/jobs/${id}/run`),
      request(server).post(`/jobs/${id}/run`),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);

    const conflicting = responses.find((response) => response.status === 409);
    expect(conflicting?.body.code).toBe('JOB_ALREADY_CLAIMED');

    // 최종 상태 — PROCESSING + MANUAL
    const final = await request(server).get(`/jobs/${id}`).expect(200);
    expect(final.body.data).toMatchObject({
      status: 'PROCESSING',
      triggeredBy: 'MANUAL',
    });
  });

  // PATCH cancel ↔ POST run 경합 — 한 쪽만 성공
  it('cancel 과 run 이 경합할 때 먼저 도달한 쪽만 성공하고 다른 쪽은 상태에 맞는 거부 코드를 받는다', async () => {
    // Given — PENDING Job 한 건
    const id = await createJob('cancel-vs-run');

    // When — 같은 PENDING Job 에 cancel 과 run 동시 요청
    const [cancelResponse, runResponse] = await Promise.all([
      request(server).patch(`/jobs/${id}`).send({ cancel: true }),
      request(server).post(`/jobs/${id}/run`),
    ]);

    // Then — 정확히 둘 중 하나만 200, 다른 쪽은 mutex 직렬화 결과의 상태에 따라 409
    //   (a) cancel 먼저 진입 → run 은 JOB_ALREADY_CANCELED
    //   (b) run 먼저 진입 → cancel 은 JOB_NOT_EDITABLE (PROCESSING 은 cancel 불가)
    const cancelOk = cancelResponse.status === 200;
    const runOk = runResponse.status === 200;
    expect(cancelOk !== runOk).toBe(true);

    if (cancelOk) {
      expect(runResponse.status).toBe(409);
      expect(runResponse.body.code).toBe('JOB_ALREADY_CANCELED');
    } else {
      expect(cancelResponse.status).toBe(409);
      expect(cancelResponse.body.code).toBe('JOB_NOT_EDITABLE');
    }
  });
});
