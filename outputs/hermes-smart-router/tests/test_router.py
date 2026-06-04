import unittest
import json

from router import (
    RouteDecision,
    chat_completion_to_sse,
    choose_route,
    estimate_tokens,
    header_safe,
    normalize_chat_payload,
    should_fallback_to_strong,
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
        self.assertTrue(should_fallback_to_strong(500, "server error"))
        self.assertFalse(should_fallback_to_strong(401, "bad key"))
        self.assertFalse(should_fallback_to_strong(404, "missing"))

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
