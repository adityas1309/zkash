'use client';

import { motion } from 'framer-motion';
import { Shield, Zap, ArrowRightLeft, Lock, Globe, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

export default function Home() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 overflow-hidden relative selection:bg-indigo-500/30">

      {/* Background Gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-violet-500/10 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-20 lg:py-32">

        {/* Hero Section */}
        <div className="text-center max-w-4xl mx-auto mb-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div className="inline-flex items-center space-x-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span className="text-sm font-medium text-indigo-300 tracking-wide">LIVE ON STELLAR TESTNET</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
              Financial Privacy, <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                Reimagined.
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              Experience the power of Zero-Knowledge proofs. Send, swap, and transact universally without revealing your balance or history.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href={`${API_URL}/auth/google`}>
                <Button size="lg" className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20">
                  Start Private Transaction <ArrowRightLeft className="ml-2 w-4 h-4" />
                </Button>
              </a>
              <a href="#features" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">
                Learn how it works <ChevronRight className="inline w-3 h-3" />
              </a>
            </div>
          </motion.div>
        </div>

        {/* Features Grid */}
        <motion.div
          id="features"
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20"
        >
          <motion.div variants={item}>
            <Card className="h-full bg-slate-900/50 border-slate-800 backdrop-blur-sm p-8 hover:border-indigo-500/30 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-6 group-hover:bg-indigo-500/20 transition-colors">
                <Shield className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Zero-Knowledge</h3>
              <p className="text-slate-400 leading-relaxed">
                Your transactions are mathematically proven valid without revealing sender, receiver, or amount using zk-SNARKs.
              </p>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card className="h-full bg-slate-900/50 border-slate-800 backdrop-blur-sm p-8 hover:border-indigo-500/30 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-6 group-hover:bg-indigo-500/20 transition-colors">
                <Zap className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Instant Settlement</h3>
              <p className="text-slate-400 leading-relaxed">
                Powered by Soroban on Stellar. Enjoy 5-second finality and negligible fees (&lt;0.00001 XLM).
              </p>
            </Card>
          </motion.div>

          <motion.div variants={item}>
            <Card className="h-full bg-slate-900/50 border-slate-800 backdrop-blur-sm p-8 hover:border-indigo-500/30 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-6 group-hover:bg-indigo-500/20 transition-colors">
                <Globe className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Universal Access</h3>
              <p className="text-slate-400 leading-relaxed">
                Global access to USDC and XLM liquidity. Deposit from public, transact in private, withdraw anywhere.
              </p>
            </Card>
          </motion.div>
        </motion.div>

        {/* Technical Stats / Trust */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-slate-800 pt-16">
          {[
            { label: 'Network', value: 'Stellar Testnet' },
            { label: 'Technology', value: 'Soroban + Circom' },
            { label: 'Proof System', value: 'Groth16' },
            { label: 'Status', value: 'Beta' },
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <p className="text-slate-400 text-sm mb-1">{stat.label}</p>
              <p className="text-lg font-mono font-medium text-indigo-300">{stat.value}</p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}
