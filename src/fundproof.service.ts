import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as ed from '@noble/ed25519';
import { buildPoseidon } from 'circomlibjs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { StoredAttestation } from './fundproof.entity';

const execFileAsync = promisify(execFile);

@Injectable()
export class FundProofService {
  private readonly logger = new Logger(FundProofService.name);

  constructor(
    @InjectRepository(StoredAttestation)
    private readonly attestationsRepository: Repository<StoredAttestation>,
  ) {}

  async createAttestation(stellarAddress: string, thresholdCents: number, selectedAssets: string[]) {
    this.logger.log(`Creating multi-asset attestation for address: ${stellarAddress.slice(0, 12)}..., total threshold: $${(thresholdCents / 100).toFixed(2)}, selected assets: ${selectedAssets.join(', ')}`);
    if (!stellarAddress.startsWith('G') || stellarAddress.length < 20) {
      throw new BadRequestException('Expected a Stellar public address that starts with G.');
    }
    if (!selectedAssets || selectedAssets.length === 0) {
      throw new BadRequestException('At least one asset must be selected.');
    }

    const { assetBalances, totalBalanceCents } = await this.getAllAssetBalancesCents(stellarAddress, selectedAssets);
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    const addressHash = await this.poseidonHash([this.textToField(stellarAddress)]);
    
    // Convert all asset balances to BigInts for the circuit (array of 5 balances, pad with zeros if needed)
    const balanceBigInts = assetBalances.map(ab => BigInt(ab.balance));
    while (balanceBigInts.length < 5) balanceBigInts.push(BigInt(0));
    
    const attestationHash = await this.poseidonHash([
      ...balanceBigInts,
      BigInt(addressHash),
      BigInt(`0x${nonce}`),
      BigInt(expiresAt),
    ]);

    const privateKey = this.attestationPrivateKey();
    const message = this.canonicalBytes({
      stellarAddress,
      balanceCents: totalBalanceCents,
      nonce,
      expiresAt,
      addressHash,
      attestationHash,
    });
    const signature = bytesToHex(await ed.signAsync(message, privateKey));
    const id = bytesToHex(sha256(message)).slice(0, 24);

    const attestation = this.attestationsRepository.create({
      id,
      stellarAddress,
      totalThresholdCents: thresholdCents,
      assetBalances,
      totalBalanceCents,
      nonce,
      expiresAt,
      addressHash,
      attestationHash,
      signature,
    });
    await this.attestationsRepository.save(attestation);

    return {
      id,
      stellarAddress,
      totalThresholdCents: thresholdCents,
      assetBalances,
      totalBalanceCents,
      expiresAt,
      addressHash,
      attestationHash,
      signature,
      publicKey: bytesToHex(await ed.getPublicKeyAsync(privateKey)),
    };
  }

  async prepareCircuitInput(attestationId: string) {
    const attestation = await this.getFreshAttestation(attestationId);
    const input = this.toCircuitInput(attestation);

    return {
      input,
      publicSignals: {
        totalThreshold: input.totalThreshold,
        addressHash: input.addressHash,
        expiresAt: input.expiresAt,
        attestationHash: input.attestationHash,
      },
      assetBalances: attestation.assetBalances,
      totalBalanceCents: attestation.totalBalanceCents,
      nextStep: 'Call POST /proofs/generate with this attestationId to generate and verify the Groth16 proof locally.',
    };
  }

  async generateProof(attestationId: string) {
    // Process proof synchronously instead of using Redis queue for local development
    return await this.processProof(attestationId);
  }

