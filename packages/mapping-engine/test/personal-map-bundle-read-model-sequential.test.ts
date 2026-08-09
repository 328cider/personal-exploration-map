import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPersonalMapBundleExportInput,
  type PersonalMapBundleReadRepositoryPort,
  type PersonalMapBundleReadSnapshotPort,
} from "../src/index.ts";

class NonConcurrentSnapshot
  implements
    PersonalMapBundleReadRepositoryPort,
    PersonalMapBundleReadSnapshotPort
{
  readonly sequence: string[] = [];
  private queryActive = false;

  async withConsistentRead<Result>(
    operation: (
      reader: PersonalMapBundleReadSnapshotPort,
    ) => Promise<Result>,
  ): Promise<Result> {
    this.sequence.push("snapshot:start");
    try {
      return await operation(this);
    } finally {
      this.sequence.push("snapshot:end");
    }
  }

  private async query<Result>(name: string, value: Result): Promise<Result> {
    assert.equal(
      this.queryActive,
      false,
      `${name} overlapped another native read`,
    );
    this.queryActive = true;
    this.sequence.push(`${name}:start`);
    try {
      await Promise.resolve();
      this.sequence.push(`${name}:end`);
      return value;
    } finally {
      this.queryActive = false;
    }
  }

  loadPersonalMapRecord() {
    return this.query("map", {
      id: "map-1",
      name: "Map",
      createdAtMs: 1_000,
      updatedAtMs: 1_000,
    });
  }

  loadFrameAtExport() {
    return this.query("frame", { kind: "unresolved" } as const);
  }

  listExplorationRecords() {
    return this.query("explorations", []);
  }

  loadRawSampleGroups() {
    return this.query("raw", []);
  }

  loadMarkerGroups() {
    return this.query("markers", []);
  }
}

test("all native reads are sequential inside one consistent snapshot", async () => {
  const repository = new NonConcurrentSnapshot();
  const result = await loadPersonalMapBundleExportInput(repository, {
    personalMapId: "map-1",
  });

  assert.deepEqual(result.explorations, []);
  assert.deepEqual(repository.sequence, [
    "snapshot:start",
    "map:start",
    "map:end",
    "frame:start",
    "frame:end",
    "explorations:start",
    "explorations:end",
    "raw:start",
    "raw:end",
    "markers:start",
    "markers:end",
    "snapshot:end",
  ]);
});
