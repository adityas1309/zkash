import * as React from 'react';
import { cn } from '@/lib/utils';
import { motion, HTMLMotionProps } from 'framer-motion';

interface CardProps extends HTMLMotionProps<"div"> {
    children: React.ReactNode;
    variant?: 'default' | 'glass' | 'neon';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, variant = 'glass', children, ...props }, ref) => {
        const variants = {
            default: "bg-slate-800 border border-slate-700",
            glass: "bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-xl", // Glassmorphism
            neon: "bg-slate-900/80 border border-indigo-500/50 shadow-[0_0_20px_rgba(79,70,229,0.15)]",
        };

        return (
            <motion.div
                ref={ref}
                className={cn("rounded-2xl p-6 transition-all duration-300", variants[variant], className)}
                {...props}
            >
                {children}
            </motion.div>
        );
    }
);
Card.displayName = "Card";
