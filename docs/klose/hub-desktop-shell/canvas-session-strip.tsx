// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Canvas session strip" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node cbb2a36a-2dd2-4a67-907e-f16a58c7df47
 *
 * Thin strip above the canvas that reflects the live Claude session in this repo — what it's doing, which sketch it last touched, feedback it hasn't picked up yet
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { MessageSquare, Copy, Layers, Terminal } from 'lucide-react';

function Strip({ state }) {
  if (state === 'none') return (
    <div className="flex items-center gap-2 border-b border-white/[0.08] bg-[#09090b] px-3.5 py-1.5 text-[12px] text-slate-500"><Terminal size={12} />No agent here — run <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-slate-300">/klose</code> in Claude Code to start.</div>
  );
  const working = state === 'working';
  return (
    <div className={`flex items-center gap-2.5 border-b px-3.5 py-1.5 text-[12px] ${working ? 'border-blue-500/30 bg-blue-500/[0.08]' : 'border-white/[0.08] bg-[#09090b]'}`}>
      <span className="relative flex h-1.5 w-1.5">{working && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-70" />}<span className={`relative h-1.5 w-1.5 rounded-full ${working ? 'bg-blue-500' : 'bg-emerald-400'}`} /></span>
      <span className="font-semibold text-slate-100">Claude</span>
      <span className="text-slate-500">Start local · main</span>
      <span className="h-3 w-px bg-white/10" />
      {working
        ? <span className="text-blue-200">Writing <code className="font-mono text-[11px] text-blue-100">src/components/PricingCard.tsx</code></span>
        : <span className="text-slate-400">Idle 4m</span>}
      <span className="flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-slate-300"><Layers size={10} />Pricing card</span>
      <span className="flex-1" />
      {!working && <button className="flex items-center gap-1.5 rounded-md bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300"><MessageSquare size={11} />2 waiting<Copy size={10} className="opacity-60" /></button>}
    </div>
  );
}

const Frame = ({ label, state }) => (
  <div>
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</div>
    <div className="overflow-hidden rounded-lg border border-white/[0.08]">
      <Strip state={state} />
      <div className="relative h-16 bg-[radial-gradient(circle,rgba(148,163,184,0.18)_1px,transparent_1px)] [background-size:22px_22px]">
        <div className="absolute left-4 top-3 flex h-20 w-40 flex-col rounded-md border border-white/[0.1] bg-[#0f172a]"><div className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Pricing card</div><div className="mx-2 h-6 rounded bg-white/[0.04]" /></div>
      </div>
    </div>
  </div>
);

export default function SessionStrip() {
  return (
    <div className="min-h-full space-y-5 bg-[#030712] p-5 font-sans text-slate-50 antialiased">
      <Frame label="Agent working" state="working" />
      <Frame label="Agent idle · feedback waiting" state="idle" />
      <Frame label="No agent in this repo" state="none" />
    </div>
  );
}
