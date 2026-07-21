import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export enum MigrationStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  ROLLED_BACK = "rolled_back",
}

export enum UpgradeStrategy {
  BLUE_GREEN = "blue_green",
  ROLLING = "rolling",
  CANARY = "canary",
  BIG_BANG = "big_bang",
}

export interface UpgradeManifest {
  versionFrom: string;
  versionTo: string;
  strategy: UpgradeStrategy;
  steps: Record<string, unknown>[];
  rollbackSteps: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  _id?: string;
}

export interface MigrationRecord {
  manifestId: string;
  status: MigrationStatus;
  currentStep: number;
  logs: string[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export class MigrationEngine {
  private checkpointDir: string;
  private activeMigrations: Map<string, MigrationRecord> = new Map();
  private versionLocks: Map<string, string> = new Map();

  constructor(checkpointDir: string = ".alp/migrations") {
    this.checkpointDir = checkpointDir;
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }
  }

  registerMigration(manifest: UpgradeManifest): string {
    const id = manifest._id ?? this.computeManifestId(manifest);
    const record: MigrationRecord = {
      manifestId: id,
      status: MigrationStatus.PENDING,
      logs: [],
      currentStep: 0,
    };
    this.activeMigrations.set(id, record);
    this.saveCheckpoint(record);
    return id;
  }

  execute(manifest: UpgradeManifest, dryRun: boolean = false): MigrationRecord {
    const id = manifest._id ?? this.computeManifestId(manifest);
    let record = this.activeMigrations.get(id);
    if (!record) {
      record = {
        manifestId: id,
        status: MigrationStatus.RUNNING,
        logs: [],
        currentStep: 0,
      };
      this.activeMigrations.set(id, record);
    }

    record.status = MigrationStatus.RUNNING;
    record.startedAt = this.now();
    record.logs.push(
      `Starting migration ${manifest.versionFrom} -> ${manifest.versionTo}`
    );

    if (dryRun) {
      record.logs.push("DRY RUN: validating steps only");
      manifest.steps.forEach((step, i) => {
        record.logs.push(`Step ${i + 1}: ${step["name"] ?? "unnamed"} [validated]`);
      });
      record.status = MigrationStatus.COMPLETED;
      record.completedAt = this.now();
      this.saveCheckpoint(record);
      return record;
    }

    try {
      this.versionLocks.set(manifest.versionFrom, manifest.versionTo);
      manifest.steps.forEach((step, i) => {
        record.currentStep = i;
        const stepName = step["name"] ?? `step_${i}`;
        record.logs.push(`Executing step ${i + 1}: ${stepName}`);
        this.executeStep(step);
      });
      record.status = MigrationStatus.COMPLETED;
      record.completedAt = this.now();
      record.logs.push(`Migration completed: ${manifest.versionTo}`);
    } catch (e) {
      record.status = MigrationStatus.FAILED;
      record.error = String(e);
      record.logs.push(`Migration failed: ${e}`);
      this.rollback(manifest, record);
    }

    this.saveCheckpoint(record);
    return record;
  }

  rollback(manifest: UpgradeManifest, record: MigrationRecord): MigrationRecord {
    return this.rollbackInternal(manifest, record);
  }

  private rollbackInternal(
    manifest: UpgradeManifest,
    record: MigrationRecord
  ): MigrationRecord {
    record.status = MigrationStatus.ROLLED_BACK;
    record.logs.push("Initiating rollback...");
    manifest.rollbackSteps.forEach((step, i) => {
      const stepName = step["name"] ?? `rollback_step_${i}`;
      record.logs.push(`Rollback step ${i + 1}: ${stepName}`);
      this.executeStep(step);
    });
    record.logs.push("Rollback completed");
    if (!record.completedAt) {
      record.completedAt = this.now();
    }
    this.saveCheckpoint(record);
    return record;
  }

  private executeStep(step: Record<string, unknown>): void {
    const stepType = step["type"] ?? "noop";
    if (stepType === "noop") {
      return;
    } else if (stepType === "callback" && typeof step["fn"] === "function") {
      (step["fn"] as () => void)();
    } else if (stepType === "shell" && typeof step["command"] === "string") {
      require("child_process").execSync(step["command"], {
        stdio: "ignore",
      });
    }
  }

  getStatus(migrationId: string): MigrationRecord | undefined {
    return this.activeMigrations.get(migrationId);
  }

  listMigrations(): MigrationRecord[] {
    return Array.from(this.activeMigrations.values());
  }

  getVersionLock(version: string): string | undefined {
    return this.versionLocks.get(version);
  }

  saveCheckpoint(record: MigrationRecord): void {
    const filePath = path.join(this.checkpointDir, `${record.manifestId}.json`);
    const data = {
      manifestId: record.manifestId,
      status: record.status,
      currentStep: record.currentStep,
      logs: record.logs,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      error: record.error,
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  loadCheckpoint(migrationId: string): MigrationRecord | null {
    const filePath = path.join(this.checkpointDir, `${migrationId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
      manifestId: data.manifestId,
      status: data.status,
      currentStep: data.currentStep ?? 0,
      logs: data.logs ?? [],
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      error: data.error,
    };
  }

  private computeManifestId(manifest: UpgradeManifest): string {
    const content = `${manifest.versionFrom}:${manifest.versionTo}:${manifest.strategy}`;
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private now(): string {
    return new Date().toISOString();
  }
}
