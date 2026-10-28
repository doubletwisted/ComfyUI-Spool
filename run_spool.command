#!/bin/sh
# Double-click in Finder to start the Spool studio without ComfyUI.
exec sh "$(dirname "$0")/run_spool.sh" "$@"
