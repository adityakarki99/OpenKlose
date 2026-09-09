import React from 'react';

interface SubElementsSectionProps {
  subElements: string[];
}

export const SubElementsSection: React.FC<SubElementsSectionProps> = ({ subElements }) => {
  if (!subElements || subElements.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase text-app-subtle">Structure</h4>
      <div className="flex flex-wrap gap-2">
        {subElements.map((el) => (
          <span
            key={el}
            className="rounded-md border border-app-border bg-app-surfaceSoft px-2.5 py-1 font-mono text-xs text-app-secondary"
          >
            {el}
          </span>
        ))}
      </div>
    </div>
  );
};
