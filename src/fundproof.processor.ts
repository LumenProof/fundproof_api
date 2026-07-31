import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { FundProofService } from './fundproof.service';

@Processor('proof-generation')
export class FundProofProcessor {
  constructor(private readonly fundProofService: FundProofService) {}

  @Process()
  async transcode(job: Job<{ attestationId: string }>) {
    await this.fundProofService.processProof(job.data.attestationId);
  }
}