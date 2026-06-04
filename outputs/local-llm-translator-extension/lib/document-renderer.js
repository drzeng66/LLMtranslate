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

export function buildBilingualHtml({ title = "中英文对照文档", rows = [] } = {}) {
  const safeTitle = escapeHtml(title);
  const rowHtml = rows.map((row) => `
    <section class="bilingual-row ${escapeHtml(row.status)}">
      <div class="row-index">${row.index}</div>
      <article class="source-pane"><h2>原文</h2><p>${escapeHtml(row.source)}</p></article>
      <article class="translation-pane"><h2>译文</h2><p>${escapeHtml(row.translation)}</p></article>
    </section>`).join("\n");
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
    .bilingual-row { display: grid; grid-template-columns: 56px minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: stretch; margin-bottom: 14px; }
    .row-index, .source-pane, .translation-pane { background: #fff; border: 1px solid #dbe2ee; border-radius: 12px; box-shadow: 0 6px 18px rgba(39,55,84,.05); }
    .row-index { display: grid; place-items: center; color: #64748b; font-weight: 700; }
    .source-pane, .translation-pane { padding: 14px 16px; }
    h2 { margin: 0 0 8px; font-size: 13px; color: #64748b; letter-spacing: .08em; }
    p { margin: 0; white-space: pre-wrap; }
    .translation-pane { border-left: 4px solid #4f8cff; }
    .failed .translation-pane { border-left-color: #d97706; background: #fff7ed; color: #9a3412; }
    @media (max-width: 820px) {
      .bilingual-row { grid-template-columns: 40px minmax(0, 1fr); }
      .translation-pane { grid-column: 2; }
    }
    @media print {
      :root { background: #fff; }
      main.bilingual-document { width: auto; margin: 0; }
      header, .row-index, .source-pane, .translation-pane { box-shadow: none; }
      .bilingual-row { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="bilingual-document">
    <header>
      <h1>${safeTitle}</h1>
      <p>中英文全文对照，共 ${rows.length} 个对照段落。</p>
    </header>
    ${rowHtml}
  </main>
</body>
</html>`;
}
