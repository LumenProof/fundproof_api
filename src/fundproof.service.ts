import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as ed from '@noble/ed25519';
import { buildPoseidon } from 'circomlibjs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type StoredAttestation = {
  id: string;
  stellarAddress: string;
  thresholdCents: number;
  balanceCents: number;
  nonce: string;
  expiresAt: number;
  addressHash: string;
  attestationHash: string;
  signature: string;
};

@Injectable()
export class FundProofService {
  private readonly attestations = new Map<string, StoredAttestation>();

  async createAttestation(stellarAddress: string, thresholdCents: number) {
    if (!stellarAddress.startsWith('G') || stellarAddress.length < 20) {
      throw new BadRequestException('Expected a Stellar public address that starts with G.');
    }

    const balanceCents = await this.getUsdcBalanceCents(stellarAddress);
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    const addressHash = await this.poseidonHash([this.textToField(stellarAddress)]);
    const attestationHash = await this.poseidonHash([
      BigInt(balanceCents),
      BigInt(addressHash),
      BigInt(`0x${nonce}`),
      BigInt(expiresAt),
    ]);

    const privateKey = this.attestationPrivateKey();
    const message = this.canonicalBytes({
      stellarAddress,
      balanceCents,
      nonce,
      expiresAt,
      addressHash,
      attestationHash,
    });
    const signature = bytesToHex(await ed.signAsync(message, privateKey));
    const id = bytesToHex(sha256(message)).slice(0, 24);

    const attestation: StoredAttestation = {
      id,
      stellarAddress,
      thresholdCents,
      balanceCents,
      nonce,
      expiresAt,
      addressHash,
      attestationHash,
      signature,
    };
    this.attestations.set(id, attestation);

    return {
      id,
      stellarAddress,
      thresholdCents,
      expiresAt,
      addressHash,
      attestationHash,
      signature,
      publicKey: bytesToHex(await ed.getPublicKeyAsync(privateKey)),
      demo: {
        mockBalanceCents: balanceCents,
        note: 'For local development the API uses MOCK_USDC_BALANCE_CENTS. Replace getUsdcBalanceCents with Horizon/Soroban USDC balance lookup for testnet.',
      },
    };
  }

  async prepareCircuitInput(attestationId: string) {
    const attestation = this.getFreshAttestation(attestationId);
    const input = this.toCircuitInput(attestation);

    return {
      input,
      publicSignals: {
        threshold: input.threshold,
        addressHash: input.addressHash,
        expiresAt: input.expiresAt,
        attestationHash: input.attestationHash,
      },
      nextStep: 'Call POST /proofs/generate with this attestationId to generate and verify the Groth16 proof locally.',
    };
  }

  async generateProof(attestationId: string) {
    const attestation = this.getFreshAttestation(attestationId);
    const input = this.toCircuitInput(attestation);
    const proofDir = resolve('build', 'proofs', attestation.id);
    const inputPath = join(proofDir, 'input.json');
    const proofPath = join(proofDir, 'proof.json');
    const publicPath = join(proofDir, 'public.json');

    await this.assertZkArtifactsExist();
    await mkdir(proofDir, { recursive: true });
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);

    await this.runSnarkjs([
      'groth16',
      'fullprove',
      inputPath,
      resolve('build', 'circuits', 'fundproof_js', 'fundproof.wasm'),
      resolve('build', 'circuits', 'fundproof_final.zkey'),
      proofPath,
      publicPath,
    ]);

    await this.runSnarkjs([
      'groth16',
      'verify',
      resolve('build', 'circuits', 'verification_key.json'),
      publicPath,
      proofPath,
    ]);

    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as unknown;
    const publicSignals = JSON.parse(await readFile(publicPath, 'utf8')) as string[];

    return {
      attestationId: attestation.id,
      verified: true,
      proof,
      publicSignals,
      publicSignalNames: ['threshold', 'addressHash', 'expiresAt', 'attestationHash'],
      files: {
        input: inputPath,
        proof: proofPath,
        public: publicPath,
      },
      nextStep: 'Submit proof and public signals to the Soroban Groth16 verifier contract.',
    };
  }

  private async getUsdcBalanceCents(_stellarAddress: string): Promise<number> {
    if ((process.env.USE_MOCK_BALANCES ?? 'true') === 'true') {
      return Number(process.env.MOCK_USDC_BALANCE_CENTS ?? 125000);
    }

    throw new BadRequestException('Real Stellar USDC lookup is not configured yet.');
  }

  private getFreshAttestation(attestationId: string): StoredAttestation {
    const attestation = this.attestations.get(attestationId);
    if (!attestation) {
      throw new NotFoundException('Unknown attestation id.');
    }
    if (attestation.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Attestation expired.');
    }
    return attestation;
  }

  private toCircuitInput(attestation: StoredAttestation) {
    return {
      balance: attestation.balanceCents.toString(),
      threshold: attestation.thresholdCents.toString(),
      addressHash: attestation.addressHash,
      nonce: BigInt(`0x${attestation.nonce}`).toString(),
      expiresAt: attestation.expiresAt.toString(),
      attestationHash: attestation.attestationHash,
    };
  }

  private async assertZkArtifactsExist() {
    const requiredFiles = [
      resolve('build', 'circuits', 'fundproof_js', 'fundproof.wasm'),
      resolve('build', 'circuits', 'fundproof_final.zkey'),
      resolve('build', 'circuits', 'verification_key.json'),
    ];

    try {
      await Promise.all(requiredFiles.map((file) => readFile(file)));
    } catch {
      throw new BadRequestException('Missing ZK artifacts. Run npm run zk:all in fundproof-api first.');
    }
  }

  private async runSnarkjs(args: string[]) {
    const snarkjsCli = resolve('node_modules', 'snarkjs', 'build', 'cli.cjs');
    try {
      await execFileAsync(process.execPath, [snarkjsCli, ...args], {
        cwd: process.cwd(),
        windowsHide: true,
        timeout: 120_000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'snarkjs command failed.';
      throw new BadRequestException(message);
    }
  }

  private attestationPrivateKey(): Uint8Array {
    const key = process.env.ATTESTATION_PRIVATE_KEY_HEX ?? '01'.padStart(64, '0');
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new BadRequestException('ATTESTATION_PRIVATE_KEY_HEX must be 32 bytes hex.');
    }
    return hexToBytes(key);
  }

  private canonicalBytes(value: Record<string, unknown>): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value, Object.keys(value).sort()));
  }

  private textToField(value: string): bigint {
    const hash = sha256(new TextEncoder().encode(value));
    return BigInt(`0x${bytesToHex(hash)}`) % this.bn254Field();
  }

  private async poseidonHash(values: bigint[]): Promise<string> {
    const poseidon = await buildPoseidon();
    const digest = poseidon(values);
    return poseidon.F.toObject(digest).toString();
  }

  private bn254Field(): bigint {
    return BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
  }
}
