import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  forIssue: vi.fn(),
  runsForIssue: vi.fn(),
  issuesForRun: vi.fn(),
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

vi.mock("../services/activity.js", () => ({
  activityService: () => ({
    list: mocks.list,
    create: mocks.create,
    forIssue: mocks.forIssue,
    runsForIssue: mocks.runsForIssue,
    issuesForRun: mocks.issuesForRun,
  }),
}));

vi.mock("../services/index.js", () => ({
  issueService: () => ({
    getById: mocks.getById,
    getByIdentifier: mocks.getByIdentifier,
  }),
}));

import { activityRoutes } from "../routes/activity.js";

function createDbForRun(companyId: string | null) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (companyId ? [{ companyId }] : [])),
      })),
    })),
  };
}

function createApp(db: unknown, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use(activityRoutes(db as never));
  app.use((err: { status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
  });
  return app;
}

describe("GET /heartbeat-runs/:runId/issues authz", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.create.mockReset();
    mocks.forIssue.mockReset();
    mocks.runsForIssue.mockReset();
    mocks.issuesForRun.mockReset();
    mocks.getById.mockReset();
    mocks.getByIdentifier.mockReset();
  });

  it("returns 403 for cross-company access", async () => {
    const app = createApp(createDbForRun("company-b"), {
      type: "board",
      source: "session",
      userId: "board-1",
      companyIds: ["company-a"],
    });

    const res = await request(app).get("/heartbeat-runs/run-1/issues");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("User does not have access");
    expect(mocks.issuesForRun).not.toHaveBeenCalled();
  });

  it("returns run issues when authorized for the run company", async () => {
    mocks.issuesForRun.mockResolvedValue([{ issueId: "issue-1" }]);

    const app = createApp(createDbForRun("company-a"), {
      type: "board",
      source: "session",
      userId: "board-1",
      companyIds: ["company-a"],
    });

    const res = await request(app).get("/heartbeat-runs/run-1/issues");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ issueId: "issue-1" }]);
    expect(mocks.issuesForRun).toHaveBeenCalledWith("run-1");
  });
});
