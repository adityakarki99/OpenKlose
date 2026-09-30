// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Architecture — how the hub knows about repos" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node a87b796d-2a10-479c-970e-82b4a6330815
 *
 * Data flow: Claude Code's own on-disk session state → discovery → one hub server → canvas / tray. Sketches stay in each repo's .klose/
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { ArrowRight, ArrowDown, FileJson, Radar, Server, MonitorSmartphone, Folder, Terminal, Lock } from 'lucide-react';

const Box = ({ icon: Icon, title, sub, tone, children }) => (
  <div className={`flex h-full flex-col rounded-xl border p-3 ${tone === 'blue' ? 'border-blue-500/40 bg-blue-500/[0.08]' : tone === 'amber' ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-white/[0.08] bg-[#0f172a]'}`}>
    <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-50"><Icon size={13} className={tone === 'blue' ? 'text-blue-300' : tone === 'amber' ? 'text-amber-300' : 'text-slate-500'} />{title}</div>
    <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
    <div className="mt-2.5 space-y-1">{children}</div>
  </div>
);
const Mono = ({ children }) => <code className="block truncate rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{children}</code>;
const Li = ({ children }) => <div className="text-[11px] leading-snug text-slate-300">· {children}</div>;
const Right = () => <div className="flex items-center"><ArrowRight size={16} className="text-slate-600" /></div>;
const Down = () => <div className="flex justify-center"><ArrowDown size={16} className="text-slate-600" /></div>;
const C = ({ children }) => <code className="font-mono text-[11px] text-slate-200">{children}</code>;

export default function Architecture() {
  return (
    <div className="min-h-full bg-[#030712] p-5 font-sans text-slate-50 antialiased">
      <div className="grid grid-cols-[1fr_16px_1fr_16px_1fr] grid-rows-[auto_20px_auto] gap-x-2.5 gap-y-1">
        <Box icon={Terminal} title="Claude Code writes" sub="already happens · read only"><Mono>~/.claude/sessions/&lt;pid&gt;.json</Mono><Mono>~/.claude/projects/&lt;cwd&gt;/*.jsonl</Mono><div className="pt-1 text-[10px] text-slate-500">pid · cwd · status · branch · name</div></Box>
        <Right />
        <Box icon={Radar} title="Discovery" sub="server/sessions.js"><Li>pid still alive?</Li><Li>cwd → resolveRoot()</Li><Li>dedupe per root</Li><Li>fs watch · poll 5s / 15s idle</Li></Box>
        <Right />
        <Box icon={Server} title="Hub server" sub="one process · :5171" tone="blue"><Mono>GET /api/repos</Mono><Mono>/api/repos/:id/projects…</Mono><Mono>GET /api/events  (SSE)</Mono><div className="pt-1 text-[10px] text-slate-500">today's store / scanner / theme, keyed by root</div></Box>
        <div /><div /><Down /><div /><Down />
        <Box icon={Folder} title="Per-repo state" sub="unchanged · versionable" tone="amber"><Mono>&lt;repo&gt;/.klose/projects/*.json</Mono><div className="pt-1 text-[10px] text-slate-500">created lazily on first sketch</div></Box>
        <div />
        <Box icon={FileJson} title="Hub state" sub="~/.klose/"><Mono>server.json</Mono><Mono>repos.json  (index · last seen)</Mono><Mono>~/.claude/skills/klose/</Mono></Box>
        <div />
        <Box icon={MonitorSmartphone} title="Surfaces" sub="same web/dist for both"><Li>Canvas · ?root=…</Li><Li>Phase 2 · Tauri tray + popover</Li><Li>/klose skill → status --hub</Li></Box>
      </div>
      <p className="mt-3 rounded-lg border border-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-slate-400"><Lock size={11} className="mr-1.5 inline text-slate-500" />Read-only over <C>~/.claude</C>. Writes only <C>~/.klose/</C>, plus a repo's <C>.klose/</C> when you sketch there. No hooks into the agent, no daemon inside repos.</p>
    </div>
  );
}
