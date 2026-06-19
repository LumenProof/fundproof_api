# FundProof API

NestJS backend for FundProof, a hackathon proof-of-funds demo for Stellar.

The backend signs a balance attestation, prepares Circom/Groth16 circuit input, and includes the Soroban verifier contract scaffold that will record verified claims after local verification succeeds.

## Local setup

```bash
npm install
cp .env.example .env
npm run start:dev
```

Health check:

```bash
curl http://localhost:4000/health
```

Create an attestation:

```bash
curl -X POST http://localhost:4000/attestations \
  -H "Content-Type: application/json" \
  -d "{\"stellarAddress\":\"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF\",\"thresholdCents\":100000}"
```

Prepare circuit input:

```bash
curl -X POST http://localhost:4000/proof-input \
  -H "Content-Type: application/json" \
  -d "{\"attestationId\":\"<id from previous response>\"}"
```

## ZK flow

The circuit proves:

- private `balance >= public threshold`
- private `balance` is bound to a backend attestation hash
- the public claim includes `threshold`, `addressHash`, `expiresAt`, and `attestationHash`

The current local mode uses `MOCK_USDC_BALANCE_CENTS`. For testnet, replace `getUsdcBalanceCents` with a Stellar USDC balance lookup and keep the same circuit interface.

## Circom/Groth16 commands

The local proof flow uses Circom 2 and Groth16. Download the official Windows Circom binary into `tools/circom.exe`:

```bash
New-Item -ItemType Directory -Force tools
curl.exe -L https://github.com/iden3/circom/releases/download/v2.2.3/circom-windows-amd64.exe -o tools/circom.exe
```

Then run the full local ZK pipeline:

```bash
New-Item -ItemType Directory -Force build/circuits,ptau
npm run zk:compile
npm run zk:ptau
npm run zk:setup
npm run zk:contribute
npm run zk:export-vkey
npm run zk:demo-input
npm run zk:prove
npm run zk:verify
```

Expected final verifier output:

```text
[INFO]  snarkJS: OK!
```

You can also run the same sequence with:

```bash
npm run zk:all
```

To prove the rejection path, set a threshold above the demo balance:

```bash
$env:DEMO_THRESHOLD_CENTS="200000"
npm run zk:demo-input
npm run zk:prove
```

`zk:prove` should fail at the circuit assertion because the default private balance is `125000` cents.

To restore the passing input:

```bash
Remove-Item Env:\DEMO_THRESHOLD_CENTS
npm run zk:demo-input
npm run zk:prove
npm run zk:verify
```

Generated proof artifacts are written under `build/circuits`, including `fundproof.r1cs`, `fundproof_js/fundproof.wasm`, `fundproof_final.zkey`, `verification_key.json`, `proof.json`, and `public.json`.

## Stellar contract

`contracts/fundproof_verifier` is the local-first Soroban contract scaffold. The verifier placeholder should be replaced with generated Groth16 verifier logic using Stellar's `groth16_verifier` example before testnet submission.
