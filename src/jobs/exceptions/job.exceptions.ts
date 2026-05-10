import { HttpException, HttpStatus } from '@nestjs/common';
import { JobStatus } from '../entities/job';

/**
 * 도메인 에러 코드 — 클라이언트가 분기 처리에 사용하는 SNAKE_CASE 상수
 *
 * 이 분류에 들어가지 않는 예외는 *예상치 못한 결함* 으로 취급하여 500 으로 떨어뜨린다
 * (catch-all 코드를 두지 않는다 — requirements.md §2.2 예외 처리 정책 참조)
 */
export const JOB_ERROR_CODE = {
  NOT_FOUND: 'JOB_NOT_FOUND',
  NOT_EDITABLE: 'JOB_NOT_EDITABLE',
  ALREADY_CANCELED: 'JOB_ALREADY_CANCELED',
  ALREADY_CLAIMED: 'JOB_ALREADY_CLAIMED',
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODE)[keyof typeof JOB_ERROR_CODE];

/**
 * 모든 도메인 예외의 추상 베이스
 *
 * AllExceptionsFilter 가 isDomainException type guard 로 판별 후
 * `code` 를 단일 경로로 추출하여 에러 응답에 포함한다
 */
export abstract class DomainException extends HttpException {
  abstract readonly code: string;
}

export class JobNotFoundException extends DomainException {
  readonly code = JOB_ERROR_CODE.NOT_FOUND;

  constructor(id: string) {
    super(`Job ${id} 를 찾을 수 없습니다`, HttpStatus.NOT_FOUND);
  }
}

export class JobNotEditableException extends DomainException {
  readonly code = JOB_ERROR_CODE.NOT_EDITABLE;

  constructor(currentStatus: JobStatus) {
    super(
      `PENDING 상태가 아닌 작업은 수정할 수 없습니다 (현재: ${currentStatus})`,
      HttpStatus.CONFLICT,
    );
  }
}

export class JobAlreadyCanceledException extends DomainException {
  readonly code = JOB_ERROR_CODE.ALREADY_CANCELED;

  constructor() {
    super('이미 취소된 작업입니다', HttpStatus.CONFLICT);
  }
}

export class JobAlreadyClaimedException extends DomainException {
  readonly code = JOB_ERROR_CODE.ALREADY_CLAIMED;

  constructor() {
    super('이미 클레임된 작업입니다', HttpStatus.CONFLICT);
  }
}

/**
 * 임의 throw 값이 도메인 예외인지 판별
 *
 * AllExceptionsFilter 가 코드 추출 시 사용한다
 */
export const isDomainException = (e: unknown): e is DomainException => e instanceof DomainException;
