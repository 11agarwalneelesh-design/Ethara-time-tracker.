#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

const STATE_PATH = path.join(os.tmpdir(), "cursor-guardrail-state.json");
const STATE_TTL_MS = 4 * 60 * 60 * 1000;
const FILE_SNIPPET_MAX_BYTES = 32768;
const IMPLICIT_FILE_CONTEXT = true;
const BRIDGE_TIMEOUT_MS = 5000;

function resolveWorkspaceRoot(input) {
  const roots = [];
  if (process.env.CURSOR_WORKSPACE_ROOT) roots.push(process.env.CURSOR_WORKSPACE_ROOT);
  if (Array.isArray(input?.workspace_roots)) roots.push(...input.workspace_roots);
  // When this hook lives at <workspace>/script/guardrail-hook.js, this is the most reliable root.
  roots.push(path.resolve(__dirname, ".."));
  roots.push(process.cwd());

  for (const root of roots) {
    if (typeof root !== "string" || !root) continue;
    const normalized = normalizeWorkspaceRoot(root);
    const candidate = path.join(normalized, ".cursor", "sentraguard.json");
    try {
      if (fs.existsSync(candidate)) return normalized;
    } catch (_) {
      // ignore
    }
  }

  for (const root of roots) {
    if (typeof root === "string" && root) return normalizeWorkspaceRoot(root);
  }
  return process.cwd();
}

function readBridgeInfo(workspaceRoot) {
  const filePath = path.join(workspaceRoot, ".cursor", "sentraguard.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    port: Number(parsed?.port || 0),
    failOpen: parsed?.failOpen === true
  };
}

function respond(payload) {
  process.stdout.write(JSON.stringify(payload || {}));
}

function bridgeFail(failOpen) {
  return {
    continue: failOpen,
    user_message: failOpen
      ? "Guardrail bridge unavailable; proceeding (fail-open)."
      : "Guardrail bridge unavailable; prompt blocked."
  };
}

function postJson(port, endpoint, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: endpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!text.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// --- state layer ---
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const now = Date.now();
    for (const [key, value] of Object.entries(state || {})) {
      const last = value?.lastGuardedAt || value?.blockedAt || 0;
      if (!last || now - last > STATE_TTL_MS) {
        delete state[key];
      }
    }
    return state;
  } catch (_) {
    return {};
  }
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (_) {
    /* best-effort */
  }
}

// --- prompt enforcement (blocked references) ---
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim().replace(/\\/g, "/");
  if (!s) return "";
  s = s.replace(/\/+/g, "/");
  let prefix = "";
  if (/^[A-Za-z]:/.test(s)) {
    prefix = s.slice(0, 2).toLowerCase();
    s = s.slice(2);
  }
  const absolute = s.startsWith("/");
  if (absolute) s = s.replace(/^\/+/, "");
  const parts = s.split("/").filter(p => p && p !== ".");
  const stack = [];
  for (const p of parts) {
    if (p === "..") {
      if (stack.length) stack.pop();
      continue;
    }
    stack.push(p);
  }
  let out = stack.join("/");
  if (absolute) out = `/${out}`;
  if (prefix) out = `${prefix}${out}`;
  return out.toLowerCase();
}

/** Normalize a root path so path.resolve and fs work on Windows when Cursor sends /c:/Users/... */
function normalizeWorkspaceRoot(root) {
  if (typeof root !== "string" || !root.trim()) return root;
  const s = root.trim().replace(/\\/g, "/");
  const m = s.match(/^\/+([A-Za-z]):\/?(.*)$/);
  if (m) return path.join(m[1] + ":", m[2] || "");
  return path.normalize(root);
}

function getWorkspaceRoots(workspaceRoots) {
  const roots = [];
  if (Array.isArray(workspaceRoots)) roots.push(...workspaceRoots);
  if (process.cwd()) roots.push(process.cwd());
  if (process.env.CURSOR_WORKSPACE_ROOT) roots.push(process.env.CURSOR_WORKSPACE_ROOT);
  return Array.from(new Set(roots.filter(Boolean))).map(normalizeWorkspaceRoot);
}

function buildMatchTokens(raw, roots) {
  const tokens = new Set();
  const normalized = normalizePath(raw);
  if (!normalized) return tokens;
  tokens.add(normalized);
  const basename = normalized.split("/").pop();
  if (basename) tokens.add(basename);

  const rootList = getWorkspaceRoots(roots);
  for (const root of rootList) {
    const rootNorm = normalizePath(root);
    if (!rootNorm) continue;
    if (normalized === rootNorm) continue;
    if (normalized.startsWith(`${rootNorm}/`)) {
      const rel = normalized.slice(rootNorm.length + 1);
      if (rel) tokens.add(rel);
      const relBase = rel.split("/").pop();
      if (relBase) tokens.add(relBase);
    }
  }
  return tokens;
}

