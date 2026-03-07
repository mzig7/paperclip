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
    baseUrl: null,
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
    assignedOpenIssueCount: 0,
    deferredWakeCount: 0,
    newIssueCommentCount: 0,
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

  it("supports OpenAI-compatible baseUrl without API key (LM Studio)", async () => {
    readConfigFileMock.mockReturnValue(null);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "not_now",
                  reason_code: "quiet_local",
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
      baseConfig({
        model: "qwen3.5:4b",
        baseUrl: "http://localhost:1234",
      }),
      baseInput(),
    );

    expect(result.decision).toBe("not_now");
    expect(result.reasonCode).toBe("quiet_local");
    expect(result.gateModel).toBe("qwen3.5:4b");
    expect(result.gateFailureCode).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:1234/v1/chat/completions");
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers ?? {};
    expect(headers.Authorization).toBeUndefined();
  });

  it("falls back to text response_format when provider rejects json_object", async () => {
    readConfigFileMock.mockReturnValue(null);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "'response_format.type' must be 'json_schema' or 'text'",
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    decision: "not_now",
                    reason_code: "quiet_local",
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
      baseConfig({
        model: "qwen3.5-4b",
        baseUrl: "http://localhost:1234",
      }),
      baseInput(),
    );

    expect(result.decision).toBe("not_now");
    expect(result.reasonCode).toBe("quiet_local");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string })?.body ?? "{}")) as {
      response_format?: { type?: string };
    };
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as { body?: string })?.body ?? "{}")) as {
      response_format?: { type?: string };
    };
    expect(firstBody.response_format?.type).toBe("json_object");
    expect(secondBody.response_format?.type).toBe("text");
  });

  it("falls back to no response_format when provider rejects text response_format", async () => {
    readConfigFileMock.mockReturnValue(null);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "'response_format.type' must be 'json_schema' or 'text'",
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "'response_format.type' must be 'json_schema' or 'text'",
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    decision: "not_now",
                    reason_code: "quiet_local",
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
      baseConfig({
        model: "qwen3.5-4b",
        baseUrl: "http://localhost:1234",
      }),
      baseInput(),
    );

    expect(result.decision).toBe("not_now");
    expect(result.reasonCode).toBe("quiet_local");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string })?.body ?? "{}")) as {
      response_format?: { type?: string };
    };
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as { body?: string })?.body ?? "{}")) as {
      response_format?: { type?: string };
    };
    const thirdBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as { body?: string })?.body ?? "{}")) as {
      response_format?: { type?: string };
    };
    expect(firstBody.response_format?.type).toBe("json_object");
    expect(secondBody.response_format?.type).toBe("text");
    expect(thirdBody.response_format).toBeUndefined();
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
