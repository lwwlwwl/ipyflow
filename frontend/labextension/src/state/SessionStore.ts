import { ISessionContext } from '@jupyterlab/apputils';
import { Cell, CodeCell, ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import { Notebook } from '@jupyterlab/notebook';
import { KernelMessage } from '@jupyterlab/services';
import { IComm, IShellFuture } from '@jupyterlab/services/lib/kernel/kernel';
import { JSONValue } from '@lumino/coreutils';
import { ISignal, Signal } from '@lumino/signaling';

import {
  computeRawTransitiveClosure,
  computeRawTransitiveClosureHelper,
  computeTopoOrderIdx,
  IClosureContext,
} from '../graph/closure';
import {
  CellMetadataMap,
  EdgeMap,
  Highlights,
  ISettings,
  NestedEdgeMap,
} from '../types';

/**
 * Per-session frontend state for ipyflow. Mutations are applied directly to the
 * fields (as before); call {@link emitChanged} once a logical update has
 * settled so the decoration layer can re-render. Structurally satisfies
 * {@link IClosureContext} so the pure graph algorithms can operate on it.
 */
export class IpyflowSessionStore implements IClosureContext {
  comm: IComm | null = null;
  safeSend: ((data: JSONValue) => void) | null = null;
  notebook: Notebook | null = null;
  session: ISessionContext | null = null;
  isIpyflowCommConnected = false;
  selectedCells: string[] = [];
  executedCells: Set<string> = new Set();
  dirtyCells: Set<string> = new Set();
  waitingCells: Set<string> = new Set();
  readyCells: Set<string> = new Set();
  waiterLinks: EdgeMap = {};
  readyMakerLinks: EdgeMap = {};
  staleParents: EdgeMap = {};
  staleParentsByExecutedCellByChild: NestedEdgeMap = {};
  staleParentsByChildByExecutedCell: NestedEdgeMap = {};
  prevActiveCell: Cell<ICellModel> | null = null;
  activeCell: Cell<ICellModel> | null = null;
  cellsById: { [id: string]: Cell<ICellModel> } = {};
  orderIdxById: { [id: string]: number } = {};
  cellPendingExecution: CodeCell | null = null;
  isReactivelyExecuting = false;
  numAltModeExecutes = 0;
  altModeExecuteCells: Cell<ICellModel>[] | null = null;
  lastExecutionHighlights: Highlights | null = null;
  executedReactiveReadyCells: Set<string> = new Set();
  newReadyCells: Set<string> = new Set();
  forcedReactiveCells: Set<string> = new Set();
  cellParents: EdgeMap = {};
  cellChildren: EdgeMap = {};
  settings: ISettings = {};
  lastCellMetadataMap: CellMetadataMap | null = null;
  inProgressExecs = 0;

  private _changed = new Signal<this, void>(this);

  /** Emitted after a logical state update settles; the UI re-renders on it. */
  get changed(): ISignal<this, void> {
    return this._changed;
  }

  emitChanged(): void {
    this._changed.emit();
  }

  gatherCellMetadataAndContent(): CellMetadataMap {
    const cell_metadata_by_id: CellMetadataMap = {};
    this.notebook.widgets.forEach((itercell, idx) => {
      const model = itercell.model;
      cell_metadata_by_id[model.id] = {
        index: idx,
        content: model.sharedModel.getSource(),
        type: model.type,
      };
    });
    return cell_metadata_by_id;
  }

  requestComputeExecSchedule(): void {
    (this.safeSend ?? this.comm.send)({
      type: 'compute_exec_schedule',
      cell_metadata_by_id: this.gatherCellMetadataAndContent(),
      is_reactively_executing: this.isReactivelyExecuting,
    });
  }

  isBatchReactive(): boolean {
    return (
      (this.isIpyflowCommConnected ?? false) &&
      this.settings?.exec_mode === 'reactive' &&
      this.settings?.reactivity_mode === 'batch'
    );
  }

  executeCells(cells: Cell<ICellModel>[]): void {
    if (cells.length === 0) {
      return;
    }
    let numFinished = 0;
    for (const cell of cells) {
      // if any of them fail, change the [*] to [ ] on subsequent cells
      CodeCell.execute(cell as CodeCell, this.session).then(() => {
        const execCount = (cell.model as ICodeCellModel).executionCount;
        if (execCount != null) {
          // Reconcile the input prompt with the real execution count. After a
          // kernel restart (cells run while the comm is reconnecting are
          // deferred and shown as [*]) the prompt can be left showing [*] even
          // though the cell finished and the model already has a concrete
          // count, so set it explicitly rather than relying on CodeCell having
          // refreshed the DOM.
          cell.setPrompt(`${execCount}`);
          this.executedCells.add(cell.model.id);
        } else if (cell.promptNode.textContent?.includes('[*]')) {
          // no execution count: the cell was aborted (e.g. a preceding cell
          // errored), so clear the lingering [*].
          cell.setPrompt('');
        }
        if (++numFinished === cells.length) {
          // wait a tick first to allow the disk changes to propagate up
          this.isReactivelyExecuting = false;
          setTimeout(() => {
            this.requestComputeExecSchedule();
          }, 0);
        }
      });
    }
  }

  executeClosure(cells: Cell<ICellModel>[]): void {
    if (cells.length === 0) {
      return;
    }
    const cellIds = cells.map((cell) => cell.model.id);
    const closureCells = this.computeTransitiveClosure(cellIds);
    this.executeCells(closureCells);
  }

  toggleReactivity(): IShellFuture<
    KernelMessage.IExecuteRequestMsg,
    KernelMessage.IExecuteReplyMsg
  > {
    if (this.settings.exec_mode === 'reactive') {
      this.settings.exec_mode = 'lazy';
    } else if (this.settings.exec_mode === 'lazy') {
      this.settings.exec_mode = 'reactive';
    }
    return this.session.session.kernel.requestExecute({
      code: '%flow toggle-reactivity',
      silent: true,
      store_history: false,
    });
  }

  computeRawTransitiveClosureHelper(
    closure: Set<string>,
    cellId: string,
    edges: EdgeMap | undefined | null,
    pullReactiveUpdates = false,
    skipFirstCheck = false,
  ): void {
    computeRawTransitiveClosureHelper(
      this,
      closure,
      cellId,
      edges,
      pullReactiveUpdates,
      skipFirstCheck,
    );
  }

  computeRawTransitiveClosure(
    startCellIds: string[],
    inclusive = true,
    parents = false,
  ): Set<string> {
    return computeRawTransitiveClosure(this, startCellIds, inclusive, parents);
  }

  computeTransitiveClosure(
    startCellIds: string[],
    inclusive = true,
    parents = false,
  ): Cell<ICellModel>[] {
    return this.cellIdsToCells(
      Array.from(
        this.computeRawTransitiveClosure(startCellIds, inclusive, parents),
      ),
    );
  }

  cellIdsToCells(cellIds: string[]): Cell<ICellModel>[] {
    const orderIdxById =
      this.settings.flow_order === 'any_order'
        ? computeTopoOrderIdx(
            Object.keys(this.cellsById),
            this.cellChildren,
            (id) => this.cellsById[id]?.model?.type === 'code',
          )
        : this.orderIdxById;
    return cellIds
      .filter((id) => this.cellsById[id] !== undefined)
      .filter((id) => this.orderIdxById[id] !== undefined)
      .sort((a, b) => orderIdxById[a] - orderIdxById[b])
      .map((id) => this.cellsById[id]);
  }
}
