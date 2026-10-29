"""Durable atomic writes, also shipped beside standalone Deadline job scripts."""

import errno
import json
import os
import time
import uuid
from pathlib import Path


def atomic_replace(pending, target):
    # SMB/Windows scanners can briefly deny delete sharing.
    for index in range(21):
        try:
            pending.replace(target)
            return
        except OSError as error:
            if index == 20 or (
                error.errno not in (errno.EACCES, errno.EPERM) and getattr(error, "winerror", None) not in (5, 32, 33)
            ):
                raise
            time.sleep(0.1)


def write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + "." + uuid.uuid4().hex + ".partial")
    try:
        with pending.open("xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        atomic_replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def atomic_json(path, value):
    write(path, json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8"))
