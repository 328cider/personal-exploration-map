import type {
  MappingEvent,
  PersonalMapSnapshot,
} from "@exploration-map/mapping-core";

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
  readonly experienceId: string;
  readonly layerId: string;
  readonly primitives: readonly OverlayPrimitive[];
}

export type ExperienceCue =
  | {
      readonly kind: "toast";
      readonly key: string;
      readonly message: string;
    }
  | {
      readonly kind: "badge";
      readonly key: string;
      readonly title: string;
      readonly description?: string;
    }
  | {
      readonly kind: "story";
      readonly key: string;
      readonly title?: string;
      readonly body: string;
    };

export interface MappingExperienceInput<State> {
  readonly event: Readonly<MappingEvent>;
  readonly map: Readonly<PersonalMapSnapshot>;
  readonly state: Readonly<State>;
}

export interface MappingExperienceOutput<State> {
  readonly state: State;
  readonly overlays: readonly DerivedOverlay[];
  readonly cues?: readonly ExperienceCue[];
}

/**
 * A mapping experience observes the canonical personal map and produces only
 * separate experience state, visual overlays, and optional presentation cues.
 * It has no command channel for changing raw observations or derived map truth.
 */
export interface MappingExperience<State> {
  readonly id: string;
  readonly version: string;
  createInitialState(): State;
  onMappingEvent(
    input: MappingExperienceInput<State>,
  ): MappingExperienceOutput<State>;
}
