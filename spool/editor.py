from pathlib import Path


EDITOR = Path(__file__).resolve().parent.parent / "ui" / "editor.html"


def editor_html():
    """Serve the native-owned document without transforming prototype source."""
    return EDITOR.read_text(encoding="utf-8")
