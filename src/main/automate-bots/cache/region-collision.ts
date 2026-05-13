import { WorldTile, deriveWorldTile } from "../mapping/world-coordinate";
import { OsrsObjectDefinition, OsrsObjectDefinitionMap } from "./object-loader";
import { OSRS_PLANES, OSRS_REGION_SIZE, OsrsMapRegion } from "./map-loader";
import { OsrsLocation, OsrsRegionLocations } from "./locations-loader";

export const enum CollisionFlag {
  Blocked = 1 << 0,
  North = 1 << 1,
  East = 1 << 2,
  South = 1 << 3,
  West = 1 << 4,
  Projectile = 1 << 5,
}

export type OsrsRegionCollision = {
  regionX: number;
  regionY: number;
  flags: number[][][];
};

export type BuildRegionCollisionOptions = {
  blockTerrainSettings?: boolean;
};

export type RegionPathStep = WorldTile;

const CARDINALS = [
  { dx: 0, dy: 1, fromFlag: CollisionFlag.North, toFlag: CollisionFlag.South },
  { dx: 1, dy: 0, fromFlag: CollisionFlag.East, toFlag: CollisionFlag.West },
  { dx: 0, dy: -1, fromFlag: CollisionFlag.South, toFlag: CollisionFlag.North },
  { dx: -1, dy: 0, fromFlag: CollisionFlag.West, toFlag: CollisionFlag.East },
] as const;

function createEmptyFlags(): number[][][] {
  return Array.from({ length: OSRS_PLANES }, () =>
    Array.from({ length: OSRS_REGION_SIZE }, () => Array.from({ length: OSRS_REGION_SIZE }, () => 0)),
  );
}

function inBounds(localX: number, localY: number, z: number): boolean {
  return (
    z >= 0 &&
    z < OSRS_PLANES &&
    localX >= 0 &&
    localX < OSRS_REGION_SIZE &&
    localY >= 0 &&
    localY < OSRS_REGION_SIZE
  );
}

function addFlag(collision: OsrsRegionCollision, localX: number, localY: number, z: number, flag: CollisionFlag): void {
  if (!inBounds(localX, localY, z)) {
    return;
  }

  collision.flags[z][localX][localY] |= flag;
}

function addDirectionalBlock(
  collision: OsrsRegionCollision,
  localX: number,
  localY: number,
  z: number,
  direction: "north" | "east" | "south" | "west",
): void {
  if (direction === "north") {
    addFlag(collision, localX, localY, z, CollisionFlag.North);
    addFlag(collision, localX, localY + 1, z, CollisionFlag.South);
  } else if (direction === "east") {
    addFlag(collision, localX, localY, z, CollisionFlag.East);
    addFlag(collision, localX + 1, localY, z, CollisionFlag.West);
  } else if (direction === "south") {
    addFlag(collision, localX, localY, z, CollisionFlag.South);
    addFlag(collision, localX, localY - 1, z, CollisionFlag.North);
  } else {
    addFlag(collision, localX, localY, z, CollisionFlag.West);
    addFlag(collision, localX - 1, localY, z, CollisionFlag.East);
  }
}

function addRectangleBlock(
  collision: OsrsRegionCollision,
  localX: number,
  localY: number,
  z: number,
  sizeX: number,
  sizeY: number,
  blocksProjectile: boolean,
): void {
  for (let dx = 0; dx < sizeX; dx += 1) {
    for (let dy = 0; dy < sizeY; dy += 1) {
      addFlag(
        collision,
        localX + dx,
        localY + dy,
        z,
        CollisionFlag.Blocked | (blocksProjectile ? CollisionFlag.Projectile : 0),
      );
    }
  }
}

function addWallBlock(collision: OsrsRegionCollision, location: OsrsLocation): void {
  const { localX, localY, z, orientation, type } = location;

  if (type === 0) {
    const direction = (["west", "north", "east", "south"] as const)[orientation & 3];
    addDirectionalBlock(collision, localX, localY, z, direction);
    return;
  }

  if (type === 1 || type === 3) {
    const first = (["west", "north", "east", "south"] as const)[orientation & 3];
    const second = (["north", "east", "south", "west"] as const)[orientation & 3];
    addDirectionalBlock(collision, localX, localY, z, first);
    addDirectionalBlock(collision, localX, localY, z, second);
    return;
  }

  if (type === 2) {
    const first = (["west", "north", "east", "south"] as const)[orientation & 3];
    const second = (["north", "east", "south", "west"] as const)[orientation & 3];
    addDirectionalBlock(collision, localX, localY, z, first);
    addDirectionalBlock(collision, localX, localY, z, second);
  }
}

function getRotatedFootprint(definition: OsrsObjectDefinition, orientation: number): { sizeX: number; sizeY: number } {
  if ((orientation & 1) === 1) {
    return {
      sizeX: definition.sizeY,
      sizeY: definition.sizeX,
    };
  }

  return {
    sizeX: definition.sizeX,
    sizeY: definition.sizeY,
  };
}

