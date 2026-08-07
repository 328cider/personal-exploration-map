import assert from "node:assert/strict";
import test from "node:test";

import {
  createMapSnapshot,
  createExplorationSession,
  type MappingExtension,
} from "../src/index.ts";

test("an experience extension returns derived overlays without owning map data", () => {
  const started = createExplorationSession({
    id: "extension-test",
    name: "extension",
    startedAtMs: 1_000,
  });
  const snapshot = createMapSnapshot(started.session);

  const extension: MappingExtension = {
    id: "example-fog",
    onEvent(event, map) {
      assert.equal(map.explorationId, "extension-test");
      return [
        {
          extensionId: "example-fog",
          layerId: event.type,
          primitives: [],
        },
      ];
    },
  };

  const overlays = extension.onEvent(started.events[0]!, snapshot);
  assert.equal(overlays[0]?.extensionId, "example-fog");
  assert.equal(snapshot.stats.rawSampleCount, 0);
});
