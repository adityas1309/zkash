"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrivacy } from "@/context/PrivacyContext";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  Globe,
  Lock,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://lop-main.onrender.com";

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
  const { isPrivate } = usePrivacy();

  return (
    <Card variant="neon" className="mb-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <Lock size={100} />
      </div>

      <div className="mb-6 relative z-10">
        <div className="flex justify-between items-start mb-2">
          <p className="font-medium text-slate-300">
            {isSeller ? "Buyer" : "Seller"}:{" "}
            <span className="text-indigo-400">
              @
              {isSeller
                ? swap.aliceId?.username
                : swap.bobId?.username || "Unknown"}
            </span>
          </p>
          <Badge
            variant="default"
            className="bg-blue-500/20 text-blue-300 border-blue-500/30"
          >
            LOCKED
          </Badge>
        </div>

        <div className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
          {isSeller ? (
            <>
              {swap.amountOut} USDC{" "}
              <ArrowLeft className="w-4 h-4 text-slate-500" /> {swap.amountIn}{" "}
              XLM
            </>
          ) : (
            <>
              {swap.amountIn} XLM{" "}
              <ArrowLeft className="w-4 h-4 text-slate-500" /> {swap.amountOut}{" "}
              USDC
            </>
          )}
        </div>
        <p className="text-slate-500 text-xs flex items-center gap-1">
          <Clock size={12} />
          {new Date(swap.createdAt).toLocaleString()}
        </p>
      </div>

      <div className="space-y-3 relative z-10">
        {isSeller &&
          (!isPrivate ? (
            <Button
              onClick={onExecute}
              isLoading={actionLoading === swap._id}
              className="w-full"
              variant="primary"
            >
              Execute Publicly
            </Button>
          ) : (
            <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700/50 text-center">
              <p className="text-sm text-slate-400 mb-2">
                Switch to Public mode to execute on-chain
              </p>
              <Button
                disabled
                variant="secondary"
                className="w-full opacity-50 cursor-not-allowed"
              >
                Execute Publicly (Disabled in Private Mode)
              </Button>
            </div>
          ))}

        {isPrivate ? (
          swap.proofReady ? (
            <Button
              onClick={onExecutePrivate}
              isLoading={actionLoading === swap._id}
              className="w-full"
              variant="primary" // Greenish via custom class or just primary
            >
              <Shield className="w-4 h-4 mr-2" />
              Execute Private Swap
            </Button>
          ) : !swap.hasMyProof ? (
            <Button
              onClick={onPrepareProof}
              isLoading={actionLoading === swap._id}
              className="w-full"
              variant="primary"
            >
              <Shield className="w-4 h-4 mr-2" />
              Prepare Private Execution
            </Button>
          ) : (
            <div className="p-3 bg-slate-800/50 rounded-lg text-center border border-slate-700">
              <p className="text-slate-400 text-sm">
                Your proof is submitted. Waiting for counterparty.
              </p>
            </div>
          )
        ) : (
          // In Public mode, show Private option but maybe less prominent or disabled/hinted?
          // The requirement says "if public is selected then all send p2p swap will be publicly exuted"
          // "if private is on then all things will be privatelt executed through zk flow"
          // So we should hide the other option or disable it to enforce the toggle.
          <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700/50 text-center">
            <p className="text-sm text-slate-400 mb-2">
              Switch to Private mode for ZK Swap
            </p>
            <Button
              disabled
              variant="secondary"
              className="w-full opacity-50 cursor-not-allowed"
            >
              <Shield className="w-4 h-4 mr-2" />
              Private Swap (Disabled in Public Mode)
            </Button>
          </div>
        )}
      </div>
    </Card>
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
  status: "requested" | "locked" | "completed" | "cancelled";
  createdAt: string;
  txHash?: string;
  proofReady?: boolean;
  hasMyProof?: boolean;
}

