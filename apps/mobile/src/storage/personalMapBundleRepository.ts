import { createSqlitePersonalMapBundleReadRepository } from "@exploration-map/sqlite-adapter";

import { getMappingDatabase } from "./database";

/**
 * Read-only, exact-evidence source for future app-private PersonalMap backups.
 *
 * It is deliberately not exposed through the current S0 UI. The platform file
 * writer can consume this boundary later without reimplementing bundle content
 * or reading normalized SQLite columns directly.
 */
export const personalMapBundleReadRepository =
  createSqlitePersonalMapBundleReadRepository(getMappingDatabase);
