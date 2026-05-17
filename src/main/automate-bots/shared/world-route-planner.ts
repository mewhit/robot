import { openOsrsCacheStore, type OsrsCacheStore } from "../cache/cache-store";
import {
  loadOsrsObjectDefinitionsFromCache,
  loadOsrsRegionCacheDataFromStore,
  loadOsrsRegionCollisionFromCacheData,
} from "../cache/osrs-region-cache";
import type { OsrsObjectDefinitionMap } from "../cache/object-loader";
import {
  CollisionFlag,
  getRegionCollisionFlags,
  type BuildRegionCollisionOptions,
  type OsrsRegionCollision,
} from "../cache/region-collision";
import { deriveWorldTile, type WorldTile } from "../mapping/world-coordinate";

export type WorldRouteTile = Pick<WorldTile, "x" | "y" | "z">;

export type WorldRouteRectangle = WorldRouteTile & {
  width: number;
  height: number;
};

type WorldRouteRegionBounds = {
  minRegionX: number;
  maxRegionX: number;
  minRegionY: number;
  maxRegionY: number;
  count: number;
};

export type WorldRouteLink = {
  id: string;
  label: string;
  fromTiles: readonly WorldRouteTile[];
  toTiles: readonly WorldRouteTile[];
  actionTile?: WorldRouteTile;
  metadata?: Record<string, string | number | boolean | null>;
};

export type WorldRouteLinkUsage = {
  id: string;
  label: string;
  fromTile: WorldRouteTile;
  toTile: WorldRouteTile;
  actionTile?: WorldRouteTile;
  metadata?: Record<string, string | number | boolean | null>;
  pathIndex: number;
};

export type WorldRoutePlan = {
  status: "ready" | "already-there" | "unavailable";
  reason?: string;
  playerTile: WorldRouteTile;
  destinationLabel: string;
  destinationTile?: WorldRouteTile;
  targetTile?: WorldRouteTile;
  nextWaypoint?: WorldRouteTile;
  pathTiles: WorldTile[];
  linkUsages: WorldRouteLinkUsage[];
  nextLinkUsage?: WorldRouteLinkUsage;
  directDistanceToDestinationTiles: number;
  directDistanceToTargetTiles: number;
  nextWaypointPathLength: number;
  pathLength: number;
};

export type PlanWorldRouteOptions = {
  destinationLabel: string;
  destinationTile?: WorldRouteTile;
  targetTiles: WorldRouteTile[];
  blockedTiles?: readonly WorldRouteTile[];
  links?: readonly WorldRouteLink[];
  waypointStepLimit?: number;
  maxCrossRegionCount?: number;
  cacheDirectoryPath?: string;
  collisionOptions?: BuildRegionCollisionOptions;
};

type WorldCollisionGrid = {
  collisions: Map<string, OsrsRegionCollision>;
  blockedTileKeys: ReadonlySet<string>;
  missingRegionSummaries: string[];
  minRegionX: number;
  maxRegionX: number;
  minRegionY: number;
  maxRegionY: number;
};

type WorldCollisionLoadCache = {
  collisions: Map<string, OsrsRegionCollision>;
  missingRegions: Map<string, string>;
};

const DEFAULT_WAYPOINT_STEP_LIMIT = 14;
const DEFAULT_MAX_CROSS_REGION_COUNT = 16;
const DEFAULT_WORLD_ROUTE_COLLISION_OPTIONS: BuildRegionCollisionOptions = {};

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

function getRegionKey(regionX: number, regionY: number): string {
  return `${regionX},${regionY}`;
}

function getTileKey(tile: WorldRouteTile): string {
  return `${tile.x},${tile.y},${tile.z}`;
}

function routeTileFromKey(key: string): WorldRouteTile {
  const [x, y, z] = key.split(",").map(Number);
  return { x, y, z };
}

function getRegionBoundsForTiles(
  playerTile: WorldTile,
  tiles: readonly WorldRouteTile[],
): WorldRouteRegionBounds {
  let minRegionX = playerTile.regionX;
  let maxRegionX = playerTile.regionX;
  let minRegionY = playerTile.regionY;
  let maxRegionY = playerTile.regionY;

  for (const tile of tiles) {
    const regionX = tile.x >> 6;
    const regionY = tile.y >> 6;
    minRegionX = Math.min(minRegionX, regionX);
    maxRegionX = Math.max(maxRegionX, regionX);
    minRegionY = Math.min(minRegionY, regionY);
    maxRegionY = Math.max(maxRegionY, regionY);
  }

  return buildRegionBounds(minRegionX, maxRegionX, minRegionY, maxRegionY);
}

