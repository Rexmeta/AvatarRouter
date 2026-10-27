import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(workspaceRoot, "generated-artifacts/roleplayx");
const spec = await readFile(resolve(workspaceRoot, "lib/api-spec/openapi.yaml"), "utf8");
const guide = await readFile(resolve(workspaceRoot, "docs/roleplayx-integration-guide.md"), "utf8");
const tempDir = await mkdtemp(resolve(tmpdir(), "roleplayx-docs-"));

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(markdown) {
  const blocks = [];
  let paragraph = [];
  let list = [];
  let code = [];
  let inCode = false;

  const closeParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list.length) blocks.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      closeParagraph();
      closeList();
      if (inCode) {
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(4, heading[1].length);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      list.push(bullet[1]);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  closeParagraph();
  closeList();
  if (inCode) blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return blocks.join("\n");
}

function printPage({ title, subtitle, body, output }) {
  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page{size:A4;margin:17mm 16mm 18mm}
*{box-sizing:border-box}body{font:10.5pt/1.52 Arial,"Noto Sans",sans-serif;color:#172033}
h1{font-size:24pt;line-height:1.12;margin:0 0 7mm;color:#123a57}
h2{font-size:15pt;margin:8mm 0 3mm;color:#145d74;break-after:avoid}
h3{font-size:12pt;margin:6mm 0 2mm;color:#145d74;break-after:avoid}
h4{font-size:10.5pt;margin:5mm 0 2mm;break-after:avoid}
p{margin:2mm 0 3.3mm}ul{padding-left:6mm;margin:2mm 0 4mm}li{margin:1.2mm 0}
code{font:9pt "DejaVu Sans Mono",monospace;color:#174758;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:7.1pt/1.38 "DejaVu Sans Mono",monospace;background:#f1f4f7;border:1px solid #dce3ea;border-radius:2mm;padding:3mm;margin:2mm 0 5mm;break-inside:auto}
pre code{font:inherit;color:#172033}
a{color:#087a99}strong{color:#132844}
.subtitle{font-size:11pt;color:#526278;margin-bottom:8mm}
.notice{border-left:3px solid #14839b;background:#f1f7f8;padding:3mm 4mm;margin:4mm 0}
</style>
<body><h1>${escapeHtml(title)}</h1><div class="subtitle">${escapeHtml(subtitle)}</div>${body}</body></html>`;
  return writeFile(output, html, "utf8");
}

const guideHtml = await resolve(tempDir, "integration-guide.html");
const specHtml = await resolve(tempDir, "api-reference.html");
await Promise.all([
  printPage({
    title: "RoleplayX × AvatarRouter",
    subtitle: "Integration guide · stock Tavus avatar · current API and identity requirements",
    body: renderMarkdown(guide),
    output: guideHtml,
  }),
  printPage({
    title: "AvatarRouter Live Avatar API",
    subtitle: "OpenAPI 3.1 · machine-readable contract reproduced below",
    body: `<p class="notice">This reference is the complete YAML contract, including the authenticated stock live-session routes and the general asset APIs. Live creation returns a queued session, not a ready video stream.</p><pre><code>${escapeHtml(spec)}</code></pre>`,
    output: specHtml,
  }),
]);

await mkdir(outputDir, { recursive: true });
const browser = process.env.CHROMIUM_BIN ?? "chromium";
const outputs = [
  ["roleplayx-integration-guide.pdf", guideHtml],
  ["avatarrouter-openapi-reference.pdf", specHtml],
];

try {
  for (const [fileName, html] of outputs) {
    const output = resolve(outputDir, fileName);
    await execFileAsync(browser, [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-pdf-header-footer",
      `--print-to-pdf=${output}`,
      pathToFileURL(html).href,
    ], { maxBuffer: 1024 * 1024 });
    const details = await stat(output);
    if (details.size < 1000) throw new Error(`PDF output looks incomplete: ${fileName}`);
    console.log(`${fileName}: ${details.size} bytes (${output})`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
