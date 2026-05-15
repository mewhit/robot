import { describe, expect, it } from "vitest";
import { findOsrsCacheDirectory } from "../cache/cache-store";
import { readOsrsCacheMapRegionView } from "../cache/cache-map-view";
import { CollisionFlag } from "../cache/region-collision";
import { deriveWorldTile, type WorldTile } from "../mapping/world-coordinate";
import {
  SECTION_ONE_X_MARKS_THE_SPOT_START_LABEL,
  planEndToEndGeneralStoreRoute,
  planEndToEndXMarksTheSpotStartRoute,
} from "./section-one-navigation";

function hasTransition(
  path: Array<Pick<WorldTile, "x" | "y" | "z">>,
  a: Pick<WorldTile, "x" | "y" | "z">,
  b: Pick<WorldTile, "x" | "y" | "z">,
): boolean {
  return path.some((tile, index) => {
    const next = path[index + 1];
    if (!next) {
      return false;
    }

    return (
      (tile.x === a.x && tile.y === a.y && tile.z === a.z && next.x === b.x && next.y === b.y && next.z === b.z) ||
      (tile.x === b.x && tile.y === b.y && tile.z === b.z && next.x === a.x && next.y === a.y && next.z === a.z)
    );
  });
}

describe("End To End section one navigation", () => {
  it.runIf(Boolean(findOsrsCacheDirectory()))("does not route through the Lumbridge bridge fence", () => {
    const region = readOsrsCacheMapRegionView({ regionX: 50, regionY: 50 });
    const southTile = region.tiles.find((tile) => tile.worldX === 3252 && tile.worldY === 3224 && tile.z === 0);
    const northTile = region.tiles.find((tile) => tile.worldX === 3252 && tile.worldY === 3225 && tile.z === 0);

    expect(southTile?.flags ?? 0).toSatisfy((flags: number) => (flags & CollisionFlag.North) !== 0);
    expect(northTile?.flags ?? 0).toSatisfy((flags: number) => (flags & CollisionFlag.South) !== 0);

    const route = planEndToEndGeneralStoreRoute(deriveWorldTile(3265, 3230, 0));

    expect(route.status).toBe("ready");
    expect(
      hasTransition(
        route.pathTiles,
        { x: 3252, y: 3224, z: 0 },
        { x: 3252, y: 3225, z: 0 },
      ),
    ).toBe(false);
  });

  it.runIf(Boolean(findOsrsCacheDirectory()))("routes to the X Marks the Spot quest start near the Lumbridge pub", () => {
    const route = planEndToEndXMarksTheSpotStartRoute(deriveWorldTile(3212, 3246, 0));

    expect(route.status).toBe("ready");
    expect(route.destinationLabel).toBe(SECTION_ONE_X_MARKS_THE_SPOT_START_LABEL);
    expect(route.destinationTile).toEqual({ x: 3227, y: 3242, z: 0 });
    expect(route.targetTile).toBeDefined();
    expect(route.targetTile ? Math.max(Math.abs(route.targetTile.x - 3227), Math.abs(route.targetTile.y - 3242)) : 99).toBeLessThanOrEqual(2);
    expect(route.pathLength).toBeGreaterThan(0);
  });
});
