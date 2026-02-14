#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, log, symbol_short, token, vec, Address,
    Bytes, BytesN, Env, IntoVal, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NullifierUsed = 1,
    ProofFailed = 2,
    InsufficientBalance = 3,
}

const NULL_KEY: Symbol = symbol_short!("null");
const VK_KEY: Symbol = symbol_short!("vk");
const VERIFIER_KEY: Symbol = symbol_short!("verifier");
const TOKEN_KEY: Symbol = symbol_short!("token");
const ROOT_KEY: Symbol = symbol_short!("root");
const ROOTS_KEY: Symbol = symbol_short!("roots");
const COMMIT_KEY: Symbol = symbol_short!("comms");
const ADMIN_KEY: Symbol = symbol_short!("admin");

const FIXED_AMOUNT: i128 = 10_000_000; // 1 token (6 decimals)
const PUB_SIGNAL_SIZE: u32 = 32;
const N_PUB_SIGNALS: u32 = 4; // nullifierHash, withdrawnValue, stateRoot, associationRoot
const MAX_ROOTS: u32 = 16;

#[contracttype]
#[derive(Clone)]
pub struct DepositEvent {
    pub from: Address,
    pub commitment: BytesN<32>,
    pub index: u32,
    pub new_root: BytesN<32>,
}

fn push_root(env: &Env, new_root: &BytesN<32>) {
    let mut roots: Vec<BytesN<32>> = env
        .storage()
        .instance()
        .get(&ROOTS_KEY)
        .unwrap_or_else(|| Vec::new(env));
    // keep a small rolling window
    if roots.len() >= MAX_ROOTS {
        // drop oldest
        let mut shifted: Vec<BytesN<32>> = Vec::new(env);
        for i in 1..roots.len() {
            shifted.push_back(roots.get(i).unwrap());
        }
        roots = shifted;
    }
    roots.push_back(new_root.clone());
    env.storage().instance().set(&ROOTS_KEY, &roots);
}

fn parse_state_root_from_pub_signals(env: &Env, pub_signals_bytes: &Bytes) -> Result<BytesN<32>, Error> {
    // pub_signals_bytes layout: n_pub * 32 bytes big-endian field elements
    if pub_signals_bytes.len() != PUB_SIGNAL_SIZE * N_PUB_SIGNALS {
        return Err(Error::ProofFailed);
    }
    // Signals: [nullifierHash, withdrawnValue, stateRoot, associationRoot]
    // stateRoot is the 3rd public signal => bytes [64..96)
    let start = PUB_SIGNAL_SIZE * 2;
    let end = PUB_SIGNAL_SIZE * 3;
    let mut arr = [0u8; 32];
    pub_signals_bytes
        .slice(start..end)
        .copy_into_slice(&mut arr);
    Ok(BytesN::from_array(env, &arr))
}

fn parse_nullifier_hash_from_signals(env: &Env, pub_signals_bytes: &Bytes) -> Result<BytesN<32>, Error> {
    // nullifierHash is the 1st public signal => bytes [0..32)
    let start = 0;
    let end = PUB_SIGNAL_SIZE;
    let mut arr = [0u8; 32];
    pub_signals_bytes
        .slice(start..end)
        .copy_into_slice(&mut arr);
    Ok(BytesN::from_array(env, &arr))
}

#[contract]
pub struct ShieldedPool;

