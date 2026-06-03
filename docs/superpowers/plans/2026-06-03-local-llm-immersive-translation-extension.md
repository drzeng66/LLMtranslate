# Local LLM Immersive Translation Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that translates visible webpage paragraphs into Simplified Chinese with `gemma.gguf` through the local OpenAI-compatible endpoint `http://127.0.0.1:8080/v1`, preserving the original text and inserting bilingual translations below it.

**Architecture:** A Manifest V3 service worker handles toolbar clicks, content-script injection, local model requests, settings reads, and connection tests. A self-contained content script extracts eligible visible paragraphs, sends batches to the worker, inserts translations below originals, shows progress, and supports pause, resume, retry, and removal. Pure JavaScript modules hold request parsing and paragraph-filter rules so the behavior can be verified with Node's built-in test runner.

**Tech Stack:** Chrome Extensions Manifest V3, JavaScript, HTML, CSS, Node.js built-in test runner, Chrome in-app browser for local verification

---

## File Structure

- Create: `work/local-llm-translator-extension/manifest.json` — MV3 metadata, permissions, worker, and options page.
- Create: `work/local-llm-translator-extension/package.json` — mark JavaScript files as ESM and expose the Node test command.
- Create: `work/local-llm-translator-extension/service-worker.js` — action-click orchestration, injection, settings, local model calls, connection testing.
- Create: `work/local-llm-translator-extension/content-script.js` — DOM extraction, batching, translation insertion, page state machine, progress bubble.
- Create: `work/local-llm-translator-extension/content-style.css` — isolated bilingual translation and progress styles.
- Create: `work/local-llm-translator-extension/options.html` — local endpoint configuration UI.
- Create: `work/local-llm-translator-extension/options.js` — load, save, reset, and test-connection actions.
- Create: `work/local-llm-translator-extension/options.css` — settings page styling.
- Create: `work/local-llm-translator-extension/lib/translator-core.js` — defaults, endpoint normalization, prompt payload construction, response parsing.
- Create: `work/local-llm-translator-extension/lib/dom-rules.js` — pure paragraph eligibility rules.
- Create: `work/local-llm-translator-extension/tests/translator-core.test.mjs` — unit tests for local request and response behavior.
- Create: `work/local-llm-translator-extension/tests/dom-rules.test.mjs` — unit tests for paragraph filtering.
- Create: `work/local-llm-translator-extension/tests/manifest.test.mjs` — static MV3 privacy and permission checks.
- Create: `work/local-llm-translator-extension/test-pages/article.html` — local browser verification fixture.
- Create: `work/local-llm-translator-extension/README.md` — unpacked-extension installation and usage guide.
- Create at delivery: `outputs/local-llm-translator-extension/` — user-facing unpacked Chrome extension.

The workspace is not a Git repository. Replace commit steps with explicit verification checkpoints and preserve all files in the workspace.

### Task 1: Create manifest privacy boundary

**Files:**
- Create: `work/local-llm-translator-extension/package.json`
- Create: `work/local-llm-translator-extension/tests/manifest.test.mjs`
- Create: `work/local-llm-translator-extension/manifest.json`

- [ ] **Step 1: Write failing MV3 manifest tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8")
);

test("uses Manifest V3 with a module service worker", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.background, {
    service_worker: "service-worker.js",
    type: "module",
  });
});

test("limits required host access to local model endpoints", () => {
  assert.deepEqual(manifest.host_permissions.sort(), [
    "http://127.0.0.1/*",
    "http://localhost/*",
  ]);
  assert.deepEqual(manifest.permissions.sort(), [
    "activeTab",
    "scripting",
    "storage",
  ]);
});

