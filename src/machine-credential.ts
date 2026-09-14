import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Database } from "bun:sqlite";

const MACHINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const MACHINE_TOKEN_PREFIX = "fmc_";
const LAST_USED_UPDATE_INTERVAL_MS = 60_000;

export type MachineCredentialIdentity = {
  id: string;
  machineId: string;
  projectIds: string[];
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
  }) => MachineCredentialIdentity & { token: string };
  authenticate: (token: string | undefined) => MachineCredentialIdentity | null;
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

  return {
    create({ machineId, projectIds }) {
      if (
        typeof machineId !== "string" ||
        !MACHINE_ID_PATTERN.test(machineId)
      ) {
        throw new Error("Machine ID must match /^[a-z0-9][a-z0-9-]{1,62}$/.");
      }
      if (!Array.isArray(projectIds)) {
        throw new Error("Machine credentials require a Project ID array.");
      }
      const normalizedProjectIds = [...projectIds];
      if (
        normalizedProjectIds.length === 0 ||
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
            (id, machine_id, token_hash, project_ids, created_at, revoked_at, last_used_at)
           VALUES ($id, $machineId, $tokenHash, $projectIds, $createdAt, NULL, NULL)`,
        )
        .run({
          $createdAt: createdAt,
          $id: id,
          $machineId: machineId,
          $projectIds: JSON.stringify(normalizedProjectIds),
          $tokenHash: hashToken(token),
        });

      return {
        id,
        machineId,
        projectIds: normalizedProjectIds,
        token,
      };
    },

    authenticate(token) {
      if (!token) return null;
      const row = database
        .query(
          `SELECT id, machine_id AS machineId, project_ids AS projectIds,
                  last_used_at AS lastUsedAt
             FROM factory_machine_credentials
            WHERE token_hash = $tokenHash AND revoked_at IS NULL`,
        )
        .get({ $tokenHash: hashToken(token) }) as {
        id: string;
        machineId: string;
        projectIds: string;
        lastUsedAt: string | null;
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
                  created_at AS createdAt,
                  revoked_at AS revokedAt, last_used_at AS lastUsedAt
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
      }>;
      return rows.map((row) => ({
        ...row,
        projectIds: parseProjectIds(row.projectIds),
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
