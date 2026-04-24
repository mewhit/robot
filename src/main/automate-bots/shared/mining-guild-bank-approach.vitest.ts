import { describe, expect, it } from "vitest";
import {
  isTileWithinBounds,
  planBankApproachLocalPoint,
  TileBounds,
  trackStableTileRead,
} from "./mining-guild-bank-approach";

const BANK_TILE_BOUNDS: TileBounds = {
  minX: 2981,
  maxX: 3069,
  minY: 9688,
  maxY: 9744,
  z: 0,
};

describe("mining-guild-bank-approach", () => {
  it("rejects OCR tiles outside the mining guild banking corridor", () => {
    expect(isTileWithinBounds({ x: 3045, y: 9716, z: 0 }, BANK_TILE_BOUNDS)).toBe(true);
    expect(isTileWithinBounds({ x: 3052, y: 9717, z: 0 }, BANK_TILE_BOUNDS)).toBe(true);
    expect(isTileWithinBounds({ x: 4090, y: 9423, z: 0 }, BANK_TILE_BOUNDS)).toBe(false);
    expect(isTileWithinBounds({ x: 1070, y: 9719, z: 1 }, BANK_TILE_BOUNDS)).toBe(false);
    expect(isTileWithinBounds({ x: 1050, y: 4019, z: 0 }, BANK_TILE_BOUNDS)).toBe(false);
  });

  it("requires repeated plausible tiles before they become stable", () => {
    let tracked = trackStableTileRead({ tile: null, stableReadCount: 0 }, { x: 3045, y: 9716, z: 0 }, BANK_TILE_BOUNDS);
    expect(tracked.tile).toEqual({ x: 3045, y: 9716, z: 0 });
    expect(tracked.stableReadCount).toBe(1);

    tracked = trackStableTileRead(tracked, { x: 3045, y: 9716, z: 0 }, BANK_TILE_BOUNDS);
    expect(tracked.tile).toEqual({ x: 3045, y: 9716, z: 0 });
    expect(tracked.stableReadCount).toBe(2);

    tracked = trackStableTileRead(tracked, { x: 4090, y: 9423, z: 0 }, BANK_TILE_BOUNDS);
    expect(tracked.tile).toBeNull();
    expect(tracked.stableReadCount).toBe(0);
  });

  it("maps world-x east to screen-right and world-x west to screen-left while facing north", () => {
    const eastPlan = planBankApproachLocalPoint({
      captureSize: { width: 1200, height: 900 },
      anchor: { x: 600, y: 450 },
      tilePx: 64,
      targetTile: { x: 3013, y: 9720, z: 0 },
      playerTile: { x: 3008, y: 9720, z: 0 },
      arrivalRadiusTiles: 1,
      maxClickDistanceTiles: 9,
      edgeMarginPx: 24,
    });
    expect(eastPlan).not.toBeNull();
    expect(eastPlan?.point.x).toBeGreaterThan(600);
    expect(eastPlan?.point.y).toBe(450);

    const westPlan = planBankApproachLocalPoint({
      captureSize: { width: 1200, height: 900 },
      anchor: { x: 600, y: 450 },
      tilePx: 64,
      targetTile: { x: 3013, y: 9720, z: 0 },
      playerTile: { x: 3018, y: 9720, z: 0 },
      arrivalRadiusTiles: 1,
      maxClickDistanceTiles: 9,
      edgeMarginPx: 24,
    });
    expect(westPlan).not.toBeNull();
    expect(westPlan?.point.x).toBeLessThan(600);
    expect(westPlan?.point.y).toBe(450);
  });
});
