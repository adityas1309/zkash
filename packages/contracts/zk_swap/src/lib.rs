#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, BytesN, Env, IntoVal};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Generic = 1,
    WithdrawFailed = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct SwapParams {
    pub usdc_pool: Address,
    pub xlm_pool: Address,
    pub amount_usdc: i64,
    pub amount_xlm: i64,
}

#[contract]
pub struct ZkSwap;

#[contractimpl]
impl ZkSwap {
    /// Atomic swap: Alice's USDC note -> Bob, Bob's XLM note -> Alice.
    /// Both parties must have signed. Pools verify the ZK proofs internally.
    /// Atomic swap: Alice's USDC note -> Bob, Bob's XLM note -> Alice.
    /// Both parties must have signed. Pools verify the ZK proofs internally.
    /// 
    /// PRIVACY UPDATE:
    /// No explicit "Alice" or "Bob" addresses.
    /// Authorization is purely ZK proof possession.
    /// Both parties output a new commitment for the counterparty.
    pub fn execute(
        env: Env,
        params: SwapParams,
        // Alice (USDC Holder) Inputs
        alice_proof: soroban_sdk::Bytes,
        alice_pub_signals: soroban_sdk::Bytes,
        alice_nullifier: BytesN<32>,
        alice_output_commitment: BytesN<32>, // New XLM note for Alice
        alice_output_root: BytesN<32>,       // New XLM root
        // Bob (XLM Holder) Inputs
        bob_proof: soroban_sdk::Bytes,
        bob_pub_signals: soroban_sdk::Bytes,
        bob_nullifier: BytesN<32>,
        bob_output_commitment: BytesN<32>,   // New USDC note for Bob
        bob_output_root: BytesN<32>,         // New USDC root
    ) -> Result<(), Error> {
        soroban_sdk::log!(&env, "ZkSwap: execute called (anonymous)");

        // Note: No require_auth(). The proofs are the auth.

        // 1. Withdraw/Transfer from USDC Pool
        // Alice spends 1 USDC note (nullifier) -> Creates 1 USDC note for Bob (bob_output_commitment)
        // Wait... standard transfer burns input and creates output in SAME pool.
        // For Swap:
        // Alice burns USDC note -> Bob gets USDC note.
        // Bob burns XLM note -> Alice gets XLM note.
        
        // Step 1: Alice burns USDC note, Bob gets new USDC note.
        // We call usdc_pool.transfer(proof=alice, new_commitment=bob_output_commitment)
        soroban_sdk::log!(&env, "ZkSwap: internal transfer USDC -> Bob");
        env.invoke_contract::<u32>(
            &params.usdc_pool,
            &symbol_short!("transfer"),
            vec![
                &env,
                alice_proof.into_val(&env),
                alice_pub_signals.into_val(&env),
                alice_nullifier.into_val(&env),
                bob_output_commitment.into_val(&env),
                bob_output_root.into_val(&env),
            ],
        );

        // Step 2: Bob burns XLM note, Alice gets new XLM note.
        // We call xlm_pool.transfer(proof=bob, new_commitment=alice_output_commitment)
        soroban_sdk::log!(&env, "ZkSwap: internal transfer XLM -> Alice");
        env.invoke_contract::<u32>(
            &params.xlm_pool,
            &symbol_short!("transfer"),
            vec![
                &env,
                bob_proof.into_val(&env),
                bob_pub_signals.into_val(&env),
                bob_nullifier.into_val(&env),
                alice_output_commitment.into_val(&env),
                alice_output_root.into_val(&env),
            ],
        );

        soroban_sdk::log!(&env, "ZkSwap: execute finished");

        Ok(())
    }
}
