"""Verify the native document can be served without prototype source."""

import importlib.util
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("native_editor", ROOT / "spool/editor.py")
editor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(editor)
expected = (ROOT / "ui/editor.html").read_text(encoding="utf-8")
read = Path.read_text


def native_read(path, *args, **kwargs):
    if "demo" in path.parts:
        raise AssertionError("Native document must not depend on the prototype assembly")
    return read(path, *args, **kwargs)


with patch.object(Path, "read_text", native_read):
    assert editor.editor_html() == expected
assert '<script type="module" src="/spool/ui/bootstrap.js"></script>' in expected
assert "demo-runtime.js" not in expected
assert '<main inert class="editor" id="editor"' in expected
print("Native document served unchanged with prototype reads forbidden")
for module in (ROOT / "spool").glob("*.py"):
    source = module.read_text(encoding="utf-8")
    assert "from ..demo" not in source and "import demo" not in source, module
print("Native backend imports no demo modules")
