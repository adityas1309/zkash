import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Private P2P - Stellar',
  description: 'Privacy-first P2P payments and swaps on Stellar testnet',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen">{children}</body>
    </html>
  );
}
