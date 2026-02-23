const crypto = require('crypto');

const BLS12_381_FIELD_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
function normalizeToField(x) {
    let r = x % BLS12_381_FIELD_MODULUS;
    if (r < 0) r += BLS12_381_FIELD_MODULUS;
    return r;
}
function bytesToBigInt(buf) {
    let hex = '';
    for (let i = 0; i < buf.length; i++) {
        hex += buf[i].toString(16).padStart(2, '0');
    }
    return BigInt('0x' + hex);
}
function bigIntToBytes32BE(n) {
    const hex = normalizeToField(n).toString(16).padStart(64, '0');
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

// Simple dummy hash for test
function poseidonHash2(x, y) {
    return normalizeToField(x * 3n + y * 7n);
}

class MerkleTreeService {
    constructor() {
        this.zeros = [];
        this.initZeros(32);
    }
    initZeros(depth) {
        let current = 0n;
        this.zeros.push(current);
        for (let i = 1; i < depth; i++) {
            current = poseidonHash2(current, current);
            this.zeros.push(current);
        }
    }
    hashNode(left, right) {
        return poseidonHash2(left, right);
    }
    async computeRootFromLeaves(leavesBytes, depth = 20) {
        let level = leavesBytes.map(bytesToBigInt);
        if (this.zeros.length <= depth) this.initZeros(depth + 1);
        for (let d = 0; d < depth; d++) {
            if (level.length % 2 !== 0) level.push(this.zeros[d]);
            const next = [];
            for (let i = 0; i < level.length; i += 2) {
                next.push(this.hashNode(level[i], level[i + 1]));
            }
            level = next;
        }
        if (level.length === 0) return bigIntToBytes32BE(this.zeros[depth]);
        return bigIntToBytes32BE(level[0]);
    }
    async computeSiblingsForIndex(leavesBytes, leafIndex, depth = 20) {
        let level = leavesBytes.map(bytesToBigInt);
        if (this.zeros.length <= depth) this.initZeros(depth + 1);
        const siblings = [];
        let idx = leafIndex;
        for (let d = 0; d < depth; d++) {
            const isRight = (idx & 1) === 1;
            const sibIdx = isRight ? idx - 1 : idx + 1;
            if (sibIdx < level.length) siblings.push(bigIntToBytes32BE(level[sibIdx]));
            else siblings.push(bigIntToBytes32BE(this.zeros[d]));

            if (level.length % 2 !== 0) level.push(this.zeros[d]);
            const next = [];
            for (let i = 0; i < level.length; i += 2) {
                next.push(this.hashNode(level[i], level[i + 1]));
            }
            level = next;
            idx = idx >> 1;
        }
        return siblings;
    }
    async computeRootFromPath(leafBytes, leafIndex, siblingsBytes) {
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
                process.exit(1);
            }
        }
    }
    console.log("ALL OK");
}
test();
