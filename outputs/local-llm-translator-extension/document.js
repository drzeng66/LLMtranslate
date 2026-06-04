import { splitDocumentIntoSegments } from "./lib/translator-core.js";
import { buildBilingualRows, buildBilingualHtml } from "./lib/document-renderer.js";
import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const fileInput = document.getElementById("file");
const dropZone = document.getElementById("drop-zone");
const translateBtn = document.getElementById("translate");
const stopBtn = document.getElementById("stop");
const downloadBtn = document.getElementById("download");
const clearContextBtn = document.getElementById("clear-context");
const maxCharsInput = document.getElementById("max-chars");
const status = document.getElementById("status");
const preview = document.getElementById("preview");

let currentFile = null;
let sourceText = "";
let segments = [];
let translations = [];
let cancelled = false;

function setStatus(text) { status.textContent = text; }

function renderBilingualPreview() {
  const rows = buildBilingualRows(segments, translations);
  preview.innerHTML = "";
  preview.className = "bilingual-preview";
  for (const row of rows) {
    const box = document.createElement("section");
    box.className = `bilingual-row ${row.status}`;
    box.dataset.id = row.id;
    box.innerHTML = `
      <div class="row-index">${row.index}</div>
      <article class="source-pane"><h2>原文</h2><p></p></article>
      <article class="translation-pane"><h2>译文</h2><p></p></article>
    `;
    box.querySelector(".source-pane p").textContent = row.source;
    box.querySelector(".translation-pane p").textContent = row.translation;
    preview.appendChild(box);
  }
}

async function readFile(file) {
  currentFile = file;
  setStatus(`正在解析：${file.name}`);
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf") || file.type === "application/pdf") sourceText = await readPdf(file);
  else if (lower.endsWith(".docx")) sourceText = await readDocx(file);
  else sourceText = await file.text();
  buildSegments();
}

function buildSegments() {
  const maxChars = Number(maxCharsInput.value) || 900;
  segments = splitDocumentIntoSegments(sourceText, { maxChars, minChars: 180 });
  translations = [];
  cancelled = false;
  renderBilingualPreview();
  translateBtn.disabled = !segments.length;
  downloadBtn.disabled = true;
  setStatus(segments.length ? `解析完成：${currentFile?.name || "文档"}\n已生成全文中英文对照视图，共 ${segments.length} 个对照段落。` : "没有提取到可翻译文本。PDF 如果是扫描件，需要 OCR 后再翻译。");
}

async function readPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    if (pageText) pages.push(pageText);
    setStatus(`正在解析 PDF：${pageNo} / ${pdf.numPages} 页`);
  }
  return pages.join("\n\n");
}

async function readDocx(file) {
  if (!globalThis.mammoth?.extractRawText) throw new Error("DOCX 解析库未加载");
  const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value || "";
}

async function translateDocument() {
  cancelled = false;
  translateBtn.disabled = true;
  stopBtn.disabled = false;
  downloadBtn.disabled = true;
  translations = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (cancelled) break;
    const segment = segments[index];
    const rowNode = preview.querySelector(`[data-id="${segment.id}"]`);
    const node = rowNode?.querySelector(".translation-pane p");
    rowNode?.classList.remove("failed", "done", "pending");
    rowNode?.classList.add("pending");
    node.textContent = `正在翻译 ${index + 1} / ${segments.length}…`;
    setStatus(`正在翻译：${index + 1} / ${segments.length}\n${currentFile?.name || "文档"}`);
    try {
      const response = await chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", items: [segment] });
      if (!response?.ok) throw new Error(response?.error || "模型请求失败");
      const translation = response.translations?.[0]?.translation || "";
      translations.push({ ...segment, translation });
      rowNode?.classList.remove("pending", "failed");
      rowNode?.classList.add("done");
      node.textContent = translation;
    } catch (error) {
      translations.push({ ...segment, translation: `翻译失败：${error.message}` });
      rowNode?.classList.remove("pending", "done");
      rowNode?.classList.add("failed");
      node.textContent = `翻译失败：${error.message}`;
    }
  }
  stopBtn.disabled = true;
  translateBtn.disabled = false;
  downloadBtn.disabled = !translations.length;
  setStatus(cancelled ? `已停止：完成 ${translations.length} / ${segments.length} 个对照段落` : `翻译完成：${translations.length} / ${segments.length} 个对照段落`);
}

function downloadBilingualHtml() {
  const name = (currentFile?.name || "document").replace(/\.[^.]+$/, "");
  const rows = buildBilingualRows(segments, translations);
  const content = buildBilingualHtml({ title: currentFile?.name || "中英文对照文档", rows });
  const blob = new Blob([content], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.bilingual.html`;
  a.click();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener("change", () => fileInput.files?.[0] && readFile(fileInput.files[0]).catch((error) => setStatus(`解析失败：${error.message}`)));
for (const eventName of ["dragenter", "dragover"]) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("drag"); });
for (const eventName of ["dragleave", "drop"]) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("drag"); });
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) readFile(file).catch((error) => setStatus(`解析失败：${error.message}`));
});
maxCharsInput.addEventListener("change", () => sourceText && buildSegments());
translateBtn.addEventListener("click", () => translateDocument().catch((error) => setStatus(`翻译失败：${error.message}`)));
stopBtn.addEventListener("click", () => { cancelled = true; });
downloadBtn.addEventListener("click", downloadBilingualHtml);
clearContextBtn.addEventListener("click", async () => {
  setStatus("正在清空模型上下文…");
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_CONTEXT" });
  setStatus(response?.ok ? "模型上下文已清空" : `清空失败：${response?.error || "未知错误"}`);
});
