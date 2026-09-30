import React from 'react';
import { HubRepo } from '../../types';

/**
 * The agent's state in a repo, as one dot: pulsing blue while it works, green
 * when it's idle, a hollow ring when no agent is there.
 */
export const AgentDot: React.FC<{ agent: HubRepo['agent']; size?: 'sm' | 'md' }> = ({ agent, size = 'md' }) => {
  const box = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  if (agent === 'working') {
    return (
      <span className={`relative flex shrink-0 ${box}`} aria-label="Agent working">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
        <span className={`relative rounded-full bg-blue-500 ${box}`} />
      </span>
    );
  }
  if (agent === 'idle') return <span className={`shrink-0 rounded-full bg-emerald-400 ${box}`} aria-label="Agent idle" />;
  return <span className={`shrink-0 rounded-full border border-app-border-strong ${box}`} aria-label="No agent" />;
};

export default AgentDot;
