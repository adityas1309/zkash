'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface PrivacyContextType {
    isPrivate: boolean;
    togglePrivacy: () => void;
    setPrivacy: (isPrivate: boolean) => void;
}

const PrivacyContext = createContext<PrivacyContextType | undefined>(undefined);

export function PrivacyProvider({ children }: { children: ReactNode }) {
    const [isPrivate, setIsPrivate] = useState<boolean | null>(null);

    // Load from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('isPrivate');
        setIsPrivate(saved === 'true');
    }, []);

    // Save to localStorage properly
    const handleSetPrivacy = (value: boolean) => {
        setIsPrivate(value);
        localStorage.setItem('isPrivate', String(value));
    };

    const togglePrivacy = () => {
        if (isPrivate === null) return;
        handleSetPrivacy(!isPrivate);
    };

    // Prevent flash by waiting until state is loaded, or default to public (false) if needed
    // But wait! We want to avoid hydration mismatch if using SSR. 
    // However, this state is purely client-side preference.
    // We can render children but maybe with a default?
    // Let's just return children. The components consuming this context might re-render, 
    // or we can show a loader if critical. 
    // For this app, defaulting to Public (false) until loaded is fine, OR just use isPrivate || false.

    const value = {
        isPrivate: isPrivate ?? false, // Default to Public if not yet loaded
        togglePrivacy,
        setPrivacy: handleSetPrivacy,
    };

    // Avoid rendering children until we know the preference to prevent a flash of "Public" UI then switching to "Private"?
    // Actually, let's just render. The toggle moving is fine.

    return (
        <PrivacyContext.Provider value={value}>
            {children}
        </PrivacyContext.Provider>
    );
}

export function usePrivacy() {
    const context = useContext(PrivacyContext);
    if (context === undefined) {
        throw new Error('usePrivacy must be used within a PrivacyProvider');
    }
    return context;
}