function buildRegionBounds(
  minRegionX: number,
  maxRegionX: number,
  minRegionY: number,
  maxRegionY: number,
): WorldRouteRegionBounds {
  const safeMinRegionX = Math.max(0, minRegionX);
  const safeMinRegionY = Math.max(0, minRegionY);
  return {
    minRegionX: safeMinRegionX,
    maxRegionX,
    minRegionY: safeMinRegionY,
    maxRegionY,
    count: (maxRegionX - safeMinRegionX + 1) * (maxRegionY - safeMinRegionY + 1),
  };
}

function buildRegionBoundCandidates(
  baseBounds: WorldRouteRegionBounds,
  maxCrossRegionCount: number,
): WorldRouteRegionBounds[] {
  const maxRegionCount = Math.max(1, Math.floor(maxCrossRegionCount));
  if (baseBounds.count > maxRegionCount) {
    return [];
  }

  const baseWidth = baseBounds.maxRegionX - baseBounds.minRegionX + 1;
  const baseHeight = baseBounds.maxRegionY - baseBounds.minRegionY + 1;
  const candidatesByKey = new Map<string, WorldRouteRegionBounds & { expansion: number }>();

  for (let width = baseWidth; width <= maxRegionCount; width += 1) {
    const maxHeightForWidth = Math.floor(maxRegionCount / width);
    if (maxHeightForWidth < baseHeight) {
      continue;
    }

    for (let height = baseHeight; height <= maxHeightForWidth; height += 1) {
      const extraWidth = width - baseWidth;
      const extraHeight = height - baseHeight;
      for (let left = 0; left <= extraWidth; left += 1) {
        const right = extraWidth - left;
        for (let down = 0; down <= extraHeight; down += 1) {
          const up = extraHeight - down;
          const bounds = buildRegionBounds(
            baseBounds.minRegionX - left,
            baseBounds.maxRegionX + right,
            baseBounds.minRegionY - down,
            baseBounds.maxRegionY + up,
          );
          if (bounds.count > maxRegionCount) {
            continue;
          }

          const expansion =
            baseBounds.minRegionX - bounds.minRegionX +
            bounds.maxRegionX - baseBounds.maxRegionX +
            baseBounds.minRegionY - bounds.minRegionY +
            bounds.maxRegionY - baseBounds.maxRegionY;
          const key = `${bounds.minRegionX},${bounds.maxRegionX},${bounds.minRegionY},${bounds.maxRegionY}`;
          const previous = candidatesByKey.get(key);
          if (!previous || expansion < previous.expansion) {
            candidatesByKey.set(key, { ...bounds, expansion });
          }
        }
      }
    }
  }

  return [...candidatesByKey.values()]
    .sort((a, b) =>
      a.expansion - b.expansion ||
      a.count - b.count ||
      a.minRegionX - b.minRegionX ||
      a.maxRegionX - b.maxRegionX ||
      a.minRegionY - b.minRegionY ||
      a.maxRegionY - b.maxRegionY
    )
    .map(({ expansion: _expansion, ...bounds }) => bounds);
}

