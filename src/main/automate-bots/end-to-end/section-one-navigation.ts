import { readOsrsCacheMapRegionView } from "../cache/cache-map-view";
import { CollisionFlag, getRegionCollisionFlags, type OsrsRegionCollision } from "../cache/region-collision";
import { loadOsrsRegionCollisionFromCache } from "../cache/osrs-region-cache";
import { deriveWorldTile, type WorldTile } from "../mapping/world-coordinate";

export const SECTION_ONE_GENERAL_STORE_LABEL = "General store";
export const SECTION_ONE_X_MARKS_THE_SPOT_START_LABEL = "X Marks the Spot quest start";
const SECTION_ONE_DESTINATION_SEARCH_RADIUS_TILES = 2;
const SECTION_ONE_WAYPOINT_STEP_LIMIT = 14;
const LUMBRIDGE_SECTION_ONE_REGION = { regionX: 50, regionY: 50 };
const LUMBRIDGE_GENERAL_STORE_FALLBACK_TILE = { x: 3212, y: 3246, z: 0 };
const LUMBRIDGE_X_MARKS_THE_SPOT_START_FALLBACK_TILE = { x: 3227, y: 3242, z: 0 };
const SECTION_ONE_MAX_CROSS_REGION_COUNT = 16;

export type EndToEndGeneralStoreRoutePlan = {
  status: "ready" | "already-there" | "unavailable";
  reason?: string;
  playerTile: Pick<WorldTile, "x" | "y" | "z">;
  destinationLabel: string;
  destinationTile?: Pick<WorldTile, "x" | "y" | "z">;
  storeTile?: Pick<WorldTile, "x" | "y" | "z">;
  targetTile?: Pick<WorldTile, "x" | "y" | "z">;
  nextWaypoint?: Pick<WorldTile, "x" | "y" | "z">;
  targetMode: "general-store" | "x-marks-the-spot-start" | "lumbridge-cross-region";
  pathTiles: Array<Pick<WorldTile, "x" | "y" | "z">>;
  directDistanceToStoreTiles: number;
  directDistanceToTargetTiles: number;
  nextWaypointPathLength: number;
  pathLength: number;
};

type WorldCollisionGrid = {
  collisions: Map<string, OsrsRegionCollision>;
  minRegionX: number;
  maxRegionX: number;
  minRegionY: number;
  maxRegionY: number;
};

const CARDINALS = [
  { dx: 0, dy: 1, fromFlag: CollisionFlag.North, toFlag: CollisionFlag.South },
  { dx: 1, dy: 0, fromFlag: CollisionFlag.East, toFlag: CollisionFlag.West },
  { dx: 0, dy: -1, fromFlag: CollisionFlag.South, toFlag: CollisionFlag.North },
  { dx: -1, dy: 0, fromFlag: CollisionFlag.West, toFlag: CollisionFlag.East },
] as const;

const DIRECTIONS = [
  ...CARDINALS.map(({ dx, dy }) => ({ dx, dy })),
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
] as const;

function formatTile(tile: Pick<WorldTile, "x" | "y" | "z"> | undefined): string {
  return tile ? `${tile.x},${tile.y},${tile.z}` : "n/a";
}

function isSameTile(
  a: Pick<WorldTile, "x" | "y" | "z"> | undefined,
  b: Pick<WorldTile, "x" | "y" | "z"> | undefined,
): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
}

function formatPathTile(
  tile: Pick<WorldTile, "x" | "y" | "z">,
  plan: EndToEndGeneralStoreRoutePlan,
  clickTile: Pick<WorldTile, "x" | "y" | "z"> | undefined,
): string {
  const labels: string[] = [];
  if (isSameTile(tile, plan.playerTile)) {
    labels.push("START");
  }
  if (isSameTile(tile, clickTile)) {
    labels.push("CLICK");
  }
  if (isSameTile(tile, plan.targetTile)) {
    labels.push("DEST");
  }

  const tileText = formatTile(tile);
  return labels.length > 0 ? `[${labels.join("+")}:${tileText}]` : tileText;
}

function chebyshevDistance(a: Pick<WorldTile, "x" | "y">, b: Pick<WorldTile, "x" | "y">): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function getRegionKey(regionX: number, regionY: number): string {
  return `${regionX},${regionY}`;
}

