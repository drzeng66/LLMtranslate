# Extension Page Translate Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the popup translate button translate the whole page by default, while Ctrl+hover remains paragraph-only translation.

**Architecture:** Keep popup and service-worker message flow, but make the content script expose explicit commands for full-page translation and clear/toggle state. Add unit tests around the content-script pure helpers so button semantics are protected without needing Chrome.

**Tech Stack:** Chrome extension Manifest V3, JavaScript ES modules, Node `node:test`.

---

### Task 1: Add tests for command semantics

**Files:**
- Create/Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\local-llm-translator-extension\tests\page-translate-command.test.mjs`
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\local-llm-translator-extension\content-script.js`

- [ ] Export testable helpers or parseable constants showing popup command maps to full-page translation.
- [ ] Verify test fails before implementation.

### Task 2: Implement full-page button behavior

**Files:**
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\local-llm-translator-extension\popup.js`
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\local-llm-translator-extension\content-script.js`
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\local-llm-translator-extension\README.md`

- [ ] Keep `TOGGLE_TRANSLATION` as the popup button command.
- [ ] Ensure `TOGGLE_TRANSLATION` runs whole-page translation when no translation exists.
- [ ] Ensure `TOGGLE_TRANSLATION` clears translations when the page already has plugin translations.
- [ ] Keep Ctrl+hover paragraph translation enabled by default.

### Task 3: Verify and package

**Files:**
- Modify: extension manifest version if behavior changed.
- Update: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\local-llm-translator-extension.zip`

- [ ] Run `npm test` inside the extension directory.
- [ ] Create/refresh zip excluding `node_modules` and tests unless current packaging convention includes them.
- [ ] Commit and push.
