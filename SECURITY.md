# Security

Spool is a studio that runs inside ComfyUI, or on its own with `python -m spool`.
It has no user accounts. Who can use it depends on who can reach the port.

## What each request may do

**Changes need Spool's own pages or a local tool.** Any request that changes
something (POST, PUT, DELETE) must come from a Spool page on the same address, or
from a tool that sends no `Origin` header, such as the `python -m spool` CLI or an
agent. Requests from other websites get `403`. This holds when ComfyUI runs with
`--enable-cors-header` and in standalone mode, where ComfyUI's own origin check
does not apply.

**Some routes answer only this computer.** These routes reach beyond project files:

- importing footage by path
- creating or opening a project folder
- revealing a take or clip folder in Explorer
- Comfy connection settings and the Cloud API key
- starting ComfyUI
- serving original footage, or any footage stored outside the project and Comfy folders
- preparing playback and exporting frames

A request to them must come from a loopback address. It must also use a loopback
host name (`localhost`, `127.0.0.1`, `[::1]`, or the `0.0.0.0` that ComfyUI
prints for `--listen`), and pass the same-origin rule above. The host-name check
blocks DNS rebinding, where another site points its own name at `127.0.0.1`.

**Everything else is open to anyone who can reach the port.** That includes
reading and editing projects, uploading media into a project, queueing
generations, deleting takes and running agent commands.

## Exposing Spool on a network

ComfyUI listens only on `127.0.0.1` unless you pass `--listen`. With `--listen`,
every machine that can reach the port can read and change Spool projects and
queue generations, just as it can use ComfyUI itself. Comfy Cloud generations,
and Partner Nodes in local workflows, spend credits from the API key saved on
the Spool machine. Use `--listen` only on networks you trust, or put an
authenticating reverse proxy in front of it. Standalone `python -m spool` binds
to `127.0.0.1`; its `--host` option carries the same risk.

## Credentials

Spool saves the Comfy Cloud API key on this computer: in
`%LOCALAPPDATA%\Spool\comfy-cloud.key` on Windows, otherwise
`~/.config/Spool/comfy-cloud.key`. The key never goes into project folders,
project exports or render receipts, and is redacted from Cloud error messages.
`COMFY_API_KEY` is used when no key is saved. `SPOOL_CREDENTIALS` moves the key
to another folder; the test hosts in `tests/` use their own runtime folder, so
their checks never read or replace this computer's key.

## Agents

Agent commands carry an explicit scope: project, clips, capabilities and budgets
such as maximum takes and concurrent jobs. Requests outside that scope are
refused. Adding or editing a note never authorizes execution. See
`skills/spool-control` for the command contract.

## Reporting a vulnerability

Report it privately through the repository's security advisory form ("Report a
vulnerability"). Please do not open a public issue.
