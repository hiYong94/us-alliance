import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { getTraceId } from '../common/context/trace-context';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogPayload {
  /** 미지정 시 'info' 로 기록 */
  level?: LogLevel;
  /** 로그 분류 — 'http' / 'scheduler' 등 */
  type: string;
  /** 명시하지 않으면 AsyncLocalStorage 의 trace-context 에서 자동 주입 */
  traceId?: string;
  [key: string]: unknown;
}

/**
 * 일자 파티셔닝 JSON Lines 파일 로거
 *
 * - 매 호출 시점의 일자로 파일명을 결정 → 자정 경계 자동 처리
 * - fs.appendFileSync 는 단일 호출 단위가 atomic 이라 추가 락 없이 안전
 * - LOG_DIR 환경변수로 디렉토리 오버라이드 (테스트 격리)
 */
@Injectable()
export class LoggerService {
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = config.get<string>('LOG_DIR', 'logs');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * 로그 항목을 그 시점의 일자 파일에 1 줄 JSON 으로 append 한다
   *
   * 실패 시 fs 예외가 그대로 전파된다 (호출자가 잡지 않으면 프로세스에 노출)
   *
   * @param payload type 필수, level 미지정 시 'info', 그 외 자유 키
   */
  append(payload: LogPayload): void {
    const ts = new Date();
    const filename = `${ts.toISOString().slice(0, 10)}.log`;
    // traceId 자동 주입 — payload 가 명시하면 spread 가 덮어쓴다.
    // 분산 환경 그룹핑(requirements.md §5.4) 을 보장하기 위해 호출자 누락 시에도 traceId 가 들어가야 한다.
    const line =
      JSON.stringify({
        ts: ts.toISOString(),
        level: payload.level ?? 'info',
        traceId: getTraceId(),
        ...payload,
      }) + '\n';
    fs.appendFileSync(path.join(this.dir, filename), line);
  }
}
