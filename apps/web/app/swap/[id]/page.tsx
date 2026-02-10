'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Offer {
    _id: string;
    assetIn: string;
    assetOut: string;
    rate: number;
    min: number;
    max: number;
    merchantId: { username: string; _id: string; reputation?: number };
}

export default function SwapOfferPage() {
    const params = useParams();
    const router = useRouter();
    const offerId = params.id as string;

    const [offer, setOffer] = useState<Offer | null>(null);
    const [loading, setLoading] = useState(true);
    const [amountIn, setAmountIn] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        fetch(`${API_URL}/offers/${offerId}`)
            .then((r) => r.json())
            .then(setOffer)
            .catch(() => setError('Failed to load offer'))
            .finally(() => setLoading(false));
    }, [offerId]);

    const handleSwap = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!offer) return;

        const amount = parseFloat(amountIn);
        if (isNaN(amount) || amount <= 0) {
            setError('Please enter a valid amount');
            return;
        }
        if (amount < offer.min || amount > offer.max) {
            setError(`Amount must be between ${offer.min} and ${offer.max}`);
            return;
        }

        setSubmitting(true);
        setError('');

        try {
            const amountOut = amount * offer.rate;

            const res = await fetch(`${API_URL}/swap/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    bobId: offer.merchantId._id,
                    amountIn: amount,
                    amountOut,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to create swap request');
            }

            setSuccess(true);
            setTimeout(() => router.push('/swap'), 2000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to create swap request');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <main className="p-8 max-w-lg mx-auto">
                <div className="text-slate-400">Loading offer...</div>
            </main>
        );
    }

    if (!offer) {
        return (
            <main className="p-8 max-w-lg mx-auto">
                <div className="text-red-400 mb-4">Offer not found</div>
                <Link href="/swap" className="text-indigo-400 hover:text-indigo-300">
                    ← Back to Swap
                </Link>
            </main>
        );
    }

    const calculatedOut = amountIn ? (parseFloat(amountIn) * offer.rate).toFixed(2) : '0.00';

    return (
        <main className="p-8 max-w-lg mx-auto">
            <h1 className="text-2xl font-bold mb-6">Swap Request</h1>

            <div className="bg-slate-800 rounded-lg p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">Offer Details</h2>
                <div className="space-y-2 text-slate-300">
                    <p>
                        <span className="text-slate-400">Seller:</span> @{offer.merchantId?.username || 'Unknown'}
                    </p>
                    <p>
                        <span className="text-slate-400">Asset to Sell:</span> {offer.assetIn}
                    </p>
                    <p>
                        <span className="text-slate-400">Asset to Receive:</span> {offer.assetOut}
                    </p>
                    <p>
                        <span className="text-slate-400">Rate:</span> 1 {offer.assetIn} = {offer.rate} {offer.assetOut}
                    </p>
                    <p>
                        <span className="text-slate-400">Min/Max:</span> {offer.min} - {offer.max} {offer.assetIn}
                    </p>
                </div>
            </div>

            {success ? (
                <div className="bg-green-900/50 border border-green-500 text-green-300 p-4 rounded-lg">
                    Swap request created successfully! Redirecting...
                </div>
            ) : (
                <form onSubmit={handleSwap} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">
                            Amount to Swap ({offer.assetIn})
                        </label>
                        <input
                            type="number"
                            step="any"
                            min={offer.min}
                            max={offer.max}
                            value={amountIn}
                            onChange={(e) => setAmountIn(e.target.value)}
                            placeholder={`${offer.min} - ${offer.max}`}
                            className="w-full p-3 bg-slate-700 rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none"
                            required
                        />
                    </div>

                    <div className="bg-slate-700/50 p-4 rounded-lg">
                        <p className="text-slate-400 text-sm">You will receive:</p>
                        <p className="text-xl font-bold text-green-400">
                            {calculatedOut} {offer.assetOut}
                        </p>
                    </div>

                    {error && (
                        <div className="bg-red-900/50 border border-red-500 text-red-300 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                    >
                        {submitting ? 'Creating Request...' : 'Request Swap'}
                    </button>
                </form>
            )}

            <Link href="/swap" className="block mt-6 text-slate-400 hover:text-white">
                ← Back to Swap
            </Link>
        </main>
    );
}
