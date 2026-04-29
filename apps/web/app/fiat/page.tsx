'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Building,
  CreditCard,
  Globe,
  Info,
  Landmark,
  RefreshCw,
  Shield,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PrivacyToggle } from '@/components/ui/PrivacyToggle';
import { usePrivacy } from '@/context/PrivacyContext';
import Prism from '@/components/ui/Prism';
import RazorpayLoader from '@/components/RazorpayLoader';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface FiatPlanningWorkspace {
  user: {
    username?: string;
    stellarPublicKey?: string;
  };
  provider: {
    razorpayConfigured: boolean;
    keyIdPresent: boolean;
  };
  pricing: {
    buyRateInrToXlm: number;
    sellRateXlmToInr: number;
    buyFeePercent: number;
    sellFeePercent: number;
  };
  balances: {
    publicXlm: number;
    privateXlm: number;
    totalXlm: number;
  };
  payoutPolicy: {
    holdMinutes: number;
    bankRequirements: string[];
  };
  guidance: string[];
  readiness: {
    provider: {
      tone: 'ready' | 'blocked';
      label: string;
      detail: string;
    };
    inventory: {
      tone: 'ready' | 'attention' | 'blocked';
      label: string;
      detail: string;
    };
    payoutRail: {
      tone: 'attention';
      label: string;
      detail: string;
    };
  };
  scenarioCards: Array<{
    id: string;
    title: string;
    mode: 'public' | 'zk';
    action: 'buy' | 'sell';
    detail: string;
  }>;
}

interface FiatPlan {
  action: 'buy' | 'sell';
  amount: number;
  mode: 'public' | 'zk';
  readiness: {
    tone: 'ready' | 'attention' | 'blocked';
    headline: string;
    detail: string;
  };
  stages: Array<{
    id: string;
    label: string;
    status: 'ready' | 'attention' | 'blocked';
    detail: string;
  }>;
  economics: Record<string, number>;
  routeCards: Array<{
    route: string;
    title: string;
    recommended: boolean;
    tone: 'ready' | 'attention' | 'blocked' | 'default';
    detail: string;
  }>;
  warnings: string[];
  nextActions: string[];
  inventory?: {
    publicXlm: number;
    privateXlm: number;
    totalXlm: number;
    inventoryShortfall: number;
  };
  bankAccount?: {
    maskedAccount: string;
    ifsc: string;
    validation: {
      valid: boolean;
      detail: string;
    };
  };
}

