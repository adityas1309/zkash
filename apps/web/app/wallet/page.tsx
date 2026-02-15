'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';





export default function WalletPage() {
  const [user, setUser] = useState<{ username?: string; stellarPublicKey?: string } | null>(null);
  const [balance, setBalance] = useState<{ usdc: string; xlm: string }>({ usdc: '0', xlm: '0' });
  const [privateBalance, setPrivateBalance] = useState<{ usdc: string; xlm: string }>({ usdc: '0', xlm: '0' });

  const [loading, setLoading] = useState(true);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState<'USDC' | 'XLM' | null>(null);

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

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchBalance();
      fetchPrivateBalance();
    }, 5000);
    return () => clearInterval(interval);
  }, [user]);

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

  const handleWithdrawSelf = async (asset: 'USDC' | 'XLM') => {
    const amount = asset === 'USDC' ? Number(privateBalance.usdc) : Number(privateBalance.xlm);
    if (amount <= 0) return;

    if (!confirm(`Withdraw ${amount} ${asset} from Private to Public balance?`)) return;

    setWithdrawing(asset);
    try {
      const res = await fetch(`${API_URL}/users/withdrawals/self`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Withdrawal successful! TX: ${data.txHash}`);
        fetchBalance();
        fetchPrivateBalance();
      } else {
        alert(`Withdrawal failed: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Withdrawal error: ${e.message}`);
    } finally {
      setWithdrawing(null);
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Public Balance */}
        <div className="bg-slate-800 rounded-lg p-6">
          <p className="text-slate-400 text-sm mb-2">Public Balance (on-chain)</p>
          <p className="text-2xl font-mono">USDC: {balance.usdc}</p>
          <p className="text-2xl font-mono mt-2">XLM: {balance.xlm}</p>
        </div>

        {/* Private Balance */}
        <div className="bg-slate-800/50 border border-indigo-500/30 rounded-lg p-6">
          <p className="text-indigo-400 text-sm mb-2">Private Balance (ZK Notes)</p>
          <div className="flex justify-between items-center mb-2">
            <p className="text-2xl font-mono">USDC: {privateBalance.usdc}</p>
            {Number(privateBalance.usdc) > 0 && (
              <button
                onClick={() => handleWithdrawSelf('USDC')}
                disabled={withdrawing === 'USDC'}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-1 rounded"
              >
                {withdrawing === 'USDC' ? '...' : 'Withdraw'}
              </button>
            )}
          </div>
          <div className="flex justify-between items-center">
            <p className="text-2xl font-mono">XLM: {privateBalance.xlm}</p>
            {Number(privateBalance.xlm) > 0 && (
              <button
                onClick={() => handleWithdrawSelf('XLM')}
                disabled={withdrawing === 'XLM'}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-1 rounded"
              >
                {withdrawing === 'XLM' ? '...' : 'Withdraw'}
              </button>
            )}
          </div>
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
