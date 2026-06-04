import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentScript = readFileSync(new URL("../content-script.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../popup.html", import.meta.url), "utf8");

test("hover translation is triggered by Ctrl instead of Shift", () => {
  assert.match(contentScript, /hoverEnabled:\s*true/);
  assert.match(contentScript, /event\.ctrlKey/);
  assert.doesNotMatch(contentScript, /event\.shiftKey/);
  assert.match(contentScript, /按住 Ctrl/);
  assert.match(popupHtml, /Ctrl \+ 鼠标悬停默认开启/);
  assert.doesNotMatch(popupHtml, /Shift \+ 鼠标/);
});

test("hover translation also works when Ctrl is pressed after the pointer is already on a paragraph", () => {
  assert.match(contentScript, /lastHoverTarget/);
  assert.match(contentScript, /addEventListener\("mousemove"/);
  assert.match(contentScript, /addEventListener\("keydown"/);
  assert.match(contentScript, /event\.key === "Control"/);
});

test("content script can replace old listeners after extension reload", () => {
  assert.match(contentScript, /__localLlmTranslatorAbortController/);
  assert.match(contentScript, /\.abort\(\)/);
  assert.match(contentScript, /signal:\s*scriptAbortController\.signal/);
  assert.doesNotMatch(contentScript, /__localLlmTranslatorInjected\) return/);
});
