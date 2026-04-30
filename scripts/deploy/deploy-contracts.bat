@echo off
setlocal

for %%I in ("%~dp0..\..") do set "REPO_ROOT=%%~fI"
pushd "%REPO_ROOT%" || exit /b 1

set "NETWORK=%~1"
if "%NETWORK%"=="" set "NETWORK=testnet"
set "DEPLOYMENTS_DIR=%REPO_ROOT%\deployments"
if not exist "%DEPLOYMENTS_DIR%" mkdir "%DEPLOYMENTS_DIR%"

echo Deploying ShieldedPool...
call stellar contract deploy --wasm packages/contracts/shielded_pool/target/wasm32-unknown-unknown/release/shielded_pool.wasm --source deployer --network %NETWORK% > "%DEPLOYMENTS_DIR%\shielded_pool_address.txt"
echo ShieldedPool Deployed. Address saved to deployments\shielded_pool_address.txt

echo Deploying ZKSwap...
call stellar contract deploy --wasm packages/contracts/zk_swap/target/wasm32-unknown-unknown/release/zk_swap.wasm --source deployer --network %NETWORK% > "%DEPLOYMENTS_DIR%\zk_swap_address.txt"
echo ZKSwap Deployed. Address saved to deployments\zk_swap_address.txt

popd
