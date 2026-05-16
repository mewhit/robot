import { readOsrsCacheMapRegionView, type OsrsCacheMapObject } from "../cache/cache-map-view";
import {
  RUNELITE_AGILITY_SHORTCUT_ENTRIES,
  type RuneliteAgilityShortcutEntry,
} from "../cache/runelite-agility-shortcuts";
import {
  buildWorldRouteRectanglePerimeterTiles,
  formatWorldTile,
  type WorldRouteLink,
  type WorldRouteRectangle,
  type WorldRouteTile,
} from "./world-route-planner";

export type WorldRouteAgilityShortcutTarget = {
  key: string;
  level: number;
  description: string;
  label: string;
  objectId: number | null;
  rectangle: WorldRouteRectangle;
  clickTile: WorldRouteTile;
  interactionTiles: WorldRouteTile[];
};

export type WorldRouteAgilityContext = {
  agilityLevel: number;
  availableShortcuts: WorldRouteAgilityShortcutTarget[];
  unavailableShortcuts: WorldRouteAgilityShortcutTarget[];
  blockedShortcutTiles: WorldRouteTile[];
  routeLinks: WorldRouteLink[];
  shortcutByLinkId: Map<string, WorldRouteAgilityShortcutTarget>;
};

export type BuildWorldRouteAgilityContextOptions = {
  agilityLevel: number;
  cacheDirectoryPath?: string;
  interactionRadiusTiles?: number;
  maxObjectAnchorDistanceTiles?: number;
};

const DEFAULT_INTERACTION_RADIUS_TILES = 2;
const DEFAULT_MAX_OBJECT_ANCHOR_DISTANCE_TILES = 16;

function getShortcutEntryAnchor(entry: RuneliteAgilityShortcutEntry): WorldRouteTile | null {
  const anchor = entry.worldLocation ?? entry.worldMapLocation;
  return anchor ? { x: anchor.x, y: anchor.y, z: anchor.z } : null;
}

function getWorldTileDistance(a: WorldRouteTile, b: WorldRouteTile): number {
  if (a.z !== b.z) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function getObjectDistanceToAnchor(object: OsrsCacheMapObject, anchor: WorldRouteTile): number {
  if (object.z !== anchor.z) {
    return Number.POSITIVE_INFINITY;
  }

  const minX = object.worldX;
  const maxX = object.worldX + object.sizeX - 1;
  const minY = object.worldY;
  const maxY = object.worldY + object.sizeY - 1;
  const dx = anchor.x < minX ? minX - anchor.x : anchor.x > maxX ? anchor.x - maxX : 0;
  const dy = anchor.y < minY ? minY - anchor.y : anchor.y > maxY ? anchor.y - maxY : 0;
  return Math.max(dx, dy);
}

function getRectangleTiles(rectangle: WorldRouteRectangle): WorldRouteTile[] {
  const tiles: WorldRouteTile[] = [];
  for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
      tiles.push({ x, y, z: rectangle.z });
    }
  }

  return tiles;
}

function getObjectsForShortcutEntry(
  entry: RuneliteAgilityShortcutEntry,
  options: Required<Pick<BuildWorldRouteAgilityContextOptions, "interactionRadiusTiles" | "maxObjectAnchorDistanceTiles">> &
    Pick<BuildWorldRouteAgilityContextOptions, "cacheDirectoryPath">,
): OsrsCacheMapObject[] {
  const anchor = getShortcutEntryAnchor(entry);
  if (!anchor) {
    return [];
  }

  const region = readOsrsCacheMapRegionView({
    regionX: anchor.x >> 6,
    regionY: anchor.y >> 6,
    cacheDirectoryPath: options.cacheDirectoryPath,
  });
  return region.objects
    .filter((object) => entry.objectIds.includes(object.id))
    .filter((object) => getObjectDistanceToAnchor(object, anchor) <= options.maxObjectAnchorDistanceTiles)
    .sort((a, b) => {
      const aDistance = getObjectDistanceToAnchor(a, anchor);
      const bDistance = getObjectDistanceToAnchor(b, anchor);
      return aDistance - bDistance || a.id - b.id || a.worldX - b.worldX || a.worldY - b.worldY;
    });
}

function toShortcutTarget(
  entry: RuneliteAgilityShortcutEntry,
  object: OsrsCacheMapObject | null,
  interactionRadiusTiles: number,
): WorldRouteAgilityShortcutTarget | null {
  const anchor = getShortcutEntryAnchor(entry);
  if (!anchor) {
    return null;
  }

  const clickTile = object && object.z === anchor.z
    ? {
        x: object.worldX + Math.floor(object.sizeX / 2),
        y: object.worldY + Math.floor(object.sizeY / 2),
        z: object.z,
      }
    : anchor;
  const rectangle: WorldRouteRectangle = {
    x: object?.worldX ?? clickTile.x,
    y: object?.worldY ?? clickTile.y,
    z: clickTile.z,
    width: object?.sizeX ?? 1,
    height: object?.sizeY ?? 1,
  };

  return {
    key: entry.key,
    level: entry.level,
    description: entry.description,
    label: `${entry.key} level ${entry.level} ${entry.description}`,
    objectId: object?.id ?? null,
    rectangle,
    clickTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, interactionRadiusTiles),
  };
}

