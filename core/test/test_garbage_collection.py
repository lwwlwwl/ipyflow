# -*- coding: utf-8 -*-
"""Checks that ipyflow's after-cell garbage collection releases objects that only its
records still hold, without losing dependencies."""
import gc
import logging

from ipyflow.singletons import flow

from .utils import assert_bool, make_flow_fixture

logging.basicConfig(level=logging.ERROR)

_flow_fixture, run_cell = make_flow_fixture()


def assert_detected(msg=""):
    assert_bool(flow().test_and_clear_waiter_usage_detected(), msg=msg)


def assert_not_detected(msg=""):
    assert_bool(not flow().test_and_clear_waiter_usage_detected(), msg=msg)


def live_count(type_name):
    gc.collect()
    return sum(type(o).__name__ == type_name for o in gc.get_objects())


def test_locals_of_earlier_calls_are_released():
    run_cell(
        """
        class Payload:
            pass

        def make():
            local = Payload()
            inner = [Payload(), Payload()]
            return len(inner)
        """
    )
    for _ in range(5):
        run_cell("n = make()", cell_id="call")
        run_cell("m = make()", cell_id="other")
    # only the newest call's locals may still be held
    assert live_count("Payload") <= 3, live_count("Payload")


def test_enumerate_loop_namespace_is_released():
    run_cell("class Payload:\n    pass")
    counts = []
    for _ in range(3):
        for _ in range(4):
            run_cell(
                "items = [Payload() for _ in range(3)]\n"
                "for i, p in enumerate(items):\n"
                "    pass\n"
                "items = None\n"
                "p = None",
                cell_id="loop",
            )
        counts.append(live_count("Payload"))
    # unnamed records of a cell's run are collected when that cell runs again,
    # so at most the last two runs' objects remain
    assert counts[0] == counts[-1] <= 6, counts


def test_object_still_named_by_a_global_is_kept():
    run_cell(
        """
        class Payload:
            def __init__(self):
                self.v = 1

        def make():
            local = Payload()
            return local
        """
    )
    run_cell("keep = make()")
    run_cell("make()")
    run_cell("make()")
    sym = flow().global_scope.lookup_symbol_by_qualified_name("keep.v")
    assert sym is not None and sym.obj == 1


def test_closure_still_works_after_later_calls():
    run_cell(
        """
        def outer(k):
            base = k
            def inner():
                return base + 1
            return inner
        """
    )
    run_cell("f = outer(1)")
    run_cell("g = outer(2)")
    run_cell("h = outer(3)")
    run_cell("r = f()")
    run_cell("assert r == 2")


def test_dependency_through_a_local_survives_collection():
    run_cell("x = 5")
    run_cell(
        """
        def copy_of_x():
            t = x
            return t
        """
    )
    run_cell("y = copy_of_x()")
    run_cell("z = copy_of_x()")
    run_cell("w = copy_of_x()")
    run_cell("x = 9")
    run_cell("logging.info(y)")
    assert_detected("`y` depends on stale `x` through a function call")


def test_replaced_object_with_attribute_records_is_released():
    run_cell("class Payload:\n    pass")
    for _ in range(5):
        run_cell("x = Payload()\nx.v = [1, 2]\nx.v.append(3)", cell_id="make")
        run_cell("y = x.v[0]", cell_id="read")
    # only the object x names now is alive; earlier ones were held only by ipyflow
    cls = type(flow().global_scope.lookup_symbol_by_name("x").obj)
    gc.collect()
    alive = sum(type(o) is cls for o in gc.get_objects())
    assert alive == 1, alive
    run_cell("x.v.append(4)")
    run_cell("logging.info(y)")
    assert_detected("`y` depends on `x.v`, changed in place")
