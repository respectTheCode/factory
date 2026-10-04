import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Database } from "bun:sqlite";

const MACHINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const MACHINE_TOKEN_PREFIX = "fmc_";
const LAST_USED_UPDATE_INTERVAL_MS = 60_000;

export type MachineCredentialRole = "coding" | "reviewer";

export type MachineCredentialIdentity = {
  id: string;
  machineId: string;
  projectIds: string[];
  allProjects: boolean;
  role: MachineCredentialRole;
  reviewerName?: string;
};

export type MachineCredentialRecord = MachineCredentialIdentity & {
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type MachineCredentialStore = {
  create: (input: {
    machineId: string;
    projectIds: string[];
    role?: MachineCredentialRole;
    reviewerName?: string;
    allProjects?: boolean;
  }) => MachineCredentialIdentity & { token: string };
  authenticate: (token: string | undefined) => MachineCredentialIdentity | null;
  getActiveById: (credentialId: string) => MachineCredentialIdentity | null;
  revoke: (machineId: string) => void;
  list: () => MachineCredentialRecord[];
  close: () => void;
};

export function createMachineCredentialStore({
  clock = () => new Date(),
  databasePath,
}: {
  clock?: () => Date;
  databasePath: string;
}): MachineCredentialStore {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS factory_machine_credentials (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      project_ids TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT NULL,
      last_used_at TEXT NULL
    )
  `);
  migrateCredentialSchema(database);

  return {
    create({
      machineId,
      projectIds,
      role = "coding",
      reviewerName,
      allProjects = false,
    }) {
      if (
        typeof machineId !== "string" ||
        !MACHINE_ID_PATTERN.test(machineId)
      ) {
        throw new Error("Machine ID must match /^[a-z0-9][a-z0-9-]{1,62}$/.");
      }
      if (role !== "coding" && role !== "reviewer") {
        throw new Error("Machine credential role must be coding or reviewer.");
      }
      if (!Array.isArray(projectIds)) {
        throw new Error("Machine credentials require a Project ID array.");
      }
      const normalizedReviewerName = reviewerName?.trim();
      if (role === "reviewer" && !normalizedReviewerName) {
        throw new Error("Reviewer credentials require a reviewer name.");
      }
      if (allProjects && role !== "reviewer") {
        throw new Error("Only reviewer credentials can access all Projects.");
      }
      const normalizedProjectIds = [...new Set(projectIds)];
      if (
        (!allProjects && normalizedProjectIds.length === 0) ||
        normalizedProjectIds.some(
          (projectId) => typeof projectId !== "string" || !projectId.trim(),
        )
      ) {
        throw new Error("Machine credentials require at least one Project ID.");
      }

      const token = `${MACHINE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const id = randomUUID();
      const createdAt = clock().toISOString();
      // Rotation: a revoked credential must not block re-issuing the same
      // machine ID. Active credentials stay unique per machine.
      database
        .query(
          `DELETE FROM factory_machine_credentials
            WHERE machine_id = $machineId AND revoked_at IS NOT NULL`,
        )
        .run({ $machineId: machineId });
      database
        .query(
          `INSERT INTO factory_machine_credentials
            (id, machine_id, token_hash, project_ids, created_at, revoked_at, last_used_at,
             role, reviewer_name, all_projects)
           VALUES ($id, $machineId, $tokenHash, $projectIds, $createdAt, NULL, NULL,
                   $role, $reviewerName, $allProjects)`,
        )
        .run({
          $createdAt: createdAt,
          $id: id,
          $machineId: machineId,
          $projectIds: JSON.stringify(normalizedProjectIds),
          $tokenHash: hashToken(token),
          $role: role,
          $reviewerName: normalizedReviewerName ?? null,
          $allProjects: allProjects ? 1 : 0,
        });

      return {
        id,
        machineId,
        projectIds: normalizedProjectIds,
        allProjects,
        role,
        ...(normalizedReviewerName
          ? { reviewerName: normalizedReviewerName }
          : {}),
        token,
      };
    },

    authenticate(token) {
      if (!token) return null;
      const row = database
        .query(
          `SELECT id, machine_id AS machineId, project_ids AS projectIds,
                  last_used_at AS lastUsedAt, role, reviewer_name AS reviewerName,
                  all_projects AS allProjects
             FROM factory_machine_credentials
            WHERE token_hash = $tokenHash AND revoked_at IS NULL`,
        )
        .get({ $tokenHash: hashToken(token) }) as {
        id: string;
        machineId: string;
        projectIds: string;
        lastUsedAt: string | null;
        role: string;
        reviewerName: string | null;
        allProjects: number;
      } | null;
      if (!row) return null;

      const now = clock();
      const lastUsedAt = row.lastUsedAt ? Date.parse(row.lastUsedAt) : NaN;
      if (
        !Number.isFinite(lastUsedAt) ||
        now.getTime() - lastUsedAt >= LAST_USED_UPDATE_INTERVAL_MS
      ) {
        database
          .query(
            `UPDATE factory_machine_credentials
                SET last_used_at = $lastUsedAt
              WHERE id = $id AND revoked_at IS NULL`,
          )
          .run({ $id: row.id, $lastUsedAt: now.toISOString() });
      }

      return {
        id: row.id,
        machineId: row.machineId,
        projectIds: parseProjectIds(row.projectIds),
        allProjects: row.allProjects === 1,
        role: parseRole(row.role),
        ...(row.reviewerName ? { reviewerName: row.reviewerName } : {}),
      };
    },

    getActiveById(credentialId) {
      const row = database
        .query(
          `SELECT id, machine_id AS machineId, project_ids AS projectIds,
                role, reviewer_name AS reviewerName, all_projects AS allProjects
           FROM factory_machine_credentials
          WHERE id = $id AND revoked_at IS NULL`,
        )
        .get({ $id: credentialId }) as {
        id: string;
        machineId: string;
        projectIds: string;
        role: string;
        reviewerName: string | null;
        allProjects: number;
      } | null;
      if (!row) return null;
      return {
        id: row.id,
        machineId: row.machineId,
        projectIds: parseProjectIds(row.projectIds),
        allProjects: row.allProjects === 1,
        role: parseRole(row.role),
        ...(row.reviewerName ? { reviewerName: row.reviewerName } : {}),
      };
    },

    revoke(machineId) {
      database
        .query(
          `UPDATE factory_machine_credentials
              SET revoked_at = $revokedAt
            WHERE machine_id = $machineId AND revoked_at IS NULL`,
        )
        .run({ $machineId: machineId, $revokedAt: clock().toISOString() });
    },

    list() {
      const rows = database
        .query(
          `SELECT id, machine_id AS machineId, project_ids AS projectIds,
                  created_at AS createdAt, revoked_at AS revokedAt,
                  last_used_at AS lastUsedAt, role, reviewer_name AS reviewerName,
                  all_projects AS allProjects
             FROM factory_machine_credentials
            ORDER BY created_at, id`,
        )
        .all() as Array<{
        id: string;
        machineId: string;
        projectIds: string;
        createdAt: string;
        revokedAt: string | null;
        lastUsedAt: string | null;
        role: string;
        reviewerName: string | null;
        allProjects: number;
      }>;
      return rows.map((row) => ({
        id: row.id,
        machineId: row.machineId,
        projectIds: parseProjectIds(row.projectIds),
        allProjects: row.allProjects === 1,
        role: parseRole(row.role),
        ...(row.reviewerName ? { reviewerName: row.reviewerName } : {}),
        createdAt: row.createdAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt,
      }));
    },

    close() {
      database.close();
    },
  };
}

