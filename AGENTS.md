# Spool

Spool is a video timeline studio inside ComfyUI. The Python backend (`spool/`)
owns projects and execution, the studio (`ui/`) is served at `/spool/`, and a
small ComfyUI page extension (`web/`) adds **Open Spool ↗** and links graph tabs
back to clips. The backend also runs without ComfyUI (`python -m spool`).

Read [docs/dev/glossary.md](docs/dev/glossary.md) and
[docs/dev/architecture.md](docs/dev/architecture.md) before planning a change. If
`AGENTS.local.md` exists beside this file, read it too.

## Never compromise on

- **Ordinary workflows.** A workflow needs no Spool nodes or graph rewrites. Keep
  Spool's state, UI and execution adapters in this extension and prefer narrow
  integration over changes to ComfyUI.
- **The user's edit.** Generation never chooses a take; only an explicit choice
  such as **Use take** changes the edit.
- **No surprise renders.** A request is frozen before dispatch and never
  resubmitted when its outcome is uncertain.

## Before calling a change done

Say which of these applied:

- The same action from its other entry points: buttons, menus, shortcuts, the
  inspector.
- Laptop and narrow studio layouts.
- The ComfyUI page side (`web/`): linked tabs and **Apply to clip**.
- Standalone mode, with ComfyUI stopped.
- The scoped command API and `skills/spool-control`.
- Local ComfyUI, Comfy Cloud and Deadline.
- Formats shared by Python and JavaScript: change both sides and the fixture.
- The user guide and the CHANGELOG.

## Verifying

- Run `python tests/run_architecture_checks.py` before every commit.
- Run browser and live checks against an isolated host (`tests/run_host.py`),
  never a ComfyUI someone uses for real work. Paid checks (`cloud-smoke`,
  Deadline acceptance) run only when asked. See
  [docs/dev/development.md](docs/dev/development.md).
- Logic bugs get a test that fails without the fix; visual fixes get before/after
  screenshots.
- Report mocked results separately from live evidence.

## Commits

- Branch from `main`, one coherent change per branch, titled in plain language.
- No AI attribution or `Co-Authored-By` trailers.
- Do not push, tag, publish or open pull requests without an explicit
  instruction. A change to `pyproject.toml` on `main` publishes to the Comfy
  Registry.

## Docs and work tracking

- `docs/guide/` is for users; `docs/dev/` records decisions and constraints the
  code cannot show. Rewrite outdated text rather than appending to it.
- Outstanding work lives in GitHub issues. Do not commit plans or scratch files.

## Clip notes

When asked to act on project notes, read the open entries through `status` or
`shot` (`shots[].notes`, or `audioClips[].notes` for independent audio). Do the
work, then call `address_note` with the note ID, the exact `expectedText` and a
short factual `summary`, using the `notes` capability and an explicit project
and clip scope ([docs/guide/automation.md](docs/guide/automation.md)). Leave partly
done or unverified requests open, and do not act on addressed notes again unless
the user reopens them. Adding or editing a note never authorizes a render.
