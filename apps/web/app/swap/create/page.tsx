'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, CheckCircle, AlertCircle, Plus } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function CreateOfferPage() {
  const router = useRouter();
  const [assetIn, setAssetIn] = useState('XLM');
  const [assetOut, setAssetOut] = useState('USDC');
  const [rate, setRate] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    setStatus('');
    setError('');

    try {
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

      if (res.ok) {
        setStatus('Offer created successfully!');
        setTimeout(() => router.push('/swap'), 1500);
      } else {
        const text = await res.text();
        setError('Failed: ' + text);
      }
    } catch (err: unknown) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-4 md:p-8 max-w-lg mx-auto">
      <Link href="/swap" className="inline-flex items-center text-slate-400 hover:text-white mb-6 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Market
      </Link>

      <h1 className="text-2xl font-bold mb-6 text-white">Create New Offer</h1>

      <Card variant="glass" className="p-6">
        <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Sell (You Give)</label>
              <select
                value={assetIn}
                onChange={(e) => setAssetIn(e.target.value)}
                className="w-full h-11 rounded-xl border border-slate-700 bg-slate-900/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-200"
              >
                <option value="USDC">USDC</option>
                <option value="XLM">XLM</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Receive (You Get)</label>
              <select
                value={assetOut}
                onChange={(e) => setAssetOut(e.target.value)}
                className="w-full h-11 rounded-xl border border-slate-700 bg-slate-900/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-200"
              >
                <option value="USDC">USDC</option>
                <option value="XLM">XLM</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Exchange Rate</label>
            <div className="relative">
              <Input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="1.0"
                step="any"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                {assetOut}/{assetIn}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              How many {assetOut} you want for 1 {assetIn}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Min Amount</label>
              <Input
                type="number"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                placeholder="0"
                step="any"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Max Amount</label>
              <Input
                type="number"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                placeholder="0"
                step="any"
                required
              />
            </div>
          </div>

          {status && (
            <div className="bg-green-900/20 border border-green-500/50 text-green-300 p-3 rounded-lg text-sm flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              {status}
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-500/50 text-red-300 p-3 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="submit"
            isLoading={loading}
            className="w-full"
            size="lg"
          >
            <Plus className="mr-2 h-4 w-4" />
            Publish Offer
          </Button>
        </form>
      </Card>
    </main>
  );
}
