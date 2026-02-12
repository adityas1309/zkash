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
    pub fn execute(
        env: Env,
        alice: Address,
        bob: Address,
        params: SwapParams,
        alice_proof: soroban_sdk::Bytes,
        alice_pub_signals: soroban_sdk::Bytes,
        alice_nullifier: BytesN<32>,
        bob_proof: soroban_sdk::Bytes,
        bob_pub_signals: soroban_sdk::Bytes,
        bob_nullifier: BytesN<32>,
    ) -> Result<(), Error> {
        soroban_sdk::log!(&env, "ZkSwap: execute called"); // Top-level log
        
        alice.require_auth();
        bob.require_auth();
        
        soroban_sdk::log!(&env, "ZkSwap: auth verified");
        soroban_sdk::log!(&env, "ZkSwap: calling USDC withdraw");

        // USDC pool: Alice's note -> withdraw to Bob
        env.invoke_contract::<()>(
            &params.usdc_pool,
            &symbol_short!("withdraw"),
            vec![
                &env,
                bob.into_val(&env),
                alice_proof.into_val(&env),
                alice_pub_signals.into_val(&env),
                alice_nullifier.into_val(&env),
            ],
        );

        soroban_sdk::log!(&env, "ZkSwap: calling XLM withdraw");

        // XLM pool: Bob's note -> withdraw to Alice
        env.invoke_contract::<()>(
            &params.xlm_pool,
            &symbol_short!("withdraw"),
            vec![
                &env,
                alice.into_val(&env),
                bob_proof.into_val(&env),
                bob_pub_signals.into_val(&env),
                bob_nullifier.into_val(&env),
            ],
        );

        soroban_sdk::log!(&env, "ZkSwap: execute finished");

        Ok(())
    }
}
