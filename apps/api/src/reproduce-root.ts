import { MerkleTreeService } from './zk/merkle-tree.service';

/*
On-Chain Root: 45e2e6d5a6459e1a769c58edb916ed89a93a5ea13e40f00a8c1be4a3013e8b01
Leaves:
Leaf 0: 11acf32a1929dcdcc0659bcfed3243ae0a295c526882928da14eb8f06950e07a
Leaf 1: 4abc3254a52bd0c49a473f684c8ba04000fae2587685a905598b1babc50052f9

Computed Root: 4146efe30685cbf0cab4043343a8c752d8338f02ec767e69605e85128ababc44
*/

async function main() {
  const service = new MerkleTreeService();

  // Hex strings from logs
  const leaf0Hex = '11acf32a1929dcdcc0659bcfed3243ae0a295c526882928da14eb8f06950e07a';
  const leaf1Hex = '4abc3254a52bd0c49a473f684c8ba04000fae2587685a905598b1babc50052f9';

  const leaf0 = new Uint8Array(Buffer.from(leaf0Hex, 'hex'));
  const leaf1 = new Uint8Array(Buffer.from(leaf1Hex, 'hex'));

  const leaves = [leaf0, leaf1];

  console.log('Computing root for 2 leaves...');
  const root = await service.computeRootFromLeaves(leaves, 20); // Standard circuit depth

  console.log(`Computed: ${Buffer.from(root).toString('hex')}`);
  console.log(
    `Expected (On-Chain): 45e2e6d5a6459e1a769c58edb916ed89a93a5ea13e40f00a8c1be4a3013e8b01`,
  );

  // Test Hypothesis: Was the second deposit calculated as if it was the FIRST/ONLY leaf?
  console.log('\n--- Hypothesis Testing ---');

  // Case 1: Just Leaf 0
  let r = await service.computeRootFromLeaves([leaf0], 20);
  console.log(`Root([leaf0]): ${Buffer.from(r).toString('hex')}`);
  if (
    Buffer.from(r).toString('hex') ===
    '45e2e6d5a6459e1a769c58edb916ed89a93a5ea13e40f00a8c1be4a3013e8b01'
  )
    console.log('MATCH!');

  // Case 2: Just Leaf 1 (at index 0)
  r = await service.computeRootFromLeaves([leaf1], 20);
  console.log(`Root([leaf1]): ${Buffer.from(r).toString('hex')}`);
  if (
    Buffer.from(r).toString('hex') ===
    '45e2e6d5a6459e1a769c58edb916ed89a93a5ea13e40f00a8c1be4a3013e8b01'
  )
    console.log('MATCH!');

  // Case 3: Leaf 0 and Leaf 1 but swapped?
  r = await service.computeRootFromLeaves([leaf1, leaf0], 20);
  console.log(`Root([leaf1, leaf0]): ${Buffer.from(r).toString('hex')}`);
  if (
    Buffer.from(r).toString('hex') ===
    '45e2e6d5a6459e1a769c58edb916ed89a93a5ea13e40f00a8c1be4a3013e8b01'
  )
    console.log('MATCH!');

  // Case 4: Leaf 0, then Zero, then Leaf 1? (Sparse)
  // service doesn't support sparse directly via array, but we can try [leaf0, zero, leaf1] if we want, but computeRootFromLeaves takes dense array.

  // Brute force depths
  for (let d = 1; d <= 32; d++) {
    const r = await service.computeRootFromLeaves(leaves, d);
    const hex = Buffer.from(r).toString('hex');
    if (hex === '45e2e6d5a6459e1a769c58edb916ed89a93a5ea13e40f00a8c1be4a3013e8b01') {
      console.log(`\n!!! FOUND MATCH AT DEPTH ${d} !!!`);
      console.log(hex);
      return;
    } else {
      // console.log(`Depth ${d}: ${hex}`);
    }
  }
  console.log('\nNo match found in depths 1-32.');
}

main();
