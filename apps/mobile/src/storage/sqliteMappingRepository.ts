import { createSqliteMappingRepository } from "@exploration-map/sqlite-adapter";

import { getMappingDatabase } from "./database";

/**
 * Canonical local repository used by the headless mapping engine.
 *
 * Legacy screen-oriented repository functions remain temporarily during the
 * migration, but new canonical writes must use this port and mapping-engine.
 */
export const sqliteMappingRepository = createSqliteMappingRepository(
  getMappingDatabase,
);
