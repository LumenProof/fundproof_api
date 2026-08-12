pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template MultiAssetFundProof() {
    // Support up to 5 different assets
    signal input balances[5];      // Individual asset balances in smallest units (cents/1e7)
    signal input nonce;

    signal input totalThreshold;    // Combined minimum balance required (public)
    signal input addressHash;       // Hash of user's Stellar address (public)
    signal input expiresAt;         // Timestamp when attestation expires (public)
    signal input attestationHash;   // Poseidon hash of all private inputs (public)
    
    // Calculate sum of all balances
    signal totalBalance;
    totalBalance <== balances[0] + balances[1] + balances[2] + balances[3] + balances[4];
    
    // Prove total balance >= threshold while keeping individual balances private
    component balanceIsBelowThreshold = LessThan(64);
    balanceIsBelowThreshold.in[0] <== totalBalance;
    balanceIsBelowThreshold.in[1] <== totalThreshold;
    balanceIsBelowThreshold.out === 0;
    
    // Include all balances in the poseidon hash to keep them cryptographically bound to the attestation
    component attestation = Poseidon(8);
    attestation.inputs[0] <== balances[0];
    attestation.inputs[1] <== balances[1];
    attestation.inputs[2] <== balances[2];
    attestation.inputs[3] <== balances[3];
    attestation.inputs[4] <== balances[4];
    attestation.inputs[5] <== addressHash;
    attestation.inputs[6] <== nonce;
    attestation.inputs[7] <== expiresAt;
    attestation.out === attestationHash;
}

component main { public [totalThreshold, addressHash, expiresAt, attestationHash] } = MultiAssetFundProof();