test("declares toolbar action and options page", () => {
  assert.equal(manifest.action.default_title, "本地沉浸式翻译");
  assert.equal(manifest.options_page, "options.html");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test work\local-llm-translator-extension\tests\manifest.test.mjs
```

Expected: FAIL because `manifest.json` does not exist.

- [ ] **Step 3: Mark JavaScript files as ESM**

```json
{
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

- [ ] **Step 4: Add minimal Manifest V3 metadata**

```json
{
  "manifest_version": 3,
  "name": "本地大模型沉浸式翻译",
  "version": "0.1.0",
  "description": "点击后使用本地大模型为网页段落插入简体中文译文。",
  "minimum_chrome_version": "114",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["http://127.0.0.1/*", "http://localhost/*"],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "action": {
    "default_title": "本地沉浸式翻译"
  },
  "options_page": "options.html"
}
```

- [ ] **Step 5: Re-run manifest tests**

Run:

```powershell
node --test work\local-llm-translator-extension\tests\manifest.test.mjs
```

Expected: 3 PASS.

### Task 2: Implement local model request core with TDD

**Files:**
- Create: `work/local-llm-translator-extension/tests/translator-core.test.mjs`
- Create: `work/local-llm-translator-extension/lib/translator-core.js`
- Modify: `work/local-llm-translator-extension/manifest.json`

- [ ] **Step 1: Write failing request-core tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  buildChatRequest,
  extractTranslations,
  modelsEndpoint,
} from "../lib/translator-core.js";

test("defaults target detected local server and model", () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "gemma.gguf",
    targetLanguage: "简体中文",
    batchSize: 4,
    minTextLength: 12,
  });
});

test("normalizes models endpoint", () => {
  assert.equal(modelsEndpoint("http://127.0.0.1:8080/v1/"), "http://127.0.0.1:8080/v1/models");
});

test("builds low-temperature chat request with paragraph IDs", () => {
  const body = buildChatRequest(DEFAULT_SETTINGS, [{ id: "p-1", text: "Hello world from a test paragraph." }]);
  assert.equal(body.model, "gemma.gguf");
  assert.equal(body.temperature, 0.1);
  assert.match(body.messages[0].content, /Simplified Chinese/);
  assert.match(body.messages[1].content, /p-1/);
});

test("extracts JSON array even when model wraps it in prose", () => {
  const response = {
    choices: [{ message: { content: 'Result:\\n[{"id":"p-1","translation":"你好"}]\\nDone' } }],
  };
  assert.deepEqual(extractTranslations(response, new Set(["p-1"])), [
    { id: "p-1", translation: "你好" },
  ]);
});

test("rejects unknown IDs returned by model", () => {
  const response = {
    choices: [{ message: { content: '[{"id":"other","translation":"错误"}]' } }],
  };
  assert.throws(() => extractTranslations(response, new Set(["p-1"])), /unknown paragraph id/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test work\local-llm-translator-extension\tests\translator-core.test.mjs
```

Expected: FAIL because `lib/translator-core.js` does not exist.

- [ ] **Step 3: Add request-core implementation**

```js
export const DEFAULT_SETTINGS = Object.freeze({
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "gemma.gguf",
  targetLanguage: "简体中文",
  batchSize: 4,
  minTextLength: 12,
});

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, "");
}

export function modelsEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

export function chatEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

export function buildChatRequest(settings, items) {
  return {
    model: settings.model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: `Translate every input item into ${settings.targetLanguage}. Preserve meaning, tone, names, numbers, and inline formatting. Return JSON only as an array of objects with exactly two string fields: id and translation.`,
      },
      {
        role: "user",
        content: JSON.stringify(items),
      },
    ],
  };
}

