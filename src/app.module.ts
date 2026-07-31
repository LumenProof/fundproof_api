import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from 'nestjs-throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bull';
import { FundProofController } from './fundproof.controller';
import { FundProofService } from './fundproof.service';
import { StoredAttestation } from './fundproof.entity';
import { FundProofProcessor } from './fundproof.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'fundproof.db',
      entities: [StoredAttestation],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([StoredAttestation]),
    ThrottlerModule.forRoot([{
      ttl: 60,
      limit: 20,
    }]),
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'proof-generation',
    }),
  ],
  controllers: [FundProofController],
  providers: [
    FundProofService,
    FundProofProcessor,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}