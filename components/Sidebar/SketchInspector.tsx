import React, { useEffect, useState } from 'react';
import { X, Trash2, Copy, Check, Send } from 'lucide-react';
import { ComponentNode } from '../../types';

interface SketchInspectorProps {
  node: ComponentNode;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<ComponentNode>) => void;
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildAgentText(node: ComponentNode, projectId: string, projectName: string): string {
  const lines: string[] = [];
  lines.push(`Feedback on the "${node.name || 'Untitled sketch'}" sketch (project "${projectName}", id ${projectId}, node ${node.id}):`);
  lines.push('');
  const comments = node.comments || [];
  if (comments.length === 0) {
    lines.push('(no comments left yet)');
  } else {
    comments.forEach((c, i) => lines.push(`${i + 1}. ${c.text}`));
  }
  lines.push('');
  lines.push('Please address this feedback — use `npx klose project get <id>` to read the current sketch, and `npx klose project update-node` to update it.');
  return lines.join('\n');
}

export const SketchInspector: React.FC<SketchInspectorProps> = ({ node, projectId, projectName, onClose, onUpdate }) => {
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description);
  const [notes, setNotes] = useState(node.notes || '');
  const [newComment, setNewComment] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setName(node.name);
    setDescription(node.description);
    setNotes(node.notes || '');
    setNewComment('');
    setCopied(false);
  }, [node.id]);

  const comments = node.comments || [];

  const handleAddComment = () => {
    const text = newComment.trim();
    if (!text) return;
    const comment = { id: Math.random().toString(36).substring(7), text, createdAt: Date.now() };
    onUpdate(node.id, { comments: [...comments, comment] });
    setNewComment('');
  };

  const handleDeleteComment = (commentId: string) => {
    onUpdate(node.id, { comments: comments.filter((c) => c.id !== commentId) });
  };

  const handleCopyForAgent = async () => {
    const text = buildAgentText(node, projectId, projectName);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
    }
  };

  return (
    <div className="absolute right-6 top-6 z-30 flex max-h-[calc(100vh-3rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surfaceElevated shadow-2xl">
      <div className="flex items-center justify-between border-b border-app-border bg-app-surfaceSoft/60 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-widest text-app-muted">Sketch</span>
        <button onClick={onClose} className="rounded-lg p-1 text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary" aria-label="Close inspector">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onUpdate(node.id, { name })}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-primary outline-none focus:border-blue-500"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => onUpdate(node.id, { description })}
            placeholder="What is this component? What does it show?"
            className="h-24 w-full resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none focus:border-blue-500"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">Notes for the agent</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => onUpdate(node.id, { notes })}
            placeholder="States, interactions, data it needs, edge cases..."
            className="h-28 w-full resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none focus:border-blue-500"
          />
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-app-subtle">
              Comments{comments.length > 0 ? ` (${comments.length})` : ''}
            </span>
            <button
              onClick={handleCopyForAgent}
              disabled={comments.length === 0}
              className="flex items-center gap-1.5 rounded-md border border-app-border bg-app-surfaceSoft px-2 py-1 text-[11px] font-medium text-app-secondary transition-colors hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-40"
              title="Copy this feedback to paste into your coding agent"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy for agent'}
            </button>
          </div>

          {comments.length > 0 && (
            <div className="space-y-2">
              {comments.map((c) => (
                <div key={c.id} className="group flex items-start gap-2 rounded-lg border border-app-border bg-app-surface p-2.5">
                  <p className="flex-1 whitespace-pre-wrap text-xs leading-relaxed text-app-secondary">{c.text}</p>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <span className="text-[10px] text-app-subtle">{timeAgo(c.createdAt)}</span>
                    <button
                      onClick={() => handleDeleteComment(c.id)}
                      className="rounded p-0.5 text-app-subtle opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      aria-label="Delete comment"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAddComment();
                }
              }}
              placeholder="Leave feedback on this design..."
              className="h-16 flex-1 resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-secondary outline-none focus:border-blue-500"
            />
            <button
              onClick={handleAddComment}
              disabled={!newComment.trim()}
              className="flex-shrink-0 rounded-lg border border-app-border bg-app-surfaceSoft p-2.5 text-app-secondary transition-colors hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Add comment"
            >
              <Send size={14} />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-app-border bg-app-surfaceSoft p-3">
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-app-subtle">
            <span>Status</span>
            <span className={node.status === 'built' ? 'text-emerald-400' : 'text-amber-400'}>
              {node.status === 'built' ? 'Built' : 'Sketch'}
            </span>
          </div>
          {node.status === 'built' && node.builtFilePath ? (
            <p className="break-all text-[11px] text-app-secondary">{node.builtFilePath}</p>
          ) : (
            <p className="text-[11px] text-app-muted">
              Ask your coding agent (e.g. <code>/klose</code>) to build this sketch — it will mark it built once the real file exists.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SketchInspector;
