"use client";

import { useLottie } from "lottie-react";
import privacyAnimation from "../public/lottie/privacy.json";
import { motion } from "framer-motion";
import { Card } from "./ui/Card";
import { Shield, Lock, Eye } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "End-to-End Encryption",
    description:
      "Your financial data is encrypted with military-grade protocols, ensuring complete security directly on the blockchain.",
  },
  {
    icon: Eye,
    title: "Anonymous Transactions",
    description:
      "Execute transactions without revealing your identity. We prioritize your privacy with advanced zero-knowledge proofs.",
  },
  {
    icon: Lock,
    title: "Non-Custodial",
    description:
      "You maintain full control of your assets. We never hold your funds, giving you true ownership and peace of mind.",
  },
];

export function PrivacySection() {
  const options = {
    animationData: privacyAnimation,
    loop: true,
    autoplay: true,
  };

  const { View } = useLottie(options);

  return (
    <section className="relative w-full py-24 overflow-hidden bg-slate-950">
      {/* Background Gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
      </div>

      {/* Top fade for seamless transition from Hero */}
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-slate-950 to-transparent z-[5] pointer-events-none" />

      <div className="container relative z-10 px-4 mx-auto max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Lottie Animation Side */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex justify-center lg:justify-start"
          >
            <div className="w-full max-w-[500px]">{View}</div>
          </motion.div>

          {/* Features Side */}
          <div className="flex flex-col gap-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="text-left"
            >
              <h2 className="text-4xl md:text-5xl font-bold tracking-tighter text-white mb-6 font-secondary">
                Privacy by <span className="text-indigo-500">Design</span>
              </h2>
              <p className="text-slate-400 text-lg leading-relaxed max-w-xl">
                We believe privacy is a fundamental right. Our architecture is
                built to protect your identity and your assets at every layer.
              </p>
            </motion.div>

            <div className="grid gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.5,
                    delay: index * 0.1,
                    ease: "easeOut",
                  }}
                >
                  <Card
                    variant="glass"
                    className="flex items-start gap-4 p-6 hover:bg-slate-800/50 transition-colors duration-300"
                  >
                    <div className="p-3 bg-indigo-500/20 rounded-xl">
                      <feature.icon className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white mb-2 font-secondary">
                        {feature.title}
                      </h3>
                      <p className="text-slate-400 leading-relaxed text-sm">
                        {feature.description}
                      </p>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
