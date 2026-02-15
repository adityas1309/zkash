'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, ArrowRight, Wallet, AlertCircle, CheckCircle } from 'lucide-react';

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
                    offerId: offer._id,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to create swap request');
            }

            setSuccess(true);
            setTimeout(() => router.push('/swap/my'), 2000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to create swap request');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (!offer) {
        return (
            <main className="p-8 max-w-lg mx-auto text-center">
                <Card variant="glass" className="p-8">
                    <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Offer Not Found</h2>
                    <p className="text-slate-400 mb-6">The offer you are looking for does not exist or has been removed.</p>
                    <Link href="/swap">
                        <Button variant="outline">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to Market
                        </Button>
                    </Link>
                </Card>
            </main>
        );
    }

    const calculatedOut = amountIn ? (parseFloat(amountIn) * offer.rate).toFixed(2) : '0.00';

    return (
        <main className="p-4 md:p-8 max-w-lg mx-auto">
            <Link href="/swap" className="inline-flex items-center text-slate-400 hover:text-white mb-6 transition-colors">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Market
            </Link>

            <h1 className="text-2xl font-bold mb-6 text-white">Request Swap</h1>

            <Card variant="glass" className="mb-6">
                <div className="mb-6">
                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Offer Details</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-900/40 p-3 rounded-lg">
                            <span className="text-slate-500 text-xs block mb-1">Seller</span>
                            <span className="font-medium text-indigo-400">@{offer.merchantId?.username || 'Unknown'}</span>
                        </div>
                        <div className="bg-slate-900/40 p-3 rounded-lg">
                            <span className="text-slate-500 text-xs block mb-1">Rate</span>
                            <span className="font-medium text-white">1 {offer.assetIn} = {offer.rate} {offer.assetOut}</span>
                        </div>
                    </div>
                </div>

                {success ? (
                    <div className="bg-green-900/30 border border-green-500/50 text-green-300 p-6 rounded-xl flex flex-col items-center text-center">
                        <CheckCircle className="w-12 h-12 mb-4 text-green-400" />
                        <h3 className="text-xl font-bold mb-2">Request Sent!</h3>
                        <p className="text-sm opacity-90">Redirecting to your swaps...</p>
                    </div>
                ) : (
                    <form onSubmit={handleSwap} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                You Send ({offer.assetIn})
                            </label>
                            <Input
                                type="number"
                                step="any"
                                min={offer.min}
                                max={offer.max}
                                value={amountIn}
                                onChange={(e) => setAmountIn(e.target.value)}
                                placeholder={`${offer.min} - ${offer.max}`}
                                required
                            />
                            <p className="text-xs text-slate-500 mt-2 text-right">
                                Limits: {offer.min} - {offer.max} {offer.assetIn}
                            </p>
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="bg-slate-800 p-1.5 rounded-full border border-slate-700">
                                    <ArrowRight className="w-4 h-4 text-slate-400 rotate-90" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                            <p className="text-slate-400 text-sm mb-1">You Receive (Estimated)</p>
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-white">{calculatedOut}</span>
                                <span className="text-sm font-medium text-slate-500">{offer.assetOut}</span>
                            </div>
                        </div>

                        {error && (
                            <div className="bg-red-900/20 border border-red-500/50 text-red-300 p-3 rounded-lg text-sm flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            isLoading={submitting}
                            className="w-full"
                            size="lg"
                        >
                            <Wallet className="mr-2 h-4 w-4" />
                            Confirm Swap Request
                        </Button>
                    </form>
                )}
            </Card>
        </main>
    );
}
