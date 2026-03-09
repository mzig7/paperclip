#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ISSUE_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const MODES = {
  telegram: { source: "on_demand", trigger: "manual" },
  cron: { source: "automation", trigger: "system" },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedAliasesPath = path.resolve(__dirname, "../aliases.generated.json");
const manualAliasesPath = path.resolve(__dirname, "../aliases.manual.json");

function usage() {
  return `Usage:
  dispatch-task --agent-ref "<name-or-alias>" --task "<task text>" [options]

Required:
  --agent-ref <value>   Exact agent name/urlKey or alias from generated/manual alias files
  --task <value>        Task text to dispatch into Paperclip

Optional:
  --company-id <id>     Overrides PAPERCLIP_COMPANY_ID
  --priority <value>    critical | high | medium | low (default: high)
  --project-id <id>
  --goal-id <id>
  --parent-id <id>
  --context <path>
  --profile <name>
  --api-base <url>
  --api-key <token>
  --mode <value>        telegram | cron (default: telegram)

Environment:
  PAPERCLIP_COMPANY_ID  Default company id when --company-id is omitted
  PAPERCLIP_REPO_DIR    Paperclip repo checkout used to run pnpm paperclipai
  PAPERCLIP_API_URL     Default API base for paperclipai
  PAPERCLIP_API_KEY     Default API key for paperclipai
`;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

function summarizeTask(task) {
  const compact = task.replace(/\s+/g, " ").trim();
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 117)}...`;
}

async function readAliasFile(filePath, label) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must contain a JSON object`);
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry) => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([key, value]) => [key.toLowerCase(), value]),
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function readAliases() {
  const generated = await readAliasFile(generatedAliasesPath, "aliases.generated.json");
  const manual = await readAliasFile(manualAliasesPath, "aliases.manual.json");
  return { generated, manual, combined: { ...generated, ...manual } };
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

async function assertRepoDir(repoDir) {
  const packageJsonPath = path.join(repoDir, "package.json");
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  const script = parsed?.scripts?.paperclipai;
  if (typeof script !== "string" || script.length === 0) {
    throw new Error(`package.json in ${repoDir} does not expose a paperclipai script`);
  }
}

function buildCommonArgs(options) {
  const args = [];
  if (options.context) args.push("--context", options.context);
  if (options.profile) args.push("--profile", options.profile);
  if (options.apiBase) args.push("--api-base", options.apiBase);
  if (options.apiKey) args.push("--api-key", options.apiKey);
  return args;
}

function spawnCommand(repoDir, args, mode = "capture") {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: repoDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (mode === "passthrough") process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (mode === "passthrough") process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runJson(repoDir, args, label) {
  const result = await spawnCommand(repoDir, args, "capture");
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

function resolveExactMatch(agents, ref, field) {
  const needle = ref.toLowerCase();
  return agents.filter((agent) => {
    const value = typeof agent[field] === "string" ? agent[field].toLowerCase() : "";
    return value === needle;
  });
}

function buildAgentCandidate(agent, score) {
  const reasons = [];
  if (typeof agent.title === "string" && agent.title.trim().length > 0) {
    reasons.push(`title=${agent.title.trim()}`);
  }
  if (typeof agent.role === "string" && agent.role.trim().length > 0) {
    reasons.push(`role=${agent.role.trim()}`);
  }
  if (typeof agent.urlKey === "string" && agent.urlKey.trim().length > 0) {
    reasons.push(`urlKey=${agent.urlKey.trim()}`);
  }

  return {
    agent,
    score,
    summary: `${agent.name} (${agent.id})${reasons.length > 0 ? ` [${reasons.join(", ")}]` : ""}`,
  };
}

function scoreCandidate(agent, agentRef) {
  const tokens = agentRef
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return 0;

  const haystacks = [
    agent.name,
    agent.urlKey,
    agent.title,
    agent.role,
    agent.capabilities,
  ]
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase());

  let score = 0;
  for (const token of tokens) {
    for (const haystack of haystacks) {
      if (haystack === token) score += 10;
      else if (haystack.includes(token)) score += 4;
    }
  }

  if (
    typeof agent.title === "string" &&
    agent.title.trim().toLowerCase() === agentRef.trim().toLowerCase()
  ) {
    score += 20;
  }

  return score;
}

function suggestAgents(agents, agentRef) {
  return agents
    .filter((agent) => agent.status !== "terminated")
    .map((agent) => buildAgentCandidate(agent, scoreCandidate(agent, agentRef)))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.agent.name.localeCompare(right.agent.name);
    })
    .slice(0, 5);
}

function formatSuggestions(suggestions, mode) {
  if (suggestions.length === 0) return "";
  const lines = suggestions.map((candidate) => `  - ${candidate.summary}`);
  const guidance =
    mode === "telegram"
      ? "Telegram fallback: choose the best exact agent ref from the suggestions above and retry."
      : "Cron fallback is disabled. Use an exact ref or sync aliases before retrying.";
  return `\nSuggested agents:\n${lines.join("\n")}\n${guidance}`;
}

