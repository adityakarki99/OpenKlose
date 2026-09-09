import { useState, useCallback } from 'react';

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function useHistory<T>(initialState: T) {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  const { past, present, future } = history;

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // Standard update: pushes current state to 'past' and sets new 'present'
  const setState = useCallback((newState: T | ((curr: T) => T)) => {
    setHistory((curr) => {
      const resolvedState = newState instanceof Function ? newState(curr.present) : newState;
      
      // Strict equality check to prevent unnecessary history entries
      if (resolvedState === curr.present) return curr;

      return {
        past: [...curr.past, curr.present],
        present: resolvedState,
        future: [],
      };
    });
  }, []);

  // Transient update: updates 'present' WITHOUT adding to history
  // Useful for continuous interactions like dragging
  const setTransient = useCallback((newState: T | ((curr: T) => T)) => {
    setHistory((curr) => {
      const resolvedState = newState instanceof Function ? newState(curr.present) : newState;
      return {
        ...curr,
        present: resolvedState,
      };
    });
  }, []);

  // Manual commit: Pushes a specific state (usually the state BEFORE a drag started) to history
  // effectively checkpointing that moment.
  const commitToHistory = useCallback((snapshot: T) => {
    setHistory((curr) => ({
      past: [...curr.past, snapshot],
      present: curr.present,
      future: [],
    }));
  }, []);

  const undo = useCallback(() => {
    setHistory((curr) => {
      if (curr.past.length === 0) return curr;

      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, curr.past.length - 1);

      return {
        past: newPast,
        present: previous,
        future: [curr.present, ...curr.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((curr) => {
      if (curr.future.length === 0) return curr;

      const next = curr.future[0];
      const newFuture = curr.future.slice(1);

      return {
        past: [...curr.past, curr.present],
        present: next,
        future: newFuture,
      };
    });
  }, []);

  return {
    state: present,
    setState,
    setTransient,
    commitToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    history
  };
}