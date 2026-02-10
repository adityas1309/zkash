'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function LockedSwapCard({
    swap,
    isSeller,
    actionLoading,
    onExecute,
    onPrepareProof,
    onExecutePrivate,
}: {
    swap: Swap;
    isSeller: boolean;
    actionLoading: string | null;
    onExecute: () => void;
    onPrepareProof: () => void;
    onExecutePrivate: () => void;
}) {
    return (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 shadow-lg">
            <div className="mb-6">
                <p className="font-medium text-slate-300 mb-1">
                    Buyer: <span className="text-indigo-400">@{swap.aliceId?.username || 'Unknown'}</span>
                </p>
                <div className="text-xl font-semibold text-white mb-2">
                    Send {swap.amountOut} USDC → Receive {swap.amountIn} XLM
                </div>
                <p className="text-slate-500 text-sm">
                    {new Date(swap.createdAt).toLocaleString()}
                </p>
            </div>

            <div className="mb-6">
                <span className="text-blue-400 font-bold tracking-widest text-sm uppercase">
                    LOCKED
                </span>
            </div>

            <div className="space-y-4">
                {isSeller && (
                    <button
                        onClick={onExecute}
                        disabled={actionLoading === swap._id}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-white"
                    >
                        {actionLoading === swap._id ? 'Executing...' : 'Execute (public)'}
                    </button>
                )}

                {swap.proofReady ? (
                    <button
                        onClick={onExecutePrivate}
                        disabled={actionLoading === swap._id}
                        className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 rounded-lg text-white font-medium transition-colors"
                    >
                        Execute private swap
                    </button>
                ) : !swap.hasMyProof ? (
                    <button
                        onClick={onPrepareProof}
                        disabled={actionLoading === swap._id}
                        className="w-full py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
                    >
                        {actionLoading === swap._id ? 'Preparing...' : 'Prepare private execution'}
                    </button>
                ) : (
                    <p className="text-slate-500 text-sm text-center">Your proof is submitted. Waiting for the other party.</p>
                )}
            </div>
        </div>
    );
}

interface User {
    _id: string;
    username: string;
}

interface Swap {
    _id: string;
    aliceId: { username: string; _id: string };
    bobId: { username: string; _id: string };
    amountIn: number;
    amountOut: number;
    status: 'requested' | 'locked' | 'completed' | 'cancelled';
    createdAt: string;
    txHash?: string;
    proofReady?: boolean;
    hasMyProof?: boolean;
}

