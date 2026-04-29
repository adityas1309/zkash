const { MerkleTreeService } = require('./src/zk/merkle-tree.service');

// Mock Poseidon hash for standalone execution
// Real implementation is in src/zk/poseidon-bls.ts but requires compilation/setup
// We just need to burn CPU cycles similarly to the real one for the benchmark
const poseidonHash2 = (left, right) => {
  return (left + right) % 123456789n; // Simple mock
};

// Mock dependencies
const bigIntToBytes32BE = (n) => {
  const buffer = Buffer.alloc(32);
  // write big int to buffer
  let hex = n.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
};

const bytesToBigInt = (buf) => {
  return BigInt('0x' + buf.toString('hex'));
};

// Patch the service with mocks
MerkleTreeService.prototype.hashNode = (left, right) => poseidonHash2(left, right);

// We need to instantiate the service and run the problematic method
async function run() {
  const service = new MerkleTreeService();

  // Create a few leaves (e.g., 10 transactions)
  const leaves = [];
  for (let i = 0; i < 10; i++) {
    leaves.push(bigIntToBytes32BE(BigInt(i)));
  }

  console.log('Starting computeSiblingsForIndex...');
  const start = Date.now();
  try {
    // Depth 20 = 1 million leaves
    await service.computeSiblingsForIndex(leaves, 0, 20);
  } catch (e) {
    console.error(e);
  }
  const end = Date.now();
  console.log(`Duration: ${(end - start) / 1000}s`);
}

run();
