import { isContextOverflowError, splitDocumentIntoSegments } from "./lib/translator-core.js";
import { buildBilingualColumns, buildBilingualHtml } from "./lib/document-renderer.js";
import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const fileInput = document.getElementById("file");
const dropZone = document.getElementById("drop-zone");
const translateBtn = document.getElementById("translate");
const stopBtn = document.getElementById("stop");
const downloadBtn = document.getElementById("download");
const retryFailedBtn = document.getElementById("retry-failed");
const clearContextBtn = document.getElementById("clear-context");
const maxCharsInput = document.getElementById("max-chars");
const docSummary = document.getElementById("doc-summary");
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

function humanizeError(errorOrMessage) {
  const message = String(errorOrMessage?.message || errorOrMessage || "");
  const lower = message.toLowerCase();
  if (message.includes("HTTP 501") || message.includes("--slot-save-path")) {
    return "当前模型服务不支持自动清空上下文，已继续翻译。";
  }
  if (lower.includes("content is empty") || lower.includes("missing model response")) {
    return "模型返回为空，已自动缩小分段重试；如果仍失败，可点击“重新翻译失败段”。";
  }
  if (lower.includes("incomplete") || lower.includes("json")) {
    return "模型返回不完整，已自动缩小分段重试；如果仍失败，可点击“重新翻译失败段”。";
  }
  if (lower.includes("timeout") || message.includes("超过")) {
    return "该段等待时间过长，已停止等待；可以稍后点击“重新翻译失败段”。";
  }
  if (isContextOverflowError(message)) {
    return "上下文过长，正在清理或缩小分段后重试。";
  }
  return message || "未知错误";
}

async function clearModelContext(reason, { optional = false } = {}) {
  setStatus(`${reason}…`);
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_CONTEXT" });
  if (!response?.ok) {
    const message = response?.error || "清空模型上下文失败";
    if (optional) {
      setStatus(`清空上下文不可用，继续翻译：${humanizeError(message)}`);
      return { ok: false, error: message };
    }
    throw new Error(humanizeError(message));
  }
  return response;
}

function isFailedTranslation(item) {
  return String(item?.translation || "").startsWith("翻译失败：");
}

function failedTranslations() {
  return translations.filter(isFailedTranslation);
}

function syncActionButtons() {
  retryFailedBtn.disabled = !failedTranslations().length;
  downloadBtn.disabled = !translations.length;
}

function upsertTranslation(segment, translation) {
  const index = translations.findIndex((item) => item.id === segment.id);
  const item = { ...segment, translation };
  if (index >= 0) translations[index] = item;
  else translations.push(item);
  syncActionButtons();
}

function updateDocumentSummary() {
  if (!sourceText) {
    docSummary.textContent = "尚未选择文档。拖入 PDF、DOCX 或 TXT 后，会先显示解析摘要，再由你决定是否开始翻译。";
    return;
  }
  docSummary.textContent = [
    `文件：${currentFile?.name || "文档"}`,
    `提取字符：${sourceText.length.toLocaleString("zh-CN")}`,
    `对照段落：${segments.length}`,
    "推荐模式：医学文献优化",
    `每段最大字符：${currentMaxChars()}`,
  ].join("\n");
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
  syncActionButtons();
  updateDocumentSummary();
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
  retryFailedBtn.disabled = true;
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
      upsertTranslation(segment, translation);
      updateTranslationPreview();
    } catch (error) {
      upsertTranslation(segment, `翻译失败：${humanizeError(error)}`);
      updateTranslationPreview();
    }
  }
  stopBtn.disabled = true;
  translateBtn.disabled = false;
  syncActionButtons();
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
  await clearModelContext("检测到上下文超限，正在清空后重试当前段", { optional: true });
  response = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error || "模型请求失败");
  return response;
}

async function retryFailedTranslations() {
  const failed = failedTranslations();
  if (!failed.length) {
    setStatus("没有需要重新翻译的失败段。");
    return;
  }
  const maxChars = Math.min(currentMaxChars(), 1200);
  retryFailedBtn.disabled = true;
  translateBtn.disabled = true;
  await clearModelContext("重新翻译失败段前清空模型上下文", { optional: true });
  for (let index = 0; index < failed.length; index += 1) {
    if (cancelled) break;
    const segment = segments.find((item) => item.id === failed[index].id) || failed[index];
    setStatus(`正在重新翻译失败段：${index + 1} / ${failed.length}`);
    try {
      const response = await translateDocumentSegment(segment, maxChars);
      upsertTranslation(segment, response.translations?.[0]?.translation || "");
    } catch (error) {
      upsertTranslation(segment, `翻译失败：${humanizeError(error)}`);
    }
    updateTranslationPreview();
  }
  await clearModelContext("重新翻译失败段后清空模型上下文", { optional: true });
  translateBtn.disabled = false;
  syncActionButtons();
  setStatus(failedTranslations().length ? `仍有 ${failedTranslations().length} 段失败，可稍后再次重试。` : "失败段已重新翻译完成。");
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
retryFailedBtn.addEventListener("click", () => retryFailedTranslations().catch((error) => setStatus(`重新翻译失败段出错：${humanizeError(error)}`)));
downloadBtn.addEventListener("click", downloadBilingualHtml);
clearContextBtn.addEventListener("click", async () => {
  try {
    await clearModelContext("正在清空模型上下文");
    setStatus("模型上下文已清空");
  } catch (error) {
    setStatus(`清空失败：${error.message}`);
  }
});
