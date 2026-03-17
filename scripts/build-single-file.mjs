import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

function argHas(flag) {
  return process.argv.includes(flag);
}

function readUtf8(path) {
  return readFileSync(path, "utf8");
}

function extractBodyInner(html) {
  const bodyOpen = html.match(/<body[^>]*>/i);
  const bodyClose = html.match(/<\/body>/i);
  if (!bodyOpen || !bodyClose) return null;

  const start = (bodyOpen.index ?? 0) + bodyOpen[0].length;
  const end = bodyClose.index ?? html.length;
  return html.slice(start, end).trim();
}

function normalizeNewlines(s) {
  return s.replace(/\r\n/g, "\n");
}

function sha256Base64(s) {
  return createHash("sha256").update(s).digest("base64");
}

function safeInlineScriptText(s) {
  // Prevent closing the <script> tag early (HTML parser rule).
  // This matters even for type="text/plain".
  return String(s).replace(/<\/script/gi, "<\\/script");
}

const useGzip = !argHas("--no-gzip");

mkdirSync("dist", { recursive: true });

const srcHtml = readUtf8("index.html");
const srcCss = readUtf8("main.css");
const urlsText = normalizeNewlines(readUtf8("urls_to_show"));

const bodyInner = extractBodyInner(srcHtml);
if (!bodyInner) {
  throw new Error("Could not extract <body>…</body> from index.html");
}

let urlsPayload;
let urlsMeta;
if (useGzip) {
  const gz = gzipSync(Buffer.from(urlsText, "utf8"), { level: 9 });
  urlsPayload = gz.toString("base64");
  urlsMeta = { encoding: "base64", compression: "gzip" };
} else {
  urlsPayload = urlsText;
  urlsMeta = { encoding: "utf8", compression: "none" };
}

const urlsHash = sha256Base64(urlsText);

const workerCode = String.raw`
let URLS = null;
let lastRequestId = 0;

function decodeBase64ToUint8Array(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzipBytes(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream not supported (rebuild with --no-gzip).");
  }
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(ab);
}

function splitLines(text) {
  // Keep it simple; worker thread can afford this.
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function fuzzyScore(hay, needle) {
  // Fast subsequence scorer: lower is better; Infinity means no match.
  // Example: "google.com" vs "gcm" matches with small gaps.
  let h = hay.toLowerCase();
  let n = needle.toLowerCase();
  let hi = 0;
  let score = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni];
    const found = h.indexOf(ch, hi);
    if (found === -1) return Infinity;
    score += (found - hi);
    hi = found + 1;
  }
  // Prefer earlier matches slightly.
  return score + (hi * 0.01);
}

function matches(url, q, mode) {
  if (!q) return true;
  if (mode === "substr") return url.toLowerCase().includes(q.toLowerCase());
  return fuzzyScore(url, q) !== Infinity;
}

function slicePage(arr, page, perPage) {
  const p = Math.max(1, page | 0);
  const n = Math.max(1, perPage | 0);
  const start = (p - 1) * n;
  const end = start + n;
  return arr.slice(start, end);
}

async function handleInit(msg) {
  const { payload, meta, hash } = msg;
  let text;
  if (meta.compression === "gzip") {
    text = await gunzipBytes(decodeBase64ToUint8Array(payload));
  } else {
    text = payload;
  }
  text = text.replace(/\r\n/g, "\n");
  URLS = splitLines(text);
  postMessage({ type: "ready", total: URLS.length, hash });
}

function handleQuery(msg) {
  const { requestId, q, page, perPage, mode } = msg;
  if (!URLS) {
    postMessage({ type: "error", requestId, message: "URLs not loaded yet." });
    return;
  }

  // Cancel older requests by checking requestId.
  lastRequestId = Math.max(lastRequestId, requestId);
  const myId = requestId;

  const query = (q ?? "").trim();
  const m = mode === "substr" ? "substr" : "fuzzy";

  // Empty query is instant: no scan needed.
  if (!query) {
    const totalMatches = URLS.length;
    const pageItems = slicePage(URLS, page, perPage);
    postMessage({ type: "result", requestId: myId, totalMatches, pageItems });
    return;
  }

  // Scan in worker; keep UI responsive. Send occasional progress updates.
  const matchesIdx = [];
  const total = URLS.length;
  const progressEvery = 25000;

  for (let i = 0; i < total; i++) {
    if (lastRequestId !== myId) return; // cancelled
    const url = URLS[i];
    if (matches(url, query, m)) matchesIdx.push(i);
    if (i > 0 && i % progressEvery === 0) {
      postMessage({ type: "progress", requestId: myId, scanned: i, total });
    }
  }

  const totalMatches = matchesIdx.length;
  const p = Math.max(1, page | 0);
  const n = Math.max(1, perPage | 0);
  const start = (p - 1) * n;
  const end = start + n;
  const pageItems = matchesIdx.slice(start, end).map((i) => URLS[i]);
  postMessage({ type: "result", requestId: myId, totalMatches, pageItems });
}

self.onmessage = async (ev) => {
  try {
    const msg = ev.data || {};
    if (msg.type === "init") return await handleInit(msg);
    if (msg.type === "query") return handleQuery(msg);
  } catch (e) {
    postMessage({ type: "error", requestId: ev?.data?.requestId, message: String(e?.message || e) });
  }
};
`;

