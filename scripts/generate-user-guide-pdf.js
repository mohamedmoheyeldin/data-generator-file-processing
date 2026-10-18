const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const guides = [
  {
    id: "user",
    markdownPath: path.join(repoRoot, "docs", "USER_GUIDE.md"),
    outputPath: path.join(repoRoot, "docs", "USER_GUIDE.pdf"),
    title: "Data Generator & File Processing User Guide",
    tempFileName: "dgfp-user-guide-print.html",
  },
  {
    id: "leie",
    markdownPath: path.join(repoRoot, "docs", "LEIE_UPLOAD_VALIDATION_GUIDE.md"),
    outputPath: path.join(repoRoot, "docs", "LEIE_UPLOAD_VALIDATION_GUIDE.pdf"),
    title: "LEIE Data Upload and Validation Guide",
    tempFileName: "dgfp-leie-validation-guide-print.html",
  },
];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function flushParagraph(paragraphLines, parts) {
  if (paragraphLines.length === 0) {
    return;
  }
  const text = paragraphLines.join(" ").trim();
  if (text) {
    parts.push(`<p>${renderInlineMarkdown(text)}</p>`);
  }
  paragraphLines.length = 0;
}

function closeList(parts, state) {
  if (state.inList) {
    parts.push(`</${state.listTag || "ul"}>`);
    state.inList = false;
    state.listTag = "";
  }
}

function parseTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownToHtml(markdown, title) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  const paragraphLines = [];
  const state = {
    inList: false,
    listTag: "",
    inCode: false,
    codeLines: [],
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "<!-- pagebreak -->" && !state.inCode) {
      flushParagraph(paragraphLines, parts);
      closeList(parts, state);
      parts.push('<div class="page-break"></div>');
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph(paragraphLines, parts);
      closeList(parts, state);
      if (state.inCode) {
        parts.push(`<pre><code>${escapeHtml(state.codeLines.join("\n"))}</code></pre>`);
        state.codeLines = [];
        state.inCode = false;
      } else {
        state.inCode = true;
      }
      continue;
    }

    if (state.inCode) {
      state.codeLines.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushParagraph(paragraphLines, parts);
      closeList(parts, state);
      continue;
    }

    if (
      trimmed.startsWith("|") &&
      lineIndex + 1 < lines.length &&
      isTableDivider(lines[lineIndex + 1])
    ) {
      flushParagraph(paragraphLines, parts);
      closeList(parts, state);
      const headers = parseTableRow(trimmed);
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim().startsWith("|")) {
        rows.push(parseTableRow(lines[lineIndex]));
        lineIndex += 1;
      }
      lineIndex -= 1;
      parts.push("<table><thead><tr>");
      for (const header of headers) {
        parts.push(`<th>${renderInlineMarkdown(header)}</th>`);
      }
      parts.push("</tr></thead><tbody>");
      for (const row of rows) {
        parts.push("<tr>");
        for (const cell of row) {
          parts.push(`<td>${renderInlineMarkdown(cell)}</td>`);
        }
        parts.push("</tr>");
      }
      parts.push("</tbody></table>");
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(paragraphLines, parts);
      closeList(parts, state);
      const level = headingMatch[1].length;
      parts.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedListMatch = trimmed.match(/^-\s+(.+)$/);
    const orderedListMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    const listMatch = unorderedListMatch || orderedListMatch;
    if (listMatch) {
      flushParagraph(paragraphLines, parts);
      const listTag = orderedListMatch ? "ol" : "ul";
      if (state.inList && state.listTag !== listTag) {
        closeList(parts, state);
      }
      if (!state.inList) {
        parts.push(`<${listTag}>`);
        state.inList = true;
        state.listTag = listTag;
      }
      parts.push(`<li>${renderInlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    closeList(parts, state);
    paragraphLines.push(trimmed);
  }

  flushParagraph(paragraphLines, parts);
  closeList(parts, state);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --text: #172033;
        --muted: #56627a;
        --accent: #0d6efd;
        --border: #d8e0eb;
        --panel: #ffffff;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--text);
        background: #ffffff;
      }
      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 40px 48px 56px;
        background: var(--panel);
      }
      h1, h2, h3, h4, h5, h6 {
        color: var(--text);
        margin: 1.2em 0 0.45em;
        page-break-after: avoid;
      }
      h1 {
        font-size: 28px;
        border-bottom: 2px solid var(--border);
        padding-bottom: 12px;
      }
      h2 {
        font-size: 22px;
        color: var(--accent);
      }
      h3 {
        font-size: 18px;
      }
      p, li {
        font-size: 14px;
        line-height: 1.65;
      }
      p {
        margin: 0 0 12px;
      }
      ul, ol {
        margin: 0 0 14px 20px;
        padding: 0;
      }
      li {
        margin: 0 0 8px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0 18px;
        font-size: 13px;
      }
      th, td {
        border: 1px solid var(--border);
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #eaf2ff;
        color: #173b6c;
        font-weight: 700;
      }
      tr:nth-child(even) td {
        background: #f8faff;
      }
      code {
        font-family: "Cascadia Code", "Consolas", monospace;
        font-size: 0.92em;
        background: #eef3fb;
        padding: 1px 5px;
        border-radius: 6px;
      }
      pre {
        margin: 14px 0 18px;
        padding: 14px 16px;
        background: #0f172a;
        color: #f8fbff;
        border-radius: 12px;
        overflow: hidden;
        white-space: pre-wrap;
        word-break: break-word;
      }
      pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }
      .page-break { break-before: page; }
      tr { break-inside: avoid; }
      @page {
        margin: 18mm 14mm;
      }
    </style>
  </head>
  <body>
    <main>
      ${parts.join("\n")}
    </main>
  </body>
</html>`;
}

function getBrowserPath() {
  const candidates = [
    process.env.DGFP_PDF_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function usesWindowsBrowserFromWsl(browserPath) {
  return process.platform === "linux" && /^\/mnt\/[a-z]\//i.test(browserPath) && /\.exe$/i.test(browserPath);
}

function toWindowsPath(filePath) {
  const result = spawnSync("wslpath", ["-w", path.resolve(filePath)], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Unable to translate WSL path for PDF generation: ${filePath}`);
  }
  return result.stdout.trim();
}

function toFileUrl(filePath, windowsBrowserFromWsl = false) {
  if (windowsBrowserFromWsl) {
    const windowsPath = toWindowsPath(filePath).replace(/\\/g, "/");
    if (windowsPath.startsWith("//")) {
      return `file:${windowsPath}`;
    }
    return `file:///${windowsPath}`;
  }
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return `file:///${normalized}`;
}

function generatePdfGuide(browserPath, guide) {
  if (!fs.existsSync(guide.markdownPath)) {
    throw new Error(`Guide markdown not found: ${guide.markdownPath}`);
  }

  const html = markdownToHtml(fs.readFileSync(guide.markdownPath, "utf8"), guide.title);
  const tempHtmlPath = path.join(os.tmpdir(), guide.tempFileName);
  fs.writeFileSync(tempHtmlPath, html, "utf8");
  const windowsBrowserFromWsl = usesWindowsBrowserFromWsl(browserPath);
  const outputPath = windowsBrowserFromWsl ? toWindowsPath(guide.outputPath) : guide.outputPath;

  const result = spawnSync(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--allow-file-access-from-files",
      "--disable-software-rasterizer",
      "--no-pdf-header-footer",
      `--print-to-pdf=${outputPath}`,
      toFileUrl(tempHtmlPath, windowsBrowserFromWsl),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    }
  );

  if (result.status !== 0 || !fs.existsSync(guide.outputPath)) {
    throw new Error(
      [
        `Failed to generate ${path.basename(guide.outputPath)}.`,
        result.stderr?.trim(),
        result.stdout?.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  console.log(`Generated ${path.relative(repoRoot, guide.outputPath)}.`);
}

function main() {
  const guideArgumentIndex = process.argv.indexOf("--guide");
  const requestedGuideId = guideArgumentIndex >= 0 ? String(process.argv[guideArgumentIndex + 1] || "").trim() : "";
  const selectedGuides = requestedGuideId
    ? guides.filter((guide) => guide.id === requestedGuideId)
    : guides;
  if (requestedGuideId && selectedGuides.length === 0) {
    throw new Error(`Unknown guide '${requestedGuideId}'. Expected one of: ${guides.map((guide) => guide.id).join(", ")}.`);
  }

  const browserPath = getBrowserPath();
  if (!browserPath) {
    const missingOutputs = selectedGuides.filter((guide) => !fs.existsSync(guide.outputPath));
    if (missingOutputs.length === 0) {
      console.warn("No supported browser found for PDF generation. Keeping existing guide PDFs.");
      return;
    }
    // PDFs are optional build output; the app falls back to the Markdown guides when they are missing.
    console.warn("No supported browser found for PDF generation (set DGFP_PDF_BROWSER). The Markdown guides will be used instead.");
    return;
  }

  for (const guide of selectedGuides) {
    generatePdfGuide(browserPath, guide);
  }
}

main();
