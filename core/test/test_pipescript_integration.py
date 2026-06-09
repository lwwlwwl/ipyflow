# -*- coding: utf-8 -*-
"""
Basic integration tests for loading the pipescript extension inside ipyflow.

These cover that ``%load_ext pipescript`` works under ``IPyflowInteractiveShell``
(including pipescript's extension initialization, which registers its builtin
dynamic macros) and that basic pipe syntax evaluates correctly. Advanced
pipescript features (e.g. ``$`` placeholders, which induce traced lambdas whose
synthetic line numbers ipyflow's dataflow tracer cannot map) are intentionally
out of scope.
"""

import sys
from test.utils import make_flow_fixture

import pytest

from ipyflow.data_model.cell import Cell
from ipyflow.singletons import shell

# pipescript is an optional test dependency and requires Python >= 3.9.
pytest.importorskip("pipescript")
pytestmark = pytest.mark.skipif(
    sys.version_info < (3, 9), reason="pipescript requires Python >= 3.9"
)


def _load_pipescript():
    # Load pipescript, threading our ``run_cell`` so the extension's deferred
    # builtin-dynamic-macro loading runs the macro-definition cells through it
    # (rather than the default ``shell.run_cell``). Our ``run_cell`` keeps
    # store_history False and pins execution_count so it stays in sync with
    # ipyflow's cell counter the way a real frontend would -- otherwise the macros
    # fail to expand. The ``pass`` cell fires the deferred post_run_cell hook (and
    # warms up the just-registered tracers). Loaded once -- the extension's
    # tracers persist on the shell across the per-test flow/tracer reset.
    if "pipescript" not in shell().extension_manager.loaded:
        import pipescript

        pipescript.load_ipython_extension_ipyflow(shell(), run_cell=run_cell_)
        run_cell_("pass")
        shell().extension_manager.loaded.add("pipescript")
    yield


# Reset dependency graph and ensure pipescript is loaded before each test
_flow_fixture, run_cell_ = make_flow_fixture(extra_fixture=_load_pipescript)


def run_cell(cell, **kwargs):
    run_cell_(cell, **kwargs)


def result():
    return shell().user_ns["result"]


def test_load_ext_pipescript():
    registered = {tracer.__name__ for tracer in shell().registered_tracers}
    assert "PipelineTracer" in registered, "got %s" % registered


# ---------------------------------------------------------------------------
# Forward / backward piping (``|>`` and ``<|``)
# ---------------------------------------------------------------------------


def test_basic_pipe():
    run_cell("result = (3, 4, 1, 5, 6) |> sorted |> tuple")
    assert result() == (1, 3, 4, 5, 6)


def test_backward_pipe():
    # ``<|`` is the low-precedence backward variant of ``|>``.
    run_cell("result = reversed .> list <| [1, 2, 3]")
    assert result() == [3, 2, 1]


def test_backward_varargs_pipe():
    # ``f <|* x`` is the backward variant of ``x *|> f`` -- i.e. ``f(*x)``.
    run_cell("result = (lambda a, b: a + b) <|* (2, 3)")
    assert result() == 5


def test_backward_kwargs_pipe():
    # ``f <|** x`` is the backward variant of ``x **|> f`` -- i.e. ``f(**x)``.
    run_cell("result = (lambda a, b: a + b) <|** {'a': 2, 'b': 3}")
    assert result() == 5


# ---------------------------------------------------------------------------
# Function composition pipes (``.>``, ``*.>``, ``**.>``)
# ---------------------------------------------------------------------------


def test_function_pipe():
    run_cell("reverse = reversed .> list")
    run_cell("result = [1, 2, 3] |> reverse")
    assert result() == [3, 2, 1]


def test_function_pipe_chained():
    run_cell("pipeline = sorted .> reversed .> list")
    run_cell("result = [3, 1, 2] |> pipeline")
    assert result() == [3, 2, 1]


