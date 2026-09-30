// @ts-nocheck
/* eslint-disable */
/*
 * Klose sketch — "Interaction — /klose in any repo" (sketch)
 * Project: Hub + desktop shell · project ebd92035-49a3-48d8-8cd5-700760d4f168 · node bf20250b-a7ff-473e-9a7b-1617d7058810
 *
 * The end-to-end loop once the hub exists: agent, hub, canvas, tray. What changes vs today is highlighted
 *
 * This is the canvas preview: a self-contained component (react, lucide-react
 * and recharts only, Tailwind classes) that shows the intended look. It is a
 * reference for the real build, not a drop-in file. Notes and feedback: README.md.
 */

import { User, Bot, Server } from 'lucide-react';

const lanes = [
  { key: 'you', icon: User, label: 'You' },
  { key: 'agent', icon: Bot, label: 'Agent · /klose' },
  { key: 'hub', icon: Server, label: 'Hub · canvas · tray' },
];
const steps = [
  { lane: 'you', text: 'Type /klose in repo B' },
  { lane: 'agent', text: 'status --hub → B already known. No init, no serve.', changed: true },
  { lane: 'hub', text: 'Registers B lazily; pushes to switcher + tray (SSE).', changed: true },
  { lane: 'agent', text: 'add-node → canvas ?root=B renders it live' },
  { lane: 'you', text: 'Pin a comment → tray dot turns amber', changed: true },
  { lane: 'agent', text: 'Copy feedback → update or build; clear comments' },
];

export default function InteractionFlow() {
  return (
    <div className="min-h-full bg-[#030712] p-5 font-sans text-slate-50 antialiased">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold">/klose in any repo — one loop</div>
        <div className="flex items-center gap-4 text-[11px] text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-blue-500" />new with the hub</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm border border-slate-600" />same as today</span></div>
      </div>
      <div className="grid grid-cols-[130px_repeat(6,1fr)] gap-x-2 gap-y-2">
        <div />
        {steps.map((_, i) => <div key={i} className="text-center text-[10px] font-medium tracking-[0.14em] text-slate-600">{i + 1}</div>)}
        {lanes.map(({ key, icon: Icon, label }) => (
          [<div key={key} className="flex items-center gap-2 border-r border-white/[0.08] pr-2 text-[11px] font-medium text-slate-400"><Icon size={13} className="text-slate-500" />{label}</div>,
           ...steps.map((s, i) => (
            <div key={key + i} className="flex min-h-[64px] items-stretch">
              {s.lane === key
                ? <div className={`relative w-full rounded-lg border px-2.5 pb-2 pt-3 text-[11px] leading-snug ${s.changed ? 'border-blue-500/40 bg-blue-500/[0.1] text-blue-50' : 'border-white/[0.1] bg-[#0f172a] text-slate-200'}`}>
                    <span className={`absolute -top-2 left-2 rounded-full px-1.5 text-[9px] font-bold ${s.changed ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-200'}`}>{i + 1}</span>{s.text}
                  </div>
                : <div className="w-full rounded-lg border border-dashed border-white/[0.04]" />}
            </div>
          ))]
        ))}
      </div>
      <div className="mt-4 text-[11px] text-slate-500">Open question: should step 3 auto-focus the canvas on repo B (URL push over SSE), or only surface it in the switcher?</div>
    </div>
  );
}
