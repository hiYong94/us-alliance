import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { traceContext } from '../common/context/trace-context';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  let tmpDir: string;
  let logger: LoggerService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-spec-'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string, defaultValue?: T): T | undefined =>
              key === 'LOG_DIR' ? (tmpDir as unknown as T) : defaultValue,
          },
        },
      ],
    }).compile();
    logger = moduleRef.get(LoggerService);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.useRealTimers();
  });

  it('생성 시 LOG_DIR 가 없으면 자동 생성한다', () => {
    const nested = path.join(tmpDir, 'nested', 'logs');
    expect(fs.existsSync(nested)).toBe(false);

    const config = { get: () => nested } as unknown as ConfigService;
    new LoggerService(config);

    expect(fs.existsSync(nested)).toBe(true);
  });

  it('append() 호출 시 오늘 일자 파일에 JSON 1 줄을 기록한다', () => {
    logger.append({ type: 'http', method: 'GET', path: '/x' });

    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpDir, `${today}.log`);
    expect(fs.existsSync(file)).toBe(true);

    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toMatchObject({ type: 'http', method: 'GET', path: '/x', level: 'info' });
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('level 미지정 시 info 로 기록된다', () => {
    logger.append({ type: 'scheduler', event: 'tick.start' });
    const today = new Date().toISOString().slice(0, 10);
    const line = fs.readFileSync(path.join(tmpDir, `${today}.log`), 'utf8').trim();
    expect((JSON.parse(line) as { level: string }).level).toBe('info');
  });

  it('level 지정 시 해당 level 로 기록된다', () => {
    logger.append({ type: 'http', level: 'warn', code: 'JOB_NOT_FOUND' });
    const today = new Date().toISOString().slice(0, 10);
    const line = fs.readFileSync(path.join(tmpDir, `${today}.log`), 'utf8').trim();
    expect((JSON.parse(line) as { level: string }).level).toBe('warn');
  });

  it('자정 경계: 호출 시점의 일자로 파일명이 결정된다', () => {
    jest.useFakeTimers();

    jest.setSystemTime(new Date('2026-05-10T23:59:50.000Z'));
    logger.append({ type: 'a', event: 'before' });

    jest.setSystemTime(new Date('2026-05-11T00:00:10.000Z'));
    logger.append({ type: 'b', event: 'after' });

    expect(fs.readFileSync(path.join(tmpDir, '2026-05-10.log'), 'utf8')).toContain('before');
    expect(fs.readFileSync(path.join(tmpDir, '2026-05-11.log'), 'utf8')).toContain('after');
  });

  it('payload 에 traceId 없으면 AsyncLocalStorage 의 traceId 가 자동 주입된다', () => {
    // Given — trace-context 안에서 traceId 가 set 되어 있음 (예: 스케줄러 tick · HTTP 요청 컨텍스트)
    // When — payload 에 traceId 를 명시하지 않고 append 호출
    traceContext.run({ traceId: 'auto-injected-id' }, () => {
      logger.append({ type: 'scheduler', event: 'tick.start' });
    });

    // Then — 기록된 로그에 ALS 의 traceId 가 자동 포함됨
    const today = new Date().toISOString().slice(0, 10);
    const line = fs.readFileSync(path.join(tmpDir, `${today}.log`), 'utf8').trim();
    expect((JSON.parse(line) as { traceId: string }).traceId).toBe('auto-injected-id');
  });

  it('payload 에 traceId 명시 시 ALS 가 있어도 payload 값을 우선한다', () => {
    traceContext.run({ traceId: 'als-id' }, () => {
      logger.append({ type: 'http', traceId: 'explicit-id' });
    });

    const today = new Date().toISOString().slice(0, 10);
    const line = fs.readFileSync(path.join(tmpDir, `${today}.log`), 'utf8').trim();
    expect((JSON.parse(line) as { traceId: string }).traceId).toBe('explicit-id');
  });

  it('ALS · payload 둘 다 없으면 traceId 필드가 출력에 포함되지 않는다', () => {
    logger.append({ type: 'http' });

    const today = new Date().toISOString().slice(0, 10);
    const line = fs.readFileSync(path.join(tmpDir, `${today}.log`), 'utf8').trim();
    expect((JSON.parse(line) as { traceId?: string }).traceId).toBeUndefined();
  });

  it('여러 append 가 같은 파일에 누적된다', () => {
    logger.append({ type: 'a' });
    logger.append({ type: 'b' });
    logger.append({ type: 'c' });

    const today = new Date().toISOString().slice(0, 10);
    const lines = fs
      .readFileSync(path.join(tmpDir, `${today}.log`), 'utf8')
      .split('\n')
      .filter(Boolean);

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => (JSON.parse(line) as { type: string }).type)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
