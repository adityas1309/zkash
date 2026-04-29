# ✅ Product: Private P2P Payments + P2P Swaps on Stellar (Testnet, Real)

## 1️⃣ What You’re Building (Short)

A web app where users can:

- ✅ send **private P2P payments** in USDC or XLM
- ✅ do **private P2P swaps** (USDC ↔ XLM) with other users / verified merchants
- ✅ use email onboarding (Gmail)
- ✅ all transactions run on **Stellar testnet**
- ✅ privacy via **zero-knowledge proofs** (no mocked privacy)

---

## 2️⃣ User Flow – Onboarding (Common for All)

**Goal:** create a real Stellar wallet + private ZK wallet

**Flow:**

1. User visits web app
2. Clicks “Sign in with Google”
3. Backend:
   - creates Stellar keypair (testnet)
   - creates ZK keypair (private spending key + view key)
   - stores **encrypted** private keys in MongoDB (or user device if you go non-custodial later)

4. User sees:
   - username
   - QR code
   - private balance (starts 0)

5. App gives user a **testnet faucet button** to get XLM

---

## 3️⃣ User Flow – Private P2P Payment (USDC / XLM)

### 👤 Sender Flow (Alice)

1. Alice clicks **“Send Payment”**
2. Chooses:
   - Bob from contacts / QR / username

3. Selects asset:
   - USDC or XLM

4. Enters amount
5. Confirms
6. App:
   - builds ZK proof:
     - Alice owns private balance
     - balance ≥ amount

   - submits tx to **ShieldedPool Soroban contract**

7. Tx confirmed on Stellar testnet
8. UI updates Alice’s private balance

---

### 👤 Receiver Flow (Bob)

1. Bob opens app
2. Backend indexer listens to ShieldedPool events
3. Bob’s app scans encrypted notes
4. Bob decrypts incoming payment
5. Bob sees:
   - “Received XLM from Alice” (only if Alice chooses to reveal username)
   - amount shown only in Bob’s wallet

**Public chain sees:**

> “ShieldedPool contract updated with valid ZK proof”

---

## 4️⃣ User Flow – Private P2P Swap (USDC ↔ XLM)

### 👤 Alice (has USDC, wants XLM)

1. Alice clicks **“P2P Swap”**
2. Sees list of verified merchants/users:
   - Bob: rate, limits, reputation

3. Alice selects Bob
4. Enters:
   - Pay: 50 USDC
   - Receive: auto-calculated XLM

5. Sends swap request

---

### 👤 Bob (has XLM, wants USDC)

1. Bob receives swap request
2. Reviews:
   - amounts
   - counterparty rating

3. Clicks **Accept**

---

### 🔐 On-Chain Private Swap Execution

1. Alice generates ZK proof:
   - owns ≥ 50 USDC privately

2. Bob generates ZK proof:
   - owns ≥ X XLM privately

3. Both submit proofs to **ZKSwap Soroban contract**
4. Contract verifies:
   - both deposits valid

5. Contract performs **atomic private settlement**:
   - Alice gets XLM privately
   - Bob gets USDC privately

**Public chain sees:**

> ZKSwap contract executed

**Public cannot see:**

- amounts
- identities
- trading graph

---

## 5️⃣ User Flow – Merchant Listing

### 👤 Bob as Merchant

1. Bob creates offer:
   - “I sell XLM for USDC”
   - rate
   - min / max

2. Offer stored in MongoDB
3. Alice sees Bob in P2P marketplace
4. Swap flow continues privately

---

## 6️⃣ Tech Stack (No Redis, Real Stack)

### 🌐 Frontend

- **Next.js (TypeScript)**
- Tailwind CSS
- Wallet UI
- QR code scanning
- Swap UI
- Proof generation (WASM)

---

### 🧠 Backend

- **Node.js (NestJS or Express)**
- **MongoDB**
  - users
  - wallets
  - encrypted notes
  - swap offers
  - transaction metadata

- REST API:
  - `/auth/google`
  - `/users`
  - `/offers`
  - `/swap/request`
  - `/swap/accept`

---

### ⛓️ Blockchain

- **Stellar Testnet**
- **Soroban Smart Contracts**
  - ShieldedPool contract (private balances)
  - ZKSwap contract (atomic swaps)

- Stellar SDK for tx submission

---

### 🔐 ZK Stack (Real, No Mock)

- Circom:
  - private transfer circuit
  - private atomic swap circuit

- SnarkJS:
  - proof generation in browser (WASM)

- Verifier contract deployed on Soroban

---

### 📡 Indexer / Listener

- Node.js worker
- Listens to Soroban events
- Updates MongoDB
- Pushes notifications to frontend

(No Redis needed – MongoDB + polling/webhooks is fine for MVP)

---

## 7️⃣ Data Models (MongoDB)

```ts
User {
  _id
  email
  username
  stellarPublicKey
  encryptedZkKey
  reputation
}

Offer {
  _id
  merchantId
  assetIn: "USDC" | "XLM"
  assetOut: "USDC" | "XLM"
  rate
  min
  max
  active
}

Swap {
  _id
  aliceId
  bobId
  status: "requested" | "locked" | "completed" | "cancelled"
  amountIn
  amountOut
  txHash
}
```

---

## 8️⃣ What Is Real on Testnet (No Mocking)

- ✅ Real Stellar accounts
- ✅ Real USDC testnet asset
- ✅ Real Soroban contracts
- ✅ Real ZK proof generation
- ✅ Real tx submission
- ✅ Real indexer
- ❌ No fake privacy
- ❌ No mocked blockchain

---

## 🔥 Final Product Pitch

> A privacy-first P2P payments and crypto swap app on Stellar testnet that lets users send and trade USDC and XLM without exposing balances, transaction history, or counterparties — with real zero-knowledge proofs and real on-chain settlement.

---
