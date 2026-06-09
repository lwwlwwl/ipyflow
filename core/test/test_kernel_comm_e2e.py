# -*- coding: utf-8 -*-
"""
Headless end-to-end test of the ipyflow kernel <-> frontend comm protocol.

This starts a *real* ipyflow kernel subprocess via jupyter_client and drives the
``ipyflow`` comm exactly the way the JupyterLab extension does (execute_request
with a ``cellId`` in the message metadata, then ``compute_exec_schedule`` comm
messages), asserting on the dependency graph the kernel sends back. No browser is
involved -- this guards the kernel side of the contract the TypeScript frontend
depends on (see frontend/labextension/src/comm/).

It is gated behind the ``IPYFLOW_KERNEL_E2E`` env var (and marked ``integration``)
so the default in-process pytest matrix -- which pre-initializes a shared
IPyflowInteractiveShell -- is left untouched and fast. Run it with::

    IPYFLOW_KERNEL_E2E=1 pytest core/test/test_kernel_comm_e2e.py
    # or:  make e2e
"""
import os
import time
import uuid
from queue import Empty

import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("IPYFLOW_KERNEL_E2E"),
        reason="set IPYFLOW_KERNEL_E2E=1 to run the kernel comm e2e test "
        "(starts a real ipyflow kernel subprocess)",
    ),
]

KERNEL_NAME = "ipyflow"
# The kernel registers its comm target under the package name 'ipyflow'
# (comm_manager.register_comm_target -> register_target(__package__, ...)).
COMM_TARGET = "ipyflow"
TIMEOUT = 60


@pytest.fixture
def kc():
    from jupyter_client.manager import start_new_kernel

    km, client = start_new_kernel(kernel_name=KERNEL_NAME, startup_timeout=TIMEOUT)
    try:
        yield client
    finally:
        client.stop_channels()
        km.shutdown_kernel(now=True)


def _send(client, msg_type, content, metadata=None):
    msg = client.session.msg(msg_type, content)
    if metadata is not None:
        msg["metadata"] = metadata
    client.shell_channel.send(msg)
    return msg["header"]["msg_id"]


def _execute(client, code, cell_id):
    """Mirror a JupyterLab cell run: execute_request carrying metadata.cellId."""
    msg_id = _send(
        client,
        "execute_request",
        dict(
            code=code,
            silent=False,
            store_history=True,
            user_expressions={},
            allow_stdin=False,
            stop_on_error=True,
        ),
        metadata={"cellId": cell_id},
    )
    _wait_for_shell_reply(client, msg_id, "execute_reply")
    return msg_id


def _comm_open(client, comm_id, target, data):
    return _send(
        client, "comm_open", dict(comm_id=comm_id, target_name=target, data=data)
    )


def _comm_msg(client, comm_id, data):
    return _send(client, "comm_msg", dict(comm_id=comm_id, data=data))


def _wait_for_shell_reply(client, parent_msg_id, msg_type, timeout=TIMEOUT):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            reply = client.get_shell_msg(timeout=1)
        except Empty:
            continue
        if (
            reply["msg_type"] == msg_type
            and reply["parent_header"].get("msg_id") == parent_msg_id
        ):
            return reply
    raise AssertionError(f"timed out waiting for {msg_type}")


def _wait_for_comm_payload(client, comm_id, predicate, timeout=TIMEOUT):
    """Drain iopub until a comm_msg on `comm_id` whose payload matches `predicate`."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            msg = client.get_iopub_msg(timeout=1)
        except Empty:
            continue
        if msg["msg_type"] != "comm_msg":
            continue
        if msg["content"].get("comm_id") != comm_id:
            continue
        payload = msg["content"].get("data", {})
        if predicate(payload):
            return payload
    raise AssertionError("timed out waiting for matching comm payload")


def test_ipyflow_comm_dependency_graph(kc):
    cell1 = "c1-" + uuid.uuid4().hex[:8]
    cell2 = "c2-" + uuid.uuid4().hex[:8]
    comm_id = "ipyflow-e2e-" + uuid.uuid4().hex[:8]

    # 1. Open the ipyflow comm the way the frontend does; the kernel's comm
    #    target responds with an `establish` message on the same comm.
    _comm_open(
        kc,
        comm_id,
        COMM_TARGET,
        {
            "interface": "jupyterlab",
            "cell_metadata_by_id": {},
            "cell_parents": {},
            "cell_children": {},
        },
    )
    establish = _wait_for_comm_payload(
        kc, comm_id, lambda d: d.get("type") == "establish"
    )
    assert establish.get("success") is True

    # 2. Run two dependent cells (cell2 reads x defined by cell1).
    _execute(kc, "x = 1", cell1)
    _execute(kc, "y = x + 1", cell2)

    cell_metadata = {
        cell1: {"index": 0, "content": "x = 1", "type": "code"},
        cell2: {"index": 1, "content": "y = x + 1", "type": "code"},
    }

    # 3. Ask for the execution schedule and assert the dependency edge cell1->cell2.
    _comm_msg(
        kc,
        comm_id,
        {
            "type": "compute_exec_schedule",
            "executed_cell_id": cell2,
            "cell_metadata_by_id": cell_metadata,
            "is_reactively_executing": False,
        },
    )
    sched = _wait_for_comm_payload(
        kc, comm_id, lambda d: d.get("type") == "compute_exec_schedule"
    )
    assert sched.get("success", True), sched
    assert cell2 in sched.get("cell_children", {}).get(cell1, []), sched.get(
        "cell_children"
    )
    assert cell1 in sched.get("cell_parents", {}).get(cell2, []), sched.get(
        "cell_parents"
    )

    # 4. Re-run cell1 with a new value for x. cell2 was computed from the old x,
    #    so ipyflow should now flag it as ready to re-execute.
    cell_metadata[cell1]["content"] = "x = 2"
    _execute(kc, "x = 2", cell1)
    _comm_msg(
        kc,
        comm_id,
        {
            "type": "compute_exec_schedule",
            "executed_cell_id": cell1,
            "cell_metadata_by_id": cell_metadata,
            "is_reactively_executing": False,
            "allow_new_ready": True,
        },
    )
    sched2 = _wait_for_comm_payload(
        kc, comm_id, lambda d: d.get("type") == "compute_exec_schedule"
    )
    ready_or_waiting = set(sched2.get("ready_cells", [])) | set(
        sched2.get("waiting_cells", [])
    )
    assert cell2 in ready_or_waiting, sched2
