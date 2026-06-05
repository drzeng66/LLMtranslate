import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentScript = readFileSync(new URL("../content-script.js", import.meta.url), "utf8");
const popupJs = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../popup.html", import.meta.url), "utf8");

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
