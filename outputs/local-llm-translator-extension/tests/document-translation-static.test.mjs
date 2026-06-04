import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const documentJs = readFileSync(new URL("../document.js", import.meta.url), "utf8");
const documentHtml = readFileSync(new URL("../document.html", import.meta.url), "utf8");

test("document translator sends optimized document options to the background worker", () => {
  assert.match(documentJs, /mode:\s*"document"/);
  assert.match(documentJs, /maxChunkChars:\s*maxChars/);
  assert.match(documentJs, /maxTokens:\s*4096/);
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
