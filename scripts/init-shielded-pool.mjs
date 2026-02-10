import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import StellarSdk from '@stellar/stellar-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/* ---------------- VK loading utils ---------------- */

function loadVkBytes() {
  const vkPath = join(
    rootDir,
    'packages',
    'circuits',
    'private_transfer',
    'output',
    'verification_key.json'
  );

  try {
    const vk = JSON.parse(readFileSync(vkPath, 'utf8'));
    return vkToBytes(vk);
  } catch (e) {
    console.error(
      'Could not load verification_key.json. Run: cd packages/circuits && pnpm run setup'
    );
    throw e;
  }
}

const G1_SIZE = 64;
const G2_SIZE = 128;

function bigIntToBytes32BE(n) {
  const hex = BigInt(n).toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function parsePoint(arr) {
  return arr.flat(Infinity).map((x) => BigInt(x));
}

function vkToBytes(vk) {
  const alpha = parsePoint(vk.vk_alpha_1).slice(0, 2);
  const beta = parsePoint(vk.vk_beta_2).slice(0, 4);
  const gamma = parsePoint(vk.vk_gamma_2).slice(0, 4);
  const delta = parsePoint(vk.vk_delta_2).slice(0, 4);

  const icLen = vk.IC?.length ?? 0;
  const size = G1_SIZE + G2_SIZE * 3 + icLen * G1_SIZE;
  const out = new Uint8Array(size);

  let off = 0;
  for (const x of alpha) {
    out.set(bigIntToBytes32BE(x), off);
    off += 32;
  }
  for (const x of [...beta, ...gamma, ...delta]) {
    out.set(bigIntToBytes32BE(x), off);
    off += 32;
  }
  for (const pt of vk.IC ?? []) {
    const g1 = parsePoint(pt).slice(0, 2);
    for (const x of g1) {
      out.set(bigIntToBytes32BE(x), off);
      off += 32;
    }
  }
  return out;
}

/* ---------------- Init logic ---------------- */

async function initializePool({
  server,
  keypair,
  networkPassphrase,
  verifierAddress,
  poolAddress,
  tokenAddress,
  vkBytes,
}) {
  console.log('\nInitializing pool:', poolAddress);
  console.log('Token:', tokenAddress);

  const sourceAccount = await server.getAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(poolAddress);

  const args = [
    StellarSdk.nativeToScVal(StellarSdk.Address.fromString(verifierAddress)),
    StellarSdk.nativeToScVal(vkBytes),
    StellarSdk.nativeToScVal(StellarSdk.Address.fromString(tokenAddress)),
    StellarSdk.nativeToScVal(
      StellarSdk.Address.fromString(keypair.publicKey())
    ),
  ];

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('initialize', ...args))
    .setTimeout(180)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const result = await server.sendTransaction(prepared);

  if (result.status === 'ERROR') {
    throw new Error(
      `Initialization failed for ${poolAddress}: ${result.errorResult}`
    );
  }

  console.log('Initialized successfully. TX:', result.hash);
}

/* ---------------- Main ---------------- */

async function main() {
  const {
    GROTH16_VERIFIER_ADDRESS,
    SHIELDED_POOL_ADDRESS,
    SHIELDED_POOL_XLM_ADDRESS,
    USDC_TOKEN_ADDRESS,
    XLM_TOKEN_ADDRESS,
    ADMIN_SECRET_KEY,
    DEPLOYER_SECRET_KEY,
  } = process.env;

  const adminSecret = ADMIN_SECRET_KEY || DEPLOYER_SECRET_KEY;

  if (
    !GROTH16_VERIFIER_ADDRESS ||
    !SHIELDED_POOL_ADDRESS ||
    !SHIELDED_POOL_XLM_ADDRESS ||
    !USDC_TOKEN_ADDRESS ||
    !XLM_TOKEN_ADDRESS ||
    !adminSecret
  ) {
    console.error('Missing required env vars');
    process.exit(1);
  }

  const rpcUrl =
    process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;

  console.log('Loading verification key...');
  const vkBytes = loadVkBytes();
  console.log('VK size:', vkBytes.length, 'bytes');

  const keypair = StellarSdk.Keypair.fromSecret(adminSecret);
  const server = new StellarSdk.rpc.Server(rpcUrl);

  // USDC pool
  await initializePool({
    server,
    keypair,
    networkPassphrase,
    verifierAddress: GROTH16_VERIFIER_ADDRESS,
    poolAddress: SHIELDED_POOL_ADDRESS,
    tokenAddress: USDC_TOKEN_ADDRESS,
    vkBytes,
  });

  // XLM pool
  await initializePool({
    server,
    keypair,
    networkPassphrase,
    verifierAddress: GROTH16_VERIFIER_ADDRESS,
    poolAddress: SHIELDED_POOL_XLM_ADDRESS,
    tokenAddress: XLM_TOKEN_ADDRESS,
    vkBytes,
  });

  console.log('\n✅ Both Shielded Pools initialized successfully');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
