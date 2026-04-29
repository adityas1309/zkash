const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const circuitsDir = path.join(__dirname, '..', 'private_transfer');
const buildDir = path.join(circuitsDir, 'build');
const outputDir = path.join(circuitsDir, 'output');

if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

console.log('Compiling circuit...');
execSync(
  `circom "${path.join(circuitsDir, 'main.circom')}" --r1cs --wasm --sym --prime bls12381 -o "${buildDir}"`,
  {
    stdio: 'inherit',
    cwd: circuitsDir,
  },
);

// Copy WASM to output for frontend
const wasmSrc = path.join(buildDir, 'main_js', 'main.wasm');
if (fs.existsSync(wasmSrc)) {
  fs.copyFileSync(wasmSrc, path.join(outputDir, 'main.wasm'));
}
console.log('Circuit compiled. Run trusted setup: pnpm run setup');
