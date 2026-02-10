'use client';

import { useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function SendPage() {
  const [recipient, setRecipient] = useState('');
  const [asset, setAsset] = useState<'USDC' | 'XLM'>('XLM');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'public' | 'private'>('public');

  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!recipient || !amount) {
      setStatus('Please fill in all fields');
      return;
    }

    setLoading(true);
    setStatus(mode === 'private' ? 'Generating proof and submitting...' : 'Sending payment...');

    try {
      if (mode === 'private') {
        const res = await fetch(`${API_URL}/users/send/private`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ recipient, asset, amount }),
        });
        const data = await res.json();
        if (data.success) {
          setStatus('Private payment submitted. Recipient can process withdrawals on their wallet.');
          setAmount('');
          setRecipient('');
        } else {
          setStatus(data.error || 'Unknown error');
        }
      } else {
        const res = await fetch(`${API_URL}/users/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ recipient, asset, amount }),
        });
        const data = await res.json();
        if (data.success) {
          setStatus(`Payment successful! TX: ${data.hash}`);
          setAmount('');
          setRecipient('');
        } else {
          setStatus(`Error: ${data.message || 'Unknown error'}`);
        }
      }
    } catch (e) {
      setStatus('Network error occurred');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Send Payment</h1>

      <div className="flex gap-4 mb-4">
        <button
          type="button"
          onClick={() => setMode('public')}
          className={`px-4 py-2 rounded-lg ${mode === 'public' ? 'bg-indigo-600' : 'bg-slate-700'}`}
        >
          Public (on-chain)
        </button>
        <button
          type="button"
          onClick={() => setMode('private')}
          className={`px-4 py-2 rounded-lg ${mode === 'private' ? 'bg-indigo-600' : 'bg-slate-700'}`}
        >
          Private (ZK)
        </button>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-slate-400 mb-2">Recipient (username or address)</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full bg-slate-800 rounded px-4 py-2"
            placeholder="bob_xyz or G..."
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-2">Asset</label>
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as 'USDC' | 'XLM')}
            className="w-full bg-slate-800 rounded px-4 py-2"
            disabled={loading}
          >
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>
        <div>
          <label className="block text-slate-400 mb-2">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-slate-800 rounded px-4 py-2"
            placeholder="0"
            disabled={loading}
          />
        </div>

        {mode === 'private' && (
          <p className="text-slate-500 text-sm">Proof is generated automatically. Ensure you have private balance (deposit first).</p>
        )}
      </div>

      <button
        onClick={handleSend}
        disabled={loading}
        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Sending...' : mode === 'private' ? 'Send privately' : 'Send Payment'}
      </button>

      {status && <p className="mt-4 text-slate-400 break-all">{status}</p>}

      <Link href="/wallet" className="block mt-6 text-slate-400 hover:text-white">
        Back to Wallet
      </Link>
    </main>
  );
}
