const SDK = require('@stellar/stellar-sdk');
const fs = require('fs');

async function checkDeployFee() {
  try {
    const server = new SDK.rpc.Server('https://mainnet.sorobanrpc.com');
    const networkPassphrase = SDK.Networks.PUBLIC;

    // Freighter public key
    const publicKey = 'GCQ2FDVZLLZRDFMAFVB3SAOEGHAP6NH5CQX2UYZ6KLYGYSFAHUMJEUCL';

    console.log(`Checking deploy cost for groth16_verifier...`);
    const wasm = fs.readFileSync(
      'packages/contracts/groth16_verifier/target/wasm32v1-none/release/groth16_verifier.wasm',
    );

    // Get account sequence
    const account = await new SDK.Horizon.Server('https://horizon.stellar.org').loadAccount(
      publicKey,
    );

    const tx = new SDK.TransactionBuilder(account, {
      fee: '100', // Baseline fee, the simulator replaces this
      networkPassphrase,
    })
      .addOperation(SDK.Operation.uploadContractWasm({ wasm }))
      .setTimeout(300)
      .build();

    const sim = await server.simulateTransaction(tx);

    if (sim.error) {
      console.error('Simulation Error:', sim.error);
      return;
    }

    const totalCostVstroops = BigInt(sim.minResourceFee) + BigInt(sim.events?.length ? 10000 : 0);
    // 1 XLM = 10,000,000 stroops
    const costXLM = Number(totalCostVstroops) / 10000000;

    console.log(`\nEstimated cost to deploy ONLY Groth16 Verifier: ~${costXLM} XLM`);
    console.log(`You have 3 contracts to deploy, plus contract instantiations.`);
    console.log(`Total recommended XLM for deployment: ~${Math.ceil(costXLM * 4)} XLM`);
  } catch (e) {
    console.error('Error:', e.response?.data || e.message);
  }
}

checkDeployFee();
