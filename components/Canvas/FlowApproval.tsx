import React from 'react';
import { Check, MessageSquareWarning } from 'lucide-react';
import { ComponentNode } from '../../types';

/** "2 · error": where a flow frame sits (step) and which state of that step it shows. */
export const FlowChip: React.FC<{ node: ComponentNode }> = ({ node }) => {
  if (!node.step) return null;
  const state = node.state || 'default';
  return (
    <span
      className="flex-shrink-0 truncate rounded-md bg-sky-400/10 px-1.5 py-px text-[10.5px] font-medium text-sky-300"
      style={{ maxWidth: 140 }}
      title={`Step ${node.step} of the flow, ${state} state`}
    >
      {node.step} · {state}
    </span>
  );
};

interface FlowApprovalProps {
  node: ComponentNode;
  onUpdate: (id: string, updates: Partial<ComponentNode>) => void;
}

/**
 * The user's verdict on a flow frame: approve it, or ask for changes. Pressing
 * the active one again clears it. The agent reads it with `klose flow status`
 * and builds only approved frames; editing the frame's code clears it.
 */
export const FlowApproval: React.FC<FlowApprovalProps> = ({ node, onUpdate }) => {
  if (!node.step) return null;
  const current = node.approval?.status ?? null;
  const set = (status: 'approved' | 'changes') =>
    onUpdate(node.id, { approval: current === status ? undefined : { status, at: Date.now() } });
  const base = 'flex items-center gap-1 px-1.5 py-px';
  return (
    <div role="group" aria-label="Approve this frame or ask for changes" className="flex flex-shrink-0 overflow-hidden rounded-md border border-app-border text-[10.5px] font-medium">
      <button
        type="button"
        aria-pressed={current === 'approved'}
        title={current === 'approved' ? 'Approved. Click to take the approval back.' : 'Approve this frame: the agent may build it'}
        onClick={(e) => {
          e.stopPropagation();
          set('approved');
        }}
        className={`${base} ${current === 'approved' ? 'bg-emerald-400/20 text-emerald-300' : 'text-app-secondary hover:text-app-primary'}`}
      >
        <Check size={11} aria-hidden="true" />
        {current === 'approved' ? 'Approved' : 'Approve'}
      </button>
      <button
        type="button"
        aria-pressed={current === 'changes'}
        title={current === 'changes' ? 'Changes requested. Click to clear.' : 'Ask for changes: the agent will not build this frame'}
        onClick={(e) => {
          e.stopPropagation();
          set('changes');
        }}
        className={`${base} border-l border-app-border ${current === 'changes' ? 'bg-amber-400/20 text-amber-300' : 'text-app-secondary hover:text-app-primary'}`}
      >
        <MessageSquareWarning size={11} aria-hidden="true" />
        Changes
      </button>
    </div>
  );
};
