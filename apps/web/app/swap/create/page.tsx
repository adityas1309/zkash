'use client';

import { useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function CreateOfferPage() {
  const [assetIn, setAssetIn] = useState('XLM');
  const [assetOut, setAssetOut] = useState('USDC');
  const [rate, setRate] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [status, setStatus] = useState('');

  const handleCreate = async () => {
    const res = await fetch(`${API_URL}/offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        assetIn,
        assetOut,
        rate: parseFloat(rate),
        min: parseFloat(min),
        max: parseFloat(max),
      }),
    });
    if (res.ok) setStatus('Offer created!');
    else setStatus('Failed: ' + (await res.text()));
  };

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Offer</h1>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-slate-400 mb-2">Sell (assetIn)</label>
          <select value={assetIn} onChange={(e) => setAssetIn(e.target.value)} className="w-full bg-slate-800 rounded px-4 py-2">
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>
        <div>
          <label className="block text-slate-400 mb-2">For (assetOut)</label>
          <select value={assetOut} onChange={(e) => setAssetOut(e.target.value)} className="w-full bg-slate-800 rounded px-4 py-2">
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>
        <div>
          <label className="block text-slate-400 mb-2">Rate</label>
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="w-full bg-slate-800 rounded px-4 py-2" />
        </div>
        <div>
          <label className="block text-slate-400 mb-2">Min</label>
          <input type="number" value={min} onChange={(e) => setMin(e.target.value)} className="w-full bg-slate-800 rounded px-4 py-2" />
        </div>
        <div>
          <label className="block text-slate-400 mb-2">Max</label>
          <input type="number" value={max} onChange={(e) => setMax(e.target.value)} className="w-full bg-slate-800 rounded px-4 py-2" />
        </div>
      </div>

      <button onClick={handleCreate} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg">
        Create Offer
      </button>

      {status && <p className="mt-4 text-slate-400">{status}</p>}

      <Link href="/swap" className="block mt-6 text-slate-400 hover:text-white">
        Back to Swap
      </Link>
    </main>
  );
}
