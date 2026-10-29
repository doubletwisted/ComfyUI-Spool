import asyncio
import hashlib
import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import unquote

from aiohttp import web
from aiohttp.helpers import content_disposition_header

from .errors import NotFound, SpoolError, Forbidden, RevisionConflict, StudioOutdated
from .protocol import API_VERSION
from .editor import editor_html
from .media import EXTENSIONS, contained, staged_relative
from .workflows import parse_import
from . import attempts, ledger
from . import requests
from .collection import Collector
from . import commands
from . import operations, take_workflow, take_files
from .launcher import ComfyLauncher
from . import credentials, system, templates
from . import __version__, cloud as cloud_module, requirements
from .cloud import CloudExecutor
from .wire import wire, unwire


UPLOAD_LIMIT = 512 * 1024 * 1024
LOOPBACK_PEERS = ("127.0.0.1", "::1")
# 0.0.0.0 is what ComfyUI prints for --listen; browsers on this computer reach it locally.
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


# Audience is documentation, not authorization; the request guard applies to all routes.
ROUTE_AUDIENCES = {
    ("GET", "/spool/"): "studio",
    ("GET", "/spool/index.html"): "studio",
    ("GET", "/spool/ui/{file}"): "studio",
    ("GET", "/spool/media/{project}/{path:.*}"): "public automation",
    ("GET", "/spool/api/projects"): "public automation",
    ("POST", "/spool/api/projects"): "public automation",
    ("POST", "/spool/api/open-project"): "public automation",
    ("GET", "/spool/api/projects/{project}"): "public automation",
    ("POST", "/spool/api/projects/{project}/input"): "public automation",
    ("POST", "/spool/api/projects/{project}/generation-preview"): "public automation",
    ("GET", "/spool/api/projects/{project}/status"): "public automation",
    ("POST", "/spool/api/projects/{project}/commands"): "public automation",
    ("POST", "/spool/api/projects/{project}/focus/{view}"): "studio",
    ("GET", "/spool/api/projects/{project}/focus"): "public automation",
    ("POST", "/spool/api/projects/{project}/comparison"): "public automation",
    ("GET", "/spool/api/projects/{project}/media/{media}/original"): "public automation",
    ("GET", "/spool/api/projects/{project}/media/{media}/evidence"): "public automation",
    ("GET", "/spool/api/projects/{project}/evidence"): "public automation",
    ("POST", "/spool/api/projects/{project}/media/{media}/preview"): "public automation",
    ("GET", "/spool/api/projects/{project}/export"): "public automation",
    ("POST", "/spool/api/import-project"): "public automation",
    ("PUT", "/spool/api/projects/{project}"): "public automation",
    ("POST", "/spool/api/projects/{project}/import-workflow"): "public automation",
    ("POST", "/spool/api/projects/{project}/capture/{clip}"): "public automation",
    ("GET", "/spool/api/projects/{project}/take-workflow/{clip}/{take}"): "public automation",
    ("GET", "/spool/api/projects/{project}/take-file/{clip}/{take}"): "public automation",
    ("POST", "/spool/api/projects/{project}/take-file/{clip}/{take}/reveal"): "admin/host",
    ("POST", "/spool/api/projects/{project}/clip-folder/{clip}/reveal"): "admin/host",
    ("POST", "/spool/api/projects/{project}/use-take/{clip}"): "public automation",
    ("POST", "/spool/api/prepare-workflow"): "public automation",
    ("POST", "/spool/api/projects/{project}/delete-takes/{clip}"): "public automation",
    ("GET", "/spool/api/workflows/{version}"): "public automation",
    ("POST", "/spool/api/projects/{project}/handoffs"): "studio",
    ("GET", "/spool/api/handoffs/{handoff}"): "studio",
    ("POST", "/spool/api/handoffs/{handoff}/complete"): "studio",
    ("POST", "/spool/api/projects/{project}/queue"): "public automation",
    ("GET", "/spool/api/projects/{project}/events"): "public automation",
    ("GET", "/spool/api/comfy"): "admin/host",
    ("PUT", "/spool/api/comfy/settings"): "admin/host",
    ("GET", "/spool/api/templates"): "public automation",
    ("GET", "/spool/api/builtin-workflows"): "public automation",
    ("GET", "/spool/api/templates/{template}/{extension}"): "public automation",
    ("POST", "/spool/api/comfy/start"): "admin/host",
    ("GET", "/spool/api/comfy/log"): "admin/host",
    ("GET", "/spool/api/command-schema"): "public automation",
    ("GET", "/spool/api/capabilities"): "public automation",
    ("GET", "/spool/api/input/{path:.*}"): "public automation",
    ("POST", "/spool/api/reconcile"): "admin/host",
    ("GET", "/spool/api/attempts/{attempt}"): "public automation",
    ("POST", "/spool/api/upload"): "public automation",
    ("POST", "/spool/api/import-footage"): "public automation",
    ("POST", "/spool/api/export"): "public automation",
    ("POST", "/spool/api/export/otio"): "public automation",
    ("POST", "/spool/api/projects/{project}/detect-cuts"): "public automation",
    ("POST", "/spool/api/projects/{project}/frame"): "public automation",
    ("GET", "/spool/api/health"): "public automation",
}


