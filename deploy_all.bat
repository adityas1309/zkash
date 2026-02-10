@echo off

echo ================================
echo Building Groth16 Verifier
echo ================================
cd packages/contracts/groth16_verifier
call stellar contract build
cd ../../..

echo ================================
echo Building Shielded Pool
echo ================================
cd packages/contracts/shielded_pool
call stellar contract build
cd ../../..

echo ================================
echo Building ZK Swap
echo ================================
cd packages/contracts/zk_swap
call stellar contract build
cd ../../..

echo ================================
echo Deploying Groth16Verifier...
echo ================================
call stellar contract deploy --wasm packages/contracts/groth16_verifier/target/wasm32v1-none/release/groth16_verifier.wasm --source deployer --network testnet > verifier_address.txt
set /p VERIFIER_ADDR=<verifier_address.txt
echo Verifier Deployed: %VERIFIER_ADDR%

echo ================================
echo Deploying ShieldedPool...
echo ================================
call stellar contract deploy --wasm packages/contracts/shielded_pool/target/wasm32v1-none/release/shielded_pool.wasm --source deployer --network testnet > shielded_pool_address.txt
set /p POOL_ADDR=<shielded_pool_address.txt
echo ShieldedPool Deployed: %POOL_ADDR%

echo ================================
echo Deploying ZKSwap...
echo ================================
call stellar contract deploy --wasm packages/contracts/zk_swap/target/wasm32v1-none/release/zk_swap.wasm --source deployer --network testnet > zk_swap_address.txt
set /p ZKSWAP_ADDR=<zk_swap_address.txt
echo ZKSwap Deployed: %ZKSWAP_ADDR%

echo.
echo ================================
echo Deployment Complete.
echo ================================
echo Update your .env file with these addresses:
echo GROTH16_VERIFIER_ADDRESS=%VERIFIER_ADDR%
echo SHIELDED_POOL_ADDRESS=%POOL_ADDR%
echo ZK_SWAP_ADDRESS=%ZKSWAP_ADDR%
