import { MerkleTreeService } from './apps/api/src/zk/merkle-tree.service';
import * as crypto from 'crypto';

async function test() {
  const t = new MerkleTreeService();
  const leaves = [crypto.randomBytes(32), crypto.randomBytes(32), crypto.randomBytes(32)];
  const root = await t.computeRootFromLeaves(leaves, 20);
  console.log('root:', Buffer.from(root).toString('hex'));
  for (let i = 0; i < leaves.length; i++) {
    const sibs = await t.computeSiblingsForIndex(leaves, i, 20);
    const pRoot = await t.computeRootFromPath(leaves[i], i, sibs);
    console.log('pRoot', i, ':', Buffer.from(pRoot).toString('hex'));
    if (!Buffer.from(root).equals(Buffer.from(pRoot))) throw new Error('Mismatch!');
  }
}
test().catch(console.error);
