import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentScript = readFileSync(new URL("../content-script.js", import.meta.url), "utf8");
const contentStyle = readFileSync(new URL("../content-style.css", import.meta.url), "utf8");
const popupJs = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("popup exposes separate article and immersive translation buttons", () => {
  assert.match(popupJs, /activeCommand\("TRANSLATE_ARTICLE"\)/);
  assert.match(popupJs, /activeCommand\("TRANSLATE_IMMERSIVE"\)/);
  assert.match(contentScript, /message\.type === "TRANSLATE_ARTICLE"/);
  assert.match(contentScript, /message\.type === "TRANSLATE_IMMERSIVE"/);
  assert.match(popupHtml, /正文翻译/);
  assert.match(popupHtml, /沉浸翻译/);
});

test("article and immersive commands toggle their own page translations", () => {
  assert.match(contentScript, /function hasTranslationsForSource\(source\)/);
  assert.match(contentScript, /async function translateArticle\(\)/);
  assert.match(contentScript, /async function translateImmersive\(\)/);
  assert.match(contentScript, /hasTranslationsForSource\("article"\)/);
  assert.match(contentScript, /hasTranslationsForSource\("immersive"\)/);
  assert.match(contentScript, /removeTranslations\(\)/);
});

test("article collection includes common div-based article layouts", () => {
  assert.match(contentScript, /function collectArticleItems/);
  assert.match(contentScript, /article div/);
  assert.match(contentScript, /main div/);
  assert.ok(contentScript.includes('[role=\\"main\\"] div'));
});

test("immersive collection includes inline ui text and visible page controls", () => {
  assert.match(contentScript, /function collectImmersiveItems/);
  assert.match(contentScript, /span/);
  assert.match(contentScript, /button/);
  assert.match(contentScript, /label/);
  assert.match(contentScript, /a/);
  assert.match(contentScript, /function containsEnglishText/);
});

test("immersive translation prioritizes viewport text, caches duplicates, and uses parallel workers", () => {
  assert.match(contentScript, /function sortItemsForTranslation/);
  assert.match(contentScript, /function isInViewport/);
  assert.match(contentScript, /translationCache/);
  assert.match(contentScript, /cacheKey/);
  assert.match(contentScript, /parallelRequests/);
  assert.match(contentScript, /Promise\.all\(workers\)/);
});

test("background worker attempts true multi-item batch translation before per-item fallback", () => {
  assert.match(serviceWorker, /function canTranslateAsSingleBatch/);
  assert.match(serviceWorker, /return await translateOneChunk\(items, settings, options\)/);
  assert.match(serviceWorker, /falling back to per-item translation/);
});

test("selection translation is default-on with transient popover behavior", () => {
  assert.match(contentScript, /selectionTranslationEnabled/);
  assert.match(contentScript, /function scheduleSelectionTranslation/);
  assert.match(contentScript, /function showSelectionPopover/);
  assert.match(contentScript, /function hideSelectionPopover/);
  assert.match(contentScript, /local-llm-selection-popover/);
  assert.match(contentScript, /selectionchange/);
  assert.match(contentScript, /document\.addEventListener\("mouseup"/);
  assert.match(contentScript, /event\.key === "Escape"/);
});

test("selection translation is injected automatically on newly opened http pages", () => {
  assert.ok(Array.isArray(manifest.content_scripts));
  const contentScriptEntry = manifest.content_scripts.find((entry) => entry.js?.includes("content-script.js"));
  assert.ok(contentScriptEntry);
  assert.deepEqual(contentScriptEntry.matches, ["http://*/*", "https://*/*"]);
  assert.equal(contentScriptEntry.run_at, "document_idle");
  assert.ok(contentScriptEntry.css.includes("content-style.css"));
  assert.ok(manifest.host_permissions.includes("http://*/*"));
  assert.ok(manifest.host_permissions.includes("https://*/*"));
  assert.match(serviceWorker, /async function isAlreadyInjected/);
  assert.match(serviceWorker, /__localLlmTranslatorInjected/);
  assert.match(serviceWorker, /if \(await isAlreadyInjected\(tabId\)\) return/);
  assert.match(serviceWorker, /chrome\.runtime\.onInstalled\.addListener/);
  assert.match(serviceWorker, /chrome\.runtime\.onStartup\.addListener/);
  assert.match(serviceWorker, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(serviceWorker, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(serviceWorker, /function isInjectableUrl/);
});

test("selection popover hides robustly after selection is cancelled", () => {
  assert.match(contentScript, /function cancelSelectionTranslation/);
  assert.match(contentScript, /state\.selectionRequestId \+= 1/);
  assert.match(contentScript, /popover\.id = "local-llm-selection-popover"/);
  assert.match(contentScript, /document\.querySelectorAll\("local-llm-selection-popover, #local-llm-selection-popover"\)/);
  assert.match(contentScript, /leftovers\.filter\(\(node\) => node !== popover\)\.forEach\(\(node\) => node\.remove\(\)\)/);
  assert.match(contentScript, /dismissedSelectionSignature/);
  assert.match(contentScript, /function currentSelectionSignature/);
  assert.match(contentScript, /state\.dismissedSelectionSignature === signature/);
  assert.match(contentScript, /document\.addEventListener\("mousedown", \(event\) => \{\s*if \(event\.target\?\.closest\?\.\("local-llm-selection-popover"\)\) return;\s*cancelSelectionTranslation\(\);/s);
  assert.match(contentScript, /setTimeout\(\(\) => \{\s*if \(!getSelectedText\(\)\) cancelSelectionTranslation\(\);/s);
  assert.match(contentScript, /document\.addEventListener\("selectionchange"/);
  assert.match(contentScript, /window\.addEventListener\("blur"/);
  assert.match(contentScript, /document\.addEventListener\("visibilitychange"/);
});

test("page and selection translations release llama context after completion", () => {
  assert.match(contentScript, /function releaseModelContext/);
  assert.match(contentScript, /type: "RELEASE_CONTEXT"/);
  assert.match(contentScript, /releaseModelContext\("page-completed"\)/);
  assert.match(contentScript, /releaseModelContext\("selection-completed"\)/);
  assert.match(serviceWorker, /message\.type === "RELEASE_CONTEXT"/);
  assert.match(serviceWorker, /function scheduleContextRelease/);
  assert.match(serviceWorker, /activeTranslations/);
  assert.match(serviceWorker, /contextReleaseTimer/);
  assert.match(serviceWorker, /async function bestEffortClearServerContext/);
  assert.match(serviceWorker, /clearAllServerSlots/);
});

test("background worker handles selected word and sentence translation", () => {
  assert.match(serviceWorker, /message\.type === "TRANSLATE_SELECTION"/);
  assert.match(serviceWorker, /async function translateSelection/);
  assert.match(serviceWorker, /selection-word/);
  assert.match(serviceWorker, /selection-sentence/);
});

test("selection popover has floating styles and does not affect page layout", () => {
  assert.match(contentStyle, /local-llm-selection-popover/);
  assert.match(contentStyle, /position: fixed/);
  assert.match(contentStyle, /z-index: 2147483647/);
  assert.match(contentStyle, /data-mode="word"/);
});

test("translation nodes carry layout and text-length metadata for compact rendering", () => {
  assert.match(contentScript, /dataset\.layout/);
  assert.match(contentScript, /dataset\.textLength/);
  assert.match(contentStyle, /data-source="immersive"/);
  assert.match(contentStyle, /data-layout="compact"/);
  assert.match(contentStyle, /data-text-length="short"/);
});