def test_star_function_pipe():
    # ``*.>`` unpacks the tuple returned by the first function before applying
    # the second.
    run_cell("split_sum = (lambda x: (x, x + 1)) *.> (lambda a, b: a + b)")
    run_cell("result = split_sum(10)")
    assert result() == 21


def test_kwstar_function_pipe():
    # ``**.>`` unpacks the dict returned by the first function as keyword args.
    run_cell("h = (lambda x: {'a': x, 'b': x + 1}) **.> (lambda a, b: a + b)")
    run_cell("result = h(10)")
    assert result() == 21


# ---------------------------------------------------------------------------
# Partial-application pipes (``$>``, ``*$>``, ``**$>``)
# ---------------------------------------------------------------------------


def test_partial_pipe():
    # ``x $> f`` is ``functools.partial(f, x)``.
    run_cell("g = 2 $> pow")
    run_cell("result = g(10)")
    assert result() == 1024


def test_partial_pipe_varargs():
    # ``x *$> f`` is ``functools.partial(f, *x)``.
    run_cell("g = (2, 10) *$> pow")
    run_cell("result = g()")
    assert result() == 1024


def test_partial_pipe_kwargs():
    # ``x **$> f`` is ``functools.partial(f, **x)``.
    run_cell("g = {'base': 2, 'exp': 10} **$> (lambda base, exp: base ** exp)")
    run_cell("result = g()")
    assert result() == 1024


# ---------------------------------------------------------------------------
# Argument-unpacking pipes (``**|>``)
# ---------------------------------------------------------------------------


def test_kwargs_pipe():
    # ``x **|> f`` is ``f(**x)`` when ``x`` is a dict.
    run_cell("result = {'base': 2, 'exp': 10} **|> (lambda base, exp: base ** exp)")
    assert result() == 1024


# ---------------------------------------------------------------------------
# Null-aware pipes (``?>``, ``*?>``, ``**?>``)
# ---------------------------------------------------------------------------


def test_optional_pipe_none_short_circuits():
    # ``None ?> f`` evaluates to ``None`` without ever calling ``f``.
    run_cell("result = None ?> sorted")
    assert result() is None


def test_optional_pipe_non_none():
    run_cell("result = [3, 1, 2] ?> sorted")
    assert result() == [1, 2, 3]


def test_varargs_optional_pipe_none():
    run_cell("result = None *?> (lambda a, b: a + b)")
    assert result() is None


def test_kwargs_optional_pipe_none():
    run_cell("result = None **?> (lambda a, b: a + b)")
    assert result() is None


# ---------------------------------------------------------------------------
# Optional / permissive attribute chaining and nullish coalescing
# ---------------------------------------------------------------------------


def test_optional_chaining_none():
    run_cell("a = None")
    run_cell("result = a?.b.c")
    assert result() is None


def test_optional_chaining_present():
    run_cell("result = 'hello'?.upper()")
    assert result() == "HELLO"


def test_permissive_attr_missing():
    # ``a.?b`` is ``getattr(a, "b", None)``.
    run_cell("obj = object()")
    run_cell("result = obj.?nonexistent")
    assert result() is None


def test_permissive_attr_present():
    run_cell("result = 'hello' .?upper")
    run_cell("result = result()")
    assert result() == "HELLO"


def test_nullish_coalescing_falsey_left():
    # ``??`` only falls through on ``None`` -- other falsey values pass through.
    run_cell("result = 0 ?? 42")
    assert result() == 0


def test_nullish_coalescing_none_left():
    run_cell("result = None ?? 42")
    assert result() == 42


def test_nullish_coalescing_is_lazy():
    run_cell("calls = []")
    run_cell("def rhs():\n    calls.append(1)\n    return 99")
    run_cell("result = 5 ?? rhs()")
    assert result() == 5
    assert shell().user_ns["calls"] == []


# ---------------------------------------------------------------------------
# Quick-lambda macro (``f[...]``)
# ---------------------------------------------------------------------------


def test_quick_lambda():
    run_cell("result = f[$ + $](2, 3)")
    assert result() == 5