export function extractTranslations(response, allowedIds) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("missing model response content");
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("model response does not contain a JSON array");
  const parsed = JSON.parse(content.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("model response is not an array");
  return parsed.map((item) => {
    if (!allowedIds.has(item.id)) throw new Error(`unknown paragraph id: ${item.id}`);
    if (typeof item.translation !== "string" || !item.translation.trim()) {
      throw new Error(`invalid translation for paragraph id: ${item.id}`);
    }
    return { id: item.id, translation: item.translation.trim() };
  });
}
```

- [ ] **Step 4: Mark library files as extension web-accessible modules only where needed**

No remote code is allowed. Keep the core module inside the package. Add no cloud host permissions.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```powershell
node --test work\local-llm-translator-extension\tests\translator-core.test.mjs
```

Expected: 5 PASS.

### Task 3: Implement paragraph eligibility rules with TDD

**Files:**
- Create: `work/local-llm-translator-extension/tests/dom-rules.test.mjs`
- Create: `work/local-llm-translator-extension/lib/dom-rules.js`

- [ ] **Step 1: Write failing rule tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { isEligibleParagraphText, shouldSkipByAncestors } from "../lib/dom-rules.js";

test("accepts ordinary article text", () => {
  assert.equal(isEligibleParagraphText("Researchers published a detailed report today.", 12), true);
});

test("rejects short text urls and numeric-only text", () => {
  assert.equal(isEligibleParagraphText("Menu", 12), false);
  assert.equal(isEligibleParagraphText("https://example.com/article", 12), false);
  assert.equal(isEligibleParagraphText("12345 67890", 12), false);
});

test("rejects code navigation and extension-generated ancestors", () => {
  assert.equal(shouldSkipByAncestors(["ARTICLE", "MAIN"]), false);
  assert.equal(shouldSkipByAncestors(["P", "NAV"]), true);
  assert.equal(shouldSkipByAncestors(["CODE", "PRE"]), true);
  assert.equal(shouldSkipByAncestors(["DIV", "LOCAL-LLM-TRANSLATION"]), true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test work\local-llm-translator-extension\tests\dom-rules.test.mjs
```

Expected: FAIL because `lib/dom-rules.js` does not exist.

- [ ] **Step 3: Add minimal filtering rules**

```js
const SKIPPED_TAGS = new Set([
  "ASIDE", "CODE", "FOOTER", "HEADER", "INPUT", "NAV",
  "NOSCRIPT", "PRE", "SCRIPT", "STYLE", "TEXTAREA",
  "LOCAL-LLM-TRANSLATION",
]);

export function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function isEligibleParagraphText(text, minTextLength) {
  const normalized = normalizeText(text);
  if (normalized.length < minTextLength) return false;
  if (/^https?:\/\/\S+$/i.test(normalized)) return false;
  if (/^[\d\s.,:%+\-()/]+$/.test(normalized)) return false;
  return true;
}

export function shouldSkipByAncestors(tagNames) {
  return tagNames.some((tag) => SKIPPED_TAGS.has(String(tag).toUpperCase()));
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
node --test work\local-llm-translator-extension\tests\dom-rules.test.mjs
```

Expected: 3 PASS.

### Task 4: Implement service worker local-only requests

**Files:**
- Create: `work/local-llm-translator-extension/service-worker.js`

- [ ] **Step 1: Add worker settings and local-host enforcement**

```js
import {
  DEFAULT_SETTINGS,
  buildChatRequest,
  chatEndpoint,
  extractTranslations,
  modelsEndpoint,
} from "./lib/translator-core.js";

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
}

function assertLocalEndpoint(url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("仅允许调用本机模型接口");
  }
  return parsed.toString();
}
```

- [ ] **Step 2: Add content-script injection and toolbar click**

```js
async function ensureInjected(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content-style.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await ensureInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_TRANSLATION" });
  } catch (error) {
    console.warn("Unable to translate this page:", error);
  }
});
```

- [ ] **Step 3: Add batch translation and connection-test message handlers**

