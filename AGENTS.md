# Spool

Spool is a video timeline studio that runs as a ComfyUI extension, in one
full-screen tab opened from ComfyUI's native top action bar. Existing ordinary
workflows must not require Spool nodes or graph rewrites.

Read [GLOSSARY.md](GLOSSARY.md) and [docs/dev/architecture.md](docs/dev/architecture.md)
before planning a change, and [CONTRIBUTING.md](CONTRIBUTING.md) for the gate,
test hosts and browser checks. User-facing behaviour is described in
[docs/guide](docs/guide/README.md). Keep outstanding work in `docs/BACKLOG.md`;
avoid adding separate planning documents for each task. If `AGENTS.local.md`
exists beside this file, read it too: it holds rules for one machine and is not
part of the repository.

When Spool is installed inside a ComfyUI checkout, that checkout's `AGENTS.md`
also applies. Keep Spool project state, UI, identity mapping and execution
adapters in this extension. Prefer narrow integration changes over alterations
to core ComfyUI.

Run `python tests/run_architecture_checks.py` before committing. Run browser and
live checks against an isolated test host (`tests/run_host.py`); never restart a
ComfyUI that someone uses for real work just to verify a change. Report mocked
results separately from live evidence.

Do not push, publish, tag or open pull requests without an explicit instruction.

## Clip Notes

When asked to act on project notes, read individual open entries through
`status`/`shot` (`shots[].notes`, or `audioClips[].notes` for independent audio).
Complete the requested work, then use `address_note` with the note ID, exact
`expectedText`, and a short factual `summary` of what was done. Use the `notes`
capability and explicit project/clip scope. [docs/automation.md](docs/automation.md)
describes the command envelope. Leave partially completed or unverified requests
open. Queuing a render verifies submission only, not the resulting video. Do not
execute addressed notes again unless the user reopens them. Adding or editing
notes never authorizes execution.