export default function MySwapsPage() {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [pendingSwaps, setPendingSwaps] = useState<Swap[]>([]);
    const [allSwaps, setAllSwaps] = useState<Swap[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const fetchData = async () => {
        try {
            const [userRes, pendingRes, myRes] = await Promise.all([
                fetch(`${API_URL}/users/me`, { credentials: 'include' }),
                fetch(`${API_URL}/swap/pending`, { credentials: 'include' }),
                fetch(`${API_URL}/swap/my`, { credentials: 'include' }),
            ]);

            if (userRes.ok) {
                setCurrentUser(await userRes.json());
            }
            if (pendingRes.ok) {
                setPendingSwaps(await pendingRes.json());
            }
            if (myRes.ok) {
                setAllSwaps(await myRes.json());
            }
        } catch {
            setError('Failed to load swaps');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAccept = async (swapId: string) => {
        setActionLoading(swapId);
        setError('');
        setSuccess('');

        try {
            const res = await fetch(`${API_URL}/swap/${swapId}/accept`, {
                method: 'POST',
                credentials: 'include',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to accept swap');
            }

            setSuccess('Swap accepted! Now execute the transaction.');
            await fetchData();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to accept swap');
        } finally {
            setActionLoading(null);
        }
    };

    const handleExecute = async (swapId: string) => {
        setActionLoading(swapId);
        setError('');
        setSuccess('');
        try {
            const res = await fetch(`${API_URL}/swap/${swapId}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to execute swap');
            }
            setSuccess('Swap completed successfully!');
            await fetchData();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to execute swap');
        } finally {
            setActionLoading(null);
        }
    };

    const handlePrepareProof = async (swapId: string) => {
        setActionLoading(swapId);
        setError('');
        setSuccess('');
        try {
            const res = await fetch(`${API_URL}/swap/${swapId}/prepare-my-proof`, {
                method: 'POST',
                credentials: 'include',
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setSuccess(data.ready ? 'Both proofs ready. You can execute the private swap.' : 'Your proof is ready. Waiting for the other party.');
            await fetchData();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to prepare proof');
        } finally {
            setActionLoading(null);
        }
    };

    const handleExecutePrivate = async (swapId: string) => {
        setActionLoading(swapId);
        setError('');
        setSuccess('');
        try {
            const res = await fetch(`${API_URL}/swap/${swapId}/execute-private`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({}),
            });
            let data;
            try {
                data = await res.json();
            } catch {
                throw new Error(`Server error: ${res.status} ${res.statusText}`);
            }
            if (!res.ok || data.error) {
                throw new Error(data.error || data.message || 'Failed to execute private swap');
            }
            setSuccess('Private swap completed! TX: ' + (data.txHash ?? ''));
            await fetchData();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to execute private swap');
        } finally {
            setActionLoading(null);
        }
    };


    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            requested: 'bg-yellow-500/20 text-yellow-300',
            locked: 'bg-blue-500/20 text-blue-300',
            completed: 'bg-green-500/20 text-green-300',
            cancelled: 'bg-red-500/20 text-red-300',
        };
        return (
            <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-slate-500/20 text-slate-300'}`}>
                {status.toUpperCase()}
            </span>
        );
    };

    // Filter swaps where I'm the buyer (alice)
    const swapsAsBuyer = allSwaps.filter(s => s.aliceId?._id === currentUser?._id);
    // Filter swaps where I'm the seller (bob), excluding pending (they go in pendingSwaps)
    const swapsAsSeller = allSwaps.filter(
        s => s.bobId?._id === currentUser?._id && s.status !== 'requested'
    );

    if (loading) {
        return (
            <main className="p-8 max-w-2xl mx-auto">
                <div className="text-slate-400">Loading swaps...</div>
            </main>
        );
    }

    return (
        <main className="p-8 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-2">My Swaps</h1>
            <p className="text-slate-400 text-sm mb-6">
                Logged in as: <span className="text-indigo-400">@{currentUser?.username || 'Unknown'}</span>
            </p>

            {error && (
                <div className="bg-red-900/50 border border-red-500 text-red-300 p-3 rounded-lg mb-6">
                    {error}
                </div>
            )}

            {success && (
                <div className="bg-green-900/50 border border-green-500 text-green-300 p-3 rounded-lg mb-6">
                    {success}
                </div>
            )}

            {/* Pending Swaps to Accept (as Seller) */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <span className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse"></span>
                    Pending Requests (You&apos;re the Seller)
                </h2>

                {pendingSwaps.length === 0 ? (
                    <p className="text-slate-400 bg-slate-800/50 rounded-lg p-4">
                        No pending swap requests.
                    </p>
                ) : (
                    <div className="space-y-4">
                        {pendingSwaps.map((swap) => (
                            <div key={swap._id} className="bg-slate-800 rounded-lg p-4 border border-yellow-500/30">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <p className="font-medium">
                                            Buyer: <span className="text-indigo-400">@{swap.aliceId?.username || 'Unknown'}</span>
                                        </p>
                                        <p className="text-slate-400 text-sm">
                                            Wants: {swap.amountIn} XLM → {swap.amountOut} USDC
                                        </p>
                                        <p className="text-slate-500 text-xs mt-1">
                                            {new Date(swap.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    {getStatusBadge(swap.status)}
                                </div>

                                <button
                                    onClick={() => handleAccept(swap._id)}
                                    disabled={actionLoading === swap._id}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                                >
                                    {actionLoading === swap._id ? 'Accepting...' : 'Accept Swap'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Locked Swaps to Execute (as Seller) */}
            {swapsAsSeller.filter(s => s.status === 'locked').length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <span className="w-3 h-3 bg-blue-400 rounded-full"></span>
                        Ready to Execute (You&apos;re the Seller)
                    </h2>

                    <div className="space-y-4">
                        {swapsAsSeller.filter(s => s.status === 'locked').map((swap) => (
                            <LockedSwapCard
                                key={swap._id}
                                swap={swap}
                                isSeller
                                actionLoading={actionLoading}
                                onExecute={() => handleExecute(swap._id)}
                                onPrepareProof={() => handlePrepareProof(swap._id)}
                                onExecutePrivate={() => handleExecutePrivate(swap._id)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* Locked Swaps (as Buyer) - submit proof */}
            {swapsAsBuyer.filter(s => s.status === 'locked').length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold mb-4">Locked (You&apos;re the Buyer)</h2>
                    <div className="space-y-4">
                        {swapsAsBuyer.filter(s => s.status === 'locked').map((swap) => (
                            <LockedSwapCard
                                key={swap._id}
                                swap={swap}
                                isSeller={false}
                                actionLoading={actionLoading}
                                onExecute={() => { }}
                                onPrepareProof={() => handlePrepareProof(swap._id)}
                                onExecutePrivate={() => handleExecutePrivate(swap._id)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* My Swaps as Buyer */}
            <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">My Swap Requests (You&apos;re the Buyer)</h2>

                {swapsAsBuyer.length === 0 ? (
                    <p className="text-slate-400 bg-slate-800/50 rounded-lg p-4">
                        You haven&apos;t initiated any swaps yet.
                    </p>
                ) : (
                    <div className="space-y-4">
                        {swapsAsBuyer.map((swap) => (
                            <div key={swap._id} className="bg-slate-800 rounded-lg p-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-medium">
                                            Seller: <span className="text-indigo-400">@{swap.bobId?.username || 'Unknown'}</span>
                                        </p>
                                        <p className="text-slate-400 text-sm">
                                            {swap.amountIn} XLM → {swap.amountOut} USDC
                                        </p>
                                        <p className="text-slate-500 text-xs mt-1">
                                            {new Date(swap.createdAt).toLocaleString()}
                                        </p>
                                        {swap.txHash && swap.txHash !== 'pending' && (
                                            <a
                                                href={`https://stellar.expert/explorer/testnet/tx/${swap.txHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-green-400 text-xs hover:underline"
                                            >
                                                View Transaction ↗
                                            </a>
                                        )}
                                    </div>
                                    {getStatusBadge(swap.status)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Completed Swaps as Seller */}
            {swapsAsSeller.filter(s => s.status === 'completed').length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold mb-4">Completed Sales (You&apos;re the Seller)</h2>

                    <div className="space-y-4">
                        {swapsAsSeller.filter(s => s.status === 'completed').map((swap) => (
                            <div key={swap._id} className="bg-slate-800 rounded-lg p-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-medium">
                                            Buyer: <span className="text-indigo-400">@{swap.aliceId?.username || 'Unknown'}</span>
                                        </p>
                                        <p className="text-slate-400 text-sm">
                                            Sold {swap.amountOut} USDC for {swap.amountIn} XLM
                                        </p>
                                        {swap.txHash && swap.txHash !== 'pending' && (
                                            <a
                                                href={`https://stellar.expert/explorer/testnet/tx/${swap.txHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-green-400 text-xs hover:underline"
                                            >
                                                View Transaction ↗
                                            </a>
                                        )}
                                    </div>
                                    {getStatusBadge(swap.status)}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <div className="mt-8 flex gap-4">
                <Link href="/swap" className="text-indigo-400 hover:text-indigo-300">
                    ← Browse Offers
                </Link>
                <Link href="/dashboard" className="text-slate-400 hover:text-white">
                    Dashboard
                </Link>
            </div>
        </main>
    );
}
