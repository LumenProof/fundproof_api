pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template FundProof() {
    signal input balance;
    signal input nonce;

    signal input threshold;
    signal input addressHash;
    signal input expiresAt;
    signal input attestationHash;

    component balanceIsBelowThreshold = LessThan(64);
    balanceIsBelowThreshold.in[0] <== balance;
    balanceIsBelowThreshold.in[1] <== threshold;
    balanceIsBelowThreshold.out === 0;

    component attestation = Poseidon(4);
    attestation.inputs[0] <== balance;
    attestation.inputs[1] <== addressHash;
    attestation.inputs[2] <== nonce;
    attestation.inputs[3] <== expiresAt;
    attestation.out === attestationHash;
}

component main { public [threshold, addressHash, expiresAt, attestationHash] } = FundProof();