function getTileKey(tile: Pick<WorldTile, "x" | "y" | "z">): string {
  return `${tile.x},${tile.y},${tile.z}`;
}

function getRegionBoundsBetween(
  a: Pick<WorldTile, "regionX" | "regionY">,
  b: Pick<WorldTile, "x" | "y">,
): { minRegionX: number; maxRegionX: number; minRegionY: number; maxRegionY: number; count: number } {
  const targetRegionX = b.x >> 6;
  const targetRegionY = b.y >> 6;
  const minRegionX = Math.min(a.regionX, targetRegionX);
  const maxRegionX = Math.max(a.regionX, targetRegionX);
  const minRegionY = Math.min(a.regionY, targetRegionY);
  const maxRegionY = Math.max(a.regionY, targetRegionY);
  return {
    minRegionX,
    maxRegionX,
    minRegionY,
    maxRegionY,
    count: (maxRegionX - minRegionX + 1) * (maxRegionY - minRegionY + 1),
  };
}

function loadWorldCollisionGrid(
  bounds: Pick<WorldCollisionGrid, "minRegionX" | "maxRegionX" | "minRegionY" | "maxRegionY">,
  cacheDirectoryPath?: string,
): WorldCollisionGrid {
  const collisions = new Map<string, OsrsRegionCollision>();
  for (let regionX = bounds.minRegionX; regionX <= bounds.maxRegionX; regionX += 1) {
    for (let regionY = bounds.minRegionY; regionY <= bounds.maxRegionY; regionY += 1) {
      collisions.set(
        getRegionKey(regionX, regionY),
        loadOsrsRegionCollisionFromCache({
          regionX,
          regionY,
          cacheDirectoryPath,
        }),
      );
    }
  }

  return {
    ...bounds,
    collisions,
  };
}

function isWorldTileInGrid(grid: WorldCollisionGrid, x: number, y: number): boolean {
  const regionX = x >> 6;
  const regionY = y >> 6;
  return regionX >= grid.minRegionX && regionX <= grid.maxRegionX && regionY >= grid.minRegionY && regionY <= grid.maxRegionY;
}

function getWorldCollisionFlags(grid: WorldCollisionGrid, x: number, y: number, z: number): number {
  if (!isWorldTileInGrid(grid, x, y)) {
    return CollisionFlag.Blocked;
  }

  const regionX = x >> 6;
  const regionY = y >> 6;
  const collision = grid.collisions.get(getRegionKey(regionX, regionY));
  if (!collision) {
    return CollisionFlag.Blocked;
  }

  return getRegionCollisionFlags(collision, x & 63, y & 63, z);
}

function isWorldTileBlocked(grid: WorldCollisionGrid, x: number, y: number, z: number): boolean {
  return (getWorldCollisionFlags(grid, x, y, z) & CollisionFlag.Blocked) !== 0;
}

function canMoveWithinWorldGrid(
  grid: WorldCollisionGrid,
  x: number,
  y: number,
  z: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): boolean {
  const axisDistance = Math.abs(dx) + Math.abs(dy);
  if (axisDistance < 1 || axisDistance > 2) {
    return false;
  }

  const nextX = x + dx;
  const nextY = y + dy;
  if (!isWorldTileInGrid(grid, x, y) || !isWorldTileInGrid(grid, nextX, nextY)) {
    return false;
  }

  if (axisDistance === 2) {
    return (
      !isWorldTileBlocked(grid, nextX, nextY, z) &&
      canMoveWithinWorldGrid(grid, x, y, z, dx, 0) &&
      canMoveWithinWorldGrid(grid, x, y, z, 0, dy) &&
      canMoveWithinWorldGrid(grid, x + dx, y, z, 0, dy) &&
      canMoveWithinWorldGrid(grid, x, y + dy, z, dx, 0)
    );
  }

  const direction = CARDINALS.find((candidate) => candidate.dx === dx && candidate.dy === dy);
  if (!direction) {
    return false;
  }

  const fromFlags = getWorldCollisionFlags(grid, x, y, z);
  const toFlags = getWorldCollisionFlags(grid, nextX, nextY, z);
  return (fromFlags & direction.fromFlag) === 0 && (toFlags & (CollisionFlag.Blocked | direction.toFlag)) === 0;
}

