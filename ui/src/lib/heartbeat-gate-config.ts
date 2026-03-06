import {
  HEARTBEAT_GATE_MODES,
  type HeartbeatGateMode,
} from "@paperclipai/shared";

export interface HeartbeatGateFormValues {
  heartbeatGateMode: HeartbeatGateMode;
  heartbeatGateUseSeparateModel: boolean;
  heartbeatGateModel: string;
  heartbeatGateBaseUrl: string;
}

export interface HeartbeatCreateRuntimeValues {
  heartbeatEnabled: boolean;
  intervalSec: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseHeartbeatGateMode(value: unknown): HeartbeatGateMode {
  return typeof value === "string" &&
    (HEARTBEAT_GATE_MODES as readonly string[]).includes(value)
    ? (value as HeartbeatGateMode)
    : "off";
}

export function getHeartbeatGateFormValues(
  runtimeConfig: Record<string, unknown> | null | undefined,
): HeartbeatGateFormValues {
  const gate = asRecord(runtimeConfig?.heartbeatGate);
  const model = toTrimmedString(gate.model);
  const baseUrl = toTrimmedString(gate.baseUrl);

  return {
    heartbeatGateMode: parseHeartbeatGateMode(gate.mode),
    heartbeatGateUseSeparateModel: model.length > 0 || baseUrl.length > 0,
    heartbeatGateModel: model,
    heartbeatGateBaseUrl: baseUrl,
  };
}

export function buildHeartbeatGateRuntimeConfig(
  values: HeartbeatGateFormValues,
  existingGate?: Record<string, unknown> | null,
): Record<string, unknown> {
  const gate: Record<string, unknown> = {
    ...asRecord(existingGate),
    mode: values.heartbeatGateMode,
  };

  if (
    values.heartbeatGateMode !== "off" &&
    values.heartbeatGateUseSeparateModel
  ) {
    gate.model = toTrimmedString(values.heartbeatGateModel) || null;
    gate.baseUrl = toTrimmedString(values.heartbeatGateBaseUrl) || null;
    return gate;
  }

  gate.model = null;
  gate.baseUrl = null;
  return gate;
}

export function hasHeartbeatGateModelValidationError(
  values: HeartbeatGateFormValues,
): boolean {
  return (
    values.heartbeatGateMode !== "off" &&
    values.heartbeatGateUseSeparateModel &&
    toTrimmedString(values.heartbeatGateModel).length === 0
  );
}

export function buildCreateRuntimeConfig(
  heartbeat: HeartbeatCreateRuntimeValues,
  gateValues: HeartbeatGateFormValues,
): Record<string, unknown> {
  return {
    heartbeat: {
      enabled: heartbeat.heartbeatEnabled,
      intervalSec: heartbeat.intervalSec,
      wakeOnDemand: true,
      cooldownSec: 10,
      maxConcurrentRuns: 1,
    },
    heartbeatGate: buildHeartbeatGateRuntimeConfig(gateValues),
  };
}
