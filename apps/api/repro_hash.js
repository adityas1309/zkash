
const { buildPoseidon } = require('circomlibjs');

async function run() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    function bytesToBigIntBE(buf) {
        let hex = '';
        for (let i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, '0');
        return BigInt('0x' + hex);
    }

    // Values from log
    const label = 307275837242192772962444546681256253089887023161869394698671910532318079232n;
    const value = 10000000n;
    const nullifier = 246129649242410064234112694383324093478247492727314041728160024386851968969n;
    const secret = 180792425611149295676338927733470315089491018210140650955476762686749543434n;

    console.log("Inputs:", { label, value, nullifier, secret });

    // JS Logic from commitment.ts
    const nullifierHashBytes = poseidon([nullifier]);
    const nullifierHash = bytesToBigIntBE(nullifierHashBytes);

    const precommitmentBytes = poseidon([nullifier, secret]);
    const precommitmentBigInt = bytesToBigIntBE(precommitmentBytes);

    const commitmentBytes = poseidon([value, label, precommitmentBigInt]); // THIS uses precommitmentBigInt
    const commitmentBigInt = bytesToBigIntBE(commitmentBytes);

    console.log("JS Computed Commitment (BigInt):", commitmentBigInt.toString());
    console.log("JS Computed Commitment (Hex):   ", commitmentBigInt.toString(16));

    // What the circuit does:
    // precommitment = Poseidon(nullifier, secret) -> This is a field element.
    const precommitmentElement = poseidon([nullifier, secret]);
    const precommitmentAsBigIntFromF = F.toObject(precommitmentElement);

    console.log("Precommitment (BE interpretation):", precommitmentBigInt.toString());
    console.log("Precommitment (F.toObject):       ", precommitmentAsBigIntFromF.toString());

    if (precommitmentBigInt !== precommitmentAsBigIntFromF) {
        console.log("MISMATCH! ensure `bytesToBigInt(poseidon_output)` matches `F.toObject(poseidon_output)`");
    }

    const commitmentElementCorrect = poseidon([value, label, precommitmentAsBigIntFromF]);
    const commitmentCorrect = F.toObject(commitmentElementCorrect);

    console.log("Correct Circuit Commitment:       ", commitmentCorrect.toString(16));
}

run().catch(console.error);
