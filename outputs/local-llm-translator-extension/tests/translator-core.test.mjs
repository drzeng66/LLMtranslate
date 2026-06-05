import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  endpointAllowed,
  normalizeBaseUrl,
  normalizeSettings,
  buildChatRequest,
  buildCompletionRequest,
  completionEndpoint,
  extractTranslations,
  extractCompletionTranslation,
  splitDocumentIntoSegments,
  makeDocxPlainText,
} from "../lib/translator-core.js";

test("default settings allow local and configured frp endpoint", () => {
  assert.equal(DEFAULT_SETTINGS.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(DEFAULT_SETTINGS.remoteBaseUrl, "http://frp4.ccszxc.site:14688/v1");
  assert.equal(endpointAllowed("http://127.0.0.1:8080/v1/chat/completions"), true);
  assert.equal(endpointAllowed("http://localhost:8080/v1/models"), true);
  assert.equal(endpointAllowed("http://frp4.ccszxc.site:14688/v1/chat/completions"), true);
  assert.equal(endpointAllowed("http://frp4.ccszxc.site:14668/v1/chat/completions"), true);
  assert.equal(endpointAllowed("https://example.com/v1/chat/completions"), false);
});

test("normalizeSettings switches between local and remote endpoints", () => {
  assert.equal(normalizeSettings({ endpointMode: "remote" }).baseUrl, "http://frp4.ccszxc.site:14688/v1");
  assert.equal(normalizeSettings({ endpointMode: "local" }).baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(normalizeSettings({ endpointMode: "custom", baseUrl: "http://frp4.ccszxc.site:14688/v1/" }).baseUrl, "http://frp4.ccszxc.site:14688/v1");
});

test("normalizeBaseUrl accepts llama.cpp web UI URLs and converts them to OpenAI API base URLs", () => {
  assert.equal(normalizeBaseUrl("http://frp4.ccszxc.site:14688/#"), "http://frp4.ccszxc.site:14688/v1");
  assert.equal(normalizeBaseUrl("http://frp4.ccszxc.site:14688/"), "http://frp4.ccszxc.site:14688/v1");
  assert.equal(normalizeBaseUrl("http://frp4.ccszxc.site:14688/v1#ignored"), "http://frp4.ccszxc.site:14688/v1");
});

test("single translation request uses low latency defaults", () => {
  const req = buildChatRequest({ ...DEFAULT_SETTINGS, model: "gemma.gguf" }, [{ id: "p1", text: "Hello world." }]);
  assert.equal(req.model, "gemma.gguf");
  assert.equal(req.temperature, 0);
  assert.equal(req.stream, false);
  assert.equal(req.max_tokens, 384);
});

test("page translation defaults favor local throughput and compact bilingual layout", () => {
  assert.equal(DEFAULT_SETTINGS.batchSize, 6);
  assert.equal(DEFAULT_SETTINGS.parallelRequests, 2);
  assert.equal(DEFAULT_SETTINGS.layoutMode, "compact");
  const normalized = normalizeSettings({ batchSize: 20, parallelRequests: 9, layoutMode: "invalid" });
  assert.equal(normalized.batchSize, 12);
  assert.equal(normalized.parallelRequests, 4);
  assert.equal(normalized.layoutMode, "compact");
});

test("multi-item page requests are sent as one JSON batch with enough output budget", () => {
  const req = buildChatRequest(
    { ...DEFAULT_SETTINGS, model: "gemma.gguf" },
    [
      { id: "p1", text: "Hello world." },
      { id: "p2", text: "Open settings." },
      { id: "p3", text: "Read later." },
      { id: "p4", text: "Search feeds." },
    ],
  );
  assert.match(req.messages[0].content, /Return JSON array only/);
  assert.equal(req.max_tokens >= 2048, true);
  assert.equal(JSON.parse(req.messages[1].content).length, 4);
});

test("llama.cpp native completion endpoint is derived from the web UI root", () => {
  assert.equal(completionEndpoint("http://frp4.ccszxc.site:14688/v1"), "http://frp4.ccszxc.site:14688/completion");
  assert.equal(completionEndpoint("http://frp4.ccszxc.site:14688/#"), "http://frp4.ccszxc.site:14688/completion");
});

test("llama.cpp native completion request translates a single item without OpenAI /v1", () => {
  const req = buildCompletionRequest(
    { ...DEFAULT_SETTINGS, targetLanguage: "简体中文" },
    { id: "p1", text: "Hello world." },
    { maxTokens: 128 },
  );
  assert.equal(req.stream, false);
  assert.equal(req.temperature, 0);
  assert.equal(req.n_predict, 128);
  assert.match(req.prompt, /Translate/);
  assert.match(req.prompt, /Hello world\./);
  assert.doesNotMatch(JSON.stringify(req), /messages/);
});

test("llama.cpp native completion response is converted to extension translation format", () => {
  const result = extractCompletionTranslation({ content: "你好，世界。" }, "p1");
  assert.deepEqual(result, [{ id: "p1", translation: "你好，世界。" }]);
});

test("document translation request uses medical long-form settings", () => {
  const req = buildChatRequest(
    { ...DEFAULT_SETTINGS, model: "gemma.gguf" },
    [{ id: "doc-1", text: "Patients with acute myocardial infarction were enrolled in the study." }],
    { mode: "document", maxTokens: 4096 },
  );
  assert.equal(req.model, "gemma.gguf");
  assert.equal(req.temperature, 0);
  assert.equal(req.stream, false);
  assert.equal(req.max_tokens, 4096);
  assert.match(req.messages[0].content, /medical academic PDF/i);
  assert.match(req.messages[0].content, /Do not summarize/i);
  assert.doesNotMatch(req.messages[0].content, /Return JSON array/i);
});

test("context overflow errors are recognized for automatic clear and retry", async () => {
  const { isContextOverflowError } = await import("../lib/translator-core.js");
  assert.equal(isContextOverflowError("context shift is disabled"), true);
  assert.equal(isContextOverflowError("prompt exceeds context window"), true);
  assert.equal(isContextOverflowError("slot context is full"), true);
  assert.equal(isContextOverflowError("ordinary network error"), false);
});

test("document segmentation avoids oversized chunks and preserves ids", () => {
  const text = Array.from({ length: 80 }, (_, i) => `Sentence ${i + 1} has enough English text for translation.`).join(" ");
  const chunks = splitDocumentIntoSegments(text, { maxChars: 500, minChars: 120 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((item, index) => item.id === `doc-${index + 1}`));
  assert.ok(chunks.every((item) => item.text.length <= 650));
});

test("document segmentation supports larger literature chunks", () => {
  const text = Array.from({ length: 140 }, (_, i) => `Clinical sentence ${i + 1} reports treatment outcomes and adverse events.`).join(" ");
  const chunks = splitDocumentIntoSegments(text, { maxChars: 2200, minChars: 600 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((item) => item.text.length <= 2860));
});

test("document segmentation honors the 3000 character UI limit", () => {
  const text = Array.from({ length: 480 }, () => "alpha").join(" ");
  const chunks = splitDocumentIntoSegments(text, { maxChars: 3000, minChars: 600 });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.length > 2400);
});

test("single plain-text translations keep medical citation brackets instead of treating them as JSON", () => {
  const response = {
    choices: [{ message: { content: "研究显示该治疗可以降低死亡率 [1,2]。" } }],
  };
  const result = extractTranslations(response, new Set(["doc-1"]));
  assert.deepEqual(result, [{ id: "doc-1", translation: "研究显示该治疗可以降低死亡率 [1,2]。" }]);
});

test("single plain-text translations may start with reference brackets", () => {
  const response = {
    choices: [{ message: { content: "[1] 这是一项随机对照研究。" } }],
  };
  const result = extractTranslations(response, new Set(["doc-1"]));
  assert.deepEqual(result, [{ id: "doc-1", translation: "[1] 这是一项随机对照研究。" }]);
});

test("single plain-text translations are not failed just because a chunk ends with a comma", () => {
  const response = {
    choices: [{ message: { content: "该研究纳入了高危患者，" } }],
  };
  const result = extractTranslations(response, new Set(["doc-1"]));
  assert.deepEqual(result, [{ id: "doc-1", translation: "该研究纳入了高危患者，" }]);
});

test("single translations still accept valid JSON object responses", () => {
  const response = {
    choices: [{ message: { content: '{"id":"doc-1","translation":"有效译文。"}' } }],
  };
  const result = extractTranslations(response, new Set(["doc-1"]));
  assert.deepEqual(result, [{ id: "doc-1", translation: "有效译文。" }]);
});

test("single translations still accept valid JSON array responses", () => {
  const response = {
    choices: [{ message: { content: '[{"id":"doc-1","translation":"有效译文。"}]' } }],
  };
  const result = extractTranslations(response, new Set(["doc-1"]));
  assert.deepEqual(result, [{ id: "doc-1", translation: "有效译文。" }]);
});

test("docx text xml is converted into paragraph text", () => {
  const xml = `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second &amp; third</w:t></w:r></w:p></w:body></w:document>`;
  assert.equal(makeDocxPlainText(xml), "First\n\nSecond & third");
});
