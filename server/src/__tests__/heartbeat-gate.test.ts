import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readConfigFileMock = vi.hoisted(() => vi.fn());
vi.mock("../config-file.js", () => ({
  readConfigFile: readConfigFileMock,
}));

import {
  evaluateHeartbeatGate,
  parseHeartbeatGateConfig,
} from "../services/heartbeat-gate.js";

function baseConfig(overrides?: Partial<ReturnType<typeof parseHeartbeatGateConfig>>) {
  return {
    mode: "enforce" as const,
    model: null,
    timeoutMs: 1200,
    maxInputChars: 2000,
    maxNextCheckHintSec: 300,
    ...overrides,
  };
}

function baseInput() {
  return {
    source: "timer",
    triggerDetail: "system",
    reason: "heartbeat_timer",
    issueId: null,
    commentId: null,
    taskKey: null,
    activeRunCount: 0,
    latestRunStatus: null,
    latestRunCreatedAt: null,
    latestRunFinishedAt: null,
    now: new Date("2026-03-05T12:00:00.000Z"),
  };
}

describe("heartbeat gate model evaluation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null decision for off mode", async () => {
    const result = await evaluateHeartbeatGate(
      baseConfig({ mode: "off", model: null }),
      baseInput(),
    );
    expect(result).toEqual({
      mode: "off",
      decision: null,
      reasonCode: null,
      nextCheckHintSec: null,
      evaluatedAt: null,
      gateModel: null,
      gateFailureCode: null,
      gateUsedDefaultModel: false,
    });
  });

  it("uses explicit model from runtime config", async () => {
    readConfigFileMock.mockReturnValue({
      llm: { provider: "openai", apiKey: "config-key" },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "not_now",
                  reason_code: "quiet_pulse",
                  next_check_hint_sec: 45,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateHeartbeatGate(
      baseConfig({ model: "gpt-4o-mini" }),
      baseInput(),
    );
    expect(result.decision).toBe("not_now");
    expect(result.reasonCode).toBe("quiet_pulse");
    expect(result.gateModel).toBe("gpt-4o-mini");
    expect(result.gateUsedDefaultModel).toBe(false);
  });

  it("uses provider default model when model is unset", async () => {
    readConfigFileMock.mockReturnValue({
      llm: { provider: "openai", apiKey: "config-key" },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "run_expensive_now",
                  reason_code: "default_model_path",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateHeartbeatGate(baseConfig({ model: null }), baseInput());
    expect(result.decision).toBe("run_expensive_now");
    expect(result.gateModel).toBe("gpt-4o-mini");
    expect(result.gateUsedDefaultModel).toBe(true);
  });

  it("fails open with model_unresolved when provider cannot be resolved", async () => {
    readConfigFileMock.mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateHeartbeatGate(baseConfig({ model: null }), baseInput());
    expect(result.decision).toBe("run_expensive_now");
    expect(result.reasonCode).toBe("heartbeat_gate.model_unresolved");
    expect(result.gateFailureCode).toBe("heartbeat_gate.model_unresolved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open with model_unresolved when provider key is missing", async () => {
    readConfigFileMock.mockReturnValue({
      llm: { provider: "openai" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateHeartbeatGate(baseConfig({ model: null }), baseInput());
    expect(result.decision).toBe("run_expensive_now");
    expect(result.reasonCode).toBe("heartbeat_gate.model_unresolved");
    expect(result.gateFailureCode).toBe("heartbeat_gate.model_unresolved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open with model_timeout on aborted provider call", async () => {
    readConfigFileMock.mockReturnValue({
      llm: { provider: "openai", apiKey: "config-key" },
    });
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await evaluateHeartbeatGate(baseConfig({ model: null }), baseInput());
    expect(result.decision).toBe("run_expensive_now");
    expect(result.reasonCode).toBe("heartbeat_gate.model_timeout");
    expect(result.gateFailureCode).toBe("heartbeat_gate.model_timeout");
  });

  it("fails open with model_error on provider non-200", async () => {
    readConfigFileMock.mockReturnValue({
      llm: { provider: "openai", apiKey: "config-key" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));

    const result = await evaluateHeartbeatGate(baseConfig({ model: null }), baseInput());
    expect(result.decision).toBe("run_expensive_now");
    expect(result.reasonCode).toBe("heartbeat_gate.model_error");
    expect(result.gateFailureCode).toBe("heartbeat_gate.model_error");
  });

  it("fails open with model_invalid on invalid decision output", async () => {
    readConfigFileMock.mockReturnValue({
      llm: { provider: "openai", apiKey: "config-key" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    decision: "skip",
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await evaluateHeartbeatGate(baseConfig({ model: null }), baseInput());
    expect(result.decision).toBe("run_expensive_now");
    expect(result.reasonCode).toBe("heartbeat_gate.model_invalid");
    expect(result.gateFailureCode).toBe("heartbeat_gate.model_invalid");
  });
});
