import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import * as StellarSdk from '@stellar/stellar-sdk';
import { MerkleTreeService } from './zk/merkle-tree.service';
import { getContractAddress } from './network.context';

// Minimal SorobanService for getting root/leaves
class SimpleSorobanService {
  private server: StellarSdk.rpc.Server;
  private networkPassphrase;

  constructor() {
    const rpcUrl = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = StellarSdk.Networks.TESTNET;
    this.server = new StellarSdk.rpc.Server(rpcUrl);
  }

  private scValToBytes32Array(retval: StellarSdk.xdr.ScVal): Uint8Array[] {
    const switchName = retval.switch().name;
    if (switchName !== 'scvVec') throw new Error(`Unexpected retval type: ${switchName}`);
    const vec = retval.vec();
    if (!vec) return [];
    const out: Uint8Array[] = [];
    for (const el of vec) {
      const elSwitch = el.switch().name as string;
      if (elSwitch === 'scvBytes') {
        out.push(new Uint8Array(el.bytes()));
        continue;
      }
      if (elSwitch === 'scvBytesN') {
        const bn = (el as unknown as { bytesN: () => Uint8Array }).bytesN();
        out.push(new Uint8Array(bn));
        continue;
      }
      throw new Error(`Unexpected vec element type: ${elSwitch}`);
    }
    return out;
  }

  async getMerkleRoot(poolContractId: string, signerPublicKey: string): Promise<Uint8Array> {
    const contract = new StellarSdk.Contract(poolContractId);
    const sourceAccount = await this.server.getAccount(signerPublicKey);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_merkle_root'))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    // @ts-ignore
    if ('error' in sim && sim.error) throw new Error(String(sim.error));
    // @ts-ignore
    const result = 'result' in sim ? sim.result : undefined;
    if (!result?.retval) throw new Error('No result from get_merkle_root');

    const retval = result.retval;
    const switchName = retval.switch().name;
    if (switchName === 'scvVec') {
      // ... (copy from service if needed, but root is usually scvBytes or scvBytesN)
      // Actually root usually returns BytesN<32> which is scvBytesN?
      // Let's assume scvBytes for simplicity or check
      const vec = retval.vec();
      if (!vec || vec.length === 0) throw new Error('Empty vec from get_merkle_root');
      const out = new Uint8Array(vec.length);
      for (let i = 0; i < vec.length; i++) {
        const el = vec[i];
        // ... simplified handling
        // But root is BYTESN<32>.
        // scVal returns scvBytes if encoding matches.
      }
    }
    if (switchName === 'scvBytes') {
      return new Uint8Array(retval.bytes());
    }
    if ((switchName as string) === 'scvBytesN') {
      // SDK usually unwraps this?
      // @ts-ignore
      return new Uint8Array(retval.bytesN());
    }
    throw new Error(`Unexpected get_merkle_root retval type: ${switchName}`);
  }

  async getCommitments(poolContractId: string, signerPublicKey: string): Promise<Uint8Array[]> {
    const contract = new StellarSdk.Contract(poolContractId);
    const sourceAccount = await this.server.getAccount(signerPublicKey);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_commitments'))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    // @ts-ignore
    if ('error' in sim && sim.error) throw new Error(String(sim.error));
    // @ts-ignore
    const result = 'result' in sim ? sim.result : undefined;
    if (!result?.retval) throw new Error('No result from get_commitments');

    return this.scValToBytes32Array(result.retval);
  }
}

async function main() {
  const poolAddress = getContractAddress('SHIELDED_POOL_ADDRESS');
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  if (!poolAddress || !adminSecret) {
    console.error('Missing env vars');
    return;
  }

  const kp = StellarSdk.Keypair.fromSecret(adminSecret);
  const publicKey = kp.publicKey();

  console.log(`Checking pool: ${poolAddress}`);
  console.log(`Using account: ${publicKey}`);

  const soroban = new SimpleSorobanService();
  const merkle = new MerkleTreeService();

  try {
    console.log('Fetching root...');
    const root = await soroban.getMerkleRoot(poolAddress, publicKey);
    console.log('Fetching leaves...');
    const leaves = await soroban.getCommitments(poolAddress, publicKey);

    console.log(`\nOn-Chain Root: ${Buffer.from(root).toString('hex')}`);
    console.log(`Leaves Count: ${leaves.length}`);

    const computed = await merkle.computeRootFromLeaves(leaves, 20);
    console.log(`Computed Root: ${Buffer.from(computed).toString('hex')}`);

    if (Buffer.from(root).equals(Buffer.from(computed))) {
      console.log('\n✅ MATCH! The tree is consistent.');
    } else {
      console.log('\n❌ MISMATCH!');
      leaves.forEach((l, i) => {
        console.log(`Leaf ${i}: ${Buffer.from(l).toString('hex')}`);
      });
    }
  } catch (e) {
    console.error('Error:', e);
  }
}

main();
