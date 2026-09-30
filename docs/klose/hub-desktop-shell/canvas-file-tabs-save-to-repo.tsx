// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Canvas file tabs + save to repo" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node 0187743a-6e2c-441e-8850-9da0d829b7ea
 *
 * On the canvas: the repo's open Klose files as tabs, with the save state and the folder it saves to always visible.
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { FileText, Plus, X, FolderDown, Check, MessageSquare } from 'lucide-react';

const tabs = [
  { name: 'Hub + desktop shell', active: true, dirty: true, comments: 2 },
  { name: 'Feedback tray' },
  { name: 'Jev component ranking', dirty: true, comments: 1 },
];

function Bar({ saved }) {
  return (
    <div className="flex items-stretch whitespace-nowrap border-b border-white/[0.08] bg-[#09090b] text-[12px]">
      {tabs.map(t => (
        <div key={t.name} className={`flex min-w-0 shrink items-center gap-2 border-r border-white/[0.08] px-3 py-2 ${t.active ? 'bg-[#030712] text-slate-100' : 'text-slate-500'}`}>
          <FileText size={12} className={t.active ? 'text-blue-300' : 'text-slate-600'} />
          <span className={`truncate ${t.active ? 'font-medium' : ''}`}>{t.name}</span>
          {t.comments > 0 && <span className="flex items-center gap-0.5 rounded bg-amber-400/15 px-1 text-[10px] font-semibold text-amber-300"><MessageSquare size={9} />{t.comments}</span>}
          {t.dirty && !(saved && t.active) ? <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> : <X size={11} className="text-slate-600" />}
        </div>
      ))}
      <div className="flex items-center px-2.5 text-slate-500"><Plus size={13} /></div>
      <div className="min-w-2 flex-1" />
      <div className="flex shrink-0 items-center gap-2.5 px-3">
        <span className="font-mono text-[11px] text-slate-500">docs/klose/hub-desktop-shell/</span>
        {saved
          ? <span className="flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} />Saved · 10 files</span>
          : <button className="flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1 text-[11px] font-semibold text-white"><FolderDown size={11} />Save to repo<span className="rounded bg-white/20 px-1 text-[9px]">⌘S</span></button>}
      </div>
    </div>
  );
}

const Frame = ({ label, saved }) => (
  <div>
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</div>
    <div className="overflow-hidden rounded-lg border border-white/[0.08]">
      <Bar saved={saved} />
      <div className="h-14 bg-[radial-gradient(circle,rgba(148,163,184,0.18)_1px,transparent_1px)] [background-size:22px_22px]" />
    </div>
  </div>
);

export default function FileTabs() {
  return (
    <div className="min-h-full w-full space-y-5 bg-[#030712] p-5 font-sans text-slate-50 antialiased">
      <Frame label="Changed since last save" saved={false} />
      <Frame label="Just saved" saved={true} />
    </div>
  );
}
