import { Injectable } from '@nestjs/common';
import { buildPoseidon } from 'circomlibjs';

type PoseidonFn = (arr: bigint[] | Uint8Array, state?: unknown, nOut?: number) => Uint8Array | Uint8Array[];

function bytesToBigInt(buf: Uint8Array): bigint {
  let hex = '';
  for (let i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, '0');
  return BigInt('0x' + hex);
}

function bigIntToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

@Injectable()
export class MerkleTreeService {
  private poseidonInstance: any = null;

  private async poseidon(inputs: bigint[]): Promise<bigint> {
    if (!this.poseidonInstance) {
      this.poseidonInstance = await buildPoseidon();
    }
    const outBytes = this.poseidonInstance(inputs);
    return this.poseidonInstance.F.toObject(outBytes);
  }

  /**
   * Compute a depth-20 Poseidon Merkle root over leaves using the same ordering as `merkleProof.circom`:
   * at each level, hash([left,right]) where left/right depend on the index bit.
   *
   * This is a fixed-depth tree with zero-leaf padding.
   */
  async computeRootFromLeaves(leavesBytes: Uint8Array[], depth = 20): Promise<Uint8Array> {
    const zero = 0n;
    let level: bigint[] = leavesBytes.map(bytesToBigInt);
    const targetSize = 1 << depth;
    if (level.length > targetSize) throw new Error(`Too many leaves for depth ${depth}`);
    while (level.length < targetSize) level.push(zero);

    for (let d = 0; d < depth; d++) {
      const next: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(await this.poseidon([level[i], level[i + 1]]));
      }
      level = next;
    }
    return bigIntToBytes32BE(level[0]);
  }

  /**
   * Compute Merkle siblings path for a leaf index in a fixed-depth tree (zero padded).
   * Returns `siblingsBytes[depth]` matching the circuit's `stateSiblings`.
   */
  async computeSiblingsForIndex(leavesBytes: Uint8Array[], leafIndex: number, depth = 20): Promise<Uint8Array[]> {
    const zero = 0n;
    const targetSize = 1 << depth;
    let level: bigint[] = leavesBytes.map(bytesToBigInt);
    if (leafIndex < 0 || leafIndex >= targetSize) throw new Error('leafIndex out of range');
    if (level.length > targetSize) throw new Error(`Too many leaves for depth ${depth}`);
    while (level.length < targetSize) level.push(zero);

    const siblings: Uint8Array[] = [];
    let idx = leafIndex;
    for (let d = 0; d < depth; d++) {
      const isRight = (idx & 1) === 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      siblings.push(bigIntToBytes32BE(level[sibIdx] ?? zero));

      // build next level
      const next: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(await this.poseidon([level[i], level[i + 1]]));
      }
      level = next;
      idx = idx >> 1;
    }
    return siblings;
  }

  /**
   * Recompute a root from (leaf,index,siblings) using the exact same ordering as the circuit.
   * Useful for validating we are generating correct paths.
   */
  async computeRootFromPath(leafBytes: Uint8Array, leafIndex: number, siblingsBytes: Uint8Array[]): Promise<Uint8Array> {
    let node = bytesToBigInt(leafBytes);
    let idx = leafIndex;
    for (let d = 0; d < siblingsBytes.length; d++) {
      const sib = bytesToBigInt(siblingsBytes[d]);
      const bit = idx & 1;
      const left = bit === 0 ? node : sib;
      const right = bit === 0 ? sib : node;
      node = await this.poseidon([left, right]);
      idx = idx >> 1;
    }
    return bigIntToBytes32BE(node);
  }
}

