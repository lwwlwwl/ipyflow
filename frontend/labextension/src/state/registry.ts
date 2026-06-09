import { IpyflowSessionStore } from './SessionStore';

// Registry of per-session stores, keyed by kernel session id. Replaces the bare
// module-level `ipyflowState` object that was previously mutated in place.
const stores = new Map<string, IpyflowSessionStore>();

/** The store for a session, or `undefined` if none is registered. */
export function getStore(sessionId: string): IpyflowSessionStore | undefined {
  return stores.get(sessionId);
}

/** Create (replacing any existing) store for a session and surface it for debugging. */
export function initStore(sessionId: string): IpyflowSessionStore {
  const store = new IpyflowSessionStore();
  stores.set(sessionId, store);
  setDebugStore(store);
  return store;
}

/** Forget a session's store (e.g. on disconnect or kernel restart). */
export function resetStore(sessionId: string): void {
  stores.delete(sessionId);
}

/**
 * Debug hook: `window.ipyflow` points at the active session's store so it can be
 * inspected from the browser console. Centralized here rather than scattered.
 */
export function setDebugStore(store: IpyflowSessionStore | null): void {
  (window as any).ipyflow = store;
}

export function clearDebugStore(): void {
  delete (window as any).ipyflow;
}
