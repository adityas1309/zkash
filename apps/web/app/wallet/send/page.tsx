'use client';

import { useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function SendPage() {
  const [recipient, setRecipient] = useState('');
  const [asset, setAsset] = useState<'USDC' | 'XLM'>('XLM');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'public' | 'private'>('public');

  const [loading, setLoading] = useState(false);

  const [processStep, setProcessStep] = useState('');

  const handleSplit = async (asset: 'USDC' | 'XLM', amount: number) => {
    setProcessStep('Splitting note to match exact amount...');
    try {
      const res = await fetch(`${API_URL}/users/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Split failed');

      // Wait a bit for the transaction to be confirmed and indexed
      setProcessStep('Waiting for split confirmation...');
      await new Promise(r => setTimeout(r, 6000));
      return true;
    } catch (e) {
      throw e;
    }
  };

  const handleDeposit = async (asset: 'USDC' | 'XLM', amount: number) => {
    setProcessStep(`Depositing ${amount} ${asset} from public balance...`);
    try {
      const res = await fetch(`${API_URL}/users/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        // Wait for deposit to be indexed
        setProcessStep('Waiting for deposit confirmation...');
        await new Promise(r => setTimeout(r, 6000));
        return true;
      } else {
        throw new Error(data.error || 'Deposit failed');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.includes('fetch') || msg.includes('Failed') ? 'Deposit failed. The network may be slow.' : `Deposit failed: ${msg}`);
    }
  };

  const handleSend = async () => {
    if (!recipient || !amount) {
      setStatus('Please fill in all fields');
      return;
    }

    setLoading(true);
    setStatus('');
    setProcessStep(mode === 'private' ? 'Generating proof and submitting...' : 'Sending payment...');

    const runDepositFlow = async (reqAsset: 'USDC' | 'XLM', reqAmount: number) => {
      if (confirm(`Insufficient private balance. Do you want to transfer ${reqAmount} ${reqAsset} from your public pool to continue?`)) {
        console.log('Insufficient balance, attempting auto-deposit...');
        await handleDeposit(reqAsset, reqAmount);
        return true;
      }
      throw new Error('Cancelled by user.');
    };

    try {
      const attemptSend = async () => {
        if (mode === 'private') {
          const res = await fetch(`${API_URL}/users/send/private`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ recipient, asset, amount }),
          });
          const data = await res.json();

          // Check for error in response body even if status is 200 (common in this app) or 400
          if (!data.success) {
            throw new Error(data.error || 'Unknown error');
          }
          return data;
        } else {
          const res = await fetch(`${API_URL}/users/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ recipient, asset, amount }),
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.message || 'Unknown error');
          }
          return data;
        }
      };

      try {
        const data = await attemptSend();
        if (mode === 'private') {
          setStatus('Private payment submitted. Recipient can process withdrawals on their wallet.');
        } else {
          setStatus(`Payment successful! TX: ${data.hash}`);
        }
        setAmount('');
        setRecipient('');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to send';
        const numAmount = parseFloat(amount);

        if (mode === 'private') {
          // Catch various forms of "note missing" errors
          if (msg.includes('No private note with EXACT amount') || msg.includes('No spendable private note') || msg.includes('Splitting not yet supported')) {
            console.log('Exact note missing, attempting auto-split...');
            try {
              await handleSplit(asset, numAmount);
            } catch (splitErr: unknown) {
              const splitMsg = splitErr instanceof Error ? splitErr.message : String(splitErr);
              if (splitMsg.includes('Insufficient private balance')) {
                await runDepositFlow(asset, numAmount);
              } else {
                throw splitErr;
              }
            }

            setProcessStep('Retrying payment after split...');
            const retryData = await attemptSend();
            setStatus('Private payment submitted. Recipient can process withdrawals on their wallet.');
            setAmount('');
            setRecipient('');

          } else if (msg.includes('Insufficient private balance')) {
            await runDepositFlow(asset, numAmount);
            setProcessStep('Retrying payment after deposit...');
            const retryData = await attemptSend();
            setStatus('Private payment submitted. Recipient can process withdrawals on their wallet.');
            setAmount('');
            setRecipient('');
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Cancelled by user.') {
        setStatus(msg);
      }
      console.error(e);
    } finally {
      setLoading(false);
      setProcessStep('');
    }
  };

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Send Payment</h1>

      <div className="flex gap-4 mb-4">
        <button
          type="button"
          onClick={() => setMode('public')}
          className={`px-4 py-2 rounded-lg ${mode === 'public' ? 'bg-indigo-600' : 'bg-slate-700'}`}
        >
          Public (on-chain)
        </button>
        <button
          type="button"
          onClick={() => setMode('private')}
          className={`px-4 py-2 rounded-lg ${mode === 'private' ? 'bg-indigo-600' : 'bg-slate-700'}`}
        >
          Private (ZK)
        </button>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-slate-400 mb-2">Recipient (username or address)</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full bg-slate-800 rounded px-4 py-2"
            placeholder="bob_xyz or G..."
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-2">Asset</label>
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as 'USDC' | 'XLM')}
            className="w-full bg-slate-800 rounded px-4 py-2"
            disabled={loading}
          >
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>
        <div>
          <label className="block text-slate-400 mb-2">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-slate-800 rounded px-4 py-2"
            placeholder="0"
            disabled={loading}
          />
        </div>

        {mode === 'private' && (
          <p className="text-slate-500 text-sm">Proof is generated automatically. Ensure you have private balance (deposit first).</p>
        )}
      </div>

      <button
        onClick={handleSend}
        disabled={loading}
        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (processStep || 'Sending...') : mode === 'private' ? 'Send privately' : 'Send Payment'}
      </button>

      {status && <p className="mt-4 text-slate-400 break-all">{status}</p>}

      <Link href="/wallet" className="block mt-6 text-slate-400 hover:text-white">
        Back to Wallet
      </Link>
    </main>
  );
}
