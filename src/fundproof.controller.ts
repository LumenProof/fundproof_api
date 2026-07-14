import { Body, Controller, Get, Post, Param } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { FundProofService } from './fundproof.service';

class CreateAttestationDto {
  @IsString()
  @IsNotEmpty()
  stellarAddress!: string;

  @IsInt()
  @Min(1)
  thresholdCents!: number;
}

class PrepareProofInputDto {
  @IsString()
  @IsNotEmpty()
  attestationId!: string;
}

@Controller()
export class FundProofController {
  constructor(private readonly fundProof: FundProofService) {}

  @Get('health')
  health() {
    return { ok: true, service: 'fundproof-api' };
  }

  @Post('attestations')
  createAttestation(@Body() dto: CreateAttestationDto) {
    return this.fundProof.createAttestation(dto.stellarAddress, dto.thresholdCents);
  }

  @Post('proof-input')
  prepareProofInput(@Body() dto: PrepareProofInputDto) {
    return this.fundProof.prepareCircuitInput(dto.attestationId);
  }

  @Post('proofs/generate')
  generateProof(@Body() dto: PrepareProofInputDto) {
    return this.fundProof.generateProof(dto.attestationId);
  }

  @Get('verify/:attestationId')
  verifyProof(@Param('attestationId') attestationId: string) {
    return this.fundProof.verifyProof(attestationId);
  }
}