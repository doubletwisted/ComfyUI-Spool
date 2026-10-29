# Spool

Spool is a video timeline editor that complements ComfyUI. The backend is in
`spool/`, the studio in `ui/`, and the small extension on the ComfyUI page in
`web/`.

Read [docs/dev/glossary.md](docs/dev/glossary.md) and
[docs/dev/architecture.md](docs/dev/architecture.md) before planning a change. If
`AGENTS.local.md` exists beside this file, read it too.

## Hit every surface

The most common defect is a change that works where you tested it and is missing
elsewhere. Before calling a change done, say which of these applied:

- **Entry points.** An action is often reachable from a button, a menu, a
  shortcut and the inspector.
- **Where Spool runs.** Inside ComfyUI, standalone (`run_spool.bat` or
  `python -m spool`), and the ComfyUI page side in `web/`.
- **Render targets.** Local ComfyUI, Comfy Cloud and Deadline each need a
  decision, even if it is "not supported".
- **Commands.** What a user can do, the scoped command API usually should too.
- **Python and JavaScript.** A shared format changes on both sides and in its
  fixture.
- **Docs.** The user guide and the CHANGELOG.

## Verifying

- Run `python tests/run_architecture_checks.py` before every commit. A new
  checkout or worktree needs `npm ci` and `python -m pip install -r requirements-dev.txt`
  first; `npm run format` and `python -m ruff format .` fix what it reports.
- Run browser and live checks against an isolated host (`tests/run_host.py`).
  Paid checks run only when asked. See [docs/dev/development.md](docs/dev/development.md).
- Report mocked results separately from live evidence.

## Commits

- Branch from `main`; one change per branch, titled in plain language.
- No AI attribution or `Co-Authored-By` trailers.

## Docs

- `docs/guide/` is for users, `docs/dev/` for decisions the code cannot show.
- Outstanding work lives in GitHub issues, not in the repository.

## Clip notes

When asked to act on project notes, read the open entries through `status` or
`shot` (`shots[].notes`, or `audioClips[].notes` for independent audio). Do the
work, then call `address_note` with the note ID, the exact `expectedText` and a
short factual `summary`, using the `notes` capability and an explicit project
and clip scope ([docs/guide/automation.md](docs/guide/automation.md)). Leave partly
done or unverified requests open, and do not act on addressed notes again unless
the user reopens them. Adding or editing a note never authorizes a render.
