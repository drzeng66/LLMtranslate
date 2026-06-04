import unittest
import json
from types import SimpleNamespace

from router import (
    RouteDecision,
    chat_completion_to_sse,
    codex_response_to_chat_completion_bytes,
    default_strong_providers,
    build_responses_payload,
    choose_route,
    estimate_tokens,
    header_safe,
    normalize_chat_payload,
    should_fallback_to_strong,
    should_try_next_backend,
)


class RouterDecisionTests(unittest.TestCase):
    def test_simple_translation_routes_local(self):
        payload = {"messages": [{"role": "user", "content": "Translate this paragraph into Chinese: hello world."}]}
        decision = choose_route(payload)
        self.assertEqual(decision.route, "local")
        self.assertIn("simple", decision.reason)

    def test_system_tool_descriptions_do_not_force_strong(self):
        payload = {
            "messages": [
                {"role": "system", "content": "You can analyze 图片 and 图像 when needed."},
                {"role": "user", "content": "Translate to Chinese: hello world."},
            ],
            "tools": [{"type": "function", "function": {"name": "analyze_image"}}],
        }
        decision = choose_route(payload)
        self.assertEqual(decision.route, "local")

    def test_deep_reasoning_routes_strong(self):
        payload = {"messages": [{"role": "user", "content": "请深度推理并设计一个复杂架构方案"}]}
        decision = choose_route(payload)
        self.assertEqual(decision.route, "strong")
        self.assertIn("keyword", decision.reason)

    def test_multimodal_content_routes_strong(self):
        payload = {"messages": [{"role": "user", "content": [{"type": "text", "text": "分析这张图"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}}]}]}
        decision = choose_route(payload)
        self.assertEqual(decision.route, "strong")
        self.assertIn("multimodal", decision.reason)

    def test_explicit_model_override(self):
        self.assertEqual(choose_route({"model": "hermes-smart-router:strong", "messages": []}).route, "strong")
        self.assertEqual(choose_route({"model": "hermes-smart-router:local", "messages": []}).route, "local")

    def test_long_context_routes_strong(self):
        text = "a" * 140000
        decision = choose_route({"messages": [{"role": "user", "content": text}]})
        self.assertEqual(decision.route, "strong")
        self.assertIn("long-context", decision.reason)

    def test_normalize_rewrites_model_to_backend_model(self):
        payload = {"model": "hermes-smart-router", "messages": [{"role": "user", "content": "hi"}]}
        rewritten = normalize_chat_payload(payload, "gemma.gguf")
        self.assertEqual(rewritten["model"], "gemma.gguf")
        self.assertEqual(payload["model"], "hermes-smart-router")

    def test_fallback_error_detection(self):
        self.assertTrue(should_fallback_to_strong(400, "context length exceeded"))
        self.assertTrue(should_fallback_to_strong(599, "connection refused"))
        self.assertTrue(should_fallback_to_strong(500, "server error"))
        self.assertFalse(should_fallback_to_strong(401, "bad key"))
        self.assertFalse(should_fallback_to_strong(404, "missing"))

    def test_provider_chain_tries_next_on_any_backend_error(self):
        self.assertTrue(should_try_next_backend(400, "model unsupported"))
        self.assertTrue(should_try_next_backend(401, "auth expired"))
        self.assertTrue(should_try_next_backend(599, "connection refused"))
        self.assertFalse(should_try_next_backend(200, "{}"))

    def test_strong_provider_chain_prefers_openai_codex(self):
        self.assertEqual(default_strong_providers(), ["openai-codex", "Api.apikey.fun"])

    def test_build_responses_payload_moves_system_to_instructions(self):
        payload = {
            "messages": [
                {"role": "system", "content": "System rule."},
                {"role": "user", "content": "请深度推理"},
            ],
            "tools": [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}],
            "max_tokens": 12,
            "temperature": 0,
        }
        converted = build_responses_payload(payload, "gpt-5.5")
        self.assertEqual(converted["model"], "gpt-5.5")
        self.assertIn("System rule.", converted["instructions"])
        self.assertEqual(converted["input"][0]["role"], "user")
        self.assertEqual(converted["max_output_tokens"], 12)
        self.assertEqual(converted["tools"][0]["name"], "lookup")

    def test_codex_response_to_chat_completion_bytes_preserves_text(self):
        response = SimpleNamespace(
            id="resp-test",
            model="gpt-5.5",
            output_text="2",
            output=[
                SimpleNamespace(
                    type="message",
                    role="assistant",
                    status="completed",
                    content=[SimpleNamespace(type="output_text", text="2")],
                )
            ],
            usage=None,
        )
        raw = codex_response_to_chat_completion_bytes(response, "gpt-5.5")
        data = json.loads(raw.decode("utf-8"))
        self.assertEqual(data["choices"][0]["message"]["content"], "2")
        self.assertEqual(data["choices"][0]["finish_reason"], "stop")

    def test_codex_chat_like_response_to_chat_completion_bytes_preserves_text(self):
        response = SimpleNamespace(
            model="gpt-5.5",
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    message=SimpleNamespace(role="assistant", content="2", tool_calls=None),
                )
            ],
        )
        raw = codex_response_to_chat_completion_bytes(response, "gpt-5.5")
        data = json.loads(raw.decode("utf-8"))
        self.assertEqual(data["choices"][0]["message"]["content"], "2")
        self.assertEqual(data["choices"][0]["finish_reason"], "stop")

    def test_token_estimate(self):
        self.assertGreaterEqual(estimate_tokens("a" * 4000), 900)

    def test_header_safe_escapes_non_ascii(self):
        safe = header_safe("keyword:深度推理")
        safe.encode("ascii")
        self.assertIn("\\u", safe)

    def test_chat_completion_to_sse_preserves_content(self):
        body = json.dumps({
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 1,
            "model": "gemma.gguf",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "路由器冒烟测试"},
            }],
        }).encode("utf-8")
        sse = chat_completion_to_sse(body).decode("utf-8")
        self.assertIn("data: ", sse)
        self.assertIn("路由器冒烟测试", sse)
        self.assertIn("chat.completion.chunk", sse)
        self.assertTrue(sse.rstrip().endswith("data: [DONE]"))


if __name__ == "__main__":
    unittest.main()
