import { JupyterFrontEnd } from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { CodeCell } from '@jupyterlab/cells';
import { INotebookTracker } from '@jupyterlab/notebook';

import { getStore } from '../state/registry';
import { IpyflowSessionStore } from '../state/SessionStore';

/**
 * Register the ipyflow execution commands (and their keybindings / palette
 * entries): run-ready-cells, alt-mode execute, and forward/backward slice
 * execution.
 */
export function registerCommands(
  app: JupyterFrontEnd,
  notebooks: INotebookTracker,
  palette: ICommandPalette,
): void {
  app.commands.addCommand('execute-stale', {
    label: 'Execute Ready Cells',
    isEnabled: () => true,
    isVisible: () => true,
    isToggled: () => false,
    execute: () => {
      const session = notebooks.currentWidget.sessionContext;
      if (!session.isReady) {
        return;
      }
      const store = (getStore(session.session.id) ?? {}) as IpyflowSessionStore;
      if (!(store.isIpyflowCommConnected ?? false)) {
        return;
      }
      const cellIdsToExecute = Array.from(
        new Set([...store.dirtyCells, ...store.readyCells]),
      );
      let cellsToExecute;
      if (store.settings.reactivity_mode === 'batch') {
        cellsToExecute = store.computeTransitiveClosure(cellIdsToExecute);
      } else {
        cellsToExecute = store.cellIdsToCells(cellIdsToExecute);
      }
      store.executeCells(cellsToExecute);
    },
  });

  app.commands.addCommand('alt-mode-execute', {
    label: 'Alt Mode Execute',
    isEnabled: () => true,
    isVisible: () => true,
    isToggled: () => false,
    execute: () => {
      const session = notebooks.currentWidget.sessionContext;
      if (!session.isReady) {
        return;
      }
      app.commands.execute('notebook:enter-command-mode');
      const store = (getStore(session.session.id) ?? {}) as IpyflowSessionStore;
      const altModeExecuteCells = store.altModeExecuteCells;
      store.altModeExecuteCells = null;
      if (!(store.isIpyflowCommConnected ?? false)) {
        store.executedCells.add(notebooks.activeCell.model.id);
        CodeCell.execute(notebooks.activeCell as CodeCell, session);
        return;
      }
      if (
        store.settings.reactivity_mode !== 'batch' &&
        altModeExecuteCells !== null
      ) {
        return;
      }
      if (notebooks.activeCell.model.type !== 'code') {
        return;
      }
      store.numAltModeExecutes++;
      if (store.settings.reactivity_mode === 'incremental') {
        if (store.numAltModeExecutes === 1) {
          store.toggleReactivity().done.then(() => {
            store.executedCells.add(notebooks.activeCell.model.id);
            CodeCell.execute(notebooks.activeCell as CodeCell, session);
          });
        } else {
          store.executedCells.add(notebooks.activeCell.model.id);
          CodeCell.execute(notebooks.activeCell as CodeCell, session);
        }
      } else if (store.settings.reactivity_mode === 'batch') {
        let closure = altModeExecuteCells ?? [notebooks.activeCell];
        if (
          store.settings.exec_mode === 'lazy' &&
          altModeExecuteCells === null
        ) {
          closure = store.computeTransitiveClosure([
            notebooks.activeCell.model.id,
          ]);
        }
        store.executeCells(closure);
      } else {
        console.error(
          `Unknown reactivity mode: ${store.settings.reactivity_mode}`,
        );
      }
    },
  });
  app.commands.addKeyBinding({
    command: 'alt-mode-execute',
    keys: ['Accel Shift Enter'],
    selector: '.jp-Notebook',
  });
  app.commands.addKeyBinding({
    command: 'alt-mode-execute',
    keys: ['Ctrl Shift Enter'],
    selector: '.jp-Notebook',
  });
  app.commands.addKeyBinding({
    command: 'execute-stale',
    keys: ['Space'],
    selector: '.jp-Notebook.jp-mod-commandMode',
  });
  palette.addItem({
    command: 'alt-mode-execute',
    category: 'execution',
    args: {},
  });

  const executeSlice = (isBackward: boolean) => {
    const session = notebooks.currentWidget.sessionContext;
    if (!session.isReady) {
      return;
    }
    const store = (getStore(session.session.id) ?? {}) as IpyflowSessionStore;
    if (!(store.isIpyflowCommConnected ?? false)) {
      return;
    }
    app.commands.execute('notebook:enter-command-mode');
    const closure = store.computeTransitiveClosure(
      [store.activeCell.model.id],
      true,
      isBackward,
    );
    if (store.settings.exec_mode === 'lazy') {
      store.executeCells(closure);
    } else {
      store.altModeExecuteCells = closure;
      app.commands.execute('alt-mode-execute');
    }
  };

  app.commands.addCommand('execute-forward-slice', {
    label: 'Execute Forward Slice',
    isEnabled: () => true,
    isVisible: () => true,
    isToggled: () => false,
    execute: () => executeSlice(false),
  });
  app.commands.addKeyBinding({
    command: 'execute-forward-slice',
    keys: ['Accel J'],
    selector: '.jp-Notebook',
  });
  app.commands.addKeyBinding({
    command: 'execute-forward-slice',
    keys: ['Accel ArrowDown'],
    selector: '.jp-Notebook',
  });

  app.commands.addCommand('execute-backward-slice', {
    label: 'Execute Backward Slice',
    isEnabled: () => true,
    isVisible: () => true,
    isToggled: () => false,
    execute: () => executeSlice(true),
  });
  app.commands.addKeyBinding({
    command: 'execute-backward-slice',
    keys: ['Accel K'],
    selector: '.jp-Notebook',
  });
  app.commands.addKeyBinding({
    command: 'execute-backward-slice',
    keys: ['Accel ArrowUp'],
    selector: '.jp-Notebook',
  });
}