function findWorldPath(
  grid: WorldCollisionGrid,
  start: Pick<WorldTile, "x" | "y" | "z">,
  targetTiles: Array<Pick<WorldTile, "x" | "y" | "z">>,
): WorldTile[] | null {
  const targetKeys = new Set(targetTiles.filter((tile) => tile.z === start.z).map(getTileKey));
  if (targetKeys.size === 0 || !isWorldTileInGrid(grid, start.x, start.y)) {
    return null;
  }

  const startKey = getTileKey(start);
  const queue = [startKey];
  const previous = new Map<string, string | null>([[startKey, null]]);
  let foundKey: string | null = null;

  for (let readIndex = 0; readIndex < queue.length; readIndex += 1) {
    const key = queue[readIndex];
    const [x, y, z] = key.split(",").map(Number);
    if (targetKeys.has(key)) {
      foundKey = key;
      break;
    }

    for (const direction of DIRECTIONS) {
      if (!canMoveWithinWorldGrid(grid, x, y, z, direction.dx, direction.dy)) {
        continue;
      }

      const nextKey = `${x + direction.dx},${y + direction.dy},${z}`;
      if (previous.has(nextKey)) {
        continue;
      }

      previous.set(nextKey, key);
      queue.push(nextKey);
    }
  }

  if (!foundKey) {
    return null;
  }

  const reversed: WorldTile[] = [];
  let cursor: string | null = foundKey;
  while (cursor) {
    const [x, y, z] = cursor.split(",").map(Number);
    reversed.push(deriveWorldTile(x, y, z));
    cursor = previous.get(cursor) ?? null;
  }

  return reversed.reverse();
}

function toIconTile(icon: { worldX: number; worldY: number; z: number }): Pick<WorldTile, "x" | "y" | "z"> {
  return { x: icon.worldX, y: icon.worldY, z: icon.z };
}

function resolveLumbridgeGeneralStoreTile(cacheDirectoryPath?: string): Pick<WorldTile, "x" | "y" | "z"> {
  try {
    const lumbridgeRegion = readOsrsCacheMapRegionView({
      ...LUMBRIDGE_SECTION_ONE_REGION,
      cacheDirectoryPath,
    });
    const lumbridgeIcon = lumbridgeRegion.icons.find((icon) => icon.z === 0 && icon.label === SECTION_ONE_GENERAL_STORE_LABEL);
    if (lumbridgeIcon) {
      return toIconTile(lumbridgeIcon);
    }
  } catch {
    // Fall through to the stable Lumbridge General Store tile.
  }

  return LUMBRIDGE_GENERAL_STORE_FALLBACK_TILE;
}

function resolveLumbridgeXMarksTheSpotStartTile(cacheDirectoryPath?: string): Pick<WorldTile, "x" | "y" | "z"> {
  try {
    const lumbridgeRegion = readOsrsCacheMapRegionView({
      ...LUMBRIDGE_SECTION_ONE_REGION,
      cacheDirectoryPath,
    });
    const pubIcon = lumbridgeRegion.icons.find((icon) => icon.z === 0 && icon.label === "Pub");
    const questStartIcons = lumbridgeRegion.icons.filter((icon) => icon.z === 0 && icon.label === "Quest start");
    const nearestQuestStartIcon = questStartIcons
      .map((icon) => ({
        icon,
        distance: pubIcon ? chebyshevDistance(toIconTile(icon), toIconTile(pubIcon)) : Number.POSITIVE_INFINITY,
        fallbackDistance: chebyshevDistance(toIconTile(icon), LUMBRIDGE_X_MARKS_THE_SPOT_START_FALLBACK_TILE),
      }))
      .sort((a, b) => a.distance - b.distance || a.fallbackDistance - b.fallbackDistance)[0]?.icon;

    if (nearestQuestStartIcon) {
      return toIconTile(nearestQuestStartIcon);
    }
  } catch {
    // Fall through to the stable X Marks the Spot quest start icon tile.
  }

  return LUMBRIDGE_X_MARKS_THE_SPOT_START_FALLBACK_TILE;
}

