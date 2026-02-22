"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ArrowRight, Plus, RefreshCw, Star, Wallet, Globe } from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://lop-main.onrender.com";

interface Offer {
  _id: string;
  assetIn: string;
  assetOut: string;
  rate: number;
  min: number;
  max: number;
  merchantId?: { username: string; _id: string; reputation?: number };
}

export default function SwapPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/offers`)
      .then((r) => r.json())
      .then(setOffers)
      .finally(() => setLoading(false));
  }, []);

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
            P2P Market
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Buy and sell assets directly with other users.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/swap/my">
            <Button variant="ghost">
              <Wallet className="mr-2 h-4 w-4" />
              My Swaps
            </Button>
          </Link>
          <Link href="/swap/create">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Create Offer
            </Button>
          </Link>
        </div>
      </div>

      <section>
        <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
          <Globe className="text-indigo-400" size={20} />
          Available Offers
        </h2>

        {offers.length === 0 ? (
          <Card variant="glass" className="text-center py-12">
            <div className="flex flex-col items-center gap-4">
              <RefreshCw size={48} className="text-slate-600" />
              <p className="text-slate-400 text-lg">No active offers found.</p>
              <p className="text-slate-500 text-sm max-w-sm mx-auto">
                Be the first to create an offer and start trading XLM for USDC.
              </p>
              <Link href="/swap/create" className="mt-2">
                <Button variant="outline">Create New Offer</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {offers.map((o) => (
              <Card
                key={o._id}
                variant="glass"
                className="hover:bg-slate-800/50 transition-colors group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white text-lg">
                        @{o.merchantId?.username || "Unknown"}
                      </span>
                      {o.merchantId?.reputation !== undefined && (
                        <Badge
                          variant="warning"
                          className="text-xs px-1.5 py-0.5"
                        >
                          <Star size={10} className="mr-1 fill-current" />
                          {o.merchantId.reputation}
                        </Badge>
                      )}
                    </div>
                    <Badge
                      variant="default"
                      className="bg-slate-700/50 text-slate-300 border-slate-600/50"
                    >
                      SELLER
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white tracking-tight">
                      {o.rate}{" "}
                      <span className="text-sm font-normal text-slate-400">
                        USDC/XLM
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Exchange Rate</p>
                  </div>
                </div>

                <div className="bg-slate-900/40 rounded-lg p-3 mb-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Offering:</span>
                    <span className="text-white font-medium">{o.assetOut}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">For:</span>
                    <span className="text-white font-medium">{o.assetIn}</span>
                  </div>
                  <div className="h-px bg-slate-700/50 my-2" />
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Limits:</span>
                    <span className="text-indigo-300 font-mono">
                      {o.min} - {o.max} {o.assetIn}
                    </span>
                  </div>
                </div>

                <Link href={`/swap/${o._id}`} className="block">
                  <Button className="w-full group-hover:bg-indigo-500 transition-colors">
                    Swap Now{" "}
                    <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
