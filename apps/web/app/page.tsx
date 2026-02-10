'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">Private P2P</h1>
      <p className="text-slate-400 mb-8 text-center max-w-md">
        Privacy-first P2P payments and swaps on Stellar testnet. Send USDC and XLM privately.
      </p>
      <a
        href={(process.env.NEXT_PUBLIC_API_URL ?? '/api') + '/auth/google'}
        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition inline-block"
      >
        Sign in with Google
      </a>
    </main>
  );
}
