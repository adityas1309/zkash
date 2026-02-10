/**
 * Trusted setup for the private transfer (Withdraw) circuit.
 * Requires: circuit built (pnpm run build), snarkjs installed. Circom 2.x must be in PATH for build.
 * Output: BN254 zkey and verification_key.json (Soroban verifier uses BLS12-381; see README).
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const circuitsDir = path.join(__dirname, '..', 'private_transfer');
const buildDir = path.join(circuitsDir, 'build');
const outputDir = path.join(circuitsDir, 'output');

if (!fs.existsSync(path.join(buildDir, 'main.r1cs'))) {
  console.error('Run build first: pnpm run build');
  process.exit(1);
}

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

let useNpx = true;
try {
  require.resolve('snarkjs/build/cli.cjs');
  useNpx = false;
} catch (_) { }

const e1 = crypto.randomBytes(32).toString('hex');
const e2 = crypto.randomBytes(32).toString('hex');

// Circuit has ~16k constraints; need 2^power >= nConstraints*2. Using 15 (2^15=32768).
const ptau0 = path.join(outputDir, 'pot15_0000.ptau');
const ptau1 = path.join(outputDir, 'pot15_0001.ptau');
const ptauFinal = path.join(outputDir, 'pot15_final.ptau');
const zkey0 = path.join(outputDir, 'main_0000.zkey');
const zkeyFinal = path.join(outputDir, 'main_final.zkey');
const r1cs = path.join(buildDir, 'main.r1cs');
const vkeyJson = path.join(outputDir, 'verification_key.json');

function sh(cmd) {
  execSync(cmd, { stdio: 'inherit', shell: true, cwd: outputDir });
}

console.log('Phase 1: Powers of Tau (BN254)...');
if (!fs.existsSync(ptauFinal)) {
  if (!fs.existsSync(ptau0)) {
    sh(useNpx ? `npx snarkjs powersoftau new bls12381 15 "${ptau0}"` : `node "${require.resolve('snarkjs/build/cli.cjs')}" powersoftau new bls12381 15 "${ptau0}"`);
  }
  if (!fs.existsSync(ptau1)) {
    sh(useNpx ? `npx snarkjs powersoftau contribute "${ptau0}" "${ptau1}" --name="First" -e="${e1}"` : `node "${require.resolve('snarkjs/build/cli.cjs')}" powersoftau contribute "${ptau0}" "${ptau1}" --name="First" -e="${e1}"`);
  }
  sh(useNpx ? `npx snarkjs powersoftau prepare phase2 "${ptau1}" "${ptauFinal}"` : `node "${require.resolve('snarkjs/build/cli.cjs')}" powersoftau prepare phase2 "${ptau1}" "${ptauFinal}"`);
}

console.log('Phase 2: Groth16 setup...');
if (!fs.existsSync(zkeyFinal)) {
  if (!fs.existsSync(zkey0)) {
    sh(useNpx ? `npx snarkjs groth16 setup "${r1cs}" "${ptauFinal}" "${zkey0}"` : `node "${require.resolve('snarkjs/build/cli.cjs')}" groth16 setup "${r1cs}" "${ptauFinal}" "${zkey0}"`);
  }
  sh(useNpx ? `npx snarkjs zkey contribute "${zkey0}" "${zkeyFinal}" --name="Second" -e="${e2}"` : `node "${require.resolve('snarkjs/build/cli.cjs')}" zkey contribute "${zkey0}" "${zkeyFinal}" --name="Second" -e="${e2}"`);
}

console.log('Exporting verification key...');
sh(useNpx ? `npx snarkjs zkey export verificationkey "${zkeyFinal}" "${vkeyJson}"` : `node "${require.resolve('snarkjs/build/cli.cjs')}" zkey export verificationkey "${zkeyFinal}" "${vkeyJson}"`);

console.log('Done. Artifacts in', outputDir);
console.log('Note: Soroban groth16_verifier uses BLS12-381. This zkey is BN254.');
