import { KernelMessage } from '@jupyterlab/services';

import { refreshNodeMapping } from '../ui/decorations';
import { IConnectionContext } from './context';
import { INotebookEventHandlers } from './notebookEvents';
import { handleComputeExecSchedule } from './schedule';

/**
 * Build the `comm.onMsg` dispatcher. On `establish` it wires up the
 * active-cell/content/execution listeners and flushes any buffered payload; on
 * `set_exec_mode` it records the mode; `compute_exec_schedule` is delegated to
 * the schedule handler.
 */
export function createMessageHandler(
  ctx: IConnectionContext,
  handlers: INotebookEventHandlers,
): (msg: KernelMessage.ICommMsgMsg) => void {
  const { store, notebook } = ctx;

  return (msg: KernelMessage.ICommMsgMsg) => {
    const payload: any = msg.content.data;
    if (ctx.disconnected || !(payload.success ?? true)) {
      return;
    }
    if (payload.type === 'establish') {
      notebook.scrollbar = true;
      store.isIpyflowCommConnected = true;
      refreshNodeMapping(store, notebook);
      notebook.activeCellChanged.connect(handlers.onActiveCellChange);
      notebook.activeCell.model.stateChanged.connect(handlers.onExecution);
      handlers.onActiveCellChange(notebook, notebook.activeCell);
      notebook.model.contentChanged.connect(handlers.onContentChanged);
      notebook.model.cells.changed.connect(handlers.onContentChanged);
      if (ctx.onEstablishPayload !== null) {
        const toSend = ctx.onEstablishPayload;
        ctx.onEstablishPayload = null;
        ctx.safeSend(toSend);
      }
      store.requestComputeExecSchedule();
    } else if (payload.type === 'set_exec_mode') {
      store.numAltModeExecutes = 0;
      store.settings.exec_mode = payload.exec_mode as string;
    } else if (payload.type === 'compute_exec_schedule') {
      handleComputeExecSchedule(ctx, handlers.debouncedSave, payload);
    }
  };
}
