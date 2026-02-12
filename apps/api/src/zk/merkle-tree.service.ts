import { Injectable } from '@nestjs/common';
import {
    bigIntToBytes32BE,
    bytesToBigInt,
    poseidonHash2,
} from './poseidon-bls';

@Injectable()
export class MerkleTreeService {
    private zeros: bigint[] = [];

    constructor() {
        this.initZeros(32);
    }

    private initZeros(depth: number) {
        let current = 0n;
        this.zeros.push(current);
        for (let i = 1; i < depth; i++) {
            current = this.hashNode(current, current);
            this.zeros.push(current);
        }
    }

    /**
     * Poseidon(2) over BLS12-381 for internal Merkle node hashing.
     */
    private hashNode(left: bigint, right: bigint): bigint {
        return poseidonHash2(left, right);
    }

    /**
     * Compute a depth-20 Poseidon Merkle root over leaves using the same ordering as `merkleProof.circom`:
     * at each level, hash([left,right]) where left/right depend on the index bit.
     *
     * Optimized to use sparse tree logic (implicit zeros).
     */
    async computeRootFromLeaves(leavesBytes: Uint8Array[], depth = 20): Promise<Uint8Array> {
        let level: bigint[] = leavesBytes.map(bytesToBigInt);

        // Ensure zeros are precomputed enough
        if (this.zeros.length <= depth) {
            this.initZeros(depth + 1);
        }

        for (let d = 0; d < depth; d++) {
            // If odd number of nodes, pair the last one with the zero at this depth
            if (level.length % 2 !== 0) {
                level.push(this.zeros[d]);
            }

            const next: bigint[] = [];
            for (let i = 0; i < level.length; i += 2) {
                next.push(this.hashNode(level[i], level[i + 1]));
            }
            level = next;
        }

        // If the level is empty (no leaves originally), the root is equivalent to zeros[depth]
        // But our logic naturally handles it if we start with []. 
        // Wait, if level is [], level.length is 0. Loop doesn't run. keys are empty.
        // We need to return zeros[depth] if empty.
        if (level.length === 0) {
            return bigIntToBytes32BE(this.zeros[depth]);
        }

        return bigIntToBytes32BE(level[0]);
    }

    /**
     * Compute Merkle siblings path for a leaf index in a fixed-depth tree (zero padded).
     * Returns `siblingsBytes[depth]` matching the circuit's `stateSiblings`.
     * 
     * Optimized to use sparse tree logic.
     */
    async computeSiblingsForIndex(leavesBytes: Uint8Array[], leafIndex: number, depth = 20): Promise<Uint8Array[]> {
        let level: bigint[] = leavesBytes.map(bytesToBigInt);

        // Ensure zeros are precomputed
        if (this.zeros.length <= depth) {
            this.initZeros(depth + 1);
        }

        const targetSize = 1 << depth;
        // Basic range check (conceptual)
        if (leafIndex < 0 || leafIndex >= targetSize) throw new Error('leafIndex out of range');

        const siblings: Uint8Array[] = [];
        let idx = leafIndex;

        for (let d = 0; d < depth; d++) {
            const isRight = (idx & 1) === 1;
            const sibIdx = isRight ? idx - 1 : idx + 1;

            // Resolve sibling
            if (sibIdx < level.length) {
                siblings.push(bigIntToBytes32BE(level[sibIdx]));
            } else {
                siblings.push(bigIntToBytes32BE(this.zeros[d]));
            }

            // Prepare next level
            if (level.length % 2 !== 0) {
                level.push(this.zeros[d]);
            }

            const next: bigint[] = [];
            for (let i = 0; i < level.length; i += 2) {
                next.push(this.hashNode(level[i], level[i + 1]));
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
            node = this.hashNode(left, right);
            idx = idx >> 1;
        }
        return bigIntToBytes32BE(node);
    }
}

