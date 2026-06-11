import { expect, test } from '@jupyterlab/galata';

import {
  attachNotebookDumpOnFailure,
  cellChildrenIncludes,
  cellModelId,
  cellOutputText,
  cellSource,
  deleteCell,
  openIpyflowNotebook,
  readyAndWaitingCells,
  setCellSource,
  settleAutosave,
  waitForComm,
  waitForEdge
} from './helpers';

/**
 * Notebook-level operations: deleting cells, juggling multiple ipyflow
 * notebooks, and running a cell before the comm has established.
 */
test.describe('ipyflow notebook operations', () => {
  attachNotebookDumpOnFailure(test);

  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test('deleting a cell keeps the surviving dependency graph working', async ({
    page
  }) => {
    // y and z both depend directly on x. Run in place (Control+Enter) so the
    // last-cell run does not advance + insert a trailing cell, keeping the count
    // exact for the deletion assertion below.
    await openIpyflowNotebook(page, ['x = 1', 'y = x + 1', 'z = x + 100']);
    for (let i = 0; i < 3; i++) {
      await page.notebook.runCell(i, true);
    }
    await waitForEdge(page, 0, 1);
    await waitForEdge(page, 0, 2);

    // Delete the middle cell (y). z shifts to index 1.
    await deleteCell(page, 1);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as any).ipyflow.notebook.model.sharedModel.cells.length
          ),
        { timeout: 15_000, message: 'cell was not deleted' }
      )
      .toBe(2);

    // The comm is unaffected and the surviving x -> z edge still drives
    // staleness: re-running x flags z (now at index 1) ready.
    expect(
      await page.evaluate(() => (window as any).ipyflow?.isIpyflowCommConnected)
    ).toBe(true);

    await setCellSource(page, 0, 'x = 5');
    expect(await cellSource(page, 0)).toBe('x = 5');
    await page.notebook.runCell(0);

    const zId = await cellModelId(page, 1);
    await expect
      .poll(() => readyAndWaitingCells(page), {
        timeout: 30_000,
        message: 'surviving dependent z was not flagged ready after deletion'
      })
      .toContain(zId);
    expect(await cellChildrenIncludes(page, 0, 1)).toBe(true);

    await settleAutosave(page);
  });

  test('editing a cell to drop a dependency breaks the chain, and re-adding it re-establishes the chain', async ({
    page
  }) => {
    // y depends on x. Run in place (Control+Enter) so the last-cell run does not
    // advance + insert a trailing cell.
    await openIpyflowNotebook(page, ['x = 1', 'y = x + 1']);
    await page.notebook.runCell(0, true);
    await page.notebook.runCell(1, true);
    await waitForEdge(page, 0, 1);

    // Edit y so it no longer references x, then re-run: the x -> y edge is
    // dropped, and re-running x no longer flags y as ready.
    await setCellSource(page, 1, 'y = 100');
    expect(await cellSource(page, 1)).toBe('y = 100');
    await page.notebook.runCell(1, true);
    await waitForEdge(page, 0, 1, false);

    await setCellSource(page, 0, 'x = 5');
    expect(await cellSource(page, 0)).toBe('x = 5');
    await page.notebook.runCell(0, true);
    // Give a schedule a chance to (incorrectly) flag y before asserting it
    // stayed put: the edge is gone, so y is independent of x now.
    await page.waitForTimeout(2000);
    const yId = await cellModelId(page, 1);
    expect(await readyAndWaitingCells(page)).not.toContain(yId);
    expect(await cellChildrenIncludes(page, 0, 1)).toBe(false);

    // Re-edit y to reference x again and re-run: the x -> y edge re-forms, and
    // re-running x once more flags the re-linked y as ready.
    await setCellSource(page, 1, 'y = x + 1');
    expect(await cellSource(page, 1)).toBe('y = x + 1');
    await page.notebook.runCell(1, true);
    await waitForEdge(page, 0, 1);

    await setCellSource(page, 0, 'x = 9');
    expect(await cellSource(page, 0)).toBe('x = 9');
    await page.notebook.runCell(0, true);
    await expect
      .poll(() => readyAndWaitingCells(page), {
        timeout: 30_000,
        message: 're-linked dependent y was not flagged ready after re-adding x'
      })
      .toContain(yId);

    await settleAutosave(page);
  });

  test('two ipyflow notebooks keep independent dependency graphs', async ({
    page
  }) => {
    const nameA = await openIpyflowNotebook(page, ['x = 1', 'y = x + 1']);
    await page.notebook.runCell(0);
    await page.notebook.runCell(1);
    await waitForEdge(page, 0, 1);

    const nameB = await openIpyflowNotebook(page, ['a = 1', 'b = a + 1']);
    await page.notebook.runCell(0);
    await page.notebook.runCell(1);
    await waitForEdge(page, 0, 1);

    // B is foreground: the debug store points at B's notebook + graph.
    expect(await cellSource(page, 0)).toBe('a = 1');
    expect(await cellChildrenIncludes(page, 0, 1)).toBe(true);

    // Switch to A: the store repoints (setupComm's currentChanged) and A's own
    // graph is intact.
    await page.notebook.activate(nameA);
    await expect
      .poll(() => cellSource(page, 0), {
        timeout: 30_000,
        message: 'activating notebook A did not repoint the ipyflow store'
      })
      .toBe('x = 1');
    expect(await cellChildrenIncludes(page, 0, 1)).toBe(true);

    // ...and back to B.
    await page.notebook.activate(nameB);
    await expect
      .poll(() => cellSource(page, 0), { timeout: 30_000 })
      .toBe('a = 1');
    expect(await cellChildrenIncludes(page, 0, 1)).toBe(true);

    await settleAutosave(page);
  });

  test('a cell run before the comm establishes still executes', async ({
    page
  }) => {
    // Don't wait for the comm. The per-session store/notebook are wired at
    // session.ready (before the establish round-trip), so there is a window in
    // which a run is deferred (shown as [*]) and flushed once connected. This
    // exercises that path opportunistically -- whether or not we land inside the
    // window, the cell must end up executed.
    await page.notebook.createNew(undefined, { kernel: 'ipyflow' });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => ((window as any).ipyflow?.notebook?.widgets?.length ?? 0) > 0
          ),
        { timeout: 30_000, message: 'ipyflow store/notebook never wired up' }
      )
      .toBe(true);

    await setCellSource(page, 0, 'print(6 * 7)');
    await page.notebook.selectCells(0);
    await page.keyboard.press('Control+Enter');

    await waitForComm(page);
    await expect
      .poll(() => cellOutputText(page, 0), {
        timeout: 30_000,
        message: 'a cell run at startup never executed'
      })
      .toContain('42');

    await settleAutosave(page);
  });
});
