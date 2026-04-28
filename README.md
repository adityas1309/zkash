# ZKASH 🛡️

> **Privacy-first P2P payments and crypto swap application on the Stellar network using Zero-Knowledge proofs. Send and trade assets seamlessly and privately.**

---

## 🚀 Live Links
- **Deployed Website:** [zkash-swap.vercel.app](https://zkash-swap.vercel.app)
- **Demo Video:** [YouTube Walkthrough](https://youtu.be/9XibJXIC4qg)

---

## 📜 Smart Contracts

Our smart contracts are deployed and verifiable on the Stellar network:

### Testnet
| Contract | Address / Link |
|----------|---------------|
| **Groth16 Verifier** | [`CBYARZ3ES7QXQGEKOP6LPNR7A2TNDYXKQGWPW7ALDCCIDHLFZADUSKSP`](https://stellar.expert/explorer/testnet/contract/CBYARZ3ES7QXQGEKOP6LPNR7A2TNDYXKQGWPW7ALDCCIDHLFZADUSKSP) |
| **Shielded Pool (USDC)** | [`CBQRQOQHPG4PV2LZUPSPGTLM2NKCJLMBPYXLR5OHXN5WNJNDF3FHWBKE`](https://stellar.expert/explorer/testnet/contract/CBQRQOQHPG4PV2LZUPSPGTLM2NKCJLMBPYXLR5OHXN5WNJNDF3FHWBKE) |
| **Shielded Pool (XLM)** | [`CB54OKOYUN66RZDA6S6IQN3XIFYVWIBJCHRB5HOWEKRTAXJ6MXYHDJDP`](https://stellar.expert/explorer/testnet/contract/CB54OKOYUN66RZDA6S6IQN3XIFYVWIBJCHRB5HOWEKRTAXJ6MXYHDJDP) |
| **ZK Swap** | [`CCCTNLJWDYI2AYW4GMHGIECV63GVBR7FZW25RP6HI47GO537SPZWXBCX`](https://stellar.expert/explorer/testnet/contract/CCCTNLJWDYI2AYW4GMHGIECV63GVBR7FZW25RP6HI47GO537SPZWXBCX) |

### Mainnet
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

# Stellar Contracts (Testnet)
GROTH16_VERIFIER_ADDRESS=CBYARZ3ES7QXQGEKOP6LPNR7A2TNDYXKQGWPW7ALDCCIDHLFZADUSKSP
SHIELDED_POOL_ADDRESS=CBQRQOQHPG4PV2LZUPSPGTLM2NKCJLMBPYXLR5OHXN5WNJNDF3FHWBKE
ZK_SWAP_ADDRESS=CCCTNLJWDYI2AYW4GMHGIECV63GVBR7FZW25RP6HI47GO537SPZWXBCX
SHIELDED_POOL_XLM_ADDRESS=CB54OKOYUN66RZDA6S6IQN3XIFYVWIBJCHRB5HOWEKRTAXJ6MXYHDJDP

# Stellar Contracts (Mainnet)
# GROTH16_VERIFIER_ADDRESS=CA6NRLSK6Y5TFJTQT7LRN6DD7GJ4S6XITIJQSO3PLNW2U4BSVMYJARM6
# SHIELDED_POOL_ADDRESS=CA44UAU35XSFIKPANNNUTEXEOEELDEFYMVY7XLLNGM7ABBPWUN6GHZLU
# ZK_SWAP_ADDRESS=CC7ODJ2I23EF3CWIUNJETJHXXTUSLEFUO3M36I5VMYKTDIYDZTO6G6AM
# SHIELDED_POOL_XLM_ADDRESS=CCOED73UUQOVYUVHRSORTVHCIHZSPOL64PITWV2XDRM4HAQ55KVTG4MM
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

---

## 📈 User Onboarding & Feedback

We actively collect user feedback to improve ZKASH and deliver a better experience. 

All anonymized user feedback and testnet wallet addresses (created before April 2026) have been recorded for transparency.
**Download User Data:** [user_feedback.csv](./user_feedback.csv)

### Future Improvements Based on Feedback

We have listened to your pain points! Below is how the app has evolved based on the collected feedback:

1. **Feedback:** *"I keep hitting avoidable request errors because the app accepts messy transaction inputs."*
   - **Resolution:** [Commit `d5b95ed`](https://github.com/adityas1309/zkash/commit/d5b95ed9f2f17f8b273b74ea8d69aa53defab085)

2. **Feedback:** *"I can’t trust private balance updates when indexer health and gasless behavior are invisible."*
   - **Resolution:** [Commit `f2e24e8`](https://github.com/adityas1309/zkash/commit/f2e24e880e20a30cc23efce52eca7ead80570654)

3. **Feedback:** *"The dashboard still feels like a static demo instead of a live product."*
   - **Resolution:** [Commit `52126c1`](https://github.com/adityas1309/zkash/commit/52126c135613bf270004ba31a8fd713aed059444)

4. **Feedback:** *"Fee sponsorship still feels unpredictable and too technical."*
   - **Resolution:** [Commit `b176318`](https://github.com/adityas1309/zkash/commit/b176318cc6f6a558f8f1f5cfe4cffbe33d8a9ece)

5. **Feedback:** *"I can’t audit what happened across payments, deposits, and withdrawals."*
   - **Resolution:** [Commit `3057592`](https://github.com/adityas1309/zkash/commit/3057592db17e42add05695401b94408e0f19e161)

6. **Feedback:** *"Swap transactions are too opaque to debug when proofs or execution go wrong."*
   - **Resolution:** [Commit `518cedf`](https://github.com/adityas1309/zkash/commit/518cedf4e6a4aecf7f5ea6fdd9754a9123bfc9d1)

7. **Feedback:** *"The swap page doesn’t show enough lifecycle detail to feel reliable."*
   - **Resolution:** [Commit `214171d`](https://github.com/adityas1309/zkash/commit/214171de53b58b17d9af423f98d1bf3c6261ca8f)

8. **Feedback:** *"I can’t tell which offers are actually worth responding to."*
   - **Resolution:** [Commit `cf8d467`](https://github.com/adityas1309/zkash/commit/cf8d4675fe93f82435636c7281a55e1149c7b0e6)

9. **Feedback:** *"The market board needs stronger filters and clearer quality signals."*
   - **Resolution:** [Commit `29ea90c`](https://github.com/adityas1309/zkash/commit/29ea90cac72a0819d66cbab407be334bd9b63086)

10. **Feedback:** *"Publishing an offer feels blind because I can’t judge rate placement first."*
   - **Resolution:** [Commit `1a00d4b`](https://github.com/adityas1309/zkash/commit/1a00d4b08532eafd57af5e56ff41a351ec078cd4)

11. **Feedback:** *"My payment, private, and swap activity is scattered and hard to follow."*
   - **Resolution:** [Commit `89218bd`](https://github.com/adityas1309/zkash/commit/89218bdfa428e141d605f97525b8946f399350b3)

12. **Feedback:** *"The wallet view is fragmented and doesn’t explain my real balance posture."*
   - **Resolution:** [Commit `3d95167`](https://github.com/adityas1309/zkash/commit/3d951673c15a167dfad30133127e05a0aa7ef3d6)

13. **Feedback:** *"The dashboard should reflect my real workspace state, not stitched-together widgets."*
   - **Resolution:** [Commit `32fc476`](https://github.com/adityas1309/zkash/commit/32fc4762f5ee6ffd9c368de35d416569769ca66b)

14. **Feedback:** *"Fiat on-ramp and off-ramp flow is too shallow to plan around."*
   - **Resolution:** [Commit `7704126`](https://github.com/adityas1309/zkash/commit/770412633ce76bc894f7ee19f820562a1e79c1cd)

15. **Feedback:** *"I need one trustworthy place to check system health and monitoring."*
   - **Resolution:** [Commit `7fe4e3e`](https://github.com/adityas1309/zkash/commit/7fe4e3e98e558aca95ffe5d553de9ac21530a7da)

16. **Feedback:** *"Managing my own offers feels messy and I can’t see queue pressure clearly."*
   - **Resolution:** [Commit `eeedcd4`](https://github.com/adityas1309/zkash/commit/eeedcd459b7bb63b2d830ba14de0e0c05429d041)

17. **Feedback:** *"After sign-in, I still don’t know what the first useful action should be."*
   - **Resolution:** [Commit `7a18708`](https://github.com/adityas1309/zkash/commit/7a18708e8ce2a94fb352e60866d3042dcb6112ed)

18. **Feedback:** *"History should help me recover from problems, not just show old events."*
   - **Resolution:** [Commit `38cab9e`](https://github.com/adityas1309/zkash/commit/38cab9ebbdee1cebc35402c592ccd2a917c5e498)

19. **Feedback:** *"I need route planning before sending, not after a transfer fails."*
   - **Resolution:** [Commit `0322340`](https://github.com/adityas1309/zkash/commit/03223405e1aabc54c39ed22d4ed8029d7f3b44a0)

20. **Feedback:** *"Fiat routes need better route planning and execution context."*
   - **Resolution:** [Commit `9c7aea1`](https://github.com/adityas1309/zkash/commit/9c7aea12cbfdbe38d365934f9418273be400cc2d)

21. **Feedback:** *"Wallet funding and first-use setup still feel awkward and manual."*
   - **Resolution:** [Commit `973efd3`](https://github.com/adityas1309/zkash/commit/973efd30ca35af56d7e724ebbc66563e2831dfca)

22. **Feedback:** *"I need a proper account center with safer profile and deletion controls."*
   - **Resolution:** [Commit `c3ffac1`](https://github.com/adityas1309/zkash/commit/c3ffac1893bd733b5325e77d32e6b8f7e1bcb59e)

23. **Feedback:** *"I don’t know which issue matters most right now."*
   - **Resolution:** [Commit `b816b8d`](https://github.com/adityas1309/zkash/commit/b816b8d84fe8ab363a63e76dca4ef33c6d1f762a)

24. **Feedback:** *"Status data is helpful, but I still need remediation guidance when things degrade."*
   - **Resolution:** [Commit `361e04d`](https://github.com/adityas1309/zkash/commit/361e04d9114ae4cd906db7c11f86ed6119f4c417)

25. **Feedback:** *"Each swap needs its own control tower so I can see proof, execution, and next actions together."*
   - **Resolution:** [Commit `b495e26`](https://github.com/adityas1309/zkash/commit/b495e268e4b80571e7b2b4760dacfdd755166f4e)

26. **Feedback:** *"I want reusable counterparty intelligence instead of starting every send from zero."*
   - **Resolution:** [Commit `840c3fc`](https://github.com/adityas1309/zkash/commit/840c3fc2565b06a48bfd000242ef011778ca76e2)

27. **Feedback:** *"I can’t clearly see how my capital is split across public and private posture."*
   - **Resolution:** [Commit `9162b51`](https://github.com/adityas1309/zkash/commit/9162b517e45e9a5e52ed6fdd82da623abca6c548)

28. **Feedback:** *"I need the product to recommend strategy, not just expose more pages."*
   - **Resolution:** [Commit `0021fad`](https://github.com/adityas1309/zkash/commit/0021fadfde8b83ac73c8a29e6f481704935397de)

29. **Feedback:** *"I still can’t tell what has really settled and what is just in flight."*
   - **Resolution:** [Commit `c1fd50e`](https://github.com/adityas1309/zkash/commit/c1fd50e1213553c76e07c1a7970dd74c0c635e0f)

30. **Feedback:** *"I need to know what capital is actually deployable right now versus idle or stuck."*
   - **Resolution:** [Commit `238208e`](https://github.com/adityas1309/zkash/commit/238208e1d5879113939d8827fbe9cbe73857383c)

---

## ✅ Submission Checklist

- [x] **Public GitHub repository**
- [x] **README with complete documentation**
- [x] **Technical documentation and user guide**
- [x] **Minimum 30 meaningful commits**
- [x] **Demo Day presentation prepared**

### Core Requirements
- **Live Demo Link:** [zkash-swap.vercel.app](https://zkash-swap.vercel.app)
- **30+ User Wallet Addresses:** Available in [user_feedback.csv](./user_feedback.csv) (all visible on [Stellar Testnet Explorer](https://stellar.expert/explorer/testnet/))
- **Security Checklist:** [Completed Security Audit](./docs/SECURITY.md)
- **Community Contribution:** [Twitter Product Announcement](https://x.com/zkash_swap)

### 🚀 Advanced Features Implemented
- **Fee Sponsorship:** Gasless transactions are natively supported via Stellar fee bumps for onboarding. 
- **Data Indexing:** The API includes a background indexer that syncs Soroban events to MongoDB to track wallet activities, deposits, and private pool state.