const appCode = String.raw`
(() => {
  const els = {
    list: document.getElementById("nameList"),
    input: document.getElementById("myInput"),
    prev: document.getElementById("prev"),
    next: document.getElementById("next"),
    random: document.getElementById("random"),
    perPage: document.getElementById("names_per_page"),
    pageInfo: document.getElementById("pageInfo"),
  };

  const metaEl = document.getElementById("urls_meta");
  const payloadEl = document.getElementById("urls_payload");
  const meta = JSON.parse(metaEl.textContent);
  const payload = payloadEl.textContent;
  const hash = meta.hash;

  const worker = new Worker(URL.createObjectURL(new Blob([document.getElementById("worker_js").textContent], { type: "text/javascript" })));

  let totalAll = 0;
  let totalMatches = 0;
  let currentPage = 1;
  let namesPerPage = Number(els.perPage?.value || 25);
  let requestSeq = 0;
  let pendingTimer = null;
  let currentQuery = "";
  let workerReady = false;
  let lastMode = "fuzzy";

  function render(items) {
    els.list.innerHTML = "";
    for (const name of items) {
      const li = document.createElement("li");
      li.textContent = name;
      els.list.appendChild(li);
    }
  }

  function setPageInfo(extra = "") {
    const total = totalMatches || 0;
    const pages = Math.max(1, Math.ceil(total / namesPerPage));
    if (!workerReady) {
      els.pageInfo.textContent = "Loading…";
      return;
    }
    els.pageInfo.textContent =
      "Page " +
      String(currentPage) +
      " of " +
      String(pages) +
      " (" +
      total.toLocaleString() +
      " matches)" +
      String(extra || "");
  }

  function clampPage() {
    const pages = Math.max(1, Math.ceil((totalMatches || 1) / namesPerPage));
    currentPage = Math.max(1, Math.min(currentPage, pages));
  }

  function randomPage() {
    const pages = Math.max(1, Math.ceil((totalMatches || totalAll || 1) / namesPerPage));
    return Math.floor(Math.random() * pages) + 1;
  }

  function queryWorker({ q, page }) {
    if (!workerReady) return;
    const requestId = ++requestSeq;
    worker.postMessage({
      type: "query",
      requestId,
      q,
      page,
      perPage: namesPerPage,
      mode: lastMode,
    });
    setPageInfo(" (searching…)"); // stays responsive while worker scans
  }

  function scheduleQuery() {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      currentQuery = (els.input?.value ?? "").trim();
      currentPage = 1;
      queryWorker({ q: currentQuery, page: currentPage });
    }, 150);
  }

  function changePage(offset) {
    currentPage += offset;
    clampPage();
    queryWorker({ q: currentQuery, page: currentPage });
  }

  worker.onmessage = (ev) => {
    const msg = ev.data || {};
    if (msg.type === "ready") {
      workerReady = true;
      totalAll = msg.total || 0;
      totalMatches = totalAll;
      setPageInfo("");
      currentPage = randomPage();
      queryWorker({ q: "", page: currentPage });
      return;
    }
    if (msg.type === "progress") {
      // Keep it subtle; avoid spamming layout.
      if ((msg.scanned ?? 0) % 100000 === 0) setPageInfo(" (searching…)");
      return;
    }
    if (msg.type === "result") {
      totalMatches = msg.totalMatches ?? 0;
      clampPage();
      render(msg.pageItems || []);
      setPageInfo("");
      return;
    }
    if (msg.type === "error") {
      els.pageInfo.textContent = "Error: " + String(msg.message);
      return;
    }
  };

  // Wire up controls
  els.input?.addEventListener("input", scheduleQuery);
  els.prev?.addEventListener("click", () => changePage(-1));
  els.next?.addEventListener("click", () => changePage(1));
  els.random?.addEventListener("click", () => {
    currentPage = randomPage();
    queryWorker({ q: currentQuery, page: currentPage });
  });
  els.perPage?.addEventListener("change", () => {
    namesPerPage = Number(els.perPage.value);
    currentPage = 1;
    queryWorker({ q: currentQuery, page: currentPage });
  });

  // Kick off load
  setPageInfo("");
  worker.postMessage({ type: "init", payload, meta, hash });
})();
`;

const outHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>not jealous</title>
  <style>
${srcCss}
  </style>
</head>
<body>
${bodyInner}

<!-- Embedded URL payload (single-file build). -->
<script id="urls_meta" type="application/json">${JSON.stringify({
  ...urlsMeta,
  hash: urlsHash,
})}</script>
<script id="urls_payload" type="text/plain">${safeInlineScriptText(urlsPayload)}</script>

<!-- Worker + app code (single-file build). -->
<script id="worker_js" type="text/plain">${safeInlineScriptText(workerCode)}</script>
<script>${safeInlineScriptText(appCode)}</script>
</body>
</html>
`;

writeFileSync("dist/index.html", outHtml);
console.log(`Wrote dist/index.html (${useGzip ? "gzip+base64" : "plain text"}; urls sha256=${urlsHash})`);

