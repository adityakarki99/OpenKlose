import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

export const SHORTCUT_GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'Canvas',
    items: [
      [['N'], 'New sketch'],
      [[MOD, 'Z'], 'Undo'],
      [[MOD, '⇧', 'Z'], 'Redo'],
      [['Drag'], 'Pan (on empty canvas)'],
      [['?'], 'Show shortcuts'],
    ],
  },
  {
    title: 'View',
    items: [
      [[MOD, 'scroll'], 'Zoom at the pointer (or pinch)'],
      [[MOD, '+'], 'Zoom in'],
      [[MOD, '−'], 'Zoom out'],
      [[MOD, '0'], 'Reset to 100%'],
      [['⇧', '1'], 'Fit all sketches'],
      [['⇧', '2'], 'Fit the selected sketch'],
    ],
  },
  {
    title: 'Selected sketch',
    items: [
      [['C'], 'Comment on an element'],
      [[MOD, 'D'], 'Duplicate'],
      [['←', '↑', '→', '↓'], 'Nudge (⇧ for 10× the grid)'],
      [['Delete'], 'Delete (Undo from the toast)'],
      [['Esc'], 'Deselect'],
    ],
  },
];

const Key: React.FC<{ k: string }> = ({ k }) => (
  <kbd className="min-w-[22px] rounded-md border border-app-border bg-app-surface px-1.5 py-0.5 text-center font-mono text-[11px] text-app-primary">{k}</kbd>
);

export const ShortcutsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-app-bg/70 p-4 backdrop-blur-sm" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-app-border bg-app-surface-elevated p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-base font-semibold text-app-primary">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-1 text-app-muted hover:text-app-primary" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-muted">{group.title}</h3>
              <ul className="grid gap-1.5">
                {group.items.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-4 text-[13px] text-app-secondary">
                    <span>{label}</span>
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {keys.map((k) => <Key key={k} k={k} />)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
