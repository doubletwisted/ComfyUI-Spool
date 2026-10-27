# Contributing

Bug reports, fixes and ideas are welcome. Spool has one maintainer, so review
time is limited: a pull request may be closed, deferred or reimplemented, and
meeting this guide makes it eligible for review, not certain to be merged.

Setup, the test gate and the test hosts are in
[docs/dev/development.md](docs/dev/development.md).

## Start with an issue

- **Bugs:** open a [bug report](https://github.com/doubletwisted/ComfyUI-Spool/issues/new?template=bug_report.yml).
  Include your Spool and ComfyUI versions, the steps, and the output of
  **Copy diagnostics** from the status in the studio's top bar.
- **Features and behaviour changes:** open a
  [feature request](https://github.com/doubletwisted/ComfyUI-Spool/issues/new?template=feature_request.yml)
  and agree on the direction and scope before writing code. Pull requests for
  features nobody agreed to are usually closed.
- **Small, obvious fixes** (a typo, a clear bug with a small fix) can go
  straight to a pull request. Say why the fix qualifies.
- **Security problems:** report them privately, as described in
  [SECURITY.md](.github/SECURITY.md).

## One problem per pull request

Solve one underlying problem per pull request, including the tests and docs it
needs. A second fix, a refactor or a cleanup goes in its own pull request.

## Show that it works

Explain how you reproduced the problem, how you checked the change and what you
saw. State what you could not check.

- Run `python tests/run_architecture_checks.py` before every commit.
- Logic and data bugs get a test that fails without the fix.
- Studio changes need before/after screenshots in the pull request. Attach
  them there; do not commit them.
- Execution, media and export changes need a [live check](docs/dev/development.md#live-checks)
  on a real ComfyUI, not only mocks. Report mocked results separately from live
  ones.

## Keep to the design

- Ordinary workflows must keep working without Spool nodes or graph rewrites.
- Generation never chooses a take. Only the user changes the edit.
- Formats shared by Python and JavaScript change on both sides, with their
  fixtures ([architecture.md](docs/dev/architecture.md#contracts-shared-across-languages)).
- Match the surrounding code: its naming, comment density and idiom.
- Add user-facing changes to [CHANGELOG.md](CHANGELOG.md).

Contributions are licensed under the project's [GPL-3.0](LICENSE).
