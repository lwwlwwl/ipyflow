import { Cell, ICellModel } from '@jupyterlab/cells';
import { INotebookTracker, Notebook } from '@jupyterlab/notebook';

import classes from '../classes';
import { IpyflowSessionStore } from '../state/SessionStore';
import {
  addUnsafeCellInteraction,
  addWaitingOutputInteractions,
  clearCellState,
  getJpInputCollapser,
  getJpOutputCollapser,
} from './dom';

const actionUpdatePairs: {
  action: 'mouseover' | 'mouseout';
  update: 'add' | 'remove';
}[] = [
  { action: 'mouseover', update: 'add' },
  { action: 'mouseout', update: 'remove' },
];

/** Rebuild the id -> cell / id -> order-index lookups from the notebook widgets. */
export function refreshNodeMapping(
  store: IpyflowSessionStore,
  notebook: Notebook,
): void {
  store.cellsById = {};
  store.orderIdxById = {};
  notebook.widgets.forEach((cell, idx) => {
    store.cellsById[cell.model.id] = cell;
    store.orderIdxById[cell.model.id] = idx;
  });
}

function updateOneCellUI(
  store: IpyflowSessionStore,
  cell: Cell<ICellModel>,
  inSlice: boolean,
  inExecuteSlice: boolean,
  showCollapserHighlights: boolean,
  minimapNode: Element | undefined,
): void {
  const { model, node } = cell;
  const id = model.id;
  if (model.type !== 'code') {
    return;
  }
  if ((store.settings.color_scheme ?? 'normal') === 'classic') {
    node.classList.add(classes.ipyflowClassicColors);
    minimapNode?.classList.add(classes.ipyflowClassicColors);
  } else {
    node.classList.remove(classes.ipyflowClassicColors);
    minimapNode?.classList.remove(classes.ipyflowClassicColors);
  }
  if (inExecuteSlice) {
    node.classList.add(classes.ipyflowSliceExecute);
    minimapNode?.classList.add(classes.ipyflowSliceExecute);
  } else {
    node.classList.remove(classes.ipyflowSliceExecute);
    minimapNode?.classList.remove(classes.ipyflowSliceExecute);
  }
  if (inSlice && !inExecuteSlice) {
    node.classList.add(classes.ipyflowSlice);
    minimapNode?.classList.add(classes.ipyflowSlice);
  } else {
    node.classList.remove(classes.ipyflowSlice);
    minimapNode?.classList.remove(classes.ipyflowSlice);
  }
  if (cell.model.id === store.activeCell.model.id) {
    minimapNode?.classList.remove(classes.ipyflowSliceExecute);
    minimapNode?.classList.remove(classes.ipyflowSlice);
  }
  if (!showCollapserHighlights) {
    return;
  }
  if (store.waitingCells.has(id)) {
    node.classList.add(classes.waitingCell);
    node.classList.add(classes.readyCell);
    node.classList.remove(classes.readyMakingInputCell);
    addWaitingOutputInteractions(node, classes.linkedWaiting);
  } else if (store.readyCells.has(id)) {
    node.classList.add(classes.readyMakingInputCell);
    node.classList.add(classes.readyCell);
    addWaitingOutputInteractions(node, classes.linkedReadyMaker);
  }

  if (store.settings.exec_mode === 'reactive') {
    return;
  }

  if (store.waiterLinks[id] !== undefined) {
    actionUpdatePairs.forEach(({ action, update }) => {
      addUnsafeCellInteraction(
        getJpInputCollapser(node),
        store.waiterLinks[id],
        store.cellsById,
        getJpInputCollapser,
        action,
        update,
        store.waitingCells,
      );

      addUnsafeCellInteraction(
        getJpOutputCollapser(node),
        store.waiterLinks[id],
        store.cellsById,
        getJpInputCollapser,
        action,
        update,
        store.waitingCells,
      );
    });
  }

  if (store.readyMakerLinks[id] !== undefined) {
    if (!store.waitingCells.has(id)) {
      node.classList.add(classes.readyMakingCell);
      node.classList.add(classes.readyCell);
    }
    actionUpdatePairs.forEach(({ action, update }) => {
      addUnsafeCellInteraction(
        getJpInputCollapser(node),
        store.readyMakerLinks[id],
        store.cellsById,
        getJpInputCollapser,
        action,
        update,
        store.waitingCells,
      );

      addUnsafeCellInteraction(
        getJpInputCollapser(node),
        store.readyMakerLinks[id],
        store.cellsById,
        getJpOutputCollapser,
        action,
        update,
        store.waitingCells,
      );
    });
  }
}

/**
 * Re-render all ipyflow cell decorations for the store's notebook. Idempotent
 * (clears then reapplies), so it is safe to drive from the store's `changed`
 * signal. No-ops when the store's notebook is not the foreground notebook.
 */
export function updateUI(
  store: IpyflowSessionStore,
  notebooks: INotebookTracker,
): void {
  const notebook = store.notebook;
  if (notebook === null || notebooks.currentWidget?.content !== notebook) {
    return;
  }
  clearCellState(notebook);
  refreshNodeMapping(store, notebook);
  let closureCellIds = store.selectedCells;
  if (closureCellIds.length === 0) {
    closureCellIds = [store.activeCell.model.id];
  }
  const executeSlice = store.computeRawTransitiveClosure(
    closureCellIds,
    true,
    false,
  );
  closureCellIds = Array.from(executeSlice);
  const slice = new Set(executeSlice);
  for (const cellId of closureCellIds) {
    slice.delete(cellId);
    store.computeRawTransitiveClosureHelper(slice, cellId, store.cellParents);
  }

  const minimapNodesByCellId: { [ctr: string]: Element } = {};
  notebook.node
    .querySelectorAll(
      'div.jp-WindowedPanel-scrollbar > ol > li.jp-WindowedPanel-scrollbar-item',
    )
    .forEach((node, idx) => {
      const cellModel = notebook.widgets[idx]?.model;
      if (cellModel !== undefined) {
        minimapNodesByCellId[cellModel.id] = node;
      }
    });

  for (const cell of notebook.widgets) {
    const id = cell.model.id;
    updateOneCellUI(
      store,
      cell,
      slice.has(id),
      executeSlice.has(id),
      store.lastExecutionHighlights !== 'none',
      minimapNodesByCellId[id],
    );
  }
}
