# -*- coding: utf-8 -*-
.PHONY: clean black blackcheck eslint imports build deploy_only deploy check check_no_typing test tests deps devdeps dev typecheck version bump extlink kernel uitest uitest-report e2e

# Prefer uv if available, otherwise fall back to pip. Override with `make <t> PIP=...`.
ifeq ($(shell command -v uv 2>/dev/null),)
PIP := python -m pip
else
PIP := uv pip
endif

clean:
	rm -rf __pycache__ core/__pycache__ build/ core/build/ core/dist/ dist/ ipyflow.egg-info/ core/ipyflow_core.egg-info core/ipyflow/resources/labextension

build: clean
	./scripts/build.sh

version:
	./scripts/build-version.py

bump:
	./scripts/bump.sh

deploy_only:
	./scripts/deploy-all.sh

deploy: version build deploy_only

black:
	isort ./core
	./scripts/blacken.sh

blackcheck:
	isort ./core --check-only
	./scripts/blacken.sh --check

lint:
	ruff check ./core

imports:
	pycln ./core
	isort ./core

typecheck:
	./scripts/typecheck.sh

# this is the one used for CI, since sometimes we want to skip typcheck
check_no_typing:
	./scripts/runtests.sh

coverage:
	rm -f .coverage
	rm -rf htmlcov
	./scripts/runtests.sh --coverage
	mv core/.coverage .
	coverage html
	coverage report

xmlcov: coverage
	coverage xml

eslint:
	./scripts/eslint.sh

check: eslint blackcheck lint typecheck check_no_typing

test: check
tests: check

deps:
	$(PIP) install -r requirements.txt

devdeps:
	$(PIP) install -e .
	$(PIP) install -e .[dev]
	# reinstall ipyflow-core editable last: installing the root pins it to the
	# released version on PyPI, which would otherwise clobber the local checkout
	$(PIP) install -e ./core[dev]

extlink:
	./scripts/extlink.sh

kernel:
	python -m ipyflow.install --sys-prefix

dev: devdeps build extlink kernel

# Galata/Playwright UI end-to-end tests (launches JupyterLab in a browser).
uitest:
	./scripts/runtests.sh ui

# Open the HTML report from the last `make uitest` run (served on localhost).
uitest-report:
	cd frontend/labextension/ui-tests && npm run test:report

# Headless kernel comm-protocol end-to-end test (starts a real ipyflow kernel).
e2e:
	cd core && IPYFLOW_KERNEL_E2E=1 python -m pytest test/test_kernel_comm_e2e.py -v
