/**
 * Quick test: Verify that circomlibjs Poseidon matches the compiled circuit WASM.
 * We'll use snarkjs.fullProve with a minimal known input to check Poseidon consistency.
 */
const path = require('path');

async function main() {
    // 1. Compute Poseidon(1, 2) using circomlibjs 
    const { buildPoseidon } = require('circomlibjs');
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // Test basic Poseidon(2)
    const hash2 = F.toObject(poseidon([1n, 2n]));
    console.log('circomlibjs Poseidon(1, 2) =', hash2.toString());
    console.log('  hex:', hash2.toString(16));

    // Test Poseidon(3) used in commitment
    const hash3 = F.toObject(poseidon([1n, 2n, 3n]));
    console.log('circomlibjs Poseidon(1, 2, 3) =', hash3.toString());
    console.log('  hex:', hash3.toString(16));

    // Test Poseidon(1) used for nullifier
    const hash1 = F.toObject(poseidon([42n]));
    console.log('circomlibjs Poseidon(42) =', hash1.toString());
    console.log('  hex:', hash1.toString(16));

    // 2. Now verify the circuit's Poseidon by computing a simple commitment
    // and checking if the circuit accepts it
    const value = 10000000n;
    const label = 12345n;
    const nullifier = 67890n;
    const secret = 11111n;

    // Compute precommitment = Poseidon(nullifier, secret)
    const precommitment = F.toObject(poseidon([nullifier, secret]));
    console.log('\nprecommitment =', precommitment.toString());

    // Compute commitment = Poseidon(value, label, precommitment)
    const commitment = F.toObject(poseidon([value, label, precommitment]));
    console.log('commitment =', commitment.toString());
    console.log('commitment hex:', commitment.toString(16).padStart(64, '0'));

    // Compute nullifierHash = Poseidon(nullifier)
    const nullifierHash = F.toObject(poseidon([nullifier]));
    console.log('nullifierHash =', nullifierHash.toString());

    // Build a 1-leaf Merkle tree (depth 20)
    let node = commitment;
    const siblings = [];
    const zeroLeaf = 0n;

    for (let d = 0; d < 20; d++) {
        // At index 0, sibling is always on the right
        // sibling at level d for a 1-leaf tree is hash of zero subtrees
        siblings.push('0');  // zero sibling for the first levels
        node = F.toObject(poseidon([node, zeroLeaf]));
    }

    const root = node;
    console.log('\nroot =', root.toString());
    console.log('root hex:', root.toString(16).padStart(64, '0'));

    // 3. Try to generate a proof with these known values
    const wasmPath = path.resolve('packages/circuits/private_transfer/build/main_js/main.wasm');
    const zkeyPath = path.resolve('packages/circuits/private_transfer/output/main_final.zkey');

    const input = {
        withdrawnValue: value.toString(),
        stateRoot: root.toString(),
        associationRoot: '0',
        label: label.toString(),
        value: value.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        stateSiblings: siblings,
        stateIndex: '0',
        labelIndex: '0',
        labelSiblings: ['0', '0'],
    };

    console.log('\n--- Testing circuit with known-good inputs ---');
    console.log('Input stateRoot:', input.stateRoot);

    try {
        const snarkjs = require('snarkjs');
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
        console.log('✅ Circuit ACCEPTED the proof!');
        console.log('Public signals:', publicSignals);
    } catch (e) {
        console.error('❌ Circuit REJECTED:', e.message);
    }
}

main().catch(console.error);
