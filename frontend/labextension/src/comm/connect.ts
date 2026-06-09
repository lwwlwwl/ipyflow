import { ISessionContext } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { INotebookTracker, Notebook } from '@jupyterlab/notebook';
import { JSONValue } from '@lumino/coreutils';

import {
  clearDebugStore,
  getStore,
  initStore,
  resetStore,
  setDebugStore,
} from '../state/registry';
import { updateUI } from '../ui/decorations';
import { clearCellState } from '../ui/dom';
import { IConnectionContext } from './context';
import { createMessageHandler } from './messageHandlers';
import { createNotebookEventHandlers } from './notebookEvents';

/**
 * Establish the ipyflow comm for a notebook session: create the store, build
 * the connection context, wire the notebook event handlers and message
 * dispatcher, and open the comm. Returns a disconnect handler that tears the
 * connection down.
 */
export function connectToComm(
  session: ISessionContext,
  notebooks: INotebookTracker,
  notebook: Notebook,
  docManager: IDocumentManager,
): () => void {
  const store = initStore(session.session.id);
  store.activeCell = notebook.activeCell;
  store.comm = session.session.kernel.createComm('ipyflow', 'ipyflow');
  store.notebook = notebook;
  store.session = session;

  const ipyflowMetadata =
    (notebook.model as any).getMetadata?.('ipyflow') ?? ({} as any);

  const ctx: IConnectionContext = {
    store,
    session,
    notebooks,
    notebook,
    docManager,
    disconnected: false,
    onEstablishPayload: null,
    ipyflowMetadata,
    safeSend: null as any, // assigned just below
  };

  const commDisconnectHandler = () => {
    if (!store.comm.isDisposed) {
      store.comm.dispose();
    }
    ctx.disconnected = true;
    store.isIpyflowCommConnected = false;
    resetStore(session.session.id);
  };

  const safeSend = (data: JSONValue): void => {
    if (ctx.disconnected) {
      return;
    } else if (store.comm.isDisposed) {
      ctx.onEstablishPayload = data;
      const oldComm = store.comm;
      store.comm = session.session.kernel.createComm('ipyflow', 'ipyflow');
      store.comm.onMsg = oldComm.onMsg;
      store.comm.open({
        interface: 'jupyterlab',
        cell_metadata_by_id: store.gatherCellMetadataAndContent(),
        cell_parents: ctx.ipyflowMetadata?.cell_parents ?? {},
        cell_children: ctx.ipyflowMetadata?.cell_children ?? {},
      });
    } else {
      store.comm.send(data);
    }
  };
  ctx.safeSend = safeSend;
  store.safeSend = safeSend;

  const handlers = createNotebookEventHandlers(ctx);

  // Wire the listeners that must be live before `establish`.
  for (const cell of notebook.widgets) {
    cell.model.stateChanged.connect(handlers.onExecution);
  }
  notebook.model.cells.changed.connect(handlers.onCellsAdded);
  notebooks.selectionChanged.connect(handlers.onSelectionChanged);

  // Re-render decorations whenever the store signals a change.
  store.changed.connect(() => updateUI(store, notebooks));

  store.comm.onMsg = createMessageHandler(ctx, handlers);

  store.comm.open({
    interface: 'jupyterlab',
    cell_metadata_by_id: store.gatherCellMetadataAndContent(),
    cell_parents: ctx.ipyflowMetadata?.cell_parents ?? {},
    cell_children: ctx.ipyflowMetadata?.cell_children ?? {},
  });

  return commDisconnectHandler;
}

/**
 * Activate-time wiring: track the foreground notebook for the debug hook and
 * register the `ipyflow-client` comm target (plus kernel-restart handling) for
 * each notebook as it is added.
 */
export function setupComm(
  notebooks: INotebookTracker,
  docManager: IDocumentManager,
): void {
  notebooks.currentChanged.connect((_, nbPanel) => {
    const session = nbPanel.sessionContext;
    if (session?.session == null) {
      clearDebugStore();
      return;
    }
    const store = getStore(session.session.id);
    setDebugStore(store ?? null);
    if (store?.isIpyflowCommConnected ?? false) {
      store.requestComputeExecSchedule();
    }
  });

  notebooks.widgetAdded.connect((_sender, nbPanel) => {
    const session = nbPanel.sessionContext;
    let commDisconnectHandler = () => resetStore(session.session.id);

    const registerCommTarget = () => {
      session.session.kernel.registerCommTarget(
        'ipyflow-client',
        (comm, _open_msg) => {
          comm.onMsg = (msg) => {
            const payload: any = msg.content.data;
            if (!(payload.success ?? true)) {
              return;
            }
            if (payload.type === 'unestablish') {
              commDisconnectHandler();
            } else if (payload.type === 'establish') {
              commDisconnectHandler();
              commDisconnectHandler = connectToComm(
                session,
                notebooks,
                nbPanel.content,
                docManager,
              );
            }
          };
          commDisconnectHandler();
          commDisconnectHandler = connectToComm(
            session,
            notebooks,
            nbPanel.content,
            docManager,
          );
        },
      );
    };

    session.ready.then(() => {
      clearCellState(nbPanel.content);
      registerCommTarget();
      commDisconnectHandler();
      commDisconnectHandler = connectToComm(
        session,
        notebooks,
        nbPanel.content,
        docManager,
      );
      session.kernelChanged.connect((_, args) => {
        if (args.newValue == null) {
          return;
        }
        clearCellState(nbPanel.content);
        commDisconnectHandler();
        resetStore(session.session.id);
        commDisconnectHandler = () => resetStore(session.session.id);
        session.ready.then(() => {
          registerCommTarget();
          commDisconnectHandler = connectToComm(
            session,
            notebooks,
            nbPanel.content,
            docManager,
          );
        });
      });
    });
  });
}
