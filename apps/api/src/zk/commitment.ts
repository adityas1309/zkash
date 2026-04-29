/**
 * Commitment computation matching the circuit's CommitmentHasher:
 *   precommitment = Poseidon(nullifier, secret)
 *   commitment = Poseidon(value, label, precommitment)
 *
 * This implementation uses BLS12-381 Poseidon via `poseidon-bls12381`,
 * keeping the same commitment/nullifier structure as the circuit.
 */

import { bigIntToBytes32BE, poseidonHash1, poseidonHash2, poseidonHash3 } from './poseidon-bls';

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
  // 1. Nullifier Hash: Poseidon(1)(nullifier)
  const nullifierHash = poseidonHash1(fields.nullifier);
  const nullifierHashBytes = bigIntToBytes32BE(nullifierHash);

  // 2. Precommitment: Poseidon(2)(nullifier, secret)
  const precommitmentBigInt = poseidonHash2(fields.nullifier, fields.secret);

  // 3. Commitment: Poseidon(3)(value, label, precommitment)
  const commitmentBigInt = poseidonHash3(fields.value, fields.label, precommitmentBigInt);
  const commitmentBytes = bigIntToBytes32BE(commitmentBigInt);

  return { commitmentBytes, commitmentBigInt, nullifierHash, nullifierHashBytes };
}

/**
 * Convert commitment bigint to 32-byte form for contract deposit.
 */
export function commitmentToBytes(commitmentBigInt: bigint): Uint8Array {
  return bigIntToBytes32BE(commitmentBigInt);
}
