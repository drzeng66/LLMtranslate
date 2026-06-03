import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  endpointAllowed,
  normalizeSettings,
  buildChatRequest,
  splitDocumentIntoSegments,
  makeDocxPlainText,
} from "../lib/translator-core.js";

test("default settings allow local and configured frp endpoint", () => {
  assert.equal(DEFAULT_SETTINGS.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(DEFAULT_SETTINGS.remoteBaseUrl, "http://frp4.ccszxc.site:14668/v1");
  assert.equal(endpointAllowed("http://127.0.0.1:8080/v1/chat/completions"), true);
  assert.equal(endpointAllowed("http://localhost:8080/v1/models"), true);
  assert.equal(endpointAllowed("http://frp4.ccszxc.site:14668/v1/chat/completions"), true);
  assert.equal(endpointAllowed("https://example.com/v1/chat/completions"), false);
});

test("normalizeSettings switches between local and remote endpoints", () => {
  assert.equal(normalizeSettings({ endpointMode: "remote" }).baseUrl, "http://frp4.ccszxc.site:14668/v1");
  assert.equal(normalizeSettings({ endpointMode: "local" }).baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(normalizeSettings({ endpointMode: "custom", baseUrl: "http://frp4.ccszxc.site:14668/v1/" }).baseUrl, "http://frp4.ccszxc.site:14668/v1");
});

test("single translation request uses low latency defaults", () => {
  const req = buildChatRequest({ ...DEFAULT_SETTINGS, model: "gemma.gguf" }, [{ id: "p1", text: "Hello world." }]);
  assert.equal(req.model, "gemma.gguf");
  assert.equal(req.temperature, 0);
  assert.equal(req.stream, false);
  assert.equal(req.max_tokens, 384);
});

test("document segmentation avoids oversized chunks and preserves ids", () => {
  const text = Array.from({ length: 80 }, (_, i) => `Sentence ${i + 1} has enough English text for translation.`).join(" ");
  const chunks = splitDocumentIntoSegments(text, { maxChars: 500, minChars: 120 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((item, index) => item.id === `doc-${index + 1}`));
  assert.ok(chunks.every((item) => item.text.length <= 650));
});

test("docx text xml is converted into paragraph text", () => {
  const xml = `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second &amp; third</w:t></w:r></w:p></w:body></w:document>`;
  assert.equal(makeDocxPlainText(xml), "First\n\nSecond & third");
});
