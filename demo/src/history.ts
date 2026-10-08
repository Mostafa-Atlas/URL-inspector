export interface HistoryEntry {
  url: string;
  method: string;
  time: number;
  status: number;
  statusText: string;
  ok: boolean;
  contentType: string | null;
  server: string | null;
  sizeBytes: number;
  redirectCount: number;
  pageTitle: string | null;
  responseTimeMs: number;
}

const KEY = 'http-inspector-history';
const MAX_ENTRIES = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// Only the summary is stored. Custom headers and bodies are never
// written to localStorage since they may contain secrets.
export function saveHistory(entry: HistoryEntry): HistoryEntry[] {
  const entries = [entry, ...loadHistory()].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // storage full or unavailable, history is best effort
  }
  return entries;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function findPrevious(
  entries: HistoryEntry[],
  url: string,
  method: string,
  excludeTime: number
): HistoryEntry | null {
  return entries.find((e) => e.url === url && e.method === method && e.time !== excludeTime) || null;
}
