import {
  DEFAULT_SETTINGS,
  assertAllowedEndpoint,
  authHeaders,
  buildChatRequest,
  chatEndpoint,
  extractTranslations,
  modelsEndpoint,
  normalizeSettings,
  rootEndpoint,
  splitTextForTranslation,
} from "./lib/translator-core.js";

async function getSettings() {
  return normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
}

async function ensureInjected(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content-style.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有可操作的当前标签页");
  return tab;
}

async function sendCommandToActiveTab(command, extra = {}) {
  const tab = await activeTab();
  await ensureInjected(tab.id);
  return await chrome.tabs.sendMessage(tab.id, { type: command, ...extra });
}

async function showStartupError(tabId, message) {
  try {
    await ensureInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "SHOW_TRANSLATION_ERROR", error: message });
  } catch {
    console.warn("Unable to show translation startup error:", message);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await ensureInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_TRANSLATION" });
  } catch (error) {
    console.warn("Unable to translate this page:", error);
    await showStartupError(tab.id, error.message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TRANSLATE_BATCH") {
    translateBatch(message.items)
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "TEST_CONNECTION") {
    listModels()
      .then((models) => sendResponse({ ok: true, models }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "CLEAR_CONTEXT") {
    clearServerContext()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "OPEN_DOCUMENT_TRANSLATOR") {
    chrome.tabs.create({ url: chrome.runtime.getURL("document.html") });
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "ACTIVE_TAB_COMMAND") {
    sendCommandToActiveTab(message.command, message.extra || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function translateBatch(items) {
  if (items.length === 1) return [await translateItemWithChunks(items[0])];
  const translatedItems = [];
  for (const item of items) translatedItems.push(await translateItemWithChunks(item));
  return translatedItems;
}

async function translateItemWithChunks(item) {
  const settings = await getSettings();
  const chunks = splitTextForTranslation(item.text, settings.maxChunkChars);
  if (chunks.length === 1) {
    const [translation] = await translateOneChunk({ ...item, text: chunks[0] }, settings);
    return { id: item.id, translation: translation.translation };
  }
  const translatedChunks = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkItem = { id: item.id, text: chunks[index] };
    const [translation] = await translateOneChunk(chunkItem, settings);
    translatedChunks.push(translation.translation);
  }
  return { id: item.id, translation: joinTranslatedChunks(translatedChunks) };
}

function joinTranslatedChunks(chunks) {
  return chunks.reduce((combined, chunk) => {
    const text = String(chunk || "").trim();
    if (!text) return combined;
    if (!combined) return text;
    return /[。！？.!?：:]$/.test(combined) ? `${combined}${text}` : `${combined}。${text}`;
  }, "");
}

async function translateOneChunk(itemsOrItem, knownSettings) {
  const items = Array.isArray(itemsOrItem) ? itemsOrItem : [itemsOrItem];
  const settings = knownSettings || (await getSettings());
  let lastError;
  for (let attempt = 1; attempt <= settings.retryCount; attempt += 1) {
    try {
      return await requestTranslationOnce(items, settings);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function requestTranslationOnce(items, settings) {
  const endpoint = assertAllowedEndpoint(chatEndpoint(settings.baseUrl));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify(buildChatRequest(settings, items)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}`);
    return extractTranslations(await response.json(), new Set(items.map((item) => item.id)));
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`单段翻译超过 ${Math.round(settings.timeoutMs / 1000)} 秒，已停止`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function listModels() {
  const settings = await getSettings();
  const endpoint = assertAllowedEndpoint(modelsEndpoint(settings.baseUrl));
  const response = await fetch(endpoint, { headers: authHeaders(settings) });
  if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.data || payload.models || []).map((model) => model.id || model.name || model.model).filter(Boolean);
}

async function clearServerContext() {
  const settings = await getSettings();
  const endpoint = assertAllowedEndpoint(`${rootEndpoint(settings.baseUrl)}/slots/0?action=erase`);
  const response = await fetch(endpoint, { method: "POST", headers: authHeaders(settings) });
  if (!response.ok) throw new Error(`清空上下文失败 HTTP ${response.status}；确认启动参数包含 --slot-save-path`);
  return await response.json().catch(() => ({}));
}