export default function FiatPage() {
  const { isPrivate, togglePrivacy } = usePrivacy();
  const [workspace, setWorkspace] = useState<FiatPlanningWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState<string>('');
  const [mode, setMode] = useState<'public' | 'zk'>('public');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);
  const [plan, setPlan] = useState<FiatPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const [accountNo, setAccountNo] = useState('');
  const [ifsc, setIfsc] = useState('');

  const numericAmount = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [amount]);

  const fetchWorkspace = async () => {
    try {
      const response = await fetch(`${API_URL}/fiat/planning-workspace`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        setWorkspace(data);
      } else {
        setWorkspace(null);
      }
    } catch (error) {
      console.error('[FiatPage] Failed to load workspace', error);
      setWorkspace(null);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (numericAmount <= 0) {
      setPlan(null);
      return;
    }

    if (activeTab === 'sell' && (!accountNo || !ifsc)) {
      setPlan(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setPlanLoading(true);
      fetch(`${API_URL}/fiat/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          action: activeTab,
          amount: numericAmount,
          mode: activeTab === 'buy' ? mode : undefined,
          accountDetails:
            activeTab === 'sell'
              ? {
                  accountNo,
                  ifsc: ifsc.toUpperCase(),
                }
              : undefined,
        }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!controller.signal.aborted) {
            setPlan(data);
          }
        })
        .catch((error) => {
          if ((error as Error).name !== 'AbortError') {
            console.error(error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setPlanLoading(false);
          }
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeTab, numericAmount, mode, accountNo, ifsc]);

  const handleBuy = async () => {
    if (!razorpayLoaded) {
      setStatus('Razorpay SDK not loaded yet. Please refresh.');
      return;
    }
    setLoading(true);
    setStatus('Initializing payment...');

    try {
      const response = await fetch(`${API_URL}/fiat/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          amount: numericAmount,
          currency: 'INR',
          mode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create order');
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: 'PrivateP2P Fiat Ramp',
        description: `Buy XLM (${mode === 'zk' ? 'Shielded' : 'Public'})`,
        order_id: data.orderId,
        handler: function (razorpayResponse: any) {
          verifyPayment(razorpayResponse);
        },
        prefill: {
          name: workspace?.user?.username || 'User',
          email: 'user@example.com',
          contact: '9999999999',
        },
        theme: {
          color: '#4F46E5',
        },
        modal: {
          ondismiss: function () {
            setLoading(false);
            setStatus('Payment cancelled by user.');
          },
        },
      };

      const instance = new (window as any).Razorpay(options);
      instance.on('payment.failed', function (paymentFailure: any) {
        setStatus(`Payment failed: ${paymentFailure.error.description}`);
        setLoading(false);
      });

      instance.open();
      setStatus('Waiting for payment...');
    } catch (error: any) {
      console.error(error);
      setStatus(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  const verifyPayment = async (response: any) => {
    setStatus('Verifying payment and transferring assets...');
    try {
      const res = await fetch(`${API_URL}/fiat/verify-buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Verification failed');
      }

      setStatus(`Success! ${data.message}`);
      setAmount('');
      setPlan(null);
      fetchWorkspace();
    } catch (error: any) {
      setStatus(`Verification failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSell = async () => {
    setLoading(true);
    setStatus('Initiating payout...');
    try {
      const response = await fetch(`${API_URL}/fiat/sell`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          amount: numericAmount,
          accountDetails: {
            accountNo,
            ifsc: ifsc.toUpperCase(),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Sell failed');
      }

      setStatus(`Success! ${data.message}`);
      setAmount('');
      setPlan(null);
      fetchWorkspace();
    } catch (error: any) {
      setStatus(`Sell failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const statusVariant =
    plan?.readiness.tone === 'ready'
      ? 'success'
      : plan?.readiness.tone === 'attention'
        ? 'warning'
        : 'error';

  return (
    <div className="relative flex w-full flex-col justify-center overflow-hidden rounded-[32px] border border-white/5 bg-slate-900/30 p-8 font-sans text-slate-200 lg:p-12">
      <div className="absolute right-8 top-6 z-20">
        <PrivacyToggle checked={isPrivate} onCheckedChange={togglePrivacy} />
      </div>

      <div className="absolute inset-0 z-0 opacity-40">
        <Prism
          animationType="rotate"
          timeScale={0.5}
          height={3.5}
          baseWidth={5.5}
          scale={3.6}
          hueShift={-0.3}
          colorFrequency={1}
          noise={0.1}
          glow={1}
        />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-2/3 w-4/5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute left-1/2 top-[40%] z-0 h-32 w-full max-w-4xl -translate-x-1/2 bg-indigo-500/10 blur-[60px]" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1450px] flex-col">
        <RazorpayLoader onLoad={() => setRazorpayLoaded(true)} />

        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Fiat Planning Desk</p>
            <h1 className="mt-2 text-3xl font-bold text-white">
              Plan the ramp before you move money
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              This workspace compares buy and sell routes, highlights provider and inventory
              blockers, and turns fiat actions into stage-based execution plans.
            </p>
          </div>
          <button
            onClick={() => fetchWorkspace()}
            className="inline-flex items-center rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Workspace
          </button>
        </div>

        <div className="mb-8 grid w-full gap-4 md:grid-cols-4">
          <Card variant="glass">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Provider</p>
            <p className="mt-2 text-lg font-bold text-white">
              {workspace?.provider.razorpayConfigured ? 'Configured' : 'Missing'}
            </p>
            <p className="mt-2 text-sm text-slate-400">{workspace?.readiness.provider.detail}</p>
          </Card>
          <Card variant="glass">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Buy Rate</p>
            <p className="mt-2 text-lg font-bold text-white">
              {workspace?.pricing.buyRateInrToXlm ?? 0}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">XLM per INR before fees</p>
          </Card>
          <Card variant="glass">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sell Inventory</p>
            <p className="mt-2 text-lg font-bold text-white">{workspace?.balances.totalXlm ?? 0}</p>
            <p className="mt-2 text-[11px] text-slate-400">
              Public {workspace?.balances.publicXlm ?? 0} | Private{' '}
              {workspace?.balances.privateXlm ?? 0}
            </p>
          </Card>
          <Card variant="glass">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Payout Hold</p>
            <p className="mt-2 text-lg font-bold text-white">
              {workspace?.payoutPolicy.holdMinutes ?? 0}m
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {workspace?.readiness.payoutRail.detail}
            </p>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[32px] border border-white/5 bg-slate-900/80 p-6 backdrop-blur-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Ramp planner</h2>
              <div className="flex gap-2 rounded-xl border border-slate-700/50 bg-slate-800/30 p-1">
                <button
                  onClick={() => {
                    setActiveTab('buy');
                    setStatus('');
                    setPlan(null);
                  }}
                  className={cn(
                    'rounded-lg px-4 py-2 text-xs font-semibold transition-all',
                    activeTab === 'buy'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white',
                  )}
                >
                  Buy XLM
                </button>
                <button
                  onClick={() => {
                    setActiveTab('sell');
                    setStatus('');
                    setPlan(null);
                  }}
                  className={cn(
                    'rounded-lg px-4 py-2 text-xs font-semibold transition-all',
                    activeTab === 'sell'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white',
                  )}
                >
                  Sell XLM
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3 text-[11px] leading-tight text-slate-300">
                {activeTab === 'buy'
                  ? 'Buy planning models checkout readiness, destination route, and post-fulfillment usability.'
                  : 'Sell planning models bank validity, public-versus-private inventory, and payout queue readiness.'}
              </div>

              <div>
                <label className="mb-1.5 ml-1 block text-xs font-medium text-slate-400">
                  {activeTab === 'buy' ? 'Amount (INR)' : 'Sell Amount (XLM)'}
                </label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={loading}
                  className="h-12 rounded-xl border-slate-700/50 bg-slate-900/50 font-mono text-sm"
                />
              </div>

              {activeTab === 'buy' ? (
                <div>
                  <label className="mb-1.5 ml-1 block text-xs font-medium text-slate-400">
                    Receive Mode
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setMode('public')}
                      className={cn(
                        'rounded-xl border p-3 transition-all',
                        mode === 'public'
                          ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/50'
                          : 'border-slate-700/50 bg-slate-900/50 hover:bg-slate-800',
                      )}
                    >
                      <Wallet
                        className={cn(
                          'mx-auto mb-2',
                          mode === 'public' ? 'text-indigo-400' : 'text-slate-500',
                        )}
                        size={18}
                      />
                      <span className="block text-xs font-semibold text-slate-200">Public</span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        Visible wallet
                      </span>
                    </button>
                    <button
                      onClick={() => setMode('zk')}
                      className={cn(
                        'rounded-xl border p-3 transition-all',
                        mode === 'zk'
                          ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/50'
                          : 'border-slate-700/50 bg-slate-900/50 hover:bg-slate-800',
                      )}
                    >
                      <Shield
                        className={cn(
                          'mx-auto mb-2',
                          mode === 'zk' ? 'text-indigo-400' : 'text-slate-500',
                        )}
                        size={18}
                      />
                      <span className="block text-xs font-semibold text-slate-200">Shielded</span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">Private flow</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 ml-1 block text-xs font-medium text-slate-400">
                      Account Number
                    </label>
                    <Input
                      type="text"
                      value={accountNo}
                      onChange={(e) => setAccountNo(e.target.value)}
                      placeholder="Enter Account No."
                      disabled={loading}
                      className="h-12 rounded-xl border-slate-700/50 bg-slate-900/50 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 ml-1 block text-xs font-medium text-slate-400">
                      IFSC Code
                    </label>
                    <Input
                      type="text"
                      value={ifsc}
                      onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                      placeholder="Enter IFSC Code"
                      disabled={loading}
                      className="h-12 rounded-xl border-slate-700/50 bg-slate-900/50 text-sm uppercase"
                    />
                  </div>
                </>
              )}

              {status && (
                <div
                  className={cn(
                    'rounded-xl border-l-4 p-3 text-xs font-medium',
                    status.toLowerCase().includes('success') ||
                      status.toLowerCase().includes('verifying') ||
                      status.toLowerCase().includes('waiting') ||
                      status.toLowerCase().includes('initializing')
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200'
                      : 'border-red-500 bg-red-500/10 text-red-200',
                  )}
                >
                  {status}
                </div>
              )}

              <div className="pt-4">
                <Button
                  onClick={activeTab === 'buy' ? handleBuy : handleSell}
                  isLoading={loading}
                  disabled={
                    loading ||
                    !amount ||
                    numericAmount <= 0 ||
                    (activeTab === 'sell' && (!accountNo || !ifsc))
                  }
                  className="h-12 w-full rounded-2xl bg-indigo-600 font-medium text-white hover:bg-indigo-500"
                >
                  {activeTab === 'buy' ? `Pay INR ${amount || '0'} & Get XLM` : 'Initiate Payout'}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <Card variant="neon">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Execution plan
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {plan ? plan.readiness.headline : 'Preview a buy or sell route'}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {plan
                      ? plan.readiness.detail
                      : 'Once you enter an amount, the desk will turn the ramp into explicit stages and route cards.'}
                  </p>
                </div>
                {planLoading ? (
                  <Badge variant="default">
                    <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                    Planning
                  </Badge>
                ) : plan ? (
                  <Badge variant={statusVariant}>{plan.readiness.tone.toUpperCase()}</Badge>
                ) : null}
              </div>

              {plan ? (
                <div className="mt-6 space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    {Object.entries(plan.economics).map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          {key.replace(/([A-Z])/g, ' $1')}
                        </p>
                        <p className="mt-2 text-lg font-semibold text-white">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    {plan.stages.map((stage) => (
                      <div
                        key={stage.id}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">{stage.label}</p>
                          <Badge
                            variant={
                              stage.status === 'ready'
                                ? 'success'
                                : stage.status === 'attention'
                                  ? 'warning'
                                  : 'error'
                            }
                          >
                            {stage.status.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-400">{stage.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                  Enter a trade size to generate the plan.
                </div>
              )}
            </Card>

            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <Card variant="glass">
                <div className="mb-4 flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-indigo-300" />
                  <h3 className="text-lg font-semibold text-white">Scenario cards</h3>
                </div>
                <div className="space-y-3">
                  {(plan?.routeCards ?? workspace?.scenarioCards ?? []).map((card: any) => (
                    <div
                      key={card.route ?? card.id}
                      className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">{card.title}</p>
                        {'recommended' in card && card.recommended && (
                          <Badge variant="success">Recommended</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{card.detail}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card variant="glass">
                <div className="mb-4 flex items-center gap-2">
                  <Info className="h-5 w-5 text-indigo-300" />
                  <h3 className="text-lg font-semibold text-white">Next actions & warnings</h3>
                </div>
                <div className="space-y-3">
                  {(plan?.nextActions ?? workspace?.guidance ?? []).map((item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300"
                    >
                      {item}
                    </div>
                  ))}
                  {(plan?.warnings ?? []).map((warning) => (
                    <div
                      key={warning}
                      className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-100"
                    >
                      {warning}
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <Card variant="glass">
                <div className="mb-4 flex items-center gap-2">
                  <Landmark className="h-5 w-5 text-emerald-300" />
                  <h3 className="text-lg font-semibold text-white">Bank & payout rail</h3>
                </div>
                <div className="space-y-3">
                  {plan?.bankAccount ? (
                    <>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Destination
                        </p>
                        <p className="mt-2 text-sm text-white">{plan.bankAccount.maskedAccount}</p>
                        <p className="mt-1 text-xs text-slate-400">{plan.bankAccount.ifsc}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Validation</p>
                        <p className="mt-2 text-sm text-white">
                          {plan.bankAccount.validation.detail}
                        </p>
                      </div>
                    </>
                  ) : (
                    workspace?.payoutPolicy.bankRequirements.map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300"
                      >
                        {item}
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card variant="glass">
                <div className="mb-4 flex items-center gap-2">
                  <Building className="h-5 w-5 text-amber-300" />
                  <h3 className="text-lg font-semibold text-white">Inventory posture</h3>
                </div>
                <div className="space-y-3">
                  {plan?.inventory ? (
                    <>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Public inventory
                        </p>
                        <p className="mt-2 text-sm text-white">{plan.inventory.publicXlm} XLM</p>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Private inventory
                        </p>
                        <p className="mt-2 text-sm text-white">{plan.inventory.privateXlm} XLM</p>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Shortfall</p>
                        <p className="mt-2 text-sm text-white">
                          {plan.inventory.inventoryShortfall} XLM
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
                      Total XLM inventory: {workspace?.balances.totalXlm ?? 0}, split across public
                      and private lanes.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center opacity-70">
          <p className="flex items-center gap-2 text-xs text-slate-400">
            <Sparkles size={12} /> Planning the fiat ramp before execution reduces avoidable
            checkout, inventory, and payout failures.
          </p>
        </div>
      </div>
    </div>
  );
}
