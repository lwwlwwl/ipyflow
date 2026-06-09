import { Cell, CodeCell, ICellModel } from '@jupyterlab/cells';

import { drainDeferredCells, hasDeferredCells } from '../state/deferred';
import { EdgeMap, Highlights, ISettings, NestedEdgeMap } from '../types';
import { mergeMaps } from '../utils';
import { IConnectionContext } from './context';

/**
 * Handle a `compute_exec_schedule` message: absorb the kernel's view of the
 * dependency graph and reactive state, drive the next batch/incremental
 * reactive execution step, and emit a UI refresh once the reactive cascade for
 * this round has settled. Ported verbatim from the original monolithic
 * `comm.onMsg` handler, with `state` -> `ctx.store` and the direct `updateUI`
 * call replaced by `store.emitChanged()`.
 */
export function handleComputeExecSchedule(
  ctx: IConnectionContext,
  debouncedSave: () => void,
  payload: any,
): void {
  const { store, notebook } = ctx;

  store.settings = payload.settings as ISettings;
  const ipyflow_metadata =
    (notebook.model as any).getMetadata?.('ipyflow') ?? ({} as any);
  const parentsFromMetadata = ipyflow_metadata?.cell_parents ?? {};
  const childrenFromMetadata = ipyflow_metadata?.cell_children ?? {};
  store.cellParents = mergeMaps(
    payload.cell_parents as EdgeMap,
    parentsFromMetadata,
  );
  store.cellChildren = mergeMaps(
    payload.cell_children as EdgeMap,
    childrenFromMetadata,
  );
  store.executedCells = new Set(payload.executed_cells as string[]);
  (notebook.model as any).setMetadata?.('ipyflow', {
    cell_parents: store.cellParents,
    cell_children: store.cellChildren,
  });
  debouncedSave();
  store.waitingCells = new Set(payload.waiting_cells as string[]);
  store.readyCells = new Set(payload.ready_cells as string[]);
  store.forcedReactiveCells = new Set([
    ...store.forcedReactiveCells,
    ...(payload.forced_reactive_cells as string[]),
  ]);
  store.waiterLinks = payload.waiter_links as EdgeMap;
  store.readyMakerLinks = payload.ready_maker_links as EdgeMap;
  store.staleParents = payload.stale_parents as EdgeMap;
  store.staleParentsByExecutedCellByChild =
    payload.stale_parents_by_executed_cell_by_child as NestedEdgeMap;
  store.staleParentsByChildByExecutedCell =
    payload.stale_parents_by_child_by_executed_cell as NestedEdgeMap;
  store.cellPendingExecution = null;
  const exec_mode = payload.exec_mode as string;
  store.isReactivelyExecuting =
    store.isReactivelyExecuting ||
    ((payload?.is_reactively_executing as boolean) ?? false) ||
    exec_mode === 'reactive';
  if (exec_mode === 'reactive') {
    store.newReadyCells = new Set([
      ...store.newReadyCells,
      ...(payload.new_ready_cells as string[]),
    ]);
  } else {
    store.newReadyCells = new Set();
  }
  const flow_order = payload.flow_order;
  const exec_schedule = payload.exec_schedule;
  store.lastExecutionHighlights = payload.highlights as Highlights;
  const lastExecutedCellId = payload.last_executed_cell_id as string;
  store.executedReactiveReadyCells.add(lastExecutedCellId);
  if (hasDeferredCells()) {
    const cells = drainDeferredCells();
    if (store.isBatchReactive()) {
      store.executeClosure(cells);
    } else {
      store.executeCells(cells);
    }
    return;
  }
  const last_execution_was_error = payload.last_execution_was_error as boolean;
  let doneReactivelyExecuting = false;
  if (last_execution_was_error) {
    doneReactivelyExecuting = true;
  } else if (store.settings.reactivity_mode === 'batch') {
    let reactiveCells: Array<Cell<ICellModel>>;
    if (exec_mode === 'reactive') {
      reactiveCells = store
        .computeTransitiveClosure(
          [...store.newReadyCells, ...store.forcedReactiveCells].filter(
            (id) => !store.executedReactiveReadyCells.has(id),
          ),
        )
        .filter((cell) => !store.executedReactiveReadyCells.has(cell.model.id));
    } else {
      reactiveCells = [...store.forcedReactiveCells]
        .filter(
          (id) =>
            !store.executedReactiveReadyCells.has(id) &&
            store.cellsById[id] !== undefined &&
            store.orderIdxById[id] !== undefined,
        )
        .sort((a, b) => store.orderIdxById[a] - store.orderIdxById[b])
        .map((id) => store.cellsById[id]);
    }
    if (reactiveCells.length === 0) {
      doneReactivelyExecuting = true;
    } else {
      store.isReactivelyExecuting = true;
      store.executedReactiveReadyCells = new Set([
        ...store.executedReactiveReadyCells,
        ...reactiveCells.map((cell) => cell.model.id),
      ]);
      store.executeCells(reactiveCells);
    }
  } else if (store.settings.reactivity_mode === 'incremental') {
    let lastExecutedCellIdSeen = false;
    for (const cell of notebook.widgets) {
      if (!lastExecutedCellIdSeen) {
        lastExecutedCellIdSeen = cell.model.id === lastExecutedCellId;
        if (flow_order === 'in_order' || exec_schedule === 'strict') {
          continue;
        }
      }
      if (
        cell.model.type !== 'code' ||
        store.executedReactiveReadyCells.has(cell.model.id)
      ) {
        continue;
      }
      if (!store.forcedReactiveCells.has(cell.model.id)) {
        if (
          !store.newReadyCells.has(cell.model.id) ||
          exec_mode !== 'reactive'
        ) {
          continue;
        }
      }
      const codeCell = cell as CodeCell;
      if (store.cellPendingExecution === null) {
        store.cellPendingExecution = codeCell;
        // break early if using one of the order-based semantics
        if (flow_order === 'in_order' || exec_schedule === 'strict') {
          break;
        }
      } else if (codeCell.model.executionCount == null) {
        // pass
      } else if (
        codeCell.model.executionCount <
        store.cellPendingExecution.model.executionCount
      ) {
        // otherwise, execute in order of earliest execution counter
        store.cellPendingExecution = codeCell;
      }
    }
    if (store.cellPendingExecution === null) {
      doneReactivelyExecuting = true;
    } else {
      store.isReactivelyExecuting = true;
      store.executedCells.add(store.cellPendingExecution.model.id);
      store.executeCells([store.cellPendingExecution]);
    }
  }
  if (doneReactivelyExecuting) {
    if (store.isReactivelyExecuting) {
      if (store.lastExecutionHighlights === 'reactive') {
        store.readyCells = store.executedReactiveReadyCells;
      }
      ctx.safeSend({
        type: 'reactivity_cleanup',
      });
    }
    if (
      store.numAltModeExecutes > 0 &&
      --store.numAltModeExecutes === 0 &&
      store.settings.reactivity_mode === 'incremental'
    ) {
      store.toggleReactivity();
    }
    store.forcedReactiveCells = new Set();
    store.newReadyCells = new Set();
    store.executedReactiveReadyCells = new Set();
    store.isReactivelyExecuting = false;
    store.emitChanged();
  }
}
