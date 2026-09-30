// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Hub home — every repo, one canvas" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node f9a2df9e-286e-4e21-a184-d0789df5bea7
 *
 * Machine-wide landing view: repos discovered from ~/.claude/sessions, live agents pinned on top
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { MessageSquare, GitBranch, Layers, Search } from 'lucide-react';

const repos = [
  { name: 'OpenKlose', path: '~/Documents/OpenKlose', branch: 'main', agent: 'working', session: 'Start local', last: 'now', sketches: 7, comments: 2, setup: true },
  { name: 'CUEHost', path: '~/Documents/ChatGPT/CUEHost', branch: 'feat/billing', agent: 'idle', session: 'Pricing page', last: '4m', sketches: 3, comments: 0, setup: true },
  { name: 'SuperUI', path: '~/Documents/Harness-1/SuperUI', branch: 'main', agent: 'idle', session: 'Onboarding review', last: '12m', sketches: 11, comments: 5, setup: true },
  { name: 'mikeRoss', path: '~/Desktop/New Build 26/mikeRoss', branch: 'dev', agent: null, last: '2h', sketches: 0, comments: 0, setup: false },
  { name: 'Cleanmymac', path: '~/Documents/Cleanmymac', branch: 'main', agent: null, last: 'yesterday', sketches: 2, comments: 0, setup: true },
];

const Dot = ({ s }) => s === 'working'
  ? <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-blue-500" /></span>
  : <span className={`h-2 w-2 rounded-full ${s === 'idle' ? 'bg-emerald-400' : 'border border-slate-600'}`} />;

const Label = ({ children }) => <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{children}</div>;

function Row({ r }) {
  const status = r.agent === 'working' ? `Working · ${r.session}` : r.agent === 'idle' ? `Idle · ${r.session}` : 'No agent';
  return (
    <div className={`group grid grid-cols-[12px_1fr_56px_56px_64px_72px] items-center gap-x-4 rounded-xl border px-4 py-2.5 ${r.agent === 'working' ? 'border-blue-500/30 bg-blue-500/[0.06]' : 'border-white/[0.08] bg-[#0f172a] hover:border-white/[0.14]'}`}>
      <Dot s={r.agent} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold text-slate-50">{r.name}</span>
          <span className="flex items-center gap-1 text-[11px] text-slate-500"><GitBranch size={10} />{r.branch}</span>
        </div>
        <div className={`truncate text-[12px] ${r.agent ? 'text-slate-400' : 'text-slate-600'}`}>{status}<span className="text-slate-600"> · {r.path}</span></div>
      </div>
      <span className="flex items-center justify-end gap-1 text-[12px] tabular-nums text-slate-400"><Layers size={12} className="text-slate-600" />{r.sketches}</span>
      <span className="flex justify-end">{r.comments > 0
        ? <span className="flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-300"><MessageSquare size={11} />{r.comments}</span>
        : <span className="flex items-center gap-1 text-[12px] text-slate-600"><MessageSquare size={12} />0</span>}</span>
      <span className="text-right text-[12px] tabular-nums text-slate-500">{r.last}</span>
      <span className="flex justify-end">{r.setup
        ? <button className="rounded-lg bg-white/[0.06] px-3 py-1 text-[12px] font-medium text-slate-200 opacity-0 transition group-hover:opacity-100">Open</button>
        : <button className="rounded-lg border border-dashed border-slate-600 px-3 py-1 text-[12px] font-medium text-slate-400">Enable</button>}</span>
    </div>
  );
}

export default function HubHome() {
  const live = repos.filter(r => r.agent), rest = repos.filter(r => !r.agent);
  return (
    <div className="min-h-full bg-[#030712] px-7 py-6 font-sans text-slate-50 antialiased">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Klose hub · localhost:5171</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Repos on this Mac</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Found from Claude Code sessions. Nothing to install per repo.</p>
        </div>
        <div className="flex h-9 w-48 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 text-[13px] text-slate-500"><Search size={14} />Filter<span className="ml-auto rounded border border-white/10 px-1 text-[10px]">⌘K</span></div>
      </div>
      <Label>Live agents · {live.length}</Label>
      <div className="mb-6 space-y-1.5">{live.map(r => <Row key={r.name} r={r} />)}</div>
      <Label>Recent · {rest.length}</Label>
      <div className="space-y-1.5">{rest.map(r => <Row key={r.name} r={r} />)}</div>
    </div>
  );
}
