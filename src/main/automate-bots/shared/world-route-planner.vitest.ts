import { describe, expect, it } from "vitest";
import { deriveWorldTile } from "../mapping/world-coordinate";
import { buildWorldRouteAgilityContext } from "./world-route-agility-shortcuts";
import {
  buildWorldRouteRectanglePerimeterTiles,
  getWorldTileDistanceToRectangle,
  planWorldRouteToTiles,
  rebaseWorldRoutePlanFromTile,
  type WorldRouteRectangle,
} from "./world-route-planner";

function getRouteRegionSequence(pathTiles: readonly { regionX: number; regionY: number }[]): string[] {
  const sequence: string[] = [];
  for (const tile of pathTiles) {
    const regionKey = `${tile.regionX},${tile.regionY}`;
    if (sequence[sequence.length - 1] !== regionKey) {
      sequence.push(regionKey);
    }
  }

  return sequence;
}

describe("world route planner", () => {
  it("routes from the Arceuus dark altar area to the blood altar across the multi-region corridor", () => {
    const playerTile = deriveWorldTile(1714, 3884, 0);
    const bloodAltarRectangle: WorldRouteRectangle = {
      x: 1715,
      y: 3828,
      z: 0,
      width: 4,
      height: 4,
    };
    const bloodAltarClickTile = { x: 1717, y: 3830, z: 0 };
    const bloodAltarTargetTiles = buildWorldRouteRectanglePerimeterTiles(bloodAltarRectangle, 3);
    const routeContext = buildWorldRouteAgilityContext({ agilityLevel: 59 });

    const route = planWorldRouteToTiles(playerTile, {
      destinationLabel: "Arceuus blood altar",
      destinationTile: bloodAltarClickTile,
      targetTiles: bloodAltarTargetTiles,
      blockedTiles: routeContext.blockedShortcutTiles,
      links: routeContext.routeLinks,
      waypointStepLimit: 24,
    });

    expect(route.status).toBe("ready");
    expect(route.targetTile).toBeDefined();
    expect(route.pathLength).toBeGreaterThan(0);
    expect(getWorldTileDistanceToRectangle(route.targetTile!, bloodAltarRectangle)).toBeLessThanOrEqual(3);

    expect(getRouteRegionSequence(route.pathTiles)).toEqual(["26,60", "25,60", "26,60", "27,60", "27,59", "26,59"]);
  });

  it("rebases an existing route when the player is still on its planned path", () => {
    const playerTile = deriveWorldTile(1714, 3884, 0);
    const bloodAltarRectangle: WorldRouteRectangle = {
      x: 1715,
      y: 3828,
      z: 0,
      width: 4,
      height: 4,
    };
    const bloodAltarClickTile = { x: 1717, y: 3830, z: 0 };
    const bloodAltarTargetTiles = buildWorldRouteRectanglePerimeterTiles(bloodAltarRectangle, 3);
    const routeContext = buildWorldRouteAgilityContext({ agilityLevel: 59 });

    const route = planWorldRouteToTiles(playerTile, {
      destinationLabel: "Arceuus blood altar",
      destinationTile: bloodAltarClickTile,
      targetTiles: bloodAltarTargetTiles,
      blockedTiles: routeContext.blockedShortcutTiles,
      links: routeContext.routeLinks,
      waypointStepLimit: 24,
    });
    const newPlayerTile = route.pathTiles[10];

    const rebasedRoute = rebaseWorldRoutePlanFromTile(route, newPlayerTile, { waypointStepLimit: 24 });

    expect(rebasedRoute).not.toBeNull();
    expect(rebasedRoute!.status).toBe("ready");
    expect(rebasedRoute!.playerTile).toEqual(newPlayerTile);
    expect(rebasedRoute!.pathLength).toBe(route.pathLength - 10);
    expect(rebasedRoute!.pathTiles[0]).toEqual(newPlayerTile);
    expect(rebasedRoute!.targetTile).toEqual(route.targetTile);
  });

  it("routes from the blood altar area back to the dense runestones with the expanded region planner", () => {
    const playerTile = deriveWorldTile(1718, 3832, 0);
    const runestoneRectangles: WorldRouteRectangle[] = [
      { x: 1762, y: 3856, z: 0, width: 5, height: 5 },
      { x: 1762, y: 3844, z: 0, width: 5, height: 5 },
    ];
    const routeContext = buildWorldRouteAgilityContext({ agilityLevel: 59 });
    const targetTiles = runestoneRectangles.flatMap((rectangle) => buildWorldRouteRectanglePerimeterTiles(rectangle, 1));

    const route = planWorldRouteToTiles(playerTile, {
      destinationLabel: "Arceuus dense runestone mining objects",
      destinationTile: { x: 1764, y: 3858, z: 0 },
      targetTiles,
      blockedTiles: routeContext.blockedShortcutTiles,
      links: routeContext.routeLinks,
      waypointStepLimit: 24,
    });

    expect(route.status).toBe("ready");
    expect(route.targetTile).toBeDefined();
    expect(route.pathLength).toBeGreaterThan(0);
    expect(
      runestoneRectangles.some((rectangle) => getWorldTileDistanceToRectangle(route.targetTile!, rectangle) <= 1),
    ).toBe(true);
  });
});
