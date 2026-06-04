import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const documentJs = readFileSync(new URL("../document.js", import.meta.url), "utf8");
const documentHtml = readFileSync(new URL("../document.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");

test("document translator sends optimized document options to the background worker", () => {
  assert.match(documentJs, /mode:\s*"document"/);
  assert.match(documentJs, /maxChunkChars:\s*maxChars/);
  assert.match(documentJs, /maxTokens:\s*4096/);
});

test("document page shows a parse summary before translation starts", () => {
  assert.match(documentHtml, /id="doc-summary"/);
  assert.match(documentJs, /updateDocumentSummary\(\)/);
  assert.match(documentJs, /医学文献优化/);
  assert.match(documentJs, /提取字符/);
});

test("document translator clears model context before and after a document", () => {
  assert.match(documentJs, /clearModelContext\("开始翻译前清空模型上下文",\s*\{\s*optional:\s*true\s*\}\)/);
  assert.match(documentJs, /clearModelContext\("文档翻译结束后清空模型上下文",\s*\{\s*optional:\s*true\s*\}\)/);
  assert.match(documentJs, /clearModelContext\("重新翻译失败段前清空模型上下文",\s*\{\s*optional:\s*true\s*\}\)/);
  assert.match(documentJs, /clearModelContext\("重新翻译失败段后清空模型上下文",\s*\{\s*optional:\s*true\s*\}\)/);
  assert.match(documentJs, /清空上下文不可用，继续翻译/);
});

test("document translator defaults to larger literature chunks", () => {
  assert.match(documentHtml, /id="max-chars"[^>]+max="3000"[^>]+value="2200"/);
});

test("document preview does not rebuild the full two-column DOM after every translated segment", () => {
  const loopMatch = documentJs.match(/for \(let index = 0; index < segments\.length; index \+= 1\) \{[\s\S]*?\n  \}/);
  assert.ok(loopMatch);
  assert.doesNotMatch(loopMatch[0], /renderBilingualPreview\(\)/);
  assert.match(documentJs, /updateTranslationPreview\(\)/);
});

test("document translation falls back to smaller chunks before failing a paragraph", () => {
  assert.match(serviceWorker, /documentFallbackChunkLimits/);
  assert.match(serviceWorker, /options\.mode === "document"/);
  assert.match(serviceWorker, /for \(const limit of chunkLimits\)/);
  assert.match(serviceWorker, /1200,\s*800,\s*500/);
});

test("connection test falls back to native llama.cpp completion when OpenAI endpoints are unavailable", () => {
  assert.match(serviceWorker, /testMinimalChatCompletion/);
  assert.match(serviceWorker, /testMinimalNativeCompletion/);
  assert.match(serviceWorker, /原生 completion 接口可用/);
  assert.match(serviceWorker, /listModels\(\)/);
});

test("translation requests fall back to native llama.cpp completion after OpenAI API errors", () => {
  assert.match(serviceWorker, /requestNativeCompletionOnce/);
  assert.match(serviceWorker, /shouldTryNativeCompletion/);
  assert.match(serviceWorker, /completionEndpoint/);
});

test("document page has human-friendly errors and a failed-segment retry action", () => {
  assert.match(documentHtml, /id="retry-failed"/);
  assert.match(documentJs, /humanizeError/);
  assert.match(documentJs, /重新翻译失败段/);
  assert.match(documentJs, /retryFailedTranslations/);
  assert.match(documentJs, /模型返回为空/);
  assert.match(documentJs, /当前模型服务不支持自动清空上下文/);
});
