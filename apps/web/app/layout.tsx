import type { Metadata } from 'next';
import './globals.css';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { AppLayout } from '@/components/layout/AppLayout';

export const metadata: Metadata = {
  title: 'Private P2P - Stellar',
  description: 'Privacy-first P2P payments and swaps on Stellar testnet',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen">
        <PrivacyProvider>
          {/* We'll use AppLayout inside specific pages or here? 
              If we want the header on ALL pages, we put it here. 
              The task is to overhaul the whole frontend. */}
          <AppLayout>
            {children}
          </AppLayout>
        </PrivacyProvider>
      </body>
    </html>
  );
}
