import { useState, useEffect, useRef, useCallback } from 'react';
import { saveProject } from '../services/projectService';
import { writeWAL, readWAL, clearWAL } from '../services/localCacheService';
import { ComponentNode, ProjectContext } from '../types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export interface PersistenceData {
  name: string;
  nodes: ComponentNode[];
  designSystemPrompt: string;
  projectContext: ProjectContext;
}

interface UsePersistenceOptions {
  projectId: string | null;
  data: PersistenceData;
  enabled: boolean;
}

export function usePersistence({ projectId, data, enabled }: UsePersistenceOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const lastSavedSnapshotRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const dataRef = useRef(data);
  dataRef.current = data;

  const currentSnapshot = enabled && projectId ? JSON.stringify(data) : '';
  const isDirty = currentSnapshot !== '' && currentSnapshot !== lastSavedSnapshotRef.current;

  const persistData = useCallback(async () => {
    if (!projectId || !isMountedRef.current) return;
    const currentData = dataRef.current;

    setSaveStatus('saving');
    writeWAL(projectId, currentData);

    try {
      await saveProject(projectId, {
        name: currentData.name,
        nodes: currentData.nodes,
        designSystemPrompt: currentData.designSystemPrompt,
        projectContext: currentData.projectContext,
      });
      if (!isMountedRef.current) return;

      lastSavedSnapshotRef.current = JSON.stringify(currentData);
      setLastSavedAt(Date.now());
      clearWAL(projectId);
      retryCountRef.current = 0;
      setSaveStatus('saved');

      if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
      savedFeedbackTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) setSaveStatus('idle');
      }, 2000);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('Save failed:', err);
      setSaveStatus(navigator.onLine ? 'error' : 'offline');

      if (retryCountRef.current < 5) {
        const delay = Math.min(2000 * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(persistData, delay);
      }
    }
  }, [projectId]);

  // Manual save — exposed for the save button
  const saveNow = useCallback(async () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryCountRef.current = 0;
    await persistData();
  }, [persistData]);

  // Debounced auto-save on data changes
  useEffect(() => {
    if (!enabled || !projectId || !isDirty) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      persistData();
    }, 2000);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [currentSnapshot, projectId, enabled, isDirty, persistData]);

  // beforeunload — prevent data loss on tab close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!projectId) return;
      // Recompute dirty inline — refs may be stale in event handlers
      const snap = JSON.stringify(dataRef.current);
      if (snap === lastSavedSnapshotRef.current) return;
      writeWAL(projectId, dataRef.current);
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [projectId]);

  // visibilitychange — save when tab goes hidden
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== 'hidden' || !projectId) return;
      const snap = JSON.stringify(dataRef.current);
      if (snap === lastSavedSnapshotRef.current) return;
      writeWAL(projectId, dataRef.current);
      persistData();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [projectId, persistData]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      if (!projectId) return;
      const snap = JSON.stringify(dataRef.current);
      if (snap !== lastSavedSnapshotRef.current) {
        retryCountRef.current = 0;
        persistData();
      }
    };
    const handleOffline = () => {
      if (isMountedRef.current) setSaveStatus('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [projectId, persistData]);

  // WAL recovery on mount / project change
  useEffect(() => {
    if (!projectId) return;
    const wal = readWAL(projectId);
    if (wal) {
      saveProject(projectId, wal.data as Parameters<typeof saveProject>[1])
        .then(() => clearWAL(projectId))
        .catch(() => { /* Will be retried by normal auto-save cycle */ });
    }
    lastSavedSnapshotRef.current = JSON.stringify(data);
  }, [projectId]);

  // Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
    };
  }, []);

  return { saveStatus, saveNow, lastSavedAt, isDirty };
}
