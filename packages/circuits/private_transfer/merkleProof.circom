pragma circom 2.2.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * Fixed‑depth Poseidon Merkle proof that matches the off‑chain
 * MerkleTreeService.computeRootFromPath logic:
 *
 * For each level i:
 *   bit = (leafIndex >> i) & 1
 *   if bit == 0: hash(left = node,   right = sibling)
 *   if bit == 1: hash(left = sibling, right = node)
 */
template MerkleProof(depth) {
    // inputs 
    signal input leaf;                  // leaf value to prove inclusion of
    signal input leafIndex;             // index of leaf in the Merkle tree
    signal input siblings[depth];       // sibling values along the path to the root

    // output
    signal output out;
    
    // internal signals
    signal nodes[depth + 1]; // stores computed node values at each level
    signal indices[depth];   // path bits (LSB-first)

    // components
    component indexToPath = Num2Bits(depth);
    component hashers[depth];
    component mux[depth];

    // decompose index into bits
    indexToPath.in <== leafIndex;
    indices <== indexToPath.out;

    // init leaf
    nodes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // childrenToSort[2][2] = [ [node, sib], [sib, node] ]
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== nodes[i];
        mux[i].c[0][1] <== siblings[i];
        mux[i].c[1][0] <== siblings[i];
        mux[i].c[1][1] <== nodes[i];
        mux[i].s <== indices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        nodes[i + 1] <== hashers[i].out;
    }

    out <== nodes[depth];
}