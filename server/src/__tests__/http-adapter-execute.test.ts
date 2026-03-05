import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "../adapters/types.js";
import { execute } from "../adapters/http/execute.js";

function makeContext(config: Record<string, unknown>): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Agent",
      adapterType: "http",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config,
    context: {},
    onLog: async () => {},
  };
}

describe("http adapter execute timeout config", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers timeoutSec over legacy timeoutMs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await execute(
      makeContext({
        url: "https://example.com/webhook",
        method: "POST",
        timeoutSec: 2,
        timeoutMs: 5,
      }),
    );

    const timeoutDelays = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((value): value is number => typeof value === "number");
    expect(timeoutDelays).toContain(2000);
  });

  it("falls back to timeoutMs when timeoutSec is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await execute(
      makeContext({
        url: "https://example.com/webhook",
        method: "POST",
        timeoutMs: 150,
      }),
    );

    const timeoutDelays = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((value): value is number => typeof value === "number");
    expect(timeoutDelays).toContain(150);
  });
});
