import { ApiProperty } from '@nestjs/swagger';
import { Job, JobStatus, TriggerSource } from '../entities/job';

/**
 * 외부 응답 DTO — Job 엔티티의 외부 노출 형태
 *
 * 내부 모델(Job 인터페이스) 과 분리되어 있어 내부 변경(필드 추가 등) 이
 * 외부 스펙으로 자동 누출되지 않는다. `from(job)` 으로 변환한다.
 */
export class JobResponse {
  @ApiProperty({
    description: '작업 식별자 — 서버 생성 UUID v4',
    example: '5f3e7c8a-1b2d-4e5f-6789-0123456789ab',
    type: String,
    format: 'uuid',
    required: true,
  })
  id!: string;

  @ApiProperty({
    description: '작업 제목',
    example: '데이터 백업 작업',
    type: String,
    required: true,
    minLength: 1,
    maxLength: 120,
  })
  title!: string;

  @ApiProperty({
    description: '작업 설명 — 생성 시 미입력하면 null',
    example: '매일 자정 DB 스냅샷을 S3 로 업로드',
    type: String,
    required: true,
    nullable: true,
    maxLength: 2000,
  })
  description!: string | null;

  @ApiProperty({
    description:
      '작업 상태 — 생성 시 PENDING. 스케줄러/수동 클레임 시 PROCESSING. 종료는 DONE 또는 FAILED',
    example: JobStatus.PENDING,
    enum: JobStatus,
    enumName: 'JobStatus',
    required: true,
  })
  status!: JobStatus;

  @ApiProperty({
    description: '클레임 트리거 출처 — 처리 시작 시 SCHEDULER 또는 MANUAL. PENDING 동안은 null',
    example: null,
    enum: TriggerSource,
    enumName: 'TriggerSource',
    required: true,
    nullable: true,
  })
  triggeredBy!: TriggerSource | null;

  @ApiProperty({
    description: '생성 시각 (ISO 8601)',
    example: '2026-05-10T12:34:56.789Z',
    type: String,
    format: 'date-time',
    required: true,
  })
  createdAt!: string;

  @ApiProperty({
    description: '최종 변경 시각 (ISO 8601)',
    example: '2026-05-10T12:35:00.123Z',
    type: String,
    format: 'date-time',
    required: true,
  })
  updatedAt!: string;

  @ApiProperty({
    description: '취소(soft delete) 시각 (ISO 8601). 미취소 시 null',
    example: null,
    type: String,
    format: 'date-time',
    required: true,
    nullable: true,
  })
  deletedAt!: string | null;

  /**
   * 내부 Job 모델을 외부 응답 형태로 변환한다
   *
   * @param job 내부 도메인 모델
   * @returns 외부 노출 DTO 인스턴스
   */
  static from(job: Job): JobResponse {
    return Object.assign(new JobResponse(), job);
  }
}
