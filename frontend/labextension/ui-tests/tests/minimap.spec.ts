import { expect, test } from '@jupyterlab/galata';

import {
  attachNotebookDumpOnFailure,
  minimapClassList,
  openIpyflowNotebook,
  settleAutosave,
  waitForEdge,
  waitForMinimapClass
} from './helpers';

/**
 * End-to-end coverage of ipyflow's minimap color-coding (ui/decorations.ts).
 *
 * The "minimap" is the windowed-scrollbar overview down the right edge of the
 * notebook -- one `li.jp-WindowedPanel-scrollbar-item` per cell, in order. When
 * a cell is selected, ipyflow paints those items with the same slice classes it
 * puts on the cells: the forward execute-slice gets `ipyflow-slice-execute` and
 * the backward dependency slice gets `ipyflow-slice` (style/index.module.css
 * colors them ready-making / waiting respectively). The selected (active) cell's
 * own minimap item is left uncolored.
 *
 * Because the minimap lives in each notebook's own DOM and ipyflow only repaints
 * the foreground notebook (updateUI no-ops otherwise, and a tab switch repoints
 * the store + re-runs the schedule), the minimap of whichever tab is active must
 * reflect *that* notebook's dependency graph -- which is what the multi-tab test
 * pins down.
 */
test.describe('ipyflow minimap', () => {
  attachNotebookDumpOnFailure(test);

  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test('color-codes the selected cell forward execute-slice on the minimap', async ({
    page
  }) => {
    // x -> y -> z chain plus an independent w.
    await openIpyflowNotebook(page, [
      'x = 1',
      'y = x + 1',
      'z = y + 1',
      'w = 10'
    ]);
    for (let i = 0; i < 4; i++) {
      await page.notebook.runCell(i, true);
    }
    await waitForEdge(page, 0, 1);
    await waitForEdge(page, 1, 2);

    // Selecting the root x makes the whole chain {x, y, z} its forward
    // execute-slice. On the minimap the downstream items y, z light up
    // `ipyflow-slice-execute`; the active item (x) is left uncolored, and the
    // independent w is untouched.
    await page.notebook.selectCells(0);
    await waitForMinimapClass(page, 1, 'ipyflow-slice-execute');
    await waitForMinimapClass(page, 2, 'ipyflow-slice-execute');
    expect(await minimapClassList(page, 0)).not.toContain(
      'ipyflow-slice-execute'
    );
    expect(await minimapClassList(page, 3)).not.toContain(
      'ipyflow-slice-execute'
    );
    expect(await minimapClassList(page, 3)).not.toContain('ipyflow-slice');

    // Selecting the leaf z instead: its forward slice is just {z}, while its
    // ancestors {x, y} become the backward dependency slice -> `ipyflow-slice`
    // on the minimap. The active item (z) is uncolored.
    await page.notebook.selectCells(2);
    await waitForMinimapClass(page, 0, 'ipyflow-slice');
    await waitForMinimapClass(page, 1, 'ipyflow-slice');
    expect(await minimapClassList(page, 0)).not.toContain(
      'ipyflow-slice-execute'
    );
    expect(await minimapClassList(page, 2)).not.toContain('ipyflow-slice');
    expect(await minimapClassList(page, 2)).not.toContain(
      'ipyflow-slice-execute'
    );

    await settleAutosave(page);
  });

  test('minimap colors track the active notebook tab', async ({ page }) => {
    // Notebook A: x -> y -> z. Selecting the root x paints its forward
    // execute-slice -> minimap items 1, 2 get `ipyflow-slice-execute`.
    const nameA = await openIpyflowNotebook(page, [
      'x = 1',
      'y = x + 1',
      'z = y + 1'
    ]);
    for (let i = 0; i < 3; i++) {
      await page.notebook.runCell(i, true);
    }
    await waitForEdge(page, 0, 1);
    await waitForEdge(page, 1, 2);
    await page.notebook.selectCells(0);
    await waitForMinimapClass(page, 1, 'ipyflow-slice-execute');
    await waitForMinimapClass(page, 2, 'ipyflow-slice-execute');

    // Notebook B (new tab): p -> q -> r. Selecting the *leaf* r paints the
    // backward dependency slice instead -> minimap items 0, 1 get
    // `ipyflow-slice` (NOT slice-execute), and at a different position than A.
    const nameB = await openIpyflowNotebook(page, [
      'p = 1',
      'q = p + 1',
      'r = q + 1'
    ]);
    for (let i = 0; i < 3; i++) {
      await page.notebook.runCell(i, true);
    }
    await waitForEdge(page, 0, 1);
    await waitForEdge(page, 1, 2);
    await page.notebook.selectCells(2);

    // Foreground is B: the minimap reflects B's own slice...
    await waitForMinimapClass(page, 0, 'ipyflow-slice');
    await waitForMinimapClass(page, 1, 'ipyflow-slice');
    expect(await minimapClassList(page, 0)).not.toContain(
      'ipyflow-slice-execute'
    );
    expect(await minimapClassList(page, 2)).not.toContain('ipyflow-slice');

    // Switch to A: the store repoints (currentChanged -> recompute schedule ->
    // updateUI), and the foreground minimap is now A's -- items 1, 2 colored
    // `ipyflow-slice-execute`, item 0 (the active root) uncolored.
    await page.notebook.activate(nameA);
    await page.notebook.selectCells(0);
    await waitForMinimapClass(page, 1, 'ipyflow-slice-execute');
    await waitForMinimapClass(page, 2, 'ipyflow-slice-execute');
    expect(await minimapClassList(page, 0)).not.toContain(
      'ipyflow-slice-execute'
    );
    // A never paints `ipyflow-slice` here, so B's coloring did not bleed over.
    expect(await minimapClassList(page, 0)).not.toContain('ipyflow-slice');

    // ...and back to B: the minimap returns to B's slice shape.
    await page.notebook.activate(nameB);
    await page.notebook.selectCells(2);
    await waitForMinimapClass(page, 0, 'ipyflow-slice');
    await waitForMinimapClass(page, 1, 'ipyflow-slice');
    expect(await minimapClassList(page, 1)).not.toContain(
      'ipyflow-slice-execute'
    );

    await settleAutosave(page);
  });
});
