import { Module } from '@nestjs/common';
import { FundProofController } from './fundproof.controller';
import { FundProofService } from './fundproof.service';

@Module({
  controllers: [FundProofController],
  providers: [FundProofService],
})
export class AppModule {}
