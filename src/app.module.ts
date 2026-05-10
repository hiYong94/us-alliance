import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TraceContextMiddleware } from './common/middlewares/trace-context.middleware';
import { AppConfigModule } from './config/app-config.module';
import { JobsModule } from './jobs/jobs.module';
import { LoggingModule } from './logging/logging.module';

/**
 * 루트 모듈
 *
 * Cross-cutting wiring:
 * - APP_FILTER: AllExceptionsFilter — 전역 에러 응답 통일 + 에러 로깅
 * - APP_INTERCEPTOR: LoggingInterceptor — 전역 HTTP 요청 · 응답 로깅
 * - TraceContextMiddleware — 모든 라우트에 X-Trace-Id 부여 · ALS 등록
 *
 * Filter · Interceptor 는 APP_FILTER · APP_INTERCEPTOR provider 패턴으로 등록하여
 * NestJS DI 컨테이너가 LoggerService 등 의존성을 주입할 수 있게 한다.
 */
@Module({
  imports: [AppConfigModule, JobsModule, LoggingModule, ScheduleModule.forRoot()],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceContextMiddleware).forRoutes('*');
  }
}