function loadWorldCollisionGrid(
  bounds: Pick<WorldCollisionGrid, "minRegionX" | "maxRegionX" | "minRegionY" | "maxRegionY">,
  store: OsrsCacheStore,
  objectDefinitions: OsrsObjectDefinitionMap,
  loadCache: WorldCollisionLoadCache,
  blockedTiles: readonly WorldRouteTile[] = [],
  collisionOptions: BuildRegionCollisionOptions = DEFAULT_WORLD_ROUTE_COLLISION_OPTIONS,
): WorldCollisionGrid {
  const collisions = new Map<string, OsrsRegionCollision>();
  const missingRegionSummaries: string[] = [];
  for (let regionX = bounds.minRegionX; regionX <= bounds.maxRegionX; regionX += 1) {
    for (let regionY = bounds.minRegionY; regionY <= bounds.maxRegionY; regionY += 1) {
      const regionKey = getRegionKey(regionX, regionY);
      const cachedCollision = loadCache.collisions.get(regionKey);
      if (cachedCollision) {
        collisions.set(regionKey, cachedCollision);
        continue;
      }

      const cachedMissingReason = loadCache.missingRegions.get(regionKey);
      if (cachedMissingReason) {
        missingRegionSummaries.push(cachedMissingReason);
        continue;
      }

      try {
        const collision = loadOsrsRegionCollisionFromCacheData(
          loadOsrsRegionCacheDataFromStore({
            store,
            regionX,
            regionY,
            objectDefinitions,
          }),
          collisionOptions,
        );
        loadCache.collisions.set(regionKey, collision);
        collisions.set(regionKey, collision);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const missingSummary = `${regionX},${regionY}: ${message}`;
        loadCache.missingRegions.set(regionKey, missingSummary);
        missingRegionSummaries.push(missingSummary);
      }
    }
  }

  return {
    ...bounds,
    collisions,
    missingRegionSummaries,
    blockedTileKeys: new Set(blockedTiles.map(getTileKey)),
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

  const flags = getRegionCollisionFlags(collision, x & 63, y & 63, z);
  return grid.blockedTileKeys.has(`${x},${y},${z}`) ? flags | CollisionFlag.Blocked : flags;
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

function sortTargetTilesByDirectDistance(playerTile: WorldRouteTile, targetTiles: readonly WorldRouteTile[]): WorldRouteTile[] {
  return [...targetTiles].sort((a, b) => {
    const aDistance = getWorldTileChebyshevDistance(playerTile, a);
    const bDistance = getWorldTileChebyshevDistance(playerTile, b);
    return aDistance - bDistance || a.y - b.y || a.x - b.x;
  });
}

function uniqueTiles(tiles: readonly WorldRouteTile[]): WorldRouteTile[] {
  const seen = new Set<string>();
  const unique: WorldRouteTile[] = [];
  for (const tile of tiles) {
    const key = getTileKey(tile);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(tile);
  }

  return unique;
}

function buildLinksByFromKey(links: readonly WorldRouteLink[], z: number): Map<string, WorldRouteLink[]> {
  const linksByFromKey = new Map<string, WorldRouteLink[]>();
  for (const link of links) {
    for (const fromTile of uniqueTiles(link.fromTiles.filter((tile) => tile.z === z))) {
      const key = getTileKey(fromTile);
      const entries = linksByFromKey.get(key) ?? [];
      entries.push(link);
      linksByFromKey.set(key, entries);
    }
  }

  return linksByFromKey;
}

type WorldRouteSearchResult = {
  path: WorldTile[];
  linkUsages: WorldRouteLinkUsage[];
};

function findWorldPath(
  grid: WorldCollisionGrid,
  start: WorldRouteTile,
  targetTiles: readonly WorldRouteTile[],
  links: readonly WorldRouteLink[] = [],
): WorldRouteSearchResult | null {
  const targetKeys = new Set(targetTiles.filter((tile) => tile.z === start.z).map(getTileKey));
  if (targetKeys.size === 0 || !isWorldTileInGrid(grid, start.x, start.y)) {
    return null;
  }

  const linksByFromKey = buildLinksByFromKey(links, start.z);
  const startKey = getTileKey(start);
  const queue = [startKey];
  const previous = new Map<string, string | null>([[startKey, null]]);
  const previousLink = new Map<string, Omit<WorldRouteLinkUsage, "pathIndex"> | null>([[startKey, null]]);
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
      previousLink.set(nextKey, null);
      queue.push(nextKey);
    }

    for (const link of linksByFromKey.get(key) ?? []) {
      const fromTile = routeTileFromKey(key);
      for (const toTile of uniqueTiles(link.toTiles.filter((tile) => tile.z === z))) {
        if (!isWorldTileInGrid(grid, toTile.x, toTile.y) || isWorldTileBlocked(grid, toTile.x, toTile.y, toTile.z)) {
          continue;
        }

        const nextKey = getTileKey(toTile);
        if (nextKey === key || previous.has(nextKey)) {
          continue;
        }

        previous.set(nextKey, key);
        previousLink.set(nextKey, {
          id: link.id,
          label: link.label,
          fromTile,
          toTile,
          actionTile: link.actionTile,
          metadata: link.metadata,
        });
        queue.push(nextKey);
      }
    }
  }

  if (!foundKey) {
    return null;
  }

  const reversed: WorldTile[] = [];
  const reversedEdgeLinks: Array<Omit<WorldRouteLinkUsage, "pathIndex"> | null> = [];
  let cursor: string | null = foundKey;
  while (cursor) {
    const [x, y, z] = cursor.split(",").map(Number);
    reversed.push(deriveWorldTile(x, y, z));
    const edgeLink = previousLink.get(cursor) ?? null;
    if (previous.get(cursor) !== null) {
      reversedEdgeLinks.push(edgeLink);
    }
    cursor = previous.get(cursor) ?? null;
  }

  const path = reversed.reverse();
  const edgeLinks = reversedEdgeLinks.reverse();
  const linkUsages = edgeLinks
    .map((link, index) => link ? { ...link, pathIndex: index } : null)
    .filter((link): link is WorldRouteLinkUsage => link !== null);

  return { path, linkUsages };
}

