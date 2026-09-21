import React from 'react';

interface PropDef {
  type?: string;
  description?: string;
  default?: string;
  [key: string]: unknown;
}

interface PropTableProps {
  props: Record<string, PropDef>;
}

function getDisplayValue(val: unknown): string {
  if (val === undefined || val === null) return '—';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export const PropTable: React.FC<PropTableProps> = ({ props }) => {
  const entries = Object.entries(props || {});

  if (entries.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-app-border bg-app-surface-soft/60">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-app-border">
            <th className="px-4 py-3 font-medium text-app-secondary">Prop</th>
            <th className="px-4 py-3 font-medium text-app-secondary">Type</th>
            <th className="px-4 py-3 font-medium text-app-secondary">Description</th>
            <th className="px-4 py-3 font-medium text-app-secondary">Default</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, def]) => (
            <tr key={name} className="border-b border-app-border/70 last:border-0">
              <td className="px-4 py-2.5 font-mono text-xs text-indigo-300">{name}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-app-muted">{getDisplayValue(def.type)}</td>
              <td className="px-4 py-2.5 text-app-muted">{getDisplayValue(def.description)}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-app-subtle">{getDisplayValue(def.default)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
