import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  message: string;
  tone?: 'default' | 'agent';
  action?: { label: string; onClick: () => void };
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  /** How long it stays before going away on its own. */
  duration?: number;
}

/**
 * One transient message at the bottom of the canvas, with an optional action
 * such as Undo. A new toast replaces the current one.
 */
export const Toast: React.FC<ToastProps> = ({ toast, onDismiss, duration = 6000 }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss, duration]);

  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex max-w-[min(520px,calc(100vw-32px))] items-center gap-3 rounded-xl border py-2 pl-4 pr-2 text-[13px] shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200 ${
        toast.tone === 'agent'
          ? 'border-violet-400/40 bg-app-surface-elevated text-app-primary'
          : 'border-app-border bg-app-surface-elevated text-app-primary'
      }`}
    >
      {toast.tone === 'agent' && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-violet-400" aria-hidden="true" />}
      <span className="min-w-0 flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
          className="flex-shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-semibold text-blue-300 hover:bg-blue-500/10"
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" onClick={onDismiss} className="flex-shrink-0 rounded-lg p-1 text-app-muted hover:text-app-primary" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
};
