'use client';

import Link from 'next/link';
import { usePrivacy } from '@/context/PrivacyContext';
import { PrivacyToggle } from '@/components/ui/PrivacyToggle';
import { motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Home, Wallet, Repeat, History, LogOut } from 'lucide-react';

export function Header() {
    const { isPrivate, togglePrivacy } = usePrivacy();
    const pathname = usePathname();

    const navItems = [
        { name: 'Dashboard', href: '/dashboard', icon: Home },
        { name: 'Wallet', href: '/wallet', icon: Wallet },
        { name: 'Swap', href: '/swap', icon: Repeat },
        { name: 'History', href: '/history', icon: History },
    ];

    return (
        <header className="sticky top-0 z-50 border-b border-white/5 bg-slate-950/80 backdrop-blur-xl">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                <Link href="/dashboard" className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                        P
                    </div>
                    <span className="font-bold text-xl tracking-tight text-white hidden sm:block">
                        Private<span className="text-indigo-500">P2P</span>
                    </span>
                </Link>

                {/* Desktop Nav */}
                <nav className="hidden md:flex items-center gap-1 bg-slate-900/50 p-1 rounded-full border border-white/5">
                    {navItems.map((item) => {
                        const isActive = pathname?.startsWith(item.href);
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={cn(
                                    "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-2",
                                    isActive
                                        ? "bg-slate-800 text-white shadow-sm"
                                        : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                                )}
                            >
                                <Icon size={16} />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-4">
                    <PrivacyToggle
                        checked={isPrivate}
                        onCheckedChange={togglePrivacy}
                        className="hidden sm:flex"
                    />

                    {/* Mobile Menu Button would go here, omitting for brevity/focus on toggle */}
                    <Link href="/api/auth/logout" className="p-2 text-slate-400 hover:text-red-400 transition-colors">
                        <LogOut size={20} />
                    </Link>
                </div>
            </div>
        </header>
    );
}