```js
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
});

async function translateBatch(items) {
  const settings = await getSettings();
  const endpoint = assertLocalEndpoint(chatEndpoint(settings.baseUrl));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildChatRequest(settings, items)),
  });
  if (!response.ok) throw new Error(`本地模型返回 HTTP ${response.status}`);
  return extractTranslations(await response.json(), new Set(items.map((item) => item.id)));
}

async function listModels() {
  const settings = await getSettings();
  const endpoint = assertLocalEndpoint(modelsEndpoint(settings.baseUrl));
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`本地模型返回 HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.data || payload.models || []).map((model) => model.id || model.name || model.model);
}
```

- [ ] **Step 4: Run static syntax checks**

Run:

```powershell
node --check work\local-llm-translator-extension\service-worker.js
```

Expected: exit 0.

### Task 5: Implement content-script bilingual DOM state machine

**Files:**
- Create: `work/local-llm-translator-extension/content-script.js`
- Create: `work/local-llm-translator-extension/content-style.css`

- [ ] **Step 1: Add self-contained injection guard and state**

The content script is injected programmatically and must be a classic self-contained script:

```js
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
  };

  const skippedTags = new Set([
    "ASIDE", "CODE", "FOOTER", "HEADER", "INPUT", "NAV",
    "NOSCRIPT", "PRE", "SCRIPT", "STYLE", "TEXTAREA",
    "LOCAL-LLM-TRANSLATION",
  ]);

  function normalizedText(node) {
    return String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function isEligible(node, minTextLength) {
    if (node.closest([...skippedTags].map((tag) => tag.toLowerCase()).join(","))) return false;
    if (!isVisible(node)) return false;
    const text = normalizedText(node);
    if (text.length < minTextLength) return false;
    if (/^https?:\/\/\S+$/i.test(text)) return false;
    if (/^[\d\s.,:%+\-()/]+$/.test(text)) return false;
    return true;
  }

  function collectItems(minTextLength) {
    const seen = new Set();
    return [...document.querySelectorAll("p, article li, main li, blockquote, h1, h2, h3, h4")]
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

  function removeTranslations() {
    document
      .querySelectorAll("local-llm-translation, #local-llm-progress")
      .forEach((node) => node.remove());
    Object.assign(state, {
      mode: "idle",
      queue: [],
      total: 0,
      completed: 0,
      failed: [],
      cancelled: false,
    });
  }

  async function processQueue(items, resetProgress = false) {
    const settings = await chrome.storage.local.get({ batchSize: 4, minTextLength: 12 });
    if (resetProgress) {
      state.total = items.length;
      state.completed = 0;
      state.failed = [];
    }
    state.queue = [...items];
    state.mode = "translating";
    state.cancelled = false;

    while (state.queue.length && !state.cancelled) {
      const batch = state.queue.splice(0, settings.batchSize);
      updateProgress(`本地翻译 ${state.completed} / ${state.total} 段`);
      try {
        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          items: batch.map(({ id, text }) => ({ id, text })),
        });
        if (!response?.ok) throw new Error(response?.error || "本地模型请求失败");
        const translatedById = new Map(
          response.translations.map(({ id, translation }) => [id, translation])
        );
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
      updateProgress(
        state.failed.length
          ? `完成 ${state.completed} / ${state.total} 段；失败 ${state.failed.length} 段，再次点击重试`
          : `翻译完成 ${state.completed} / ${state.total} 段`
      );
    }
  }

  async function toggleTranslation() {
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "TOGGLE_TRANSLATION") toggleTranslation();
  });
})();
```

- [ ] **Step 2: Add isolated CSS**

```css
local-llm-translation {
  display: block !important;
  margin: 0.35em 0 0.9em !important;
  padding: 0.55em 0.8em !important;
  border-left: 3px solid #4f8cff !important;
  background: #f3f7ff !important;
  color: #244266 !important;
  font: 400 0.95em/1.7 system-ui, sans-serif !important;
}

local-llm-translation[data-failed="true"] {
  border-left-color: #d97706 !important;
  background: #fff7ed !important;
  color: #9a3412 !important;
}

