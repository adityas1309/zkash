# ZKASH 🛡️

> **Privacy-first P2P payments and crypto swap application on the Stellar network using Zero-Knowledge proofs. Send and trade assets seamlessly and privately.**

---

## 🚀 Live Links
- **Deployed Website:** [zkash-swap.vercel.app](https://zkash-swap.vercel.app)
- **Demo Video:** [YouTube Walkthrough](https://youtu.be/9XibJXIC4qg)

---

## 📜 Smart Contracts

Our smart contracts are deployed and verifiable on the Stellar network:

| Contract | Address / Link |
|----------|---------------|
| **Groth16 Verifier** | [`CA6NRLSK6Y5TFJTQT7LRN6DD7GJ4S6XITIJQSO3PLNW2U4BSVMYJARM6`](https://stellar.expert/explorer/public/contract/CA6NRLSK6Y5TFJTQT7LRN6DD7GJ4S6XITIJQSO3PLNW2U4BSVMYJARM6) |
| **Shielded Pool (USDC)** | [`CA44UAU35XSFIKPANNNUTEXEOEELDEFYMVY7XLLNGM7ABBPWUN6GHZLU`](https://stellar.expert/explorer/public/contract/CA44UAU35XSFIKPANNNUTEXEOEELDEFYMVY7XLLNGM7ABBPWUN6GHZLU) |
| **Shielded Pool (XLM)** | [`CCOED73UUQOVYUVHRSORTVHCIHZSPOL64PITWV2XDRM4HAQ55KVTG4MM`](https://stellar.expert/explorer/public/contract/CCOED73UUQOVYUVHRSORTVHCIHZSPOL64PITWV2XDRM4HAQ55KVTG4MM) |
| **ZK Swap** | [`CC7ODJ2I23EF3CWIUNJETJHXXTUSLEFUO3M36I5VMYKTDIYDZTO6G6AM`](https://stellar.expert/explorer/public/contract/CC7ODJ2I23EF3CWIUNJETJHXXTUSLEFUO3M36I5VMYKTDIYDZTO6G6AM) |

---

## 🌟 Key Features

- **Zero-Knowledge Privacy:** Enjoy truly private transactions using state-of-the-art zk-SNARKs (Groth16, BLS12-381). Hide amounts and transaction details from the public ledger.
- **P2P Atomic Swaps:** Trustlessly swap tokens (e.g., USDC to XLM) with peers without a centralized exchange or exposing your financial data.
- **Stellar & Soroban Integration:** Built on the blazing-fast Stellar network leveraging advanced Soroban smart contracts.
- **Fiat On-Ramp & Off-Ramp:** Integrated with Razorpay seamlessly bridging the gap between traditional finance and decentralized privacy.
- **Automated Withdrawals:** Smooth and automated exits from the shielded pool to public accounts right after swapping.
- **Seamless Authentication:** Google OAuth integrated for a frictionless user onboarding experience.

---

## 🛠 Architecture & Tech Stack

ZKASH is built with a modern, high-performance tech stack:

- **Frontend:** Next.js 14, TailwindCSS, `@stellar/stellar-sdk`, `snarkjs`
- **Backend:** NestJS, MongoDB, Google OAuth, Stellar SDK
- **Smart Contracts:** Soroban / Rust (`ShieldedPool`, `ZKSwap`)
- **Circuits:** Circom + SnarkJS (BLS12-381 Curve)
- **Indexer:** Background service listening to Soroban events and managing encrypted notes.

---

## ⚙️ Local Setup & Development

### Prerequisites
- Node.js 20+
- `pnpm`
- MongoDB
- Rust (for compiling Soroban contracts)
- Circom (for circuit compilation)

### 1. Environment Configuration

Create `.env` inside `apps/api` and `.env.local` inside `apps/web` based on the provided setup. Example API `.env`:

```bash
MONGODB_URI=mongodb://localhost:27017/lop
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your-secret
CORS_ORIGIN=http://localhost:3000
RPC_URL=https://soroban-testnet.stellar.org

# Stellar Contracts
GROTH16_VERIFIER_ADDRESS=CA6NRLSK6Y5TFJTQT7LRN6DD7GJ4S6XITIJQSO3PLNW2U4BSVMYJARM6
SHIELDED_POOL_ADDRESS=CA44UAU35XSFIKPANNNUTEXEOEELDEFYMVY7XLLNGM7ABBPWUN6GHZLU
ZK_SWAP_ADDRESS=CC7ODJ2I23EF3CWIUNJETJHXXTUSLEFUO3M36I5VMYKTDIYDZTO6G6AM
SHIELDED_POOL_XLM_ADDRESS=CCOED73UUQOVYUVHRSORTVHCIHZSPOL64PITWV2XDRM4HAQ55KVTG4MM
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Run the Application

Start the respective services in different terminals:

```bash
# Start the Backend API (runs on port 3001)
pnpm dev:api

# Start the Frontend App (runs on port 3000)
pnpm dev:web

# Start the Indexer (optional, for syncing events)
pnpm dev:indexer
```

### 4. Build Zero-Knowledge Circuits

Private send and swap generate ZK proofs in the API. Build the circuit and run the trusted setup.

```bash
cd packages/circuits
pnpm run build    # Compiles circuit, produces build/main_js/main.wasm
pnpm run setup    # Trusted setup: produces output/main_final.zkey and output/verification_key.json
```
*(Do not commit `main_final.zkey` as it is a large file).*

### 5. Build Smart Contracts

```bash
cd packages/contracts
cargo build --target wasm32-unknown-unknown --release -p shielded_pool
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/shielded_pool.wasm -o shielded_pool.optimized.wasm
```

---

## 📚 References
- [Stellar Protocol 25 Upgrade Guide](https://stellar.org/blog/developers/stellar-x-ray-protocol-25-upgrade-guide)
- [Soroban Privacy Pools](https://github.com/ymcrcat/soroban-privacy-pools)
- [Stellar Soroban Examples: Groth16 Verifier](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier)

---

<p align="center">
  Built with ❤️ for the Stellar Ecosystem.
</p>
