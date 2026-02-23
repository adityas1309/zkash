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

  /**
   * Poll getTransaction until the TX is confirmed or fails.
   * Returns the confirmed TX hash, or throws on failure/timeout.
   */
  private async waitForTransaction(hash: string, timeoutMs = 120_000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const response = await this.server.getTransaction(hash);
      if (response.status === 'SUCCESS') {
        return hash;
      }
      if (response.status === 'FAILED') {
        throw new Error(`Transaction ${hash} failed on-chain`);
      }
      // status === 'NOT_FOUND' means still pending
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`Transaction ${hash} not confirmed after ${timeoutMs / 1000}s`);
  }

  /**
   * Helper to prepare transaction, add auth entries automatically, and add a resource/fee buffer.
   */
  private async prepareTransactionWithBuffer(tx: StellarSdk.Transaction): Promise<StellarSdk.Transaction> {
    console.log('[SorobanService] Preparing transaction with native SDK...');
    const preparedTx = await this.server.prepareTransaction(tx);

    try {
      const envelope = preparedTx.toEnvelope();
      const txV1 = envelope.v1().tx();
      const txExt = txV1.ext();

      // @ts-ignore
      if (txExt && txExt.switch().value === 1) {
        const sorobanData = txExt.sorobanData();
        const resources = sorobanData.resources();

        // @ts-ignore
        const inst = typeof resources.instructions === 'function' ? resources.instructions() : resources.instructions;
        // @ts-ignore
        const rb = typeof resources.readBytes === 'function' ? resources.readBytes() : resources.readBytes;
        // @ts-ignore
        const wb = typeof resources.writeBytes === 'function' ? resources.writeBytes() : resources.writeBytes;

        // @ts-ignore
        if (typeof resources.instructions === 'function') {
          // @ts-ignore
          resources.instructions(inst + 2000000);
          // @ts-ignore
          resources.readBytes(rb + 15000);
          // @ts-ignore
          resources.writeBytes(wb + 15000);
        } else {
          // @ts-ignore
          resources.instructions = inst + 2000000;
          // @ts-ignore
          resources.readBytes = rb + 15000;
          // @ts-ignore
          resources.writeBytes = wb + 15000;
        }

        const oldFee = parseInt(preparedTx.fee, 10);
        txV1.fee(oldFee + 500000);

        return new StellarSdk.Transaction(envelope.toXDR('base64'), this.networkPassphrase);
      }
    } catch (e) {
      console.warn('[SorobanService] Failed to add resource buffer:', e);
    }

    return preparedTx;
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
    amount: string,
  ): Promise<string> {
    if (commitmentBytes.length !== 32) throw new Error('Commitment must be 32 bytes');
    if (newRootBytes.length !== 32) throw new Error('newRoot must be 32 bytes');

    const keypair = StellarSdk.Keypair.fromSecret(signerSecretKey);
    const sourceAccount = await this.server.getAccount(keypair.publicKey());
    const contract = new StellarSdk.Contract(poolContractId);

    const amountBi = BigInt(amount);
    const lo = amountBi & BigInt('0xFFFFFFFFFFFFFFFF');
    const hi = amountBi >> 64n;

    const args = [
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(keypair.publicKey())),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(newRootBytes)),
      StellarSdk.xdr.ScVal.scvI128(
        new StellarSdk.xdr.Int128Parts({
          lo: StellarSdk.xdr.Uint64.fromString(lo.toString()),
          hi: StellarSdk.xdr.Int64.fromString(hi.toString()),
        }),
      ),
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('deposit', ...args))
      .setTimeout(180)
      .build();

    const prepared = await this.prepareTransactionWithBuffer(tx);
    prepared.sign(keypair);
    const result = await this.server.sendTransaction(prepared);
    if (result.status === 'ERROR') {
      throw new Error(String(result.errorResult ?? 'Transaction failed'));
    }

    // Wait for on-chain confirmation before returning
    return this.waitForTransaction(result.hash);
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
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(pubSignalsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(nullifierBytes)),
    ];

    // Debug: log state root from pubSignals
    // pubSignals = [nullifierHash(32), withdrawnValue(32), stateRoot(32), associationRoot(32)]
    if (pubSignalsBytes.length >= 96) {
      const stateRoot = pubSignalsBytes.subarray(64, 96);
      console.log(`[SorobanService] invokeShieldedPoolWithdraw: stateRoot in signals: ${Buffer.from(stateRoot).toString('hex')}`);
    } else {
      console.warn(`[SorobanService] invokeShieldedPoolWithdraw: pubSignalsBytes too short: ${pubSignalsBytes.length}`);
    }

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('withdraw', ...args))
      .setTimeout(180)
      .build();

    const prepared = await this.prepareTransactionWithBuffer(tx);
    prepared.sign(keypair);
    const result = await this.server.sendTransaction(prepared);
    if (result.status === 'ERROR') {
      throw new Error(String(result.errorResult ?? 'Transaction failed'));
    }

    // Wait for on-chain confirmation before returning
    return this.waitForTransaction(result.hash);
  }

  /**
   * Invoke ZKSwap.execute. Both alice and bob must sign the transaction.
   */
  /**
   * Invoke ZKSwap.execute.
   * Now ANONYMOUS: No alice/bob address arguments, no auth entries needed.
   * Alice (sourceAccount) pays the fee.
   */
  async invokeZkSwapExecute(
    zkSwapContractId: string,
    aliceSecretKey: string, // Payer
    usdcPoolAddress: string,
    xlmPoolAddress: string,
    amountUsdc: string,
    amountXlm: string,
    aliceProof: Uint8Array,
    alicePubSignals: Uint8Array,
    aliceNullifier: Uint8Array,
    aliceOutputCommitment: Uint8Array,
    aliceOutputRoot: Uint8Array,
    bobProof: Uint8Array,
    bobPubSignals: Uint8Array,
    bobNullifier: Uint8Array,
    bobOutputCommitment: Uint8Array,
    bobOutputRoot: Uint8Array,
  ): Promise<string> {
    const aliceKp = StellarSdk.Keypair.fromSecret(aliceSecretKey);
    const sourceAccount = await this.server.getAccount(aliceKp.publicKey());
    const contract = new StellarSdk.Contract(zkSwapContractId);

    const paramsSc = StellarSdk.xdr.ScVal.scvMap([
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('amount_usdc'),
        val: StellarSdk.xdr.ScVal.scvI64(StellarSdk.xdr.Int64.fromString(amountUsdc)),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('amount_xlm'),
        val: StellarSdk.xdr.ScVal.scvI64(StellarSdk.xdr.Int64.fromString(amountXlm)),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('usdc_pool'),
        val: StellarSdk.nativeToScVal(StellarSdk.Address.fromString(usdcPoolAddress)),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol('xlm_pool'),
        val: StellarSdk.nativeToScVal(StellarSdk.Address.fromString(xlmPoolAddress)),
      }),
    ]);

    const args = [
      paramsSc,
      // Alice Inputs
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(aliceProof)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(alicePubSignals)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(aliceNullifier)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(aliceOutputCommitment)), // New XLM note for Alice
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(aliceOutputRoot)),       // New XLM root
      // Bob Inputs
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobProof)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobPubSignals)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobNullifier)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobOutputCommitment)),   // New USDC note for Bob
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobOutputRoot)),         // New USDC root
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('execute', ...args))
      .setTimeout(180)
      .build();

    const prepared = await this.prepareTransactionWithBuffer(tx);
    prepared.sign(aliceKp); // Sign as submitter/fee-payer

    const result = await this.server.sendTransaction(prepared);
    if (result.status === 'ERROR') {
      console.error('[SorobanService] execution failed:', JSON.stringify(result, null, 2));
      throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
    }

    console.log(`[SorobanService] execution pending: ${result.hash}. Waiting for confirmation...`);
    // Wait for on-chain confirmation before returning to ensure it actually lands
    return this.waitForTransaction(result.hash);
  }
}

