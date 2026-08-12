import { Entity, Column, PrimaryColumn } from 'typeorm';

// Interface for tracking individual asset balances
export interface AssetBalance {
  assetCode: string;
  assetIssuer: string;
  balance: number; // Balance in smallest units (cents for USD-based, 1e7 for XLM)
}

@Entity()
export class StoredAttestation {
  @PrimaryColumn()
  id!: string;

  @Column()
  stellarAddress!: string;

  @Column()
  totalThresholdCents!: number; // Combined minimum balance across all assets

  // Store individual asset balances as JSON
  @Column('json')
  assetBalances!: AssetBalance[];

  // Calculated total balance (sum of all asset balances converted to USD cents equivalent)
  @Column()
  totalBalanceCents!: number;

  @Column()
  nonce!: string;

  @Column()
  expiresAt!: number;

  @Column()
  addressHash!: string;

  @Column()
  attestationHash!: string;

  @Column()
  signature!: string;
}