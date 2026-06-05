# Extension Speed And Layout Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make immersive page translation faster and more readable by using real batch requests, limited concurrency, viewport-first ordering, translation cache, and compact bilingual layout.

**Architecture:** Keep page collection and rendering in `content-script.js`, model calls in `service-worker.js`, and shared settings/request builders in `lib/translator-core.js`. The service worker will translate compatible multi-item batches in one OpenAI chat request, while content script schedules several batches concurrently and inserts translations in compact styles.

**Tech Stack:** Chrome MV3 extension, vanilla JavaScript modules, Node test runner, llama.cpp/OpenAI-compatible HTTP APIs.

---

### Task 1: Regression tests for speed settings and batch behavior

**Files:**
- Modify: `outputs/local-llm-translator-extension/tests/translator-core.test.mjs`
- Modify: `outputs/local-llm-translator-extension/tests/page-translate-command.test.mjs`

- [ ] Add tests that require `parallelRequests`, larger `batchSize`, compact layout settings, true multi-item batch paths, cache helpers, and viewport-first ordering.
- [ ] Run `npm test` and verify the tests fail before implementation.

### Task 2: Implement settings and service-worker true batching

**Files:**
- Modify: `outputs/local-llm-translator-extension/lib/translator-core.js`
- Modify: `outputs/local-llm-translator-extension/service-worker.js`
- Modify: `outputs/local-llm-translator-extension/options.html`
- Modify: `outputs/local-llm-translator-extension/options.js`

- [ ] Add defaults and normalization for `parallelRequests` and `layoutMode`.
- [ ] Make `translateBatch()` submit multi-item batches as one request when chunks fit, with sequential fallback on batch failure.
- [ ] Expose settings in options UI.

### Task 3: Implement content-script scheduling and compact layout

**Files:**
- Modify: `outputs/local-llm-translator-extension/content-script.js`
- Modify: `outputs/local-llm-translator-extension/content-style.css`

- [ ] Add viewport-first item sorting.
- [ ] Add per-page text cache.
- [ ] Add bounded concurrent batch workers.
- [ ] Mark translation nodes with layout/source/length classes for compact immersive rendering.

### Task 4: Verify, package, commit, push

**Files:**
- Modify: `outputs/local-llm-translator-extension/manifest.json`
- Modify: `outputs/local-llm-translator-extension/README.md`
- Update: `outputs/local-llm-translator-extension.zip`

- [ ] Bump version to `0.2.8`.
- [ ] Run `npm test`.
- [ ] Regenerate the lightweight extension zip excluding `node_modules` and `tests`.
- [ ] Verify zip content and git status.
- [ ] Commit and push to `main`.
