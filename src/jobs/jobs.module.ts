import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsMutex } from './jobs.mutex';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';

/**
 * Job 도메인 모듈
 *
 * 후속 브랜치에서 Scheduler 가 추가된다 (#17)
 */
@Module({
  controllers: [JobsController],
  providers: [JobsRepository, JobsMutex, JobsService],
  exports: [JobsService],
})
export class JobsModule {}
