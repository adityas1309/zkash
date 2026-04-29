'use client';

import * as React from 'react';
import { useNetwork } from '@/context/NetworkContext';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export function NetworkToggle({ className }: { className?: string }) {
  const { network, setNetwork } = useNetwork();
  const isMainnet = network === 'mainnet';

  const toggleNetwork = () => {
    setNetwork(isMainnet ? 'testnet' : 'mainnet');
  };

  return (
    <div
      className={cn('flex items-center gap-3 cursor-pointer', className)}
      onClick={toggleNetwork}
    >
      <span
        className={cn(
          'text-sm font-medium transition-colors',
          !isMainnet ? 'text-white' : 'text-slate-500',
        )}
      >
        Testnet
      </span>

      <div
        className={cn(
          'w-14 h-8 rounded-full p-1 transition-colors duration-300 relative',
          isMainnet
            ? 'bg-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
            : 'bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.5)]',
        )}
      >
        <motion.div
          className="w-6 h-6 bg-white rounded-full shadow-md"
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 30 }}
          animate={{ x: isMainnet ? 24 : 0 }}
        />
      </div>

      <span
        className={cn(
          'text-sm font-medium transition-colors',
          isMainnet ? 'text-white' : 'text-slate-500',
        )}
      >
        Mainnet
      </span>
    </div>
  );
}
