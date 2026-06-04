#!/usr/bin/env python3
"""OpenAI-compatible smart router for Hermes.

Routes ordinary text work to a local llama.cpp server and escalates complex,
long-context, multimodal, or failed local requests to a stronger remote model.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple

ROUTER_MODEL = "hermes-smart-router"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8788
DEFAULT_LOCAL_PROVIDER = "llamaccp"
DEFAULT_STRONG_PROVIDER = "openai-codex"
DEFAULT_STRONG_FALLBACK_PROVIDER = "Api.apikey.fun"
DEFAULT_HERMES_AGENT_DIR = r"C:\Users\zengxiaofeng\AppData\Local\hermes\hermes-agent"

STRONG_KEYWORDS = [
    "深度推理", "深入推理", "复杂推理", "认真分析", "深入分析", "多步推理", "复杂架构",
    "架构设计", "复杂调试", "疑难调试", "跨文件", "大规模重构", "代码审查", "安全审计",
    "多模态", "图片", "图像", "截图", "照片", "ocr", "vision", "image", "screenshot",
    "医学诊断", "法律意见", "投资建议", "财务建议", "高风险", "critical", "deep reasoning",
    "think deeply", "multimodal", "analyze this image", "architecture design",
]

LOCAL_KEYWORDS = [
    "翻译", "translate", "总结", "summary", "summarize", "改写", "润色", "提取", "分类",
    "json", "rss", "新闻", "段落", "邮件", "标题", "摘要",
]


@dataclass(frozen=True)
class RouteDecision:
    route: str
    reason: str


@dataclass(frozen=True)
class Backend:
    provider: str
    model: str
    base_url: str
    api_key: str
    api_mode: str = "chat_completions"


def estimate_tokens(text: str) -> int:
    # Conservative mixed Chinese/English approximation.
    return max(1, int(len(text or "") / 3.2))


def iter_message_text_and_media(messages: Iterable[Dict[str, Any]], roles: set[str] | None = None) -> Tuple[str, bool]:
    parts: list[str] = []
    has_media = False
    for msg in messages or []:
        if roles is not None and str(msg.get("role") or "").lower() not in roles:
            continue
        content = msg.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                block_type = str(block.get("type") or "").lower()
                if block_type in {"image_url", "input_image", "image", "file", "input_file"}:
                    has_media = True
                if isinstance(block.get("text"), str):
                    parts.append(block["text"])
                image_url = block.get("image_url")
                if isinstance(image_url, dict) and image_url.get("url"):
                    has_media = True
        elif content is not None:
            parts.append(str(content))
    return "\n".join(parts), has_media


def choose_route(payload: Dict[str, Any]) -> RouteDecision:
    model = str(payload.get("model") or "").lower()
    if model.endswith(":strong") or model in {"strong", "gpt-5.5", "5.5"}:
        return RouteDecision("strong", "explicit-model-override")
    if model.endswith(":local") or model in {"local", "gemma.gguf", "glm.gguf"}:
        return RouteDecision("local", "explicit-model-override")

    messages = payload.get("messages") or []
    user_text, user_has_media = iter_message_text_and_media(messages, roles={"user"})
    all_text, all_has_media = iter_message_text_and_media(messages)
    text_for_intent = user_text or all_text
    lowered = text_for_intent.lower()
    if user_has_media or all_has_media:
        return RouteDecision("strong", "multimodal-content")
    for keyword in STRONG_KEYWORDS:
        if keyword.lower() in lowered:
            return RouteDecision("strong", f"keyword:{keyword}")
    if estimate_tokens(all_text) >= int(os.getenv("HERMES_ROUTER_STRONG_TOKEN_THRESHOLD", "28000")):
        return RouteDecision("strong", "long-context")
    for keyword in LOCAL_KEYWORDS:
        if keyword.lower() in lowered:
            return RouteDecision("local", f"simple-keyword:{keyword}")
    return RouteDecision("local", "simple-default")


def normalize_chat_payload(payload: Dict[str, Any], backend_model: str) -> Dict[str, Any]:
    rewritten = copy.deepcopy(payload)
    rewritten["model"] = backend_model
    if rewritten.get("model") == ROUTER_MODEL:
        rewritten["model"] = backend_model
    # Keep responses non-streaming so we can fallback cleanly and Hermes still gets
    # a standard OpenAI-compatible response.
    rewritten["stream"] = False
    return rewritten


def default_strong_providers() -> list[str]:
    configured = os.getenv("HERMES_ROUTER_STRONG_PROVIDERS", "").strip()
    if configured:
        providers = [p.strip() for p in configured.split(",") if p.strip()]
        if providers:
            return providers
    primary = os.getenv("HERMES_ROUTER_STRONG_PROVIDER", DEFAULT_STRONG_PROVIDER).strip() or DEFAULT_STRONG_PROVIDER
    fallback = os.getenv("HERMES_ROUTER_STRONG_FALLBACK_PROVIDER", DEFAULT_STRONG_FALLBACK_PROVIDER).strip()
    providers: list[str] = []
    for provider in [primary, fallback]:
        if provider and provider.lower() not in {p.lower() for p in providers}:
            providers.append(provider)
    return providers


def should_fallback_to_strong(status_code: int | None, body_text: str) -> bool:
    text = (body_text or "").lower()
    if status_code in {408, 409, 429, 500, 502, 503, 504, 599}:
        return True
    if status_code == 400 and any(k in text for k in ["context", "too many tokens", "maximum context", "exceeded"]):
        return True
    return False


def should_try_next_backend(status_code: int | None, body_text: str) -> bool:
    if status_code is None:
        return True
    if status_code >= 400:
        return True
    text = (body_text or "").lower()
    return "error" in text and "choices" not in text


def _ensure_hermes_import_path() -> None:
    agent_dir = os.getenv("HERMES_AGENT_DIR", DEFAULT_HERMES_AGENT_DIR)
    if agent_dir and agent_dir not in sys.path:
        sys.path.insert(0, agent_dir)


def resolve_backend(kind: str, requested_override: str | None = None) -> Backend:
    _ensure_hermes_import_path()
    from hermes_cli.runtime_provider import resolve_runtime_provider  # type: ignore

    if kind == "local":
        requested = os.getenv("HERMES_ROUTER_LOCAL_PROVIDER", DEFAULT_LOCAL_PROVIDER)
        model_override = os.getenv("HERMES_ROUTER_LOCAL_MODEL", "").strip()
    else:
        requested = requested_override or os.getenv("HERMES_ROUTER_STRONG_PROVIDER", DEFAULT_STRONG_PROVIDER)
        model_override = os.getenv("HERMES_ROUTER_STRONG_MODEL", "").strip()
    runtime = resolve_runtime_provider(requested=requested)
    model = model_override or str(runtime.get("model") or "").strip()
    base_url = str(runtime.get("base_url") or "").strip().rstrip("/")
    api_key = runtime.get("api_key") or ""
    api_mode = str(runtime.get("api_mode") or "chat_completions").strip() or "chat_completions"
    if not model or not base_url:
        raise RuntimeError(f"{kind} backend is incomplete: provider={requested!r}, model={model!r}, base_url={base_url!r}")
    return Backend(provider=requested, model=model, base_url=base_url, api_key=api_key, api_mode=api_mode)


def resolve_backend_candidates(kind: str) -> list[Backend]:
    if kind == "local":
        return [resolve_backend("local")]
    return [resolve_backend("strong", provider) for provider in default_strong_providers()]


def auth_headers(api_key: str) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def post_chat_completion(backend: Backend, payload: Dict[str, Any], timeout: float = 600.0) -> Tuple[int, bytes, Dict[str, str]]:
    if backend.api_mode == "codex_responses":
        return post_codex_response(backend, payload, timeout=timeout)
    url = backend.base_url.rstrip("/") + "/chat/completions"
    body = json.dumps(normalize_chat_payload(payload, backend.model), ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers=auth_headers(backend.api_key))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)
    except Exception as exc:
        return 599, json.dumps({"error": {"message": str(exc), "type": type(exc).__name__}}, ensure_ascii=False).encode("utf-8"), {}


def build_responses_payload(payload: Dict[str, Any], backend_model: str) -> Dict[str, Any]:
    _ensure_hermes_import_path()
    from agent.codex_responses_adapter import _chat_messages_to_responses_input, _responses_tools  # type: ignore

    messages = payload.get("messages") or []
    system_parts = []
    if isinstance(messages, list):
        for msg in messages:
            if isinstance(msg, dict) and msg.get("role") == "system":
                content = msg.get("content")
                if isinstance(content, str):
                    system_parts.append(content)
                elif content is not None:
                    system_parts.append(str(content))
    converted: Dict[str, Any] = {
        "model": backend_model,
        "instructions": "\n\n".join(system_parts).strip() or "You are a concise assistant.",
        "input": _chat_messages_to_responses_input(messages if isinstance(messages, list) else [], current_issuer_kind="codex_backend"),
        "store": False,
    }
    tools = _responses_tools(payload.get("tools") if isinstance(payload.get("tools"), list) else None)
    if tools:
        converted["tools"] = tools
    max_tokens = payload.get("max_completion_tokens") or payload.get("max_tokens")
    if isinstance(max_tokens, (int, float)) and max_tokens > 0:
        converted["max_output_tokens"] = int(max_tokens)
    temperature = payload.get("temperature")
    if isinstance(temperature, (int, float)):
        converted["temperature"] = float(temperature)
    return converted


def _namespace_tool_call_to_dict(tool_call: Any) -> Dict[str, Any]:
    function = getattr(tool_call, "function", None)
    return {
        "id": getattr(tool_call, "id", None) or getattr(tool_call, "call_id", None) or f"call_{int(time.time())}",
        "type": "function",
        "function": {
            "name": getattr(function, "name", "") if function is not None else "",
            "arguments": getattr(function, "arguments", "{}") if function is not None else "{}",
        },
    }


def chat_like_response_to_chat_completion_bytes(response: Any, backend_model: str) -> bytes:
    choices = getattr(response, "choices", None) or []
    first = choices[0] if choices else None
    assistant_message = getattr(first, "message", None) if first is not None else None
    content = getattr(assistant_message, "content", "") if assistant_message is not None else ""
    tool_calls_raw = getattr(assistant_message, "tool_calls", None) if assistant_message is not None else None
    message: Dict[str, Any] = {"role": "assistant", "content": content or ""}
    if tool_calls_raw:
        message["tool_calls"] = [_namespace_tool_call_to_dict(tc) for tc in tool_calls_raw]
    finish_reason = getattr(first, "finish_reason", None) if first is not None else None
    if not finish_reason:
        finish_reason = "tool_calls" if tool_calls_raw else "stop"
    payload = {
        "id": getattr(response, "id", None) or f"chatcmpl-codex-router-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": getattr(response, "model", None) or backend_model,
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def codex_response_to_chat_completion_bytes(response: Any, backend_model: str) -> bytes:
    if getattr(response, "choices", None):
        return chat_like_response_to_chat_completion_bytes(response, backend_model)
    _ensure_hermes_import_path()
    from agent.codex_responses_adapter import _normalize_codex_response  # type: ignore

    assistant_message, finish_reason = _normalize_codex_response(response, issuer_kind="codex_backend")
    content = getattr(assistant_message, "content", "") or ""
    tool_calls_raw = getattr(assistant_message, "tool_calls", None)
    message: Dict[str, Any] = {"role": "assistant", "content": content}
    if tool_calls_raw:
        message["tool_calls"] = [_namespace_tool_call_to_dict(tc) for tc in tool_calls_raw]
        finish_reason = "tool_calls"
    payload = {
        "id": getattr(response, "id", None) or f"chatcmpl-codex-router-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": getattr(response, "model", None) or backend_model,
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason or "stop"}],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def post_codex_response(backend: Backend, payload: Dict[str, Any], timeout: float = 600.0) -> Tuple[int, bytes, Dict[str, str]]:
    try:
        _ensure_hermes_import_path()
        from agent.auxiliary_client import resolve_provider_client  # type: ignore

        client, resolved_model = resolve_provider_client(backend.provider, backend.model, raw_codex=False)
        if client is None:
            raise RuntimeError(f"{backend.provider} client is unavailable")
        request_payload = normalize_chat_payload(payload, resolved_model or backend.model)
        request_payload["timeout"] = timeout
        response = client.chat.completions.create(**request_payload)
        return 200, codex_response_to_chat_completion_bytes(response, resolved_model or backend.model), {"Content-Type": "application/json"}
    except Exception as exc:
        status = getattr(exc, "status_code", None) or getattr(exc, "code", None) or 599
        try:
            status = int(status)
        except Exception:
            status = 599
        return status, json.dumps({"error": {"message": str(exc), "type": type(exc).__name__}}, ensure_ascii=False).encode("utf-8"), {}


def post_first_success(backends: list[Backend], payload: Dict[str, Any]) -> Tuple[int, bytes, Dict[str, str], Backend, str]:
    last_status = 599
    last_body = b""
    last_headers: Dict[str, str] = {}
    last_backend: Backend | None = None
    attempted: list[str] = []
    for backend in backends:
        attempted.append(backend.provider)
        status, body, headers = post_chat_completion(backend, payload)
        last_status, last_body, last_headers, last_backend = status, body, headers, backend
        if not should_try_next_backend(status, body.decode("utf-8", "replace")):
            return status, body, headers, backend, ",".join(attempted)
    if last_backend is None:
        raise RuntimeError("no backend candidates available")
    return last_status, last_body, last_headers, last_backend, ",".join(attempted)


def models_payload() -> Dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {"id": ROUTER_MODEL, "object": "model", "owned_by": "local-router"},
            {"id": f"{ROUTER_MODEL}:local", "object": "model", "owned_by": "local-router"},
            {"id": f"{ROUTER_MODEL}:strong", "object": "model", "owned_by": "local-router"},
        ],
    }


def header_safe(value: str) -> str:
    return str(value or "").encode("ascii", "backslashreplace").decode("ascii")


def debug_log(event: str, **fields: Any) -> None:
    """Append a sanitized debug event when HERMES_ROUTER_DEBUG_LOG is set.

    Deliberately does not log message text, API keys, headers, or full response
    bodies. It is meant to prove data flow between Hermes, the router, and the
    selected backend without leaking secrets or user prompts.
    """
    path = os.getenv("HERMES_ROUTER_DEBUG_LOG", "").strip()
    if not path:
        return
    safe_fields: Dict[str, Any] = {"event": event, "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}
    for key, value in fields.items():
        if key.lower() in {"api_key", "authorization", "headers", "body", "content", "messages"}:
            continue
        safe_fields[key] = value
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(safe_fields, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception:
        # Debug logging must never break request handling.
        pass


def summarize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    messages = payload.get("messages") or []
    text, has_media = iter_message_text_and_media(messages)
    return {
        "request_model": str(payload.get("model") or ""),
        "message_count": len(messages) if isinstance(messages, list) else 0,
        "roles": ",".join(str(m.get("role") or "") for m in messages if isinstance(m, dict))[:200]
        if isinstance(messages, list)
        else "",
        "text_chars": len(text),
        "has_media": has_media,
        "tools_count": len(payload.get("tools") or []) if isinstance(payload.get("tools"), list) else 0,
        "tool_choice": str(payload.get("tool_choice") or "")[:80],
        "stream": bool(payload.get("stream")),
        "max_tokens": payload.get("max_tokens") or payload.get("max_completion_tokens"),
    }


def summarize_response(status: int, body: bytes) -> Dict[str, Any]:
    content_len = 0
    finish_reason = ""
    try:
        data = json.loads(body.decode("utf-8", "replace"))
        choices = data.get("choices") if isinstance(data, dict) else None
        if isinstance(choices, list) and choices:
            first = choices[0] or {}
            finish_reason = str(first.get("finish_reason") or "")
            message = first.get("message") or {}
            content = message.get("content")
            if isinstance(content, str):
                content_len = len(content.strip())
            elif content is not None:
                content_len = len(str(content).strip())
    except Exception:
        pass
    return {"status": status, "response_bytes": len(body), "content_chars": content_len, "finish_reason": finish_reason}


def chat_completion_to_sse(body: bytes) -> bytes:
    """Convert a non-streaming OpenAI chat completion into SSE chunks.

    The router intentionally calls backends non-streaming so it can inspect
    failures and fallback. Hermes, however, often requests ``stream=true`` and
    expects Server-Sent Events. This adapter preserves a streaming wire shape
    for the caller while retaining fallback capability internally.
    """
    data = json.loads(body.decode("utf-8", "replace"))
    choices = data.get("choices") if isinstance(data, dict) else []
    choice = choices[0] if isinstance(choices, list) and choices else {}
    message = choice.get("message") if isinstance(choice, dict) else {}
    message = message if isinstance(message, dict) else {}
    finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else "stop"
    chunk_base = {
        "id": data.get("id", f"chatcmpl-router-{int(time.time())}") if isinstance(data, dict) else f"chatcmpl-router-{int(time.time())}",
        "object": "chat.completion.chunk",
        "created": data.get("created", int(time.time())) if isinstance(data, dict) else int(time.time()),
        "model": data.get("model", ROUTER_MODEL) if isinstance(data, dict) else ROUTER_MODEL,
    }
    chunks: list[Dict[str, Any]] = []
    role_chunk = copy.deepcopy(chunk_base)
    role_chunk["choices"] = [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]
    chunks.append(role_chunk)

    content = message.get("content")
    if isinstance(content, str) and content:
        content_chunk = copy.deepcopy(chunk_base)
        content_chunk["choices"] = [{"index": 0, "delta": {"content": content}, "finish_reason": None}]
        chunks.append(content_chunk)

    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        tool_chunk = copy.deepcopy(chunk_base)
        tool_chunk["choices"] = [{"index": 0, "delta": {"tool_calls": tool_calls}, "finish_reason": None}]
        chunks.append(tool_chunk)

    final_chunk = copy.deepcopy(chunk_base)
    final_chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": finish_reason or "stop"}]
    chunks.append(final_chunk)

    lines = []
    for chunk in chunks:
        lines.append("data: " + json.dumps(chunk, ensure_ascii=False, separators=(",", ":")) + "\n\n")
    lines.append("data: [DONE]\n\n")
    return "".join(lines).encode("utf-8")


class RouterHandler(BaseHTTPRequestHandler):
    server_version = "HermesSmartRouter/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        if os.getenv("HERMES_ROUTER_VERBOSE", "0") == "1":
            super().log_message(fmt, *args)

    def _write_json(self, status: int, payload: Dict[str, Any], extra_headers: Dict[str, str] | None = None) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _authorized(self) -> bool:
        expected = os.getenv("HERMES_ROUTER_API_KEY", "").strip()
        if not expected:
            return True
        got = self.headers.get("Authorization", "")
        return got == f"Bearer {expected}"

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in {"/v1/models", "/models"}:
            return self._write_json(200, models_payload())
        if self.path.rstrip("/") in {"/health", "/v1/health"}:
            return self._write_json(200, {"ok": True, "model": ROUTER_MODEL})
        self._write_json(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") not in {"/v1/chat/completions", "/chat/completions"}:
            return self._write_json(404, {"error": {"message": "not found"}})
        if not self._authorized():
            return self._write_json(401, {"error": {"message": "unauthorized"}})
        try:
            length = int(self.headers.get("Content-Length") or "0")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            decision = choose_route(payload)
            backend_candidates = resolve_backend_candidates(decision.route)
            backend = backend_candidates[0]
            debug_log("request", route=decision.route, reason=decision.reason, backend_provider=backend.provider, backend_model=backend.model, backend_api_mode=backend.api_mode, candidates=",".join(b.provider for b in backend_candidates), **summarize_payload(payload))
            status, body, headers, used_backend, attempted = post_first_success(backend_candidates, payload)
            route_used = decision.route
            reason = decision.reason
            if decision.route == "local" and should_fallback_to_strong(status, body.decode("utf-8", "replace")):
                strong_candidates = resolve_backend_candidates("strong")
                status, body, headers, used_backend, strong_attempted = post_first_success(strong_candidates, payload)
                route_used = "strong"
                reason = f"fallback-after-local:{decision.reason}"
                attempted = attempted + "->" + strong_attempted
            debug_log("response", route=route_used, reason=reason, backend_provider=used_backend.provider, backend_model=used_backend.model, backend_api_mode=used_backend.api_mode, attempted=attempted, **summarize_response(status, body))
            if payload.get("stream") and 200 <= status < 300:
                body = chat_completion_to_sse(body)
                self.send_response(status)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Hermes-Smart-Route", route_used)
                self.send_header("X-Hermes-Smart-Reason", header_safe(reason)[:180])
                self.send_header("X-Hermes-Smart-Provider", header_safe(used_backend.provider)[:120])
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(status)
            self.send_header("Content-Type", headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Hermes-Smart-Route", route_used)
            self.send_header("X-Hermes-Smart-Reason", header_safe(reason)[:180])
            self.send_header("X-Hermes-Smart-Provider", header_safe(used_backend.provider)[:120])
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self._write_json(500, {"error": {"message": str(exc), "type": type(exc).__name__}})


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    httpd = ThreadingHTTPServer((host, port), RouterHandler)
    print(f"Hermes smart router listening on http://{host}:{port}/v1", flush=True)
    httpd.serve_forever()


def main() -> None:
    host = os.getenv("HERMES_ROUTER_HOST", DEFAULT_HOST)
    port = int(os.getenv("HERMES_ROUTER_PORT", str(DEFAULT_PORT)))
    run_server(host, port)


if __name__ == "__main__":
    main()
