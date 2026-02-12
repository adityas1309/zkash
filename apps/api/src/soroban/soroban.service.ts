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
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(newRootBytes)),
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

    const prepared = await this.server.prepareTransaction(tx);
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

    console.log(`[SorobanService] Alice Keypair: ${aliceKp.publicKey()} | Arg Address: ${aliceAddress}`);
    console.log(`[SorobanService] Bob Keypair:   ${bobKp.publicKey()} | Arg Address: ${bobAddress}`);

    if (aliceKp.publicKey() !== aliceAddress) console.warn('[SorobanService] WARNING: Alice Keypair/Address mismatch!');
    if (bobKp.publicKey() !== bobAddress) console.warn('[SorobanService] WARNING: Bob Keypair/Address mismatch!');

    // @ts-ignore
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
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(aliceAddress)),
      StellarSdk.nativeToScVal(StellarSdk.Address.fromString(bobAddress)),
      paramsSc,
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(aliceProof)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(alicePubSignals)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(aliceNullifier)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobProof)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobPubSignals)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bobNullifier)),
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('execute', ...args))
      .setTimeout(180)
      .build();

    // DEBUG: Simulate manually to inspect auth
    console.log('[SorobanService] Simulating ZK Swap execution...');
    // @ts-ignore
    const sim = await this.server.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(sim)) {
      console.error('[SorobanService] Simulation FAILED:', JSON.stringify(sim, null, 2));
      throw new Error('Simulation failed');
    }
    console.log('[SorobanService] Simulation SUCCESS');
    // @ts-ignore
    if (sim.result && sim.result.auth) {
      // @ts-ignore
      console.log(`[SorobanService] Simulation Auth entries: ${sim.result.auth.length}`);
    } else {
      console.log('[SorobanService] Simulation Auth entries: 0/Undefined');
    }


    // Verify simulation result before assembly
    // @ts-ignore
    if (StellarSdk.rpc.Api.isSimulationError(sim) || !sim.transactionData) {
      throw new Error('Simulation failed or transaction data missing');
    }

    // Calculate Fee
    let finalFee = StellarSdk.BASE_FEE;
    // @ts-ignore
    if (sim.minResourceFee) {
      // @ts-ignore
      finalFee += parseInt(sim.minResourceFee, 10) + 1000; // Add buffer
    }

    // RELOAD source account to get the correct sequence number
    console.log('[SorobanService] Reloading source account for final transaction seqNum...');
    // @ts-ignore
    const accountResponse = await this.server.getAccount(aliceKp.publicKey());
    // @ts-ignore
    const freshSourceAccount = new StellarSdk.Account(aliceKp.publicKey(), accountResponse.sequence.toString());

    // Prepare Operation (Standard)
    const callOp = contract.call('execute', ...args);

    // Rebuild transaction with correct fee
    const finalTx = new StellarSdk.TransactionBuilder(freshSourceAccount, {
      fee: finalFee.toString(),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(callOp)
      .setTimeout(180)
      .build();

    console.log(`[SorobanService] Rebuilt Final Tx with Fee: ${finalFee}`);

    // Convert to XDR Envelope to manipulate the XDR tree for Soroban Data AND Auth
    const envelope = finalTx.toEnvelope();
    const txV1 = envelope.v1().tx();

    // 1. Attach Soroban Resource Data
    // @ts-ignore
    // @ts-ignore
    // @ts-ignore
    const sorobanData = sim.transactionData.build();
    // @ts-ignore
    const newExt = new StellarSdk.xdr.TransactionExt(1, sorobanData);
    txV1.ext(newExt);

    // 2. Attach Auth Entries (Signatures/Authorization)
    // @ts-ignore
    if (sim.result && sim.result.auth) {
      // @ts-ignore
      const authEntries = sim.result.auth;
      const signedAuthEntries = [];

      console.log(`[SorobanService] Found ${authEntries.length} auth entries. Signing them...`);

      for (const entry of authEntries) {
        // Determine credential type and signer
        // @ts-ignore
        const credentials = entry.credentials();
        const switchName = credentials.switch().name;
        let signerKp;
        let signerAddress;

        console.log(`[SorobanService] Processing auth entry type: ${switchName}`);

        if (switchName === 'sorobanCredentialsSourceAccount') {
          // Source account (Alice)
          signerKp = aliceKp;
          signerAddress = aliceKp.publicKey();
          console.log(`[SorobanService] - Identified as Source Account (Alice): ${signerAddress}`);
        } else if (switchName === 'sorobanCredentialsAddress') {
          // Specific address
          // @ts-ignore
          const addressCred = credentials.address();
          // @ts-ignore
          signerAddress = StellarSdk.StrKey.encodeEd25519PublicKey(addressCred.address().accountId().ed25519());
          console.log(`[SorobanService] - Identified as Address: ${signerAddress}`);

          if (signerAddress === aliceKp.publicKey()) {
            signerKp = aliceKp;
          } else if (signerAddress === bobKp.publicKey()) {
            signerKp = bobKp;
          } else {
            console.warn(`[SorobanService] Unknown signer in auth entry: ${signerAddress}. Skipping signing.`);
            signedAuthEntries.push(entry);
            continue;
          }
        } else {
          console.warn(`[SorobanService] Unhandled credential type: ${switchName}. Skipping signing.`);
          signedAuthEntries.push(entry);
          continue;
        }

        // Sign the entry
        // @ts-ignore
        const currentLedger = sim.latestLedger || 0;
        const validUntil = currentLedger + 100;

        // @ts-ignore
        const signedEntry = await StellarSdk.authorizeEntry(
          entry,
          signerKp,
          validUntil,
          this.networkPassphrase
        );
        signedAuthEntries.push(signedEntry);
      }

      // Access the first operation -> body -> invokeHostFunctionOp -> auth field
      txV1.operations()[0].body().invokeHostFunctionOp().auth(signedAuthEntries);

      console.log(`[SorobanService] XDR Patch: Attached ${signedAuthEntries.length} SIGNED auth entries to envelope.`);

      // VERIFICATION: Read it back to ensure it stuck
      const attachedCount = txV1.operations()[0].body().invokeHostFunctionOp().auth().length;
      console.log(`[SorobanService] VERIFICATION: Envelope now has ${attachedCount} auth entries.`);
    } else {
      console.warn('[SorobanService] No auth entries found in simulation result!');
    }

    // 3. Re-create Transaction object from the patched envelope XDR
    // @ts-ignore
    const patchedTx = new StellarSdk.Transaction(envelope.toXDR('base64'), this.networkPassphrase);

    console.log('[SorobanService] Transaction recreated from patched XDR.');

    patchedTx.sign(aliceKp);
    // Bob's auth is inside the operation auth entries, so he does NOT sign the envelope.

    const result = await this.server.sendTransaction(patchedTx);
    if (result.status === 'ERROR') {
      console.error('[SorobanService] invokeZkSwapExecute failed:', JSON.stringify(result, null, 2));
      throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
    }
    return result.hash;
  }
}