export default function MySwapsPage() {
  const { isPrivate } = usePrivacy();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [pendingSwaps, setPendingSwaps] = useState<Swap[]>([]);
  const [allSwaps, setAllSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [needsSplit, setNeedsSplit] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [userRes, pendingRes, myRes] = await Promise.all([
        fetch(`${API_URL}/users/me`, { credentials: "include" }),
        fetch(`${API_URL}/swap/pending`, { credentials: "include" }),
        fetch(`${API_URL}/swap/my`, { credentials: "include" }),
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
      setError("Failed to load swaps");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAccept = async (swapId: string) => {
    setActionLoading(swapId);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`${API_URL}/swap/${swapId}/accept`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to accept swap");
      }

      setSuccess("Swap accepted! Now execute the transaction.");
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept swap");
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecute = async (swapId: string) => {
    setActionLoading(swapId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_URL}/swap/${swapId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to execute swap");
      }
      setSuccess("Swap completed successfully!");
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to execute swap");
    } finally {
      setActionLoading(null);
    }
  };

  const [autoProcessing, setAutoProcessing] = useState<string | null>(null);
  const [processStep, setProcessStep] = useState<string>("");

  const handleExecutePrivate = async (swapId: string) => {
    setActionLoading(swapId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_URL}/swap/${swapId}/execute-private`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server error: ${res.status} ${res.statusText}`);
      }
      if (!res.ok || data.error) {
        throw new Error(
          data.error || data.message || "Failed to execute private swap",
        );
      }
      setSuccess("Private swap completed! TX: " + (data.txHash ?? ""));
      await fetchData();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to execute private swap",
      );
    } finally {
      setActionLoading(null);
      setAutoProcessing(null);
    }
  };

  const handleSplit = async (
    swapId: string,
    asset: "USDC" | "XLM",
    amount: number,
  ) => {
    setProcessStep("Splitting note to match exact amount...");
    try {
      const res = await fetch(`${API_URL}/users/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error || "Split failed");

      // Wait a bit for the transaction to be confirmed and indexed
      setProcessStep("Waiting for split confirmation...");
      await new Promise((r) => setTimeout(r, 6000));
      return true;
    } catch (e) {
      throw e;
    }
  };

  const handleDeposit = async (asset: "USDC" | "XLM", amount: number) => {
    setProcessStep(`Depositing ${amount} ${asset} from public balance...`);
    try {
      const res = await fetch(`${API_URL}/users/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ asset, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        // Wait for deposit to be indexed
        setProcessStep("Waiting for deposit confirmation...");
        await new Promise((r) => setTimeout(r, 6000));
        return true;
      } else {
        throw new Error(data.error || "Deposit failed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        msg.includes("fetch") || msg.includes("Failed")
          ? "Deposit failed. The network may be slow."
          : `Deposit failed: ${msg}`,
      );
    }
  };

  const handlePrepareProof = async (
    swapId: string,
    isBuyer: boolean,
    amount: number,
    asset: "USDC" | "XLM",
  ) => {
    setActionLoading(swapId);
    setAutoProcessing(swapId);
    setError("");
    setSuccess("");
    setNeedsSplit(null);
    setProcessStep("Preparing proof...");

    const runDepositFlow = async () => {
      if (
        confirm(
          `Insufficient private balance. Do you want to transfer ${amount} ${asset} from your public pool to continue?`,
        )
      ) {
        console.log("Insufficient balance, attempting auto-deposit...");
        await handleDeposit(asset, amount);
        return true;
      }
      throw new Error("Cancelled by user.");
    };

    try {
      const attemptPrepare = async () => {
        const res = await fetch(`${API_URL}/swap/${swapId}/prepare-my-proof`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data;
      };

      const handleSuccess = async (data: any) => {
        setSuccess(
          data.ready
            ? "Both proofs ready. Auto-executing..."
            : "Your proof is ready. Waiting for the other party.",
        );
        await fetchData();
        if (data.ready) {
          setProcessStep("Executing private swap...");
          await handleExecutePrivate(swapId);
        }
      };

      try {
        const data = await attemptPrepare();
        await handleSuccess(data);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to prepare proof";
        if (msg.includes("No private note with EXACT amount")) {
          // Auto-split logic
          console.log("Exact note missing, attempting auto-split...");
          try {
            await handleSplit(swapId, asset, amount);
          } catch (splitErr: unknown) {
            const splitMsg =
              splitErr instanceof Error ? splitErr.message : String(splitErr);
            if (splitMsg.includes("Insufficient private balance")) {
              await runDepositFlow();
            } else {
              throw splitErr;
            }
          }
          setProcessStep("Retrying proof preparation...");
          const retryData = await attemptPrepare();
          await handleSuccess(retryData);
        } else if (msg.includes("Insufficient private balance")) {
          await runDepositFlow();
          setProcessStep("Retrying proof preparation after deposit...");
          const retryData = await attemptPrepare();
          await handleSuccess(retryData);
        } else {
          throw err;
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to prepare proof";
      if (msg !== "Cancelled by user.") {
        setError(msg);
      }
      setAutoProcessing(null);
    } finally {
      if (!autoProcessing) {
        setActionLoading(null);
        setProcessStep("");
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<
      string,
      "warning" | "default" | "success" | "error"
    > = {
      requested: "warning",
      locked: "default", // blue-ish
      completed: "success",
      cancelled: "error",
    };
    return (
      <Badge variant={variants[status] || "default"}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  // Filter swaps where I'm the buyer (alice)
  const swapsAsBuyer = allSwaps.filter(
    (s) => s.aliceId?._id === currentUser?._id,
  );
  // Filter swaps where I'm the seller (bob), excluding pending (they go in pendingSwaps)
  const swapsAsSeller = allSwaps.filter(
    (s) => s.bobId?._id === currentUser?._id && s.status !== "requested",
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <main className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            My Swaps
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Logged in as:{" "}
            <span className="text-indigo-400">
              @{currentUser?.username || "Unknown"}
            </span>
          </p>
        </div>
        <Badge
          variant={isPrivate ? "success" : "warning"}
          className="px-3 py-1"
        >
          {isPrivate ? (
            <span className="flex items-center gap-1">
              <Shield size={14} /> Private Mode Active
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Globe size={14} /> Public Mode Active
            </span>
          )}
        </Badge>
      </div>

      {error && (
        <Card
          variant="default"
          className="bg-red-900/20 border-red-500/50 mb-6 flex items-start gap-4"
        >
          <XCircle className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-200">{error}</p>
        </Card>
      )}

      {success && (
        <Card
          variant="default"
          className="bg-green-900/20 border-green-500/50 mb-6 flex items-start gap-4"
        >
          <CheckCircle className="text-green-400 shrink-0 mt-0.5" />
          <p className="text-green-200">{success}</p>
        </Card>
      )}

      {autoProcessing && (
        <Card
          variant="neon"
          className="mb-6 flex items-center justify-center gap-3 p-4"
        >
          <RefreshCw className="animate-spin text-indigo-400" />
          <span className="text-indigo-200 animate-pulse">
            {processStep || "Processing..."}
          </span>
        </Card>
      )}

      {/* Pending Swaps to Accept (as Seller) */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white">
          <div className="p-1.5 bg-yellow-500/20 rounded-lg">
            <Clock size={16} className="text-yellow-400" />
          </div>
          Pending Requests{" "}
          <span className="text-sm font-normal text-slate-500">
            (You are Seller)
          </span>
        </h2>

        {pendingSwaps.length === 0 ? (
          <Card variant="glass" className="text-center py-8">
            <p className="text-slate-500">No pending swap requests.</p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {pendingSwaps.map((swap) => (
              <Card
                key={swap._id}
                variant="default"
                className="border-l-4 border-l-yellow-500"
              >
                <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-white">
                        @{swap.aliceId?.username || "Unknown"}
                      </span>
                      <Badge variant="warning">Wants to Buy</Badge>
                    </div>
                    <p className="text-slate-300 text-lg">
                      {swap.amountIn} XLM{" "}
                      <span className="text-slate-500">→</span> {swap.amountOut}{" "}
                      USDC
                    </p>
                    <p className="text-slate-500 text-xs mt-2">
                      {new Date(swap.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right">
                    {getStatusBadge(swap.status)}
                    <Button
                      onClick={() => handleAccept(swap._id)}
                      isLoading={actionLoading === swap._id}
                      variant="primary"
                      size="sm"
                    >
                      Accept Swap
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Locked Swaps to Execute (as Seller) */}
      {swapsAsSeller.filter((s) => s.status === "locked").length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white">
            <div className="p-1.5 bg-blue-500/20 rounded-lg">
              <Lock size={16} className="text-blue-400" />
            </div>
            Ready to Execute{" "}
            <span className="text-sm font-normal text-slate-500">
              (You are Seller)
            </span>
          </h2>

          <div className="grid gap-4">
            {swapsAsSeller
              .filter((s) => s.status === "locked")
              .map((swap) => (
                <LockedSwapCard
                  key={swap._id}
                  swap={swap}
                  isSeller
                  actionLoading={actionLoading}
                  onExecute={() => handleExecute(swap._id)}
                  onPrepareProof={() =>
                    handlePrepareProof(swap._id, true, swap.amountOut, "USDC")
                  }
                  onExecutePrivate={() => handleExecutePrivate(swap._id)}
                />
              ))}
          </div>
        </section>
      )}

      {/* Locked Swaps (as Buyer) - submit proof */}
      {swapsAsBuyer.filter((s) => s.status === "locked").length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-white">
            <div className="p-1.5 bg-blue-500/20 rounded-lg">
              <Lock size={16} className="text-blue-400" />
            </div>
            Locked Swaps{" "}
            <span className="text-sm font-normal text-slate-500">
              (You are Buyer)
            </span>
          </h2>
          <div className="grid gap-4">
            {swapsAsBuyer
              .filter((s) => s.status === "locked")
              .map((swap) => (
                <LockedSwapCard
                  key={swap._id}
                  swap={swap}
                  isSeller={false}
                  actionLoading={actionLoading}
                  onExecute={() => {}}
                  onPrepareProof={() =>
                    handlePrepareProof(swap._id, false, swap.amountIn, "XLM")
                  }
                  onExecutePrivate={() => handleExecutePrivate(swap._id)}
                />
              ))}
          </div>
        </section>
      )}

      {/* My Swaps as Buyer */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4 text-white">
          Requested Swaps
        </h2>

        {swapsAsBuyer.length === 0 ? (
          <Card variant="glass" className="text-center py-8">
            <p className="text-slate-500">
              You haven&apos;t initiated any swaps yet.
            </p>
            <Link href="/swap" className="mt-4 inline-block">
              <Button variant="outline">Browse Offers</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-4">
            {swapsAsBuyer.map((swap) => (
              <Card key={swap._id} variant="glass">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-slate-300">
                      Seller:{" "}
                      <span className="text-indigo-400">
                        @{swap.bobId?.username || "Unknown"}
                      </span>
                    </p>
                    <p className="text-white mt-1">
                      {swap.amountIn} XLM{" "}
                      <span className="text-slate-500">→</span> {swap.amountOut}{" "}
                      USDC
                    </p>
                    <p className="text-slate-500 text-xs mt-2">
                      {new Date(swap.createdAt).toLocaleString()}
                    </p>
                    {swap.txHash && swap.txHash !== "pending" && (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${swap.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-400 text-xs hover:underline mt-2 inline-flex items-center gap-1"
                      >
                        View Transaction <Globe size={10} />
                      </a>
                    )}
                  </div>
                  {getStatusBadge(swap.status)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Completed Swaps as Seller */}
      {swapsAsSeller.filter((s) => s.status === "completed").length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-white">
            Completed Sales
          </h2>

          <div className="grid gap-4">
            {swapsAsSeller
              .filter((s) => s.status === "completed")
              .map((swap) => (
                <Card
                  key={swap._id}
                  variant="glass"
                  className="opacity-75 hover:opacity-100 transition-opacity"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-slate-300">
                        Buyer:{" "}
                        <span className="text-indigo-400">
                          @{swap.aliceId?.username || "Unknown"}
                        </span>
                      </p>
                      <p className="text-white mt-1">
                        Sold {swap.amountOut} USDC for {swap.amountIn} XLM
                      </p>
                      {swap.txHash && swap.txHash !== "pending" && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${swap.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 text-xs hover:underline mt-2 inline-flex items-center gap-1"
                        >
                          View Transaction <Globe size={10} />
                        </a>
                      )}
                    </div>
                    {getStatusBadge(swap.status)}
                  </div>
                </Card>
              ))}
          </div>
        </section>
      )}

      <div className="mt-8 flex gap-4">
        <Link href="/swap">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Browse Offers
          </Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="ghost">Dashboard</Button>
        </Link>
      </div>
    </main>
  );
}
