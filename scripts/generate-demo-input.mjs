import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { buildPoseidon } from 'circomlibjs';

const field = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const textEncoder = new TextEncoder();

const stellarAddress = process.env.DEMO_STELLAR_ADDRESS ?? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const balance = BigInt(process.env.DEMO_BALANCE_CENTS ?? '125000');
const threshold = BigInt(process.env.DEMO_THRESHOLD_CENTS ?? '100000');
const nonce = BigInt(process.env.DEMO_NONCE ?? '123456789');
const expiresAt = BigInt(process.env.DEMO_EXPIRES_AT ?? '1893456000');

const poseidon = await buildPoseidon();

function textToField(value) {
  return BigInt(`0x${bytesToHex(sha256(textEncoder.encode(value)))}`) % field;
}

function poseidonHash(values) {
  return poseidon.F.toObject(poseidon(values)).toString();
}

const addressHash = poseidonHash([textToField(stellarAddress)]);
const attestationHash = poseidonHash([balance, BigInt(addressHash), nonce, expiresAt]);

const input = {
  balance: balance.toString(),
  threshold: threshold.toString(),
  addressHash,
  nonce: nonce.toString(),
  expiresAt: expiresAt.toString(),
  attestationHash,
};

mkdirSync(resolve('build/circuits'), { recursive: true });
writeFileSync(resolve('build/circuits/input.json'), `${JSON.stringify(input, null, 2)}\n`);

console.log(JSON.stringify({
  wrote: 'build/circuits/input.json',
  publicSignals: {
    threshold: threshold.toString(),
    addressHash,
    expiresAt: expiresAt.toString(),
    attestationHash,
  },
}, null, 2));
