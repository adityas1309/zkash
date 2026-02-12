/**
 * Serialize SnarkJS Groth16 proof and verification key to the byte format
 * expected by the Soroban BLS12-381 Groth16 verifier contract.
 * All coordinates as 48-byte big-endian; G1 = 96 bytes, G2 = 192 bytes.
 */

const FR_SIZE = 32;
const G1_SIZE = 96;  // 48 * 2
const G2_SIZE = 192; // 48 * 4

function bigIntToBytes48BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(96, '0');
  const out = new Uint8Array(48);
  for (let i = 0; i < 48; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Keep 32 bytes for public signals (Fr)
function bigIntToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function parsePoint(arr: unknown): bigint[] {
  if (!Array.isArray(arr)) throw new Error('Expected array');
  const flat = (arr as any[]).flat(Infinity);
  return flat.map((x) => (typeof x === 'string' ? BigInt(x) : BigInt(String(x))));
}

/** Proof from snarkjs fullProve: { pi_a, pi_b, pi_c, protocol, curve } */
export interface SnarkJsProof {
  pi_a: unknown;
  pi_b: unknown;
  pi_c: unknown;
}

/** Verification key from snarkjs zkey export verificationkey */
export interface SnarkJsVk {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: unknown;
  vk_beta_2: unknown;
  vk_gamma_2: unknown;
  vk_delta_2: unknown;
  vk_alphabeta_12?: unknown;
  IC: unknown[];
}

/**
 * Convert SnarkJS proof to proof_bytes (384 bytes: a || b || c)
 */
export function proofToBytes(proof: SnarkJsProof): Uint8Array {
  const a = parsePoint(proof.pi_a);
  const b = parsePoint(proof.pi_b);
  const c = parsePoint(proof.pi_c);
  if (a.length < 2 || c.length < 2) throw new Error('G1 must have at least 2 coordinates');
  if (b.length < 4) throw new Error('G2 must have at least 4 coordinates');
  const out = new Uint8Array(G1_SIZE + G2_SIZE + G1_SIZE);
  let off = 0;
  for (const x of [a[0], a[1]]) {
    out.set(bigIntToBytes48BE(x), off);
    off += 48;
  }
  // G2: SnarkJS [c0, c1] -> BLS12-381/BLST [c1, c0] (Descending order)
  // b is [x_c0, x_c1, y_c0, y_c1]
  // We want: x_c1, x_c0, y_c1, y_c0
  const bOrdered = [b[1], b[0], b[3], b[2]];
  console.warn('[SDK] Processing G2 Point (Proof.B):');
  console.warn(`[SDK] Original: x_c0=${b[0]}, x_c1=${b[1]}`);
  console.warn(`[SDK] Swapped:  x_c1=${bOrdered[0]}, x_c0=${bOrdered[1]}`);

  for (let i = 0; i < 4; i++) {
    out.set(bigIntToBytes48BE(bOrdered[i]), off);
    off += 48;
  }
  for (const x of [c[0], c[1]]) {
    out.set(bigIntToBytes48BE(x), off);
    off += 48;
  }
  return out;
}

/**
 * Convert public signals to pub_signals_bytes (each signal 32 bytes BE)
 */
export function publicSignalsToBytes(publicSignals: (string | number)[]): Uint8Array {
  const out = new Uint8Array(publicSignals.length * FR_SIZE);
  for (let i = 0; i < publicSignals.length; i++) {
    const n = typeof publicSignals[i] === 'string' ? BigInt(publicSignals[i]) : BigInt(publicSignals[i]);
    out.set(bigIntToBytes32BE(n), i * FR_SIZE);
  }
  return out;
}

/**
 * Convert verification key to vk_bytes for the contract.
 * Layout: alpha(96) || beta(192) || gamma(192) || delta(192) || ic[0..](96 each)
 */
export function vkToBytes(vk: SnarkJsVk): Uint8Array {
  const alpha = parsePoint(vk.vk_alpha_1);
  const beta = parsePoint(vk.vk_beta_2);
  const gamma = parsePoint(vk.vk_gamma_2);
  const delta = parsePoint(vk.vk_delta_2);
  if (alpha.length < 2) throw new Error('vk_alpha_1 must be G1');
  if (beta.length < 4 || gamma.length < 4 || delta.length < 4) throw new Error('vk beta/gamma/delta must be G2');
  const nPub = vk.nPublic;
  const icLen = (vk.IC?.length ?? 0);
  if (icLen !== nPub + 1) throw new Error('IC length must be nPublic + 1');
  const size = G1_SIZE + G2_SIZE * 3 + icLen * G1_SIZE;
  const out = new Uint8Array(size);
  let off = 0;
  for (const x of [alpha[0], alpha[1]]) {
    out.set(bigIntToBytes48BE(x), off);
    off += 48;
  }
  for (const arr of [beta, gamma, delta]) {
    // G2: Swap c0/c1 -> [c1, c0]
    // arr is [x_c0, x_c1, y_c0, y_c1]
    const g2Ordered = [arr[1], arr[0], arr[3], arr[2]];
    for (let i = 0; i < 4; i++) {
      out.set(bigIntToBytes48BE(g2Ordered[i]), off);
      off += 48;
    }
  }
  for (const pt of vk.IC!) {
    const g1 = parsePoint(pt);
    if (g1.length < 2) throw new Error('IC point must be G1');
    for (const x of [g1[0], g1[1]]) {
      out.set(bigIntToBytes48BE(x), off);
      off += 48;
    }
  }
  return out;
}

export function proofToSorobanBytes(
  proof: SnarkJsProof,
  vk: SnarkJsVk,
  publicSignals: (string | number)[]
): { proofBytes: Uint8Array; pubSignalsBytes: Uint8Array; vkBytes: Uint8Array } {
  return {
    proofBytes: proofToBytes(proof),
    pubSignalsBytes: publicSignalsToBytes(publicSignals),
    vkBytes: vkToBytes(vk),
  };
}
