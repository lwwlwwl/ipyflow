/**
 * Playwright/Galata configuration for the ipyflow extension UI tests.
 *
 * Extends Galata's base config and launches a JupyterLab instance (via the
 * `start` script) that must already have the built `jupyterlab-ipyflow`
 * extension and the `ipyflow` kernel installed (see ../../../Makefile `dev`).
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  webServer: {
    command: 'jupyter lab --config jupyter_server_test_config.py',
    url: 'http://localhost:8888/lab',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  },
  retries: process.env.CI ? 1 : 0
};
