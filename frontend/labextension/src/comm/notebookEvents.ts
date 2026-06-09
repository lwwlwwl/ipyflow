import { Cell, ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type { IChangedArgs } from '@jupyterlab/coreutils/lib/interfaces';
import { CellList, Notebook } from '@jupyterlab/notebook';
import type { IObservableList } from '@jupyterlab/observables';
import { JSONExt } from '@lumino/coreutils';

import classes from '../classes';
import { getStore } from '../state/registry';
import { debounce } from '../utils';
import { IConnectionContext } from './context';

export interface INotebookEventHandlers {
  syncDirtiness: (cell: Cell<ICellModel>) => void;
  onContentChanged: () => void;
  onExecution: (cell: ICellModel, args: IChangedArgs<any>) => void;
  onCellsAdded: (
    cells: CellList,
    change: IObservableList.IChangedArgs<ICellModel>,
  ) => void;
  notifyActiveCell: (newActiveCell: ICellModel) => void;
  onActiveCellChange: (nb: Notebook, cell: Cell<ICellModel>) => void;
  onSelectionChanged: () => void;
  debouncedSave: () => void;
}

/**
 * Build the set of notebook/selection event handlers bound to a connection
 * context. They are wired up at different points (connect time vs. establish),
 * so they are created once here and shared. UI updates are signalled via
 * `store.emitChanged()` rather than calling the renderer directly.
 */
export function createNotebookEventHandlers(
  ctx: IConnectionContext,
): INotebookEventHandlers {
  const { store, notebook, notebooks, docManager } = ctx;

  const syncDirtiness = (cell: Cell<ICellModel>) => {
    if (cell !== null && cell.model !== null) {
      if ((<ICodeCellModel>cell.model).isDirty) {
        store.dirtyCells.add(cell.model.id);
      } else {
        store.dirtyCells.delete(cell.model.id);
      }
    }
  };

  const onContentChanged = debounce(() => {
    if (ctx.disconnected) {
      notebook.model.contentChanged.disconnect(onContentChanged);
      notebook.model.cells.changed.disconnect(onContentChanged);
      return;
    }
    const cell_metadata_by_id = store.gatherCellMetadataAndContent();
    if (
      JSONExt.deepEqual(
        cell_metadata_by_id as any,
        store.lastCellMetadataMap as any,
      )
    ) {
      // fixes https://github.com/ipyflow/ipyflow/issues/145
      return;
    }
    store.lastCellMetadataMap = cell_metadata_by_id;
    notebook.widgets.forEach(syncDirtiness);
    ctx.safeSend({
      type: 'notify_content_changed',
      cell_metadata_by_id,
    });
  }, 500);

  const onExecution = (cell: ICellModel, args: IChangedArgs<any>) => {
    if (ctx.disconnected) {
      cell.stateChanged.disconnect(onExecution);
      return;
    }
    if (args.name !== 'executionCount' || args.newValue === null) {
      return;
    }
    store.executedCells.add(cell.id);
    store.dirtyCells.delete(cell.id);
    notebook.widgets.forEach((itercell) => {
      if (itercell.model.id === cell.id) {
        itercell.node.classList.remove(classes.readyCell);
        itercell.node.classList.remove(classes.readyMakingInputCell);
      }
    });
  };

  const onCellsAdded = (
    _cells: CellList,
    change: IObservableList.IChangedArgs<ICellModel>,
  ) => {
    if (ctx.disconnected) {
      notebook.model.cells.changed.disconnect(onCellsAdded);
      return;
    }
    if (change.type === 'add') {
      for (const cell of change.newValues) {
        cell?.stateChanged.connect(onExecution);
      }
    } else if (change.type === 'remove') {
      for (const cell of change.oldValues) {
        cell?.stateChanged.disconnect(onExecution);
      }
    }
  };

  const notifyActiveCell = (newActiveCell: ICellModel) => {
    if (newActiveCell.id == null) {
      return;
    }
    let newActiveCellOrderIdx = -1;
    notebook.widgets.forEach((itercell, idx) => {
      if (itercell.model.id === newActiveCell.id) {
        newActiveCellOrderIdx = idx;
      }
    });
    ctx.safeSend({
      type: 'change_active_cell',
      active_cell_id: newActiveCell.id,
      active_cell_order_idx: newActiveCellOrderIdx,
    });
  };

  const onActiveCellChange = (nb: Notebook, cell: Cell<ICellModel>) => {
    if (notebook !== nb) {
      return;
    }
    if (ctx.disconnected) {
      notebook.activeCellChanged.disconnect(onActiveCellChange);
      return;
    }
    notifyActiveCell(cell.model);
    store.prevActiveCell = store.activeCell;
    store.activeCell = cell;

    if (
      store.activeCell === null ||
      store.activeCell.model === null ||
      store.activeCell.model.type !== 'code'
    ) {
      return;
    }

    if (store.dirtyCells.has(store.activeCell.model.id)) {
      (store.activeCell.model as any)._setDirty?.(true);
    }
    store.emitChanged();
  };

  const onSelectionChanged = () => {
    if (ctx.disconnected) {
      notebooks.selectionChanged.disconnect(onSelectionChanged);
    }
    const nbPanel = notebooks?.currentWidget;
    const session = nbPanel?.sessionContext;
    if (!(session?.isReady ?? false)) {
      return;
    }
    const selectionStore = getStore(session.session.id);
    if (!(selectionStore?.isIpyflowCommConnected ?? false)) {
      return;
    }
    const selectionNotebook = nbPanel.content;
    selectionStore.selectedCells = selectionNotebook.widgets
      .filter(
        (cell) =>
          cell.model.type === 'code' && selectionNotebook.isSelected(cell),
      )
      .map((cell) => cell.model.id);
    selectionStore.emitChanged();
  };

  const debouncedSave = debounce(() => {
    const nbPanel = notebooks.currentWidget;
    if ((nbPanel.model as any).collaborative ?? false) {
      return;
    } else if (docManager.autosave && docManager.autosaveInterval <= 5) {
      return;
    } else {
      nbPanel.context.save();
    }
  }, 200);

  return {
    syncDirtiness,
    onContentChanged,
    onExecution,
    onCellsAdded,
    notifyActiveCell,
    onActiveCellChange,
    onSelectionChanged,
    debouncedSave,
  };
}
