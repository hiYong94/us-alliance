import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // 입력 유효성 — whitelist + forbidNonWhitelisted 로 알 수 없는 필드 거부 (VALIDATION_FAILED)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger UI 마운트 (/docs) — 평가자 즉시 확인 가능
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Job 관리 시스템')
    .setDescription('어스얼라이언스 백엔드 채용 과제 — Job 도메인 API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();
