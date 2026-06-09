# Configuration file for the JupyterLab instance that backs the Galata UI tests.
from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)  # noqa: F821 (c is injected by traitlets)

# New notebooks default to the ipyflow kernel; the tests also open notebooks
# whose metadata pins the `ipyflow` kernelspec explicitly.
c.MultiKernelManager.default_kernel_name = "ipyflow"  # noqa: F821
