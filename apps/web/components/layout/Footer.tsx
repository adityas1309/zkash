'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Github, Twitter, Mail, Shield, Lock, Eye } from 'lucide-react';

const footerLinks = {
  product: [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Wallet', href: '/wallet' },
    { name: 'Swap', href: '/swap' },
    { name: 'History', href: '/history' },
  ],
  privacy: [
    { name: 'Zero-Knowledge Proofs', href: '#' },
    { name: 'End-to-End Encryption', href: '#' },
    { name: 'Non-Custodial', href: '#' },
    { name: 'Privacy Policy', href: '#' },
  ],
  resources: [
    { name: 'Documentation', href: '#' },
    { name: 'API Reference', href: '#' },
    { name: 'Support', href: '#' },
    { name: 'Status', href: '#' },
  ],
};

const socialLinks = [
  { icon: Github, href: '#', label: 'GitHub' },
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Mail, href: '#', label: 'Email' },
];

const privacyFeatures = [
  { icon: Shield, text: 'Military-grade encryption' },
  { icon: Eye, text: 'Anonymous transactions' },
  { icon: Lock, text: 'Non-custodial security' },
];

export function Footer() {
  return (
    <footer className="relative w-full bg-slate-950 border-t border-white/5 overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[60%] bg-indigo-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[60%] bg-purple-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="container relative z-10 px-4 mx-auto max-w-6xl">
        {/* Main Footer Content */}
        <div className="py-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
          {/* Brand Section */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-3 group mb-4">
              <div className="relative w-10 h-10 group-hover:scale-105 transition-transform duration-300">
                <Image
                  src="/logo/ZKash-logo.webp"
                  alt="ZKash Logo"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="font-bold text-2xl tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-indigo-200">
                ZKash
              </span>
            </Link>
            <p className="text-slate-400 text-sm leading-relaxed mb-6 max-w-sm">
              Privacy-first P2P payments and swaps on Stellar testnet. Transfer and convert
              instantly with zero-knowledge proofs.
            </p>

            {/* Privacy Features */}
            <div className="flex flex-col gap-2">
              {privacyFeatures.map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-center gap-2 text-slate-500 text-xs"
                >
                  <feature.icon className="w-3 h-3 text-indigo-500" />
                  <span>{feature.text}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="font-bold text-white mb-4 text-sm font-secondary">Product</h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-slate-400 hover:text-indigo-400 transition-colors text-sm"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Privacy Links */}
          <div>
            <h3 className="font-bold text-white mb-4 text-sm font-secondary">Privacy</h3>
            <ul className="space-y-3">
              {footerLinks.privacy.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-slate-400 hover:text-indigo-400 transition-colors text-sm"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources Links */}
          <div>
            <h3 className="font-bold text-white mb-4 text-sm font-secondary">Resources</h3>
            <ul className="space-y-3">
              {footerLinks.resources.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-slate-400 hover:text-indigo-400 transition-colors text-sm"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-6 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">
            © {new Date().getFullYear()} ZKash. All rights reserved.
          </p>

          {/* Social Links */}
          <div className="flex items-center gap-4">
            {socialLinks.map((social) => (
              <Link
                key={social.label}
                href={social.href}
                aria-label={social.label}
                className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/50 rounded-lg transition-all duration-200"
              >
                <social.icon size={18} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
