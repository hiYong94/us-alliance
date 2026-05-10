import { Module } from '@nestjs/common';
import { RandomService } from '../common/random.service';
import { LoggingModule } from '../logging/logging.module';
import { JobsController } from './jobs.controller';
import { JobsMutex } from './jobs.mutex';
import { JobsRepository } from './jobs.repository';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';

/**
 * Job 도메인 모듈 — Phase 4 · 5 누적 산출물 모두 등록
 *
 * LoggingModule 을 import 하여 JobsScheduler 가 LoggerService 를 주입받을 수 있게 한다
 */
@Module({
  imports: [LoggingModule],
  controllers: [JobsController],
  providers: [JobsRepository, JobsMutex, JobsService, JobsScheduler, RandomService],
  exports: [JobsService],
})
export class JobsModule {}
