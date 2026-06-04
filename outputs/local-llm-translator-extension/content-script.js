(() => {
  if (globalThis.__localLlmTranslatorInjected) return;
  globalThis.__localLlmTranslatorInjected = true;

  const state = {
    mode: "idle",
    queue: [],
    total: 0,
    completed: 0,
    failed: [],
    cancelled: false,
    hoverEnabled: false,
    hoverBusy: false,
    lastHoverTarget: null,
  };

  const skippedTags = new Set([
    "ASIDE", "CODE", "FOOTER", "HEADER", "INPUT", "NAV",
    "NOSCRIPT", "PRE", "SCRIPT", "STYLE", "TEXTAREA",
    "LOCAL-LLM-TRANSLATION",
  ]);
  const skippedSelector = [...skippedTags].map((tag) => tag.toLowerCase()).join(",");
  const candidateSelector = "p, article li, main li, blockquote, h1, h2, h3, h4, section p, td";

  function normalizedText(node) {
    return String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function isEligible(node, minTextLength = 12) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.closest(skippedSelector)) return false;
    if (!isVisible(node)) return false;
    const text = normalizedText(node);
    if (text.length < minTextLength) return false;
    if (/^https?:\/\/\S+$/i.test(text)) return false;
    if (/^[\d\s.,:%+\-()/]+$/.test(text)) return false;
    return true;
  }

  function nearestTranslatableNode(target, minTextLength = 12) {
    const node = target?.closest?.(candidateSelector);
    return isEligible(node, minTextLength) ? node : null;
  }

  function collectItems(minTextLength) {
    const seen = new Set();
    return [...document.querySelectorAll(candidateSelector)]
      .filter((node) => isEligible(node, minTextLength))
      .map((node, index) => ({ node, id: `local-llm-p-${index + 1}`, text: normalizedText(node) }))
      .filter((item) => !seen.has(item.text) && seen.add(item.text));
  }

  function insertTranslation(item, text, failed = false) {
    let translation = item.node.nextElementSibling;
    if (!translation || translation.tagName !== "LOCAL-LLM-TRANSLATION") {
      translation = document.createElement("local-llm-translation");
      item.node.insertAdjacentElement("afterend", translation);
    }
    translation.dataset.paragraphId = item.id;
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

  function removeTranslations() {
    document.querySelectorAll("local-llm-translation, #local-llm-progress").forEach((node) => node.remove());
    Object.assign(state, { mode: "idle", queue: [], total: 0, completed: 0, failed: [], cancelled: false });
  }

  async function processQueue(items, resetProgress = false) {
    const settings = await chrome.storage.local.get({ batchSize: 1, minTextLength: 12 });
    const batchSize = Math.max(1, Math.min(3, Number(settings.batchSize) || 1));
    if (resetProgress) {
      state.total = items.length;
      state.completed = 0;
      state.failed = [];
    }
    state.queue = [...items];
    state.mode = "translating";
    state.cancelled = false;

    while (state.queue.length && !state.cancelled) {
      const batch = state.queue.splice(0, batchSize);
      updateProgress(`本地翻译 ${state.completed + 1} / ${state.total} 段…`);
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
          insertTranslation(item, translated);
          state.completed += 1;
        }
      } catch (error) {
        for (const item of batch) {
          insertTranslation(item, `翻译失败：${error.message}`, true);
          state.failed.push(item);
        }
      }
    }

    if (state.cancelled) {
      state.mode = "paused";
      updateProgress(`已暂停 ${state.completed} / ${state.total} 段`);
    } else {
      state.mode = "completed";
      updateProgress(state.failed.length ? `完成 ${state.completed} / ${state.total} 段；失败 ${state.failed.length} 段，再次点击重试` : `翻译完成 ${state.completed} / ${state.total} 段`);
    }
  }

  async function toggleTranslation() {
    updateProgress("收到翻译请求，正在准备…");
    if (state.mode === "idle") {
      const settings = await chrome.storage.local.get({ minTextLength: 12 });
      const items = collectItems(settings.minTextLength);
      if (!items.length) {
        state.mode = "completed";
        updateProgress("没有可翻译的正文段落");
        return;
      }
      await processQueue(items, true);
      return;
    }
    if (state.mode === "translating") {
      state.cancelled = true;
      return;
    }
    if (state.mode === "paused") {
      const retryItems = [...state.failed, ...state.queue];
      state.failed = [];
      await processQueue(retryItems);
      return;
    }
    if (state.mode === "completed" && state.failed.length) {
      const retryItems = [...state.failed];
      state.failed = [];
      await processQueue(retryItems);
      return;
    }
    removeTranslations();
  }

  async function translateHoveredNode(event) {
    if (!state.hoverEnabled || !event.ctrlKey || state.hoverBusy) return;
    const settings = await chrome.storage.local.get({ minTextLength: 12 });
    const node = nearestTranslatableNode(event.target, settings.minTextLength);
    if (!node || node.dataset.localLlmHoverTranslated === "true") return;
    state.hoverBusy = true;
    node.dataset.localLlmHoverTranslated = "true";
    const item = { node, id: `hover-${Date.now()}`, text: normalizedText(node) };
    insertTranslation(item, "正在翻译该段…");
    try {
      const response = await chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", items: [{ id: item.id, text: item.text }] });
      if (!response?.ok) throw new Error(response?.error || "模型请求失败");
      insertTranslation(item, response.translations?.[0]?.translation || "", false);
    } catch (error) {
      node.dataset.localLlmHoverTranslated = "false";
      insertTranslation(item, `翻译失败：${error.message}`, true);
    } finally {
      state.hoverBusy = false;
    }
  }

  function rememberPointerTarget(event) {
    state.lastHoverTarget = event.target;
  }

  function handleHoverEvent(event) {
    rememberPointerTarget(event);
    translateHoveredNode(event).catch((error) => showError(error.message));
  }

  document.addEventListener("mouseover", handleHoverEvent, true);
  document.addEventListener("mousemove", handleHoverEvent, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Control" && state.lastHoverTarget) {
      translateHoveredNode({ target: state.lastHoverTarget, ctrlKey: true }).catch((error) => showError(error.message));
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "TOGGLE_TRANSLATION") {
      toggleTranslation().then(() => sendResponse({ ok: true })).catch((error) => { showError(error.message); sendResponse({ ok: false, error: error.message }); });
      return true;
    }
    if (message.type === "ENABLE_HOVER_TRANSLATION") {
      state.hoverEnabled = true;
      updateProgress("已开启：按住 Ctrl 并把鼠标移到段落上即可翻译该段");
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
