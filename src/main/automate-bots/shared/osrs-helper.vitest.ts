import { describe, expect, it } from "vitest";
import { estimateTilePxFromPlayerBox } from "./osrs-helper";

const TILE_OPTIONS = {
  fallbackTilePx: 64,
  minTilePx: 24,
  maxTilePx: 96,
};

describe("estimateTilePxFromPlayerBox", () => {
  it("uses the fallback when no player tile is detected", () => {
    expect(estimateTilePxFromPlayerBox(null, TILE_OPTIONS)).toBe(64);
  });

  it("keeps outline-style player tiles based on their bounds", () => {
    expect(
      estimateTilePxFromPlayerBox(
        {
          centerX: 1121,
          centerY: 804,
          width: 65,
          height: 64,
          pixelCount: 481,
          fillRatio: 0.116,
        },
        TILE_OPTIONS,
      ),
    ).toBe(65);
  });

  it("uses highlighted pixel area for filled player tiles", () => {
    expect(
      estimateTilePxFromPlayerBox(
        {
          centerX: 500,
          centerY: 500,
          width: 82,
          height: 74,
          pixelCount: 3600,
          fillRatio: 0.593,
        },
        TILE_OPTIONS,
      ),
    ).toBe(60);
  });
});
