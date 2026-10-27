# Third-party notices

Spool is licensed under the GNU General Public License v3.0 (see `LICENSE`).
It runs as a ComfyUI extension and uses or includes the following material.

## ComfyUI

Spool imports ComfyUI's server and execution modules at runtime. It does not
include ComfyUI's source. ComfyUI is licensed under the GNU General Public
License v3.0. https://github.com/comfyanonymous/ComfyUI

## Comfy-Org workflow templates

`ui/builtin-captures.json` and `spool/cloud_templates.json` contain workflow
graphs and API prompts derived from Comfy-Org's workflow templates
(`comfyui-workflow-templates` 0.11.89), adapted with Spool's input mappings.
Template preview images are served at runtime from the installed package and are
not included in Spool.

```
MIT License

Copyright (c) 2023-present Comfy Org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Comfy SDK

Spool installs `comfy-sdk` (MIT License, Copyright (c) 2026 Comfy Org) as a
dependency for Comfy Cloud execution. It is not included in Spool.

## ffmpeg and ffprobe

Spool calls the `ffmpeg` and `ffprobe` executables installed on the host for
media probing, previews and export. They are not included in Spool and keep
their own licenses.