function containsBlockedReference(text, blockedTokens) {
  if (!text || !blockedTokens?.size) return false;
  for (const token of blockedTokens) {
    if (!token || (!token.includes("/") && !token.includes("."))) continue;
    const pattern = token.includes("/")
      ? escapeRegex(token)
      : `\\b${escapeRegex(token)}\\b`;
    const re = new RegExp(pattern, "i");
    if (re.test(text)) return true;
  }
  return false;
}

// --- history-guard prompt rewriting ---
function buildHistoryGuardPrompt(originalPrompt) {
  return `System: A prior request in this conversation was blocked. Do not reference or answer any previously blocked content or its topic. You may use other prior context. Answer only the following user prompt:\n${originalPrompt}`;
}

// --- file detection (implicit paths + @mentions) ---
const KNOWN_TEXT_EXTENSIONS = new Set([
  "json", "md", "txt", "py", "js", "ts", "tsx", "jsx", "html", "htm", "css", "scss",
  "yml", "yaml", "xml", "csv", "log", "sh", "bat", "ps1", "sql", "graphql", "vue", "svelte"
]);

function isKnownTextExtension(ref) {
  if (!ref || typeof ref !== "string") return false;
  const base = ref.split("/").pop().split("\\").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return false;
  return KNOWN_TEXT_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/** Decode buffer to string; handles UTF-8 and UTF-16 (BOM) so JSON/MD saved as UTF-16 on Windows are included. */
function decodeBufferToText(buf) {
  if (!buf || !buf.length) return "";
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.toString("utf16be");
  return buf.toString("utf8");
}

function looksTextual(buf) {
  if (!buf || !buf.length) return false;
  let control = 0;
  for (const b of buf) {
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) control++;
  }
  return control / buf.length < 0.15;
}

function extractMentions(prompt) {
  const mentions = [];
  const regex = /@([A-Za-z0-9_./\\-]+(?:\\.[A-Za-z0-9_]+)?)/g;
  let m;
  while ((m = regex.exec(prompt || "")) !== null) {
    mentions.push(m[1]);
  }
  return mentions;
}