#local-llm-progress {
  position: fixed !important;
  right: 18px !important;
  bottom: 18px !important;
  z-index: 2147483647 !important;
  padding: 10px 14px !important;
  border-radius: 999px !important;
  background: #1f2937 !important;
  color: #fff !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22) !important;
  font: 500 13px/1.2 system-ui, sans-serif !important;
}
```

- [ ] **Step 3: Run syntax checks**

Run:

```powershell
node --check work\local-llm-translator-extension\content-script.js
```

Expected: exit 0.

### Task 6: Implement options page

**Files:**
- Create: `work/local-llm-translator-extension/options.html`
- Create: `work/local-llm-translator-extension/options.js`
- Create: `work/local-llm-translator-extension/options.css`

- [ ] **Step 1: Add options markup**

Create a complete options page with these exact IDs:

```html
<!doctype html>
<meta charset="utf-8">
<title>本地沉浸式翻译设置</title>
<link rel="stylesheet" href="options.css">
<main>
<h1>本地沉浸式翻译设置</h1>
<form id="settings-form">
  <label>本地接口地址<input id="base-url" required></label>
  <label>模型名称<input id="model" required></label>
  <label>目标语言<input id="target-language" required></label>
  <label>每批段落数<input id="batch-size" type="number" min="1" max="12" required></label>
  <label>最短段落字符数<input id="min-text-length" type="number" min="1" max="200" required></label>
  <div class="actions">
    <button type="submit">保存设置</button>
    <button type="button" id="reset">恢复默认值</button>
    <button type="button" id="test-connection">测试本地连接</button>
  </div>
</form>
<pre id="status"></pre>
</main>
<script type="module" src="options.js"></script>
```

- [ ] **Step 2: Add load, save, reset, and test logic**

Create `options.js`:

```js
import { DEFAULT_SETTINGS } from "./lib/translator-core.js";

const fields = {
  baseUrl: document.getElementById("base-url"),
  model: document.getElementById("model"),
  targetLanguage: document.getElementById("target-language"),
  batchSize: document.getElementById("batch-size"),
  minTextLength: document.getElementById("min-text-length"),
};
const status = document.getElementById("status");

function render(settings) {
  for (const [key, input] of Object.entries(fields)) input.value = settings[key];
}

function readForm() {
  return {
    baseUrl: fields.baseUrl.value.trim(),
    model: fields.model.value.trim(),
    targetLanguage: fields.targetLanguage.value.trim(),
    batchSize: Number(fields.batchSize.value),
    minTextLength: Number(fields.minTextLength.value),
  };
}

async function loadSettings() {
  render({ ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) });
}

async function saveSettings(event) {
  event.preventDefault();
  const settings = readForm();
  await chrome.storage.local.set(settings);
  status.textContent = "设置已保存";
}

async function resetSettings() {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  render(DEFAULT_SETTINGS);
  status.textContent = "已恢复默认值";
}

async function testConnection() {
  status.textContent = "正在测试本地连接…";
  const response = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
  status.textContent = response?.ok
    ? `连接成功\n检测到模型：${response.models.join(", ") || "未列出模型"}`
    : `连接失败：${response?.error || "未知错误"}`;
}

document.getElementById("settings-form").addEventListener("submit", saveSettings);
document.getElementById("reset").addEventListener("click", resetSettings);
document.getElementById("test-connection").addEventListener("click", testConnection);
loadSettings();
```

- [ ] **Step 3: Add options CSS**

Create a compact settings card with system font, clear labels, buttons, and a monospace status box.

- [ ] **Step 4: Run syntax checks**

Run:

```powershell
node --check work\local-llm-translator-extension\options.js
```

Expected: exit 0.

### Task 7: Add local fixture and verify model endpoint

**Files:**
- Create: `work/local-llm-translator-extension/test-pages/article.html`

- [ ] **Step 1: Add fixture article**

```html
<!doctype html>
<meta charset="utf-8">
<title>Local Translator Test Article</title>
<main>
  <article>
    <h1>Scientists unveil a new method for studying ocean currents</h1>
    <p>Researchers have developed a more accurate way to track how heat moves through the world's oceans.</p>
    <p>The findings could help climate scientists improve long-term forecasts and better understand regional weather patterns.</p>
  </article>