  async processProof(attestationId: string) {
    this.logger.log(`Processing proof for attestation: ${attestationId}`);
    const attestation = await this.getFreshAttestation(attestationId);
    const input = this.toCircuitInput(attestation);
    const proofDir = resolve('build', 'proofs', attestation.id);
    const inputPath = join(proofDir, 'input.json');
    const proofPath = join(proofDir, 'proof.json');
    const publicPath = join(proofDir, 'public.json');

    await this.assertZkArtifactsExist();
    await mkdir(proofDir, { recursive: true });
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
    this.logger.debug(`Input written to: ${inputPath}`);

    this.logger.log('Starting snarkjs fullprove...');
    await this.runSnarkjs([
      'groth16',
      'fullprove',
      inputPath,
      resolve('build', 'circuits', 'fundproof_js', 'fundproof.wasm'),
      resolve('build', 'circuits', 'fundproof_final.zkey'),
      proofPath,
      publicPath,
    ]);
    this.logger.log('Proof generated successfully, verifying...');

    await this.runSnarkjs([
      'groth16',
      'verify',
      resolve('build', 'circuits', 'verification_key.json'),
      publicPath,
      proofPath,
    ]);
    this.logger.log(`✅ Proof verified successfully for attestation: ${attestationId}`);

    // Read the generated files and return them
    const [proof, publicSignals] = await Promise.all([
      readFile(proofPath, 'utf8'),
      readFile(publicPath, 'utf8')
    ]);

    return {
      attestationId,
      verified: true,
      proof: JSON.parse(proof),
      publicSignals: JSON.parse(publicSignals),
      publicSignalNames: ['totalBalance', 'threshold', 'addressHash', 'expiresAt', 'attestationHash'],
      files: {
        input: inputPath,
        proof: proofPath,
        public: publicPath,
      },
      nextStep: 'Proof generated and verified successfully! You can now share the attestation.',
    };
  }

  // Supported major Stellar assets with their issuers and USD conversion rates
  private readonly SUPPORTED_ASSETS = [
    {
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      assetType: 'credit_alphanum4',
      usdRate: 1.0, // 1 USDC = 1 USD
      decimals: 2
    },
    {
      assetCode: 'XLM',
      assetType: 'native',
      assetIssuer: 'native',
      usdRate: 0.15, // Mock XLM/USD rate (would fetch from oracle in production)
      decimals: 7
    },
    {
      assetCode: 'EURC',
      assetIssuer: 'GB3O6Z56TVNDC2PLRYXJFQNPXYOWFA5C6S3G53D6H5FSUELH3B2DWR5E',
      assetType: 'credit_alphanum4',
      usdRate: 1.08, // 1 EURC ≈ 1.08 USD
      decimals: 2
    }
  ];

