# Private P2P Payments and Swaps on Stellar Testnet

Privacy-first P2P payments and crypto swap app on Stellar testnet. Send and trade USDC and XLM privately with zero-knowledge proofs.

## Tech Stack

- **Frontend:** Next.js 14, Tailwind, @stellar/stellar-sdk, snarkjs, qrcode.react
- **Backend:** NestJS, MongoDB, Google OAuth, Stellar SDK
- **Contracts:** Soroban (Rust) - ShieldedPool, ZKSwap
- **Circuits:** Circom + SnarkJS (BLS12-381)

## Setup

### Prerequisites

- Node.js 20+
- pnpm
- MongoDB
- Rust (for contracts)
- Circom (for circuits)

### Environment

```bash
# apps/api/.env
MONGODB_URI=mongodb://localhost:27017/lop
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your-secret
CORS_ORIGIN=http://localhost:3000
RPC_URL=https://soroban-testnet.stellar.org
GROTH16_VERIFIER_ADDRESS=...
SHIELDED_POOL_ADDRESS=...
ZK_SWAP_ADDRESS=...
USDC_TOKEN_ADDRESS=...
ADMIN_SECRET_KEY=...
# Optional: second pool for XLM (if same as USDC pool, omit)
# SHIELDED_POOL_XLM_ADDRESS=...
# Optional: override circuit artifact paths (defaults: packages/circuits/private_transfer/...)
# CIRCUIT_ROOT=...
# CIRCUIT_WASM_PATH=...
# CIRCUIT_ZKEY_PATH=...

# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Install

```bash
pnpm install
```

### Run

```bash
# API (port 3001)
pnpm dev:api

# Web (port 3000)
pnpm dev:web

# Indexer (optional)
pnpm dev:indexer
```

### Build Contracts

```bash
cd packages/contracts
cargo build --target wasm32-unknown-unknown --release -p shielded_pool
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/shielded_pool.wasm -o shielded_pool.optimized.wasm
```

### Initialize ShieldedPool (after deploy)

After deploying the contracts, you must **initialize the ShieldedPool** once (verifier, VK, token, admin):

1. **Circuit trusted setup** (so you have a verification key):
   ```bash
   cd packages/circuits && pnpm run build && pnpm run setup
   ```
   This creates `packages/circuits/private_transfer/output/verification_key.json`.

2. **Add to `.env`** (do not commit the secret key):
   - `GROTH16_VERIFIER_ADDRESS` – your deployed groth16_verifier contract ID
   - `USDC_TOKEN_ADDRESS` – testnet USDC token contract (e.g. `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`; confirm at [Circle USDC on Stellar](https://developers.circle.com/stablecoins/docs/usdc-on-stellar))
   - `ADMIN_SECRET_KEY` – secret key of the admin (e.g. your deployer) that will own the pool

3. **Run the init script** from repo root:
   ```bash
   node --env-file=.env scripts/init-shielded-pool.mjs
   ```

Until this is done, `deposit` and `withdraw` on the ShieldedPool will fail.

### Build Circuits (required for private send and private swap)

Private send and private swap generate ZK proofs in the API. You must build the circuit and run the trusted setup once so the API can load the proving key:

```bash
cd packages/circuits
pnpm run build    # compiles circuit, produces build/main_js/main.wasm
pnpm run setup    # trusted setup: produces output/main_final.zkey and output/verification_key.json
```

- **Do not commit** `main_final.zkey` (large file). Add `*.zkey` to `.gitignore` if needed.
- The API looks for artifacts under `packages/circuits/private_transfer/` by default (when run from repo root). To override, set `CIRCUIT_ZKEY_PATH` and/or `CIRCUIT_WASM_PATH` (or `CIRCUIT_ROOT`) in `.env`.
- Without a valid `main_final.zkey`, "Prepare private execution" and private send will fail with a clear error.

## Architecture

- **ShieldedPool:** Deposit/withdraw with commitments and ZK proofs
- **ZKSwap:** Atomic P2P swaps between USDC and XLM
- **Indexer:** Listens to Soroban events, stores encrypted notes
- **Circuits:** Withdraw circuit from soroban-privacy-pools (BLS12-381)

## References

- [Stellar X-Ray Protocol 25](https://stellar.org/blog/developers/stellar-x-ray-protocol-25-upgrade-guide)
- [soroban-privacy-pools](https://github.com/ymcrcat/soroban-privacy-pools)
- [stellar/soroban-examples groth16_verifier](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier)
