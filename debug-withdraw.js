// debug-withdraw.js
// Usage:
//   1) Save the circuit input JSON (the object logged under
//      "[ProofService] Input to Witness") to a file, e.g. input.json
//   2) From repo root, run:
//        node debug-withdraw.js input.json
//
// This runs snarkjs.groth16.fullProve directly on main.wasm/main_final.zkey
// so you can see the raw witness error coming from the Withdraw circuit.

const fs = require('fs');
const path = require('path');

async function main() {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    console.error('Usage: node debug-withdraw.js path/to/input.json');
    process.exit(1);
  }

  // Resolve circuit artifact paths the same way as ProofService expects
  const wasmPath = path.resolve(
    __dirname,
    'packages/circuits/private_transfer/build/main_js/main.wasm',
  );
  const zkeyPath = path.resolve(
    __dirname,
    'packages/circuits/private_transfer/output/main_final.zkey',
  );

  if (!fs.existsSync(wasmPath)) {
    console.error('WASM not found at:', wasmPath);
    console.error('Make sure you ran: pnpm --filter circuits run build');
    process.exit(1);
  }
  if (!fs.existsSync(zkeyPath)) {
    console.error('zkey not found at:', zkeyPath);
    console.error('Make sure you ran: pnpm --filter circuits run setup');
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const input = JSON.parse(raw);

  console.log('Using input:');
  console.dir(input, { depth: null });

  console.log('\nWASM:', wasmPath);
  console.log('ZKey:', zkeyPath);

  const snarkjs = await import('snarkjs');

  try {
    console.log('\nRunning groth16.fullProve...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
    console.log('\n✅ fullProve succeeded.');
    console.log('Public signals:');
    console.dir(publicSignals, { depth: null });
    console.log('Proof (truncated):');
    console.dir(
      {
        pi_a: proof.pi_a,
        pi_b: proof.pi_b,
        pi_c: proof.pi_c,
      },
      { depth: null },
    );
  } catch (err) {
    console.error('\n❌ fullProve failed.');
    console.error('Message:', err && err.message ? err.message : String(err));
    console.error('\nFull error object:');
    console.dir(err, { depth: null });
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
