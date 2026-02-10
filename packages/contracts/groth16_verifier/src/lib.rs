#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, vec,
    crypto::bn254::{
        Bn254G1Affine, Bn254G2Affine, Fr,
        BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE,
    },
    BytesN, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    MalformedProof = 1,
    MalformedVk = 2,
    MalformedPubSignals = 3,
}

const FR_SIZE: usize = 32;

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Verify a Groth16 proof (BN254). All bytes in Ethereum/snarkjs-compatible format.
    /// vk_bytes: alpha(64) || beta(128) || gamma(128) || delta(128) || ic[0..](64 each). ic has (1 + n_pub) points.
    /// proof_bytes: a(64) || b(128) || c(64)
    /// pub_signals_bytes: concat of big-endian Fr (32 bytes each), length = n_pub.
    pub fn verify(
        env: Env,
        vk_bytes: soroban_sdk::Bytes,
        proof_bytes: soroban_sdk::Bytes,
        pub_signals_bytes: soroban_sdk::Bytes,
    ) -> Result<bool, Error> {
        // Proof: a (64) + b (128) + c (64) = 256
        if proof_bytes.len() != (BN254_G1_SERIALIZED_SIZE + BN254_G2_SERIALIZED_SIZE + BN254_G1_SERIALIZED_SIZE) as u32 {
            return Err(Error::MalformedProof);
        }
        let mut a_bytes = [0u8; BN254_G1_SERIALIZED_SIZE];
        proof_bytes.slice(0..BN254_G1_SERIALIZED_SIZE as u32).copy_into_slice(&mut a_bytes);
        let mut b_bytes = [0u8; BN254_G2_SERIALIZED_SIZE];
        proof_bytes
            .slice(BN254_G1_SERIALIZED_SIZE as u32..(BN254_G1_SERIALIZED_SIZE + BN254_G2_SERIALIZED_SIZE) as u32)
            .copy_into_slice(&mut b_bytes);
        let mut c_bytes = [0u8; BN254_G1_SERIALIZED_SIZE];
        proof_bytes
            .slice((BN254_G1_SERIALIZED_SIZE + BN254_G2_SERIALIZED_SIZE) as u32..)
            .copy_into_slice(&mut c_bytes);

        let a = Bn254G1Affine::from_array(&env, &a_bytes);
        let b = Bn254G2Affine::from_array(&env, &b_bytes);
        let c = Bn254G1Affine::from_array(&env, &c_bytes);

        if pub_signals_bytes.len() % FR_SIZE as u32 != 0 {
            return Err(Error::MalformedPubSignals);
        }
        let n_pub = (pub_signals_bytes.len() / FR_SIZE as u32) as usize;
        let mut pub_signals: Vec<Fr> = Vec::new(&env);
        for i in 0..n_pub {
            let start = (i * FR_SIZE) as u32;
            let end = start + FR_SIZE as u32;
            let mut fr_bytes = [0u8; FR_SIZE];
            pub_signals_bytes.slice(start..end).copy_into_slice(&mut fr_bytes);
            let fr = Fr::from_bytes(BytesN::from_array(&env, &fr_bytes));
            pub_signals.push_back(fr);
        }

        // VK: alpha(64) + beta(128) + gamma(128) + delta(128) + ic (4 * 64 for n_pub=3)
        let ic_len = n_pub + 1;
        let vk_min_len = 64 + 128 * 3 + ic_len * 64;
        if vk_bytes.len() < vk_min_len as u32 {
            return Err(Error::MalformedVk);
        }
        let mut offset: u32 = 0;
        let mk_g1 = |o: &mut u32| -> Result<Bn254G1Affine, Error> {
            let mut arr = [0u8; BN254_G1_SERIALIZED_SIZE];
            vk_bytes.slice(*o..*o + BN254_G1_SERIALIZED_SIZE as u32).copy_into_slice(&mut arr);
            *o += BN254_G1_SERIALIZED_SIZE as u32;
            Ok(Bn254G1Affine::from_array(&env, &arr))
        };
        let mk_g2 = |o: &mut u32| -> Result<Bn254G2Affine, Error> {
            let mut arr = [0u8; BN254_G2_SERIALIZED_SIZE];
            vk_bytes.slice(*o..*o + BN254_G2_SERIALIZED_SIZE as u32).copy_into_slice(&mut arr);
            *o += BN254_G2_SERIALIZED_SIZE as u32;
            Ok(Bn254G2Affine::from_array(&env, &arr))
        };
        let alpha = mk_g1(&mut offset)?;
        let beta = mk_g2(&mut offset)?;
        let gamma = mk_g2(&mut offset)?;
        let delta = mk_g2(&mut offset)?;
        let mut ic: Vec<Bn254G1Affine> = Vec::new(&env);
        for _ in 0..ic_len {
            ic.push_back(mk_g1(&mut offset)?);
        }

        let bn = env.crypto().bn254();
        let mut vk_x = ic.get(0).ok_or(Error::MalformedVk)?.clone();
        for (s, v) in pub_signals.iter().zip(ic.iter().skip(1)) {
            let prod = bn.g1_mul(&v, &s);
            vk_x = bn.g1_add(&vk_x, &prod);
        }
        let neg_a = -a;
        let vp1 = vec![&env, neg_a, alpha, vk_x, c];
        let vp2 = vec![&env, b, beta, gamma, delta];
        Ok(bn.pairing_check(vp1, vp2))
    }
}
