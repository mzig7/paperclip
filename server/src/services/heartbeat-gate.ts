import { z } from "zod";
import { asNumber, parseObject } from "../adapters/utils.js";
import { readConfigFile } from "../config-file.js";

export const HEARTBEAT_GATE_MODES = ["off", "shadow", "enforce"] as const;
export type HeartbeatGateMode = (typeof HEARTBEAT_GATE_MODES)[number];

export const HEARTBEAT_GATE_DECISIONS = ["run_expensive_now", "not_now"] as const;
export type HeartbeatGateDecisionValue = (typeof HEARTBEAT_GATE_DECISIONS)[number];

export interface HeartbeatGateConfig {
  mode: HeartbeatGateMode;
  model: string | null;
  baseUrl: string | null;
  timeoutMs: number;
  maxInputChars: number;
  maxNextCheckHintSec: number;
}

export interface HeartbeatGateInput {
  source: string;
  triggerDetail: string | null;
  reason: string | null;
  issueId: string | null;
  commentId: string | null;
  taskKey: string | null;
  activeRunCount: number;
  assignedOpenIssueCount: number;
  deferredWakeCount: number;
  newIssueCommentCount: number;
  latestRunStatus: string | null;
  latestRunCreatedAt: Date | null;
  latestRunFinishedAt: Date | null;
  now: Date;
}

export interface HeartbeatGateEvaluation {
  mode: HeartbeatGateMode;
  decision: HeartbeatGateDecisionValue | null;
  reasonCode: string | null;
  nextCheckHintSec: number | null;
  evaluatedAt: Date | null;
  gateModel: string | null;
  gateFailureCode: string | null;
  gateUsedDefaultModel: boolean;
}

const gateDecisionSchema = z.object({
  decision: z.enum(HEARTBEAT_GATE_DECISIONS),
  reason_code: z.string().trim().min(1).optional(),
  next_check_hint_sec: z.number().int().positive().optional(),
});

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(asNumber(value, fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonCandidate(text: string): unknown {
  const direct = text.trim();
  if (direct.length === 0) return null;
  try {
    return JSON.parse(direct);
  } catch {
    // continue
  }

  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fencedCandidate = fenced?.[1]?.trim();
  if (fencedCandidate) {
    try {
      return JSON.parse(fencedCandidate);
    } catch {
      // continue
    }
  }

  const firstBrace = direct.indexOf("{");
  const lastBrace = direct.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = direct.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(sliced);
    } catch {
      return null;
    }
  }
  return null;
}

