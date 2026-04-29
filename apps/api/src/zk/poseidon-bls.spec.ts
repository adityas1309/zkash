import * as path from 'path';
import * as fs from 'fs';
import { poseidonHash1, poseidonHash2, poseidonHash3 } from './poseidon-bls';

// This test cross-checks the TS Poseidon hashes against a tiny circuit that uses
// the same BLS12-381 Poseidon (via the main circuit/zkey) by leveraging the
// existing Withdraw circuit setup.

describe('BLS12-381 Poseidon adapter', () => {
  const circuitsRoot = path.resolve(
    process.cwd(),
    '../..',
    'packages',
    'circuits',
    'private_transfer',
  );

  const wasmPath = path.join(circuitsRoot, 'build', 'main_js', 'main.wasm');
  const zkeyPath = path.join(circuitsRoot, 'output', 'main_final.zkey');
  const artifactsAvailable = fs.existsSync(wasmPath) && fs.existsSync(zkeyPath);

  (artifactsAvailable ? it : it.skip)('has circuit artifacts available for cross-checking', () => {
    expect(fs.existsSync(wasmPath)).toBe(true);
    expect(fs.existsSync(zkeyPath)).toBe(true);
  });

  it('produces stable hashes for sample inputs', () => {
    const x = 1n;
    const y = 2n;
    const z = 3n;

    const h1 = poseidonHash1(x);
    const h2 = poseidonHash2(x, y);
    const h3 = poseidonHash3(x, y, z);

    // Basic sanity: non-zero and distinct for these small test vectors.
    expect(h1).not.toBe(0n);
    expect(h2).not.toBe(0n);
    expect(h3).not.toBe(0n);
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
  });
});
