# ipyflow extension UI / end-to-end tests

[Galata](https://github.com/jupyterlab/jupyterlab/tree/main/galata) + Playwright
tests that launch a real JupyterLab against the **ipyflow** kernel and exercise
the extension's UI behavior (comm establishment, dependency-aware cell
decoration, reactive re-execution).

## Prerequisites

The built extension and the ipyflow kernel must be installed in the active
environment. From the repo root:

```bash
make dev          # builds the labextension, symlinks it, installs the kernel
```

Verify:

```bash
jupyter labextension list   # jupyterlab-ipyflow ... enabled OK
jupyter kernelspec list     # ipyflow
```

## Running

```bash
cd frontend/labextension/ui-tests
jlpm install
jlpm playwright install chromium   # first time only
jlpm test                          # or: make uitest (from repo root)
```

Useful variants:

```bash
jlpm playwright test --headed   # watch the browser drive JupyterLab
jlpm test:debug                 # Playwright inspector
jlpm test:report                # open the last HTML report
```

Playwright launches its own JupyterLab via `jupyter_server_test_config.py` on a
dedicated port (**8899** by default, override with `IPYFLOW_UITEST_PORT`) so it
never collides with a JupyterLab you already have running on :8888. No manually
running server is required.
