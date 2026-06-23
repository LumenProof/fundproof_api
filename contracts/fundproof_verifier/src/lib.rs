#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, BytesN, Env, Symbol, Vec,
};
use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Bn254Fr};

mod vk_data;
use vk_data::*;

const BN254_G1_SERIALIZED_SIZE: usize = 64;
const BN254_G2_SERIALIZED_SIZE: usize = 128;
const BN254_FR_SERIALIZED_SIZE: usize = 32;

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

#[derive(Clone)]
#[contracttype]
pub struct VerifyingKey {
    pub alpha: Bn254G1Affine,
    pub beta: Bn254G2Affine,
    pub gamma: Bn254G2Affine,
    pub delta: Bn254G2Affine,
    pub ic: Vec<Bn254G1Affine>,
}

#[derive(Clone)]
#[contracttype]
pub struct VerifiedProof {
    pub attestation_hash: BytesN<32>,
    pub threshold_cents: u64,
    pub expires_at: u64,
}



#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum FundProofError {
    MalformedVerifyingKey = 1,
    MalformedProof = 2,
    PairingError = 3,
    VerificationFailed = 4,
    ProofExpired = 5,
}

const PROOF_KEY: Symbol = symbol_short!("PROOF");

#[contract]
pub struct FundProofVerifier;

#[contractimpl]
impl FundProofVerifier {
    pub fn verify_and_record(
        env: Env,
        proof: Proof,
        pub_signals: Vec<Bn254Fr>,
        attestation_hash: BytesN<32>,
        threshold_cents: u64,
        expires_at: u64,
    ) -> Result<(), FundProofError> {
        if env.ledger().timestamp() >= expires_at {
            return Err(FundProofError::ProofExpired);
        }

        let bn = env.crypto().bn254();
        let vk = vk(&env).map_err(|_| FundProofError::MalformedVerifyingKey)?;

        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(FundProofError::MalformedVerifyingKey);
        }

        let mut l = vk.ic.get(0).unwrap();
                for (i, s) in pub_signals.iter().enumerate() {
                    let v = vk.ic.get((i as u32) + 1).unwrap();
                    let prod = bn.g1_mul(&v, &s);
                    l = bn.g1_add(&l, &prod);
                }

        let p1 = Vec::from_array(&env, [proof.a.clone(), l, proof.c.clone(), vk.alpha.clone()]);
        let p2 = Vec::from_array(
            &env,
            [
                proof.b.clone(),
                vk.gamma.clone(),
                vk.delta.clone(),
                vk.beta.clone(),
            ],
        );

        if !bn.pairing_check(p1, p2) {
            return Err(FundProofError::VerificationFailed);
        }


        env.storage().persistent().set(
                    &attestation_hash,
                    &VerifiedProof {
                        attestation_hash: attestation_hash.clone(),
                        threshold_cents,
                        expires_at,
                    },
                );

        Ok(())
    }

    pub fn get_proof(env: Env, attestation_hash: BytesN<32>) -> Option<VerifiedProof> {
        env.storage().persistent().get(&attestation_hash)
    }
}

fn vk(env: &Env) -> Result<VerifyingKey, FundProofError> {
    Ok(VerifyingKey {
        alpha: Bn254G1Affine::from_bytes(BytesN::from_array(env, &VK_ALPHA)),
        beta: Bn254G2Affine::from_bytes(BytesN::from_array(env, &VK_BETA_2)),
        gamma: Bn254G2Affine::from_bytes(BytesN::from_array(env, &VK_GAMMA_2)),
        delta: Bn254G2Affine::from_bytes(BytesN::from_array(env, &VK_DELTA_2)),
        ic: {
            let mut ic = Vec::new(env);
            for val in VK_IC.iter() {
                ic.push_back(Bn254G1Affine::from_bytes(BytesN::from_array(env, val)));
            }
            ic
        },
    })
}