'use client';

export default function ReputationBadge({ score }: { score: number }) {
  const level = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
  const color = level === 'high' ? 'text-green-400' : level === 'medium' ? 'text-yellow-400' : 'text-slate-400';
  return <span className={`text-sm ${color}`}>Rep: {score}</span>;
}
