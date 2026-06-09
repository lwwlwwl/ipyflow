#!/usr/bin/env bash

set -e

# ref: https://github.com/ipython/ipython/issues/9752

if [ "$1" == "ui" ]; then
    # Galata + Playwright end-to-end tests. Requires the built extension and the
    # ipyflow kernel to be installed in the active env (see `make dev`).
    pushd ./frontend/labextension/ui-tests
    npm install
    npm run install-browser
    npm test
    popd
else
    pushd core
    #env PYTHONPATH="." PYCCOLO_DEV_MODE="1" ipython3 --quick --no-banner --quiet --colors=NoColor --simple-prompt ../scripts/test_runner.py -- $@
    env PYTHONPATH="." PYCCOLO_DEV_MODE="1" python ../scripts/test_runner.py $@
    popd
fi