export function formatWorldTile(tile: WorldRouteTile | undefined): string {
  return tile ? `${tile.x},${tile.y},${tile.z}` : "n/a";
}

export function isSameWorldTile(a: WorldRouteTile | undefined, b: WorldRouteTile | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
}

export function getWorldTileChebyshevDistance(a: Pick<WorldRouteTile, "x" | "y">, b: Pick<WorldRouteTile, "x" | "y">): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function getWorldTileDistanceToRectangle(tile: WorldRouteTile, rectangle: WorldRouteRectangle): number {
  if (tile.z !== rectangle.z) {
    return Number.POSITIVE_INFINITY;
  }

  const maxX = rectangle.x + rectangle.width - 1;
  const maxY = rectangle.y + rectangle.height - 1;
  const dx = tile.x < rectangle.x ? rectangle.x - tile.x : tile.x > maxX ? tile.x - maxX : 0;
  const dy = tile.y < rectangle.y ? rectangle.y - tile.y : tile.y > maxY ? tile.y - maxY : 0;
  return Math.max(dx, dy);
}

export function isWorldTileInsideRectangle(tile: WorldRouteTile, rectangle: WorldRouteRectangle): boolean {
  return (
    tile.z === rectangle.z &&
    tile.x >= rectangle.x &&
    tile.x <= rectangle.x + rectangle.width - 1 &&
    tile.y >= rectangle.y &&
    tile.y <= rectangle.y + rectangle.height - 1
  );
}

