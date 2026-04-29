import type { Metadata } from 'next';
import { Space_Grotesk, Sora } from 'next/font/google';
import './globals.css';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { NetworkProvider } from '@/context/NetworkContext';
import { AppLayout } from '@/components/layout/AppLayout';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
});

export const metadata: Metadata = {
  title: 'Private P2P - Stellar',
  description: 'Privacy-first P2P payments and swaps on Stellar',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${sora.variable} font-sans bg-slate-950 text-slate-100 min-h-screen`}
      >
        <NetworkProvider>
          <PrivacyProvider>
            {/* We'll use AppLayout inside specific pages or here? 
                If we want the header on ALL pages, we put it here. 
                The task is to overhaul the whole frontend. */}
            <AppLayout>{children}</AppLayout>
          </PrivacyProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
