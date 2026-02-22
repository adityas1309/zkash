'use client';

import { useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AuthGooglePage() {
  useEffect(() => {
    window.location.href = `${API_URL}/auth/google`;
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-slate-400">Redirecting to Google...</p>
    </div>
  );
}
