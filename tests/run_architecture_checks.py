"""Run the gate: formatting and lint, then every offline check, stopping at a failure.

Checks are found by name, so a new `tests/test_*.py` or `tests/*_checks.mjs` runs
without being registered and a deleted one cannot be skipped silently.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
if os.name == "nt":
    os.environ.setdefault("AIOHTTP_NOSENDFILE", "1")

missing = []
if importlib.util.find_spec("ruff") is None:
    missing.append("ruff (python -m pip install -r requirements-dev.txt)")
if not (ROOT / "node_modules" / "prettier").is_dir() or not (ROOT / "node_modules" / "eslint").is_dir():
    missing.append("Prettier and ESLint (npm ci)")
if missing:
    sys.exit("The gate needs " + " and ".join(missing) + ". See docs/dev/development.md.")

commands = [
    [sys.executable, "-m", "ruff", "format", "--check", "."],
    [sys.executable, "-m", "ruff", "check", "."],
    ["node", "node_modules/prettier/bin/prettier.cjs", "--check", "."],
    ["node", "node_modules/eslint/bin/eslint.js", "."],
    [sys.executable, "tests/editor_contract_checks.py"],
]
commands += [["node", "tests/" + path.name] for path in sorted(TESTS.glob("*_checks.mjs"))]
commands += [
    [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", path.name, "-v"]
    for path in sorted(TESTS.glob("test_*.py"))
]
for command in commands:
    print("Running " + " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)
