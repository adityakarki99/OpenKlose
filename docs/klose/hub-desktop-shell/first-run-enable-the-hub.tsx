// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "First run — enable the hub" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node 41a34a8f-c8a3-44c5-bff5-ffc0ee643cf8
 *
 * What you see the first time the hub starts: repos it already found, and the three decisions (global skill, start at login, discovery sources)
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { Check, FolderGit2, Sparkles, Power, Eye } from 'lucide-react';

const found = ['OpenKlose', 'CUEHost', 'SuperUI', 'Cleanmymac'];
const options = [
  { icon: Sparkles, title: 'Install the /klose skill globally', sub: '~/.claude/skills/klose — works in every repo, no klose init', on: true },
  { icon: Power, title: 'Start the hub at login', sub: 'Menubar icon; the canvas is always one click away', on: true },
  { icon: Eye, title: 'Also list recently-used repos', sub: 'From ~/.claude/projects transcripts, not only live sessions', on: false },
];

export default function Onboarding() {
  return (
    <div className="flex min-h-full items-center justify-center bg-[#030712] p-6 font-sans text-slate-50 antialiased">
      <div className="w-full max-w-[420px] rounded-2xl border border-white/[0.1] bg-[#0f172a] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-blue-300">One hub for every repo</div>
        <h2 className="mt-1.5 text-[20px] font-semibold leading-tight tracking-tight">Found 4 repos with Claude Code sessions</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-400">Read from <code className="rounded bg-white/[0.06] px-1 font-mono text-[12px] text-slate-300">~/.claude/sessions</code>. Nothing leaves this Mac, and nothing is written into a repo until you sketch in it.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{found.map(n => <span key={n} className="flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2 py-1 text-[12px] text-slate-300"><FolderGit2 size={12} className="text-slate-500" />{n}</span>)}</div>
        <div className="mt-5 space-y-1.5">
          {options.map(({ icon: Icon, title, sub, on }) => (
            <label key={title} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] p-3 hover:bg-white/[0.03]">
              <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-blue-500 bg-blue-500' : 'border-slate-600'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
              <span className="flex-1"><span className="flex items-center gap-2 text-[13px] font-medium text-slate-100"><Icon size={13} className="text-slate-500" />{title}</span><span className="mt-0.5 block text-[12px] text-slate-500">{sub}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button className="text-[13px] text-slate-500 hover:text-slate-300">Skip for now</button>
          <button className="rounded-lg bg-blue-500 px-4 py-2 text-[13px] font-semibold text-white">Start hub</button>
        </div>
      </div>
    </div>
  );
}