def inside(path, root):
    """Lexical containment, matching `contained`; mapped drives are not resolved to UNC."""
    base = os.path.normcase(os.path.abspath(root))
    return os.path.normcase(os.path.abspath(path)).startswith(base + os.sep)


def register(server, store, media, executor=None):
    """Executor is None when Spool runs without ComfyUI; editing, import and export still work."""
    routes = server.routes
    assets = Path(__file__).resolve().parent.parent / "ui"
    preview_jobs = {}
    collector = executor.collector if executor is not None else Collector(store, media)
    cloud = CloudExecutor(store, media, collector)
    launcher = ComfyLauncher(store)

    def services(request):
        project_id = request.match_info.get("project") or request.query.get("projectId")
        if project_id:
            selected = store.for_project(project_id)
            return selected, media.for_project(selected, project_id)
        for field, table in (("version", "workflows"), ("handoff", "handoffs"), ("attempt", "attempts")):
            if field in request.match_info:
                selected = store.lookup(table, request.match_info[field])
                project_id = selected.list()[0]["id"]
                return selected, media.for_project(selected, project_id)
        return store, media

    def response(value):
        result = web.Response(
            text=json.dumps(wire(value)), content_type="application/json", zlib_executor_size=64 * 1024
        )
        if len(result.body) >= 64 * 1024:
            result.enable_compression()
            result.headers["Vary"] = "Accept-Encoding"
        return result

    async def project_response(request, value):
        def serialize():
            return response(ledger.editor_project(value) if request.headers.get("X-Spool-View") == "editor" else value)

        return await asyncio.to_thread(serialize)

    def file_response(path, **kwargs):
        result = web.FileResponse(path, **kwargs)
        if os.name == "nt":
            # Avoid Windows native sendfile stalls; retain FileResponse range/cache handling.
            result.enable_compression(force=web.ContentCoding.identity)
        return result

    def same_origin(request):
        return request.headers.get("Origin") in (None, str(request.url.origin()))

    def is_local(request):
        """A request from this computer's own Spool pages or local tools.

        The host-name check stops DNS rebinding: another site cannot make the
        browser address Spool by a loopback host name and its own origin at once.
        """
        return (
            request.remote in LOOPBACK_PEERS
            and (request.url.host or "").lower() in LOOPBACK_HOSTS
            and same_origin(request)
        )

    def local_control(request, message="Use this from the Spool studio on the computer running Spool"):
        """Guard requests that reach beyond project files: paths, programs, folders."""
        if not is_local(request):
            raise Forbidden(message)

    @web.middleware
    async def guard(request, handler):
        # Every Spool change must come from Spool's own pages or from tools that
        # send no Origin (the CLI and agents). Comfy's origin check is off under
        # --enable-cors-header and absent in standalone mode.
        if not request.path.startswith("/spool/"):
            return await handler(request)
        try:
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                if not same_origin(request):
                    raise Forbidden("Spool accepts changes only from its own pages and local tools")
                version = request.headers.get("X-Spool-Api-Version")
                if version is not None and version != str(API_VERSION):
                    raise StudioOutdated("Spool was updated. Reload this page.")
            return await handler(request)
        except Exception as error:
            if isinstance(error, SpoolError):
                status, code, message = error.status, error.code, str(error)
            elif isinstance(error, ValueError):
                status, code, message = 400, "invalid_request", str(error)
            elif isinstance(error, web.HTTPException) and error.status < 500:
                status = error.status
                code = "not_found" if status == 404 else "invalid_request"
                message = error.reason
            else:
                logging.exception("Spool request failed: %s %s", request.method, request.path)
                status, code, message = 500, "internal_error", "Spool request failed. See the host log for details."
            value = {"error": message, "code": code}
            if (
                isinstance(error, RevisionConflict)
                and error.code == "revision_conflict"
                and "project" in request.match_info
            ):
                try:
                    value["current"] = await asyncio.to_thread(store.get, request.match_info["project"])
                except Exception:
                    logging.exception("Spool could not read the current project after a conflict")
            return web.json_response(wire(value), status=status)

    server.app.middlewares.append(guard)

    async def receive_file(request, target):
        """Stream the request body to target atomically; a rejected upload leaves no file."""
        target.parent.mkdir(parents=True, exist_ok=True)
        pending = target.with_name(target.name + ".partial")
        size = 0
        try:
            with pending.open("wb") as handle:
                async for chunk in request.content.iter_chunked(1024 * 1024):
                    size += len(chunk)
                    if size > UPLOAD_LIMIT:
                        raise ValueError("Choose a file smaller than %d MB" % (UPLOAD_LIMIT // (1024 * 1024)))
                    handle.write(chunk)
            pending.replace(target)
        finally:
            pending.unlink(missing_ok=True)

    async def prepare_inputs(capture, request, strict=False):
        _, project_media = await asyncio.to_thread(services, request)
        return await asyncio.to_thread(project_media.prepare_workflow, capture, strict, is_local(request))

    async def prepare_capture(capture, request):
        builtin = capture.get("provenance", {}).get("builtinTemplate") in templates.CATALOG
        prepared = await prepare_inputs(capture, request, not builtin)
        if builtin:
            bound = {(b["nodeId"], b["input"]) for b in capture.get("bindings", []) if b.get("asset")}
            if any((m["nodeId"], m["input"]) not in bound for m in prepared["inputRecovery"]["missing"]):
                raise ValueError("This template has an unbound missing source. Update its studio mapping.")
        return prepared

    def annotate(value):
        return executor.annotate_progress(value) if executor is not None else collector.annotate_progress(value)

    def endpoint(handler):
        async def wrapped(request):
            started = time.perf_counter()
            try:
                result = await handler(request)
                result.headers["Server-Timing"] = f"spool;dur={(time.perf_counter() - started) * 1000:.1f}"
                return result
            finally:
                elapsed = time.perf_counter() - started
                if elapsed >= 3:
                    logging.warning("Spool slow request: %s %s %.0f ms", request.method, request.path, elapsed * 1000)

        return wrapped

    @routes.get("/spool/")
    @routes.get("/spool/index.html")
    async def editor(request):
        return web.Response(text=editor_html(), content_type="text/html", headers={"Cache-Control": "no-store"})

    @routes.get("/spool/ui/{file}")
    @endpoint
    async def ui(request):
        path = contained(assets, request.match_info["file"])
        if not path.is_file():
            raise NotFound("Asset not found")
        return file_response(path)

    @routes.get("/spool/media/{project}/{path:.*}")
    @endpoint
    async def asset(request):
        store, media = await asyncio.to_thread(services, request)
        path = await asyncio.to_thread(media.resolve, request.match_info["path"])
        return file_response(path)

    @routes.get("/spool/api/projects")
    @endpoint
    async def projects(request):
        return response(await asyncio.to_thread(store.list))

    @routes.post("/spool/api/projects")
    @endpoint
    async def create(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(await request.json())
        if data.get("folder"):
            local_control(request)
        return response(
            await asyncio.to_thread(
                store.create, data.get("document"), **({"folder": data["folder"]} if data.get("folder") else {})
            )
        )

    @routes.post("/spool/api/open-project")
    @endpoint
    async def open_project(request):
        local_control(request)
        data = await request.json()
        return response(await asyncio.to_thread(store.open_folder, data["folder"]))

    @routes.get("/spool/api/projects/{project}")
    @endpoint
    async def project(request):
        store, media = await asyncio.to_thread(services, request)
        state = await asyncio.to_thread(store.sync_state, request.match_info["project"])
        token = hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()
        if request.headers.get("X-Spool-View") == "editor" and request.headers.get("X-Spool-Since") == token:
            # Progress is ephemeral; return it even when the durable project is unchanged.
            value = {"id": state["id"], "document": {"jobs": state["jobs"]}}
            value = await asyncio.to_thread(annotate, value)
            result = response({"revision": state["revision"], "syncToken": token, "jobs": value["document"]["jobs"]})
        else:
            value = await asyncio.to_thread(store.get, request.match_info["project"])
            value["syncToken"] = token
            result = await project_response(request, await asyncio.to_thread(annotate, value))
        result.headers["Cache-Control"] = "no-store"
        return result

    @routes.post("/spool/api/projects/{project}/input")
    @endpoint
    async def upload_input(request):
        local_control(request)
        store, media = await asyncio.to_thread(services, request)
        name = Path(unquote(request.headers.get("X-Filename", "image.png"))).name
        if Path(name).suffix.lower() not in EXTENSIONS:
            raise ValueError("Choose an image, audio or video input")
        target = await asyncio.to_thread(media.input_destination, name, unique=True)
        await receive_file(request, target)
        return response({"file": await asyncio.to_thread(media.stage_input, target)})

    @routes.post("/spool/api/projects/{project}/generation-preview")
    @endpoint
    async def generation_preview(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(await request.json())
        return response(
            await asyncio.to_thread(
                requests.preview, store, media, request.match_info["project"], data["revision"], data["clipId"]
            )
        )

    @routes.get("/spool/api/projects/{project}/status")
    @endpoint
    async def project_status(request):
        store, media = await asyncio.to_thread(services, request)
        return response(
            await asyncio.to_thread(
                commands.status,
                store,
                request.match_info["project"],
                request.query.get("clipId"),
                int(request.query.get("limit", 50)),
                int(request.query.get("offset", 0)),
            )
        )

    @routes.post("/spool/api/projects/{project}/commands")
    @endpoint
    async def command(request):
        store, media = await asyncio.to_thread(services, request)
        return response(
            await asyncio.to_thread(
                commands.execute, store, media, request.match_info["project"], unwire(await request.json())
            )
        )

    @routes.post("/spool/api/projects/{project}/focus/{view}")
    @endpoint
    async def publish_focus(request):
        store, media = await asyncio.to_thread(services, request)
        await asyncio.to_thread(
            store.publish_focus, request.match_info["project"], request.match_info["view"], await request.json()
        )
        return response({"ok": True})

    @routes.get("/spool/api/projects/{project}/focus")
    @endpoint
    async def focus(request):
        store, media = await asyncio.to_thread(services, request)
        return response(
            await asyncio.to_thread(store.focused, request.match_info["project"], request.query.get("viewId"))
        )

    @routes.post("/spool/api/projects/{project}/comparison")
    @endpoint
    async def comparison(request):
        store, media = await asyncio.to_thread(services, request)
        data = await request.json()
        clip = await asyncio.to_thread(store.clip, request.match_info["project"], data["clipId"])
        fps = await asyncio.to_thread(store.frame_rate, request.match_info["project"])
        return response(await asyncio.to_thread(media.comparison, clip, data["takeIds"], fps))

    @routes.get("/spool/api/projects/{project}/media/{media}/original")
    @endpoint
    async def original_media(request):
        store, media = await asyncio.to_thread(services, request)
        local_control(request, "Preview original footage from the computer running Spool")
        selected = await asyncio.to_thread(
            store.media_record, request.match_info["project"], request.match_info["media"]
        )
        return file_response((await asyncio.to_thread(media.original_source, selected))["path"])

    @routes.get("/spool/api/projects/{project}/media/{media}/evidence")
    @endpoint
    async def media_evidence(request):
        store, media = await asyncio.to_thread(services, request)
        # The probe and the embedded graph are evidence, not edit state; the working
        # document names them and this serves the payload on demand.
        value = await asyncio.to_thread(store.evidence, request.match_info["project"], request.match_info["media"])
        return await asyncio.to_thread(response, value)

    @routes.get("/spool/api/projects/{project}/evidence")
    @endpoint
    async def project_evidence(request):
        store, media = await asyncio.to_thread(services, request)
        # A downloaded local draft must stay portable: it carries the same evidence a
        # saved project does, composed from the stored rows by media id.
        value = await asyncio.to_thread(store.all_evidence, request.match_info["project"])
        return await asyncio.to_thread(response, value)

    @routes.post("/spool/api/projects/{project}/media/{media}/preview")
    @endpoint
    async def prepare_preview(request):
        store, media = await asyncio.to_thread(services, request)
        local_control(request, "Prepare playback on the computer running Spool")
        # The caller states the playback size it wants, so preparing never has to
        # save the project for the server to read one from the document.
        data = await request.json()
        divisor = data.get("divisor")
        if type(divisor) is not int or divisor not in (1, 2, 4):
            raise ValueError("Choose Full, 1/2 or 1/4 playback resolution")
        width, height = data.get("width"), data.get("height")
        if any(type(value) is not int or value < 2 or value > 8192 or value % 2 for value in (width, height)):
            raise ValueError("Choose an even playback size between 2 and 8192 pixels")
        fps = data.get("fps")
        if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not 1 <= fps <= 240:
            raise ValueError("Choose a project frame rate between 1 and 240")
        try:
            selected = await asyncio.to_thread(
                store.media_record, request.match_info["project"], request.match_info["media"], ("video", "image")
            )
        except ValueError:
            selected = await asyncio.to_thread(
                store.media_record, request.match_info["project"], request.match_info["media"], ("audio",)
            )
        if selected["kind"] == "audio" and not selected.get("fps"):
            raise ValueError("This audio source does not contain video frames")
        key = await asyncio.to_thread(media.preview_path, selected, width, height, fps)
        if key not in preview_jobs:
            preview_jobs[key] = asyncio.create_task(asyncio.to_thread(media.preview, selected, width, height, fps))
            preview_jobs[key].add_done_callback(lambda task: preview_jobs.pop(key, None))
        result = await asyncio.shield(preview_jobs[key])
        # Concurrent shots share the encoding task, but keep their own source clock.
        return response({**result, "offset": selected.get("sourceRange", {}).get("start", 0) / fps})

    @routes.get("/spool/api/projects/{project}/export")
    @endpoint
    async def project_export(request):
        store, media = await asyncio.to_thread(services, request)
        return response(await asyncio.to_thread(store.export_project, request.match_info["project"]))

    @routes.post("/spool/api/import-project")
    @endpoint
    async def project_import(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(json.loads(await request.text()))
        return response(await asyncio.to_thread(store.import_project, data))

    @routes.put("/spool/api/projects/{project}")
    @endpoint
    async def save(request):
        store, media = await asyncio.to_thread(services, request)
        text = await request.text()
        data = await asyncio.to_thread(lambda: unwire(json.loads(text)))
        recipes = {}
        for version, capture in data.get("workflowRecipes", {}).items():
            recipes[version] = await prepare_capture(capture, request)
            for clip in data["document"]["clips"]:
                if clip.get("workflowVersion") == version and clip.get("inputValues"):
                    operations.restage(capture, recipes[version], clip["inputValues"])
        return await project_response(
            request,
            await asyncio.to_thread(
                store.save, request.match_info["project"], data["revision"], data["document"], recipes
            ),
        )

    @routes.post("/spool/api/projects/{project}/import-workflow")
    @endpoint
    async def import_workflow(request):
        store, media = await asyncio.to_thread(services, request)
        imported = parse_import(await request.text(), unquote(request.headers.get("X-Filename", "Imported workflow")))
        imported["data"] = await prepare_inputs(imported["data"], request)
        project_id = request.match_info["project"]
        project = await asyncio.to_thread(store.get, project_id)
        project["document"].setdefault("importedWorkflows", []).append(imported)
        saved = await asyncio.to_thread(
            store.save, project_id, int(request.headers["X-Spool-Revision"]), project["document"]
        )
        return response({"project": saved, "workflow": imported})

    @routes.post("/spool/api/projects/{project}/capture/{clip}")
    @endpoint
    async def capture(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(await request.json())
        original = data["capture"]
        data["capture"] = await prepare_capture(original, request)
        if data.get("overrides"):
            operations.restage(original, data["capture"], data["overrides"])
        saved = await asyncio.to_thread(
            operations.apply_capture,
            store,
            request.match_info["project"],
            data["revision"],
            request.match_info["clip"],
            data["capture"],
            data.get("overrides"),
            save_sidecar=bool(data.get("saveSidecar")),
            reset_inputs=bool(data.get("resetInputs")),
        )
        return await project_response(request, saved)

    @routes.get("/spool/api/projects/{project}/take-workflow/{clip}/{take}")
    @endpoint
    async def take_setup(request):
        store, media = await asyncio.to_thread(services, request)
        capture = await asyncio.to_thread(
            take_workflow.resolve,
            store,
            request.match_info["project"],
            request.match_info["clip"],
            request.match_info["take"],
        )
        return response(await prepare_inputs(capture, request, True) if capture else None)

    def take_source(request):
        selected, project_media = services(request)
        clip = selected.clip(request.match_info["project"], request.match_info["clip"])
        take = next(
            (t for t in clip["takes"] if t["id"] == request.match_info["take"] and not t.get("placeholder")), None
        )
        if not take:
            raise NotFound("Take not found")
        path = project_media.original_source(take["media"])["path"]
        roots = [selected.root, *project_media.host_roots.values()]
        if not any(inside(path, root) for root in roots):
            local_control(request, "Use footage outside this project from the computer running Spool")
        return path

    @routes.get("/spool/api/projects/{project}/take-file/{clip}/{take}")
    @endpoint
    async def download_take(request):
        path = await asyncio.to_thread(take_source, request)
        return file_response(
            path, headers={"Content-Disposition": content_disposition_header("attachment", filename=path.name)}
        )

    @routes.post("/spool/api/projects/{project}/take-file/{clip}/{take}/reveal")
    @endpoint
    async def reveal_take(request):
        local_control(request)
        path = await asyncio.to_thread(take_source, request)
        system.show(path, select=True)
        return response({"ok": True})

    @routes.post("/spool/api/projects/{project}/clip-folder/{clip}/reveal")
    @endpoint
    async def reveal_clip_folder(request):
        local_control(request)
        if not system.file_manager():
            raise ValueError("Opening clip folders needs a desktop with xdg-open")

        def folder():
            selected, _ = services(request)
            clip = selected.clip(request.match_info["project"], request.match_info["clip"])
            output = (selected.root / "output").resolve()
            path = contained(selected.root, clip["outputFolder"]).resolve()
            if path == output or not path.is_relative_to(output) or not path.is_relative_to(selected.root.resolve()):
                raise ValueError("Clip folder must be inside this project's output folder")
            path.mkdir(parents=True, exist_ok=True)
            return path

        path = await asyncio.to_thread(folder)
        system.show(path)
        return response({"ok": True})

    @routes.post("/spool/api/projects/{project}/use-take/{clip}")
    @endpoint
    async def use_take(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(await request.json())
        capture = await prepare_inputs(data["capture"], request, True) if data.get("capture") else None
        saved = await asyncio.to_thread(
            operations.use_take,
            store,
            request.match_info["project"],
            data["revision"],
            request.match_info["clip"],
            data["takeId"],
            capture,
        )
        return await project_response(request, saved)

    @routes.post("/spool/api/prepare-workflow")
    @endpoint
    async def prepare_workflow(request):
        store, media = await asyncio.to_thread(services, request)
        return response(await prepare_inputs(unwire(await request.json()), request, True))

    @routes.post("/spool/api/projects/{project}/delete-takes/{clip}")
    @endpoint
    async def delete_take_files(request):
        selected, _ = await asyncio.to_thread(services, request)
        data = await request.json()
        return response(
            await asyncio.to_thread(
                take_files.delete,
                selected,
                request.match_info["project"],
                data["revision"],
                request.match_info["clip"],
                data["takeIds"],
            )
        )

    @routes.get("/spool/api/workflows/{version}")
    @endpoint
    async def workflow(request):
        store, media = await asyncio.to_thread(services, request)
        return response(await asyncio.to_thread(store.workflow, request.match_info["version"]))

    @routes.post("/spool/api/projects/{project}/handoffs")
    @endpoint
    async def handoff(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(await request.json())
        if data.get("action") in ("open", "prepare"):
            prepared = await prepare_inputs(
                {"workflow": data.get("workflow"), "prompt": data.get("prompt")}, request, True
            )
            data["workflow"] = prepared["workflow"]
            data["prompt"] = prepared.get("prompt")
            data["inputRecovery"] = prepared["inputRecovery"]
        return response(await asyncio.to_thread(store.handoff, request.match_info["project"], data))

    @routes.get("/spool/api/handoffs/{handoff}")
    @endpoint
    async def read_handoff(request):
        store, media = await asyncio.to_thread(services, request)
        return response(await asyncio.to_thread(store.read_handoff, request.match_info["handoff"]))

    @routes.post("/spool/api/handoffs/{handoff}/complete")
    @endpoint
    async def finish_handoff(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(await request.json())
        return response(await asyncio.to_thread(store.finish_handoff, request.match_info["handoff"], data))

    @routes.post("/spool/api/projects/{project}/queue")
    @endpoint
    async def queue(request):
        store, media = await asyncio.to_thread(services, request)
        data = unwire(await request.json())
        project_id = request.match_info["project"]
        items = data.get("items")
        if executor is not None:
            value = await executor.queue(
                project_id,
                data["revision"],
                data.get("clips", []),
                data.get("count", 1),
                data.get("operationId"),
                data.get("actor", "human"),
                items,
            )
        else:
            value = await asyncio.to_thread(
                requests.accept,
                store,
                media,
                project_id,
                data["revision"],
                items if items is not None else [{"clipId": c, "count": data["count"]} for c in data["clips"]],
                data.get("operationId"),
                data.get("actor", "human"),
            )
        return response(value)

    @routes.get("/spool/api/projects/{project}/events")
    @endpoint
    async def events(request):
        store, media = await asyncio.to_thread(services, request)

        def read():
            store.exists(request.match_info["project"])
            return store.events(
                request.match_info["project"],
                int(request.query.get("since", "0")),
                int(request.query.get("limit", "100")),
                request.query.get("latest") == "true",
            )

        return response(await asyncio.to_thread(read))

    @routes.get("/spool/api/comfy")
    @endpoint
    async def comfy_status(request):
        store, media = await asyncio.to_thread(services, request)
        local_control(request)
        return response({**await launcher.status(), **credentials.key_status()})

    @routes.put("/spool/api/comfy/settings")
    @endpoint
    async def comfy_settings(request):
        store, media = await asyncio.to_thread(services, request)
        local_control(request)
        data = await request.json()
        settings = await asyncio.to_thread(launcher.save, data)
        if "apiKey" in data:
            credentials.save_key(data["apiKey"])
        return response({**settings, **credentials.key_status()})

    @routes.get("/spool/api/templates")
    @endpoint
    async def studio_templates(request):
        return response(list(templates.CATALOG.values()))

    @routes.get("/spool/api/builtin-workflows")
    @endpoint
    async def builtin_workflows(request):
        return response(
            {"templates": {template_id: templates.own_capture(template_id) for template_id in templates.OWN}}
        )

    @routes.get("/spool/api/templates/{template}/{extension}")
    @endpoint
    async def studio_template(request):
        extension = request.match_info["extension"]
        if extension == "capture":
            return response(templates.cloud_capture(request.match_info["template"]))
        return file_response(
            templates.asset(request.match_info["template"], extension),
            headers={"Content-Type": "image/webp" if extension == "webp" else "application/json"},
        )

    @routes.post("/spool/api/comfy/start")
    @endpoint
    async def comfy_start(request):
        store, media = await asyncio.to_thread(services, request)
        local_control(request)
        await request.json()
        return response(await launcher.start())

    @routes.get("/spool/api/comfy/log")
    @endpoint
    async def comfy_log(request):
        store, media = await asyncio.to_thread(services, request)
        local_control(request)
        return response({"text": await asyncio.to_thread(launcher.log)})

    @routes.get("/spool/api/command-schema")
    @endpoint
    async def command_schema(request):
        return file_response(Path(__file__).with_name("command-schema.json"))

    @routes.get("/spool/api/capabilities")
    @endpoint
    async def capabilities(request):
        store, media = await asyncio.to_thread(services, request)
        types = request.query.get("types")
        value = await asyncio.to_thread(store.host, include_definitions=types != "")
        value["fileManager"] = system.file_manager()
        value["clipFolderReveal"] = value["fileManager"] is not None
        value.update(credentials.key_status())
        value["cloudExecution"] = cloud_module.available()
        value["requirements"] = requirements.report()
        value["version"] = __version__
        value["apiVersion"] = API_VERSION
        value["commandActions"] = sorted(commands.ACTION_CAPABILITIES)
        value["commandSchema"] = "/spool/api/command-schema"
        if types != "":
            value["cloudDefinitions"] = templates.cloud_templates()["definitions"]
        if types is not None:
            selected = set(types.split(","))
            value["definitions"] = {k: v for k, v in value["definitions"].items() if k in selected}
        return response(value)

    @routes.get("/spool/api/input/{path:.*}")
    @endpoint
    async def input_asset(request):
        def locate():
            name = request.match_info["path"]
            path = contained(media.host_roots["input"], name)
            if not path.is_file() and staged_relative(name):
                # A project opened on this host may not have staged its inputs yet.
                project_id = name.split("/", 2)[1]
                selected = store.for_project(project_id)
                path = media.for_project(selected, project_id).input_source(name)
            if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
                raise ValueError("Input asset is missing or unsupported")
            return path

        return file_response(await asyncio.to_thread(locate))

    @routes.post("/spool/api/reconcile")
    @endpoint
    async def reconcile(request):
        store, media = await asyncio.to_thread(services, request)
        if executor is not None:
            await executor.reconcile()
        await asyncio.to_thread(collector.scan)
        return web.json_response({"ok": True})

    @routes.get("/spool/api/attempts/{attempt}")
    @endpoint
    async def attempt(request):
        store, media = await asyncio.to_thread(services, request)

        def read():
            value = store.attempt(request.match_info["attempt"])
            value["dispatch"] = store.dispatch_record(value["id"])
            if attempts.target_of(value["request"]) == attempts.CLOUD:
                value["cloud"] = store.setting("cloud:" + value["id"])
            return value

        return response(await asyncio.to_thread(read))

    @routes.post("/spool/api/upload")
    @endpoint
    async def upload(request):
        if not request.query.get("projectId"):
            raise ValueError("Choose a project before importing media")
        store, media = await asyncio.to_thread(services, request)
        name = Path(unquote(request.headers.get("X-Filename", "media.mp4"))).name
        extension = Path(name).suffix.lower()
        if extension not in EXTENSIONS:
            raise ValueError("Import a video, image, or audio file")
        target = await asyncio.to_thread(media.input_destination, name, unique=True)
        await receive_file(request, target)
        description = await asyncio.to_thread(media.describe, target, name, float(request.query.get("fps", 24)))
        if description.get("workflow"):
            description["workflowData"] = await prepare_inputs(
                {"workflow": description["workflow"], "prompt": description.get("prompt")}, request
            )
        return response(description)

    @routes.post("/spool/api/import-footage")
    @endpoint
    async def import_footage(request):
        store, media = await asyncio.to_thread(services, request)
        # Reads an arbitrary local path, so only the machine running Spool may ask.
        local_control(request, "Import footage by path from the computer running Spool")
        data = await request.json()
        source = await asyncio.to_thread(media.keep_input, Path(data["path"]))
        footage = await asyncio.to_thread(media.import_footage, source, data.get("fps"), data.get("detectCuts", True))
        source = footage["source"]
        if source.get("workflow"):
            source["workflowData"] = await prepare_inputs(
                {"workflow": source["workflow"], "prompt": source.get("prompt")}, request
            )
            for shot in footage["shots"]:
                shot.update({key: source[key] for key in ("workflow", "prompt", "workflowData") if key in source})
        return response(footage)

    @routes.post("/spool/api/export")
    @endpoint
    async def export(request):
        store, media = await asyncio.to_thread(services, request)
        data = await request.json()
        metadata = []
        if data.get("projectId"):
            metadata = ledger.media_records(await asyncio.to_thread(store.projected, data["projectId"]))
            if any(Path(m.get("originalFile", "")).is_absolute() for m in metadata):
                local_control(request, "Export original footage from the computer running Spool")
        return web.json_response(await asyncio.to_thread(media.export, data, metadata))

    @routes.post("/spool/api/export/otio")
    @endpoint
    async def export_otio(request):
        # The timeline names files by their path on this computer.
        local_control(request, "Export an editable timeline from the computer running Spool")
        store, media = await asyncio.to_thread(services, request)
        data = await request.json()
        metadata = (
            ledger.media_records(await asyncio.to_thread(store.projected, data["projectId"]))
            if data.get("projectId")
            else []
        )
        return web.json_response(await asyncio.to_thread(media.export_timeline, data, metadata))

    @routes.post("/spool/api/projects/{project}/detect-cuts")
    @endpoint
    async def detect_clip_cuts(request):
        store, media = await asyncio.to_thread(services, request)
        data = await request.json()
        clip = await asyncio.to_thread(store.clip, request.match_info["project"], data["clipId"])
        take = next((t for t in clip["takes"] if t["id"] == data["takeId"]), None)
        if not take or take.get("placeholder"):
            raise ValueError("Select a video take in this project")
        fps = await asyncio.to_thread(store.frame_rate, request.match_info["project"])
        cuts = await asyncio.to_thread(media.find_cuts, take["media"], fps, clip["in"], clip["out"])
        return response({"cuts": cuts})

    @routes.post("/spool/api/projects/{project}/frame")
    @endpoint
    async def export_frame(request):
        store, media = await asyncio.to_thread(services, request)
        local_control(request, "Export a frame from the computer running Spool")
        data = await request.json()
        selected = await asyncio.to_thread(
            store.media_record, request.match_info["project"], data["mediaId"], ("video", "image")
        )
        fps = await asyncio.to_thread(store.frame_rate, request.match_info["project"])
        return response(await asyncio.to_thread(media.export_frame, selected, data["frame"], fps))

    @routes.get("/spool/api/health")
    @endpoint
    async def health(request):
        host = await asyncio.to_thread(store.host, include_definitions=False)
        return web.json_response(
            {
                "spool": True,
                "version": __version__,
                "native": True,
                "requirements": requirements.report(),
                "executor": executor is not None and executor.managed,
                "executorError": executor.disabled_reason if executor is not None else None,
                "storePath": str(store.root),
                "comfy": host["connected"],
                "paired": host["configuration"] is not None,
                "review": "Every source frame once at project FPS; originals retained, linked audio follows interpreted speed",
            }
        )

    server.app.cleanup_ctx.append(cloud.lifecycle)
    if executor is not None:
        server.app.cleanup_ctx.append(executor.poll)
    else:
        server.app.cleanup_ctx.append(launcher.lifecycle)
        server.app.cleanup_ctx.append(collector.lifecycle)
