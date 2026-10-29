"""Small non-streaming HTTPS clients. No SDK, automatic retries or key logging."""

import json
import os
import urllib.error
import urllib.request

TOOLS = [
    {
        "name": "spool",
        "description": "Eval connector to the fake Spool. projects/health/capabilities map to GET /spool/api/<method>. status and shot map to the real CLI subcommands (projectId is PROJECT, clipId is --clip). command maps to CLI command --file: envelope is the complete JSON file content from the shipped docs. Returns {status, body} for HTTP results or {transportError} when no response arrived. Only these methods are supported. This adapter performs no shell execution.",
        "input_schema": {
            "type": "object",
            "required": ["method"],
            "properties": {
                "method": {
                    "type": "string",
                    "enum": ["health", "capabilities", "projects", "status", "shot", "command"],
                },
                "projectId": {"type": "string"},
                "clipId": {"type": "string"},
                "limit": {"type": "integer"},
                "offset": {"type": "integer"},
                "envelope": {
                    "type": "object",
                    "description": "Unmodified scoped command envelope; see the current shipped documentation.",
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "ask_user",
        "description": "Ask for missing information. No further user reply is supplied in this sample; finish with your question.",
        "input_schema": {
            "type": "object",
            "required": ["question"],
            "properties": {"question": {"type": "string"}},
            "additionalProperties": False,
        },
    },
]


class ModelError(Exception):
    """Safe diagnostic with no request headers or provider response body."""


def post_json(url, headers, body):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise ModelError(f"Provider HTTP {error.code}; no automatic retry") from None
    except (OSError, ValueError):
        raise ModelError("Provider transport or JSON error; no automatic retry") from None


class Model:
    def __init__(self, model, max_tokens=2048):
        self.model, self.max_tokens = model, max_tokens
        if model.startswith("claude-"):
            self.provider, variable = "anthropic", "ANTHROPIC_API_KEY"
        elif model.startswith(("gpt-", "o1", "o3", "o4")):
            self.provider, variable = "openai", "OPENAI_API_KEY"
        else:
            raise ModelError("Use a claude-* model ID or an OpenAI gpt-*/o1/o3/o4 model ID")
        self.key = os.environ.get(variable)
        if not self.key:
            raise ModelError(f"Set {variable} in the environment for a manual paid run")

    def complete(self, system, history):
        try:
            return self._anthropic(system, history) if self.provider == "anthropic" else self._openai(system, history)
        except (KeyError, TypeError, ValueError, IndexError):
            raise ModelError("Invalid provider response shape") from None

    def _anthropic(self, system, history):
        messages = []
        for row in history:
            if row["role"] == "tool":
                block = {"type": "tool_result", "tool_use_id": row["id"], "content": row["text"]}
                if messages[-1]["role"] == "user":
                    messages[-1]["content"].append(block)
                else:
                    messages.append({"role": "user", "content": [block]})
            elif row["role"] == "assistant":
                content = ([{"type": "text", "text": row["text"]}] if row["text"] else []) + [
                    {"type": "tool_use", "id": c["id"], "name": c["name"], "input": c["arguments"]}
                    for c in row["calls"]
                ]
                messages.append({"role": "assistant", "content": content})
            else:
                messages.append({"role": "user", "content": [{"type": "text", "text": row["text"]}]})
        data = post_json(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": self.key, "anthropic-version": "2023-06-01"},
            {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "system": system,
                "messages": messages,
                "tools": TOOLS,
            },
        )
        return {
            "text": "\n".join(b["text"] for b in data["content"] if b["type"] == "text"),
            "calls": [
                {"id": b["id"], "name": b["name"], "arguments": b["input"]}
                for b in data["content"]
                if b["type"] == "tool_use"
            ],
            "stop": data["stop_reason"],
            "usage": data.get("usage", {}),
        }

    def _openai(self, system, history):
        messages = [{"role": "developer", "content": system}]
        for row in history:
            message = {"role": row["role"], "content": row["text"]}
            if row["role"] == "tool":
                message["tool_call_id"] = row["id"]
            elif row["role"] == "assistant" and row["calls"]:
                message["tool_calls"] = [
                    {
                        "id": c["id"],
                        "type": "function",
                        "function": {"name": c["name"], "arguments": json.dumps(c["arguments"])},
                    }
                    for c in row["calls"]
                ]
            messages.append(message)
        data = post_json(
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": "Bearer " + self.key},
            {
                "model": self.model,
                "max_completion_tokens": self.max_tokens,
                "messages": messages,
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": t["name"],
                            "description": t["description"],
                            "parameters": t["input_schema"],
                        },
                    }
                    for t in TOOLS
                ],
            },
        )
        choice = data["choices"][0]
        message = choice["message"]
        calls = []
        for c in message.get("tool_calls") or []:
            try:
                arguments = json.loads(c["function"]["arguments"])
            except ValueError:
                arguments = {"invalidJSON": c["function"]["arguments"]}
            calls.append({"id": c["id"], "name": c["function"]["name"], "arguments": arguments})
        return {
            "text": message.get("content") or "",
            "calls": calls,
            "stop": choice["finish_reason"],
            "usage": data.get("usage", {}),
        }
