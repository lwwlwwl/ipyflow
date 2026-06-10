/**
 * Playwright/Galata configuration for the ipyflow extension UI tests.
 *
 * Extends Galata's base config and launches a JupyterLab instance (via the
 * `start` script) that must already have the built `jupyterlab-ipyflow`
 * extension and the `ipyflow` kernel installed (see ../../../Makefile `dev`).
 *
 * The test server runs on a dedicated port (8899 by default) instead of 8888 so
 * it never collides with a JupyterLab the developer already has running.
 * Override with IPYFLOW_UITEST_PORT (kept in sync with jupyter_server_test_config.py).
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

const PORT = process.env.IPYFLOW_UITEST_PORT || '8899';
const baseURL = `http://localhost:${PORT}`;

module.exports = {
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL
  },
  webServer: {
    command: 'jupyter lab --config jupyter_server_test_config.py',
    url: `${baseURL}/lab`,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  },
  retries: process.env.CI ? 1 : 0
};
