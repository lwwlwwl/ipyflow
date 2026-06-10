# Configuration file for the JupyterLab instance that backs the Galata UI tests.
import os

from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)  # noqa: F821 (c is injected by traitlets)

# Run on a dedicated port rather than the default 8888 so the test server never
# collides with a JupyterLab the developer already has running locally (which
# would otherwise be reused by Playwright and block on its auth page). Keep this
# in sync with IPYFLOW_UITEST_PORT in playwright.config.js.
c.ServerApp.port = int(os.environ.get("IPYFLOW_UITEST_PORT", "8899"))  # noqa: F821

# New notebooks default to the ipyflow kernel; the tests also create notebooks
# with the `ipyflow` kernel explicitly.
c.MultiKernelManager.default_kernel_name = "ipyflow"  # noqa: F821
