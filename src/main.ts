import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  
  // Get allowed origins from environment or use defaults
  const frontendOrigin = configService.get<string>('FRONTEND_ORIGIN');
  const allowedOrigins = frontendOrigin 
    ? frontendOrigin.split(',') 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('localhost:3000')) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  app.useGlobalPipes(new ValidationPipe({ 
    whitelist: true, 
    transform: true,
    disableErrorMessages: process.env.NODE_ENV === 'production',
  }));

  const port = configService.get<number>('PORT') ?? 4000;
  await app.listen(port);
  logger.log(`🚀 FundProof API running on http://localhost:${port}`);
  logger.log(`🌐 Allowed CORS origins: ${allowedOrigins.join(', ')}`);
  logger.log(`⚡ Health check: http://localhost:${port}/health`);
}

void bootstrap();