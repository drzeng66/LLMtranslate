# Hermes Medical Router Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hermes doctor-workstation / HIS / LIS / PACS / inspection-query work use OpenAI ChatGPT 5.5 through `openai-codex`, while ordinary simple work continues using local llama.cpp.

**Architecture:** Add a dedicated `medical_strong` route separate from generic `strong`. `medical_strong` resolves only to `openai-codex` by default, while generic `strong` can keep `openai-codex,Api.apikey.fun` fallback.

**Tech Stack:** Python 3.11, unittest, Hermes smart-router, OpenAI-compatible HTTP router.

---

### Task 1: Add failing policy tests

**Files:**
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\hermes-smart-router\tests\test_router.py`

- [ ] Add tests that doctor workstation, LIS critical-value, and lab judgement requests route to `medical_strong`.
- [ ] Add test that medical strong provider list defaults to `['openai-codex']`.
- [ ] Run router tests and confirm the new tests fail before implementation.

### Task 2: Implement dedicated medical route

**Files:**
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\hermes-smart-router\router.py`
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\hermes-smart-router\scripts\start-router.ps1`
- Modify: `C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\hermes-smart-router\scripts\start-router.bat`

- [ ] Add `DEFAULT_MEDICAL_STRONG_PROVIDER = 'openai-codex'`.
- [ ] Add `default_medical_strong_providers()` with env override `HERMES_ROUTER_MEDICAL_STRONG_PROVIDERS`.
- [ ] Return `RouteDecision('medical_strong', ...)` for forced medical-system tasks.
- [ ] Make `resolve_backend_candidates('medical_strong')` use the medical provider list.
- [ ] Add startup env lines for medical provider and debug log.

### Task 3: Verify and restart runtime

**Files:**
- No code changes expected beyond Task 2.

- [ ] Run `python -m unittest discover -s outputs\hermes-smart-router\tests -v` and confirm all tests pass.
- [ ] Send one doctor-workstation request to `http://127.0.0.1:8788/v1/chat/completions`; confirm header `X-Hermes-Smart-Route=medical_strong` and provider `openai-codex`.
- [ ] Send one simple translation request; confirm route `local` and provider `llamaccp`.
- [ ] Commit and push.
