/**
 * Debug script: check init TX status + simulate deposit + try re-init with polling.
 * Run: npx ts-node src/debug-deposit.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import * as StellarSdk from '@stellar/stellar-sdk';
import { getContractAddress } from './network.context';

const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = StellarSdk.Networks.TESTNET;
const USDC_POOL = getContractAddress('SHIELDED_POOL_ADDRESS') || '';
const XLM_POOL = getContractAddress('SHIELDED_POOL_XLM_ADDRESS') || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || '';
const VERIFIER_ADDR = getContractAddress('GROTH16_VERIFIER_ADDRESS') || '';
const XLM_TOKEN = process.env.XLM_TOKEN_ADDRESS || '';
const USDC_TOKEN = process.env.USDC_TOKEN_ADDRESS || '';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTx(server: StellarSdk.rpc.Server, hash: string, maxWaitSec = 60): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < maxWaitSec * 1000) {
        const response = await server.getTransaction(hash);
        if (response.status !== 'NOT_FOUND') {
            return response;
        }
        await sleep(2000);
    }
    throw new Error(`TX ${hash} not found after ${maxWaitSec}s`);
}

async function testContract(server: StellarSdk.rpc.Server, poolAddress: string, label: string, signerPub: string) {
    console.log(`\n=== Testing ${label}: ${poolAddress} ===`);
    const contract = new StellarSdk.Contract(poolAddress);
    const sourceAccount = await server.getAccount(signerPub);

    for (const fnName of ['get_admin', 'get_merkle_root', 'get_balance', 'get_commitments']) {
        try {
            const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
                fee: StellarSdk.BASE_FEE,
                networkPassphrase: NETWORK,
            })
                .addOperation(contract.call(fnName))
                .setTimeout(30)
                .build();

            const sim = await server.simulateTransaction(tx);
            if ('error' in sim && sim.error) {
                // Extract just the key error message
                const errorStr = String(sim.error);
                const match = errorStr.match(/data:\["([^"]+)"/);
                const shortErr = match ? match[1] : 'UnreachableCodeReached';
                console.log(`  ${fnName}: FAIL - ${shortErr}`);
            } else {
                const result = 'result' in sim ? sim.result : undefined;
                if (result?.retval) {
                    const sw = result.retval.switch().name;
                    if (sw === 'scvAddress') {
                        console.log(`  ${fnName}: OK -> ${StellarSdk.Address.fromScVal(result.retval).toString()}`);
                    } else if (sw === 'scvI128') {
                        const i128 = result.retval.i128();
                        console.log(`  ${fnName}: OK -> ${i128.lo().toString()}`);
                    } else if (sw === 'scvVec') {
                        const vec = result.retval.vec();
                        console.log(`  ${fnName}: OK -> vec(${vec?.length ?? 0})`);
                    } else if (sw === 'scvBytes') {
                        console.log(`  ${fnName}: OK -> bytes(${result.retval.bytes().length})`);
                    } else {
                        console.log(`  ${fnName}: OK -> ${sw}`);
                    }
                }
            }
        } catch (e: any) {
            console.log(`  ${fnName}: EXCEPTION - ${e.message.slice(0, 80)}`);
        }
    }
}

async function initializePool(
    server: StellarSdk.rpc.Server,
    poolAddress: string,
    label: string,
    keypair: StellarSdk.Keypair,
    tokenAddress: string,
    verifierAddress: string,
    vkBytes: Uint8Array,
) {
    console.log(`\n--- Initializing ${label} ---`);
    console.log(`  Pool: ${poolAddress}`);
    console.log(`  Token: ${tokenAddress}`);
    console.log(`  Verifier: ${verifierAddress}`);
    console.log(`  VK size: ${vkBytes.length} bytes`);

    const sourceAccount = await server.getAccount(keypair.publicKey());
    const contract = new StellarSdk.Contract(poolAddress);

    const args = [
        StellarSdk.nativeToScVal(StellarSdk.Address.fromString(verifierAddress)),             // verifier_address
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(vkBytes)),                                   // vk_bytes
        StellarSdk.nativeToScVal(StellarSdk.Address.fromString(tokenAddress)),                 // token_address
        StellarSdk.nativeToScVal(StellarSdk.Address.fromString(keypair.publicKey())),           // admin
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: '10000000', // high fee for contract init
        networkPassphrase: NETWORK,
    })
        .addOperation(contract.call('initialize', ...args))
        .setTimeout(300)
        .build();

    // Step 1: Simulate
    console.log('  Simulating...');
    const sim = await server.simulateTransaction(tx);
    if ('error' in sim && sim.error) {
        console.log(`  SIMULATION FAILED:`, String(sim.error).slice(0, 200));
        return false;
    }
    console.log('  Simulation OK');

    // Step 2: Prepare + sign
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(keypair);

    // Step 3: Send
    console.log('  Sending...');
    const sendResult = await server.sendTransaction(prepared);
    console.log(`  Send status: ${sendResult.status}, hash: ${sendResult.hash}`);

    if (sendResult.status === 'ERROR') {
        console.log('  TX ERROR:', sendResult.errorResult?.toString());
        return false;
    }

    // Step 4: POLL for confirmation
    console.log('  Waiting for confirmation...');
    const txResult = await waitForTx(server, sendResult.hash);
    console.log(`  TX status: ${txResult.status}`);

    if (txResult.status === 'SUCCESS') {
        console.log(`  ✅ ${label} initialized!`);
        return true;
    } else {
        console.log(`  ❌ TX failed:`, txResult.resultXdr?.toString().slice(0, 200));
        return false;
    }
}

async function main() {
    const server = new StellarSdk.rpc.Server(RPC_URL);
    console.log('RPC:', RPC_URL);

    if (!ADMIN_SECRET) { console.error('No ADMIN_SECRET_KEY'); return; }
    const keypair = StellarSdk.Keypair.fromSecret(ADMIN_SECRET);
    console.log('Admin:', keypair.publicKey());

    // Step 1: Check previous init TX hashes
    console.log('\n=== Step 1: Check init TX results ===');
    for (const hash of [
        '031751e3bd4f43f70eed361e7fe4770bdde0be1f44483dfe9d141459f5dd297b',
        'fe28c5a6f9ca9b9859162012b150ba10bac187a3a09ab723a3f0a59f6a147a89',
    ]) {
        try {
            const response = await server.getTransaction(hash);
            console.log(`  TX ${hash.slice(0, 12)}... status: ${response.status}`);
        } catch (e: any) {
            console.log(`  TX ${hash.slice(0, 12)}... error: ${e.message.slice(0, 60)}`);
        }
    }

    // Step 2: Test both pools
    console.log('\n=== Step 2: Current pool state ===');
    if (USDC_POOL) await testContract(server, USDC_POOL, 'USDC Pool', keypair.publicKey());
    if (XLM_POOL) await testContract(server, XLM_POOL, 'XLM Pool', keypair.publicKey());

    // Step 3: If pools are broken, try to re-initialize with proper polling
    // Load VK
    const vkPath = path.resolve(__dirname, '../../../packages/circuits/private_transfer/output/verification_key.json');
    if (!fs.existsSync(vkPath)) {
        console.error('VK not found at', vkPath);
        return;
    }
    // Dynamically import SDK's vkToBytes
    let vkToBytes: any;
    try {
        const sdk = await import('sdk');
        vkToBytes = sdk.vkToBytes;
    } catch {
        console.error('Could not import sdk. Run from apps/api.');
        return;
    }
    const vkJson = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));
    const vkBytes = vkToBytes(vkJson);
    console.log(`\nVK loaded: ${vkBytes.length} bytes`);

    // Try to re-init XLM pool
    if (XLM_POOL) {
        await initializePool(server, XLM_POOL, 'XLM Pool', keypair, XLM_TOKEN, VERIFIER_ADDR, vkBytes);
    }

    // Re-test
    console.log('\n=== Step 4: Re-test after init ===');
    if (XLM_POOL) await testContract(server, XLM_POOL, 'XLM Pool (after init)', keypair.publicKey());
}

main().catch(console.error);
