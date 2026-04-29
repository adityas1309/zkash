const { buildPoseidon } = require('circomlibjs');

async function run() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // Helper from new commitment.ts
  const toBigInt = (bytes) => F.toObject(bytes);

  // Helper from merkle-tree.service.ts (BE)
  function bigIntToBytes32BE(n) {
    const hex = n.toString(16).padStart(64, '0');
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  // Helper to read back (BE)
  function bytesToBigInt(buf) {
    let hex = '';
    for (let i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, '0');
    return BigInt('0x' + hex);
  }

  // Values
  const label = 307275837242192772962444546681256253089887023161869394698671910532318079232n;
  const value = 10000000n;
  const nullifier = 246129649242410064234112694383324093478247492727314041728160024386851968969n;
  const secret = 180792425611149295676338927733470315089491018210140650955476762686749543434n;

  console.log('--- New Logic Verification ---');

  // 1. Precommitment (using toBigInt/toObject)
  const precommitmentBytesLE = poseidon([nullifier, secret]);
  const precommitmentBigInt = toBigInt(precommitmentBytesLE);

  console.log('Precommitment BigInt:', precommitmentBigInt.toString());

  // 2. Commitment (using toBigInt/toObject)
  const commitmentBytesLE = poseidon([value, label, precommitmentBigInt]);
  const commitmentBigInt = toBigInt(commitmentBytesLE);

  console.log('Commitment BigInt (Correct Field Element):', commitmentBigInt.toString());
  console.log('Commitment Hex (Field Element):         ', commitmentBigInt.toString(16));

  // 3. Serialization (BE)
  const commitmentBytesBE = bigIntToBytes32BE(commitmentBigInt);
  console.log(
    'Commitment Bytes BE (Hex):              ',
    Buffer.from(commitmentBytesBE).toString('hex'),
  );

  // 4. Deserialization (BE) - Simulating Merkle Tree Reading
  const recoveredCommitment = bytesToBigInt(commitmentBytesBE);
  console.log('Recovered Commitment BigInt:            ', recoveredCommitment.toString());

  if (recoveredCommitment === commitmentBigInt) {
    console.log('SUCCESS: Serialization/Deserialization preserves the Field Element.');
  } else {
    console.log('FAILURE: Serialization mismatch.');
  }
}

run().catch(console.error);
