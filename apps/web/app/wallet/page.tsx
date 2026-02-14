'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';



function UnshieldButton({ asset, onDone }: { asset: 'USDC' | 'XLM'; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('1');

  const handleUnshield = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) return alert('Invalid amount');
    if (!confirm(`Unshield ${amount} ${asset} from private balance?`)) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/users/withdrawals/self`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ asset, amount: numAmount }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Unshielding initiated! TX: ${data.txHash}`);
        onDone();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (e) {
      alert('Error unshielding funds');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-20 px-2 py-1 text-sm bg-slate-900 border border-slate-700 rounded text-white"
        placeholder="Amt"
      />
      <button
        onClick={handleUnshield}
        disabled={loading}
        className="text-xs bg-red-900 hover:bg-red-800 text-red-100 px-2 py-1 rounded disabled:opacity-50"
      >
        {loading ? '...' : `Unshield ${asset}`}
      </button>
    </div>
  );
}

export default function WalletPage() {
  const [user, setUser] = useState<{ username?: string; stellarPublicKey?: string } | null>(null);
  const [balance, setBalance] = useState<{ usdc: string; xlm: string }>({ usdc: '0', xlm: '0' });
  const [privateBalance, setPrivateBalance] = useState<{ usdc: string; xlm: string }>({ usdc: '0', xlm: '0' });
  const [loading, setLoading] = useState(true);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState<'USDC' | 'XLM' | null>(null);
  const [depositAmount, setDepositAmount] = useState('1');

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

  // Auto-process withdrawals
  useEffect(() => {
    if (!user) return;

    const process = async () => {
      try {
        const res = await fetch(`${API_URL}/users/withdrawals/process`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await res.json();
        if (data.processed > 0) {
          console.log(`Auto-processed ${data.processed} withdrawals. TX: ${data.txHashes?.join(', ')}`);
          fetchBalance();
          fetchPrivateBalance();
        }
      } catch (e) {
        console.error('Auto-process error:', e);
      }
    };

    // Run immediately on load
    process();

    // Then poll every 10s
    const interval = setInterval(process, 10000);
    return () => clearInterval(interval);
  }, [user]);

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
    const numAmount = parseFloat(depositAmount);
    if (!numAmount || numAmount <= 0) {
      alert('Invalid amount');
      setDepositLoading(null);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/users/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ asset, amount: numAmount }),
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
        <div className="flex items-center justify-between">
          <p className="text-2xl font-mono">USDC: {privateBalance.usdc}</p>
          <UnshieldButton asset="USDC" onDone={() => { fetchPrivateBalance(); fetchBalance(); }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-2xl font-mono">XLM: {privateBalance.xlm}</p>
          <UnshieldButton asset="XLM" onDone={() => { fetchPrivateBalance(); fetchBalance(); }} />
        </div>

        <button
          onClick={() => { fetchBalance(); fetchPrivateBalance(); }}
          className="text-xs text-indigo-400 hover:text-indigo-300 mt-4 block"
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
        <p className="text-slate-400 text-sm mb-2">Deposit to private pool</p>
        <p className="text-slate-500 text-xs mb-3">Requires public balance. Creates a spendable note for private send/swap.</p>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="w-24 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
            placeholder="Amount"
          />
          <button
            onClick={() => handleDeposit('USDC')}
            disabled={depositLoading !== null}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-50"
          >
            {depositLoading === 'USDC' ? 'Depositing...' : 'Deposit USDC'}
          </button>
          <button
            onClick={() => handleDeposit('XLM')}
            disabled={depositLoading !== null}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-50"
          >
            {depositLoading === 'XLM' ? 'Depositing...' : 'Deposit XLM'}
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
