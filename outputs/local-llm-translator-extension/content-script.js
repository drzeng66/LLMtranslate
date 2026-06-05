(() => {
  const scriptAbortController = new AbortController();
  const previousAbortController = globalThis.__localLlmTranslatorAbortController;
  if (previousAbortController) previousAbortController.abort();
  globalThis.__localLlmTranslatorAbortController = scriptAbortController;
  globalThis.__localLlmTranslatorInjected = true;

  const state = {
    mode: "idle",
    queue: [],
    total: 0,
    completed: 0,
    failed: [],
    cancelled: false,
    hoverEnabled: true,
    hoverBusy: false,
    lastHoverTarget: null,
    translationCache: new Map(),
    selectionCache: new Map(),
    selectionTimer: null,
    selectionRequestId: 0,
    lastSelectionSignature: "",
    dismissedSelectionSignature: "",
  };

  const articleSkippedTags = new Set([
    "ASIDE", "BUTTON", "CODE", "FOOTER", "HEADER", "INPUT", "NAV",
    "NOSCRIPT", "PRE", "SCRIPT", "SELECT", "STYLE", "TEXTAREA",
    "LOCAL-LLM-TRANSLATION",
  ]);
  const immersiveSkippedTags = new Set([
    "CODE", "INPUT", "NOSCRIPT", "PRE", "SCRIPT", "SELECT", "STYLE", "TEXTAREA",
    "LOCAL-LLM-TRANSLATION",
  ]);
  const articleSkippedSelector = [...articleSkippedTags].map((tag) => tag.toLowerCase()).join(",");
  const immersiveSkippedSelector = [...immersiveSkippedTags].map((tag) => tag.toLowerCase()).join(",");
  const articleCandidateSelector = [
    "p",
    "article li", "main li", "section li", "[role=\"main\"] li",
    "blockquote",
    "h1", "h2", "h3", "h4",
    "td", "th", "figcaption", "dd", "dt",
    "article div", "main div", "section div", "[role=\"main\"] div",
  ].join(", ");
  const immersiveCandidateSelector = [
    "span", "a", "button", "label", "summary",
    "strong", "em", "b", "small",
    "li", "p", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "td", "th", "figcaption", "dd", "dt",
    "article div", "main div", "section div", "[role=\"main\"] div",
  ].join(", ");

  function normalizedText(node) {
    return String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function containsEnglishText(text) {
    return /[A-Za-z][A-Za-z'’.-]{2,}/.test(String(text || ""));
  }

  function isEligible(node, minTextLength = 12, options = {}) {
    const skippedSelector = options.skippedSelector || articleSkippedSelector;
    const requireEnglish = Boolean(options.requireEnglish);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.closest(skippedSelector)) return false;
    if (!isVisible(node)) return false;
    const text = normalizedText(node);
    if (text.length < minTextLength) return false;
    if (requireEnglish && !containsEnglishText(text)) return false;
    if (/^https?:\/\/\S+$/i.test(text)) return false;
    if (/^[\d\s.,:%+\-()/]+$/.test(text)) return false;
    return true;
  }

  function hasEligibleCandidateDescendant(node, selector, minTextLength = 12, options = {}) {
    return [...node.querySelectorAll(selector)]
      .some((child) => child !== node && isEligible(child, minTextLength, options));
  }

  function nearestTranslatableNode(target, minTextLength = 12) {
    const node = target?.closest?.(articleCandidateSelector);
    return isEligible(node, minTextLength, { skippedSelector: articleSkippedSelector }) ? node : null;
  }

  function collectArticleItems(minTextLength) {
    const seen = new Set();
    return [...document.querySelectorAll(articleCandidateSelector)]
      .filter((node) => isEligible(node, minTextLength, { skippedSelector: articleSkippedSelector }))
      .filter((node) => !/^(DIV|SECTION|ARTICLE|MAIN)$/i.test(node.tagName) || !hasEligibleCandidateDescendant(node, articleCandidateSelector, minTextLength, { skippedSelector: articleSkippedSelector }))
      .map((node, index) => ({ node, id: `local-llm-article-${index + 1}`, source: "article", text: normalizedText(node) }))
      .filter((item) => !seen.has(item.text) && seen.add(item.text));
  }

  function collectImmersiveItems(minTextLength = 3) {
    const seen = new Set();
    return [...document.querySelectorAll(immersiveCandidateSelector)]
      .filter((node) => isEligible(node, minTextLength, { skippedSelector: immersiveSkippedSelector, requireEnglish: true }))
      .filter((node) => !/^(DIV|SECTION|ARTICLE|MAIN)$/i.test(node.tagName) || !hasEligibleCandidateDescendant(node, immersiveCandidateSelector, minTextLength, { skippedSelector: immersiveSkippedSelector, requireEnglish: true }))
      .map((node, index) => ({ node, id: `local-llm-immersive-${index + 1}`, source: "immersive", text: normalizedText(node) }))
      .filter((item) => !seen.has(item.text) && seen.add(item.text));
  }

  function isInViewport(node) {
    const rect = node.getBoundingClientRect();
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= height && rect.left <= width;
  }

  function sortItemsForTranslation(items) {
    return [...items].sort((a, b) => {
      const aVisible = isInViewport(a.node) ? 0 : 1;
      const bVisible = isInViewport(b.node) ? 0 : 1;
      if (aVisible !== bVisible) return aVisible - bVisible;
      return a.node.getBoundingClientRect().top - b.node.getBoundingClientRect().top;
    });
  }

  function cacheKey(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function textLengthClass(text) {
    const length = String(text || "").length;
    if (length <= 36) return "short";
    if (length <= 140) return "medium";
    return "long";
  }

  function insertTranslation(item, text, failed = false, layoutMode = "compact") {
    let translation = item.node.nextElementSibling;
    if (!translation || translation.tagName !== "LOCAL-LLM-TRANSLATION") {
      translation = document.createElement("local-llm-translation");
      item.node.insertAdjacentElement("afterend", translation);
    }
    translation.dataset.paragraphId = item.id;
    translation.dataset.source = item.source || (String(item.id).startsWith("hover-") ? "hover" : "article");
    translation.dataset.layout = layoutMode;
    translation.dataset.textLength = textLengthClass(item.text || text);
    translation.dataset.failed = String(failed);
    translation.textContent = text;
  }

  function updateProgress(text) {
    let bubble = document.getElementById("local-llm-progress");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.id = "local-llm-progress";
      document.documentElement.appendChild(bubble);
    }
    bubble.textContent = text;
  }

  function showError(message) {
    updateProgress(`本地翻译失败：${message}`);
  }

  function getSelectedText() {
    return String(window.getSelection?.()?.toString() || "").replace(/\s+/g, " ").trim();
  }

  function classifySelectionText(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "none";
    if (normalized.length > 800) return "none";
    if (/^https?:\/\/\S+$/i.test(normalized)) return "none";
    if (/^[\d\s.,:%+\-()/]+$/.test(normalized)) return "none";
    if (/^[A-Za-z][A-Za-z'’-]{1,40}$/.test(normalized)) return "word";
    if (/[A-Za-z]/.test(normalized) && (/\s/.test(normalized) || /[.!?。！？,;:]/.test(normalized)) && normalized.length >= 2) return "sentence";
    return "none";
  }

  function selectionCacheKey(text, mode) {
    return `${mode}:${cacheKey(text)}`;
  }

  function hideSelectionPopover() {
    document.querySelectorAll("local-llm-selection-popover, #local-llm-selection-popover")
      .forEach((node) => node.remove());
    state.lastSelectionSignature = "";
  }

  function currentSelectionSignature(text = getSelectedText()) {
    const mode = classifySelectionText(text);
    if (mode === "none") return "";
    const rect = selectionAnchorRect();
    const position = rect
      ? `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
      : "no-rect";
    return `${mode}:${cacheKey(text)}:${position}`;
  }

  function cancelSelectionTranslation(options = {}) {
    const dismissCurrentSelection = options.dismissCurrentSelection !== false;
    if (dismissCurrentSelection) {
      const signature = currentSelectionSignature();
      if (signature) state.dismissedSelectionSignature = signature;
    }
    clearTimeout(state.selectionTimer);
    state.selectionRequestId += 1;
    hideSelectionPopover();
  }

  function releaseModelContext(reason) {
    chrome.runtime.sendMessage({ type: "RELEASE_CONTEXT", reason }).catch(() => {});
  }

  function selectionAnchorRect() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect && rect.width >= 0 && rect.height >= 0) return rect;
    return null;
  }

  function showSelectionPopover(text, translation, mode, pending = false) {
    const rect = selectionAnchorRect();
    if (!rect) return;
    const leftovers = [...document.querySelectorAll("local-llm-selection-popover, #local-llm-selection-popover")];
    let popover = leftovers.find((node) => node.id === "local-llm-selection-popover") || leftovers[0];
    leftovers.filter((node) => node !== popover).forEach((node) => node.remove());
    if (!popover) {
      popover = document.createElement("local-llm-selection-popover");
      document.documentElement.appendChild(popover);
    }
    popover.id = "local-llm-selection-popover";
    popover.dataset.mode = mode;
    popover.dataset.pending = String(pending);
    popover.textContent = "";
    const source = document.createElement("div");
    source.className = "local-llm-selection-source";
    source.textContent = mode === "word" ? text : "选中句段";
    const result = document.createElement("div");
    result.className = "local-llm-selection-result";
    result.textContent = translation;
    popover.append(source, result);
    const margin = 8;
    const top = Math.max(8, rect.bottom + margin);
    const left = Math.min(Math.max(8, rect.left), (window.innerWidth || 1024) - 340);
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  async function scheduleSelectionTranslation() {
    clearTimeout(state.selectionTimer);
    state.selectionTimer = setTimeout(async () => {
      const settings = await chrome.storage.local.get({ selectionTranslationEnabled: true });
      if (settings.selectionTranslationEnabled === false) {
        cancelSelectionTranslation();
        return;
      }
      const text = getSelectedText();
      const mode = classifySelectionText(text);
      if (mode === "none") {
        state.dismissedSelectionSignature = "";
        cancelSelectionTranslation({ dismissCurrentSelection: false });
        return;
      }
      const signature = currentSelectionSignature(text);
      if (state.dismissedSelectionSignature === signature) return;
      if (signature === state.lastSelectionSignature) return;
      state.lastSelectionSignature = signature;
      const cached = state.selectionCache.get(selectionCacheKey(text, mode));
      if (cached) {
        showSelectionPopover(text, cached, mode);
        return;
      }
      const requestId = ++state.selectionRequestId;
      showSelectionPopover(text, "正在翻译选中文本…", mode, true);
      try {
        const response = await chrome.runtime.sendMessage({ type: "TRANSLATE_SELECTION", text });
        if (requestId !== state.selectionRequestId || getSelectedText() !== text) return;
        if (!response?.ok) throw new Error(response?.error || "模型请求失败");
        state.selectionCache.set(selectionCacheKey(text, mode), response.translation || "");
        showSelectionPopover(text, response.translation || "", response.mode || mode);
      } catch (error) {
        if (requestId === state.selectionRequestId && getSelectedText() === text) showSelectionPopover(text, `翻译失败：${error.message}`, mode);
      } finally {
        if (state.mode !== "translating") releaseModelContext("selection-completed");
      }
    }, 260);
  }

  function removeTranslations() {
    document.querySelectorAll("local-llm-translation, #local-llm-progress").forEach((node) => node.remove());
    cancelSelectionTranslation();
    Object.assign(state, { mode: "idle", queue: [], total: 0, completed: 0, failed: [], cancelled: false });
  }

  function hasTranslationsForSource(source) {
    return document.querySelector(`local-llm-translation[data-source="${source}"]`) !== null;
  }

  function hasArticleTranslations() {
    return hasTranslationsForSource("article");
  }

  function hasImmersiveTranslations() {
    return hasTranslationsForSource("immersive");
  }

  async function translateBatchAndInsert(batch, settings) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE_BATCH",
        items: batch.map(({ id, text }) => ({ id, text })),
      });
      if (!response?.ok) throw new Error(response?.error || "模型请求失败");
      const translatedById = new Map(response.translations.map(({ id, translation }) => [id, translation]));
      for (const item of batch) {
        const translated = translatedById.get(item.id);
        if (!translated) throw new Error(`缺少段落译文：${item.id}`);
        state.translationCache.set(cacheKey(item.text), translated);
        insertTranslation(item, translated, false, settings.layoutMode);
        state.completed += 1;
      }
    } catch (error) {
      for (const item of batch) {
        insertTranslation(item, `翻译失败：${error.message}`, true, settings.layoutMode);
        state.failed.push(item);
      }
    } finally {
      updateProgress(`本地翻译 ${Math.min(state.completed + state.failed.length, state.total)} / ${state.total} 段…`);
    }
  }

  async function processQueue(items, resetProgress = false) {
    const settings = await chrome.storage.local.get({ batchSize: 10, minTextLength: 12, parallelRequests: 3, layoutMode: "compact" });
    const batchSize = Math.max(1, Math.min(16, Number(settings.batchSize) || 10));
    const parallelRequests = Math.max(1, Math.min(4, Number(settings.parallelRequests) || 3));
    settings.layoutMode = ["compact", "clear", "translation-only"].includes(settings.layoutMode) ? settings.layoutMode : "compact";
    if (resetProgress) {
      state.total = items.length;
      state.completed = 0;
      state.failed = [];
    }
    state.queue = [];
    state.mode = "translating";
    state.cancelled = false;

    for (const item of sortItemsForTranslation(items)) {
      const cached = state.translationCache.get(cacheKey(item.text));
      if (cached) {
        insertTranslation(item, cached, false, settings.layoutMode);
        state.completed += 1;
      } else {
        state.queue.push(item);
      }
    }

    const workerCount = Math.min(parallelRequests, Math.max(1, Math.ceil(state.queue.length / batchSize)));
    const workers = Array.from({ length: workerCount }, async () => {
      while (state.queue.length && !state.cancelled) {
        const batch = state.queue.splice(0, batchSize);
        if (batch.length) {
          updateProgress(`本地翻译 ${Math.min(state.completed + state.failed.length + 1, state.total)} / ${state.total} 段…`);
          await translateBatchAndInsert(batch, settings);
        }
      }
    });
    await Promise.all(workers);

    if (state.cancelled) {
      state.mode = "paused";
      updateProgress(`已暂停 ${state.completed} / ${state.total} 段`);
    } else {
      state.mode = "completed";
      updateProgress(state.failed.length ? `完成 ${state.completed} / ${state.total} 段；失败 ${state.failed.length} 段，再次点击重试` : `翻译完成 ${state.completed} / ${state.total} 段`);
      releaseModelContext("page-completed");
    }
  }

  async function translateItemsForSource(source, collectItems, minTextLength, emptyMessage) {
    updateProgress(source === "immersive" ? "收到沉浸翻译请求，正在准备…" : "收到正文翻译请求，正在准备…");
    if (state.mode === "translating") {
      state.cancelled = true;
      updateProgress(`正在停止翻译 ${state.completed} / ${state.total} 段…`);
      return;
    }
    if ((source === "immersive" ? hasImmersiveTranslations() : hasArticleTranslations())) {
      removeTranslations();
      return;
    }
    removeTranslations();
    const items = collectItems(minTextLength);
    if (!items.length) {
      state.mode = "completed";
      updateProgress(emptyMessage);
      return;
    }
    await processQueue(items, true);
  }

  async function translateArticle() {
    const settings = await chrome.storage.local.get({ minTextLength: 12, layoutMode: "compact" });
    await translateItemsForSource("article", collectArticleItems, settings.minTextLength, "没有可翻译的正文段落");
  }

  async function translateImmersive() {
    const settings = await chrome.storage.local.get({ minTextLength: 12, layoutMode: "compact" });
    await translateItemsForSource("immersive", collectImmersiveItems, Math.min(3, Number(settings.minTextLength) || 12), "没有可翻译的英文内容");
  }

  async function translatePage() {
    return await translateArticle();
  }

  async function toggleTranslation() {
    return await translateArticle();
  }

  async function translateHoveredNode(event) {
    if (!state.hoverEnabled || !event.ctrlKey || state.hoverBusy) return;
    const settings = await chrome.storage.local.get({ minTextLength: 12 });
    const node = nearestTranslatableNode(event.target, settings.minTextLength);
    if (!node || node.dataset.localLlmHoverTranslated === "true") return;
    state.hoverBusy = true;
    node.dataset.localLlmHoverTranslated = "true";
    const item = { node, id: `hover-${Date.now()}`, source: "hover", text: normalizedText(node) };
    insertTranslation(item, "正在翻译该段…");
    try {
      const response = await chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", items: [{ id: item.id, text: item.text }] });
      if (!response?.ok) throw new Error(response?.error || "模型请求失败");
      insertTranslation(item, response.translations?.[0]?.translation || "", false, settings.layoutMode || "compact");
    } catch (error) {
      node.dataset.localLlmHoverTranslated = "false";
      insertTranslation(item, `翻译失败：${error.message}`, true, settings.layoutMode || "compact");
    } finally {
      state.hoverBusy = false;
      if (state.mode !== "translating") releaseModelContext("hover-completed");
    }
  }

  function rememberPointerTarget(event) {
    state.lastHoverTarget = event.target;
  }

  function handleHoverEvent(event) {
    rememberPointerTarget(event);
    translateHoveredNode(event).catch((error) => showError(error.message));
  }

  document.addEventListener("mouseover", handleHoverEvent, { capture: true, signal: scriptAbortController.signal });
  document.addEventListener("mousemove", handleHoverEvent, { capture: true, signal: scriptAbortController.signal });
  document.addEventListener("selectionchange", () => {
    if (!getSelectedText()) {
      state.dismissedSelectionSignature = "";
      cancelSelectionTranslation({ dismissCurrentSelection: false });
      return;
    }
    const signature = currentSelectionSignature();
    if (signature && signature !== state.dismissedSelectionSignature) state.dismissedSelectionSignature = "";
    scheduleSelectionTranslation().catch((error) => showError(error.message));
  }, { signal: scriptAbortController.signal });
  document.addEventListener("mouseup", () => {
    scheduleSelectionTranslation().catch((error) => showError(error.message));
  }, { capture: true, signal: scriptAbortController.signal });
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      window.getSelection?.()?.removeAllRanges?.();
      state.dismissedSelectionSignature = "";
      cancelSelectionTranslation();
      return;
    }
    scheduleSelectionTranslation().catch((error) => showError(error.message));
  }, { capture: true, signal: scriptAbortController.signal });
  document.addEventListener("mousedown", (event) => {
    if (event.target?.closest?.("local-llm-selection-popover")) return;
    cancelSelectionTranslation();
    setTimeout(() => {
      if (!getSelectedText()) cancelSelectionTranslation();
    }, 0);
  }, { capture: true, signal: scriptAbortController.signal });
  window.addEventListener("blur", () => cancelSelectionTranslation(), { signal: scriptAbortController.signal });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") cancelSelectionTranslation();
  }, { signal: scriptAbortController.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Control" && state.lastHoverTarget) {
      translateHoveredNode({ target: state.lastHoverTarget, ctrlKey: true }).catch((error) => showError(error.message));
    }
  }, { capture: true, signal: scriptAbortController.signal });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "TRANSLATE_ARTICLE") {
      translateArticle().then(() => sendResponse({ ok: true })).catch((error) => { showError(error.message); sendResponse({ ok: false, error: error.message }); });
      return true;
    }
    if (message.type === "TRANSLATE_IMMERSIVE") {
      translateImmersive().then(() => sendResponse({ ok: true })).catch((error) => { showError(error.message); sendResponse({ ok: false, error: error.message }); });
      return true;
    }
    if (message.type === "TRANSLATE_PAGE") {
      translatePage().then(() => sendResponse({ ok: true })).catch((error) => { showError(error.message); sendResponse({ ok: false, error: error.message }); });
      return true;
    }
    if (message.type === "TOGGLE_TRANSLATION") {
      toggleTranslation().then(() => sendResponse({ ok: true })).catch((error) => { showError(error.message); sendResponse({ ok: false, error: error.message }); });
      return true;
    }
    if (message.type === "ENABLE_HOVER_TRANSLATION") {
      state.hoverEnabled = true;
      updateProgress("Ctrl 悬停翻译已启用：按住 Ctrl 并把鼠标移到段落上即可翻译该段");
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "CLEAR_TRANSLATIONS") {
      removeTranslations();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "SHOW_TRANSLATION_ERROR") {
      showError(message.error || "插件启动失败");
      sendResponse({ ok: true });
      return false;
    }
  });
})();
