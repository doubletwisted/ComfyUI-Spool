"""Machine credentials stay outside project stores and portable project files."""

import os
from pathlib import Path


def key_path():
    # SPOOL_CREDENTIALS moves the key, so test hosts never read or replace this machine's key.
    if folder := os.environ.get("SPOOL_CREDENTIALS"):
        return Path(folder) / "comfy-cloud.key"
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".config") / "Spool" / "comfy-cloud.key"


def _effective_key():
    # One read resolves both the key and its source, so status always matches cloud_key.
    path = key_path()
    saved = path.read_text(encoding="utf-8").strip() if path.is_file() else ""
    if saved:
        return saved, "saved"
    environment = os.environ.get("COMFY_API_KEY", "").strip()
    return (environment, "environment") if environment else ("", None)


def cloud_key():
    return _effective_key()[0]


def key_status():
    key, source = _effective_key()
    return {"hasApiKey": bool(key), "apiKeySource": source}


def save_key(value):
    if not isinstance(value, str):
        raise ValueError("Enter a Comfy Cloud API key beginning with comfyui-")
    value = value.strip()
    if value and (not value.startswith("comfyui-") or any(c.isspace() for c in value)):
        raise ValueError("Enter a Comfy Cloud API key beginning with comfyui-")
    path = key_path()
    if value:
        path.parent.mkdir(parents=True, exist_ok=True)
        pending = path.with_suffix(".tmp")
        # Private from creation: writing first and narrowing afterwards left the key
        # readable by other users of the computer until the chmod.
        handle = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            if hasattr(os, "fchmod"):
                os.fchmod(handle, 0o600)  # a leftover file keeps its old mode otherwise
            os.write(handle, value.encode("utf-8"))
        finally:
            os.close(handle)
        pending.replace(path)
    else:
        path.unlink(missing_ok=True)
