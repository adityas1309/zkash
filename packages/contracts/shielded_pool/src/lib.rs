#![no_std]

mod poseidon;

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
    AlreadyInitialized = 4,
    NotInitialized = 5,
    InvalidAmount = 6,
    InvalidRootTransition = 7,
    RecipientBindingMismatch = 8,
}

const NULL_KEY: Symbol = symbol_short!("null");
const VK_KEY: Symbol = symbol_short!("vk");
const VERIFIER_KEY: Symbol = symbol_short!("verifier");
const TOKEN_KEY: Symbol = symbol_short!("token");
const ROOT_KEY: Symbol = symbol_short!("root");
const ROOTS_KEY: Symbol = symbol_short!("roots");
const COMMIT_KEY: Symbol = symbol_short!("comms");
const ADMIN_KEY: Symbol = symbol_short!("admin");

// const FIXED_AMOUNT: i128 = 10_000_000; // REMOVED
const PUB_SIGNAL_SIZE: u32 = 32;
const N_PUB_SIGNALS: u32 = 5; // nullifierHash, withdrawnValue, stateRoot, associationRoot, binding
const N_PUB_SIGNALS_TRANSFER: u32 = 5; // binding is the outputCommitment
const BINDING_SIGNAL_INDEX: u32 = 4;
const MAX_ROOTS: u32 = 16;

#[contracttype]
#[derive(Clone)]
pub struct DepositEvent {
    pub from: Address,
    pub commitment: BytesN<32>,
    pub index: u32,
    pub new_root: BytesN<32>,
    pub amount: i128,
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

fn current_root(env: &Env) -> BytesN<32> {
    env.storage()
        .instance()
        .get(&ROOT_KEY)
        .unwrap_or(BytesN::from_array(env, &[0u8; 32]))
}

fn ensure_current_root_transition(
    env: &Env,
    previous_root: &BytesN<32>,
    new_root: &BytesN<32>,
) -> Result<(), Error> {
    let stored_root = current_root(env);
    if stored_root != previous_root.clone() || previous_root == new_root {
        return Err(Error::InvalidRootTransition);
    }
    Ok(())
}

fn require_initialized(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&ADMIN_KEY)
        .ok_or(Error::NotInitialized)
}

fn ensure_pub_signal_count(pub_signals_bytes: &Bytes, n_pub_signals: u32) -> Result<(), Error> {
    // pub_signals_bytes layout: n_pub * 32 bytes big-endian field elements
    if pub_signals_bytes.len() != PUB_SIGNAL_SIZE * n_pub_signals {
        return Err(Error::ProofFailed);
    }
    Ok(())
}

fn parse_signal_bytes(
    env: &Env,
    pub_signals_bytes: &Bytes,
    n_pub_signals: u32,
    signal_index: u32,
) -> Result<BytesN<32>, Error> {
    ensure_pub_signal_count(pub_signals_bytes, n_pub_signals)?;
    let start = PUB_SIGNAL_SIZE * signal_index;
    let end = start + PUB_SIGNAL_SIZE;
    let mut arr = [0u8; 32];
    pub_signals_bytes
        .slice(start..end)
        .copy_into_slice(&mut arr);
    Ok(BytesN::from_array(env, &arr))
}

fn parse_state_root_from_pub_signals(
    env: &Env,
    pub_signals_bytes: &Bytes,
    n_pub_signals: u32,
) -> Result<BytesN<32>, Error> {
    // Signals: [nullifierHash, withdrawnValue, stateRoot, associationRoot]
    // stateRoot is the 3rd public signal => bytes [64..96)
    parse_signal_bytes(env, pub_signals_bytes, n_pub_signals, 2)
}

fn parse_nullifier_hash_from_signals(
    env: &Env,
    pub_signals_bytes: &Bytes,
    n_pub_signals: u32,
) -> Result<BytesN<32>, Error> {
    // nullifierHash is the 1st public signal => bytes [0..32)
    parse_signal_bytes(env, pub_signals_bytes, n_pub_signals, 0)
}

