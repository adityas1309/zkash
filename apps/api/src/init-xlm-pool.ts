/**
 * Initialize ShieldedPool XLM contract with proper TX confirmation.
 * Run: npx ts-node src/init-xlm-pool.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import * as StellarSdk from '@stellar/stellar-sdk';
import { getContractAddress } from './network.context';

const isMainnet = process.env.STELLAR_NETWORK === 'mainnet';
const RPC_URL = process.env.RPC_URL || (isMainnet ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org');
const NETWORK = isMainnet ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
const XLM_POOL = getContractAddress('SHIELDED_POOL_XLM_ADDRESS') || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || '';
const VERIFIER_ADDR = getContractAddress('GROTH16_VERIFIER_ADDRESS') || '';

// If network is mainnet, use CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA
// Otherwise use testnet CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
const defaultXlmToken = isMainnet
    ? 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA'
    : 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const XLM_TOKEN = process.env.XLM_TOKEN_ADDRESS || defaultXlmToken;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTx(server: StellarSdk.rpc.Server, hash: string, maxWaitSec = 120): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < maxWaitSec * 1000) {
        const response = await server.getTransaction(hash);
        console.log(`  Poll: ${response.status}`);
        if (response.status !== 'NOT_FOUND') {
            return response;
        }
        await sleep(3000);
    }
    throw new Error(`TX ${hash} not found after ${maxWaitSec}s`);
}

// Flatten G2 points: [[x1,x2],[y1,y2],[1,0]] -> [x1,x2,y1,y2]
function flattenPoint(arr: any[]): bigint[] {
    const result: bigint[] = [];
    for (const el of arr) {
        if (Array.isArray(el)) {
            for (const x of el) {
                result.push(BigInt(String(x)));
            }
        } else {
            result.push(BigInt(String(el)));
        }
    }
    return result;
}

function bigIntToBytes48BE(n: bigint): Uint8Array {
    const hex = n.toString(16).padStart(96, '0');
    const out = new Uint8Array(48);
    for (let i = 0; i < 48; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function buildVkBytes(vk: any): Uint8Array {
    // alpha(G1=96) + beta(G2=192) + gamma(G2=192) + delta(G2=192) + IC(G1=96 each)
    const alpha = flattenPoint(vk.vk_alpha_1).slice(0, 2); // G1: [x, y]
    const beta = flattenPoint(vk.vk_beta_2).slice(0, 4);    // G2: [x1, x2, y1, y2]
    const gamma = flattenPoint(vk.vk_gamma_2).slice(0, 4);
    const delta = flattenPoint(vk.vk_delta_2).slice(0, 4);

    const icPoints: bigint[][] = [];
    for (const pt of vk.IC) {
        icPoints.push(flattenPoint(pt).slice(0, 2));
    }

    // G1=96, G2=192 (48 bytes per coord)
    const size = 96 + 192 * 3 + icPoints.length * 96;
    const out = new Uint8Array(size);
    let off = 0;

    for (const x of alpha) { out.set(bigIntToBytes48BE(x), off); off += 48; }
    for (const arr of [beta, gamma, delta]) {
        // G2: Swap c0/c1 -> [c1, c0] (Descending order for BLST)
        const ordered = [arr[1], arr[0], arr[3], arr[2]];
        for (const x of ordered) { out.set(bigIntToBytes48BE(x), off); off += 48; }
    }
    for (const pt of icPoints) {
        for (const x of pt) { out.set(bigIntToBytes48BE(x), off); off += 48; }
    }

    return out;
}

async function main() {
    const server = new StellarSdk.rpc.Server(RPC_URL);
    console.log('RPC:', RPC_URL);
    console.log('XLM Pool:', XLM_POOL);
    console.log('XLM Token:', XLM_TOKEN);
    console.log('Verifier:', VERIFIER_ADDR);

    if (!XLM_POOL || !ADMIN_SECRET || !VERIFIER_ADDR || !XLM_TOKEN) {
        console.error('Missing env vars');
        return;
    }

    const keypair = StellarSdk.Keypair.fromSecret(ADMIN_SECRET);
    console.log('Admin:', keypair.publicKey());

    // Load VK
    const vkPath = path.resolve(__dirname, '../../../packages/circuits/private_transfer/output/verification_key.json');
    const vkJson = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));
    const vkBytes = buildVkBytes(vkJson);
    console.log('VK size:', vkBytes.length, 'bytes');

    // Build initialize transaction
    const sourceAccount = await server.getAccount(keypair.publicKey());
    const contract = new StellarSdk.Contract(XLM_POOL);

    const args = [
        StellarSdk.nativeToScVal(StellarSdk.Address.fromString(VERIFIER_ADDR)),
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(vkBytes)),
        StellarSdk.nativeToScVal(StellarSdk.Address.fromString(XLM_TOKEN)),
        StellarSdk.nativeToScVal(StellarSdk.Address.fromString(keypair.publicKey())),
    ];

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: '10000000',
        networkPassphrase: NETWORK,
    })
        .addOperation(contract.call('initialize', ...args))
        .setTimeout(300)
        .build();

    // Simulate
    console.log('\nSimulating...');
    const sim = await server.simulateTransaction(tx);
    if ('error' in sim && sim.error) {
        console.log('SIMULATION FAILED:', String(sim.error).slice(0, 300));
        return;
    }
    console.log('Simulation OK');
    console.log('Min resource fee:', ('minResourceFee' in sim ? sim.minResourceFee : 'N/A'));

    // Prepare + Sign
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(keypair);

    // Send
    console.log('\nSending TX...');
    const sendResult = await server.sendTransaction(prepared);
    console.log('Send status:', sendResult.status);
    console.log('TX hash:', sendResult.hash);

    if (sendResult.status === 'ERROR') {
        console.log('Error:', sendResult.errorResult?.toString());
        return;
    }

    // WAIT FOR CONFIRMATION
    console.log('\nWaiting for confirmation...');
    const txResult = await waitForTx(server, sendResult.hash);
    console.log('\nFinal status:', txResult.status);

    if (txResult.status === 'SUCCESS') {
        console.log('✅ XLM Pool initialized successfully!');

        // Verify
        console.log('\nVerifying...');
        const srcAcct = await server.getAccount(keypair.publicKey());
        const checkTx = new StellarSdk.TransactionBuilder(srcAcct, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: NETWORK,
        })
            .addOperation(contract.call('get_admin'))
            .setTimeout(30)
            .build();
        const checkSim = await server.simulateTransaction(checkTx);
        if ('error' in checkSim && checkSim.error) {
            console.log('get_admin still fails:', String(checkSim.error).slice(0, 100));
        } else {
            const result = 'result' in checkSim ? checkSim.result : undefined;
            if (result?.retval) {
                console.log('get_admin:', StellarSdk.Address.fromScVal(result.retval).toString());
                console.log('✅ Contract is fully functional!');
            }
        }
    } else {
        console.log('❌ TX failed:', txResult.status);
    }
}

main().catch(console.error);
