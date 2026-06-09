import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { INotebookTracker } from '@jupyterlab/notebook';

import { setupComm } from './comm/connect';
import { registerCommands } from './commands/commands';
import { patchRunCommands } from './commands/runCellPatch';

/**
 * Initialization data for the jupyterlab-ipyflow extension.
 *
 * The activation wiring is intentionally thin: command registration lives in
 * `commands/`, the run-cell interception in `commands/runCellPatch`, and the
 * kernel comm lifecycle (plus per-session state and cell decoration) in
 * `comm/`, `state/`, and `ui/`.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-ipyflow',
  requires: [INotebookTracker, ICommandPalette, IDocumentManager],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    notebooks: INotebookTracker,
    palette: ICommandPalette,
    docManager: IDocumentManager,
  ) => {
    registerCommands(app, notebooks, palette);
    patchRunCommands(app, notebooks);
    setupComm(notebooks, docManager);
  },
};

export default extension;
