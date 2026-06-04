import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBilingualRows,
  buildBilingualHtml,
} from "../lib/document-renderer.js";

test("buildBilingualRows keeps full source order and pairs translations", () => {
  const segments = [
    { id: "doc-1", text: "First paragraph." },
    { id: "doc-2", text: "Second paragraph." },
  ];
  const translations = [
    { id: "doc-1", translation: "第一段。" },
    { id: "doc-2", translation: "第二段。" },
  ];
  const rows = buildBilingualRows(segments, translations);
  assert.deepEqual(rows, [
    { id: "doc-1", index: 1, source: "First paragraph.", translation: "第一段。", status: "done" },
    { id: "doc-2", index: 2, source: "Second paragraph.", translation: "第二段。", status: "done" },
  ]);
});

test("buildBilingualRows shows pending rows instead of segment cards", () => {
  const rows = buildBilingualRows([{ id: "doc-1", text: "Full source." }], []);
  assert.equal(rows[0].source, "Full source.");
  assert.equal(rows[0].translation, "待翻译");
  assert.equal(rows[0].status, "pending");
});

test("buildBilingualHtml creates a complete side-by-side document and escapes html", () => {
  const html = buildBilingualHtml({
    title: "Paper <Title>",
    rows: [
      { id: "doc-1", index: 1, source: "A < B", translation: "甲 < 乙", status: "done" },
    ],
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /class="bilingual-document"/);
  assert.match(html, /class="source-pane"/);
  assert.match(html, /class="translation-pane"/);
  assert.match(html, /Paper &lt;Title&gt;/);
  assert.match(html, /A &lt; B/);
  assert.match(html, /甲 &lt; 乙/);
});
