"""Offline HTTP, schema, and release-version regressions."""

import ast
import copy
import json
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

import jsonschema

from spool import __version__, commands
from spool.errors import InvalidRequest, OperationConflict, Unavailable
from spool.protocol import API_VERSION
from spool.routes import ROUTE_AUDIENCES
import test_security

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "spool/command-schema.json").read_text())


class HttpContractTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_security.RouteGuardTests.asyncSetUp

    async def test_expected_errors_and_unexpected_exceptions(self):
        for error, status, code in (
            (ValueError("User message"), 400, "invalid_request"),
            (KeyError("secret"), 500, "internal_error"),
            (TypeError("secret"), 500, "internal_error"),
            (OSError("secret"), 500, "internal_error"),
            (Unavailable("Try later"), 503, "unavailable"),
            (OperationConflict("Different command"), 409, "operation_id_conflict"),
        ):
            with patch.object(self.workspace, "list", side_effect=error):
                response = await self.client.get("/spool/api/projects")
            value = await response.json()
            self.assertEqual((response.status, value["code"]), (status, code))
            jsonschema.validate(value, {"$defs": SCHEMA["$defs"], "$ref": "#/$defs/error"})
            self.assertNotIn("secret", value["error"])
            self.assertNotIn("current", value)
        with patch.object(self.workspace, "host", side_effect=RuntimeError("secret")):
            response = await self.client.get("/spool/api/health")
        self.assertEqual((response.status, (await response.json())["code"]), (500, "internal_error"))

    async def test_not_found_forbidden_and_revision_conflict(self):
        response = await self.client.get("/spool/api/projects/missing")
        self.assertEqual((response.status, (await response.json())["code"]), (404, "not_found"))
        response = await self.client.post("/spool/api/projects", json={}, headers={"Origin": "https://elsewhere.test"})
        self.assertEqual((response.status, (await response.json())["code"]), (403, "forbidden"))
        response = await self.client.put(self.base, json={"revision": -1, "document": self.project["document"]})
        value = await response.json()
        self.assertEqual((response.status, value["code"]), (409, "revision_conflict"))
        self.assertEqual(value["current"]["revision"], self.project["revision"])

    async def test_stale_studio_cannot_write_and_versionless_tools_can(self):
        body = {"revision": self.project["revision"], "document": {**self.project["document"], "project": "Draft"}}
        for version in ("0", str(API_VERSION + 1), "invalid"):
            response = await self.client.put(self.base, json=body, headers={"X-Spool-Api-Version": version})
            self.assertEqual((response.status, (await response.json())["code"]), (412, "studio_outdated"))
        self.assertEqual(self.store.get(self.project["id"]), self.project)
        response = await self.client.put(self.base, json=body)
        self.assertEqual(response.status, 200)
        response = await self.client.post(
            "/spool/api/projects", json={}, headers={"X-Spool-Api-Version": str(API_VERSION)}
        )
        self.assertEqual(response.status, 200)
        response = await self.client.get("/spool/api/capabilities?types=", headers={"X-Spool-Api-Version": "0"})
        value = await response.json()
        self.assertEqual(value["apiVersion"], API_VERSION)
        self.assertEqual(value["commandActions"], sorted(commands.ACTION_CAPABILITIES))
        response = await self.client.get(value["commandSchema"])
        self.assertEqual(await response.json(), SCHEMA)

    async def test_malformed_commands_are_invalid_requests(self):
        for value in (None, [], {}, {"action": []}, {"action": "brief", "arguments": None}):
            response = await self.client.post(
                self.base + "/commands", data=json.dumps(value), headers={"Content-Type": "application/json"}
            )
            self.assertEqual((response.status, (await response.json())["code"]), (400, "invalid_request"))


class ContractFixtureTests(unittest.TestCase):
    def test_versions(self):
        versions = json.loads((ROOT / "tests/fixtures/protocol_versions.json").read_text())
        self.assertEqual(API_VERSION, versions["apiVersion"])
        self.assertEqual(__version__, tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"])

    def test_every_route_declares_an_audience(self):
        tree = ast.parse((ROOT / "spool/routes.py").read_text())
        declared = {
            (node.func.attr.upper(), node.args[0].value)
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "routes"
        }
        self.assertEqual(declared, set(ROUTE_AUDIENCES))

    def test_command_examples_and_malformed_envelopes(self):
        jsonschema.Draft202012Validator.check_schema(SCHEMA)
        for action, fields in commands.ARGUMENT_FIELDS.items():
            args = {
                key: "example" if kind is str else (kind[0]() if isinstance(kind, tuple) else kind())
                for key, kind in fields.items()
            }
            if "variants" in args:
                args["variants"] = [{"clipId": "shot"}]
            if "edge" in args:
                args["edge"] = "in"
            if "verdict" in args:
                args["verdict"] = "keep"
            if "target" in args:
                args["target"] = "deadline"
            envelope = {
                "operationId": "example",
                "revision": 1,
                "actor": "agent:test",
                "action": action,
                "arguments": args,
                "scope": {
                    "projectId": "project",
                    "clipIds": ["shot"],
                    "capabilities": [commands.ACTION_CAPABILITIES[action]],
                    "maxTakes": 2,
                },
            }
            commands.validate_envelope(envelope)
            jsonschema.validate(envelope, SCHEMA)
            for key in ("operationId", "revision", "actor", "scope", "action", "arguments"):
                malformed = copy.deepcopy(envelope)
                malformed[key] = None
                with self.assertRaises(InvalidRequest):
                    commands.execute(None, None, "project", malformed)
                with self.assertRaises(jsonschema.ValidationError):
                    jsonschema.validate(malformed, SCHEMA)
