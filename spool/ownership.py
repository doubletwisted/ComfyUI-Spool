"""Exclusive process-lifetime dispatch ownership; the database heartbeat is informational."""

import os
import errno
import hashlib
import socket
from pathlib import Path
import time
from contextlib import contextmanager

from .store import Conflict
from .durable import atomic_replace as atomic_replace

if os.name == "nt":
    import msvcrt
else:
    import fcntl


def executor_identity(root):
    """A host/workspace identity that survives process restarts, without shared-project state."""
    address = socket.gethostname().casefold() + "\n" + os.path.normcase(str(Path(root).resolve()))
    return "workspace:" + hashlib.sha256(address.encode()).hexdigest() + ":"


class ExecutorBusy(RuntimeError):
    pass


class ExecutorLock:
    def __init__(self, root):
        self.path = Path(root) / "executor.lock"
        self.handle = None

    def acquire(self):
        handle = self.path.open("a+b")
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            handle.close()
            if error.errno in (errno.EACCES, errno.EAGAIN) or getattr(error, "winerror", None) in (32, 33):
                raise ExecutorBusy(
                    "Another Comfy process owns this Spool store. Use its paired host or a separate test store."
                ) from None
            raise
        self.handle = handle

    def close(self):
        if self.handle is not None:
            self.handle.close()
            self.handle = None


@contextmanager
def file_lock(path):
    # One coarse lock covers refresh, transaction and atomic publication. No live
    # SQLite/WAL file is opened on the share, including by the offline editor.
    with path.open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        deadline = time.monotonic() + 30
        while True:
            handle.seek(0)
            try:
                if os.name == "nt":
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as error:
                if error.errno not in (errno.EACCES, errno.EAGAIN) and getattr(error, "winerror", None) not in (32, 33):
                    raise
                if time.monotonic() >= deadline:
                    raise Conflict("Project is busy in another editor. Try again.") from error
                time.sleep(0.05)
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)
