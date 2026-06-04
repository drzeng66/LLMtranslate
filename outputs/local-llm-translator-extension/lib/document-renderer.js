export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildBilingualRows(segments, translations) {
  const byId = new Map((translations || []).map((item) => [item.id, item]));
  return (segments || []).map((segment, index) => {
    const translated = byId.get(segment.id);
    const translation = translated?.translation?.trim();
    return {
      id: segment.id,
      index: index + 1,
      source: segment.text || "",
      translation: translation || "待翻译",
      status: translation ? (translation.startsWith("翻译失败：") ? "failed" : "done") : "pending",
    };
  });
}

function normalizeTranslationText(translation, index) {
  const text = String(translation ?? "").trim();
  if (!text) return { text: `【${index}】待翻译`, status: "pending" };
  if (text.startsWith("翻译失败：")) {
    return {
      text: `【${index}】该段翻译失败：${text.replace(/^翻译失败：/, "")}`,
      status: "failed",
    };
  }
  return { text, status: "done" };
}

export function buildBilingualColumns(segments = [], translations = []) {
  const byId = new Map((translations || []).map((item) => [item.id, item]));
  const sourceParts = [];
  const translationParts = [];
  let translatedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const [offset, segment] of (segments || []).entries()) {
    const index = offset + 1;
    sourceParts.push(segment?.text || "");
    const translated = byId.get(segment?.id);
    const normalized = normalizeTranslationText(translated?.translation, index);
    translationParts.push(normalized.text);
    if (normalized.status === "done") translatedCount += 1;
    else if (normalized.status === "failed") failedCount += 1;
    else pendingCount += 1;
  }

  const totalCount = (segments || []).length;
  const status = failedCount
    ? "failed"
    : pendingCount
      ? (translatedCount ? "partial" : "pending")
      : "done";

  return {
    sourceText: sourceParts.join("\n\n"),
    translationText: translationParts.join("\n\n"),
    status,
    totalCount,
    translatedCount,
    failedCount,
    pendingCount,
  };
}

export function buildBilingualHtml({ title = "中英文对照文档", columns = buildBilingualColumns() } = {}) {
  const safeTitle = escapeHtml(title);
  const safeStatus = escapeHtml(columns.status || "pending");
  const translatedCount = Number(columns.translatedCount || 0);
  const totalCount = Number(columns.totalCount || 0);
  const failedCount = Number(columns.failedCount || 0);
  const failedNote = failedCount ? `，失败 ${failedCount} 段` : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} - 中英文对照</title>
  <style>
    :root { color: #172033; font: 16px/1.75 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7fb; }
    body { margin: 0; }
    main.bilingual-document { width: min(1180px, calc(100% - 32px)); margin: 24px auto 48px; }
    header { margin-bottom: 18px; padding: 18px 22px; background: #fff; border: 1px solid #dbe2ee; border-radius: 14px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .bilingual-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .source-pane, .translation-pane { background: #fff; border: 1px solid #dbe2ee; border-radius: 12px; box-shadow: 0 6px 18px rgba(39,55,84,.05); }
    .source-pane, .translation-pane { padding: 14px 16px; }
    h2 { margin: 0 0 8px; font-size: 13px; color: #64748b; letter-spacing: .08em; }
    .full-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .translation-pane { border-left: 4px solid #4f8cff; }
    .pending .translation-pane { color: #64748b; background: #f8fafc; border-left-color: #cbd5e1; }
    .failed .translation-pane { border-left-color: #d97706; background: #fff7ed; color: #9a3412; }
    @media (max-width: 820px) {
      .bilingual-columns { grid-template-columns: 1fr; }
    }
    @media print {
      :root { background: #fff; }
      main.bilingual-document { width: auto; margin: 0; }
      header, .source-pane, .translation-pane { box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="bilingual-document">
    <header>
      <h1>${safeTitle}</h1>
      <p>左栏原文全文，右栏译文全文。已翻译 ${translatedCount} / ${totalCount} 段${failedNote}。</p>
    </header>
    <section class="bilingual-columns ${safeStatus}">
      <article class="source-pane">
        <h2>原文全文</h2>
        <div class="full-text">${escapeHtml(columns.sourceText || "")}</div>
      </article>
      <article class="translation-pane">
        <h2>译文全文</h2>
        <div class="full-text">${escapeHtml(columns.translationText || "")}</div>
      </article>
    </section>
  </main>
</body>
</html>`;
}
