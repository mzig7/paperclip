import { describe, expect, it } from "vitest";
import {
  buildCreateRuntimeConfig,
  buildHeartbeatGateRuntimeConfig,
  getHeartbeatGateFormValues,
  hasHeartbeatGateModelValidationError,
} from "./heartbeat-gate-config";

describe("heartbeat gate config helpers", () => {
  it("loads existing gate values into form state", () => {
    expect(
      getHeartbeatGateFormValues({
        heartbeatGate: {
          mode: "shadow",
          model: "gpt-4o-mini",
          baseUrl: " http://localhost:1234 ",
        },
      }),
    ).toEqual({
      heartbeatGateMode: "shadow",
      heartbeatGateUseSeparateModel: true,
      heartbeatGateModel: "gpt-4o-mini",
      heartbeatGateBaseUrl: "http://localhost:1234",
    });
  });

  it("preserves hidden gate keys while updating surfaced values", () => {
    expect(
      buildHeartbeatGateRuntimeConfig(
        {
          heartbeatGateMode: "enforce",
          heartbeatGateUseSeparateModel: true,
          heartbeatGateModel: "qwen3.5:4b",
          heartbeatGateBaseUrl: "",
        },
        {
          timeoutMs: 2500,
          maxInputChars: 4096,
          model: "old-model",
        },
      ),
    ).toEqual({
      mode: "enforce",
      timeoutMs: 2500,
      maxInputChars: 4096,
      model: "qwen3.5:4b",
      baseUrl: null,
    });
  });

  it("clears model and baseUrl when separate model is disabled", () => {
    expect(
      buildHeartbeatGateRuntimeConfig(
        {
          heartbeatGateMode: "shadow",
          heartbeatGateUseSeparateModel: false,
          heartbeatGateModel: "gpt-4o-mini",
          heartbeatGateBaseUrl: "http://localhost:1234",
        },
        {
          timeoutMs: 1200,
          model: "old-model",
          baseUrl: "http://old",
        },
      ),
    ).toEqual({
      mode: "shadow",
      timeoutMs: 1200,
      model: null,
      baseUrl: null,
    });
  });

  it("requires a model only when separate model is enabled", () => {
    expect(
      hasHeartbeatGateModelValidationError({
        heartbeatGateMode: "shadow",
        heartbeatGateUseSeparateModel: true,
        heartbeatGateModel: "   ",
        heartbeatGateBaseUrl: "http://localhost:1234",
      }),
    ).toBe(true);

    expect(
      hasHeartbeatGateModelValidationError({
        heartbeatGateMode: "shadow",
        heartbeatGateUseSeparateModel: false,
        heartbeatGateModel: "",
        heartbeatGateBaseUrl: "",
      }),
    ).toBe(false);
  });

  it("builds create runtime config for gate off, default model path, and separate model path", () => {
    expect(
      buildCreateRuntimeConfig(
        { heartbeatEnabled: true, intervalSec: 300 },
        {
          heartbeatGateMode: "off",
          heartbeatGateUseSeparateModel: false,
          heartbeatGateModel: "",
          heartbeatGateBaseUrl: "",
        },
      ),
    ).toEqual({
      heartbeat: {
        enabled: true,
        intervalSec: 300,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
      heartbeatGate: {
        mode: "off",
        model: null,
        baseUrl: null,
      },
    });

    expect(
      buildCreateRuntimeConfig(
        { heartbeatEnabled: false, intervalSec: 600 },
        {
          heartbeatGateMode: "shadow",
          heartbeatGateUseSeparateModel: false,
          heartbeatGateModel: "",
          heartbeatGateBaseUrl: "",
        },
      ),
    ).toEqual({
      heartbeat: {
        enabled: false,
        intervalSec: 600,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
      heartbeatGate: {
        mode: "shadow",
        model: null,
        baseUrl: null,
      },
    });

    expect(
      buildCreateRuntimeConfig(
        { heartbeatEnabled: true, intervalSec: 900 },
        {
          heartbeatGateMode: "enforce",
          heartbeatGateUseSeparateModel: true,
          heartbeatGateModel: "qwen3.5:4b",
          heartbeatGateBaseUrl: "http://localhost:1234",
        },
      ),
    ).toEqual({
      heartbeat: {
        enabled: true,
        intervalSec: 900,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
      heartbeatGate: {
        mode: "enforce",
        model: "qwen3.5:4b",
        baseUrl: "http://localhost:1234",
      },
    });
  });
});
