import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PatchJobDto {
  @ApiProperty({
    description: '작업 제목 변경 — PENDING 상태이고 미취소일 때만 가능',
    example: '수정된 백업 작업',
    type: String,
    required: false,
    minLength: 1,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiProperty({
    description: '작업 설명 변경 — PENDING 상태이고 미취소일 때만 가능',
    example: '주간으로 변경',
    type: String,
    required: false,
    nullable: true,
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    description:
      '작업 취소 액션 플래그 — true 만 허용. 처리 시 deletedAt 이 set 되며 status 는 PENDING 그대로 유지',
    example: true,
    type: Boolean,
    enum: [true],
    required: false,
  })
  @IsOptional()
  @Equals(true)
  cancel?: true;
}
