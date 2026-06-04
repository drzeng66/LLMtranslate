export const DEFAULT_SETTINGS = Object.freeze({
  endpointMode: "local",
  baseUrl: "http://127.0.0.1:8080/v1",
  remoteBaseUrl: "http://frp4.ccszxc.site:14668/v1",
  model: "gemma.gguf",
  apiKey: "",
  targetLanguage: "简体中文",
  batchSize: 1,
  minTextLength: 12,
  maxChunkChars: 360,
  documentMaxChunkChars: 2200,
  documentMaxTokens: 4096,
  retryCount: 3,
  timeoutMs: 45000,
  hoverEnabled: true,
});

const ALLOWED_ENDPOINTS = new Set([
  "127.0.0.1",
  "localhost",
  "frp4.ccszxc.site",
]);

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, "");
}

export function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const endpointMode = merged.endpointMode || "local";
  const selectedBaseUrl =
    endpointMode === "remote"
      ? merged.remoteBaseUrl
      : endpointMode === "local"
        ? DEFAULT_SETTINGS.baseUrl
        : merged.baseUrl;
  return {
    ...merged,
    endpointMode,
    baseUrl: normalizeBaseUrl(selectedBaseUrl),
    remoteBaseUrl: normalizeBaseUrl(merged.remoteBaseUrl),
    batchSize: clampInt(merged.batchSize, 1, 3, 1),
    minTextLength: clampInt(merged.minTextLength, 1, 200, 12),
    maxChunkChars: clampInt(merged.maxChunkChars, 180, 1200, 360),
    documentMaxChunkChars: clampInt(merged.documentMaxChunkChars, 900, 3000, 2200),
    documentMaxTokens: clampInt(merged.documentMaxTokens, 1024, 8192, 4096),
    retryCount: clampInt(merged.retryCount, 1, 8, 3),
    timeoutMs: clampInt(merged.timeoutMs, 15000, 180000, 45000),
  };
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function endpointAllowed(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (!ALLOWED_ENDPOINTS.has(parsed.hostname)) return false;
    if (parsed.hostname === "frp4.ccszxc.site") return parsed.protocol === "http:" && parsed.port === "14668";
    return true;
  } catch {
    return false;
  }
}

export function assertAllowedEndpoint(url) {
  const normalized = new URL(url).toString();
  if (!endpointAllowed(normalized)) {
    throw new Error("接口地址未允许：仅允许本机或 http://frp4.ccszxc.site:14668");
  }
  return normalized;
}

export function modelsEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

export function chatEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

export function rootEndpoint(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/i, "");
}

export function isContextOverflowError(errorOrMessage) {
  const message = String(errorOrMessage?.message || errorOrMessage || "").toLowerCase();
  return [
    "context shift",
    "context window",
    "context is full",
    "slot context",
    "prompt exceeds",
    "exceed context",
    "too many tokens",
    "maximum context",
  ].some((pattern) => message.includes(pattern));
}

export function authHeaders(settings) {
  const headers = { "Content-Type": "application/json" };
  const apiKey = String(settings.apiKey || "").trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function buildChatRequest(settings, items, options = {}) {
  const normalized = normalizeSettings(settings);
  const mode = options.mode || "page";
  const maxTokens = clampInt(
    options.maxTokens,
    128,
    8192,
    mode === "document" ? normalized.documentMaxTokens : 384,
  );
  const targetLanguage =
    normalized.targetLanguage === "简体中文"
      ? "简体中文 (Simplified Chinese)"
      : normalized.targetLanguage;
  if (items.length === 1) {
    const systemPrompt = mode === "document"
      ? `Translate the user's medical academic PDF/document text into ${targetLanguage}. Return only the translated Chinese text. Do not summarize, omit, explain, add markdown, add quotes, or repeat the original text. Preserve medical terminology, drug names, abbreviations, numbers, headings, lists, table-like structure, citations, and paragraph meaning accurately.`
      : `Translate the user's text into ${targetLanguage}. Return only the translated Chinese text. Do not return JSON, markdown, quotes, explanations, IDs, or the original text. Preserve medical terms accurately.`;
    return {
      model: normalized.model,
      temperature: 0,
      stream: false,
      max_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: items[0].text,
        },
      ],
    };
  }
  return {
    model: normalized.model,
    temperature: 0,
    stream: false,
    max_tokens: mode === "document" ? Math.min(8192, Math.max(maxTokens, items.length * 1024)) : Math.min(2048, Math.max(512, items.length * 512)),
    messages: [
      {
        role: "system",
        content: mode === "document"
          ? `Translate each medical academic document item into ${targetLanguage}. Return JSON array only, with objects containing id and translation. No markdown, no explanation. Preserve medical terminology, numbers, headings, citations, and table-like structure accurately.`
          : `Translate each input item into ${targetLanguage}. Return JSON array only, with objects containing id and translation. No markdown, no explanation. Preserve medical terminology accurately.`,
      },
      {
        role: "user",
        content: JSON.stringify(items),
      },
    ],
  };
}

