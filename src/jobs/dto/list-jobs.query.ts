import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ListJobsQuery {
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
