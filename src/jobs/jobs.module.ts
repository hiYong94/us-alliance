import { Module } from '@nestjs/common';
import { JobsMutex } from './jobs.mutex';
import { JobsRepository } from './jobs.repository';

/**
 * Job 도메인 모듈
 *
 * 후속 브랜치에서 Service / Controller / Scheduler 가 차례로 등록된다
 */
@Module({
  providers: [JobsRepository, JobsMutex],
})
export class JobsModule {}
