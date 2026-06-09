import { Cell, ICellModel } from '@jupyterlab/cells';

// Cells run while a kernel named 'ipyflow' is still establishing its comm. They
// are shown as [*] and flushed once the first schedule is computed.
//
// This is intentionally a process-wide singleton rather than per-session state:
// the deferral happens before any per-session store exists (the comm is not yet
// connected), so the queue must survive store creation/recreation.
const deferredCells: Cell<ICellModel>[] = [];

export function deferCell(cell: Cell<ICellModel>): void {
  deferredCells.push(cell);
}

/** Remove and return all currently deferred cells. */
export function drainDeferredCells(): Cell<ICellModel>[] {
  return deferredCells.splice(0, deferredCells.length);
}

export function hasDeferredCells(): boolean {
  return deferredCells.length > 0;
}
