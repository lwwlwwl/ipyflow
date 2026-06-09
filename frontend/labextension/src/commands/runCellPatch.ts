import { JupyterFrontEnd } from '@jupyterlab/application';
import { INotebookTracker, Notebook } from '@jupyterlab/notebook';

import { deferCell } from '../state/deferred';
import { getStore } from '../state/registry';
import { IpyflowSessionStore } from '../state/SessionStore';

/**
 * Monkey-patch JupyterLab's run-cell commands so that, on an ipyflow session,
 * execution is routed through ipyflow's batch-reactive / scheduling machinery.
 * Non-ipyflow sessions fall through to the original behavior unchanged.
 */
export function patchRunCommands(
  app: JupyterFrontEnd,
  notebooks: INotebookTracker,
): void {
  let runCellCommand: any;
  let runCellAndSelectNextCommand: any;
  let runMenuRunCommand: any;
  try {
    runCellCommand = (app.commands as any)._commands.get('notebook:run-cell');
    runCellAndSelectNextCommand = (app.commands as any)._commands.get(
      'notebook:run-cell-and-select-next',
    );
    runMenuRunCommand = (app.commands as any)._commands.get('runmenu:run');
  } catch {
    runCellCommand = (app.commands as any)._commands['notebook:run-cell'];
    runCellAndSelectNextCommand = (app.commands as any)._commands[
      'notebook:run-cell-and-select-next'
    ];
    runMenuRunCommand = (app.commands as any)._commands['runmenu:run'];
  }
  const runCellCommandExecute = runCellCommand.execute;
  const runCellAndSelectNextCommandExecute =
    runCellAndSelectNextCommand.execute;
  const runMenuRunCommandExecute = runMenuRunCommand.execute;

  const getIpyflowState = (): IpyflowSessionStore => {
    const session = notebooks.currentWidget.sessionContext;
    if (!session.isReady) {
      return {} as IpyflowSessionStore;
    }
    return (getStore(session.session.id) ?? {}) as IpyflowSessionStore;
  };

  const isBatchReactive = () => {
    const state = getIpyflowState();
    return state.isBatchReactive();
  };

  const executeBatchReactive = (skipFirst = false) => {
    const state = getIpyflowState();
    if (!(state.isIpyflowCommConnected ?? false)) {
      return;
    }
    const closureCellIds: string[] = [];
    for (const cell of state.notebook.widgets) {
      if (state.notebook.isSelectedOrActive(cell)) {
        closureCellIds.push(cell.model.id);
      }
    }
    let closure = state.computeTransitiveClosure(closureCellIds, true);
    if (skipFirst) {
      closure = closure.splice(1);
    }
    if (closure.length > 0) {
      state.executeCells(closure);
    } else {
      state.requestComputeExecSchedule();
    }
  };

  const patches: Array<[any, any, string]> = [
    [runCellCommand, runCellCommandExecute, 'notebook:run-cell'],
    [
      runCellAndSelectNextCommand,
      runCellAndSelectNextCommandExecute,
      'notebook:run-cell-and-select-next',
    ],
    [runMenuRunCommand, runMenuRunCommandExecute, 'runmenu:run'],
  ];
  patches.forEach(([command, exec, commandId]) => {
    command.execute = (...args: any[]) => {
      // Always forward the original command's result promise so that callers
      // which serialize on it (run-and-advance, restart-and-run, automation)
      // observe real completion instead of resolving immediately. Use apply
      // so the original execute receives its real args object rather than the
      // rest-collected array.
      const runOriginal = () => exec.apply(command, args);

      // Inspect ipyflow/session state defensively. A transient null widget,
      // session, or kernel (e.g. during kernel restart or notebook switch)
      // must not abort the run -- fall back to vanilla execution instead of
      // throwing before the cell is ever submitted.
      let state!: IpyflowSessionStore;
      let notebook!: Notebook;
      let kernel: string | undefined;
      let connected!: boolean;
      try {
        const nbpanel = notebooks.currentWidget;
        if (nbpanel == null) {
          return runOriginal();
        }
        state = getIpyflowState();
        notebook = nbpanel.content;
        kernel = nbpanel.sessionContext?.session?.kernel?.name;
        connected = state?.isIpyflowCommConnected ?? false;
      } catch (e) {
        console.error('ipyflow: run-cell wrapper error, running normally', e);
        return runOriginal();
      }

      if (kernel === 'ipyflow' && !connected) {
        for (const cell of notebook.widgets) {
          if (notebook.isSelectedOrActive(cell)) {
            cell.setPrompt('*');
            deferCell(cell);
          }
        }
        return;
      } else if (
        isBatchReactive() &&
        state?.activeCell?.model?.type === 'code'
      ) {
        app.commands.execute('notebook:enter-command-mode');
        const lastCell =
          state.notebook.widgets[state.notebook.widgets.length - 1];
        const isExecutingLastCell =
          state.activeCell.model.id === lastCell.model.id;
        executeBatchReactive();
        if (
          ['notebook:run-cell-and-select-next', 'runmenu:run'].includes(
            commandId,
          )
        ) {
          if (isExecutingLastCell) {
            app.commands.execute('notebook:insert-cell-below');
          } else {
            app.commands.execute('notebook:move-cursor-down');
          }
        }
        return;
      } else if (!connected) {
        // Not an ipyflow session: behave exactly like vanilla JupyterLab.
        // Do not touch inProgressExecs or request a schedule recompute, which
        // would needlessly tear down and recreate the (rejected) comm on
        // every single cell execution.
        return runOriginal();
      } else {
        state.inProgressExecs++;
        const settle = () => {
          if (--state.inProgressExecs <= 0) {
            state.inProgressExecs = 0;
            state.requestComputeExecSchedule();
          }
        };
        let result: Promise<any>;
        try {
          result = Promise.resolve(runOriginal());
        } catch (err) {
          settle();
          throw err;
        }
        return result.then(
          () => settle(),
          (err: any) => {
            settle();
            throw err;
          },
        );
      }
    };
  });
}
