#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Bn254G1Affine,
    Bn254G2Affine, BytesN, Env, Symbol, Vec,
};

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

pub type Bn254Fr = [u8; BN254_FR_SERIALIZED_SIZE];

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

    // --- Groth16 Verification Logic ---
    // Equation: e(A, alpha) * e(B, beta) * e(C, delta) = e(L, gamma)

    // 1. Compute L = vk.ic[0] + sum(inputs[i] * vk.ic[i+1])
    let mut l = vk.ic.get(0).unwrap();
    for (i, s) in pub_signals.iter().enumerate() {
        let v = vk.ic.get(i + 1).unwrap();
        let prod = bn.mul(&v, &s);
        l = bn.add(&l, &prod);
    }

    // 2. Compute the Left Hand Side (LHS) of the pairing equation
    let p1 = bn.pairing(&proof.a, &vk.alpha);
    let p2 = bn.pairing(&proof.b, &vk.beta);
    let p3 = bn.pairing(&proof.c, &vk.delta);

    let lhs = bn.gt_mul(&p1, &p2);
    let lhs = bn.gt_mul(&lhs, &p3);

    // 3. Compute the Right Hand Side (RHS) of the pairing equation
    let rhs = bn.pairing(&l, &vk.gamma);

    // 4. Check if LHS == RHS
    if lhs != rhs {
        return Err(FundProofError::VerificationFailed);
    }

    env.storage().persistent().set(
        &attestation_hash,
        &VerifiedProof {
            attestation_hash,
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
        alpha: Bn254G1Affine::try_from_bytes(&VK_ALPHA)
            .map_err(|_| FundProofError::MalformedVerifyingKey)?,
        beta: Bn254G2Affine::try_from_bytes(&VK_BETA_2)
            .map_err(|_| FundProofError::MalformedVerifyingKey)?,
        gamma: Bn254G2Affine::try_from_bytes(&VK_GAMMA_2)
            .map_err(|_| FundProofError::MalformedVerifyingKey)?,
        delta: Bn254G2Affine::try_from_bytes(&VK_DELTA_2)
            .map_err(|_| FundProofError::MalformedVerifyingKey)?,
        ic: {
            let mut ic = Vec::new(env);
            for val in VK_IC.iter() {
                ic.push_back(
                    Bn254G1Affine::try_from_bytes(val)
                        .map_err(|_| FundProofError::MalformedVerifyingKey)?,
                );
            }
            ic
        },
    })
}