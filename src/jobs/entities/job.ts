/**
 * Job 의 처리 상태
 *
 * 단방향 전이: PENDING → PROCESSING → DONE | FAILED
 * 별도 CANCELED 상태는 두지 않으며, 취소는 deletedAt set 으로 표현한다
 */
export enum JobStatus {
  /** 처리 대기 — 스케줄러 또는 수동 실행이 클레임할 후보 */
  PENDING = 'PENDING',
  /** 처리 중 — 클레임된 상태, 결과(DONE/FAILED) 가 정해지기 전 */
  PROCESSING = 'PROCESSING',
  /** 처리 완료 — 종료 상태 */
  DONE = 'DONE',
  /** 처리 실패 — 종료 상태, 본 과제는 재시도 미적용 */
  FAILED = 'FAILED',
}

/**
 * 클레임 트리거 출처 — 어느 경로로 PROCESSING 에 진입했는지 추적
 */
export enum TriggerSource {
  /** 자동 — @Cron tick 에 의한 클레임 */
  SCHEDULER = 'SCHEDULER',
  /** 수동 — POST /jobs/:id/run 에 의한 클레임 */
  MANUAL = 'MANUAL',
}

/**
 * 도메인 내부 모델
 *
 * 외부 응답 DTO (JobResponse) 와 분리되어 있으며,
 * 내부 변경이 외부 인터페이스로 자동 누출되지 않도록 격리한다
 */
export interface Job {
  /** 서버 생성 UUID v4 */
  id: string;
  /** 1~120자, 사용자 입력 */
  title: string;
  /** 0~2000자, 사용자 입력. 미입력 시 null */
  description: string | null;
  /** 처리 상태 — 초기값 PENDING */
  status: JobStatus;
  /** 처리 시작 시점에 set. PENDING 상태에서는 null */
  triggeredBy: TriggerSource | null;
  /** 생성 시각 (ISO 8601) */
  createdAt: string;
  /** 최종 변경 시각 (ISO 8601) */
  updatedAt: string;
  /** 취소(soft delete) 시각 (ISO 8601). 미취소 시 null */
  deletedAt: string | null;
}
