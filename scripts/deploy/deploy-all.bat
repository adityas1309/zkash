@echo off
setlocal

for %%I in ("%~dp0..\..") do set "REPO_ROOT=%%~fI"
pushd "%REPO_ROOT%" || exit /b 1

set "NETWORK=%~1"
if "%NETWORK%"=="" set "NETWORK=testnet"
set "SOURCE=%~2"
if "%SOURCE%"=="" set "SOURCE=deployer"
set "DEPLOYMENTS_DIR=%REPO_ROOT%\deployments"
if not exist "%DEPLOYMENTS_DIR%" mkdir "%DEPLOYMENTS_DIR%"

echo ================================
echo Building Groth16 Verifier
echo ================================
pushd packages\contracts\groth16_verifier
call stellar contract build
popd

echo ================================
echo Building Shielded Pool
echo ================================
pushd packages\contracts\shielded_pool
call stellar contract build
popd

echo ================================
echo Building ZK Swap
echo ================================
pushd packages\contracts\zk_swap
call stellar contract build
popd

echo ================================
echo Deploying Groth16Verifier...
echo ================================
call stellar contract deploy --wasm packages/contracts/groth16_verifier/target/wasm32v1-none/release/groth16_verifier.wasm --source %SOURCE% --network %NETWORK% > "%DEPLOYMENTS_DIR%\verifier_address.txt"
set /p VERIFIER_ADDR=<"%DEPLOYMENTS_DIR%\verifier_address.txt"
echo Verifier Deployed: %VERIFIER_ADDR%

echo ================================
echo Deploying ShieldedPool...
echo ================================
call stellar contract deploy --wasm packages/contracts/shielded_pool/target/wasm32v1-none/release/shielded_pool.wasm --source %SOURCE% --network %NETWORK% > "%DEPLOYMENTS_DIR%\shielded_pool_address.txt"
set /p POOL_ADDR=<"%DEPLOYMENTS_DIR%\shielded_pool_address.txt"
echo ShieldedPool Deployed: %POOL_ADDR%

echo ================================
echo Deploying ZKSwap...
echo ================================
call stellar contract deploy --wasm packages/contracts/zk_swap/target/wasm32v1-none/release/zk_swap.wasm --source %SOURCE% --network %NETWORK% > "%DEPLOYMENTS_DIR%\zk_swap_address.txt"
set /p ZKSWAP_ADDR=<"%DEPLOYMENTS_DIR%\zk_swap_address.txt"
echo ZKSwap Deployed: %ZKSWAP_ADDR%

echo.
echo ================================
echo Deployment Complete.
echo ================================
echo Update your .env file with these addresses:
echo GROTH16_VERIFIER_ADDRESS=%VERIFIER_ADDR%
echo SHIELDED_POOL_ADDRESS=%POOL_ADDR%
echo ZK_SWAP_ADDRESS=%ZKSWAP_ADDR%
echo.
echo Address files saved in %DEPLOYMENTS_DIR%

popd
