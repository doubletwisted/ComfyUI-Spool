#!/bin/sh
# Start the Spool studio without ComfyUI and open it in the browser.
# Extra arguments go to "python -m spool", for example: sh run_spool.sh --port 8191
cd "$(dirname "$0")" || exit 1
# A venv beside ComfyUI, as ComfyUI Desktop and manual installs make, before the system Python.
for candidate in ../../venv/bin/python ../../.venv/bin/python; do
    if [ -x "$candidate" ]; then
        exec "$candidate" -m spool --open "$@"
    fi
done
if command -v python3 >/dev/null 2>&1; then
    exec python3 -m spool --open "$@"
fi
exec python -m spool --open "$@"