function candidateTargetTiles(
  destinationTile: Pick<WorldTile, "x" | "y" | "z">,
  searchRadiusTiles: number,
): Array<Pick<WorldTile, "x" | "y" | "z">> {
  const candidates: Array<Pick<WorldTile, "x" | "y" | "z"> & { distance: number }> = [];
  for (let dx = -searchRadiusTiles; dx <= searchRadiusTiles; dx += 1) {
    for (let dy = -searchRadiusTiles; dy <= searchRadiusTiles; dy += 1) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance === 0 || distance > searchRadiusTiles) {
        continue;
      }
      candidates.push({
        x: destinationTile.x + dx,
        y: destinationTile.y + dy,
        z: destinationTile.z,
        distance,
      });
    }
  }

  return candidates
    .sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
    .map(({ distance: _distance, ...tile }) => tile);
}

function planEndToEndSectionOneDestinationRoute(
  playerTile: WorldTile,
  destination: {
    label: string;
    tile: Pick<WorldTile, "x" | "y" | "z">;
    localTargetMode: Exclude<EndToEndGeneralStoreRoutePlan["targetMode"], "lumbridge-cross-region">;
    searchRadiusTiles: number;
  },
  cacheDirectoryPath?: string,
): EndToEndGeneralStoreRoutePlan {
  const destinationTile = destination.tile;
  if (destinationTile.z !== playerTile.z) {
    return {
      status: "unavailable",
      reason: `${destination.label} target is on plane ${destinationTile.z}, but player is on plane ${playerTile.z}`,
      playerTile,
      destinationLabel: destination.label,
      destinationTile,
      storeTile: destinationTile,
      targetMode: destination.localTargetMode,
      directDistanceToStoreTiles: 0,
      directDistanceToTargetTiles: 0,
      pathTiles: [],
      pathLength: 0,
      nextWaypointPathLength: 0,
    };
  }

  const directDistanceToStoreTiles = chebyshevDistance(playerTile, destinationTile);
  const targetMode =
    playerTile.regionX === (destinationTile.x >> 6) && playerTile.regionY === (destinationTile.y >> 6)
      ? destination.localTargetMode
      : "lumbridge-cross-region";
  const regionBounds = getRegionBoundsBetween(playerTile, destinationTile);
  if (regionBounds.count > SECTION_ONE_MAX_CROSS_REGION_COUNT) {
    return {
      status: "unavailable",
      reason: `${destination.label} at ${formatTile(destinationTile)} is ${regionBounds.count} region(s) away; cross-region planner limit is ${SECTION_ONE_MAX_CROSS_REGION_COUNT}`,
      playerTile,
      destinationLabel: destination.label,
      destinationTile,
      storeTile: destinationTile,
      targetMode,
      directDistanceToStoreTiles,
      directDistanceToTargetTiles: 0,
      pathTiles: [],
      nextWaypointPathLength: 0,
      pathLength: 0,
    };
  }

  const collisionGrid = loadWorldCollisionGrid(regionBounds, cacheDirectoryPath);

  for (const targetTile of candidateTargetTiles(destinationTile, destination.searchRadiusTiles)) {
    const path = findWorldPath(collisionGrid, playerTile, [targetTile]);
    if (!path) {
      continue;
    }

    if (path.length <= 1) {
      return {
        status: "already-there",
        playerTile,
        destinationLabel: destination.label,
        destinationTile,
        storeTile: destinationTile,
        targetTile,
        nextWaypoint: targetTile,
        targetMode,
        directDistanceToStoreTiles,
        directDistanceToTargetTiles: chebyshevDistance(playerTile, targetTile),
        pathTiles: path,
        nextWaypointPathLength: 0,
        pathLength: 0,
      };
    }

    const nextWaypointIndex = Math.min(path.length - 1, SECTION_ONE_WAYPOINT_STEP_LIMIT);
    const pathStepCount = Math.max(0, path.length - 1);
    return {
      status: "ready",
      playerTile,
      destinationLabel: destination.label,
      destinationTile,
      storeTile: destinationTile,
      targetTile,
      nextWaypoint: path[nextWaypointIndex],
      targetMode,
      directDistanceToStoreTiles,
      directDistanceToTargetTiles: chebyshevDistance(playerTile, targetTile),
      pathTiles: path,
      nextWaypointPathLength: nextWaypointIndex,
      pathLength: pathStepCount,
    };
  }

  return {
    status: "unavailable",
    reason: `No reachable tile found within ${destination.searchRadiusTiles} tile(s) of ${destination.label} at ${formatTile(destinationTile)} from region ${playerTile.regionX},${playerTile.regionY}`,
    playerTile,
    destinationLabel: destination.label,
    destinationTile,
    storeTile: destinationTile,
    targetMode,
    directDistanceToStoreTiles,
    directDistanceToTargetTiles: 0,
    pathTiles: [],
    nextWaypointPathLength: 0,
    pathLength: 0,
  };
}

