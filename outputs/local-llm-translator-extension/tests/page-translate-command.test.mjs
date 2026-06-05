import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentScript = readFileSync(new URL("../content-script.js", import.meta.url), "utf8");
const contentStyle = readFileSync(new URL("../content-style.css", import.meta.url), "utf8");
const popupJs = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");

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

test("translation nodes carry layout and text-length metadata for compact rendering", () => {
  assert.match(contentScript, /dataset\.layout/);
  assert.match(contentScript, /dataset\.textLength/);
  assert.match(contentStyle, /data-source="immersive"/);
  assert.match(contentStyle, /data-layout="compact"/);
  assert.match(contentStyle, /data-text-length="short"/);
});
