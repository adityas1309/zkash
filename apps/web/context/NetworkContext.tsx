"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type NetworkType = "testnet" | "mainnet";

interface NetworkContextType {
    network: NetworkType;
    setNetwork: (network: NetworkType) => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
    const [network, setNetworkState] = useState<NetworkType>("testnet");

    useEffect(() => {
        // Check localStorage for saved network preference on mount
        const saved = localStorage.getItem("stellar_network") as NetworkType;
        if (saved === "testnet" || saved === "mainnet") {
            setNetworkState(saved);
        }
    }, []);

    const setNetwork = (newNetwork: NetworkType) => {
        setNetworkState(newNetwork);
        localStorage.setItem("stellar_network", newNetwork);
        // Setting a cookie so server-side or API routes can also see it easily if needed
        document.cookie = `stellar_network=${newNetwork}; path=/; max-age=31536000; SameSite=Lax`;

        // Optional: reload the page to cleanly wipe react-query or any cached states
        // window.location.reload();
    };

    return (
        <NetworkContext.Provider value={{ network, setNetwork }}>
            {children}
        </NetworkContext.Provider>
    );
}

export function useNetwork() {
    const context = useContext(NetworkContext);
    if (context === undefined) {
        throw new Error("useNetwork must be used within a NetworkProvider");
    }
    return context;
}
