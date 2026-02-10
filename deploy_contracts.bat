@echo off
echo Deploying ShieldedPool...
call stellar contract deploy --wasm packages/contracts/shielded_pool/target/wasm32-unknown-unknown/release/shielded_pool.wasm --source deployer --network testnet > shielded_pool_address.txt
echo ShieldedPool Deployed. Address saved to shielded_pool_address.txt

echo Deploying ZKSwap...
call stellar contract deploy --wasm packages/contracts/zk_swap/target/wasm32-unknown-unknown/release/zk_swap.wasm --source deployer --network testnet > zk_swap_address.txt
echo ZKSwap Deployed. Address saved to zk_swap_address.txt
