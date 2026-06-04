import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBilingualColumns,
  buildBilingualHtml,
} from "../lib/document-renderer.js";

test("buildBilingualColumns builds full source and full translation columns", () => {
  const segments = [
    { id: "doc-1", text: "First paragraph." },
    { id: "doc-2", text: "Second paragraph." },
  ];
  const translations = [
    { id: "doc-1", translation: "第一段。" },
    { id: "doc-2", translation: "第二段。" },
  ];
  const columns = buildBilingualColumns(segments, translations);
  assert.equal(columns.sourceText, "First paragraph.\n\nSecond paragraph.");
  assert.equal(columns.translationText, "第一段。\n\n第二段。");
  assert.equal(columns.status, "done");
});

test("buildBilingualColumns preserves full source and pending translation placeholders", () => {
  const columns = buildBilingualColumns([{ id: "doc-1", text: "Full source." }], []);
  assert.equal(columns.sourceText, "Full source.");
  assert.equal(columns.translationText, "【1】待翻译");
  assert.equal(columns.status, "pending");
});

test("buildBilingualColumns keeps failed paragraphs in the full translation column", () => {
  const columns = buildBilingualColumns(
    [{ id: "doc-1", text: "Source paragraph." }],
    [{ id: "doc-1", translation: "翻译失败：model response content is empty" }],
  );
  assert.match(columns.translationText, /【1】该段翻译失败/);
  assert.match(columns.translationText, /model response content is empty/);
  assert.equal(columns.status, "failed");
});

test("buildBilingualHtml creates two full-length side-by-side columns and escapes html", () => {
  const html = buildBilingualHtml({
    title: "Paper <Title>",
    columns: { sourceText: "A < B\n\nC", translationText: "甲 < 乙\n\n丙", status: "done", translatedCount: 2, totalCount: 2 },
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /class="bilingual-document"/);
  assert.match(html, /class="source-pane"/);
  assert.match(html, /class="translation-pane"/);
  assert.match(html, /Paper &lt;Title&gt;/);
  assert.match(html, /A &lt; B/);
  assert.match(html, /甲 &lt; 乙/);
  assert.doesNotMatch(html, /class="bilingual-row"/);
});
