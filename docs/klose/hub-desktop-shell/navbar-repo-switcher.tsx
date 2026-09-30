// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Navbar repo switcher" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node 7e473db0-c87a-4909-a24f-0c5a9efc0cb0
 *
 * The current repo becomes a pill in the navbar; dropdown lists every discovered repo with agent status and feedback count
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { ChevronDown, FolderOpen, Blocks, Sun, GitBranch, MessageSquare, Check } from 'lucide-react';

const repos = [
  { name: 'OpenKlose', branch: 'main', state: 'working', comments: 2, current: true },
  { name: 'CUEHost', branch: 'feat/billing', state: 'idle', comments: 0 },
  { name: 'SuperUI', branch: 'main', state: 'idle', comments: 5 },
  { name: 'Cleanmymac', branch: 'main', state: null, comments: 0 },
];
const Dot = ({ s }) => <span className={`h-1.5 w-1.5 rounded-full ${s === 'working' ? 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.9)]' : s === 'idle' ? 'bg-emerald-400' : 'border border-slate-600'}`} />;
const Item = ({ r }) => (
  <div className={`mx-1.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] ${r.current ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}>
    <Dot s={r.state} />
    <span className={`flex-1 font-medium ${r.state ? 'text-slate-100' : 'text-slate-400'}`}>{r.name}<span className="ml-2 text-[11px] font-normal text-slate-500">{r.branch}</span></span>
    {r.comments > 0 && <span className="flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"><MessageSquare size={10} />{r.comments}</span>}
    {r.current && <Check size={13} className="text-blue-400" />}
  </div>
);
const Section = ({ children }) => <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{children}</div>;

export default function RepoSwitcher() {
  return (
    <div className="min-h-full bg-[#030712] font-sans text-slate-50 antialiased">
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#09090b] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2"><div className="h-6 w-6 rounded-full bg-slate-50 shadow-[0_0_16px_rgba(59,130,246,0.25)]" /><span className="text-[15px] font-bold tracking-tight">Klose</span></div>
          <span className="text-slate-700">/</span>
          <button className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-[13px]">
            <Dot s="working" /><span className="font-semibold">OpenKlose</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><GitBranch size={10} />main</span>
            <ChevronDown size={13} className="text-slate-500" />
          </button>
        </div>
        <nav className="flex items-center gap-0.5">
          <span className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-600/20 px-3 py-1.5 text-[13px] font-medium text-indigo-300"><FolderOpen size={14} />Projects</span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-slate-400"><Blocks size={14} />Components</span>
        </nav>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] text-slate-400"><Sun size={15} /></div>
      </div>
      <div className="relative h-[340px] bg-[radial-gradient(circle,rgba(148,163,184,0.18)_1px,transparent_1px)] [background-size:22px_22px]">
        <div className="absolute left-[104px] top-2 w-[300px] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0f172a] shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
          <div className="flex items-center border-b border-white/[0.08] px-3.5 py-2.5 text-[13px] text-slate-500">Switch repo…<span className="ml-auto rounded border border-white/10 px-1 text-[10px]">⌘K</span></div>
          <Section>Live agents</Section>
          {repos.filter(r => r.state).map(r => <Item key={r.name} r={r} />)}
          <Section>Recent</Section>
          {repos.filter(r => !r.state).map(r => <Item key={r.name} r={r} />)}
          <div className="mt-1.5 border-t border-white/[0.08] px-3.5 py-2 text-[11px] text-slate-500">4 repos · from ~/.claude/sessions</div>
        </div>
      </div>
    </div>
  );
}
