#![no_std]

use soroban_bn254::{Fq, G1Point, G2Point};
use soroban_groth16_verifier::VerificationKey;
use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env, Symbol, Vec};

include!(concat!(env!("OUT_DIR"), "/verification_key.rs"));

#[contract]
pub struct FundProofVerifier;

#[contractimpl]
impl FundProofVerifier {
    pub fn verify_and_record(
        env: Env,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
        attestation_hash: BytesN<32>,
        threshold_cents: u64,
        expires_at: u64,
    ) -> bool {
        let now = env.ledger().timestamp();
        if expires_at < now {
            return false;
        }

        let vk = get_verification_key(&env);
        let proof_points = soroban_groth16_verifier::read_proof_points(&env, &proof);

        soroban_groth16_verifier::verify_proof(
            &env,
            &vk,
            &proof_points.a,
            &proof_points.b,
            &proof_points.c,
            &public_inputs,
        );

        let storage_key = (Symbol::new(&env, "fundproof"), attestation_hash.clone());
        env.storage()
            .persistent()
            .set(&storage_key, &(proof, threshold_cents, expires_at));
        true
    }
}