export function buildWorldRouteCandidateTilesAround(
  destinationTile: WorldRouteTile,
  searchRadiusTiles: number,
  options: { includeCenter?: boolean } = {},
): WorldRouteTile[] {
  const safeRadius = Math.max(0, Math.floor(searchRadiusTiles));
  const includeCenter = options.includeCenter ?? safeRadius === 0;
  const candidates: Array<WorldRouteTile & { distance: number }> = [];
  for (let dx = -safeRadius; dx <= safeRadius; dx += 1) {
    for (let dy = -safeRadius; dy <= safeRadius; dy += 1) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if ((!includeCenter && distance === 0) || distance > safeRadius) {
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

export function buildWorldRouteRectanglePerimeterTiles(
  rectangle: WorldRouteRectangle,
  interactionRadiusTiles = 1,
): WorldRouteTile[] {
  const radius = Math.max(1, Math.floor(interactionRadiusTiles));
  const candidates: WorldRouteTile[] = [];
  const minX = rectangle.x - radius;
  const maxX = rectangle.x + rectangle.width - 1 + radius;
  const minY = rectangle.y - radius;
  const maxY = rectangle.y + rectangle.height - 1 + radius;

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const tile = { x, y, z: rectangle.z };
      const distance = getWorldTileDistanceToRectangle(tile, rectangle);
      if (distance < 1 || distance > radius) {
        continue;
      }

      candidates.push(tile);
    }
  }

  return candidates.sort((a, b) => {
    const aDistance = getWorldTileDistanceToRectangle(a, rectangle);
    const bDistance = getWorldTileDistanceToRectangle(b, rectangle);
    return aDistance - bDistance || a.y - b.y || a.x - b.x;
  });
}

export function planWorldRouteToTiles(playerTile: WorldTile, options: PlanWorldRouteOptions): WorldRoutePlan {
  const destinationTile = options.destinationTile;
  const samePlaneTargets = uniqueTiles(options.targetTiles.filter((tile) => tile.z === playerTile.z));
  const directDistanceToDestinationTiles = destinationTile
    ? getWorldTileChebyshevDistance(playerTile, destinationTile)
    : samePlaneTargets.length > 0
      ? Math.min(...samePlaneTargets.map((tile) => getWorldTileChebyshevDistance(playerTile, tile)))
      : 0;

  if (samePlaneTargets.length === 0) {
    return {
      status: "unavailable",
      reason: `${options.destinationLabel} has no reachable target tile on player plane ${playerTile.z}`,
      playerTile,
      destinationLabel: options.destinationLabel,
      destinationTile,
      directDistanceToDestinationTiles,
      directDistanceToTargetTiles: 0,
      pathTiles: [],
      linkUsages: [],
      pathLength: 0,
      nextWaypointPathLength: 0,
    };
  }

  const linkTilesForBounds = (options.links ?? []).flatMap((link) => [...link.fromTiles, ...link.toTiles]);
  const baseRegionBounds = getRegionBoundsForTiles(
    playerTile,
    destinationTile
      ? [destinationTile, ...samePlaneTargets, ...linkTilesForBounds]
      : [...samePlaneTargets, ...linkTilesForBounds],
  );
  const maxCrossRegionCount = options.maxCrossRegionCount ?? DEFAULT_MAX_CROSS_REGION_COUNT;
  if (baseRegionBounds.count > maxCrossRegionCount) {
    return {
      status: "unavailable",
      reason: `${options.destinationLabel} is ${baseRegionBounds.count} region(s) away; cross-region planner limit is ${maxCrossRegionCount}`,
      playerTile,
      destinationLabel: options.destinationLabel,
      destinationTile,
      directDistanceToDestinationTiles,
      directDistanceToTargetTiles: 0,
      pathTiles: [],
      linkUsages: [],
      pathLength: 0,
      nextWaypointPathLength: 0,
    };
  }

  const regionBoundCandidates = buildRegionBoundCandidates(baseRegionBounds, maxCrossRegionCount);
  const sortedTargets = sortTargetTilesByDirectDistance(playerTile, samePlaneTargets);
  const samePlaneLinks = (options.links ?? []).map((link) => ({
    ...link,
    fromTiles: link.fromTiles.filter((tile) => tile.z === playerTile.z),
    toTiles: link.toTiles.filter((tile) => tile.z === playerTile.z),
  }));
  let result: WorldRouteSearchResult | null = null;
  let searchedRegionWindowCount = 0;
  const missingRegionSummaries = new Set<string>();
  const loadCache: WorldCollisionLoadCache = {
    collisions: new Map(),
    missingRegions: new Map(),
  };
  let store: OsrsCacheStore | null = null;
  let objectDefinitions: OsrsObjectDefinitionMap;
  try {
    store = openOsrsCacheStore(options.cacheDirectoryPath);
    objectDefinitions = loadOsrsObjectDefinitionsFromCache(store);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unavailable",
      reason: `Could not load OSRS cache for ${options.destinationLabel}: ${message}`,
      playerTile,
      destinationLabel: options.destinationLabel,
      destinationTile,
      directDistanceToDestinationTiles,
      directDistanceToTargetTiles: 0,
      pathTiles: [],
      linkUsages: [],
      nextWaypointPathLength: 0,
      pathLength: 0,
    };
  }

  try {
    for (const regionBounds of regionBoundCandidates) {
      searchedRegionWindowCount += 1;
      const collisionGrid = loadWorldCollisionGrid(
        regionBounds,
        store,
        objectDefinitions,
        loadCache,
        options.blockedTiles ?? [],
        options.collisionOptions ?? DEFAULT_WORLD_ROUTE_COLLISION_OPTIONS,
      );
      for (const summary of collisionGrid.missingRegionSummaries) {
        missingRegionSummaries.add(summary);
      }
      result = findWorldPath(collisionGrid, playerTile, sortedTargets, samePlaneLinks);
      if (result) {
        break;
      }
    }
  } finally {
    if (store) {
      store.close();
    }
  }

  if (!result) {
    return {
      status: "unavailable",
      reason: `No reachable tile found for ${options.destinationLabel} from region ${playerTile.regionX},${playerTile.regionY} after searching ${searchedRegionWindowCount} region window(s)${
        missingRegionSummaries.size > 0
          ? `; missingRegions=${[...missingRegionSummaries].slice(0, 6).join(" | ")}`
          : ""
      }`,
      playerTile,
      destinationLabel: options.destinationLabel,
      destinationTile,
      directDistanceToDestinationTiles,
      directDistanceToTargetTiles: 0,
      pathTiles: [],
      linkUsages: [],
      nextWaypointPathLength: 0,
      pathLength: 0,
    };
  }

  const { path, linkUsages } = result;
  const targetTile = path[path.length - 1];
  const pathStepCount = Math.max(0, path.length - 1);
  if (path.length <= 1) {
    return {
      status: "already-there",
      playerTile,
      destinationLabel: options.destinationLabel,
      destinationTile,
      targetTile,
      nextWaypoint: targetTile,
      directDistanceToDestinationTiles,
      directDistanceToTargetTiles: getWorldTileChebyshevDistance(playerTile, targetTile),
      pathTiles: path,
      linkUsages,
      nextLinkUsage: linkUsages[0],
      nextWaypointPathLength: 0,
      pathLength: 0,
    };
  }

  const waypointStepLimit = Math.max(1, Math.floor(options.waypointStepLimit ?? DEFAULT_WAYPOINT_STEP_LIMIT));
  const firstLinkUsage = linkUsages[0];
  const firstLinkStopIndex = firstLinkUsage ? Math.max(1, firstLinkUsage.pathIndex) : path.length - 1;
  const nextWaypointIndex = Math.min(path.length - 1, waypointStepLimit, firstLinkStopIndex);
  return {
    status: "ready",
    playerTile,
    destinationLabel: options.destinationLabel,
    destinationTile,
    targetTile,
    nextWaypoint: path[nextWaypointIndex],
    directDistanceToDestinationTiles,
    directDistanceToTargetTiles: getWorldTileChebyshevDistance(playerTile, targetTile),
    pathTiles: path,
    linkUsages,
    nextLinkUsage: firstLinkUsage,
    nextWaypointPathLength: nextWaypointIndex,
    pathLength: pathStepCount,
  };
}

