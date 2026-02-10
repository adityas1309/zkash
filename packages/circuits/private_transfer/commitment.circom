pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * @title CommitmentHasher template
 * @dev Template for generating privacy pool commitments and nullifier hashes
 * 
 * @notice HASH FUNCTION CHOICE:
 *   This template uses Poseidon hash functions:
 *   - Poseidon(1): For single field elements
 *   - Poseidon(2): For two field elements
 *   - Poseidon(3): For three field elements
 * 
 *   Poseidon is more efficient for SNARK circuits and provides better
 *   security properties for zero-knowledge applications.
 * 
 * @notice COMMITMENT STRUCTURE:
 *   commitment = Poseidon(value, label, Poseidon(nullifier, secret))
 *   nullifierHash = Poseidon(nullifier)
 */
template CommitmentHasher() {
    
    // inputs
    signal input value;
    signal input label;              // hash(pool_scope, nonce) % SNARK_SCALAR_FIELD
    signal input secret;             // secret of commitment
    signal input nullifier;
    
    // outputs
    signal output commitment;
    signal output nullifierHash;

    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;

    component precommitmentHasher = Poseidon(2);
    precommitmentHasher.inputs[0] <== nullifier;
    precommitmentHasher.inputs[1] <== secret;

    // Commitment = Poseidon(value, label, precommitment)
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== value;
    commitmentHasher.inputs[1] <== label;
    commitmentHasher.inputs[2] <== precommitmentHasher.out;

    commitment <== commitmentHasher.out;
    nullifierHash <== nullifierHasher.out;
}