export function resolveMachineToken(
  authorizationHeader: string | null | undefined,
): string | undefined {
  const match = /^Bearer\s+(fmc_[A-Za-z0-9_-]+)$/i.exec(
    authorizationHeader?.trim() ?? "",
  );
  return match?.[1];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseProjectIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((projectId) => typeof projectId === "string")
  ) {
    throw new Error("Stored machine credential Project IDs are invalid.");
  }
  return [...parsed];
}

function migrateCredentialSchema(database: Database): void {
  const columns = new Set(
    (
      database
        .query("PRAGMA table_info(factory_machine_credentials)")
        .all() as Array<{ name: string }>
    ).map(({ name }) => name),
  );
  if (!columns.has("role")) {
    database.exec(
      "ALTER TABLE factory_machine_credentials ADD COLUMN role TEXT NOT NULL DEFAULT 'coding'",
    );
  }
  if (!columns.has("reviewer_name")) {
    database.exec(
      "ALTER TABLE factory_machine_credentials ADD COLUMN reviewer_name TEXT NULL",
    );
  }
  if (!columns.has("all_projects")) {
    database.exec(
      "ALTER TABLE factory_machine_credentials ADD COLUMN all_projects INTEGER NOT NULL DEFAULT 0",
    );
  }
}

function parseRole(value: string): MachineCredentialRole {
  if (value === "coding" || value === "reviewer") return value;
  throw new Error("Stored machine credential role is invalid.");
}