function resolveAgent(agents, agentRef, aliases, mode) {
  const activeAgents = agents.filter((agent) => agent.status !== "terminated");

  const nameMatches = resolveExactMatch(activeAgents, agentRef, "name");
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(`Agent ref "${agentRef}" is ambiguous across agent names`);
  }

  const urlKeyMatches = resolveExactMatch(activeAgents, agentRef, "urlKey");
  if (urlKeyMatches.length === 1) return urlKeyMatches[0];
  if (urlKeyMatches.length > 1) {
    throw new Error(`Agent ref "${agentRef}" is ambiguous across agent url keys`);
  }

  const aliasTarget = aliases[agentRef.toLowerCase()];
  if (aliasTarget) {
    const aliasMatches = [
      ...resolveExactMatch(activeAgents, aliasTarget, "name"),
      ...resolveExactMatch(activeAgents, aliasTarget, "urlKey"),
    ];
    const uniqueMatches = Array.from(new Map(aliasMatches.map((agent) => [agent.id, agent])).values());
    if (uniqueMatches.length === 1) return uniqueMatches[0];
    if (uniqueMatches.length > 1) {
      throw new Error(`Alias "${agentRef}" resolved to ambiguous target "${aliasTarget}"`);
    }
    throw new Error(`Alias "${agentRef}" points to missing agent ref "${aliasTarget}"`);
  }

  const suggestions = suggestAgents(activeAgents, agentRef);
  throw new Error(
    `No agent matched "${agentRef}". Use an exact name, exact url key, or a configured alias.${formatSuggestions(
      suggestions,
      mode,
    )}`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      "agent-ref": { type: "string" },
      task: { type: "string" },
      "company-id": { type: "string" },
      priority: { type: "string" },
      "project-id": { type: "string" },
      "goal-id": { type: "string" },
      "parent-id": { type: "string" },
      context: { type: "string" },
      profile: { type: "string" },
      "api-base": { type: "string" },
      "api-key": { type: "string" },
      mode: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const agentRef = values["agent-ref"]?.trim();
  const task = values.task?.trim();
  const companyId = values["company-id"]?.trim() || process.env.PAPERCLIP_COMPANY_ID?.trim();
  const priority = values.priority?.trim() || "high";
  const mode = values.mode?.trim() || "telegram";

  if (!agentRef) fail("Missing required --agent-ref\n\n" + usage());
  if (!task) fail("Missing required --task\n\n" + usage());
  if (!companyId) fail("Missing company id. Pass --company-id or set PAPERCLIP_COMPANY_ID.");
  if (!ISSUE_PRIORITIES.has(priority)) {
    fail(`Invalid priority "${priority}". Expected one of: ${Array.from(ISSUE_PRIORITIES).join(", ")}`);
  }
  if (!(mode in MODES)) {
    fail(`Invalid mode "${mode}". Expected one of: ${Object.keys(MODES).join(", ")}`);
  }

  const repoDir = await findRepoDir();
  const aliases = await readAliases();
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

  const agent = resolveAgent(agents, agentRef, aliases.combined, mode);
  const title = summarizeTask(task);
  const description = [
    `Dispatched via OpenClaw (${mode}).`,
    `Requested agent ref: ${agentRef}`,
    `Resolved agent: ${agent.name} (${agent.id})`,
    "",
    "Task:",
    task,
  ].join("\n");

  let issue = null;
  try {
    const createArgs = [
      "--silent",
      "paperclipai",
      "issue",
      "create",
      "--company-id",
      companyId,
      "--title",
      title,
      "--description",
      description,
      "--status",
      "todo",
      "--priority",
      priority,
      "--assignee-agent-id",
      agent.id,
      "--json",
      ...commonArgs,
    ];
    if (values["project-id"]) createArgs.push("--project-id", values["project-id"]);
    if (values["goal-id"]) createArgs.push("--goal-id", values["goal-id"]);
    if (values["parent-id"]) createArgs.push("--parent-id", values["parent-id"]);

    issue = await runJson(repoDir, createArgs, "issue create");

    await runJson(
      repoDir,
      [
        "--silent",
        "paperclipai",
        "issue",
        "checkout",
        issue.id,
        "--agent-id",
        agent.id,
        "--json",
        ...commonArgs,
      ],
      "issue checkout",
    );
  } catch (error) {
    if (issue?.identifier) {
      console.error(`Created issue ${issue.identifier} but dispatch failed before invocation.`);
    }
    throw error;
  }

  const issueRef = issue.identifier || issue.id;
  console.log(`Created issue ${issueRef} for ${agent.name} (${agent.id})`);

  const heartbeatArgs = [
    "--silent",
    "paperclipai",
    "heartbeat",
    "run",
    "--agent-id",
    agent.id,
    "--source",
    MODES[mode].source,
    "--trigger",
    MODES[mode].trigger,
    ...commonArgs,
  ];

  const runResult = await spawnCommand(repoDir, heartbeatArgs, "passthrough");
  const combinedOutput = stripAnsi(`${runResult.stdout}\n${runResult.stderr}`);
  if (combinedOutput.includes("Heartbeat invocation was skipped")) {
    console.error(`Dispatch created ${issueRef}, but immediate invoke was skipped.`);
    process.exit(1);
  }

  if (typeof runResult.code === "number") {
    if (runResult.code !== 0) {
      console.error(`Dispatch created ${issueRef}, but heartbeat invocation failed.`);
      process.exit(runResult.code);
    }
    process.exit(0);
  }

  console.error(
    `Dispatch created ${issueRef}, but heartbeat invocation exited unexpectedly${runResult.signal ? ` (${runResult.signal})` : ""}.`,
  );
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
