import { describe, it, expect, beforeEach } from "vitest";
import { MigrationEngine, UpgradeManifest, MigrationStatus, UpgradeStrategy } from "../src/migration";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("MigrationEngine", () => {
  let tmpdir: string;
  let engine: MigrationEngine;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-migration-"));
    engine = new MigrationEngine(tmpdir);
  });

  it("registers a migration and returns a stable id", () => {
    const manifest: UpgradeManifest = {
      versionFrom: "14.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.BLUE_GREEN,
      steps: [],
      rollbackSteps: [],
      metadata: {},
    };
    const id1 = engine.registerMigration(manifest);
    const manifest2: UpgradeManifest = {
      ...manifest,
    };
    const id2 = engine.registerMigration(manifest2);
    expect(id1).toBe(id2);
    expect(id1.length).toBe(16);
  });

  it("executes a dry-run migration without side effects", () => {
    const manifest: UpgradeManifest = {
      versionFrom: "14.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.ROLLING,
      steps: [
        { name: "backup" },
        { name: "migrate_schema" },
      ],
      rollbackSteps: [],
      metadata: {},
    };
    const record = engine.execute(manifest, true);
    expect(record.status).toBe(MigrationStatus.COMPLETED);
    expect(record.logs[1]).toContain("DRY RUN");
  });

  it("executes callback steps during live run", () => {
    const executed: string[] = [];
    const manifest: UpgradeManifest = {
      versionFrom: "14.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.CANARY,
      steps: [
        { name: "callback_step", type: "callback", fn: () => executed.push("step1") },
      ],
      rollbackSteps: [],
      metadata: {},
    };
    const record = engine.execute(manifest);
    expect(record.status).toBe(MigrationStatus.COMPLETED);
    expect(executed).toContain("step1");
  });

  it("rolls back on failure", () => {
    const rollbackCalled: string[] = [];
    const manifest: UpgradeManifest = {
      versionFrom: "14.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.BIG_BANG,
      steps: [
        { name: "bad", type: "callback", fn: () => { throw new Error("boom"); } },
      ],
      rollbackSteps: [
        { name: "rollback", type: "callback", fn: () => rollbackCalled.push("done") },
      ],
      metadata: {},
    };
    const record = engine.execute(manifest);
    expect(record.status).toBe(MigrationStatus.ROLLED_BACK);
    expect(rollbackCalled).toContain("done");
  });

  it("records version locks", () => {
    const manifest: UpgradeManifest = {
      versionFrom: "14.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.BLUE_GREEN,
      steps: [{ name: "step1", type: "noop" }],
      rollbackSteps: [],
      metadata: {},
    };
    engine.execute(manifest);
    expect(engine.getVersionLock("14.0.0")).toBe("15.2.0");
  });

  it("persists and reloads checkpoints", () => {
    const manifest: UpgradeManifest = {
      versionFrom: "14.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.BLUE_GREEN,
      steps: [{ name: "step1", type: "noop" }],
      rollbackSteps: [],
      metadata: {},
    };
    const id = engine.registerMigration(manifest);
    engine.execute(manifest);

    const record = engine.getStatus(id);
    expect(record).toBeDefined();
    expect(record!.status).toBe(MigrationStatus.COMPLETED);
  });

  it("lists all migrations", () => {
    const m1: UpgradeManifest = {
      versionFrom: "14.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.BLUE_GREEN,
      steps: [],
      rollbackSteps: [],
      metadata: {},
    };
    const m2: UpgradeManifest = {
      versionFrom: "15.0.0",
      versionTo: "15.2.0",
      strategy: UpgradeStrategy.ROLLING,
      steps: [],
      rollbackSteps: [],
      metadata: {},
    };
    engine.registerMigration(m1);
    engine.registerMigration(m2);
    expect(engine.listMigrations().length).toBe(2);
  });
});
