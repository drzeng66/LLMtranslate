import { DEFAULT_SETTINGS, normalizeSettings } from "./lib/translator-core.js";

const fields = {
  endpointMode: document.getElementById("endpoint-mode"),
  baseUrl: document.getElementById("base-url"),
  remoteBaseUrl: document.getElementById("remote-base-url"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("api-key"),
  targetLanguage: document.getElementById("target-language"),
  batchSize: document.getElementById("batch-size"),
  parallelRequests: document.getElementById("parallel-requests"),
  layoutMode: document.getElementById("layout-mode"),
  selectionTranslationEnabled: document.getElementById("selection-translation-enabled"),
  minTextLength: document.getElementById("min-text-length"),
  maxChunkChars: document.getElementById("max-chunk-chars"),
  retryCount: document.getElementById("retry-count"),
  timeoutMs: document.getElementById("timeout-ms"),
};
const status = document.getElementById("status");

function render(settings) {
  const normalized = normalizeSettings(settings);
  for (const [key, input] of Object.entries(fields)) {
    if (input.type === "checkbox") input.checked = Boolean(normalized[key]);
    else input.value = normalized[key];
  }
}

function readForm() {
  return normalizeSettings({
    endpointMode: fields.endpointMode.value,
    baseUrl: fields.baseUrl.value.trim(),
    remoteBaseUrl: fields.remoteBaseUrl.value.trim(),
    model: fields.model.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    targetLanguage: fields.targetLanguage.value.trim(),
    batchSize: Number(fields.batchSize.value),
    parallelRequests: Number(fields.parallelRequests.value),
    layoutMode: fields.layoutMode.value,
    selectionTranslationEnabled: fields.selectionTranslationEnabled.checked,
    minTextLength: Number(fields.minTextLength.value),
    maxChunkChars: Number(fields.maxChunkChars.value),
    retryCount: Number(fields.retryCount.value),
    timeoutMs: Number(fields.timeoutMs.value),
  });
}

async function loadSettings() {
  render(await chrome.storage.local.get(DEFAULT_SETTINGS));
}

async function saveSettings(event) {
  event.preventDefault();
  const settings = readForm();
  await chrome.storage.local.set(settings);
  status.textContent = `设置已保存\n当前接口：${settings.baseUrl}`;
}

async function resetSettings() {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  render(DEFAULT_SETTINGS);
  status.textContent = "已恢复默认值";
}

async function testConnection() {
  status.textContent = "正在测试连接…";
  const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
  status.textContent = response?.ok
    ? `连接成功\n检测到模型：${response.models.join(", ") || "未列出模型"}`
    : `连接失败：${response?.error || "未知错误"}`;
}

document.getElementById("settings-form").addEventListener("submit", saveSettings);
document.getElementById("reset").addEventListener("click", resetSettings);
document.getElementById("test-connection").addEventListener("click", testConnection);
document.getElementById("open-document").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_DOCUMENT_TRANSLATOR" }));
loadSettings();