function applyLocation(collision: OsrsRegionCollision, location: OsrsLocation, definition: OsrsObjectDefinition): void {
  if (definition.interactType === 0) {
    return;
  }

  if (location.type >= 0 && location.type <= 3) {
    addWallBlock(collision, location);
    return;
  }

  if (location.type === 9) {
    addRectangleBlock(collision, location.localX, location.localY, location.z, 1, 1, definition.blocksProjectile);
    return;
  }

  if (location.type === 10 || location.type === 11 || location.type >= 12) {
    const { sizeX, sizeY } = getRotatedFootprint(definition, location.orientation);
    addRectangleBlock(collision, location.localX, location.localY, location.z, sizeX, sizeY, definition.blocksProjectile);
    return;
  }

  if (location.type === 22 && definition.interactType === 1) {
    addRectangleBlock(collision, location.localX, location.localY, location.z, 1, 1, definition.blocksProjectile);
  }
}

export function buildOsrsRegionCollision(
  mapRegion: OsrsMapRegion,
  regionLocations: OsrsRegionLocations,
  objectDefinitions: OsrsObjectDefinitionMap,
  options: BuildRegionCollisionOptions = {},
): OsrsRegionCollision {
  const collision: OsrsRegionCollision = {
    regionX: mapRegion.regionX,
    regionY: mapRegion.regionY,
    flags: createEmptyFlags(),
  };

  if (options.blockTerrainSettings ?? true) {
    for (let z = 0; z < OSRS_PLANES; z += 1) {
      for (let x = 0; x < OSRS_REGION_SIZE; x += 1) {
        for (let y = 0; y < OSRS_REGION_SIZE; y += 1) {
          if ((mapRegion.tiles[z][x][y].settings & 1) !== 0) {
            addFlag(collision, x, y, z, CollisionFlag.Blocked);
          }
        }
      }
    }
  }

  for (const location of regionLocations.locations) {
    const definition = objectDefinitions.get(location.id);
    if (!definition) {
      continue;
    }

    applyLocation(collision, location, definition);
  }

  return collision;
}

export function getRegionCollisionFlags(collision: OsrsRegionCollision, localX: number, localY: number, z: number): number {
  return inBounds(localX, localY, z) ? collision.flags[z][localX][localY] : CollisionFlag.Blocked;
}

export function isRegionTileBlocked(collision: OsrsRegionCollision, localX: number, localY: number, z: number): boolean {
  return (getRegionCollisionFlags(collision, localX, localY, z) & CollisionFlag.Blocked) !== 0;
}

export function canMoveWithinRegion(
  collision: OsrsRegionCollision,
  localX: number,
  localY: number,
  z: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): boolean {
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    return false;
  }

  const direction = CARDINALS.find((candidate) => candidate.dx === dx && candidate.dy === dy);
  if (!direction) {
    return false;
  }

  const nextX = localX + dx;
  const nextY = localY + dy;
  if (!inBounds(localX, localY, z) || !inBounds(nextX, nextY, z)) {
    return false;
  }

  const fromFlags = getRegionCollisionFlags(collision, localX, localY, z);
  const toFlags = getRegionCollisionFlags(collision, nextX, nextY, z);
  return (fromFlags & direction.fromFlag) === 0 && (toFlags & (CollisionFlag.Blocked | direction.toFlag)) === 0;
}

function toPathKey(localX: number, localY: number, z: number): string {
  return `${localX},${localY},${z}`;
}

function fromPathKey(key: string): { localX: number; localY: number; z: number } {
  const [localX, localY, z] = key.split(",").map(Number);
  return { localX, localY, z };
}

export function findRegionPath(
  collision: OsrsRegionCollision,
  start: { localX: number; localY: number; z: number },
  target: { localX: number; localY: number; z: number },
): RegionPathStep[] | null {
  if (!inBounds(start.localX, start.localY, start.z) || !inBounds(target.localX, target.localY, target.z)) {
    return null;
  }

  if (start.z !== target.z || isRegionTileBlocked(collision, start.localX, start.localY, start.z)) {
    return null;
  }

  const targetKey = toPathKey(target.localX, target.localY, target.z);
  const startKey = toPathKey(start.localX, start.localY, start.z);
  const queue = [startKey];
  const previous = new Map<string, string | null>([[startKey, null]]);

  for (let readIndex = 0; readIndex < queue.length; readIndex += 1) {
    const key = queue[readIndex];
    if (key === targetKey) {
      break;
    }

    const current = fromPathKey(key);
    for (const direction of CARDINALS) {
      if (!canMoveWithinRegion(collision, current.localX, current.localY, current.z, direction.dx, direction.dy)) {
        continue;
      }

      const nextKey = toPathKey(current.localX + direction.dx, current.localY + direction.dy, current.z);
      if (previous.has(nextKey)) {
        continue;
      }

      previous.set(nextKey, key);
      queue.push(nextKey);
    }
  }

  if (!previous.has(targetKey)) {
    return null;
  }

  const regionBaseX = collision.regionX * 64;
  const regionBaseY = collision.regionY * 64;
  const reversed: RegionPathStep[] = [];
  let cursor: string | null = targetKey;
  while (cursor) {
    const { localX, localY, z } = fromPathKey(cursor);
    reversed.push(deriveWorldTile(regionBaseX + localX, regionBaseY + localY, z));
    cursor = previous.get(cursor) ?? null;
  }

  return reversed.reverse();
}
