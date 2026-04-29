// Self-contained reproduction script for Merkle Tree performance - OPTIMIZED VERSION CHECK

// Mock Poseidon hash
const poseidonHash2 = (left, right) => {
  return (left + right + 12345n) % 999999999999n;
};

// Utils
const bigIntToBytes32BE = (n) => {
  return new Uint8Array(32);
};

const bytesToBigInt = (buf) => {
  return 1n;
};

class MerkleTreeService {
  constructor() {
    this.zeros = [];
    this.initZeros(32);
  }

  initZeros(depth) {
    let current = 0n;
    this.zeros.push(current);
    for (let i = 1; i < depth; i++) {
      current = this.hashNode(current, current);
      this.zeros.push(current);
    }
  }

  hashNode(left, right) {
    // In real app this is expensive
    return poseidonHash2(left, right);
  }

  // OPTIMIZED PARAMETERS
  async computeSiblingsForIndex(leavesBytes, leafIndex, depth = 20) {
    let level = leavesBytes.map(bytesToBigInt);

    // No more massive padding loop!

    const siblings = [];
    let idx = leafIndex;

    const traversalStart = Date.now();
    console.log('[Repro] Starting iterative hashing (OPTIMIZED)...');

    for (let d = 0; d < depth; d++) {
      // Logs every depth
      if (d % 5 === 0) console.log(`[Repro] Processing depth ${d}... level size: ${level.length}`);

      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;

      if (sibIdx < level.length) {
        siblings.push(bigIntToBytes32BE(level[sibIdx]));
      } else {
        siblings.push(bigIntToBytes32BE(this.zeros[d]));
      }

      if (level.length % 2 !== 0) {
        level.push(this.zeros[d]);
      }

      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(this.hashNode(level[i], level[i + 1]));
      }
      level = next;
      idx = idx >> 1;
    }
    console.log(`[Repro] Traversal finished in ${(Date.now() - traversalStart) / 1000}s`);
    return siblings;
  }
}

async function run() {
  const service = new MerkleTreeService();
  // Simulate current state: just a few leaves
  const leaves = [new Uint8Array(32), new Uint8Array(32)];

  console.log('--- Starting Reproduction V2 (Optimized Logic) ---');
  const start = Date.now();
  await service.computeSiblingsForIndex(leaves, 0, 20);
  console.log(`--- Total Duration: ${(Date.now() - start) / 1000}s ---`);
}

run();
