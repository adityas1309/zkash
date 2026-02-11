/**
 * ZK proof generation for the Withdraw circuit.
 * Uses WASM witness calculator + snarkjs fullProve; serializes with SDK for Soroban.
 */

import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { proofToBytes, publicSignalsToBytes, type SnarkJsProof } from 'sdk';
import { MerkleTreeService } from './merkle-tree.service';

export interface NoteForProof {
  label: bigint;
  value: bigint;
  nullifier: bigint;
  secret: bigint;
}

function bytesToBigInt(buf: Uint8Array): bigint {
  let hex = '';
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
}

function bigIntToBytes32Hex(n: bigint): string {
  const hex = n.toString(16).padStart(64, '0');
  return hex;
}

@Injectable()
export class ProofService {
  private wasmPath: string;
  private zkeyPath: string;

  constructor(private merkleTree: MerkleTreeService) {
    this.wasmPath = this.resolveCircuitPath(
      process.env.CIRCUIT_WASM_PATH,
      ['packages', 'circuits', 'private_transfer', 'build', 'main_js', 'main.wasm']
    );
    this.zkeyPath = this.resolveCircuitPath(
      process.env.CIRCUIT_ZKEY_PATH,
      ['packages', 'circuits', 'private_transfer', 'output', 'main_final.zkey']
    );
  }

  private resolveCircuitPath(envPath: string | undefined, defaultSegments: string[]): string {
    // 1. Use env path if set, otherwise default relative path
    const candidate = envPath ?? path.join(...defaultSegments);

    // 2. If absolute, return as is
    if (path.isAbsolute(candidate)) {
      return candidate;
    }

    // 3. Try relative to CWD (e.g., if run from root)
    const fromCwd = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(fromCwd)) {
      return fromCwd;
    }

    // 4. Try from workspace root (assuming CWD is apps/api => go up 2 levels)
    // This fixes the issue when running 'pnpm dev' inside apps/api
    const fromUp2 = path.resolve(process.cwd(), '../..', candidate);
    if (fs.existsSync(fromUp2)) {
      return fromUp2;
    }

    // 5. Return fromCwd as fallback (will throw "Not Found" later with clear path)
    return fromCwd;
  }

  /**
   * Generate Groth16 proof for Withdraw circuit.
   * @param note - spendable note (label, value, nullifier, secret)
   * @param stateRoot - current pool merkle root (32 bytes)
   * @param withdrawnValue - amount to withdraw (must match ShieldedPool FIXED_AMOUNT)
   */
  async generateProof(
    note: NoteForProof,
    stateRoot: Uint8Array,
    withdrawnValue: bigint,
    opts?: {
      /** Commitment bytes (leaf) for merkle inclusion. */
      commitmentBytes?: Uint8Array;
      /** Leaf index in the pool commitment tree. */
      stateIndex?: number;
      /** Siblings (depth 20) for the leaf. */
      stateSiblings?: Uint8Array[];
    },
  ): Promise<{ proofBytes: Uint8Array; pubSignalsBytes: Uint8Array; nullifierHex: string }> {
    if (stateRoot.length !== 32) throw new Error('stateRoot must be 32 bytes');

    const stateRootBigInt = bytesToBigInt(stateRoot);
    const associationRoot = 0n;
    const labelIndex = 0;
    const labelSiblings = ['0', '0'];

    if (!opts?.stateSiblings || opts.stateSiblings.length !== 20) {
      throw new Error('stateSiblings (20) required for Withdraw proof');
    }
    if (opts.stateIndex === undefined || opts.stateIndex === null) {
      throw new Error('stateIndex required for Withdraw proof');
    }
    const stateSiblings = opts.stateSiblings.map((b) => bytesToBigInt(b).toString());
    const stateIndex = opts.stateIndex;

    // Optional sanity check: recompute root from path.
    if (opts.commitmentBytes) {
      const recomputed = await this.merkleTree.computeRootFromPath(opts.commitmentBytes, stateIndex, opts.stateSiblings);
      const ok = Buffer.from(recomputed).equals(Buffer.from(stateRoot));
      console.log(`[ProofService] Sanity Check: ${ok ? 'PASS' : 'FAIL'}`);
      console.log(`[ProofService] Exepcted Root (Soroban): ${Buffer.from(stateRoot).toString('hex')}`);
      console.log(`[ProofService] Recomputed Root (Local): ${Buffer.from(recomputed).toString('hex')}`);
      console.log(`[ProofService] Commitment: ${Buffer.from(opts.commitmentBytes).toString('hex')}`);

      if (!ok) {
        throw new Error('Merkle path does not match stateRoot (commitment/index/siblings mismatch)');
      }
    } else {
      console.log('[ProofService] Skipping sanity check (no commitmentBytes provided)');
    }

    const input = {
      withdrawnValue: withdrawnValue.toString(),
      stateRoot: stateRootBigInt.toString(),
      associationRoot: associationRoot.toString(),
      label: note.label.toString(),
      value: note.value.toString(),
      nullifier: note.nullifier.toString(),
      secret: note.secret.toString(),
      stateSiblings,
      stateIndex: stateIndex.toString(),
      labelIndex: labelIndex.toString(),
      labelSiblings,
    };

    console.log('[ProofService] Input to Witness:', JSON.stringify(input, null, 2));

    if (!fs.existsSync(this.wasmPath)) {
      throw new Error(`WASM not found at ${this.wasmPath}. Run: pnpm run build (in packages/circuits)`);
    }
    if (!fs.existsSync(this.zkeyPath)) {
      throw new Error(`zkey not found at ${this.zkeyPath}. Run: pnpm run setup (in packages/circuits)`);
    }

    const snarkjs = await import('snarkjs');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      this.wasmPath,
      this.zkeyPath,
    );

    const proofBytes = proofToBytes(proof as SnarkJsProof);
    const pubSignalsBytes = publicSignalsToBytes(publicSignals);
    const nullifierHex = bigIntToBytes32Hex(note.nullifier);

    return { proofBytes, pubSignalsBytes, nullifierHex };
  }
}
