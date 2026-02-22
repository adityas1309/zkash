"use client";

import { useState } from "react";
import Link from "next/link";
import { usePrivacy } from "@/context/PrivacyContext";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ArrowLeft, Send, Shield, Globe, Info } from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://lop-main.onrender.com";

export default function SendPage() {
  const { isPrivate } = usePrivacy();
  const [recipient, setRecipient] = useState("");
  const [asset, setAsset] = useState<"USDC" | "XLM">("XLM");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [processStep, setProcessStep] = useState("");

  const handleSplit = async (asset: "USDC" | "XLM", amount: number) => {
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

  const handleSend = async () => {
    if (!recipient || !amount) {
      setStatus("Please fill in all fields");
      return;
    }

    setLoading(true);
    setStatus("");
    setProcessStep(
      isPrivate ? "Generating proof and submitting..." : "Sending payment...",
    );

    const runDepositFlow = async (
      reqAsset: "USDC" | "XLM",
      reqAmount: number,
    ) => {
      if (
        confirm(
          `Insufficient private balance. Do you want to transfer ${reqAmount} ${reqAsset} from your public pool to continue?`,
        )
      ) {
        console.log("Insufficient balance, attempting auto-deposit...");
        await handleDeposit(reqAsset, reqAmount);
        return true;
      }
      throw new Error("Cancelled by user.");
    };

    try {
      const attemptSend = async () => {
        if (isPrivate) {
          const res = await fetch(`${API_URL}/users/send/private`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ recipient, asset, amount }),
          });
          const data = await res.json();

          if (!data.success) {
            throw new Error(data.error || "Unknown error");
          }
          return data;
        } else {
          const res = await fetch(`${API_URL}/users/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ recipient, asset, amount }),
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.message || "Unknown error");
          }
          return data;
        }
      };

      try {
        const data = await attemptSend();
        if (isPrivate) {
          setStatus(
            "Private payment submitted. Recipient can process withdrawals on their wallet.",
          );
        } else {
          setStatus(`Payment successful! TX: ${data.hash}`);
        }
        setAmount("");
        setRecipient("");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to send";
        const numAmount = parseFloat(amount);

        if (isPrivate) {
          if (
            msg.includes("No private note with EXACT amount") ||
            msg.includes("No spendable private note") ||
            msg.includes("Splitting not yet supported")
          ) {
            console.log("Exact note missing, attempting auto-split...");
            try {
              await handleSplit(asset, numAmount);
            } catch (splitErr: unknown) {
              const splitMsg =
                splitErr instanceof Error ? splitErr.message : String(splitErr);
              if (splitMsg.includes("Insufficient private balance")) {
                await runDepositFlow(asset, numAmount);
              } else {
                throw splitErr;
              }
            }

            setProcessStep("Retrying payment after split...");
            const retryData = await attemptSend();
            setStatus(
              "Private payment submitted. Recipient can process withdrawals on their wallet.",
            );
            setAmount("");
            setRecipient("");
          } else if (msg.includes("Insufficient private balance")) {
            await runDepositFlow(asset, numAmount);
            setProcessStep("Retrying payment after deposit...");
            const retryData = await attemptSend();
            setStatus(
              "Private payment submitted. Recipient can process withdrawals on their wallet.",
            );
            setAmount("");
            setRecipient("");
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "Cancelled by user.") {
        setStatus(msg);
      }
      console.error(e);
    } finally {
      setLoading(false);
      setProcessStep("");
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
          Send Payment
        </h1>
        <Badge variant={isPrivate ? "success" : "warning"}>
          {isPrivate ? (
            <span className="flex items-center gap-1">
              <Shield size={12} /> Private (ZK)
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Globe size={12} /> Public
            </span>
          )}
        </Badge>
      </div>

      <Card variant="glass" className="mb-6">
        <div className="space-y-6">
          <div className="p-4 rounded-lg bg-slate-800/30 border border-slate-700/50 flex items-start gap-3">
            <Info className="text-slate-400 shrink-0 mt-0.5" size={18} />
            <p className="text-sm text-slate-300">
              You are sending in{" "}
              <span
                className={
                  isPrivate
                    ? "text-indigo-400 font-bold"
                    : "text-blue-400 font-bold"
                }
              >
                {isPrivate ? "Private Mode" : "Public Mode"}
              </span>
              .
              {isPrivate
                ? " Your transaction details will be hidden using Zero-Knowledge proofs."
                : " This transaction will be visible on the public blockchain."}
            </p>
          </div>

          <div>
            <label className="block text-slate-400 text-sm font-medium mb-2">
              Recipient
            </label>
            <Input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Username or Stellar Address (G...)"
              disabled={loading}
              className="bg-slate-900/50"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <label className="block text-slate-400 text-sm font-medium mb-2">
                Asset
              </label>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value as "USDC" | "XLM")}
                className="w-full h-12 rounded-xl border border-slate-700 bg-slate-900/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-200"
                disabled={loading}
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-slate-400 text-sm font-medium mb-2">
                Amount
              </label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={loading}
                className="bg-slate-900/50 font-mono"
              />
            </div>
          </div>

          <Button
            onClick={handleSend}
            isLoading={loading}
            className="w-full"
            variant={isPrivate ? "primary" : "secondary"}
            disabled={!recipient || !amount}
          >
            <Send className="mr-2 h-4 w-4" />
            {isPrivate ? "Send Privately" : "Send Publicly"}
          </Button>
        </div>
      </Card>

      {status && (
        <Card
          variant={
            status.includes("success") || status.includes("submitted")
              ? "default"
              : "neon"
          }
          className="p-4 border-l-4 border-l-indigo-500"
        >
          <p className="text-slate-300 break-all text-sm">{status}</p>
        </Card>
      )}

      <div className="mt-6">
        <Link href="/wallet">
          <Button
            variant="ghost"
            size="sm"
            className="pl-0 text-slate-500 hover:text-slate-300"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Wallet
          </Button>
        </Link>
      </div>
    </div>
  );
}