export function planEndToEndGeneralStoreRoute(
  playerTile: WorldTile,
  cacheDirectoryPath?: string,
): EndToEndGeneralStoreRoutePlan {
  return planEndToEndSectionOneDestinationRoute(
    playerTile,
    {
      label: SECTION_ONE_GENERAL_STORE_LABEL,
      tile: resolveLumbridgeGeneralStoreTile(cacheDirectoryPath),
      localTargetMode: "general-store",
      searchRadiusTiles: SECTION_ONE_DESTINATION_SEARCH_RADIUS_TILES,
    },
    cacheDirectoryPath,
  );
}

export function planEndToEndXMarksTheSpotStartRoute(
  playerTile: WorldTile,
  cacheDirectoryPath?: string,
): EndToEndGeneralStoreRoutePlan {
  return planEndToEndSectionOneDestinationRoute(
    playerTile,
    {
      label: SECTION_ONE_X_MARKS_THE_SPOT_START_LABEL,
      tile: resolveLumbridgeXMarksTheSpotStartTile(cacheDirectoryPath),
      localTargetMode: "x-marks-the-spot-start",
      searchRadiusTiles: SECTION_ONE_DESTINATION_SEARCH_RADIUS_TILES,
    },
    cacheDirectoryPath,
  );
}

export function planEndToEndXMarksTheSpotDigTileRoute(
  playerTile: WorldTile,
  digTile: Pick<WorldTile, "x" | "y" | "z">,
  cacheDirectoryPath?: string,
): EndToEndGeneralStoreRoutePlan {
  return planEndToEndSectionOneDestinationRoute(
    playerTile,
    {
      label: "X Marks the Spot dig tile",
      tile: digTile,
      localTargetMode: "x-marks-the-spot-start",
      searchRadiusTiles: 0,
    },
    cacheDirectoryPath,
  );
}

export function formatEndToEndGeneralStoreRoutePlan(plan: EndToEndGeneralStoreRoutePlan): string {
  if (plan.status === "unavailable") {
    return `status=unavailable player=${formatTile(plan.playerTile)} reason='${plan.reason ?? "unknown"}'`;
  }

  return `status=${plan.status} player=${formatTile(plan.playerTile)} destination='${plan.destinationLabel}' anchor=${formatTile(plan.destinationTile ?? plan.storeTile)} directToDestination=${plan.directDistanceToStoreTiles} tile(s) target=${formatTile(
    plan.targetTile,
  )} mode=${plan.targetMode} directToTarget=${plan.directDistanceToTargetTiles} tile(s) remainingPath=${plan.pathLength} step(s) nextWaypoint=${formatTile(plan.nextWaypoint)} nextPath=${plan.nextWaypointPathLength} step(s)`;
}

export function formatEndToEndGeneralStoreRoutePath(
  plan: EndToEndGeneralStoreRoutePlan,
  clickTile: Pick<WorldTile, "x" | "y" | "z"> | undefined = plan.nextWaypoint,
): string {
  if (plan.status === "unavailable") {
    return `from=${formatTile(plan.playerTile)} to=n/a destination='${plan.destinationLabel}' anchor=${formatTile(plan.destinationTile ?? plan.storeTile)} steps=0 path=unavailable reason='${plan.reason ?? "unknown"}'`;
  }

  const path =
    plan.pathTiles.length > 0
      ? plan.pathTiles.map((tile) => formatPathTile(tile, plan, clickTile)).join(" -> ")
      : `[START:${formatTile(plan.playerTile)}]`;
  return `from=${formatTile(plan.playerTile)} to=${formatTile(plan.targetTile)} destination='${plan.destinationLabel}' anchor=${formatTile(
    plan.destinationTile ?? plan.storeTile,
  )} clickTile=${formatTile(clickTile)} steps=${plan.pathLength} path=${path}`;
}
