import { describe, expect, it } from "vitest";
import { deriveDeterministicHeartbeatGateDecision } from "../services/heartbeat.js";

describe("deriveDeterministicHeartbeatGateDecision", () => {
  it("forces run for non-timer sources", () => {
    const result = deriveDeterministicHeartbeatGateDecision({
      source: "on_demand",
      runningOrQueuedRunCount: 0,
      assignedOpenIssueCount: 0,
      deferredWakeCount: 0,
      newIssueCommentCount: 0,
    });
    expect(result).toEqual({
      decision: "run_expensive_now",
      reasonCode: "heartbeat_gate.signal.non_timer_source",
    });
  });

  it("returns not_now when a run is already in-flight", () => {
    const result = deriveDeterministicHeartbeatGateDecision({
      source: "timer",
      runningOrQueuedRunCount: 1,
      assignedOpenIssueCount: 3,
      deferredWakeCount: 1,
      newIssueCommentCount: 2,
    });
    expect(result).toEqual({
      decision: "not_now",
      reasonCode: "heartbeat_gate.signal.inflight_run",
    });
  });

  it("returns not_now for quiet timer pulses with no pending work", () => {
    const result = deriveDeterministicHeartbeatGateDecision({
      source: "timer",
      runningOrQueuedRunCount: 0,
      assignedOpenIssueCount: 0,
      deferredWakeCount: 0,
      newIssueCommentCount: 0,
    });
    expect(result).toEqual({
      decision: "not_now",
      reasonCode: "heartbeat_gate.signal.no_pending_work",
    });
  });

  it("returns null when timer pulse has pending work signals", () => {
    expect(
      deriveDeterministicHeartbeatGateDecision({
        source: "timer",
        runningOrQueuedRunCount: 0,
        assignedOpenIssueCount: 1,
        deferredWakeCount: 0,
        newIssueCommentCount: 0,
      }),
    ).toBeNull();
    expect(
      deriveDeterministicHeartbeatGateDecision({
        source: "timer",
        runningOrQueuedRunCount: 0,
        assignedOpenIssueCount: 0,
        deferredWakeCount: 1,
        newIssueCommentCount: 0,
      }),
    ).toBeNull();
    expect(
      deriveDeterministicHeartbeatGateDecision({
        source: "timer",
        runningOrQueuedRunCount: 0,
        assignedOpenIssueCount: 0,
        deferredWakeCount: 0,
        newIssueCommentCount: 1,
      }),
    ).toBeNull();
  });
});