function extractPathCandidatesFromString(str) {
  if (!str || typeof str !== "string") return [];
  const cleaned = str.replace(/['"`]/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const candidates = [];
  for (let p of parts) {
    if (p.includes("=")) {
      p = p.split("=").pop();
    }
    p = p.replace(/^--?/, "");
    p = p.replace(/^[<(\[]+/, "").replace(/[>\]),.;:?!]+$/g, "");
    if (/[\\/]/.test(p) || /\.[A-Za-z0-9_]{1,6}$/.test(p)) {
      candidates.push(p);
    }
  }
  return candidates;
}

function extractFileContexts(prompt, workspaceRoots) {
  const uniqRoots = getWorkspaceRoots(workspaceRoots);
  const refs = new Set();
  const results = [];
  const regex = /@([A-Za-z0-9_./\\-]+(?:\\.[A-Za-z0-9_]+)?)/g;
  let match;
  while ((match = regex.exec(prompt || "")) !== null) {
    refs.add(match[1]);
  }
  if (IMPLICIT_FILE_CONTEXT) {
    const candidates = extractPathCandidatesFromString(prompt || "");
    for (const c of candidates) refs.add(c);
  }
  for (const ref of refs) {
    const candidates = [];
    if (path.isAbsolute(ref)) {
      candidates.push(path.normalize(ref));
    } else {
      for (const root of uniqRoots) {
        candidates.push(path.resolve(root, ref.replace(/\//g, path.sep)));
      }
    }
    const knownText = isKnownTextExtension(ref);
    for (const abs of candidates) {
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) continue;
        const size = stat.size;
        const full = fs.readFileSync(abs);
        const slice =
          full.length > FILE_SNIPPET_MAX_BYTES
            ? full.subarray(0, FILE_SNIPPET_MAX_BYTES)
            : full;
        if (!knownText && !looksTextual(slice)) continue;
        const text = decodeBufferToText(slice);
        results.push({
          path: ref,
          size,
          snippet: text
        });
        break;
      } catch (_) {
        continue;
      }
    }
  }
  return results;
}

function collectStrings(value, out = [], depth = 0) {
  if (depth > 4) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  }
  return out;
}

function extractPrompt(input) {
  if (!input || typeof input !== "object") return "";
  const candidates = [
    input.prompt,
    input.input,
    input.text,
    input.message,
    input.content,
    input.user_message
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

async function handleBeforeSubmit(input, bridgeInfo) {
  const state = loadState();
  const convId = input.conversation_id || input.session_id || input.generation_id || "global";
  const prompt = extractPrompt(input);
  const roots = getWorkspaceRoots(input.workspace_roots);
  const blockedTokens = new Set(state[convId]?.blockedMentions || []);

  const mentions = extractMentions(prompt);
  const promptCandidates = extractPathCandidatesFromString(prompt || "");
  const promptTokens = promptCandidates.flatMap(c => Array.from(buildMatchTokens(c, roots)));
  const mentionTokens = mentions.flatMap(m => Array.from(buildMatchTokens(m, roots)));
  const allPromptTokens = Array.from(new Set([...promptTokens, ...mentionTokens]));

  const blockedInMentions = mentionTokens.some(t => blockedTokens.has(t));
  const blockedInPrompt = containsBlockedReference(prompt, blockedTokens);
  if (blockedInMentions || blockedInPrompt) {
    const existing = Array.from(blockedTokens);
    const merged = Array.from(new Set([...existing, ...allPromptTokens]));
    state[convId] = {
      blockedAt: Date.now(),
      blockedMentions: merged,
      needsGuard: true
    };
    saveState(state);
    return respond({
      continue: false,
      user_message: "That file is blocked by policy. Remove it to continue."
    });
  }

  const needsGuard = state[convId]?.needsGuard === true;
  const promptForBackend = needsGuard
    ? buildHistoryGuardPrompt(prompt)
    : prompt;

  let fileContexts = extractFileContexts(promptForBackend, input.workspace_roots);
  if (blockedTokens.size) {
    fileContexts = fileContexts.filter(fc => {
      const tokens = buildMatchTokens(fc.path, roots);
      for (const t of tokens) {
        if (blockedTokens.has(t)) return false;
      }
      return true;
    });
  }

  // --- backend boundary (bridge only) ---
  let response;
  try {
    response = await postJson(
      bridgeInfo.port,
      "/validate",
      { ...input, prompt: promptForBackend, fileContexts },
      BRIDGE_TIMEOUT_MS
    );
  } catch (_) {
    return respond(bridgeFail(bridgeInfo.failOpen));
  }

  const result = response && typeof response === "object" ? response : {};

  if (!result.continue) {
    const existing = Array.from(blockedTokens);
    const merged = Array.from(new Set([...existing, ...allPromptTokens]));
    state[convId] = {
      blockedAt: Date.now(),
      blockedMentions: merged,
      needsGuard: true
    };
    saveState(state);
  } else if (needsGuard) {
    state[convId] = {
      ...state[convId],
      needsGuard: false,
      lastGuardedAt: Date.now()
    };
    saveState(state);
    result.prompt = promptForBackend;
  }

  return respond(result);
}

// --- tool enforcement (preToolUse) ---
function handlePreToolUse(input) {
  const state = loadState();
  const convId = input.conversation_id || input.session_id || input.generation_id || "global";
  const blockedTokens = new Set(state[convId]?.blockedMentions || []);
  if (!blockedTokens.size) return respond({ permission: "allow" });

  const roots = getWorkspaceRoots(input.workspace_roots);
  const strings = collectStrings(input);
  for (const str of strings) {
    const candidates = extractPathCandidatesFromString(str);
    for (const cand of candidates) {
      const tokens = buildMatchTokens(cand, roots);
      for (const t of tokens) {
        if (blockedTokens.has(t)) {
          return respond({
            permission: "deny",
            user_message: "Tool access to that file is blocked by policy."
          });
        }
      }
    }
  }

  return respond({ permission: "allow" });
}

function parseStdinJson(raw) {
  if (!raw || typeof raw !== "string") return {};
  let s = raw.trim();
  // Strip UTF-8 BOM if present (can happen when stdin is piped with certain encodings)
  if (s.length && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch (e1) {
    // Fallback 1: fix unescaped backslashes in Windows paths (\U, \s, etc. are invalid in JSON)
    try {
      const fixed = s.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
      return JSON.parse(fixed);
    } catch (_) {
      // fall through
    }
    // Fallback 2: extract a single JSON object (first { to last }) in case of wrapper/newlines
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch (_) {
        // fall through to fail
      }
    }
    if (process.env.SENTRAGUARD_HOOK_DEBUG) {
      const msg = [
        "Hook stdin parse failed: " + (e1 && e1.message),
        "Raw length: " + raw.length,
        "First 300 chars: " + JSON.stringify(raw.slice(0, 300))
      ].join("\n");
      process.stderr.write(msg + "\n");
    }
    throw e1;
  }
}

function main() {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", async () => {
    let input = {};
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      input = parseStdinJson(raw);
    } catch (_) {
      respond({ continue: false, user_message: "Invalid hook input." });
      return;
    }

    const workspaceRoot = resolveWorkspaceRoot(input);
    let bridgeInfo = { port: 0, failOpen: false };
    try {
      bridgeInfo = readBridgeInfo(workspaceRoot);
    } catch (_) {
      respond(bridgeFail(false));
      return;
    }

    const event = input.hook_event_name;
    if (event === "beforeSubmitPrompt") return handleBeforeSubmit(input, bridgeInfo);
    if (event === "preToolUse") return handlePreToolUse(input);

    return respond({});
  });
}

main();