def test_quick_lambda_named_placeholders():
    run_cell("result = f[$a*$b + $b*$c + $a*$c](2, 3, 4)")
    assert result() == 26


# ---------------------------------------------------------------------------
# Placeholder liveness
#
# pipescript rewrites its ``$`` / ``$$`` placeholders to ``_`` (and ``$foo`` to
# ``_foo``) in the cell source. These synthetic names must not be picked up by
# ipyflow's liveness analyzer as references to the IPython ``_`` (last-expr)
# symbol, or every placeholder cell would spuriously depend on whatever the
# previous cell evaluated to. We assert liveness statically (no execution, so
# the dataflow tracer's synthetic lambda line numbers are not involved).
# ---------------------------------------------------------------------------


def _live_ref_strs(code):
    cell = Cell.create_and_track(object(), code, (), bump_cell_counter=False)
    live, *_ = cell._get_live_dead_modified_symbol_refs(False)
    return {str(ref.ref) for ref in live}


@pytest.mark.parametrize(
    "code",
    [
        "reverse_sorter = sorted($, reverse=True)",
        "sorter = sorted($, reverse=$)",
        "result = lst |> sorted($, reverse=True)",
        "result = lst |> $.index(3)",
        "result = data |> np.max($, initial=1.0)",
        "result = 42 |> $ + 1",
        "result = f[$ + $](2, 3)",
        "result = f[$a*$b](2, 3)",
    ],
)
def test_placeholder_not_live(code):
    # ``_`` (and named placeholders like ``_a``) should never appear as live.
    assert not any(
        ref == "('_',)" or ref.startswith("('_'") or ref.startswith("('_a'")
        for ref in _live_ref_strs(code)
    ), _live_ref_strs(code)


def test_real_refs_preserved_alongside_placeholders():
    # the placeholder is dropped, but genuine references in the same cell remain.
    live = _live_ref_strs("result = lst |> sorted($, key=mykey)")
    assert "('lst',)" in live
    assert "('mykey',)" in live
    assert "('_',)" not in live


def test_placeholder_not_live_after_marks_discarded():
    # pipescript discards a node's pyccolo augmentation marks once it rewrites
    # the placeholder during execution. ipyflow latches the placeholder status
    # when it first builds the cell AST, so the ``_`` must stay excluded from
    # liveness even after the marks are gone -- otherwise the spurious dependency
    # on the previous cell's ``_`` reappears on subsequent frontend re-checks.
    import pyccolo as pyc

    cell = Cell.create_and_track(
        object(),
        "reverse_sorter = sorted($, reverse=True)",
        (),
        bump_cell_counter=False,
    )
    live_before, *_ = cell._get_live_dead_modified_symbol_refs(False)
    assert not any(str(r.ref).startswith("('_'") for r in live_before)
    # simulate pipescript clearing the augmentation marks post-rewrite
    for ids in pyc.BaseTracer.augmented_node_ids_by_spec.values():
        ids.clear()
    live_after, *_ = cell._get_live_dead_modified_symbol_refs(False)
    assert not any(str(r.ref).startswith("('_'") for r in live_after), {
        str(r.ref) for r in live_after
    }


def test_placeholder_not_live_after_intervening_executions():
    # the "takes a few executions" scenario: executing other placeholder cells
    # churns pyccolo's process-wide augmentation bookkeeping, but a freshly
    # built placeholder cell must still exclude ``_`` from liveness.
    run_cell("result = f[$ + $](2, 3)")
    run_cell("x = 5")
    run_cell("result = f[$a*$b + $b*$c + $a*$c](2, 3, 4)")
    cell = Cell.create_and_track(
        object(), "result = 42 |> $ + 1", (), bump_cell_counter=False
    )
    live, *_ = cell._get_live_dead_modified_symbol_refs(False)
    assert not any(str(r.ref).startswith("('_'") for r in live), {
        str(r.ref) for r in live
    }
