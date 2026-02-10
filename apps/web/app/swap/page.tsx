'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function SwapPage() {
  const [offers, setOffers] = useState<Array<{
    _id: string;
    assetIn: string;
    assetOut: string;
    rate: number;
    min: number;
    max: number;
    merchantId?: { username: string; _id: string; reputation?: number };
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/offers`)
      .then((r) => r.json())
      .then(setOffers)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">P2P Swap</h1>

      <div className="mb-6">
        <h2 className="text-lg mb-4">Available Offers</h2>
        {offers.length === 0 ? (
          <p className="text-slate-400">No offers yet. Create one to sell XLM for USDC.</p>
        ) : (
          <div className="space-y-4">
            {offers.map((o) => (
              <div key={o._id} className="bg-slate-800 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-slate-400 text-xs mb-1">
                      Seller: <span className="text-indigo-400">@{o.merchantId?.username || 'Unknown'}</span>
                      {o.merchantId?.reputation !== undefined && (
                        <span className="ml-2 text-yellow-400">★ {o.merchantId.reputation}</span>
                      )}
                    </p>
                    <p className="font-medium">
                      {o.assetIn} → {o.assetOut} @ <span className="text-green-400">{o.rate}</span>
                    </p>
                    <p className="text-slate-400 text-sm">Min: {o.min} | Max: {o.max}</p>
                  </div>
                  <Link href={`/swap/${o._id}`} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-sm">
                    Swap
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-4 mb-6">
        <Link href="/swap/create" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg inline-block">
          Create Offer
        </Link>
        <Link href="/swap/my" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg inline-block">
          My Swaps
        </Link>
      </div>

      <Link href="/dashboard" className="block mt-6 text-slate-400 hover:text-white">
        Back to Dashboard
      </Link>
    </main>
  );
}
