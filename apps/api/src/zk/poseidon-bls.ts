import { poseidon1, poseidon2, poseidon3 } from 'poseidon-bls12381';

/** BLS12-381 scalar field modulus (Fr). */
export const BLS12_381_FIELD_MODULUS =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** Reduce a bigint into the BLS12-381 field. */
export function normalizeToField(x: bigint): bigint {
  let r = x % BLS12_381_FIELD_MODULUS;
  if (r < 0) r += BLS12_381_FIELD_MODULUS;
  return r;
}

/** Convert a 32-byte big-endian buffer to bigint. */
export function bytesToBigInt(buf: Uint8Array): bigint {
  let hex = '';
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
}

/** Serialize a field element as 32-byte big-endian. */
export function bigIntToBytes32BE(n: bigint): Uint8Array {
  const hex = normalizeToField(n).toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Poseidon(1) over BLS12-381, returns field element as bigint. */
export function poseidonHash1(x: bigint): bigint {
  return poseidon1([normalizeToField(x)]);
}

/** Poseidon(2) over BLS12-381, returns field element as bigint. */
export function poseidonHash2(x: bigint, y: bigint): bigint {
  return poseidon2([normalizeToField(x), normalizeToField(y)]);
}

/** Poseidon(3) over BLS12-381, returns field element as bigint. */
export function poseidonHash3(x: bigint, y: bigint, z: bigint): bigint {
  return poseidon3([
    normalizeToField(x),
    normalizeToField(y),
    normalizeToField(z),
  ]);
}

