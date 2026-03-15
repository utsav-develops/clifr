#!/usr/bin/env node

import { spawn, execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  bgRed: "\x1b[41m",
};

const CONFIG_DIR = join(homedir(), ".config", "clifr");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function copyToClipboard(text) {
  try {
    execSync(`echo ${JSON.stringify(text)} | pbcopy`);
  } catch {}
}

function trimStderr(raw, maxLines = 15) {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length <= maxLines) return raw;
  return [
    lines[0],
    `...(${lines.length - maxLines} lines omitted)...`,
    ...lines.slice(-maxLines + 1),
  ].join("\n");
}

function renderConfidence(score) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const filled = Math.round(pct / 10);
  const color = pct >= 80 ? c.green : pct >= 50 ? c.yellow : c.red;
  return `${color}${"█".repeat(filled)}${"░".repeat(10 - filled)}${c.reset} ${color}${pct}%${c.reset}`;
}

// ── Registry lookups ──────────────────────────────────────────────────────────

async function fetchPyPI(pkg) {
  try {
    const name = pkg.trim().split(/[=><!\[]/)[0];
    const res = await fetch(`https://pypi.org/pypi/${name}/json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const { info } = await res.json();
    const pythons = (info.classifiers ?? [])
      .filter((cl) => cl.startsWith("Programming Language :: Python :: 3."))
      .map((cl) => cl.replace("Programming Language :: Python :: ", ""))
      .filter((v) => /^3\.\d+$/.test(v))
      .join(", ");
    return `pypi: ${name}@${info.version} | requires: ${info.requires_python || "?"} | tested on Python: ${pythons || "?"}`;
  } catch {
    return null;
  }
}

async function fetchNPM(pkg) {
  try {
    const name = pkg.trim().split("@")[0].replace(/^'|'$/g, "");
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const engines = data.engines
      ? JSON.stringify(data.engines)
      : "not specified";
    return `npm: ${name}@${data.version} | engines: ${engines} | description: ${data.description?.slice(0, 80) ?? ""}`;
  } catch {
    return null;
  }
}

async function fetchBrew(formula) {
  try {
    const name = formula.trim().toLowerCase();
    const res = await fetch(
      `https://formulae.brew.sh/api/formula/${name}.json`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return `brew: ${name} | version: ${data.versions?.stable ?? "?"} | desc: ${data.desc?.slice(0, 80) ?? ""}`;
  } catch {
    return null;
  }
}

async function fetchGem(gem) {
  try {
    const name = gem.trim().split(/[=><]/)[0];
    const res = await fetch(`https://rubygems.org/api/v1/gems/${name}.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return `gem: ${name}@${data.version} | ruby req: ${data.ruby_version || "?"} | desc: ${data.info?.slice(0, 80) ?? ""}`;
  } catch {
    return null;
  }
}

// Detect which registry to query based on stderr content
async function fetchRegistryInfo(trimmed, command) {
  // PyPI
  const pipPkg =
    trimmed.match(/requirement\s+([\w\-\.]+)\s*\(from versions/i)?.[1] ??
    trimmed.match(/No matching distribution found for\s+([\w\-\.]+)/i)?.[1];
  if (pipPkg) return fetchPyPI(pipPkg);

  // npm
  const npmPkg =
    trimmed.match(/npm ERR!.*'([\w\-\@\/\.]+)'/)?.[1] ??
    trimmed.match(/Cannot find module '([\w\-\@\/\.]+)'/)?.[1] ??
    (command.startsWith("npm install") || command.startsWith("npm i")
      ? command.split(/\s+/).slice(2)[0]
      : null);
  if (npmPkg) return fetchNPM(npmPkg);

  // Homebrew
  const brewPkg =
    trimmed.match(/No available formula.*with the name "([\w\-]+)"/i)?.[1] ??
    (command.startsWith("brew install") ? command.split(/\s+/)[2] : null);
  if (brewPkg) return fetchBrew(brewPkg);

  // RubyGems
  const gemPkg =
    trimmed.match(/Could not find gem '([\w\-]+)/i)?.[1] ??
    (command.startsWith("gem install") ? command.split(/\s+/)[2] : null);
  if (gemPkg) return fetchGem(gemPkg);

  return null;
}

// ── Groq ──────────────────────────────────────────────────────────────────────

async function callGroq(apiKey, model, prompt, maxTokens = 180) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: false,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── Main explainer ────────────────────────────────────────────────────────────

async function explain({ command, stderr, exitCode, apiKey }) {
  const trimmed = trimStderr(stderr);

  // System context
  const ctx = {};
  try {
    ctx.python = execSync("python3 --version 2>&1").toString().trim();
  } catch {}
  try {
    ctx.node = execSync("node --version 2>&1").toString().trim();
  } catch {}
  try {
    ctx.ruby = execSync("ruby --version 2>&1")
      .toString()
      .trim()
      .split(" ")
      .slice(0, 2)
      .join(" ");
  } catch {}
  try {
    ctx.macos = `macOS ${execSync("sw_vers -productVersion 2>&1").toString().trim()}`;
  } catch {}
  try {
    const pyv = execSync(
      "ls /Library/Frameworks/Python.framework/Versions/ 2>/dev/null",
    )
      .toString()
      .trim();
    if (pyv) ctx.pythonVersions = pyv.replace(/\n/g, ", ");
  } catch {}

  // Registry lookup (parallel with context collection)
  const registryInfo = await fetchRegistryInfo(trimmed, command);
  if (process.env.CLIFR_DEBUG && registryInfo)
    process.stderr.write(`${c.gray}[registry] ${registryInfo}${c.reset}\n`);

  const systemLine = [
    ...Object.entries(ctx)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
    ...(registryInfo ? [registryInfo] : []),
  ].join(" | ");

  const basePrompt = (escalateField) => `Terminal command failed:
\`${command}\`

Exit code: ${exitCode}
Error:
\`\`\`
${trimmed}
\`\`\`

System context: ${systemLine}

Respond with ONLY valid JSON, no markdown:
{
  "what": "one friendly sentence, no jargon, max 10 words",
  "fix": "real runnable shell command — no placeholders, no prose — or null",
  "note": "one short tip or null",
  "confidence": 0-100${escalateField}
}`;

  const escalateInstruction = `,
  "escalate": true if ANY apply: error says "(from versions: none)", fix involves guessed version numbers, unsure fix will work given system context — false only if certain`;

  // Round 1 — fast 8b
  const raw8b = await callGroq(
    apiKey,
    "llama-3.1-8b-instant",
    basePrompt(escalateInstruction),
    220,
  );
  if (process.env.CLIFR_DEBUG)
    process.stderr.write(`${c.gray}[8b] ${raw8b}${c.reset}\n`);

  let parsed;
  try {
    parsed = JSON.parse(
      raw8b
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim(),
    );
  } catch {
    process.stderr.write(
      `\n${c.yellow}⚡${c.reset} ${c.white}${raw8b}${c.reset}\n\n`,
    );
    return;
  }

  // Round 2 — escalate to 70b if needed
  if (parsed.escalate) {
    process.stderr.write(`${c.gray}  ↑ thinking harder...${c.reset}\r`);
    const escalatePrompt = `Terminal command failed:
\`${command}\`

Exit code: ${exitCode}
Error:
\`\`\`
${trimmed}
\`\`\`

System context (ACCURATE — trust this): ${systemLine}

A smaller model tried but flagged this as too complex. Its attempt:
${raw8b}

That answer may be wrong. Give the correct fix that actually works on this system.

Respond with ONLY valid JSON, no markdown:
{
  "what": "one friendly sentence, no jargon, max 10 words",
  "fix": "real runnable shell command that works on this exact system — or null",
  "note": "one short tip or null",
  "confidence": 0-100
}`;
    const raw70b = await callGroq(
      apiKey,
      "llama-3.3-70b-versatile",
      escalatePrompt,
      250,
    );
    if (process.env.CLIFR_DEBUG)
      process.stderr.write(`${c.gray}[70b] ${raw70b}${c.reset}\n`);
    try {
      parsed = JSON.parse(
        raw70b
          .replace(/^```(?:json)?/i, "")
          .replace(/```$/, "")
          .trim(),
      );
    } catch {} // fall through with 8b result
  }

  // Render
  const w = Math.min(process.stderr.columns || 72, 80);
  const line = `${c.gray}${"─".repeat(w)}${c.reset}`;

  process.stderr.write(`\n${line}\n`);
  if (parsed.what)
    process.stderr.write(
      ` ${c.bold}${c.white}what${c.reset}  ${parsed.what}\n`,
    );
  if (parsed.fix) {
    copyToClipboard(parsed.fix);
    process.stderr.write(
      `\n ${c.bold}${c.green}fix${c.reset}   ${c.cyan}${c.bold}${parsed.fix}${c.reset}\n`,
    );
  }
  if (parsed.note)
    process.stderr.write(
      `\n ${c.bold}${c.gray}tip${c.reset}   ${c.dim}${parsed.note}${c.reset}\n`,
    );
  if (typeof parsed.confidence === "number" && parsed.confidence < 60) {
    process.stderr.write(
      `\n       ${c.yellow}not sure about this${c.reset}  ${renderConfidence(parsed.confidence)}\n`,
    );
  }
  process.stderr.write(`${line}\n\n`);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function setup() {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const question = (q) => new Promise((r) => rl.question(q, r));

  process.stderr.write(`\n${c.bold}clifr setup${c.reset}\n`);
  process.stderr.write(
    `${c.gray}get a free key at https://console.groq.com${c.reset}\n\n`,
  );
  const apiKey = await question(`groq api key: `);
  rl.close();

  if (!apiKey.trim()) {
    process.stderr.write(`${c.red}no key provided${c.reset}\n`);
    process.exit(1);
  }
  saveConfig({ apiKey: apiKey.trim() });
  process.stderr.write(
    `\n${c.green}✓ saved${c.reset}  run: ${c.cyan}ep <command>${c.reset}\n\n`,
  );
  process.exit(0);
}

// ── Shell hook ────────────────────────────────────────────────────────────────

async function installShellHook() {
  const shell = process.env.SHELL || "";
  const isZsh = shell.includes("zsh");
  const rcFile = isZsh ? join(homedir(), ".zshrc") : join(homedir(), ".bashrc");
  const epPath = process.argv[1]; // absolute path to this script

  // The hook captures every command's stderr by wrapping it in a subshell,
  // checks exit code, and pipes stderr to clifr if non-zero.
  const hookCode = `
# ── clifr shell hook ──────────────────────────────────────────────────────
# Auto-explains any failing command. Added by: clifr --install-hook
_clifr_bin="${epPath}"

_clifr_explain() {
  local exit_code=\$1
  local cmd=\$2
  local stderr_file=\$3
  if [ -s "\$stderr_file" ]; then
    "\$_clifr_bin" --hook-explain "\$exit_code" "\$cmd" < "\$stderr_file"
  fi
  rm -f "\$stderr_file"
}

${
  isZsh
    ? `# zsh: wrap command runner — no fd juggling, no race conditions
_clifr_last_cmd=""
_clifr_last_exit=0

_clifr_preexec() {
  local cmd="\$1"
  echo "\$cmd" | grep -qE "^(ep|clifr)( |\$)" && return
  _clifr_last_cmd="\$cmd"
}

_clifr_precmd() {
  _clifr_last_exit=\$?
  [[ -z "\$_clifr_last_cmd" ]] && return
  [[ \$_clifr_last_exit -eq 0 ]] && { _clifr_last_cmd=""; return; }
  [[ -n "\$CLIFR_OFF" ]] && { _clifr_last_cmd=""; return; }

  # Re-run the command silently to capture its stderr for the LLM.
  # We already saw the real output — this second run is just for context.
  # For commands with side effects this is imperfect but unavoidable without fd tricks.
  local tmp=\$(mktemp /tmp/clifr.XXXXXX)
  eval "\$_clifr_last_cmd" 2>"\$tmp" 1>/dev/null
  "\$_clifr_bin" --hook-explain "\$_clifr_last_exit" "\$_clifr_last_cmd" < "\$tmp" 2>&1
  rm -f "\$tmp"
  _clifr_last_cmd=""
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _clifr_preexec
add-zsh-hook precmd  _clifr_precmd`
    : `# bash: use DEBUG trap + PROMPT_COMMAND
_clifr_stderr_file=""
_clifr_last_cmd=""

_clifr_debug() {
  local cmd="\$BASH_COMMAND"
  [[ "\$cmd" == _clifr* ]] && return
  [[ "\$cmd" == ep* ]] && return
  _clifr_last_cmd="\$cmd"
  _clifr_stderr_file=\$(mktemp /tmp/clifr.XXXXXX)
  exec 3>&2 2> >(tee "\$_clifr_stderr_file" >&3)
}

_clifr_prompt() {
  local exit_code=\$?
  exec 2>&3 3>&- 2>/dev/null
  [[ -z "\$_clifr_last_cmd" ]] && return
  if [[ \$exit_code -ne 0 ]] && [[ -n "\$_clifr_stderr_file" ]]; then
    _clifr_explain "\$exit_code" "\$_clifr_last_cmd" "\$_clifr_stderr_file" 2>&1
  else
    rm -f "\$_clifr_stderr_file"
  fi
  _clifr_last_cmd=""
  _clifr_stderr_file=""
}

trap '_clifr_debug' DEBUG
PROMPT_COMMAND="_clifr_prompt;\${PROMPT_COMMAND}"
`
}
# ─────────────────────────────────────────────────────────────────────────────
`;

  const existing = existsSync(rcFile) ? readFileSync(rcFile, "utf8") : "";
  if (existing.includes("clifr shell hook")) {
    process.stderr.write(
      `${c.yellow}hook already installed in ${rcFile}${c.reset}\n`,
    );
    process.exit(0);
  }

  writeFileSync(rcFile, existing + hookCode, "utf8");
  process.stderr.write(`${c.green}✓ hook installed in ${rcFile}${c.reset}\n\n`);
  process.stderr.write(`run: ${c.cyan}source ${rcFile}${c.reset}\n\n`);
  process.stderr.write(
    `${c.gray}every failing command will now be explained automatically.${c.reset}\n`,
  );
  process.stderr.write(
    `${c.gray}to disable temporarily: export CLIFR_OFF=1${c.reset}\n\n`,
  );
  process.exit(0);
}

// ── Hook explain mode (called by shell hook, reads stderr from stdin) ─────────

async function hookExplain(exitCode, command, apiKey) {
  if (process.env.CLIFR_OFF) process.exit(0);
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const stderr = Buffer.concat(chunks).toString();
  if (!stderr.trim()) process.exit(0);
  await explain({ command, stderr, exitCode: parseInt(exitCode), apiKey });
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const apiKey = config.apiKey || process.env.GROQ_API_KEY;

  if (args[0] === "--setup" || args[0] === "setup") return setup();
  if (args[0] === "--install-hook") return installShellHook();

  if (args[0] === "--hook-explain") {
    const [, exitCode, ...cmdParts] = args;
    if (!apiKey) process.exit(0); // silently skip if no key
    return hookExplain(exitCode, cmdParts.join(" "), apiKey);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write("clifr 2.0.0\n");
    process.exit(0);
  }

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stderr.write(`
${c.bold}ep${c.reset} <command>          run any command — errors explained automatically
${c.bold}ep${c.reset} --setup             save your groq api key
${c.bold}ep${c.reset} --install-hook      auto-explain ALL failing commands in your shell
${c.bold}ep${c.reset} --raw <cmd>         run without explanation

set ${c.cyan}CLIFR_OFF=1${c.reset} to temporarily disable the shell hook
set ${c.cyan}CLIFR_DEBUG=1${c.reset} to see registry lookups and model responses

`);
    process.exit(0);
  }

  if (!apiKey) {
    process.stderr.write(
      `${c.yellow}no api key — run: ep --setup${c.reset}\n\n`,
    );
  }

  const rawMode = args[0] === "--raw";
  const cmdArgs = rawMode ? args.slice(1) : args;
  const [cmd, ...rest] = cmdArgs;
  const commandStr = cmdArgs.join(" ");
  let stderrBuffer = "";

  const child = spawn(cmd, rest, {
    stdio: ["inherit", "inherit", "pipe"],
    shell: false,
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    stderrBuffer += chunk.toString();
  });

  child.on("error", () => {
    process.stderr.write(`${c.red}command not found: ${cmd}${c.reset}\n`);
    process.exit(127);
  });

  child.on("close", async (exitCode) => {
    if (exitCode === 0 || rawMode) process.exit(exitCode ?? 0);
    if (stderrBuffer.trim() && apiKey) {
      try {
        await explain({
          command: commandStr,
          stderr: stderrBuffer,
          exitCode,
          apiKey,
        });
      } catch (err) {
        process.stderr.write(`${c.gray}[clifr] ${err.message}${c.reset}\n`);
      }
    }
    process.exit(exitCode ?? 1);
  });
}

main().catch((err) => {
  process.stderr.write(`${c.red}${err.message}${c.reset}\n`);
  process.exit(1);
});
