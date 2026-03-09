#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedAliasesPath = path.resolve(__dirname, "../aliases.generated.json");

function usage() {
  return `Usage:
  sync-aliases --company-id <id> [options]

Required:
  --company-id <id>     Company whose agent roster should drive generated aliases

Optional:
  --context <path>
  --profile <name>
  --api-base <url>
  --api-key <token>

Environment:
  PAPERCLIP_REPO_DIR    Paperclip repo checkout used to run pnpm paperclipai
`;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

function normalizeAlias(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function slugify(value) {
  const normalized = normalizeAlias(value);
  if (!normalized) return null;
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

async function assertRepoDir(repoDir) {
  const packageJsonPath = path.join(repoDir, "package.json");
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  const script = parsed?.scripts?.paperclipai;
  if (typeof script !== "string" || script.length === 0) {
    throw new Error(`package.json in ${repoDir} does not expose a paperclipai script`);
  }
}

async function findRepoDir() {
  const envDir = process.env.PAPERCLIP_REPO_DIR?.trim();
  if (envDir) {
    const resolved = path.resolve(envDir);
    await assertRepoDir(resolved);
    return resolved;
  }

  let current = process.cwd();
  while (true) {
    try {
      await assertRepoDir(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  throw new Error(
    "Could not locate a Paperclip repo checkout. Run from the repo root or set PAPERCLIP_REPO_DIR.",
  );
}

function buildCommonArgs(options) {
  const args = [];
  if (options.context) args.push("--context", options.context);
  if (options.profile) args.push("--profile", options.profile);
  if (options.apiBase) args.push("--api-base", options.apiBase);
  if (options.apiKey) args.push("--api-key", options.apiKey);
  return args;
}

function spawnCommand(repoDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: repoDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runJson(repoDir, args, label) {
  const result = await spawnCommand(repoDir, args);
  if (result.code !== 0) {
    const detail = stripAnsi(result.stderr || result.stdout).trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const detail = stripAnsi(result.stdout).trim();
    throw new Error(
      `${label} returned invalid JSON${detail ? `: ${detail}` : ""}${error instanceof Error ? ` (${error.message})` : ""}`,
    );
  }
}

function addCandidate(collector, alias, canonicalRef) {
  if (!alias || !canonicalRef) return;
  if (!collector.has(alias)) collector.set(alias, new Set());
  collector.get(alias).add(canonicalRef);
}

function generateAliases(agents) {
  const activeAgents = agents.filter((agent) => agent && agent.status !== "terminated");
  const candidates = new Map();

  for (const agent of activeAgents) {
    const canonicalRef =
      typeof agent.urlKey === "string" && agent.urlKey.trim().length > 0
        ? agent.urlKey.trim()
        : typeof agent.name === "string" && agent.name.trim().length > 0
        ? agent.name.trim()
        : null;

    if (!canonicalRef) continue;

    const aliasInputs = [
      agent.name,
      slugify(agent.name),
      agent.urlKey,
      slugify(agent.urlKey),
      agent.title,
      slugify(agent.title),
    ];

    for (const aliasInput of aliasInputs) {
      const alias = normalizeAlias(aliasInput);
      addCandidate(candidates, alias, canonicalRef);
    }
  }

  return Object.fromEntries(
    Array.from(candidates.entries())
      .filter(([, refs]) => refs.size === 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([alias, refs]) => [alias, Array.from(refs)[0]]),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      "company-id": { type: "string" },
      context: { type: "string" },
      profile: { type: "string" },
      "api-base": { type: "string" },
      "api-key": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const companyId = values["company-id"]?.trim() || process.env.PAPERCLIP_COMPANY_ID?.trim();
  if (!companyId) fail("Missing company id. Pass --company-id or set PAPERCLIP_COMPANY_ID.");

  const repoDir = await findRepoDir();
  const commonArgs = buildCommonArgs({
    context: values.context,
    profile: values.profile,
    apiBase: values["api-base"],
    apiKey: values["api-key"],
  });

  const agents = await runJson(
    repoDir,
    ["--silent", "paperclipai", "agent", "list", "--company-id", companyId, "--json", ...commonArgs],
    "agent lookup",
  );

  if (!Array.isArray(agents)) {
    throw new Error("agent list did not return an array");
  }

  const aliases = generateAliases(agents);
  await fs.writeFile(generatedAliasesPath, JSON.stringify(aliases, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${Object.keys(aliases).length} generated aliases to ${generatedAliasesPath}`,
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
