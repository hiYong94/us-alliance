import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { PaginatedResponse, PaginationMeta, SingleResponse } from '../common/dto/api-response.dto';
import { ErrorResponse } from '../common/dto/error-response.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { JobResponse } from './dto/job.response';
import { ListJobsQuery } from './dto/list-jobs.query';
import { PatchJobDto } from './dto/patch-job.dto';
import { SearchJobsQuery } from './dto/search-jobs.query';
import { TriggerSource } from './entities/job';
import { JobsService } from './jobs.service';

const SINGLE_JOB_SCHEMA = {
  allOf: [
    { $ref: getSchemaPath(SingleResponse) },
    { properties: { data: { $ref: getSchemaPath(JobResponse) } } },
  ],
};

const PAGINATED_JOB_SCHEMA = {
  allOf: [
    { $ref: getSchemaPath(PaginatedResponse) },
    {
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(JobResponse) } },
        meta: { $ref: getSchemaPath(PaginationMeta) },
      },
    },
  ],
};

@ApiTags('jobs')
@ApiExtraModels(SingleResponse, PaginatedResponse, PaginationMeta, JobResponse, ErrorResponse)
@Controller('jobs')
export class JobsController {
  constructor(private readonly service: JobsService) {}

  @Post()
  @ApiOperation({ summary: '작업 생성', description: '새 작업을 PENDING 상태로 생성한다' })
  @ApiCreatedResponse({ description: '생성된 작업', schema: SINGLE_JOB_SCHEMA })
  @ApiBadRequestResponse({ description: '입력 유효성 실패', type: ErrorResponse })
  async create(@Body() dto: CreateJobDto): Promise<SingleResponse<JobResponse>> {
    const job = await this.service.create(dto);
    return new SingleResponse(JobResponse.from(job));
  }

  @Get()
  @ApiOperation({ summary: '작업 목록', description: 'createdAt desc · soft-deleted 제외' })
  @ApiOkResponse({ description: '페이지네이션된 작업 목록', schema: PAGINATED_JOB_SCHEMA })
  async findAll(@Query() query: ListJobsQuery): Promise<PaginatedResponse<JobResponse>> {
    const { items, total } = await this.service.findAll(query);
    return new PaginatedResponse(
      items.map((job) => JobResponse.from(job)),
      new PaginationMeta(total, query.limit, query.offset),
    );
  }

  @Get('search')
  @ApiOperation({
    summary: '작업 검색',
    description: 'title 부분일치(ci) + status 다중 필터, soft-deleted 제외',
  })
  @ApiOkResponse({ description: '검색 결과', schema: PAGINATED_JOB_SCHEMA })
  async search(@Query() query: SearchJobsQuery): Promise<PaginatedResponse<JobResponse>> {
    const { items, total } = await this.service.search(query);
    return new PaginatedResponse(
      items.map((job) => JobResponse.from(job)),
      new PaginationMeta(total, query.limit, query.offset),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '단건 조회', description: 'soft-deleted 도 404' })
  @ApiOkResponse({ description: '단건 작업', schema: SINGLE_JOB_SCHEMA })
  @ApiNotFoundResponse({ description: '작업 없음 또는 soft-deleted', type: ErrorResponse })
  async findOne(@Param('id') id: string): Promise<SingleResponse<JobResponse>> {
    const job = await this.service.findOne(id);
    return new SingleResponse(JobResponse.from(job));
  }

  @Patch(':id')
  @ApiOperation({
    summary: '작업 수정 또는 취소',
    description:
      'PENDING + 미취소 상태일 때만 가능. body 에 title / description / cancel 중 하나 이상 필요',
  })
  @ApiOkResponse({ description: '수정된 작업', schema: SINGLE_JOB_SCHEMA })
  @ApiBadRequestResponse({
    description: '본문 누락 또는 유효성 실패',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({ description: '작업 없음', type: ErrorResponse })
  @ApiConflictResponse({
    description: 'PENDING 아님 / 이미 취소됨',
    type: ErrorResponse,
  })
  async patch(
    @Param('id') id: string,
    @Body() dto: PatchJobDto,
  ): Promise<SingleResponse<JobResponse>> {
    const job = await this.service.patch(id, dto);
    return new SingleResponse(JobResponse.from(job));
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '수동 실행 트리거 (명세 외 추가)',
    description:
      '다음 스케줄러 tick 을 기다리지 않고 즉시 점유한다. 처리 자체는 비동기로 진행되어 응답은 PROCESSING 상태로 즉시 반환',
  })
  @ApiOkResponse({ description: '점유된 작업 (PROCESSING)', schema: SINGLE_JOB_SCHEMA })
  @ApiNotFoundResponse({ description: '작업 없음', type: ErrorResponse })
  @ApiConflictResponse({
    description: '이미 점유됨 / 이미 취소됨',
    type: ErrorResponse,
  })
  async run(@Param('id') id: string): Promise<SingleResponse<JobResponse>> {
    const claimed = await this.service.claimOne(id, TriggerSource.MANUAL);
    // TODO #17 (feat/jobs-scheduler): scheduler.processOne(claimed) 비동기 트리거.
    // 현 시점에는 점유 전환만 수행 — 처리 종료(DONE/FAILED) 까지는 진행되지 않는다.
    return new SingleResponse(JobResponse.from(claimed));
  }
}
