import { ApiProperty } from '@nestjs/swagger';

/**
 * 모든 성공 응답의 공통 베이스 — `data` 필드를 강제한다
 *
 * Swagger 제네릭 호환을 위해 구체 wrapper(SingleResponse, PaginatedResponse) 를
 * 상속해 사용한다. 추상이므로 직접 인스턴스화하지 않는다.
 *
 * Controller 는 `@ApiExtraModels(SingleResponse, ...)` 등록 후
 * `@ApiOkResponse({ schema: { allOf: [{ $ref: getSchemaPath(SingleResponse) }, ...] } })`
 * 패턴으로 구체 타입을 지정한다.
 */
export abstract class ApiResponse<T> {
  abstract data: T;
}

/**
 * 페이지네이션 메타데이터 — 목록 · 검색 응답에 첨부된다
 */
export class PaginationMeta {
  @ApiProperty({
    description: '필터 적용 후 전체 개수',
    example: 42,
    type: Number,
    required: true,
    minimum: 0,
  })
  total!: number;

  @ApiProperty({
    description: '한 페이지에 가져올 최대 개수',
    example: 20,
    type: Number,
    required: true,
    minimum: 1,
    maximum: 100,
  })
  limit!: number;

  @ApiProperty({
    description: '건너뛴 개수 (페이지네이션 오프셋)',
    example: 0,
    type: Number,
    required: true,
    minimum: 0,
  })
  offset!: number;

  constructor(total: number, limit: number, offset: number) {
    this.total = total;
    this.limit = limit;
    this.offset = offset;
  }
}

/**
 * 단건 응답
 *
 * `data` 의 구체 타입은 Controller 가 Swagger 데코레이터로 주입한다
 */
export class SingleResponse<T> extends ApiResponse<T> {
  data!: T;

  constructor(data: T) {
    super();
    this.data = data;
  }
}

/**
 * 목록 · 검색 응답
 *
 * `data` 의 원소 타입은 Controller 가 Swagger 데코레이터로 주입한다
 */
export class PaginatedResponse<T> extends ApiResponse<T[]> {
  data!: T[];

  @ApiProperty({
    description: '페이지네이션 메타데이터',
    type: PaginationMeta,
    required: true,
  })
  meta!: PaginationMeta;

  constructor(data: T[], meta: PaginationMeta) {
    super();
    this.data = data;
    this.meta = meta;
  }
}
