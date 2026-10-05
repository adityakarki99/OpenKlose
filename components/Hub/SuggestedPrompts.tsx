import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { SUGGESTED_PROMPTS } from '../../server/prompts.js';

/**
 * The three prompts people most often start with, each copied to the
 * clipboard with a click. The list itself lives in server/prompts.js so the
 * CLI prints the same ones after `init` and `setup`.
 */
export const SuggestedPrompts: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, prompt: string) => {
    navigator.clipboard?.writeText(prompt).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    });
  };
  return (
    <div className="space-y-1.5">
      {SUGGESTED_PROMPTS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => copy(p.id, p.prompt)}
          title={`Copy "${p.prompt}"`}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-app-border bg-app-surface-elevated px-4 py-2.5 text-left transition-colors hover:border-app-border-strong"
        >
          <span className="min-w-0">
            <span className="block text-xs font-medium text-app-muted">{p.title}</span>
            <span className="block break-words font-mono text-sm text-app-primary">{p.prompt}</span>
            {!compact && <span className="mt-0.5 block text-xs text-app-subtle">{p.hint}</span>}
          </span>
          {copied === p.id ? <Check size={14} className="shrink-0 text-emerald-400" /> : <Copy size={14} className="shrink-0 text-app-subtle" />}
        </button>
      ))}
    </div>
  );
};
