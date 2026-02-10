const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');

function deriveEncryptionKey(googleId, email) {
    const input = `${googleId}:${email}`;
    const hash = nacl.hash(naclUtil.decodeUTF8(input)); // Use naclUtil like in app
    return hash.slice(0, nacl.secretbox.keyLength);
}

function decrypt(encryptedBase64, key) {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const nonce = new Uint8Array(combined.slice(0, nacl.secretbox.nonceLength));
    const ciphertext = new Uint8Array(combined.slice(nacl.secretbox.nonceLength));

    const decrypted = nacl.secretbox.open(
        ciphertext,
        nonce,
        key
    );
    if (!decrypted) return null;
    return naclUtil.encodeUTF8(decrypted);
}

// Data from your logs
const googleId = "116821032505665550366";
const email = "aec.it.aditya@gmail.com";
const encryptedData = "0P6cemx1LYOzsP7wmSiZfzNTnHYOveouRsNUP9rZ0o3daQD6bbqDUiTNOjkR1JaIid32GZFiyyod4pcy2KwiBw2yxfVkE0MoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const key = deriveEncryptionKey(googleId, email);
console.log('Derived Key Hex:', Buffer.from(key).toString('hex'));

const dec = decrypt(encryptedData, key);
if (dec) {
    console.log('Decrypted SUCCESS:', dec);
} else {
    console.log('Decryption FAILED');
}
