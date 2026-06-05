import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentScript = readFileSync(new URL("../content-script.js", import.meta.url), "utf8");
const popupJs = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../popup.html", import.meta.url), "utf8");

test("popup primary translate button sends explicit whole-page command", () => {
  assert.match(popupJs, /activeCommand\("TRANSLATE_PAGE"\)/);
  assert.match(contentScript, /message\.type === "TRANSLATE_PAGE"/);
  assert.match(popupHtml, /翻译整个页面/);
});

test("whole-page command toggles existing page translations instead of paragraph hover", () => {
  assert.match(contentScript, /function hasPageTranslations\(\)/);
  assert.match(contentScript, /async function translatePage\(\)/);
  assert.match(contentScript, /hasPageTranslations\(\)/);
  assert.match(contentScript, /removeTranslations\(\)/);
});

test("whole-page collection includes common div-based article layouts", () => {
  assert.match(contentScript, /article div/);
  assert.match(contentScript, /main div/);
  assert.ok(contentScript.includes('[role=\\"main\\"] div'));
});
