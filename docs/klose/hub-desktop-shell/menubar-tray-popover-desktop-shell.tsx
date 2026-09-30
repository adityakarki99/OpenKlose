// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Menubar tray popover (desktop shell)" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node e3b1f72f-1d91-4a27-ad93-1963d9a73102
 *
 * Phase 2: the Tauri tray. 380pt popover anchored under the menubar item, antiburn-style — active repos, feedback waiting, one-click Open
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { MessageSquare, ExternalLink, Pin, Settings } from 'lucide-react';

const repos = [
  { name: 'OpenKlose', branch: 'main', state: 'working', doing: 'Writing PricingCard.tsx', comments: 2 },
  { name: 'SuperUI', branch: 'main', state: 'idle', doing: 'Idle · waiting on your feedback', comments: 5 },
  { name: 'CUEHost', branch: 'feat/billing', state: 'idle', doing: 'Idle', comments: 0 },
];

export default function TrayPopover() {
  return (
    <div className="min-h-full bg-[#1c1c1e] px-6 pb-5 pt-4 font-sans antialiased">
      <div className="mx-auto flex w-[380px] items-center justify-end gap-4 rounded-md bg-[#2c2c2e] px-3 py-1 text-[11px] text-slate-300">
        <span>Wed 21:14</span>
        <span className="relative flex h-5 w-5 items-center justify-center rounded-md bg-white/15"><span className="h-2.5 w-2.5 rounded-full bg-slate-50" /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-[#2c2c2e]" /></span>
      </div>
      <div className="mx-auto mt-1.5 w-[380px] overflow-hidden rounded-xl border border-white/10 bg-[#0f172a] text-slate-50 shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-3.5 py-2.5">
          <div className="flex items-center gap-2"><div className="h-4 w-4 rounded-full bg-slate-50" /><span className="text-[13px] font-bold tracking-tight">Klose</span><span className="text-[11px] text-slate-500">3 agents · 7 comments waiting</span></div>
          <div className="flex items-center gap-2 text-slate-500"><Pin size={13} /><Settings size={13} /></div>
        </div>
        {repos.map(r => (
          <div key={r.name} className="group flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/[0.03]">
            <span className={`h-1.5 w-1.5 rounded-full ${r.state === 'working' ? 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.9)]' : 'bg-emerald-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-[13px] font-semibold">{r.name}<span className="text-[11px] font-normal text-slate-500">{r.branch}</span></div>
              <div className="truncate text-[11px] text-slate-400">{r.doing}</div>
            </div>
            {r.comments > 0 && <span className="flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300"><MessageSquare size={11} />{r.comments}</span>}
            <ExternalLink size={13} className="text-slate-500 opacity-0 group-hover:opacity-100" />
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#09090b] px-3.5 py-2">
          <span className="text-[11px] text-slate-500">Watching ~/.claude/sessions</span>
          <button className="rounded-md bg-blue-500 px-3 py-1 text-[12px] font-semibold text-white">Open canvas</button>
        </div>
      </div>
      <div className="mx-auto mt-3 flex w-[380px] items-center justify-between text-[11px] text-slate-500">
        <span className="text-slate-600">Tray dot</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-slate-600" />no agents</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />agent working</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />feedback waiting</span>
      </div>
    </div>
  );
}
