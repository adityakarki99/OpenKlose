const WAL_PREFIX = 'project_wal_';

export function writeWAL(projectId: string, data: object): void {
  try {
    localStorage.setItem(
      `${WAL_PREFIX}${projectId}`,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch (e) {
    console.warn('localStorage WAL write failed:', e);
  }
}

export function readWAL(projectId: string): { data: Record<string, unknown>; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(`${WAL_PREFIX}${projectId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearWAL(projectId: string): void {
  try {
    localStorage.removeItem(`${WAL_PREFIX}${projectId}`);
  } catch {
    // ignore
  }
}
