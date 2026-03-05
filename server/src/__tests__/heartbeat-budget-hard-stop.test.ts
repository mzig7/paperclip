import { describe, expect, it } from "vitest";
import { detectBudgetHardStop } from "../services/heartbeat.js";

describe("detectBudgetHardStop", () => {
  it("returns null when neither budget is exhausted", () => {
    const result = detectBudgetHardStop({
      agent: { budgetMonthlyCents: 100, spentMonthlyCents: 99 },
      company: { budgetMonthlyCents: 1000, spentMonthlyCents: 500 },
    });
    expect(result).toBeNull();
  });

  it("returns agent reason when only agent budget is exhausted", () => {
    const result = detectBudgetHardStop({
      agent: { budgetMonthlyCents: 100, spentMonthlyCents: 100 },
      company: { budgetMonthlyCents: 1000, spentMonthlyCents: 500 },
    });
    expect(result?.reasonCode).toBe("budget.hard_stop.agent");
  });

  it("returns company reason when only company budget is exhausted", () => {
    const result = detectBudgetHardStop({
      agent: { budgetMonthlyCents: 100, spentMonthlyCents: 50 },
      company: { budgetMonthlyCents: 1000, spentMonthlyCents: 1000 },
    });
    expect(result?.reasonCode).toBe("budget.hard_stop.company");
  });

  it("returns combined reason when both budgets are exhausted", () => {
    const result = detectBudgetHardStop({
      agent: { budgetMonthlyCents: 100, spentMonthlyCents: 100 },
      company: { budgetMonthlyCents: 1000, spentMonthlyCents: 1000 },
    });
    expect(result?.reasonCode).toBe("budget.hard_stop.agent_and_company");
  });
});
