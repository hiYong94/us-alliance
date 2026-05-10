import { ApiProperty } from '@nestjs/swagger';

/**
 * 에러 응답 — AllExceptionsFilter 가 모든 예외를 이 형태로 변환한다
 */
export class ErrorResponse {
  @ApiProperty({
    description: 'HTTP 상태 코드',
    example: 409,
    type: Number,
    required: true,
  })
  statusCode!: number;

  @ApiProperty({
    description: '도메인 에러 코드 (SNAKE_CASE) — 클라이언트가 분기 처리에 사용',
    example: 'JOB_NOT_EDITABLE',
    type: String,
    required: true,
  })
  code!: string;

  @ApiProperty({
    description: '사용자/개발자 친화 한글 메시지',
    example: 'PENDING 상태가 아닌 작업은 수정할 수 없습니다 (현재: PROCESSING)',
    type: String,
    required: true,
  })
  message!: string;

  @ApiProperty({
    description: '디버깅용 부가 정보 — 케이스별 가변 (예: 현재 상태, 시도한 전이)',
    example: { currentStatus: 'PROCESSING' },
    type: Object,
    required: false,
    nullable: true,
  })
  details?: Record<string, unknown>;

  @ApiProperty({
    description: '에러 발생 시각 (ISO 8601)',
    example: '2026-05-10T12:35:00.123Z',
    type: String,
    format: 'date-time',
    required: true,
  })
  timestamp!: string;

  @ApiProperty({
    description: '요청 경로',
    example: '/jobs/5f3e7c8a-1b2d-4e5f-6789-0123456789ab',
    type: String,
    required: true,
  })
  path!: string;
}
