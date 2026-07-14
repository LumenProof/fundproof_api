import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FundProofController } from './fundproof.controller';
import { FundProofService } from './fundproof.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [FundProofController],
  providers: [FundProofService],
})
export class AppModule {}