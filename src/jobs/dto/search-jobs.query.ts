import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JobStatus } from '../entities/job';

export class SearchJobsQuery {
  @ApiProperty({
    description: '제목 부분일치 (case-insensitive). 생략 시 모든 제목 매치',
    example: 'backup',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    description: '상태 다중 필터 — 콤마 구분으로 여러 값 전달 가능. 생략 시 모든 상태 매치',
    example: 'PENDING,FAILED',
    enum: JobStatus,
    enumName: 'JobStatus',
    isArray: true,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsEnum(JobStatus, { each: true })
  status?: JobStatus[];

  @ApiProperty({
    description: '한 페이지에 가져올 최대 작업 수',
    example: 20,
    type: Number,
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiProperty({
    description: '건너뛸 작업 수 — 페이지네이션 오프셋',
    example: 0,
    type: Number,
    required: false,
    default: 0,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
