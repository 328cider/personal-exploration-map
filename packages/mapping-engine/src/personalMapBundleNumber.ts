import {
  encodePersonalMapBundleNumber,
  type PersonalMapBundleNumber,
} from "./personalMapBundle.ts";

export class PersonalMapBundleNumberDecodeError extends Error {
  readonly token: string;

  constructor(token: string) {
    super(`Invalid or non-canonical PersonalMap bundle number token: ${token}`);
    this.name = "PersonalMapBundleNumberDecodeError";
    this.token = token;
  }
}

/**
 * Restores the exact JavaScript number encoded by
 * `ecmascript-number-string-v1`.
 *
 * Finite tokens must be the canonical `String(number)` representation emitted
 * by the encoder. Alternate spellings such as `1.0`, `01`, lowercase infinity,
 * or whitespace are rejected so manifests and raw evidence have one stable
 * representation for hashing and comparison.
 */
export function decodePersonalMapBundleNumber(
  token: PersonalMapBundleNumber,
): number {
  switch (token) {
    case "NaN":
      return Number.NaN;
    case "+Infinity":
      return Number.POSITIVE_INFINITY;
    case "-Infinity":
      return Number.NEGATIVE_INFINITY;
    case "-0":
      return -0;
    default: {
      if (token.length === 0 || token.trim() !== token) {
        throw new PersonalMapBundleNumberDecodeError(token);
      }
      const value = Number(token);
      if (
        !Number.isFinite(value) ||
        encodePersonalMapBundleNumber(value) !== token
      ) {
        throw new PersonalMapBundleNumberDecodeError(token);
      }
      return value;
    }
  }
}