export function rebaseWorldRoutePlanFromTile(
  plan: WorldRoutePlan,
  playerTile: WorldRouteTile,
  options: { waypointStepLimit?: number; maxPathDistanceTiles?: number } = {},
): WorldRoutePlan | null {
  if (plan.status === "unavailable" || plan.pathTiles.length === 0) {
    return null;
  }

  const maxPathDistanceTiles = Math.max(0, Math.floor(options.maxPathDistanceTiles ?? 0));
  let pathIndex = -1;
  let pathDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < plan.pathTiles.length; index += 1) {
    const tile = plan.pathTiles[index];
    const distance = tile.z === playerTile.z
      ? getWorldTileChebyshevDistance(tile, playerTile)
      : Number.POSITIVE_INFINITY;
    if (distance < pathDistance) {
      pathDistance = distance;
      pathIndex = index;
      if (distance === 0) {
        break;
      }
    }
  }

  if (pathIndex < 0 || pathDistance > maxPathDistanceTiles) {
    return null;
  }

  const path = pathDistance === 0
    ? plan.pathTiles.slice(pathIndex)
    : [deriveWorldTile(playerTile.x, playerTile.y, playerTile.z), ...plan.pathTiles.slice(pathIndex)];
  const targetTile = path[path.length - 1] ?? plan.targetTile;
  if (!targetTile) {
    return null;
  }

  const linkUsages = plan.linkUsages
    .filter((linkUsage) => linkUsage.pathIndex >= pathIndex)
    .map((linkUsage) => ({
      ...linkUsage,
      pathIndex: linkUsage.pathIndex - pathIndex + (pathDistance === 0 ? 0 : 1),
    }));
  const pathStepCount = Math.max(0, path.length - 1);
  const directDistanceToDestinationTiles = plan.destinationTile
    ? getWorldTileChebyshevDistance(playerTile, plan.destinationTile)
    : getWorldTileChebyshevDistance(playerTile, targetTile);
  const directDistanceToTargetTiles = getWorldTileChebyshevDistance(playerTile, targetTile);

  if (path.length <= 1) {
    return {
      ...plan,
      status: "already-there",
      playerTile,
      targetTile,
      nextWaypoint: targetTile,
      directDistanceToDestinationTiles,
      directDistanceToTargetTiles,
      pathTiles: path,
      linkUsages,
      nextLinkUsage: linkUsages[0],
      nextWaypointPathLength: 0,
      pathLength: 0,
    };
  }

  const waypointStepLimit = Math.max(1, Math.floor(options.waypointStepLimit ?? DEFAULT_WAYPOINT_STEP_LIMIT));
  const firstLinkUsage = linkUsages[0];
  const firstLinkStopIndex = firstLinkUsage ? Math.max(1, firstLinkUsage.pathIndex) : path.length - 1;
  const nextWaypointIndex = Math.min(path.length - 1, waypointStepLimit, firstLinkStopIndex);
  return {
    ...plan,
    status: "ready",
    playerTile,
    targetTile,
    nextWaypoint: path[nextWaypointIndex],
    directDistanceToDestinationTiles,
    directDistanceToTargetTiles,
    pathTiles: path,
    linkUsages,
    nextLinkUsage: firstLinkUsage,
    nextWaypointPathLength: nextWaypointIndex,
    pathLength: pathStepCount,
  };
}

