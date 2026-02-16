'use client';

import { useState, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ArrowRight, Wallet, Shield, Building, Info } from 'lucide-react';
import RazorpayLoader from '@/components/RazorpayLoader';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function FiatPage() {
    const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
    const [amount, setAmount] = useState<string>('');
    const [mode, setMode] = useState<'public' | 'zk'>('public');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [razorpayLoaded, setRazorpayLoaded] = useState(false);

    // Sell Logic Form Data
    const [accountNo, setAccountNo] = useState('');
    const [ifsc, setIfsc] = useState('');

    const handleBuy = async () => {
        if (!razorpayLoaded) {
            setStatus('Razorpay SDK not loaded yet. Please refresh.');
            return;
        }
        setLoading(true);
        setStatus('Initializing Payment...');

        try {
            // 1. Create Order
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/fiat/buy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    currency: 'INR',
                    mode
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create order');

            // 2. Open Razorpay Checkout
            const options = {
                key: data.keyId,
                amount: data.amount,
                currency: data.currency,
                name: "PrivateP2P Fiat Ramp",
                description: `Buy XLM (${mode === 'zk' ? 'Shielded' : 'Public'})`,
                order_id: data.orderId,
                handler: function (response: any) {
                    verifyPayment(response);
                },
                prefill: {
                    name: "User", // could fetch from user context
                    email: "user@example.com",
                    contact: "9999999999"
                },
                theme: {
                    color: "#4F46E5"
                },
                modal: {
                    ondismiss: function () {
                        setLoading(false);
                        setStatus('Payment cancelled by user.');
                    }
                }
            };

            const rzp1 = new (window as any).Razorpay(options);
            rzp1.on('payment.failed', function (response: any) {
                setStatus(`Payment failed: ${response.error.description}`);
                setLoading(false);
            });

            rzp1.open();
            setStatus('Waiting for payment...');

        } catch (e: any) {
            console.error(e);
            setStatus(`Error: ${e.message}`);
            setLoading(false);
        }
    };

    const verifyPayment = async (response: any) => {
        setStatus('Verifying Payment & Transferring Assets...');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/fiat/verify-buy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    razorpayOrderId: response.razorpay_order_id,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                    mode
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setStatus(`Success! ${data.message}`);
            setAmount('');
        } catch (e: any) {
            setStatus(`Verification failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleSell = async () => {
        setLoading(true);
        setStatus('Initiating Payout...');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/fiat/sell`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    accountDetails: { accountNo, ifsc }
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setStatus(`Success! ${data.message}`);
            setAmount('');
        } catch (e: any) {
            setStatus(`Sell failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="p-4 md:p-8 max-w-4xl mx-auto">
            <RazorpayLoader onLoad={() => setRazorpayLoaded(true)} />

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                        Fiat Ramp
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Buy and Sell XLM directly with INR (via Razorpay).
                    </p>
                </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
                {/* Left Column: Form */}
                <div className="md:col-span-2">
                    <Card variant="glass" className="p-6">
                        <div className="flex gap-4 mb-6 border-b border-slate-700/50 pb-4">
                            <button
                                onClick={() => { setActiveTab('buy'); setStatus(''); }}
                                className={`text-lg font-semibold px-4 py-2 rounded-lg transition-colors ${activeTab === 'buy' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                Buy XLM
                            </button>
                            <button
                                onClick={() => { setActiveTab('sell'); setStatus(''); }}
                                className={`text-lg font-semibold px-4 py-2 rounded-lg transition-colors ${activeTab === 'sell' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                Sell XLM
                            </button>
                        </div>

                        {activeTab === 'buy' ? (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-slate-400 text-sm mb-2">Amount (INR)</label>
                                    <input
                                        type="number"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Enter amount in INR (e.g. 100)"
                                    />
                                </div>

                                <div>
                                    <label className="block text-slate-400 text-sm mb-2">Receive Mode</label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div
                                            onClick={() => setMode('public')}
                                            className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center gap-2 transition-colors ${mode === 'public' ? 'bg-indigo-900/20 border-indigo-500' : 'bg-slate-900/20 border-slate-700/50 hover:bg-slate-800'
                                                }`}
                                        >
                                            <Wallet className={mode === 'public' ? "text-indigo-400" : "text-slate-400"} />
                                            <span className="text-sm font-medium text-white">Public Wallet</span>
                                            <span className="text-xs text-slate-500 text-center">Standard Stellar Account</span>
                                        </div>
                                        <div
                                            onClick={() => setMode('zk')}
                                            className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center gap-2 transition-colors ${mode === 'zk' ? 'bg-indigo-900/20 border-indigo-500' : 'bg-slate-900/20 border-slate-700/50 hover:bg-slate-800'
                                                }`}
                                        >
                                            <Shield className={mode === 'zk' ? "text-indigo-400" : "text-slate-400"} />
                                            <span className="text-sm font-medium text-white">Shielded (ZK)</span>
                                            <span className="text-xs text-slate-500 text-center">Private Balance (Auto-Deposit)</span>
                                        </div>
                                    </div>
                                </div>

                                {status && (
                                    <div className={`p-4 rounded-lg text-sm ${status.includes('Success') ? 'bg-green-900/20 text-green-400' : 'bg-slate-800 text-slate-300'}`}>
                                        {status}
                                    </div>
                                )}

                                <Button
                                    variant="primary"
                                    className="w-full py-6 text-lg"
                                    onClick={handleBuy}
                                    disabled={loading || !amount || parseFloat(amount) <= 0}
                                >
                                    {loading ? 'Processing...' : `Pay ₹${amount || '0'} & Get XLM`}
                                </Button>

                                <p className="text-xs text-center text-slate-500">
                                    Secured by Razorpay • Test Mode Encrypted
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-slate-400 text-sm mb-2">Sell Amount (XLM)</label>
                                    <input
                                        type="number"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Enter XLM to sell"
                                    />
                                </div>

                                <div className="bg-slate-900/30 p-4 rounded-lg border border-slate-700/30">
                                    <h3 className="text-white font-medium mb-4 flex items-center gap-2">
                                        <Building size={16} className="text-indigo-400" /> Bank Account Details
                                    </h3>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-slate-500 text-xs mb-1">Account Number</label>
                                            <input
                                                type="text"
                                                value={accountNo}
                                                onChange={e => setAccountNo(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                                placeholder="1234567890"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-slate-500 text-xs mb-1">IFSC Code</label>
                                            <input
                                                type="text"
                                                value={ifsc}
                                                onChange={e => setIfsc(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                                placeholder="HDFC0001234"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {status && (
                                    <div className={`p-4 rounded-lg text-sm ${status.includes('Success') ? 'bg-green-900/20 text-green-400' : 'bg-slate-800 text-slate-300'}`}>
                                        {status}
                                    </div>
                                )}

                                <Button
                                    variant="primary"
                                    className="w-full py-6 text-lg"
                                    onClick={handleSell}
                                    disabled={loading || !amount || parseFloat(amount) <= 0 || !accountNo}
                                >
                                    {loading ? 'Processing...' : 'Initiate Payout'}
                                </Button>
                            </div>
                        )}
                    </Card>
                </div>

                {/* Right Column: Info */}
                <div>
                    <Card variant="glass" className="p-6 sticky top-8">
                        <h3 className="text-lg font-semibold text-white mb-4">How it works</h3>
                        <div className="space-y-4">
                            <div className="flex gap-3">
                                <div className="mt-1 bg-indigo-500/10 p-2 rounded-lg h-fit text-indigo-400">
                                    <Wallet size={18} />
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Buying XLM</h4>
                                    <p className="text-slate-400 text-xs mt-1">
                                        Pay with UPI/Card using Razorpay (Test Mode). We instantly transfer XLM to your public wallet.
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <div className="mt-1 bg-purple-500/10 p-2 rounded-lg h-fit text-purple-400">
                                    <Shield size={18} />
                                </div>
                                <div>
                                    <h4 className="text-white font-medium text-sm">Shielded Mode (ZK)</h4>
                                    <p className="text-slate-400 text-xs mt-1">
                                        The XLM is sent to your public wallet first. Use "Deposit" to shield it.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 pt-6 border-t border-slate-800">
                                <div className="flex items-center gap-2 text-amber-500/80 text-xs bg-amber-900/10 p-3 rounded-lg border border-amber-900/20">
                                    <Info size={14} />
                                    <span>Razorpay Test Mode Active. Use any mock card/UPI.</span>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </main>
    );
}
