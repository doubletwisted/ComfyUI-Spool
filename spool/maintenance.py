"""Project storage maintenance; compaction runs in the locked local cache."""

import argparse
import json
import os
from pathlib import Path

from .projects import ProjectStore, Workspace

COMFY = Path(__file__).resolve().parents[3]


def default_root():
    installed = (COMFY / "folder_paths.py").is_file()
    return Path(os.environ.get("SPOOL_STORAGE", COMFY / "user" / "spool" if installed else Path.home() / "Spool"))


def megabytes(value):
    return "%.1f MB" % (value / 1e6)


def run_prune(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m spool prune",
        description="Report derived media storage, and evict unreferenced previews on request",
    )
    parser.add_argument("--storage", type=Path, required=True, help="project folder containing project.spool")
    parser.add_argument("--confirm", action="store_true", help="delete unreferenced previews until the budget is met")
    parser.add_argument("--budget-gb", type=float, default=5.0, help="preview budget in GiB (default 5)")
    parser.add_argument(
        "--grace-minutes", type=float, default=10.0, help="protect previews newer than this (default 10)"
    )
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    args = parser.parse_args(argv)

    if not (args.storage / "project.spool").is_file():
        parser.error("Choose a project folder containing project.spool")
    store = ProjectStore(args.storage, Workspace(default_root()))
    report = store.prune(confirm=args.confirm, budget=int(args.budget_gb * 1024**3), grace=args.grace_minutes * 60)
    if args.json:
        print(json.dumps({**report, "unreferencedPreviews": None}, indent=2, default=str))
        return 0
    print("store              : " + str(store.root))
    for folder, held in sorted(report["folders"].items()):
        print("  %-12s %5d files  %10s" % (folder, held["files"], megabytes(held["bytes"])))
    print("previews budget    : %s of %s" % (megabytes(report["previewBytes"]), megabytes(report["budgetBytes"])))
    print("unreferenced previews: %d files, %s" % (report["unreferenced"], megabytes(report["unreferencedBytes"])))
    if not args.confirm:
        print(
            "\ndry run — nothing is removed. Uploads, shots, exports and artifacts are never removed: they can be the only copy."
        )
        if report["previewBytes"] > report["budgetBytes"]:
            print("re-run with --confirm to evict unreferenced previews older than the grace window")
        return 0
    print("evicted            : %d files, %s freed" % (len(report["evicted"]), megabytes(report["freed"])))
    return 0


def run(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m spool reclaim", description="Reclaim Spool storage that no reader depends on"
    )
    parser.add_argument("--storage", type=Path, required=True, help="project folder containing project.spool")
    parser.add_argument("--confirm", action="store_true", help="drop retired tables and compact the file")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    args = parser.parse_args(argv)

    if not (args.storage / "project.spool").is_file():
        parser.error("Choose a project folder containing project.spool")
    store = ProjectStore(args.storage, Workspace(default_root()))
    report = store.reclaim(confirm=args.confirm)
    if args.json:
        print(json.dumps(report, indent=2))
        return 0
    print("store            : " + report["path"])
    print("file bytes       : %s" % megabytes(report["bytes"]))
    for entry in report["retired"]:
        print(
            "retired table    : %s (%d rows, %s of payload, no reader)"
            % (entry["table"], entry["rows"], megabytes(entry["payloadBytes"]))
        )
    if not report["retired"] and not report["freeBytes"]:
        print("nothing to reclaim")
        return 0
    if report["freeBytes"]:
        print("free pages       : %s available to return" % megabytes(report["freeBytes"]))
    if not args.confirm:
        print("\ndry run — re-run with --confirm to drop retired tables and compact the file")
        return 0
    print("reclaimed        : %s" % megabytes(report["reclaimed"]))
    print("file bytes after : %s" % megabytes(report["bytes"]))
    return 0
