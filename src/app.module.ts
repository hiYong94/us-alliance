import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { JobsModule } from './jobs/jobs.module';
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [AppConfigModule, JobsModule, LoggingModule],
})
export class AppModule {}