function getShortcutTargetIdentity(target: WorldRouteAgilityShortcutTarget): string {
  return `${target.objectId ?? "anchor"}:${formatWorldTile(target.clickTile)}`;
}

function buildDirectedShortcutLinksForEntry(
  targets: readonly WorldRouteAgilityShortcutTarget[],
): Array<{ link: WorldRouteLink; clickTarget: WorldRouteAgilityShortcutTarget }> {
  if (targets.length === 0) {
    return [];
  }

  if (targets.length === 1) {
    const target = targets[0];
    return [
      {
        clickTarget: target,
        link: {
          id: `${target.key}:${getShortcutTargetIdentity(target)}`,
          label: target.label,
          fromTiles: target.interactionTiles,
          toTiles: target.interactionTiles,
          actionTile: target.clickTile,
          metadata: {
            type: "agility-shortcut",
            shortcutKey: target.key,
            level: target.level,
            objectId: target.objectId,
          },
        },
      },
    ];
  }

  const links: Array<{ link: WorldRouteLink; clickTarget: WorldRouteAgilityShortcutTarget }> = [];
  for (const fromTarget of targets) {
    for (const toTarget of targets) {
      if (fromTarget === toTarget || getWorldTileDistance(fromTarget.clickTile, toTarget.clickTile) === 0) {
        continue;
      }

      links.push({
        clickTarget: fromTarget,
        link: {
          id: `${fromTarget.key}:${getShortcutTargetIdentity(fromTarget)}->${getShortcutTargetIdentity(toTarget)}`,
          label: fromTarget.label,
          fromTiles: fromTarget.interactionTiles,
          toTiles: toTarget.interactionTiles,
          actionTile: fromTarget.clickTile,
          metadata: {
            type: "agility-shortcut",
            shortcutKey: fromTarget.key,
            level: fromTarget.level,
            objectId: fromTarget.objectId,
            toObjectId: toTarget.objectId,
          },
        },
      });
    }
  }

  return links;
}

function uniqueTiles(tiles: readonly WorldRouteTile[]): WorldRouteTile[] {
  const seen = new Set<string>();
  const unique: WorldRouteTile[] = [];
  for (const tile of tiles) {
    const key = formatWorldTile(tile);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(tile);
  }

  return unique;
}

export function buildWorldRouteAgilityContext(
  options: BuildWorldRouteAgilityContextOptions,
): WorldRouteAgilityContext {
  const agilityLevel = Math.max(1, Math.min(99, Math.round(options.agilityLevel)));
  const interactionRadiusTiles = Math.max(1, Math.floor(options.interactionRadiusTiles ?? DEFAULT_INTERACTION_RADIUS_TILES));
  const maxObjectAnchorDistanceTiles = Math.max(
    1,
    Math.floor(options.maxObjectAnchorDistanceTiles ?? DEFAULT_MAX_OBJECT_ANCHOR_DISTANCE_TILES),
  );
  const availableShortcuts: WorldRouteAgilityShortcutTarget[] = [];
  const unavailableShortcuts: WorldRouteAgilityShortcutTarget[] = [];
  const routeLinks: WorldRouteLink[] = [];
  const shortcutByLinkId = new Map<string, WorldRouteAgilityShortcutTarget>();

  for (const entry of RUNELITE_AGILITY_SHORTCUT_ENTRIES) {
    let objects: OsrsCacheMapObject[] = [];
    try {
      objects = getObjectsForShortcutEntry(entry, {
        cacheDirectoryPath: options.cacheDirectoryPath,
        interactionRadiusTiles,
        maxObjectAnchorDistanceTiles,
      });
    } catch {
      objects = [];
    }

    const rawTargets = objects.length > 0 ? objects.map((object) => toShortcutTarget(entry, object, interactionRadiusTiles)) : [
      toShortcutTarget(entry, null, interactionRadiusTiles),
    ];
    const targets = rawTargets.filter((target): target is WorldRouteAgilityShortcutTarget => target !== null);
    if (entry.level <= agilityLevel) {
      availableShortcuts.push(...targets);
      for (const { link, clickTarget } of buildDirectedShortcutLinksForEntry(targets)) {
        routeLinks.push(link);
        shortcutByLinkId.set(link.id, clickTarget);
      }
    } else {
      unavailableShortcuts.push(...targets);
    }
  }

  return {
    agilityLevel,
    availableShortcuts: availableShortcuts.sort((a, b) => b.level - a.level || a.key.localeCompare(b.key)),
    unavailableShortcuts: unavailableShortcuts.sort((a, b) => b.level - a.level || a.key.localeCompare(b.key)),
    blockedShortcutTiles: uniqueTiles(unavailableShortcuts.flatMap((target) => getRectangleTiles(target.rectangle))),
    routeLinks,
    shortcutByLinkId,
  };
}

export function formatWorldRouteAgilityShortcutTarget(target: WorldRouteAgilityShortcutTarget): string {
  return `${target.label} object=${target.objectId ?? "anchor"} click=${formatWorldTile(target.clickTile)} footprint=${target.rectangle.x},${target.rectangle.y},${target.rectangle.z} ${target.rectangle.width}x${target.rectangle.height}`;
}

export function formatWorldRouteAgilityShortcutSummary(
  targets: readonly WorldRouteAgilityShortcutTarget[],
): string {
  return targets.length > 0 ? targets.map((target) => `${target.key}@${target.level}`).join(",") : "none";
}
