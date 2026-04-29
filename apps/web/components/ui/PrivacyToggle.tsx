'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils'; // Make sure to configure path alias or use relative path

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  leftLabel?: React.ReactNode;
  rightLabel?: React.ReactNode;
}

export function PrivacyToggle({
  checked,
  onCheckedChange,
  className,
  leftLabel,
  rightLabel,
}: ToggleProps) {
  return (
    <div
      className={cn('flex items-center gap-3 cursor-pointer', className)}
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        className={cn(
          'text-sm font-medium transition-colors',
          !checked ? 'text-white' : 'text-slate-500',
        )}
      >
        {leftLabel || 'Public'}
      </span>

      <div
        className={cn(
          'w-14 h-8 rounded-full p-1 transition-colors duration-300 relative',
          checked ? 'bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.5)]' : 'bg-slate-700',
        )}
      >
        <motion.div
          className="w-6 h-6 bg-white rounded-full shadow-md"
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 30 }}
          animate={{ x: checked ? 24 : 0 }}
        />
      </div>

      <span
        className={cn(
          'text-sm font-medium transition-colors',
          checked ? 'text-white' : 'text-slate-500',
        )}
      >
        {rightLabel || 'Private (ZK)'}
      </span>
    </div>
  );
}
