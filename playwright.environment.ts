import path from "node:path";

export const DEFAULT_E2E_DATABASE_URL = "file:/private/tmp/wfm-task10-playwright.db";

type E2eDatabaseEnvironment = Record<string, string | undefined>;

export function resolveE2eDatabaseUrl(
  environment: E2eDatabaseEnvironment = process.env,
): string {
  const databaseUrl = environment.WFM_E2E_DATABASE_URL?.trim() || DEFAULT_E2E_DATABASE_URL;
  const sqlitePath = databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : "";
  const normalizedPath = path.posix.normalize(sqlitePath);

  const isSafe =
    sqlitePath.length > 0
    && path.posix.isAbsolute(sqlitePath)
    && sqlitePath.startsWith("/private/tmp/")
    && normalizedPath === sqlitePath
    && path.posix.extname(sqlitePath) === ".db";

  if (!isSafe) {
    throw new Error(
      "WFM_E2E_DATABASE_URL must be an absolute file:/private/tmp/*.db SQLite URL without traversal or query parameters",
    );
  }

  return `file:${normalizedPath}`;
}
