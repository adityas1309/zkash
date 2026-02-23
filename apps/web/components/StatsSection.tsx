"use client";

import { motion } from "framer-motion";
import { Users, ArrowRightLeft, TrendingUp, Zap } from "lucide-react";
import { Card } from "./ui/Card";
import { useEffect, useState } from "react";

const stats = [
  {
    icon: Users,
    label: "Active Users",
    value: 12500,
    suffix: "+",
    color: "indigo",
  },
  {
    icon: ArrowRightLeft,
    label: "Transactions",
    value: 847000,
    suffix: "+",
    color: "purple",
  },
  {
    icon: TrendingUp,
    label: "Volume Traded",
    value: 2.4,
    prefix: "$",
    suffix: "M",
    color: "blue",
  },
  {
    icon: Zap,
    label: "Avg. Speed",
    value: 3.2,
    suffix: "s",
    color: "violet",
  },
];

function AnimatedCounter({
  end,
  duration = 2,
  prefix = "",
  suffix = "",
}: {
  end: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / (duration * 1000), 1);

      setCount(Math.floor(progress * end));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1);
    }
    if (num >= 1000) {
      return num.toLocaleString();
    }
    return num.toFixed(1);
  };

  return (
    <span>
      {prefix}
      {formatNumber(count)}
      {suffix}
    </span>
  );
}

export function StatsSection() {
  return (
    <section className="relative w-full py-24 overflow-hidden bg-slate-950">
      {/* Background Gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px]" />
      </div>

      {/* Top fade for seamless transition from PrivacySection */}
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-slate-950 to-transparent z-[5] pointer-events-none" />

      <div className="container relative z-10 px-4 mx-auto max-w-6xl">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold tracking-tighter text-white mb-4 font-secondary">
            Trusted by <span className="text-indigo-500">Thousands</span>
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed max-w-2xl mx-auto">
            Join a growing community of users who trust ZKash for private,
            secure, and instant transactions.
          </p>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, index) => {
            const colorClasses = {
              indigo: {
                bg: "bg-indigo-500/20",
                text: "text-indigo-400",
                glow: "shadow-indigo-500/20",
              },
              purple: {
                bg: "bg-purple-500/20",
                text: "text-purple-400",
                glow: "shadow-purple-500/20",
              },
              blue: {
                bg: "bg-blue-500/20",
                text: "text-blue-400",
                glow: "shadow-blue-500/20",
              },
              violet: {
                bg: "bg-violet-500/20",
                text: "text-violet-400",
                glow: "shadow-violet-500/20",
              },
            };

            const colors = colorClasses[stat.color as keyof typeof colorClasses];

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.6,
                  delay: index * 0.1,
                  ease: "easeOut",
                }}
              >
                <Card
                  variant="glass"
                  className={`flex flex-col items-center text-center p-8 hover:bg-slate-800/50 transition-all duration-300 group hover:scale-105 ${colors.glow}`}
                >
                  {/* Icon */}
                  <div
                    className={`p-4 ${colors.bg} rounded-2xl mb-4 group-hover:scale-110 transition-transform duration-300`}
                  >
                    <stat.icon className={`w-8 h-8 ${colors.text}`} />
                  </div>

                  {/* Value */}
                  <div
                    className={`text-4xl md:text-5xl font-bold ${colors.text} mb-2 font-secondary`}
                  >
                    <AnimatedCounter
                      end={stat.value}
                      prefix={stat.prefix}
                      suffix={stat.suffix}
                    />
                  </div>

                  {/* Label */}
                  <p className="text-slate-400 text-sm font-medium">
                    {stat.label}
                  </p>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Bottom CTA or Additional Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="text-center mt-12"
        >
          <p className="text-slate-500 text-sm">
            All transactions are secured with zero-knowledge proofs • Real-time
            stats updated every 24 hours
          </p>
        </motion.div>
      </div>
    </section>
  );
}
