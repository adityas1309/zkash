import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from root
config({ path: resolve(__dirname, '../../../.env') });

import mongoose from 'mongoose';
import { rpc } from '@stellar/stellar-sdk';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/lop';
const RPC_URL = process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org';
const SHIELDED_POOL_ADDRESS = process.env.SHIELDED_POOL_ADDRESS;
const ZK_SWAP_ADDRESS = process.env.ZK_SWAP_ADDRESS;

const EncryptedNoteSchema = new mongoose.Schema({
  commitment: { type: String, default: '' },
  ciphertext: { type: String, default: '' },
  asset: String,
  txHash: String,
  poolAddress: String,
}, { timestamps: true });

const EncryptedNote = mongoose.model('EncryptedNote', EncryptedNoteSchema);

/** Extract commitment or nullifier from Soroban event value if present; no PII stored. */
function parseEventPayload(ev: Record<string, unknown>): { commitment?: string; nullifier?: string } {
  const out: { commitment?: string; nullifier?: string } = {};
  const value = ev?.value ?? (ev as any)?.body?.value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.commitment === 'string') out.commitment = v.commitment;
    if (typeof v.nullifier === 'string') out.nullifier = v.nullifier;
    const vec = Array.isArray(v.vec) ? v.vec : v.scvVec;
    if (Array.isArray(vec) && vec.length > 0) {
      const first = vec[0] as Record<string, unknown>;
      if (first && typeof first.obj === 'object') {
        const obj = (first as any).obj;
        const data = obj?.data ?? obj?.bin ?? obj;
        if (data && typeof data === 'string') out.commitment = data;
      }
    }
  }
  return out;
}

async function indexContractEvents(server: rpc.Server, contractId: string, asset: string) {
  const latestLedger = await server.getLatestLedger();
  const result = await server.getEvents({
    startLedger: (latestLedger.sequence as number) - 100,
    filters: [{ type: 'contract', contractIds: [contractId] }],
  });
  const events = (result as { events?: unknown[] }).events ?? [];
  for (const ev of events) {
    const e = ev as { txHash?: string; contractId?: string; id?: string };
    const txHash = e.txHash ?? (e as any).txHash ?? '';
    const poolAddress = e.contractId ?? contractId;
    const { commitment } = parseEventPayload(ev as Record<string, unknown>);
    const doc = {
      commitment: commitment ?? '',
      ciphertext: '', // No PII; only recipient can decrypt notes created by API
      asset,
      txHash,
      poolAddress,
    };
    await EncryptedNote.findOneAndUpdate(
      { txHash, poolAddress },
      doc,
      { upsert: true, new: true }
    );
  }
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Indexer connected to MongoDB');

  if (!SHIELDED_POOL_ADDRESS && !ZK_SWAP_ADDRESS) {
    console.log('No contract addresses configured. Set SHIELDED_POOL_ADDRESS or ZK_SWAP_ADDRESS.');
    return;
  }

  const server = new rpc.Server(RPC_URL);

  setInterval(async () => {
    try {
      if (SHIELDED_POOL_ADDRESS) await indexContractEvents(server, SHIELDED_POOL_ADDRESS, 'USDC');
      if (ZK_SWAP_ADDRESS) await indexContractEvents(server, ZK_SWAP_ADDRESS, 'USDC');
    } catch (e) {
      console.error('Indexer error:', e);
    }
  }, 15000);
}

main().catch(console.error);