export function splitTextForTranslation(text, maxLength = DEFAULT_SETTINGS.maxChunkChars) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length <= 1 && normalized.length <= maxLength) return [normalized];

  const chunks = [];
  let buffer = "";
  for (const sentence of sentences.length ? sentences : [normalized]) {
    const candidates = hardSplit(sentence, maxLength);
    for (const candidate of candidates) {
      if (!buffer) {
        buffer = candidate;
      } else if (`${buffer} ${candidate}`.length <= maxLength) {
        buffer = `${buffer} ${candidate}`;
      } else {
        chunks.push(buffer.trim());
        buffer = candidate;
      }
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

function hardSplit(text, maxLength) {
  const chunks = [];
  let current = String(text || "").trim();
  while (current.length > maxLength) {
    const breakAt = Math.max(
      current.lastIndexOf(", ", maxLength),
      current.lastIndexOf("; ", maxLength),
      current.lastIndexOf(": ", maxLength),
      current.lastIndexOf(" ", maxLength)
    );
    const index = breakAt > Math.max(60, maxLength * 0.35) ? breakAt : maxLength;
    chunks.push(current.slice(0, index).trim());
    current = current.slice(index).trim();
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitDocumentIntoSegments(text, options = {}) {
  const maxChars = clampInt(options.maxChars, 300, 3000, 900);
  const minChars = clampInt(options.minChars, 80, maxChars, 180);
  const normalized = String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const segments = [];
  let buffer = "";
  const flush = () => {
    if (!buffer.trim()) return;
    const text = buffer.trim();
    for (const chunk of splitTextForTranslation(text, maxChars)) {
      segments.push({ id: `doc-${segments.length + 1}`, text: chunk });
    }
    buffer = "";
  };
  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    if (!buffer) buffer = paragraph;
    else if (`${buffer}\n\n${paragraph}`.length <= maxChars) buffer = `${buffer}\n\n${paragraph}`;
    else {
      if (buffer.length < minChars && `${buffer} ${paragraph}`.length <= maxChars * 1.3) buffer = `${buffer} ${paragraph}`;
      else {
        flush();
        buffer = paragraph;
      }
    }
  }
  flush();
  return segments;
}

export function makeDocxPlainText(documentXml) {
  const xml = String(documentXml || "");
  const paragraphs = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map((match) => {
    const paragraphXml = match[0];
    const texts = [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((part) => decodeXml(part[1]));
    return texts.join("").trim();
  }).filter(Boolean);
  return paragraphs.join("\n\n");
}

function decodeXml(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function extractTranslations(response, allowedIds) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("missing model response content");
  const normalizedContent = stripMarkdownFence(content);
  if (allowedIds.size === 1) return extractSingleTranslation(normalizedContent, allowedIds);
  const start = normalizedContent.indexOf("[");
  const end = normalizedContent.lastIndexOf("]");
  if (start < 0 || end < start) return extractSingleFallback(normalizedContent, allowedIds);
  const parsed = JSON.parse(normalizedContent.slice(start, end + 1));
  if (!Array.isArray(parsed)) return normalizeTranslationItems([parsed], allowedIds);
  return normalizeTranslationItems(parsed, allowedIds);
}

function stripMarkdownFence(content) {
  return String(content)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractSingleTranslation(content, allowedIds) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("model response content is empty");
  if (looksLikeTranslationJson(trimmed)) {
    const parsed = parseSingleTranslationJson(trimmed);
    return normalizeTranslationItems(Array.isArray(parsed) ? parsed : [parsed], allowedIds);
  }
  const [id] = allowedIds;
  return [{ id, translation: validateTranslation(id, trimmed) }];
}

function looksLikeTranslationJson(content) {
  if (content.startsWith("{")) return true;
  return /^\[\s*\{/.test(content);
}

function parseSingleTranslationJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("model returned incomplete JSON");
  }
}

function extractSingleFallback(content, allowedIds) {
  if (allowedIds.size !== 1) throw new Error("model response does not contain a JSON array");
  const [id] = allowedIds;
  try {
    const parsed = JSON.parse(content);
    return normalizeTranslationItems([parsed], allowedIds);
  } catch {
    if (/^\s*[\[{]/.test(content)) throw new Error("model returned incomplete JSON");
    if (!content.trim()) throw new Error("model response content is empty");
    return [{ id, translation: validateTranslation(id, content.trim()) }];
  }
}

function normalizeTranslationItems(parsed, allowedIds) {
  return parsed.map((item) => {
    if (!allowedIds.has(item.id)) throw new Error(`unknown paragraph id: ${item.id}`);
    if (typeof item.translation !== "string" || !item.translation.trim()) {
      throw new Error(`invalid translation for paragraph id: ${item.id}`);
    }
    return { id: item.id, translation: validateTranslation(item.id, item.translation.trim()) };
  });
}

function validateTranslation(id, translation) {
  if (/^\s*[\[{]\s*$/.test(translation)) {
    throw new Error(`incomplete translation for paragraph id: ${id}`);
  }
  return translation;
}
