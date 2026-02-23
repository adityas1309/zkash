"use client";

import { useNetwork } from "@/context/NetworkContext";
import { Globe, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export function NetworkToggle() {
    const { network, setNetwork } = useNetwork();
    const isMainnet = network === "mainnet";

    const toggleNetwork = () => {
        setNetwork(isMainnet ? "testnet" : "mainnet");
    };

    return (
        <button
            onClick={toggleNetwork}
            className="relative flex items-center gap-2 p-1 rounded-full bg-slate-900/50 border border-white/5 transition-all hover:bg-slate-800/80"
            title={`Switch to ${isMainnet ? 'Testnet' : 'Mainnet'}`}
        >
            <div
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300",
                    !isMainnet
                        ? "bg-indigo-500/20 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.2)]"
                        : "text-slate-400"
                )}
            >
                <Activity size={14} />
                <span className="hidden sm:inline">Testnet</span>
            </div>
            <div
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300",
                    isMainnet
                        ? "bg-emerald-500/20 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                        : "text-slate-400"
                )}
            >
                <Globe size={14} />
                <span className="hidden sm:inline">Mainnet</span>
            </div>
        </button>
    );
}
