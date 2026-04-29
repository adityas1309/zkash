const crypto = require('crypto');
const { MerkleTreeService } = require('./dist/zk/merkle-tree.service.js');

async function test() {
  const t = new MerkleTreeService();

  for (let len = 1; len <= 10; len++) {
    const leaves = [];
    for (let i = 0; i < len; i++) leaves.push(crypto.randomBytes(32));

    const root = await t.computeRootFromLeaves(leaves, 20);

    for (let i = 0; i < len; i++) {
      const sibs = await t.computeSiblingsForIndex(leaves, i, 20);
      const pRoot = await t.computeRootFromPath(leaves[i], i, sibs);
      if (!Buffer.from(root).equals(Buffer.from(pRoot))) {
        console.log(`Mismatch at len=${len}, idx=${i}`);
        console.log('root:', Buffer.from(root).toString('hex'));
        console.log('pRoot:', Buffer.from(pRoot).toString('hex'));
        process.exit(1);
      }
    }
  }
  console.log('All matching!');
}
test().catch(console.error);