  private async getAllAssetBalancesCents(stellarAddress: string, selectedAssets: string[]): Promise<{ 
    assetBalances: Array<{ assetCode: string; assetIssuer: string; balance: number }>, 
    totalBalanceCents: number 
  }> {
    if ((process.env.USE_MOCK_BALANCES ?? 'true') === 'true') {
      // Mock multi-asset balances for testing
      const allMockBalances = [
        { assetCode: 'USDC', assetIssuer: this.SUPPORTED_ASSETS[0].assetIssuer, balance: 125000, usdValueCents: 125000 }, // $1,250 USDC
        { assetCode: 'XLM', assetIssuer: 'native', balance: 500000000, usdValueCents: 75000 }, // 5000 XLM ≈ $750
        { assetCode: 'EURC', assetIssuer: this.SUPPORTED_ASSETS[2].assetIssuer, balance: 50000, usdValueCents: 54000 } // €500 ≈ $540
      ];
      
      // Filter to only selected assets
      const filteredBalances = allMockBalances.filter(b => selectedAssets.includes(b.assetCode));
      const totalCents = filteredBalances.reduce((sum, b) => sum + b.usdValueCents, 0);
      
      // Return just the required fields (remove usdValueCents)
      const assetBalances = filteredBalances.map(({ assetCode, assetIssuer, balance }) => ({ assetCode, assetIssuer, balance }));
      return { assetBalances, totalBalanceCents: totalCents };
    }

    try {
      const response = await fetch(`https://horizon.stellar.org/accounts/${stellarAddress}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch account details: ${response.statusText}`);
      }
      const account = await response.json();
      
      const assetBalances: Array<{ assetCode: string; assetIssuer: string; balance: number }> = [];
      let totalBalanceCents = 0;

      // Only process selected assets
      for (const supported of this.SUPPORTED_ASSETS.filter(s => selectedAssets.includes(s.assetCode))) {
        const balance = account.balances.find((b: any) => {
          if (supported.assetType === 'native') return b.asset_type === 'native';
          return b.asset_type !== 'native' && 
                 b.asset_code === supported.assetCode && 
                 b.asset_issuer === supported.assetIssuer;
        });

        if (balance) {
          const rawBalance = parseFloat(balance.balance);
          const smallestUnits = Math.round(rawBalance * (10 ** supported.decimals));
          const usdValueCents = Math.round(rawBalance * supported.usdRate * 100);
          
          assetBalances.push({
            assetCode: supported.assetCode,
            assetIssuer: supported.assetType === 'native' ? 'native' : supported.assetIssuer,
            balance: smallestUnits
          });
          
          totalBalanceCents += usdValueCents;
        }
      }

      return { assetBalances, totalBalanceCents };
    } catch (error) {
      console.error('Error fetching multi-asset balances:', error);
      throw new BadRequestException('Failed to fetch asset balances from the Stellar network.');
    }
  }

  private async getFreshAttestation(attestationId: string): Promise<StoredAttestation> {
    const attestation = await this.attestationsRepository.findOneBy({ id: attestationId });
    if (!attestation) {
      throw new NotFoundException('Unknown attestation id.');
    }
    if (attestation.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Attestation expired.');
    }
    return attestation;
  }

  private toCircuitInput(attestation: StoredAttestation) {
    // Extract individual balances and pad to 5 assets (circuit requirement)
    const balances = attestation.assetBalances.map(ab => ab.balance.toString());
    while (balances.length < 5) balances.push('0');

    return {
      balances: [balances[0], balances[1], balances[2], balances[3], balances[4]],
      nonce: BigInt(`0x${attestation.nonce}`).toString(),
      totalThreshold: attestation.totalThresholdCents.toString(),
      addressHash: attestation.addressHash,
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

  // Expose supported assets to frontend
  getSupportedAssets() {
    return this.SUPPORTED_ASSETS.map(asset => ({
      assetCode: asset.assetCode,
      assetIssuer: asset.assetType === 'native' ? 'native' : asset.assetIssuer,
      assetType: asset.assetType || 'credit_alphanum4',
      usdRate: asset.usdRate,
      decimals: asset.decimals
    }));
  }

  async verifyProof(attestationId: string) {
    const attestation = await this.attestationsRepository.findOneBy({ id: attestationId });
    if (!attestation) {
      throw new NotFoundException('Proof not found');
    }

    const proofDir = resolve('build', 'proofs', attestationId);
    const proofPath = join(proofDir, 'proof.json');
    const publicPath = join(proofDir, 'public.json');

    try {
      const proof = JSON.parse(await readFile(proofPath, 'utf8')) as unknown;
      const publicSignals = JSON.parse(await readFile(publicPath, 'utf8')) as string[];

      return {
        attestationId: attestation.id,
        verified: true,
        proof,
        publicSignals,
        publicSignalNames: ['threshold', 'addressHash', 'expiresAt', 'attestationHash'],
        attestation: {
          stellarAddress: attestation.stellarAddress,
          thresholdCents: attestation.totalThresholdCents,
          createdAt: Date.now() - (attestation.expiresAt - Math.floor(Date.now() / 1000)) * 1000,
          verifiedAt: Date.now(),
        },
        files: {
          input: join(proofDir, 'input.json'),
          proof: proofPath,
          public: publicPath,
        },
        nextStep: 'Submit proof and public signals to the Soroban Groth16 verifier contract.',
      };
    } catch (error) {
      console.error('Error reading proof files:', error);
      return {
        verified: false,
        status: 'processing',
        message: 'Proof is still being generated. Please check back in a moment.',
      };
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