</main>
```

- [ ] **Step 2: Verify live local model endpoint**

Run:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:8080/v1/models' -UseBasicParsing -TimeoutSec 10
```

Expected: HTTP 200 and a model entry for `gemma.gguf`.

- [ ] **Step 3: Probe one live translation request**

Run:

```powershell
$body = @{
  model = 'gemma.gguf'
  temperature = 0.1
  messages = @(
    @{ role = 'system'; content = 'Translate every input item into Simplified Chinese. Return JSON only as an array with id and translation.' }
    @{ role = 'user'; content = '[{"id":"p-1","text":"Researchers published a detailed report today."}]' }
  )
} | ConvertTo-Json -Depth 6
$response = Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:8080/v1/chat/completions' `
  -ContentType 'application/json' `
  -Body $body `
  -TimeoutSec 60
$response.choices[0].message.content
```

Expected: non-empty model content containing the paragraph ID `p-1`. Adjust parsing only if the live response format differs from the verified contract.

### Task 8: Run complete verification and deliver unpacked extension

**Files:**
- Create: `work/local-llm-translator-extension/README.md`
- Copy to: `outputs/local-llm-translator-extension/`

- [ ] **Step 1: Run complete automated suite**

Run:

```powershell
node --test work\local-llm-translator-extension\tests\*.test.mjs
node --check work\local-llm-translator-extension\service-worker.js
node --check work\local-llm-translator-extension\content-script.js
node --check work\local-llm-translator-extension\options.js
```

Expected: all tests pass and all syntax checks exit 0.

- [ ] **Step 2: Add README**

Document:

1. start the local model server at `http://127.0.0.1:8080/v1`;
2. open `chrome://extensions`;
3. enable developer mode;
4. choose “加载已解压的扩展程序”;
5. select `outputs/local-llm-translator-extension`;
6. open a normal article page;
7. click “本地沉浸式翻译”;
8. open extension details and choose extension options to change settings.

- [ ] **Step 3: Copy delivery folder**

Run:

```powershell
$source = (Resolve-Path 'work\local-llm-translator-extension').Path
$outputs = (Resolve-Path 'outputs').Path
$destination = Join-Path $outputs 'local-llm-translator-extension'
if (Test-Path -LiteralPath $destination) {
  $resolvedDestination = (Resolve-Path $destination).Path
  if (-not $resolvedDestination.StartsWith($outputs, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a directory outside outputs"
  }
  Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
}
New-Item -ItemType Directory -Path $destination | Out-Null
Get-ChildItem -LiteralPath $source -Force |
  Where-Object { $_.Name -notin @('tests', 'test-pages') } |
  Copy-Item -Destination $destination -Recurse -Force
```

This deliberately excludes `tests` and `test-pages` from the final output directory.

- [ ] **Step 4: Verify delivery privacy boundary**

Run:

```powershell
Get-ChildItem -LiteralPath 'outputs\local-llm-translator-extension' -Recurse -File |
  Select-String -Pattern 'https?://' |
  Select-Object Path,LineNumber,Line
```

Expected: only `http://127.0.0.1:8080/v1`, `http://127.0.0.1/*`, and `http://localhost/*` references.

- [ ] **Step 5: Verify through Chrome**

Use the Chrome extension loading flow, open the local fixture or a normal article page, click the extension icon, and visually confirm:

- original paragraph remains;
- Simplified Chinese translation appears below the original paragraph;
- progress bubble appears;
- a second click after completion removes translations;
- options connection test lists `gemma.gguf`;
- no cloud endpoint is contacted.

## Review Checkpoint

Stop after the unpacked-extension delivery and Chrome verification. Report the output directory and installation steps. Do not add PDF, subtitles, automatic translation, dynamic DOM monitoring, or selection translation in this version.
