/**
 * Commitment computation matching the circuit's CommitmentHasher:
 * precommitment = Poseidon(nullifier, secret)
 * commitment = Poseidon(value, label, precommitment)
 * Uses circomlibjs Poseidon (BN254 scalar field).
 */

import { buildPoseidon } from 'circomlibjs';

interface PoseidonFn {
  (arr: bigint[] | Uint8Array, state?: unknown, nOut?: number): Uint8Array;
  F: {
    toObject: (bytes: Uint8Array | Uint8Array[]) => bigint;
    e: (x: bigint | string) => any;
    [key: string]: any;
  };
}

let poseidonInstance: PoseidonFn | null = null;

async function getPoseidon(): Promise<PoseidonFn> {
  if (!poseidonInstance) {
    poseidonInstance = (await buildPoseidon()) as unknown as PoseidonFn;
  }
  return poseidonInstance;
}

function bytesToBigInt(buf: Uint8Array): bigint {
  let hex = '';
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
}

function bigIntToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Field elements as bigint (or number for small values). */
export interface NoteFields {
  value: bigint;
  label: bigint;
  nullifier: bigint;
  secret: bigint;
}

/**
 * Compute commitment and nullifier hash matching the circuit.
 * circomlibjs poseidon returns 32-byte buffer for single output.
 */
export async function computeCommitment(fields: NoteFields): Promise<{
  commitmentBytes: Uint8Array;
  commitmentBigInt: bigint;
  nullifierHash: bigint;
  nullifierHashBytes: Uint8Array;
}> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  // Helper to convert Poseidon output (Uint8Array) to BigInt via Field Element
  // This matches circom/snarkjs behavior: interpreting the array as a LE number (Mont form handled by F)
  const toBigInt = (bytes: Uint8Array) => F.toObject(bytes);

  // 1. Nullifier Hash
  const nullifierHashBytesLE = poseidon([fields.nullifier]);
  const nullifierHash = toBigInt(nullifierHashBytesLE);
  const nullifierHashBytes = bigIntToBytes32BE(nullifierHash);

  // 2. Precommitment
  const precommitmentBytesLE = poseidon([fields.nullifier, fields.secret]);
  const precommitmentBigInt = toBigInt(precommitmentBytesLE);

  // 3. Commitment
  const commitmentBytesLE = poseidon([fields.value, fields.label, precommitmentBigInt]);
  const commitmentBigInt = toBigInt(commitmentBytesLE);
  const commitmentBytes = bigIntToBytes32BE(commitmentBigInt);

  return { commitmentBytes, commitmentBigInt, nullifierHash, nullifierHashBytes };
}

/**
 * Convert commitment bigint to 32-byte form for contract deposit.
 */
export function commitmentToBytes(commitmentBigInt: bigint): Uint8Array {
  return bigIntToBytes32BE(commitmentBigInt);
}
