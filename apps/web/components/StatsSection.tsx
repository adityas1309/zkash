"use client";

import { motion } from "framer-motion";
import { Users, ArrowRightLeft, Activity, ShieldCheck } from "lucide-react";
import { Card } from "./ui/Card";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type StatsCard = {
  icon: typeof Users;
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  color: "indigo" | "purple" | "blue" | "violet";
};

function AnimatedCounter({
  end,
  duration = 1.5,
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

  return (
    <span>
      {prefix}
      {count.toLocaleString()}
      {suffix}
    </span>
  );
}

export function StatsSection() {
  const [stats, setStats] = useState<StatsCard[]>([
    {
      icon: Users,
      label: "Active Users (24h)",
      value: 0,
      color: "indigo",
    },
    {
      icon: ArrowRightLeft,
      label: "Tracked Swaps",
      value: 0,
      color: "purple",
    },
    {
      icon: Activity,
      label: "Indexed Commitments",
      value: 0,
      color: "blue",
    },
    {
      icon: ShieldCheck,
      label: "Healthy Pools",
      value: 0,
      color: "violet",
    },
  ]);

  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      try {
        const res = await fetch(`${API_URL}/stats`, { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        if (cancelled) return;

        const healthyPools = Array.isArray(data?.indexer?.pools)
          ? data.indexer.pools.filter(
              (pool: { status?: string }) => pool.status === "healthy",
            ).length
          : 0;

        setStats([
          {
            icon: Users,
            label: "Active Users (24h)",
            value: Number(data?.users?.active24h ?? 0),
            color: "indigo",
          },
          {
            icon: ArrowRightLeft,
            label: "Tracked Swaps",
            value: Number(data?.flows?.swaps ?? 0),
            color: "purple",
          },
          {
            icon: Activity,
            label: "Indexed Commitments",
            value: Number(data?.indexer?.commitments ?? 0),
            color: "blue",
          },
          {
            icon: ShieldCheck,
            label: "Healthy Pools",
            value: healthyPools,
            color: "violet",
          },
        ]);
      } catch (error) {
        console.error("Failed to load operational stats", error);
      }
    };

    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="relative w-full overflow-hidden bg-slate-950 py-24">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute right-[-10%] top-[-20%] h-[50%] w-[50%] rounded-full bg-purple-500/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/10 blur-[120px]" />
      </div>

      <div className="absolute left-0 top-0 z-[5] h-32 w-full bg-gradient-to-b from-slate-950 to-transparent pointer-events-none" />

      <div className="container relative z-10 mx-auto max-w-6xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 font-secondary text-4xl font-bold tracking-tighter text-white md:text-5xl">
            Live <span className="text-indigo-500">Operational Trust Signals</span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-slate-400">
            ZKASH now surfaces real backend usage, indexer freshness, and tracked
            activity instead of relying on presentation-only numbers.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
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

            const colors = colorClasses[stat.color];

            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1, ease: "easeOut" }}
              >
                <Card
                  variant="glass"
                  className={`group flex flex-col items-center p-8 text-center transition-all duration-300 hover:scale-105 hover:bg-slate-800/50 ${colors.glow}`}
                >
                  <div
                    className={`mb-4 rounded-2xl p-4 transition-transform duration-300 group-hover:scale-110 ${colors.bg}`}
                  >
                    <stat.icon className={`h-8 w-8 ${colors.text}`} />
                  </div>

                  <div className={`mb-2 font-secondary text-4xl font-bold md:text-5xl ${colors.text}`}>
                    <AnimatedCounter
                      end={stat.value}
                      prefix={stat.prefix}
                      suffix={stat.suffix}
                    />
                  </div>

                  <p className="text-sm font-medium text-slate-400">{stat.label}</p>
                </Card>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="mt-12 text-center"
        >
          <p className="text-sm text-slate-500">
            Zero-knowledge transfers backed by live API stats, indexer health,
            and continuously refreshed activity counters
          </p>
        </motion.div>
      </div>
    </section>
  );
}
