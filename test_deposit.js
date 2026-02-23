const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const SDK = require('@stellar/stellar-sdk');

async function testSimulateDeposit() {
    const server = new SDK.rpc.Server('https://mainnet.sorobanrpc.com');
    // The user's specific address
    const pkey = 'GCTEYX6YO6OZBEIKKNMR3UN5C4QTZBQFQC2OP43ML2LSSTP4XGFHWUKU';
    try {
        const horizon = new SDK.Horizon.Server('https://horizon.stellar.org');
        const account = await horizon.loadAccount(pkey);
        console.log(`Account Loaded. Balance:`, account.balances);

        const contractId = process.env.SHIELDED_POOL_XLM_ADDRESS;
        const contract = new SDK.Contract(contractId);

        const amountBi = 3000000n; // 0.3 units in stroops
        const lo = amountBi & BigInt('0xFFFFFFFFFFFFFFFF');
        const hi = amountBi >> 64n;

        const args = [
            SDK.nativeToScVal(SDK.Address.fromString(pkey)),
            SDK.xdr.ScVal.scvBytes(Buffer.alloc(32)), // dummy 32 bytes
            SDK.xdr.ScVal.scvBytes(Buffer.alloc(32)), // dummy 32 bytes
            SDK.xdr.ScVal.scvI128(new SDK.xdr.Int128Parts({
                lo: SDK.xdr.Uint64.fromString(lo.toString()),
                hi: SDK.xdr.Int64.fromString(hi.toString()),
            })),
        ];

        const tx = new SDK.TransactionBuilder(account, {
            fee: '10000', // Small base fee to see if it even simulates
            networkPassphrase: SDK.Networks.PUBLIC,
        })
            .addOperation(contract.call('deposit', ...args))
            .setTimeout(180)
            .build();

        console.log("Simulating...");
        const sim = await server.simulateTransaction(tx);

        if (sim.error) {
            console.error("Simulation Error:", sim.error);
        } else if (sim.result) {
            console.log("Simulation SUCCESS!");
            console.log("Min resource fee needed:", sim.minResourceFee);
            console.log("It will cost exactly:", Number(sim.minResourceFee) / 10000000, "XLM");
        } else {
            console.log("Simulation result:", sim);
        }
    } catch (e) {
        console.error("Caught error:", e?.response?.data || e.message);
    }
}

testSimulateDeposit();