fn parse_withdrawn_value_from_signals(
    _env: &Env,
    pub_signals_bytes: &Bytes,
    n_pub_signals: u32,
) -> Result<i128, Error> {
    ensure_pub_signal_count(pub_signals_bytes, n_pub_signals)?;
    // withdrawnValue is the 2nd public signal => bytes [32..64)
    let start = PUB_SIGNAL_SIZE;
    let end = PUB_SIGNAL_SIZE * 2;
    let mut arr = [0u8; 32];
    pub_signals_bytes
        .slice(start..end)
        .copy_into_slice(&mut arr);

    // Convert [u8; 32] big-endian to i128.
    // Since i128 is 16 bytes, we take the last 16 bytes.
    // We assume high bytes are 0 (valid for reasonable token amounts).
    let mut val_bytes = [0u8; 16];
    val_bytes.copy_from_slice(&arr[16..32]);
    let val = i128::from_be_bytes(val_bytes);
    Ok(val)
}

fn parse_output_commitment_from_signals(
    env: &Env,
    pub_signals_bytes: &Bytes,
) -> Result<BytesN<32>, Error> {
    parse_signal_bytes(
        env,
        pub_signals_bytes,
        N_PUB_SIGNALS_TRANSFER,
        BINDING_SIGNAL_INDEX,
    )
}

fn parse_binding_from_signals(
    env: &Env,
    pub_signals_bytes: &Bytes,
    n_pub_signals: u32,
) -> Result<BytesN<32>, Error> {
    parse_signal_bytes(env, pub_signals_bytes, n_pub_signals, BINDING_SIGNAL_INDEX)
}

