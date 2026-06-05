# Extension Article And Immersive Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two popup buttons: article translation for clean article reading and immersive translation for all visible English on the page.

**Architecture:** Split content-script collection into article and immersive collectors. Popup sends `TRANSLATE_ARTICLE` or `TRANSLATE_IMMERSIVE`. Both modes reuse the existing translation queue and insertion pipeline; Ctrl hover remains paragraph-only.

**Tech Stack:** Chrome extension Manifest V3, JavaScript, Node `node:test`.

---

### Task 1: Tests
- [ ] Update static tests to require `TRANSLATE_ARTICLE` and `TRANSLATE_IMMERSIVE` popup commands.
- [ ] Require separate `collectArticleItems` and `collectImmersiveItems` functions.
- [ ] Require immersive selector to include `span`, `a`, `button`, `label`, and page text containers.
- [ ] Verify tests fail before implementation.

### Task 2: Implementation
- [ ] Add two popup buttons: `正文翻译` and `沉浸翻译`.
- [ ] Add content-script handlers for `TRANSLATE_ARTICLE` and `TRANSLATE_IMMERSIVE`.
- [ ] Make article mode use clean paragraph-style candidates.
- [ ] Make immersive mode use broader visible English element candidates.
- [ ] Keep `Ctrl + hover` behavior unchanged.
- [ ] Bump manifest and README to 0.2.7.

### Task 3: Verify and package
- [ ] Run `npm test`.
- [ ] Regenerate lightweight zip without node_modules/tests.
- [ ] Commit and push.
