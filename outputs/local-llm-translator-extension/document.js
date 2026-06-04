import { isContextOverflowError, splitDocumentIntoSegments } from "./lib/translator-core.js";
import { buildBilingualColumns, buildBilingualHtml } from "./lib/document-renderer.js";
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
let sourcePreviewBody = null;
let translationPreviewBody = null;

function setStatus(text) { status.textContent = text; }

function currentMaxChars() {
  return Number(maxCharsInput.value) || 2200;
}

async function clearModelContext(reason, { optional = false } = {}) {
  setStatus(`${reason}…`);
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_CONTEXT" });
  if (!response?.ok) {
    const message = response?.error || "清空模型上下文失败";
    if (optional) {
      setStatus(`清空上下文不可用，继续翻译：${message}`);
      return { ok: false, error: message };
    }
    throw new Error(message);
  }
  return response;
}

function renderBilingualPreview() {
  const columns = buildBilingualColumns(segments, translations);
  preview.innerHTML = "";
  preview.className = `bilingual-preview ${columns.status}`;

  const layout = document.createElement("section");
  layout.className = `full-bilingual-layout ${columns.status}`;

  const sourcePane = document.createElement("article");
  sourcePane.className = "source-pane";
  const sourceTitle = document.createElement("h2");
  sourceTitle.textContent = "原文全文";
  const sourceBody = document.createElement("div");
  sourceBody.className = "full-text";
  sourceBody.textContent = columns.sourceText;
  sourcePreviewBody = sourceBody;
  sourcePane.append(sourceTitle, sourceBody);

  const translationPane = document.createElement("article");
  translationPane.className = "translation-pane";
  const translationTitle = document.createElement("h2");
  translationTitle.textContent = "译文全文";
  const translationBody = document.createElement("div");
  translationBody.className = "full-text";
  translationBody.textContent = columns.translationText;
  translationPreviewBody = translationBody;
  translationPane.append(translationTitle, translationBody);

  layout.append(sourcePane, translationPane);
  preview.appendChild(layout);
}

function updateTranslationPreview() {
  if (!sourcePreviewBody || !translationPreviewBody) {
    renderBilingualPreview();
    return;
  }
  const columns = buildBilingualColumns(segments, translations);
  preview.className = `bilingual-preview ${columns.status}`;
  const layout = preview.querySelector(".full-bilingual-layout");
  if (layout) layout.className = `full-bilingual-layout ${columns.status}`;
  sourcePreviewBody.textContent = columns.sourceText;
  translationPreviewBody.textContent = columns.translationText;
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
  const maxChars = currentMaxChars();
  segments = splitDocumentIntoSegments(sourceText, { maxChars, minChars: 600 });
  translations = [];
  cancelled = false;
  sourcePreviewBody = null;
  translationPreviewBody = null;
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
  const maxChars = currentMaxChars();
  cancelled = false;
  translateBtn.disabled = true;
  stopBtn.disabled = false;
  downloadBtn.disabled = true;
  translations = [];
  renderBilingualPreview();
  await clearModelContext("开始翻译前清空模型上下文", { optional: true });
  for (let index = 0; index < segments.length; index += 1) {
    if (cancelled) break;
    const segment = segments[index];
    setStatus(`正在翻译：${index + 1} / ${segments.length}\n${currentFile?.name || "文档"}`);
    try {
      const response = await translateDocumentSegment(segment, maxChars);
      const translation = response.translations?.[0]?.translation || "";
      translations.push({ ...segment, translation });
      updateTranslationPreview();
    } catch (error) {
      translations.push({ ...segment, translation: `翻译失败：${error.message}` });
      updateTranslationPreview();
    }
  }
  stopBtn.disabled = true;
  translateBtn.disabled = false;
  downloadBtn.disabled = !translations.length;
  await clearModelContext("文档翻译结束后清空模型上下文", { optional: true });
  setStatus(cancelled ? `已停止：完成 ${translations.length} / ${segments.length} 个对照段落` : `翻译完成：${translations.length} / ${segments.length} 个对照段落`);
}

async function translateDocumentSegment(segment, maxChars) {
  const request = {
    type: "TRANSLATE_BATCH",
    items: [segment],
    options: { mode: "document", maxChunkChars: maxChars, maxTokens: 4096 },
  };
  let response = await chrome.runtime.sendMessage(request);
  if (response?.ok) return response;
  const errorMessage = response?.error || "模型请求失败";
  if (!isContextOverflowError(errorMessage)) throw new Error(errorMessage);
  await clearModelContext("检测到上下文超限，正在清空后重试当前段");
  response = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error || "模型请求失败");
  return response;
}

function downloadBilingualHtml() {
  const name = (currentFile?.name || "document").replace(/\.[^.]+$/, "");
  const columns = buildBilingualColumns(segments, translations);
  const content = buildBilingualHtml({ title: currentFile?.name || "中英文对照文档", columns });
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
  try {
    await clearModelContext("正在清空模型上下文");
    setStatus("模型上下文已清空");
  } catch (error) {
    setStatus(`清空失败：${error.message}`);
  }
});
