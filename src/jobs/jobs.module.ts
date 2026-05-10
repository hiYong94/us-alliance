import { Module } from '@nestjs/common';
import { JobsMutex } from './jobs.mutex';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';

/**
 * Job 도메인 모듈
 *
 * 후속 브랜치에서 Controller / Scheduler 가 차례로 등록된다
 */
@Module({
  providers: [JobsRepository, JobsMutex, JobsService],
  exports: [JobsService],
})
export class JobsModule {}
