# Spool

Spool is a video timeline studio inside ComfyUI. A Python backend (`spool/`) owns
projects and execution, the studio (`ui/`) is a browser app served at `/spool/`,
and a small extension on the ComfyUI page (`web/`) adds **Open Spool ↗** and links
graph tabs back to clips. The same backend also runs without ComfyUI
(`python -m spool`).

If `AGENTS.local.md` exists beside this file, read it: it holds rules for one
machine. When Spool is installed inside a ComfyUI checkout, that checkout's
`AGENTS.md` also applies.

## What we never compromise on

1. **Workflows stay ordinary.** A workflow needs no Spool nodes or graph rewrites
   to work in Spool. Keep project state, UI, identity mapping and execution
   adapters in this extension, and prefer narrow integration over changes to
   ComfyUI.
2. **The edit belongs to the user.** Generation never chooses a take. Only an
   explicit choice, such as **Use take**, changes the edit.
3. **No surprise renders or spending.** A request is frozen before dispatch, and
   nothing is resubmitted when its outcome is uncertain. Comfy Cloud runs and
   Partner Nodes spend the user's credits.
4. **A project is a folder.** Everything an edit needs lives in its project
   folder, which can move between computers and sit on shared storage.

## Who is who

- **you** means the agent reading this file.
- **we** and **the maintainer** mean Dominik, who builds Spool.
- **user** means the person editing video in Spool.
- Product terms (clip, take, recipe, attempt, receipt) are defined in
  [docs/dev/glossary.md](docs/dev/glossary.md). Use them.

## The ways to hurt yourself

1. **Using a real ComfyUI.** The maintainer's ComfyUI serves real work. Never
   restart or stop it, and never point checks at it. Run checks against an
   isolated host (`tests/run_host.py`) on a free port with its own runtime
   folder. Other agents may already use 8195.
2. **Touching real data.** Real projects, Spool's settings in
   `ComfyUI/user/spool` and the Comfy Cloud key in `%LOCALAPPDATA%\Spool` belong
   to the user. Test hosts keep all of these in their runtime folder; keep it that
   way.
3. **Spending money.** `cloud-smoke`, any Comfy Cloud render and any Partner Node
   bill the user's key, and Deadline checks submit real farm jobs. Run them only
   when asked.
4. **Publishing.** Never push, tag, open a pull request, publish to the Comfy
   Registry or change a repository's visibility without an explicit instruction.
   A change to `pyproject.toml` on `main` publishes a release
   (`.github/workflows/publish.yml`).
5. **Killing by name.** Stop only the processes you started, by the PID you
   captured, or the owner of your own port.

## Hit every surface

The most common defect is a change that works where you tested it and is missing
elsewhere. Before calling a change done, walk this list and say which entries
applied:

- **Entry points.** A studio action is often reachable from a button, a context
  menu, a keyboard shortcut and the inspector.
- **Layouts.** The studio adapts down to laptop and narrow windows
  (`ui/studio.css`).
- **The ComfyUI page.** **Open Spool ↗**, linked graph tabs and **Apply to clip**
  live in `web/`.
- **Standalone.** Editing, import and export must work with ComfyUI stopped.
- **Agents.** A capability a user can trigger should be reachable through the
  scoped commands (`spool/commands.py`, the CLI and `skills/spool-control`).
- **Execution targets.** Local ComfyUI, Comfy Cloud and Deadline each need a
  decision, even if the decision is "not supported there".
- **Shared formats.** Python and JavaScript share formats pinned by fixtures (see
  [architecture.md](docs/dev/architecture.md#contracts-shared-across-languages)).
  Change both sides and the fixture together.
- **Reverse states.** Anything you can do should be undoable, or have a way back.
- **Docs.** Check whether [the user guide](docs/guide/README.md), the skill
  references or the CHANGELOG became inaccurate.

## Verifying

- Run `python tests/run_architecture_checks.py` before every commit. It needs no
  ComfyUI.
- Run the browser checks for the area you changed against your isolated host;
  execution, media and export changes also need a live check. Commands and
  options are in [docs/dev/development.md](docs/dev/development.md).
- Logic, data and protocol bugs get a test that fails without the fix. Visual
  fixes get before/after screenshots instead.
- Report mocked results separately from live evidence. Queuing a render verifies
  the submission, not the resulting video.

## Commits and pull requests

- Branch from `main`; one coherent change per branch.
- Titles say what changed in plain language, such as "Export the timeline as
  OpenTimelineIO". The body explains the problem and the change.
- No AI attribution: no `Co-Authored-By` trailers or model credits in commits or
  pull requests.
- Studio changes need before/after screenshots in the pull request. Do not commit
  them.

## Clip notes

When asked to act on project notes, read the open entries through `status` or
`shot` (`shots[].notes`, or `audioClips[].notes` for independent audio). Do the
requested work, then call `address_note` with the note ID, the exact
`expectedText` and a short factual `summary`. Use the `notes` capability and an
explicit project and clip scope; [docs/guide/automation.md](docs/guide/automation.md)
describes the command envelope. Leave partly done or unverified requests open. Do
not act on addressed notes again unless the user reopens them. Adding or editing
a note never authorizes a render.

## Documentation

- `docs/guide/` helps users get things done, in the product's voice. Update the
  section whose use changed; a UI tweak needs no entry.
- `docs/dev/` records decisions, constraints that span modules and traps the
  code cannot show. If reading the code answers the question, leave it out.
- When a documented decision changes, rewrite the text. Do not append a second
  account.
- Outstanding work lives in [GitHub issues](https://github.com/doubletwisted/ComfyUI-Spool/issues),
  not in the repository. Do not commit plans, research notes or scratch files;
  `promo/` and `.native-test/` are ignored.

## Where code lives

- `spool/`: routes, project store, commands, media and the execution targets.
- `ui/`: the studio. `editor.js` is the runtime; focused modules such as
  `timeline.js` and `project-edit.js` hold contracts with their own tests.
- `web/`: the ComfyUI page extension.
- `skills/spool-control/`: the agent skill for operating Spool.
- `tests/`: unit, contract and browser checks, and the test hosts.

[docs/dev/architecture.md](docs/dev/architecture.md) maps the modules.

## Taste

- Choose the smallest change that makes the right behaviour unsurprising. Do not
  keep complexity because it exists, or add machinery because it looks
  thorough.
- Match the surrounding code: its naming, comment density and idiom. Comment a
  constraint the code cannot show, in a line or two; do not narrate.
- If a rule here fights the task, say so and ask the maintainer before breaking
  it.
