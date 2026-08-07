import type { MappingEvent } from "./events.ts";
import type { MapSnapshot } from "./model.ts";

export type OverlayPrimitive =
  | {
      readonly kind: "point";
      readonly xMeters: number;
      readonly yMeters: number;
      readonly label?: string;
    }
  | {
      readonly kind: "polyline";
      readonly points: readonly {
        readonly xMeters: number;
        readonly yMeters: number;
      }[];
      readonly label?: string;
    }
  | {
      readonly kind: "area";
      readonly points: readonly {
        readonly xMeters: number;
        readonly yMeters: number;
      }[];
      readonly label?: string;
    };

export interface DerivedOverlay {
  readonly extensionId: string;
  readonly layerId: string;
  readonly primitives: readonly OverlayPrimitive[];
}

export interface MappingExtension {
  readonly id: string;
  onEvent(
    event: MappingEvent,
    map: Readonly<MapSnapshot>,
  ): readonly DerivedOverlay[];
}
