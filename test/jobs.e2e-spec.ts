import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { JobsScheduler } from '../src/jobs/jobs.scheduler';

describe('Jobs API (e2e)', () => {
  let app: INestApplication;
  let server: App;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-e2e-'));
    process.env.JOBS_DB_PATH = path.join(tmpDir, 'jobs.json');
    process.env.LOG_DIR = path.join(tmpDir, 'logs');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // 스케줄러 cron · timeout을 막아 테스트 격리
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

  describe('정상 플로우', () => {
    // POST /jobs → 201 + data 응답 + X-Trace-Id 헤더
    it('Job 생성은 PENDING 으로 시작하며 응답에 data 래퍼와 X-Trace-Id 추적 헤더를 포함한다', async () => {
      const response = await request(server)
        .post('/jobs')
        .send({ title: 'e2e-test', description: 'happy path' })
        .expect(201);

      expect(response.body).toMatchObject({
        data: {
          title: 'e2e-test',
          description: 'happy path',
          status: 'PENDING',
          triggeredBy: null,
          deletedAt: null,
        },
      });
      expect(response.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['x-trace-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    // GET /jobs → { data, meta } 페이지네이션 응답
    it('목록 조회는 data 와 함께 total · limit · offset 페이지네이션 메타를 반환한다', async () => {
      await request(server).post('/jobs').send({ title: 'a' }).expect(201);
      await request(server).post('/jobs').send({ title: 'b' }).expect(201);

      const response = await request(server).get('/jobs').expect(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toEqual({ total: 2, limit: 20, offset: 0 });
    });

    // PATCH /jobs/:id → 200 부분 수정 반영
    it('PENDING 작업의 title · description 은 PATCH 로 수정되어 응답에 즉시 반영된다', async () => {
      const created = await request(server).post('/jobs').send({ title: 'old' });
      const id = created.body.data.id;

      const updated = await request(server)
        .patch(`/jobs/${id}`)
        .send({ title: 'new', description: 'detail' })
        .expect(200);

      expect(updated.body.data).toMatchObject({ title: 'new', description: 'detail' });
    });

    // GET /jobs/:id → 200 단건 응답
    it('존재하는 PENDING 작업의 단건 조회는 data 래퍼로 200 을 반환한다', async () => {
      const created = await request(server).post('/jobs').send({ title: 'fetch-me' });
      const id = created.body.data.id;

      const response = await request(server).get(`/jobs/${id}`).expect(200);
      expect(response.body.data).toMatchObject({
        id,
        title: 'fetch-me',
        status: 'PENDING',
      });
    });

    // PATCH cancel: true → deletedAt set, GET 시 404
    it('cancel:true PATCH 는 soft-delete 로 deletedAt 을 set 하고 후속 GET 에서 404 가 된다', async () => {
      const created = await request(server).post('/jobs').send({ title: 'to-cancel' });
      const id = created.body.data.id;

      const canceled = await request(server)
        .patch(`/jobs/${id}`)
        .send({ cancel: true })
        .expect(200);
      expect(canceled.body.data.deletedAt).not.toBeNull();
      expect(canceled.body.data.status).toBe('PENDING');

      // soft-deleted 는 GET 에서 404
      await request(server).get(`/jobs/${id}`).expect(404);
    });

    // POST /jobs/:id/run → 200, 즉시 PROCESSING + triggeredBy=MANUAL
    it('수동 실행 트리거는 즉시 PROCESSING 으로 점유하고 triggeredBy 를 MANUAL 로 기록한다', async () => {
      const created = await request(server).post('/jobs').send({ title: 'manual-run' });
      const id = created.body.data.id;

      const response = await request(server).post(`/jobs/${id}/run`).expect(200);
      expect(response.body.data).toMatchObject({
        status: 'PROCESSING',
        triggeredBy: 'MANUAL',
      });
    });
  });

  describe('검색 · 페이지네이션', () => {
    beforeEach(async () => {
      await request(server).post('/jobs').send({ title: 'Backup DB' });
      await request(server).post('/jobs').send({ title: 'Send Email' });
      await request(server).post('/jobs').send({ title: 'backup S3' });
    });

    // GET /jobs/search?title=backup → 부분일치 case-insensitive 2건
    it('title 검색은 대소문자 구분 없이 부분일치하는 모든 작업을 반환한다', async () => {
      const response = await request(server).get('/jobs/search?title=backup').expect(200);
      expect(response.body.meta.total).toBe(2);
      const titles = response.body.data.map((job: { title: string }) => job.title).sort();
      expect(titles).toEqual(['Backup DB', 'backup S3']);
    });

    // GET /jobs?limit=2&offset=1 → 페이지네이션 파라미터 적용
    it('limit · offset 으로 결과 페이지를 잘라내며 total 은 전체 모집단을 가리킨다', async () => {
      const response = await request(server).get('/jobs?limit=2&offset=1').expect(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toEqual({ total: 3, limit: 2, offset: 1 });
    });
  });

  describe('에러 응답', () => {
    // POST /jobs (title 누락) → 400 VALIDATION_FAILED
    it('필수 필드 title 누락 시 VALIDATION_FAILED 코드와 timestamp · path 를 포함해 거부한다', async () => {
      const response = await request(server).post('/jobs').send({}).expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        path: '/jobs',
      });
      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    // POST /jobs (알 수 없는 필드) → 400 VALIDATION_FAILED
    it('whitelist 외 필드 포함 시 VALIDATION_FAILED 로 거부하고 메시지에 필드명을 노출한다', async () => {
      const response = await request(server)
        .post('/jobs')
        .send({ title: 't', extra: 'bad' })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.message).toContain('extra');
    });

    // GET /jobs/:missing → 404 JOB_NOT_FOUND
    it('존재하지 않는 ID 단건 조회는 JOB_NOT_FOUND 도메인 코드와 함께 404 를 반환한다', async () => {
      const response = await request(server).get('/jobs/non-existent').expect(404);
      expect(response.body).toMatchObject({
        statusCode: 404,
        code: 'JOB_NOT_FOUND',
      });
    });

    // PATCH /jobs/:id (이미 취소됨) → 409 JOB_ALREADY_CANCELED
    it('취소된 작업의 재수정 시도는 JOB_ALREADY_CANCELED 로 거부한다', async () => {
      const created = await request(server).post('/jobs').send({ title: 'x' });
      const id = created.body.data.id;
      await request(server).patch(`/jobs/${id}`).send({ cancel: true }).expect(200);

      const response = await request(server)
        .patch(`/jobs/${id}`)
        .send({ title: 'after-cancel' })
        .expect(409);
      expect(response.body.code).toBe('JOB_ALREADY_CANCELED');
    });

    // PATCH /jobs/:id (PENDING 아님) → 409 JOB_NOT_EDITABLE
    it('PROCESSING 등 PENDING 이 아닌 작업의 PATCH 시도는 JOB_NOT_EDITABLE 로 거부한다', async () => {
      const created = await request(server).post('/jobs').send({ title: 'x' });
      const id = created.body.data.id;
      await request(server).post(`/jobs/${id}/run`).expect(200);

      const response = await request(server)
        .patch(`/jobs/${id}`)
        .send({ title: 'after-claim' })
        .expect(409);
      expect(response.body.code).toBe('JOB_NOT_EDITABLE');
    });

    // PATCH /jobs/:id (빈 body) → 400 VALIDATION_FAILED
    it('PATCH 본문이 비어 있으면 (≥1 필드 필수) VALIDATION_FAILED 로 거부한다', async () => {
      const created = await request(server).post('/jobs').send({ title: 'x' });
      const id = created.body.data.id;

      const response = await request(server).patch(`/jobs/${id}`).send({}).expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });
});
