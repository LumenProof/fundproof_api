import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class StoredAttestation {
  @PrimaryColumn()
  id: string;

  @Column()
  stellarAddress: string;

  @Column()
  thresholdCents: number;

  @Column()
  balanceCents: number;

  @Column()
  nonce: string;

  @Column()
  expiresAt: number;

  @Column()
  addressHash: string;

  @Column()
  attestationHash: string;

  @Column()
  signature: string;
}