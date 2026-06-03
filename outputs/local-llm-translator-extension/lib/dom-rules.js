const SKIPPED_TAGS = new Set([
  "ASIDE", "CODE", "FOOTER", "HEADER", "INPUT", "NAV",
  "NOSCRIPT", "PRE", "SCRIPT", "STYLE", "TEXTAREA",
  "LOCAL-LLM-TRANSLATION",
]);

export function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function isEligibleParagraphText(text, minTextLength) {
  const normalized = normalizeText(text);
  if (normalized.length < minTextLength) return false;
  if (/^https?:\/\/\S+$/i.test(normalized)) return false;
  if (/^[\d\s.,:%+\-()/]+$/.test(normalized)) return false;
  return true;
}

export function shouldSkipByAncestors(tagNames) {
  return tagNames.some((tag) => SKIPPED_TAGS.has(String(tag).toUpperCase()));
}
