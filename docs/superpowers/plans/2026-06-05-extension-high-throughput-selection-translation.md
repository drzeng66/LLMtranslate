# Extension High Throughput And Selection Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship extension version 0.2.9 with more aggressive local throughput defaults and default-on selected word/sentence translation popovers.

**Architecture:** Keep shared settings, request prompts, and extraction helpers in `lib/translator-core.js`; page/selection UI and scheduling in `content-script.js`; model calls in `service-worker.js`; options UI in `options.html/js`. Selection translations use a new runtime command so they do not mutate page layout and disappear when the selection is cancelled.

**Tech Stack:** Chrome MV3 extension, vanilla JavaScript modules, Node test runner, llama.cpp/OpenAI-compatible HTTP APIs.

---

### Task 1: Write regression tests

**Files:**
- Modify: `outputs/local-llm-translator-extension/tests/translator-core.test.mjs`
- Modify: `outputs/local-llm-translator-extension/tests/page-translate-command.test.mjs`

- [ ] Add tests requiring default high-throughput local settings: batch size 10, parallel requests 3, max clamp 16/4.
- [ ] Add tests requiring `selectionTranslationEnabled`, `classifySelectionText`, and selection chat prompt behavior.
- [ ] Add tests requiring content script selection listeners, popover creation, auto-hide, and background `TRANSLATE_SELECTION` command.
- [ ] Run `npm test` and verify tests fail before implementation.

### Task 2: Implement shared settings and selection request prompts

**Files:**
- Modify: `outputs/local-llm-translator-extension/lib/translator-core.js`

- [ ] Add `selectionTranslationEnabled` default true.
- [ ] Raise local throughput defaults and clamp ranges.
- [ ] Export `classifySelectionText(text)` returning `word`, `sentence`, or `none`.
- [ ] Update `buildChatRequest()` to support `mode: "selection-word"` and `mode: "selection-sentence"`.

### Task 3: Implement background selection command

**Files:**
- Modify: `outputs/local-llm-translator-extension/service-worker.js`

- [ ] Add runtime handler for `TRANSLATE_SELECTION`.
- [ ] Translate selected words/sentences as single low-latency items using selection-specific modes and token budgets.

### Task 4: Implement content-script selection popover

**Files:**
- Modify: `outputs/local-llm-translator-extension/content-script.js`
- Modify: `outputs/local-llm-translator-extension/content-style.css`

- [ ] Listen to `selectionchange`, `mouseup`, `keyup`, and Escape.
- [ ] Debounce selection translation to avoid model spam while dragging.
- [ ] Show a floating `local-llm-selection-popover` near selection rect.
- [ ] Auto-hide when selection is empty, changes, Escape is pressed, page is clicked elsewhere, or translations are cleared.
- [ ] Cache selection translations by normalized selected text and mode.

### Task 5: Update options, docs, version, package

**Files:**
- Modify: `outputs/local-llm-translator-extension/options.html`
- Modify: `outputs/local-llm-translator-extension/options.js`
- Modify: `outputs/local-llm-translator-extension/manifest.json`
- Modify: `outputs/local-llm-translator-extension/README.md`
- Update: `outputs/local-llm-translator-extension.zip`

- [ ] Add default-on selection translation option.
- [ ] Bump version to `0.2.9`.
- [ ] Run `npm test`, `node --check` for changed JS, verify zip excludes `node_modules` and tests.
- [ ] Commit and push to `main`.
