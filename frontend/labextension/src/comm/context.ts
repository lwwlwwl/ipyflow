import { ISessionContext } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { INotebookTracker, Notebook } from '@jupyterlab/notebook';
import { JSONValue } from '@lumino/coreutils';

import { IpyflowSessionStore } from '../state/SessionStore';

/**
 * Mutable per-connection context shared by the comm lifecycle, the notebook
 * event handlers, the message dispatcher, and the schedule handler. Bundling
 * the closure state that `connectToComm` used to capture lets those concerns
 * live in separate modules while still sharing the same `disconnected` flag,
 * deferred establish payload, etc.
 */
export interface IConnectionContext {
  store: IpyflowSessionStore;
  session: ISessionContext;
  notebooks: INotebookTracker;
  notebook: Notebook;
  docManager: IDocumentManager;
  /** Set true by the disconnect handler; read by every handler to bail out. */
  disconnected: boolean;
  /** Payload buffered while the comm is re-created, replayed on establish. */
  onEstablishPayload: JSONValue | null;
  /** ipyflow metadata read off the notebook model at connect time. */
  ipyflowMetadata: any;
  /** Send that transparently re-creates a disposed comm. */
  safeSend: (data: JSONValue) => void;
}
