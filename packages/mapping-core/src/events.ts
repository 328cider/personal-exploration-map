import type { MapMarker, RawPositionSample, RejectionReason } from "./model.ts";

export type MappingEvent =
  | {
      readonly type: "exploration.started";
      readonly explorationId: string;
      readonly occurredAtMs: number;
    }
  | {
      readonly type: "position.accepted";
      readonly explorationId: string;
      readonly occurredAtMs: number;
      readonly sample: RawPositionSample;
    }
  | {
      readonly type: "position.rejected";
      readonly explorationId: string;
      readonly occurredAtMs: number;
      readonly sample: RawPositionSample;
      readonly reason: RejectionReason;
    }
  | {
      readonly type: "marker.added";
      readonly explorationId: string;
      readonly occurredAtMs: number;
      readonly marker: MapMarker;
    }
  | {
      readonly type: "exploration.ended";
      readonly explorationId: string;
      readonly occurredAtMs: number;
    };

export interface MappingMutation {
  readonly events: readonly MappingEvent[];
}
