"use client";

import { Hero } from "@/components/Hero";
import { PrivacySection } from "@/components/PrivacySection";

export default function Home() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <Hero />
      <PrivacySection />
    </main>
  );
}
