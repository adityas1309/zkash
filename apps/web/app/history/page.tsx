'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function HistoryPage() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API_URL}/users/history`, { credentials: 'include' })
            .then((r) => r.ok ? r.json() : [])
            .then(setHistory)
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="p-8 text-slate-300">Loading history...</div>;

    return (
        <main className="p-8 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Transaction History</h1>
                <Link href="/dashboard" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">
                    Back
                </Link>
            </div>

            <div className="bg-slate-800 rounded-lg overflow-hidden">
                {history.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">No transactions found.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-900/50 text-slate-400">
                                <tr>
                                    <th className="p-4">Type</th>
                                    <th className="p-4">Asset</th>
                                    <th className="p-4">Amount</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4">Date</th>
                                    <th className="p-4">Tx Hash</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {history.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-700/50">
                                        <td className="p-4 capitalize">
                                            {item.type.replace(/_/g, ' ')}
                                        </td>
                                        <td className="p-4">{item.asset}</td>
                                        <td className="p-4 font-mono">
                                            {item.amount === '?' ? <span className="text-slate-500">Private</span> : item.amount}
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded text-xs ${item.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                                    item.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                                                        'bg-slate-600 text-slate-300'
                                                }`}>
                                                {item.status || (item.txHash === 'pending' ? 'Pending' : 'Completed')}
                                            </span>
                                        </td>
                                        <td className="p-4 text-slate-400 text-sm">
                                            {new Date(item.date).toLocaleString()}
                                        </td>
                                        <td className="p-4 font-mono text-xs text-slate-500">
                                            {item.txHash && item.txHash !== 'pending' ? (
                                                <a
                                                    href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="hover:text-indigo-400 underline decoration-dotted"
                                                >
                                                    {item.txHash.slice(0, 8)}...
                                                </a>
                                            ) : (
                                                '—'
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </main>
    );
}
