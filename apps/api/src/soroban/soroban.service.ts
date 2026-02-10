import { Injectable } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';

@Injectable()
export class SorobanService {
  private server: StellarSdk.rpc.Server;
  private networkPassphrase: string;

  constructor() {
    const rpcUrl = process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = process.env.NETWORK_PASSPHRASE ?? StellarSdk.Networks.TESTNET;
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
      // BytesN<32> in Vec may be represented as scvBytesN (SDK typing omits this)
      if (elSwitch === 'scvBytesN') {
        const bn = (el as unknown as { bytesN: () => Uint8Array }).bytesN();
        out.push(new Uint8Array(bn));
        continue;
      }
      throw new Error(`Unexpected vec element type: ${elSwitch}`);
    }
    return out;
  }

  /**
   * Read ShieldedPool get_merkle_root (simulate contract call).
   * Returns 32-byte root for proof generation.
   */
  async getMerkleRoot(poolContractId: string, signerPublicKey: string): Promise<Uint8Array> {
    const contract = new StellarSdk.Contract(poolContractId);
    // Use the caller's actual funded account for building the transaction
    const sourceAccount = await this.server.getAccount(signerPublicKey);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_merkle_root'))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if ('error' in sim && sim.error) throw new Error(String(sim.error));
    const result = 'result' in sim ? sim.result : undefined;
    if (!result?.retval) throw new Error('No result from get_merkle_root');

    const retval = result.retval;
    const switchName = retval.switch().name;
    if (switchName === 'scvVec') {
      const vec = retval.vec();
      if (!vec || vec.length === 0) throw new Error('Empty vec from get_merkle_root');
      const out = new Uint8Array(vec.length);
      for (let i = 0; i < vec.length; i++) {
        const el = vec[i];
        const elSwitch = el.switch().name;
        if (elSwitch === 'scvU32') out[i] = Number((el as { u32(): unknown }).u32());
        else if (elSwitch === 'scvU64') out[i] = Number(Number((el as { u64(): { low: number } }).u64().low) & 0xff);
        else throw new Error(`Unexpected ScVal element in merkle root vec: ${elSwitch}`);
      }
      return out;
    }
    if (switchName === 'scvBytes') {
      const buf = retval.bytes();
      return new Uint8Array(buf);
    }
    throw new Error(`Unexpected get_merkle_root retval type: ${switchName}`);
  }

  /**
   * Read ShieldedPool get_commitments (simulate contract call).
   * Returns commitments as 32-byte leaves in insertion order.
   */
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
    if ('error' in sim && sim.error) throw new Error(String(sim.error));
    const result = 'result' in sim ? sim.result : undefined;
    if (!result?.retval) throw new Error('No result from get_commitments');

    return this.scValToBytes32Array(result.retval);
  }

  /**
   * Invoke ShieldedPool.deposit(from, commitment, new_root).
   * Signer must be `from`; transfers FIXED_AMOUNT (1 token) to the pool.
   */
  async invokeShieldedPoolDeposit(
    poolContractId: string,
    signerSecretKey: string,
    commitmentBytes: Uint8Array,
    newRootBytes: Uint8Array,
  ): Promise<string> {
    if (commitmentBytes.length !== 32) throw new Error('Commitment must be 32 bytes');
    if (newRootBytes.length !== 32) throw new Error('newRoot must be 32 bytes');

    const keypair = StellarSdk.Keypair.fromSecret(signerSecretKey);
    const sourceAccount = await this.server.getAccount(keypair.publicKey());
    const contract = new StellarSdk.Contract(poolContractId);

    const args = [
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(keypair.publicKey())),
      StellarSdk.nativeToScVal(commitmentBytes),
      StellarSdk.nativeToScVal(newRootBytes),
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('deposit', ...args))
      .setTimeout(180)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(keypair);
    const result = await this.server.sendTransaction(prepared);
    if (result.status === 'ERROR') {
      throw new Error(String(result.errorResult ?? 'Transaction failed'));
    }
    return result.hash;
  }

  /**
   * Invoke ShieldedPool.withdraw(to, proof_bytes, pub_signals_bytes, nullifier).
   * Signer must be `to` (recipient).
   */
  async invokeShieldedPoolWithdraw(
    poolContractId: string,
    signerSecretKey: string,
    toAddress: string,
    proofBytes: Uint8Array,
    pubSignalsBytes: Uint8Array,
    nullifierBytes: Uint8Array,
  ): Promise<string> {
    if (nullifierBytes.length !== 32) throw new Error('Nullifier must be 32 bytes');

    const keypair = StellarSdk.Keypair.fromSecret(signerSecretKey);
    const sourceAccount = await this.server.getAccount(keypair.publicKey());
    const contract = new StellarSdk.Contract(poolContractId);

    const args = [
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(toAddress)),
      StellarSdk.nativeToScVal(proofBytes),
      StellarSdk.nativeToScVal(pubSignalsBytes),
      StellarSdk.nativeToScVal(nullifierBytes),
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('withdraw', ...args))
      .setTimeout(180)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(keypair);
    const result = await this.server.sendTransaction(prepared);
    if (result.status === 'ERROR') {
      throw new Error(String(result.errorResult ?? 'Transaction failed'));
    }
    return result.hash;
  }

  /**
   * Invoke ZKSwap.execute. Both alice and bob must sign the transaction.
   */
  async invokeZkSwapExecute(
    zkSwapContractId: string,
    aliceSecretKey: string,
    bobSecretKey: string,
    aliceAddress: string,
    bobAddress: string,
    usdcPoolAddress: string,
    xlmPoolAddress: string,
    amountUsdc: string,
    amountXlm: string,
    aliceProof: Uint8Array,
    alicePubSignals: Uint8Array,
    aliceNullifier: Uint8Array,
    bobProof: Uint8Array,
    bobPubSignals: Uint8Array,
    bobNullifier: Uint8Array,
  ): Promise<string> {
    const aliceKp = StellarSdk.Keypair.fromSecret(aliceSecretKey);
    const bobKp = StellarSdk.Keypair.fromSecret(bobSecretKey);
    const sourceAccount = await this.server.getAccount(aliceKp.publicKey());
    const contract = new StellarSdk.Contract(zkSwapContractId);

    const paramsSc = StellarSdk.xdr.ScVal.scvMap([
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('usdc_pool'),
        val: StellarSdk.nativeToScVal(StellarSdk.Address.fromString(usdcPoolAddress)),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('xlm_pool'),
        val: StellarSdk.nativeToScVal(StellarSdk.Address.fromString(xlmPoolAddress)),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('amount_usdc'),
        val: StellarSdk.nativeToScVal(BigInt(amountUsdc)),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('amount_xlm'),
        val: StellarSdk.nativeToScVal(BigInt(amountXlm)),
      }),
    ]);

    const args = [
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(aliceAddress)),
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(bobAddress)),
      paramsSc,
      StellarSdk.nativeToScVal(aliceProof),
      StellarSdk.nativeToScVal(alicePubSignals),
      StellarSdk.nativeToScVal(aliceNullifier),
      StellarSdk.nativeToScVal(bobProof),
      StellarSdk.nativeToScVal(bobPubSignals),
      StellarSdk.nativeToScVal(bobNullifier),
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('execute', ...args))
      .setTimeout(180)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(aliceKp);
    prepared.sign(bobKp);
    const result = await this.server.sendTransaction(prepared);
    if (result.status === 'ERROR') {
      throw new Error(String(result.errorResult ?? 'Transaction failed'));
    }
    return result.hash;
  }
}
