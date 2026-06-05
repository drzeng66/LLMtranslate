import {
  DEFAULT_SETTINGS,
  assertAllowedEndpoint,
  authHeaders,
  buildChatRequest,
  buildCompletionRequest,
  classifySelectionText,
  chatEndpoint,
  completionEndpoint,
  extractCompletionTranslation,
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
    await chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_ARTICLE" });
  } catch (error) {
    console.warn("Unable to translate this page:", error);
    await showStartupError(tab.id, error.message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TRANSLATE_BATCH") {
    translateBatch(message.items, message.options || {})
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "TRANSLATE_SELECTION") {
    translateSelection(message.text)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "TEST_CONNECTION") {
    testConnection()
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

async function translateSelection(text) {
  const mode = classifySelectionText(text);
  if (mode === "none") throw new Error("没有可翻译的选中文本");
  const item = { id: `selection-${Date.now()}`, text: String(text || "").replace(/\s+/g, " ").trim() };
  const options = {
    mode: mode === "word" ? "selection-word" : "selection-sentence",
    maxTokens: mode === "word" ? 160 : 384,
    maxChunkChars: 900,
  };
  const [result] = await translateOneChunk(item, await getSettings(), options);
  return { mode, translation: result.translation };
}

async function translateBatch(items, options = {}) {
  const settings = await getSettings();
  if (!items.length) return [];
  if (items.length === 1) return [await translateItemWithChunks(items[0], options, settings)];
  if (canTranslateAsSingleBatch(items, options, settings)) {
    try {
      return await translateOneChunk(items, settings, options);
    } catch (error) {
      console.warn("Batch translation failed; falling back to per-item translation:", error);
    }
  }
  const translatedItems = [];
  for (const item of items) translatedItems.push(await translateItemWithChunks(item, options, settings));
  return translatedItems;
}

function canTranslateAsSingleBatch(items, options, settings) {
  if (options.mode === "document") return false;
  const chunkLimit = Number(options.maxChunkChars) || settings.maxChunkChars;
  return items.every((item) => splitTextForTranslation(item.text, chunkLimit).length === 1);
}

async function translateItemWithChunks(item, options = {}, knownSettings) {
  const settings = knownSettings || (await getSettings());
  const chunkLimit = Number(options.maxChunkChars)
    || (options.mode === "document" ? settings.documentMaxChunkChars : settings.maxChunkChars);
  const chunkLimits = options.mode === "document" ? documentFallbackChunkLimits(chunkLimit) : [chunkLimit];
  let lastError;
  for (const limit of chunkLimits) {
    try {
      return await translateItemWithChunkLimit(item, settings, options, limit);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function documentFallbackChunkLimits(initialLimit) {
  return [...new Set([initialLimit, 1200, 800, 500])]
    .filter((limit) => Number.isFinite(limit) && limit > 0 && limit <= initialLimit);
}

async function translateItemWithChunkLimit(item, settings, options, chunkLimit) {
  const chunks = splitTextForTranslation(item.text, chunkLimit);
  if (chunks.length === 1) {
    const [translation] = await translateOneChunk({ ...item, text: chunks[0] }, settings, options);
    return { id: item.id, translation: translation.translation };
  }
  const translatedChunks = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkItem = { id: item.id, text: chunks[index] };
    const [translation] = await translateOneChunk(chunkItem, settings, options);
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

async function translateOneChunk(itemsOrItem, knownSettings, options = {}) {
  const items = Array.isArray(itemsOrItem) ? itemsOrItem : [itemsOrItem];
  const settings = knownSettings || (await getSettings());
  let lastError;
  for (let attempt = 1; attempt <= settings.retryCount; attempt += 1) {
    try {
      return await requestTranslationOnce(items, settings, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function requestTranslationOnce(items, settings, options = {}) {
  try {
    return await requestOpenAiChatOnce(items, settings, options);
  } catch (error) {
    if (!shouldTryNativeCompletion(error) || items.length !== 1) throw error;
    return await requestNativeCompletionOnce(items[0], settings, options);
  }
}

async function requestOpenAiChatOnce(items, settings, options = {}) {
  const endpoint = assertAllowedEndpoint(chatEndpoint(settings.baseUrl));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify(buildChatRequest(settings, items, options)),
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

async function requestNativeCompletionOnce(item, settings, options = {}) {
  const endpoint = assertAllowedEndpoint(completionEndpoint(settings.baseUrl));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify(buildCompletionRequest(settings, item, options)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`llama.cpp 原生接口返回 HTTP ${response.status}`);
    return extractCompletionTranslation(await response.json(), item.id);
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`原生 completion 翻译超过 ${Math.round(settings.timeoutMs / 1000)} 秒，已停止`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldTryNativeCompletion(error) {
  const message = String(error?.message || "").toLowerCase();
  return [
    "http 404",
    "http 405",
    "http 500",
    "http 501",
    "http 502",
    "http 503",
    "http 504",
    "failed to fetch",
    "networkerror",
  ].some((pattern) => message.includes(pattern));
}

async function listModels() {
  const settings = await getSettings();
  const endpoint = assertAllowedEndpoint(modelsEndpoint(settings.baseUrl));
  const response = await fetch(endpoint, { headers: authHeaders(settings) });
  if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.data || payload.models || []).map((model) => model.id || model.name || model.model).filter(Boolean);
}

async function testConnection() {
  try {
    return await listModels();
  } catch (modelsError) {
    const settings = await getSettings();
    try {
      await testMinimalChatCompletion();
      return [`模型列表接口不可用，但聊天接口可用：${settings.model}`, `原始检测错误：${modelsError.message}`];
    } catch (chatError) {
      await testMinimalNativeCompletion();
      return [
        `OpenAI /v1 接口不可用，但 llama.cpp 原生 completion 接口可用：${settings.model}`,
        `模型列表错误：${modelsError.message}`,
        `聊天接口错误：${chatError.message}`,
      ];
    }
  }
}

async function testMinimalChatCompletion() {
  const settings = await getSettings();
  const endpoint = assertAllowedEndpoint(chatEndpoint(settings.baseUrl));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify(buildChatRequest(settings, [{ id: "connection-test", text: "Say OK." }], { maxTokens: 32 })),
  });
  if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}`);
  const payload = await response.json();
  extractTranslations(payload, new Set(["connection-test"]));
  return true;
}

async function testMinimalNativeCompletion() {
  const settings = await getSettings();
  const endpoint = assertAllowedEndpoint(completionEndpoint(settings.baseUrl));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify(buildCompletionRequest(settings, { id: "connection-test", text: "Say OK." }, { maxTokens: 32 })),
  });
  if (!response.ok) throw new Error(`llama.cpp 原生接口返回 HTTP ${response.status}`);
  extractCompletionTranslation(await response.json(), "connection-test");
  return true;
}

async function clearServerContext() {
  const settings = await getSettings();
  const endpoint = assertAllowedEndpoint(`${rootEndpoint(settings.baseUrl)}/slots/0?action=erase`);
  const response = await fetch(endpoint, { method: "POST", headers: authHeaders(settings) });
  if (!response.ok) throw new Error(`清空上下文失败 HTTP ${response.status}；确认启动参数包含 --slot-save-path`);
  return await response.json().catch(() => ({}));
}
