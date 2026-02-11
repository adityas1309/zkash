/**
 * Commitment computation matching the circuit's CommitmentHasher:
 * precommitment = Poseidon(nullifier, secret)
 * commitment = Poseidon(value, label, precommitment)
 * Uses BLS12-381 scalar field Poseidon to match the compiled circuit.
 */

import { buildPoseidonBls12381 } from './poseidon-bls12381';

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
 */
export async function computeCommitment(fields: NoteFields): Promise<{
  commitmentBytes: Uint8Array;
  commitmentBigInt: bigint;
  nullifierHash: bigint;
  nullifierHashBytes: Uint8Array;
}> {
  const poseidon = await buildPoseidonBls12381();

  // 1. Nullifier Hash
  const nullifierHash = poseidon([fields.nullifier]) as bigint;
  const nullifierHashBytes = bigIntToBytes32BE(nullifierHash);

  // 2. Precommitment = Poseidon(nullifier, secret)
  const precommitmentBigInt = poseidon([fields.nullifier, fields.secret]) as bigint;

  // 3. Commitment = Poseidon(value, label, precommitment)
  const commitmentBigInt = poseidon([fields.value, fields.label, precommitmentBigInt]) as bigint;
  const commitmentBytes = bigIntToBytes32BE(commitmentBigInt);

  return { commitmentBytes, commitmentBigInt, nullifierHash, nullifierHashBytes };
}

/**
 * Convert commitment bigint to 32-byte form for contract deposit.
 */
export function commitmentToBytes(commitmentBigInt: bigint): Uint8Array {
  return bigIntToBytes32BE(commitmentBigInt);
}
