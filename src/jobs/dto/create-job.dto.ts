import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateJobDto {
  @ApiProperty({
    description: '작업 제목 — 사용자가 식별 가능한 라벨',
    example: '데이터 백업 작업',
    type: String,
    required: true,
    minLength: 1,
    maxLength: 120,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    description:
      '작업 상세 설명 — 처리 대상의 부가 정보. 생략 가능하며 null 로 저장된다',
    example: '매일 자정 DB 스냅샷을 S3 로 업로드',
    type: String,
    required: false,
    nullable: true,
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
