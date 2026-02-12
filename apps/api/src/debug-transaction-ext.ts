
import * as StellarSdk from '@stellar/stellar-sdk';

async function run() {
    console.log('--- Debugging TransactionExt ---');

    // Check if TransactionExt exists
    if (!StellarSdk.xdr.TransactionExt) {
        console.error('StellarSdk.xdr.TransactionExt is undefined!');
        return;
    }
    console.log('TransactionExt exists.');

    // Mock SorobanTransactionData (empty resources/fees for structure test)
    // We need to construct a valid SorobanTransactionData to test.
    // Assuming SorobanTransactionData structure from viewed file:
    // [["ext", xdr.lookup("SorobanTransactionDataExt")], ["resources", xdr.lookup("SorobanResources")], ["resourceFee", xdr.lookup("Int64")]]

    const SorobanTransactionData = StellarSdk.xdr.SorobanTransactionData;
    const SorobanTransactionDataExt = StellarSdk.xdr.SorobanTransactionDataExt;
    const SorobanResources = StellarSdk.xdr.SorobanResources;
    const Int64 = StellarSdk.xdr.Int64;

    // Create dummy data
    const resources = new SorobanResources({
        footprint: new StellarSdk.xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
        instructions: 0,
        diskReadBytes: 0,
        writeBytes: 0
    });

    // SorobanTransactionDataExt is a union (0: void, 1: resourceExt)
    // @ts-ignore
    const extVal = new SorobanTransactionDataExt(0);

    const data = new SorobanTransactionData({
        ext: extVal,
        resources: resources,
        resourceFee: StellarSdk.xdr.Int64.fromString("100")
    });

    console.log('Dummy SorobanTransactionData created.');

    // Test 1: Constructor(1, data)
    try {
        console.log('Test 1: new TransactionExt(1, data)');
        // @ts-ignore
        const ext1 = new StellarSdk.xdr.TransactionExt(1, data);
        console.log('Test 1 Success:', ext1.toXDR('base64'));
    } catch (e) {
        console.log('Test 1 Failed:', e.message);
    }

    // Test 2: Helper method (if exists, which logs say it doesn't, but let's check properly)
    try {
        console.log('Test 2: TransactionExt.sorobanData(data)');
        // @ts-ignore
        if (typeof StellarSdk.xdr.TransactionExt.sorobanData === 'function') {
            // @ts-ignore
            const ext2 = StellarSdk.xdr.TransactionExt.sorobanData(data);
            console.log('Test 2 Success:', ext2.toXDR('base64'));
        } else {
            console.log('Test 2: Function not found');
        }
    } catch (e) {
        console.log('Test 2 Failed:', e.message);
    }

    // Test 3: Constructor({sorobanData: data})
    /*
    try {
        console.log('Test 3: new TransactionExt({sorobanData: data})');
        // @ts-ignore
        const ext3 = new StellarSdk.xdr.TransactionExt({sorobanData: data});
        console.log('Test 3 Success:', ext3.toXDR('base64'));
    } catch (e) {
        console.log('Test 3 Failed:', e.message);
    }
    */

    // Test 4: Factory method if exists
    try {
        console.log('Test 4: TransactionExt.sorobanData(data)');
        // @ts-ignore
        if (typeof StellarSdk.xdr.TransactionExt.sorobanData === 'function') {
            // @ts-ignore
            const ext4 = StellarSdk.xdr.TransactionExt.sorobanData(data);
            console.log('Test 4 Success:', ext4.toXDR('base64'));
        } else {
            console.log('Test 4: Factory method not found.');
        }
    } catch (e) {
        console.log('Test 4 Failed:', e.message);
    }

}

run().catch(console.error);
