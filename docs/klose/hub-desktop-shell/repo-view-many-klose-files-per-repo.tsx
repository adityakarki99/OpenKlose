// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Repo view — many Klose files per repo" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node 750a841a-cf67-4120-be17-7b5c85f6751f
 *
 * Inside one repo: every canvas is a file. Shows where each lives on disk, how far along it is, and whether the repo copy is up to date
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { FileText, Layers, MessageSquare, Plus, Check, GitBranch, ChevronRight, FolderDown, CircleDot } from 'lucide-react';

const files = [
  { name: 'Hub + desktop shell', path: 'docs/klose/hub-desktop-shell/', sketches: 9, built: 0, comments: 2, state: 'changed', last: '2m' },
  { name: 'Feedback tray', path: 'docs/klose/feedback-tray/', sketches: 5, built: 5, comments: 0, state: 'saved', last: '3d' },
  { name: 'Onboarding review', path: 'docs/klose/onboarding-review/', sketches: 6, built: 4, comments: 0, state: 'saved', last: '1w' },
  { name: 'Jev component ranking', path: null, sketches: 3, built: 0, comments: 1, state: 'canvas', last: 'yesterday' },
];

function State({ s }) {
  if (s === 'saved') return <span className="flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} />Saved</span>;
  if (s === 'changed') return <button className="flex items-center gap-1.5 rounded-md bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-300"><CircleDot size={11} />Changed · Save</button>;
  return <button className="flex items-center gap-1.5 rounded-md border border-dashed border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300"><FolderDown size={11} />Save to repo</button>;
}

export default function RepoFiles() {
  return (
    <div className="min-h-full bg-[#030712] px-7 py-6 font-sans text-slate-50 antialiased">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-500">Repos<ChevronRight size={12} /><span className="font-medium text-slate-300">OpenKlose</span><span className="ml-1 flex items-center gap-1 text-[11px]"><GitBranch size={10} />main</span></div>
      <div className="mt-1 flex items-end justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Klose files</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">One file per canvas. Save one to the repo to keep it as a planning doc.</p>
        </div>
        <button className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-[13px] font-semibold text-white"><Plus size={14} />New file</button>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_64px_72px_56px_132px_72px] gap-x-4 px-4 pb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">
        <span>File</span><span className="text-right">Sketches</span><span className="text-right">Built</span><span className="text-right">Notes</span><span>In repo</span><span className="text-right">Edited</span>
      </div>
      <div className="space-y-1.5">
        {files.map(f => (
          <div key={f.name} className="grid grid-cols-[1fr_64px_72px_56px_132px_72px] items-center gap-x-4 rounded-xl border border-white/[0.08] bg-[#0f172a] px-4 py-2.5 hover:border-white/[0.14]">
            <div className="flex min-w-0 items-center gap-3">
              <FileText size={16} className={f.state === 'canvas' ? 'text-slate-600' : 'text-blue-300'} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold">{f.name}</div>
                <div className="truncate font-mono text-[11px] text-slate-500">{f.path || 'not in the repo yet'}</div>
              </div>
            </div>
            <span className="flex items-center justify-end gap-1 text-[12px] tabular-nums text-slate-400"><Layers size={12} className="text-slate-600" />{f.sketches}</span>
            <span className="flex items-center justify-end gap-2"><span className="h-1 w-8 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full rounded-full bg-emerald-400" style={{ width: `${(f.built / f.sketches) * 100}%` }} /></span><span className="text-[11px] tabular-nums text-slate-500">{f.built}/{f.sketches}</span></span>
            <span className="flex justify-end">{f.comments > 0 ? <span className="flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-300"><MessageSquare size={11} />{f.comments}</span> : <span className="text-[12px] text-slate-600">—</span>}</span>
            <span><State s={f.state} /></span>
            <span className="text-right text-[12px] tabular-nums text-slate-500">{f.last}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-slate-400">Saving writes <code className="font-mono text-slate-200">README.md</code> (notes, status, feedback) and one <code className="font-mono text-slate-200">.tsx</code> per sketch into the file's folder. The canvas itself stays in <code className="font-mono text-slate-200">.klose/projects/</code>.</div>
    </div>
  );
}
