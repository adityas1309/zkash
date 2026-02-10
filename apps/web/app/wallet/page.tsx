'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function ProcessWithdrawalsButton({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const handleProcess = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/users/withdrawals/process`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.processed > 0) {
        onDone();
        alert(`Processed ${data.processed} withdrawal(s). TX: ${data.txHashes?.join(', ')}`);
      } else {
        alert('No pending withdrawals or already processed.');
      }
    } catch {
      alert('Failed to process withdrawals');
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      onClick={handleProcess}
      disabled={loading}
      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-50"
    >
      {loading ? 'Processing...' : 'Process private withdrawals'}
    </button>
  );
}

export default function WalletPage() {
  const [user, setUser] = useState<{ username?: string; stellarPublicKey?: string } | null>(null);
  const [balance, setBalance] = useState<{ usdc: string; xlm: string }>({ usdc: '0', xlm: '0' });
  const [privateBalance, setPrivateBalance] = useState<{ usdc: string; xlm: string }>({ usdc: '0', xlm: '0' });
  const [loading, setLoading] = useState(true);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState<'USDC' | 'XLM' | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/users/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u) {
          fetchBalance();
          fetchPrivateBalance();
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const fetchBalance = () => {
    fetch(`${API_URL}/users/balance/all`, { credentials: 'include' })
      .then(r => r.json())
      .then((data) => setBalance(data))
      .catch(console.error);
  };

  const fetchPrivateBalance = () => {
    fetch(`${API_URL}/users/balance/private`, { credentials: 'include' })
      .then(r => r.json())
      .then((data) => setPrivateBalance(data))
      .catch(console.error);
  };

  const handleXlmFaucet = async () => {
    if (!user?.stellarPublicKey) return;
    setFaucetLoading(true);
    try {
      const res = await fetch(`${API_URL}/faucet/xlm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ address: user.stellarPublicKey }),
      });
      const data = await res.json();
      if (data.success) {
        // Wait a bit for ledger to update
        setTimeout(fetchBalance, 4000);
      }
    } finally {
      setFaucetLoading(false);
    }
  };

  const handleTrustline = async () => {
    try {
      const res = await fetch(`${API_URL}/users/trustline`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        alert('Trustline added! Transaction: ' + data.hash);
        setTimeout(fetchBalance, 4000);
      } else {
        alert('Failed: ' + (data.message || 'Unknown error'));
      }
    } catch (e) {
      alert('Error adding trustline');
    }
  };

  const handleDeposit = async (asset: 'USDC' | 'XLM') => {
    setDepositLoading(asset);
    try {
      const res = await fetch(`${API_URL}/users/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ asset }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        alert(`Deposit submitted! TX: ${data.txHash}`);
        setTimeout(() => { fetchBalance(); fetchPrivateBalance(); }, 4000);
      } else {
        alert(data.error || 'Deposit failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg.includes('fetch') || msg.includes('Failed') ? 'Deposit request failed. The operation may be slow—try again in a moment.' : `Deposit failed: ${msg}`);
    } finally {
      setDepositLoading(null);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) {
    return (
      <div className="p-8">
        <p>
          Not logged in. <Link href="/" className="text-indigo-400">Go home</Link>
        </p>
      </div>
    );
  }

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Wallet</h1>

      <div className="bg-slate-800 rounded-lg p-6 mb-6">
        <p className="text-slate-400 text-sm mb-2">Private Balance (from notes)</p>
        <p className="text-2xl font-mono">USDC: {privateBalance.usdc}</p>
        <p className="text-2xl font-mono mt-2">XLM: {privateBalance.xlm}</p>
        <button
          onClick={() => { fetchBalance(); fetchPrivateBalance(); }}
          className="text-xs text-indigo-400 hover:text-indigo-300 mt-2"
        >
          Refresh Balance
        </button>
      </div>

      <div className="bg-slate-800 rounded-lg p-6 mb-6">
        <p className="text-slate-400 text-sm mb-2">Public Balance (on-chain)</p>
        <p className="text-2xl font-mono">USDC: {balance.usdc}</p>
        <p className="text-2xl font-mono mt-2">XLM: {balance.xlm}</p>
      </div>

      <div className="bg-slate-800 rounded-lg p-6 mb-6">
        <p className="text-slate-400 text-sm mb-2">Deposit to private pool (1 unit)</p>
        <p className="text-slate-500 text-xs mb-3">Requires public balance. Creates a spendable note for private send/swap.</p>
        <div className="flex gap-2">
          <button
            onClick={() => handleDeposit('USDC')}
            disabled={depositLoading !== null}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-50"
          >
            {depositLoading === 'USDC' ? 'Depositing...' : 'Deposit 1 USDC'}
          </button>
          <button
            onClick={() => handleDeposit('XLM')}
            disabled={depositLoading !== null}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-50"
          >
            {depositLoading === 'XLM' ? 'Depositing...' : 'Deposit 1 XLM'}
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-lg p-6 mb-6">
        <p className="text-slate-400 mb-4">Receive (QR)</p>
        <QRCodeSVG value={user.stellarPublicKey ?? ''} size={128} level="M" />
        <p className="font-mono text-sm mt-4 break-all">{user.stellarPublicKey}</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <Link href="/wallet/send" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg">
          Send
        </Link>
        <ProcessWithdrawalsButton onDone={() => { fetchPrivateBalance(); fetchBalance(); }} />
        <button
          onClick={handleXlmFaucet}
          disabled={faucetLoading}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-50"
        >
          {faucetLoading ? '...' : 'Get XLM (Faucet)'}
        </button>
        <button
          onClick={handleTrustline}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
        >
          Add USDC Trustline
        </button>
        <a
          href="https://faucet.circle.com/?network=stellar-testnet"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
        >
          Get USDC (Circle)
        </a>
      </div>

      <Link href="/dashboard" className="block mt-6 text-slate-400 hover:text-white">
        Back to Dashboard
      </Link>
    </main>
  );
}
