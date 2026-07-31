import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FundProofController } from './fundproof.controller';
import { FundProofService } from './fundproof.service';
import { StoredAttestation } from './fundproof.entity';

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
  ],
  controllers: [FundProofController],
  providers: [FundProofService],
})
export class AppModule {}