fn recipient_binding(env: &Env, to: &Address) -> BytesN<32> {
    let address_string = to.to_string();
    let address_bytes: Bytes = (&address_string).into();
    let hash = env.crypto().sha256(&address_bytes).to_bytes();
    let mut arr = hash.to_array();
    // Match the API: keep the binding inside the BLS12-381 scalar field.
    arr[0] = 0;
    BytesN::from_array(env, &arr)
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
    ) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage()
            .instance()
            .set(&VERIFIER_KEY, &verifier_address);
        env.storage().instance().set(&VK_KEY, &vk_bytes);
        env.storage().instance().set(&TOKEN_KEY, &token_address);
        let zero = BytesN::from_array(&env, &[0u8; 32]);
        env.storage().instance().set(&ROOT_KEY, &zero);
        let roots_init: Vec<BytesN<32>> = vec![&env, zero.clone()];
        env.storage().instance().set(&ROOTS_KEY, &roots_init);
        let commits_init: Vec<BytesN<32>> = Vec::new(&env);
        env.storage().instance().set(&COMMIT_KEY, &commits_init);
        Ok(())
    }

    /// Deposit a variable `amount` and append a new commitment.
    /// The caller provides the new Merkle root computed off-chain, anchored to
    /// the current root so stale append races cannot overwrite pool state.
    pub fn deposit(
        env: Env,
        from: Address,
        commitment: BytesN<32>,
        previous_root: BytesN<32>,
        new_root: BytesN<32>,
        amount: i128,
    ) -> Result<u32, Error> {
        let admin = require_initialized(&env)?;
        from.require_auth();
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        ensure_current_root_transition(&env, &previous_root, &new_root)?;

        let token_address: Address = env.storage().instance().get(&TOKEN_KEY).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        let mut commitments: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&COMMIT_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        let index: u32 = commitments.len();
        commitments.push_back(commitment.clone());
        if poseidon::compute_root_from_commitments(&env, &commitments) != new_root {
            return Err(Error::InvalidRootTransition);
        }
        env.storage().instance().set(&COMMIT_KEY, &commitments);

        env.storage().instance().set(&ROOT_KEY, &new_root);
        push_root(&env, &new_root);

        // Emit a typed event for indexers
        env.events().publish(
            (symbol_short!("deposit"),),
            DepositEvent {
                from: from.clone(),
                commitment,
                index,
                new_root,
                amount,
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
        require_initialized(&env)?;
        log!(&env, "ShieldedPool: withdraw called");
        to.require_auth();

        // VALIDATE NULLIFIER
        let signal_nullifier =
            parse_nullifier_hash_from_signals(&env, &pub_signals_bytes, N_PUB_SIGNALS)?;
        if signal_nullifier != nullifier {
            log!(&env, "ShieldedPool: nullifier mismatch");
            return Err(Error::ProofFailed);
        }

        let signal_binding = parse_binding_from_signals(&env, &pub_signals_bytes, N_PUB_SIGNALS)?;
        if signal_binding != recipient_binding(&env, &to) {
            log!(&env, "ShieldedPool: recipient binding mismatch");
            return Err(Error::RecipientBindingMismatch);
        }

        // PARSE AMOUNT (withdrawnValue)
        let amount = parse_withdrawn_value_from_signals(&env, &pub_signals_bytes, N_PUB_SIGNALS)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Enforce that the proof's public stateRoot matches a root the pool has accepted.
        let state_root =
            parse_state_root_from_pub_signals(&env, &pub_signals_bytes, N_PUB_SIGNALS)?;
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
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let mut nullifiers: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&NULL_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        if nullifiers.contains(&nullifier) {
            return Err(Error::NullifierUsed);
        }

        nullifiers.push_back(nullifier);
        env.storage().instance().set(&NULL_KEY, &nullifiers);

        token_client.transfer(&env.current_contract_address(), &to, &amount);

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
        expected_amount: i128,
    ) -> Result<u32, Error> {
        let admin = require_initialized(&env)?;
        log!(&env, "ShieldedPool: transfer called");
        admin.require_auth();

        // VALIDATE NULLIFIER: Must match the proof's public signal (index 0)
        let signal_nullifier =
            parse_nullifier_hash_from_signals(&env, &pub_signals_bytes, N_PUB_SIGNALS_TRANSFER)?;
        if signal_nullifier != nullifier {
            log!(&env, "ShieldedPool: nullifier mismatch");
            return Err(Error::ProofFailed);
        }

        let withdrawn_amount =
            parse_withdrawn_value_from_signals(&env, &pub_signals_bytes, N_PUB_SIGNALS_TRANSFER)?;
        if withdrawn_amount <= 0 || withdrawn_amount != expected_amount {
            log!(&env, "ShieldedPool: transfer amount mismatch");
            return Err(Error::InvalidAmount);
        }

        let signal_output_commitment =
            parse_output_commitment_from_signals(&env, &pub_signals_bytes)?;
        if signal_output_commitment != new_commitment {
            log!(&env, "ShieldedPool: output commitment mismatch");
            return Err(Error::ProofFailed);
        }

        // Enforce that the proof's public stateRoot matches a root the pool has accepted.
        // publicSignals = [nullifierHash, withdrawnValue, stateRoot, associationRoot, outputCommitment]
        let state_root =
            parse_state_root_from_pub_signals(&env, &pub_signals_bytes, N_PUB_SIGNALS_TRANSFER)?;
        let roots: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&ROOTS_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        if !roots.contains(&state_root) {
            log!(&env, "ShieldedPool: state root not found");
            return Err(Error::ProofFailed);
        }
        ensure_current_root_transition(&env, &state_root, &new_root)?;

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
        let mut nullifiers: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&NULL_KEY)
            .unwrap_or_else(|| Vec::new(&env));
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
        if poseidon::compute_root_from_commitments(&env, &commitments) != new_root {
            return Err(Error::InvalidRootTransition);
        }
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
                amount: withdrawn_amount,
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
        env.storage()
            .instance()
            .get(&COMMIT_KEY)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Debug: get the recent accepted roots window.
    pub fn get_recent_roots(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&ROOTS_KEY)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_nullifiers(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&NULL_KEY)
            .unwrap_or_else(|| Vec::new(&env))
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