#[contractimpl]
impl ShieldedPool {
// ... existing initialize/deposit ... (unchanged)
    pub fn initialize(
        env: Env,
        verifier_address: Address,
        vk_bytes: soroban_sdk::Bytes,
        token_address: Address,
        admin: Address,
    ) {
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&VERIFIER_KEY, &verifier_address);
        env.storage().instance().set(&VK_KEY, &vk_bytes);
        env.storage().instance().set(&TOKEN_KEY, &token_address);
        let zero = BytesN::from_array(&env, &[0u8; 32]);
        env.storage().instance().set(&ROOT_KEY, &zero);
        let roots_init: Vec<BytesN<32>> = vec![&env, zero.clone()];
        env.storage().instance().set(&ROOTS_KEY, &roots_init);
        let commits_init: Vec<BytesN<32>> = Vec::new(&env);
        env.storage().instance().set(&COMMIT_KEY, &commits_init);
    }

    /// Deposit a fixed amount and append a new commitment.
    /// The caller must provide the new Merkle root computed off-chain from the full commitment list.
    /// This contract enforces that any later withdrawal proof's public `stateRoot` matches a stored root.
    pub fn deposit(
        env: Env,
        from: Address,
        commitment: BytesN<32>,
        new_root: BytesN<32>,
    ) -> Result<u32, Error> {
        from.require_auth();

        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&from, &env.current_contract_address(), &FIXED_AMOUNT);

        let mut commitments: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&COMMIT_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        let index: u32 = commitments.len();
        commitments.push_back(commitment.clone());
        env.storage().instance().set(&COMMIT_KEY, &commitments);

        env.storage().instance().set(&ROOT_KEY, &new_root);
        push_root(&env, &new_root);

        // Emit a typed event for indexers (deprecated API; contractevent not in SDK 25.1)
        env.events().publish(
            (symbol_short!("deposit"),),
            DepositEvent {
                from: from.clone(),
                commitment,
                index,
                new_root,
            },
        );

        Ok(index)
    }

    pub fn withdraw(
        env: Env,
        to: Address,
        proof_bytes: soroban_sdk::Bytes,
        pub_signals_bytes: soroban_sdk::Bytes,
        nullifier: BytesN<32>,
    ) -> Result<(), Error> {
        log!(&env, "ShieldedPool: withdraw called");
        //to.require_auth();

        // VALIDATE NULLIFIER: Must match the proof's public signal (index 0)
        log!(&env, "ShieldedPool: parsing nullifier");
        let signal_nullifier = parse_nullifier_hash_from_signals(&env, &pub_signals_bytes)?;
        if signal_nullifier != nullifier {
             log!(&env, "ShieldedPool: nullifier mismatch");
             return Err(Error::ProofFailed);
        }

        // Enforce that the proof's public stateRoot matches a root the pool has accepted.
        // publicSignals = [nullifierHash, withdrawnValue, stateRoot, associationRoot]
        log!(&env, "ShieldedPool: parsing state root");
        let state_root = parse_state_root_from_pub_signals(&env, &pub_signals_bytes)?;
        let roots: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&ROOTS_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        if !roots.contains(&state_root) {
            log!(&env, "ShieldedPool: state root not found");
            return Err(Error::ProofFailed);
        }

        // VERIFY PROOF
        log!(&env, "ShieldedPool: verifying proof");
        let verifier_address: Address = env.storage().instance().get(&VERIFIER_KEY).unwrap();
        let vk_bytes: soroban_sdk::Bytes = env.storage().instance().get(&VK_KEY).unwrap();
        let verified: bool = env
            .invoke_contract::<bool>(
                &verifier_address,
                &symbol_short!("verify"),
                vec![
                    &env,
                    vk_bytes.into_val(&env),
                    proof_bytes.into_val(&env),
                    pub_signals_bytes.into_val(&env),
                ],
            )
            .try_into()
            .map_err(|_| Error::ProofFailed)?;
        if !verified {
            return Err(Error::ProofFailed);
        }

        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        let balance = token_client.balance(&env.current_contract_address());
        if balance < FIXED_AMOUNT {
            return Err(Error::InsufficientBalance);
        }

        let mut nullifiers: Vec<BytesN<32>> =
            env.storage().instance().get(&NULL_KEY).unwrap_or_else(|| Vec::new(&env));
        if nullifiers.contains(&nullifier) {
            return Err(Error::NullifierUsed);
        }

        nullifiers.push_back(nullifier);
        env.storage().instance().set(&NULL_KEY, &nullifiers);

        token_client.transfer(&env.current_contract_address(), &to, &FIXED_AMOUNT);

        log!(&env, "Withdrawal successful");
        Ok(())
    }

    pub fn transfer(
        env: Env,
        proof_bytes: soroban_sdk::Bytes,
        pub_signals_bytes: soroban_sdk::Bytes,
        nullifier: BytesN<32>,
        new_commitment: BytesN<32>,
        new_root: BytesN<32>,
    ) -> Result<u32, Error> {
        log!(&env, "ShieldedPool: transfer called");

        // VALIDATE NULLIFIER: Must match the proof's public signal (index 0)
        let signal_nullifier = parse_nullifier_hash_from_signals(&env, &pub_signals_bytes)?;
        if signal_nullifier != nullifier {
             log!(&env, "ShieldedPool: nullifier mismatch");
             return Err(Error::ProofFailed);
        }

        // Enforce that the proof's public stateRoot matches a root the pool has accepted.
        // publicSignals = [nullifierHash, withdrawnValue, stateRoot, associationRoot]
        let state_root = parse_state_root_from_pub_signals(&env, &pub_signals_bytes)?;
        let roots: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&ROOTS_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        if !roots.contains(&state_root) {
            log!(&env, "ShieldedPool: state root not found");
            return Err(Error::ProofFailed);
        }

        // VERIFY PROOF
        log!(&env, "ShieldedPool: verifying proof");
        let verifier_address: Address = env.storage().instance().get(&VERIFIER_KEY).unwrap();
        let vk_bytes: soroban_sdk::Bytes = env.storage().instance().get(&VK_KEY).unwrap();
        let verified: bool = env
            .invoke_contract::<bool>(
                &verifier_address,
                &symbol_short!("verify"),
                vec![
                    &env,
                    vk_bytes.into_val(&env),
                    proof_bytes.into_val(&env),
                    pub_signals_bytes.into_val(&env),
                ],
            )
            .try_into()
            .map_err(|_| Error::ProofFailed)?;
        if !verified {
            return Err(Error::ProofFailed);
        }

        // CHECK NULLIFIER UNUSED
        let mut nullifiers: Vec<BytesN<32>> =
            env.storage().instance().get(&NULL_KEY).unwrap_or_else(|| Vec::new(&env));
        if nullifiers.contains(&nullifier) {
            return Err(Error::NullifierUsed);
        }
        nullifiers.push_back(nullifier);
        env.storage().instance().set(&NULL_KEY, &nullifiers);

        // ADD NEW COMMITMENT (Note Minting)
        let mut commitments: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&COMMIT_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        let index: u32 = commitments.len();
        commitments.push_back(new_commitment.clone());
        env.storage().instance().set(&COMMIT_KEY, &commitments);

        env.storage().instance().set(&ROOT_KEY, &new_root);
        push_root(&env, &new_root);
        
        // Emit DepositEvent for indexers
        // The funds are technically "moved" within the pool by the contract itself.
        // We use the contract address as the 'from' source to indicate an internal transfer/mint.
        let pool_address = env.current_contract_address();
        
        env.events().publish(
            (symbol_short!("transfer"),),
            DepositEvent {
                from: pool_address, 
                commitment: new_commitment,
                index,
                new_root,
            },
        );

        log!(&env, "Transfer successful");
        Ok(index)
    }

    pub fn get_merkle_root(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&ROOT_KEY)
            .unwrap_or(BytesN::from_array(&env, &[0u8; 32]))
    }

    /// Debug / indexing: get all commitments in insertion order.
    pub fn get_commitments(env: Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&COMMIT_KEY).unwrap_or_else(|| Vec::new(&env))
    }

    /// Debug: get the recent accepted roots window.
    pub fn get_recent_roots(env: Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&ROOTS_KEY).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_nullifiers(env: Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&NULL_KEY).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_balance(env: Env) -> i128 {
        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.balance(&env.current_contract_address())
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&ADMIN_KEY).unwrap()
    }
}