export function formatWorldRoutePlan(plan: WorldRoutePlan): string {
  if (plan.status === "unavailable") {
    return `status=unavailable player=${formatWorldTile(plan.playerTile)} reason='${plan.reason ?? "unknown"}'`;
  }

  return `status=${plan.status} player=${formatWorldTile(plan.playerTile)} destination='${plan.destinationLabel}' anchor=${formatWorldTile(
    plan.destinationTile,
  )} directToDestination=${plan.directDistanceToDestinationTiles} tile(s) target=${formatWorldTile(
    plan.targetTile,
  )} directToTarget=${plan.directDistanceToTargetTiles} tile(s) remainingPath=${plan.pathLength} step(s) nextWaypoint=${formatWorldTile(
    plan.nextWaypoint,
  )} nextPath=${plan.nextWaypointPathLength} step(s) nextLink=${plan.nextLinkUsage ? `${plan.nextLinkUsage.label}@${formatWorldTile(plan.nextLinkUsage.fromTile)}->${formatWorldTile(plan.nextLinkUsage.toTile)} pathIndex=${plan.nextLinkUsage.pathIndex}` : "none"}`;
}

export function formatWorldRoutePath(
  plan: WorldRoutePlan,
  clickTile: WorldRouteTile | undefined = plan.nextWaypoint,
): string {
  if (plan.status === "unavailable") {
    return `from=${formatWorldTile(plan.playerTile)} to=n/a destination='${plan.destinationLabel}' anchor=${formatWorldTile(
      plan.destinationTile,
    )} steps=0 path=unavailable reason='${plan.reason ?? "unknown"}'`;
  }

  const path =
    plan.pathTiles.length > 0
      ? plan.pathTiles
          .map((tile) => {
            const labels: string[] = [];
            if (isSameWorldTile(tile, plan.playerTile)) {
              labels.push("START");
            }
            if (isSameWorldTile(tile, clickTile)) {
              labels.push("CLICK");
            }
            if (isSameWorldTile(tile, plan.targetTile)) {
              labels.push("DEST");
            }
            if (plan.linkUsages.some((link) => isSameWorldTile(tile, link.fromTile))) {
              labels.push("LINK_FROM");
            }
            if (plan.linkUsages.some((link) => isSameWorldTile(tile, link.toTile))) {
              labels.push("LINK_TO");
            }

            const tileText = formatWorldTile(tile);
            return labels.length > 0 ? `[${labels.join("+")}:${tileText}]` : tileText;
          })
          .join(" -> ")
      : `[START:${formatWorldTile(plan.playerTile)}]`;
  return `from=${formatWorldTile(plan.playerTile)} to=${formatWorldTile(plan.targetTile)} destination='${plan.destinationLabel}' anchor=${formatWorldTile(
    plan.destinationTile,
  )} clickTile=${formatWorldTile(clickTile)} steps=${plan.pathLength} path=${path}`;
}