function truncateInput(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(1, maxChars - 14))}\n[truncated]`;
}

type GateProvider = "openai" | "claude";

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.toLowerCase().endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

function resolveOpenAiBaseUrl(config: HeartbeatGateConfig): string | null {
  const explicit = toNonEmptyString(config.baseUrl);
  if (explicit) return normalizeOpenAiBaseUrl(explicit);
  const env = toNonEmptyString(process.env.OPENAI_BASE_URL);
  if (env) return normalizeOpenAiBaseUrl(env);
  return null;
}

function resolveGlobalProvider(): GateProvider | null {
  const config = readConfigFile();
  const provider = config?.llm?.provider;
  if (provider === "openai" || provider === "claude") return provider;
  return null;
}

function resolveProviderApiKey(provider: GateProvider): string | null {
  const envKey =
    provider === "openai"
      ? toNonEmptyString(process.env.OPENAI_API_KEY)
      : toNonEmptyString(process.env.ANTHROPIC_API_KEY);
  if (envKey) return envKey;

  const config = readConfigFile();
  if (config?.llm?.provider !== provider) return null;
  return toNonEmptyString(config.llm.apiKey);
}

function resolveEffectiveModel(
  config: HeartbeatGateConfig,
  opts?: { openAiBaseUrl?: string | null },
): {
  model: string | null;
  provider: GateProvider | null;
  usedDefaultModel: boolean;
} {
  if (opts?.openAiBaseUrl) {
    return {
      model: config.model ?? "gpt-4o-mini",
      provider: "openai",
      usedDefaultModel: !config.model,
    };
  }
  const provider = resolveGlobalProvider();
  if (!provider) {
    return { model: null, provider: null, usedDefaultModel: false };
  }
  if (config.model) {
    return { model: config.model, provider, usedDefaultModel: false };
  }
  if (provider === "openai") {
    return { model: "gpt-4o-mini", provider, usedDefaultModel: true };
  }
  return { model: "claude-haiku-4-5-20251001", provider, usedDefaultModel: true };
}

async function invokeOpenAiGate(input: {
  apiKey?: string | null;
  baseUrl?: string | null;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const endpoint = `${input.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.apiKey) {
      headers.Authorization = `Bearer ${input.apiKey}`;
    }
    const messages = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ];
    const sendCompletion = async (responseFormat: "json_object" | "text" | null) => {
      const body: Record<string, unknown> = {
        model: input.model,
        temperature: 0,
        max_tokens: 120,
        messages,
      };
      if (responseFormat === "json_object") {
        body.response_format = { type: "json_object" };
      } else if (responseFormat === "text") {
        body.response_format = { type: "text" };
      }
      return fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    };

    const isUnsupportedResponseFormat = (value: string) => {
      const text = value.toLowerCase();
      return text.includes("response_format") && (text.includes("json_schema") || text.includes("text"));
    };

    let response = await sendCompletion("json_object");
    if (!response.ok && response.status === 400) {
      const errorText = await response.text();
      if (isUnsupportedResponseFormat(errorText)) {
        response = await sendCompletion("text");
        if (!response.ok && response.status === 400) {
          const textFormatError = await response.text();
          if (isUnsupportedResponseFormat(textFormatError)) {
            response = await sendCompletion(null);
          } else {
            throw new Error(`openai_http_${response.status}`);
          }
        }
      } else {
        throw new Error(`openai_http_${response.status}`);
      }
    }

    if (!response.ok) {
      throw new Error(`openai_http_${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    return parseJsonCandidate(content);
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeClaudeGate(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 120,
        temperature: 0,
        system: input.systemPrompt,
        messages: [{ role: "user", content: input.userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`claude_http_${response.status}`);
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (payload.content ?? [])
      .filter((chunk) => chunk.type === "text" && typeof chunk.text === "string")
      .map((chunk) => chunk.text ?? "")
      .join("\n");
    return parseJsonCandidate(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeModelGate(input: {
  provider: GateProvider;
  apiKey?: string | null;
  model: string;
  baseUrl?: string | null;
  timeoutMs: number;
  maxInputChars: number;
  pulse: HeartbeatGateInput;
}): Promise<unknown> {
  const pulsePayload = truncateInput(
    JSON.stringify(
      {
        source: input.pulse.source,
        triggerDetail: input.pulse.triggerDetail,
        reason: input.pulse.reason,
        issueId: input.pulse.issueId,
        commentId: input.pulse.commentId,
        taskKey: input.pulse.taskKey,
        activeRunCount: input.pulse.activeRunCount,
        assignedOpenIssueCount: input.pulse.assignedOpenIssueCount,
        deferredWakeCount: input.pulse.deferredWakeCount,
        newIssueCommentCount: input.pulse.newIssueCommentCount,
        latestRunStatus: input.pulse.latestRunStatus,
        latestRunCreatedAt: input.pulse.latestRunCreatedAt?.toISOString() ?? null,
        latestRunFinishedAt: input.pulse.latestRunFinishedAt?.toISOString() ?? null,
        now: input.pulse.now.toISOString(),
      },
      null,
      2,
    ),
    input.maxInputChars,
  );

  const systemPrompt =
    "You are a heartbeat gate. Output ONLY strict JSON with keys: decision, reason_code, next_check_hint_sec. " +
    "decision must be run_expensive_now or not_now. Do not output explanations or markdown.";
  const userPrompt = `Pulse input:\n${pulsePayload}`;

  if (input.provider === "openai") {
    return invokeOpenAiGate({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      systemPrompt,
      userPrompt,
      timeoutMs: input.timeoutMs,
    });
  }
  return invokeClaudeGate({
    apiKey: input.apiKey as string,
    model: input.model,
    systemPrompt,
    userPrompt,
    timeoutMs: input.timeoutMs,
  });
}

export function parseHeartbeatGateConfig(runtimeConfigRaw: unknown): HeartbeatGateConfig {
  const runtimeConfig = parseObject(runtimeConfigRaw);
  const gate = parseObject(runtimeConfig.heartbeatGate);
  const modeRaw = toNonEmptyString(gate.mode) ?? "off";
  const mode = (HEARTBEAT_GATE_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as HeartbeatGateMode)
    : "off";

  return {
    mode,
    model: toNonEmptyString(gate.model),
    baseUrl: toNonEmptyString(gate.baseUrl),
    timeoutMs: clampInt(gate.timeoutMs, 1200, 250, 10_000),
    maxInputChars: clampInt(gate.maxInputChars, 2000, 128, 16_000),
    maxNextCheckHintSec: clampInt(gate.maxNextCheckHintSec, 300, 1, 3600),
  };
}

export function sanitizeGateDecision(
  raw: unknown,
  maxNextCheckHintSec: number,
): { decision: HeartbeatGateDecisionValue; reasonCode: string | null; nextCheckHintSec: number | null } {
  const parsed = gateDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      decision: "run_expensive_now",
      reasonCode: "gate_decision_invalid",
      nextCheckHintSec: null,
    };
  }

  const reasonCode = toNonEmptyString(parsed.data.reason_code) ?? null;
  const nextCheckHintSec =
    typeof parsed.data.next_check_hint_sec === "number"
      ? Math.max(1, Math.min(maxNextCheckHintSec, Math.floor(parsed.data.next_check_hint_sec)))
      : null;

  return {
    decision: parsed.data.decision,
    reasonCode,
    nextCheckHintSec,
  };
}

export async function evaluateHeartbeatGate(
  config: HeartbeatGateConfig,
  input: HeartbeatGateInput,
): Promise<HeartbeatGateEvaluation> {
  if (config.mode === "off") {
    return {
      mode: "off",
      decision: null,
      reasonCode: null,
      nextCheckHintSec: null,
      evaluatedAt: null,
      gateModel: null,
      gateFailureCode: null,
      gateUsedDefaultModel: false,
    };
  }

  const openAiBaseUrl = resolveOpenAiBaseUrl(config);
  const resolved = resolveEffectiveModel(config, { openAiBaseUrl });
  if (!resolved.provider || !resolved.model) {
    return {
      mode: config.mode,
      decision: "run_expensive_now",
      reasonCode: "heartbeat_gate.model_unresolved",
      nextCheckHintSec: null,
      evaluatedAt: input.now,
      gateModel: resolved.model,
      gateFailureCode: "heartbeat_gate.model_unresolved",
      gateUsedDefaultModel: resolved.usedDefaultModel,
    };
  }

  const apiKey = resolveProviderApiKey(resolved.provider);
  const allowMissingApiKey = resolved.provider === "openai" && Boolean(openAiBaseUrl);
  if (!apiKey && !allowMissingApiKey) {
    return {
      mode: config.mode,
      decision: "run_expensive_now",
      reasonCode: "heartbeat_gate.model_unresolved",
      nextCheckHintSec: null,
      evaluatedAt: input.now,
      gateModel: resolved.model,
      gateFailureCode: "heartbeat_gate.model_unresolved",
      gateUsedDefaultModel: resolved.usedDefaultModel,
    };
  }

  let rawDecision: unknown;
  try {
    rawDecision = await invokeModelGate({
      provider: resolved.provider,
      apiKey,
      model: resolved.model,
      baseUrl: openAiBaseUrl,
      timeoutMs: config.timeoutMs,
      maxInputChars: config.maxInputChars,
      pulse: input,
    });
  } catch (err) {
    const failureCode =
      err instanceof Error && err.name === "AbortError"
        ? "heartbeat_gate.model_timeout"
        : "heartbeat_gate.model_error";
    return {
      mode: config.mode,
      decision: "run_expensive_now",
      reasonCode: failureCode,
      nextCheckHintSec: null,
      evaluatedAt: input.now,
      gateModel: resolved.model,
      gateFailureCode: failureCode,
      gateUsedDefaultModel: resolved.usedDefaultModel,
    };
  }

  const decision = sanitizeGateDecision(rawDecision, config.maxNextCheckHintSec);
  if (decision.reasonCode === "gate_decision_invalid") {
    return {
      mode: config.mode,
      decision: "run_expensive_now",
      reasonCode: "heartbeat_gate.model_invalid",
      nextCheckHintSec: null,
      evaluatedAt: input.now,
      gateModel: resolved.model,
      gateFailureCode: "heartbeat_gate.model_invalid",
      gateUsedDefaultModel: resolved.usedDefaultModel,
    };
  }

  return {
    mode: config.mode,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    nextCheckHintSec: decision.nextCheckHintSec,
    evaluatedAt: input.now,
    gateModel: resolved.model,
    gateFailureCode: null,
    gateUsedDefaultModel: resolved.usedDefaultModel,
  };
}
