'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function DashboardPage() {
  const [user, setUser] = useState<{ username?: string; stellarPublicKey?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/users/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u) {
          // Auto-process withdrawals
          fetch(`${API_URL}/users/withdrawals/process`, { method: 'POST', credentials: 'include' }).catch(console.error);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) {
    return (
      <div className="p-8">
        <p>Not logged in. <Link href="/" className="text-indigo-400">Go home</Link></p>
      </div>
    );
  }

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="bg-slate-800 rounded-lg p-6 mb-6">
        <p className="text-slate-400">Username</p>
        <p className="font-mono">{user.username ?? '—'}</p>
        <p className="text-slate-400 mt-4">Stellar Address</p>
        <p className="font-mono text-sm break-all">{user.stellarPublicKey ?? '—'}</p>
      </div>
      <div className="flex gap-4">
        <Link href="/wallet" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg">
          Wallet
        </Link>
        <Link href="/swap" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg">
          P2P Swap
        </Link>
        <Link href="/history" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg">
          History
        </Link>
        <a href={`${API_URL}/auth/logout`} className="px-4 py-2 text-slate-400 hover:text-white">
          Logout
        </a>
      </div>
    </main>
  );
}
