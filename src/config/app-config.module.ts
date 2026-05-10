import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

/**
 * 앱 전역 환경 변수 설정 진입점
 *
 * isGlobal: true 로 ConfigService 를 어디서든 주입받을 수 있게 하여
 * 도메인 코드가 process.env 에 직접 의존하지 않도록 한다
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true })],
})
export class AppConfigModule {}
