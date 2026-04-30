# How to Test P2P Swap and Payment

## Prerequisites

1.  **Two Google Accounts**: You need two different Google accounts to simulate two different users.
    - **User A**: Acts as the seller/sender.
    - **User B**: Acts as the buyer/receiver.
2.  **Two Browsers**: Use **Chrome** for User A and an **Incognito Window** (or Edge/Firefox) for User B.

## Step 1: Request Funds (Faucet)

1.  Log in as **User A**.
2.  Navigate to the **Wallet** page (`/wallet`).
3.  Click the **"Get XLM (Faucet)"** button.
    - Wait for a few seconds.
    - You should see your **XLM** balance increase by 10,000.
4.  (Optional) Click **"Get USDC (Circle)"** to open the Circle faucet.
    - Copy your "Stellar Address" from the Wallet page.
    - Paste it into the Circle Faucet to get testnet USDC.
5.  Repeat these steps for **User B** in the Incognito window.

## Step 2: Create a Swap Offer (User A)

1.  As **User A**, go to the **P2P Swap** page (`/swap`).
2.  Click **"Create Offer"**.
3.  Fill in the details:
    - **Sell**: XLM
    - **Buy**: USDC
    - **Amount**: 10 (or any amount you have)
    - **Rate**: 0.1 (Price of 1 XLM in USDC)
    - **Min**: 1
    - **Max**: 100
4.  Click **Create**.
5.  You should be redirected to the offer details page.

## Step 3: Accept Swap (User B)

1.  As **User B**, go to the **P2P Swap** page (`/swap`).
2.  You should see the offer created by User A in the list.
3.  Click **"Swap"** on that offer.
4.  Enter the amount of XLM you want to buy (e.g., 5).
5.  The system will calculate the required USDC.
6.  Click **"Confirm Swap"**.
7.  Wait for the transaction to complete.

## Step 4: Verify Balances

1.  Go to the **Wallet** page for both users.
2.  **User A** should have _less_ XLM and _more_ USDC.
3.  **User B** should have _more_ XLM and _less_ USDC.

## Troubleshooting

- **Faucet not working?** Check the terminal logs for `[Faucet] Error`. It might be due to network rate limits on the testnet.
- **Balance not updating?** Refresh the page. The indexer might take a few seconds to verify the transaction.
