import type { WorldTile } from "../mapping/world-coordinate";

type ShortcutWorldTile = Pick<WorldTile, "x" | "y" | "z">;

export type RuneliteAgilityShortcutEntry = {
  key: string;
  level: number;
  description: string;
  worldMapLocation: ShortcutWorldTile | null;
  worldLocation: ShortcutWorldTile | null;
  objectIds: readonly number[];
};

export const RUNELITE_AGILITY_SHORTCUT_ENTRIES: readonly RuneliteAgilityShortcutEntry[] = [
  {
    key: "ARCEUUS_ESSENCE_MINE_BOULDER",
    level: 49,
    description: "Boulder",
    worldMapLocation: { x: 1774, y: 3888, z: 0 },
    worldLocation: { x: 1774, y: 3888, z: 0 },
    objectIds: [27990],
  },
  {
    key: "ARCEUUS_ESSENCE_MINE_EAST_SCRAMBLE",
    level: 52,
    description: "Rock Climb",
    worldMapLocation: { x: 1770, y: 3851, z: 0 },
    worldLocation: { x: 1770, y: 3851, z: 0 },
    objectIds: [27987, 27988],
  },
  {
    key: "ARCEUUS_ESSENCE_NORTH",
    level: 69,
    description: "Rock Climb",
    worldMapLocation: { x: 1759, y: 3873, z: 0 },
    worldLocation: { x: 1759, y: 3873, z: 0 },
    objectIds: [34741],
  },
  {
    key: "ARCEUUS_ESSENCE_MINE_WEST",
    level: 73,
    description: "Rock Climb",
    worldMapLocation: { x: 1742, y: 3853, z: 0 },
    worldLocation: { x: 1742, y: 3853, z: 0 },
    objectIds: [27984, 27985],
  },
] as const;

const shortcutEntriesByObjectId = new Map<number, RuneliteAgilityShortcutEntry[]>();
for (const entry of RUNELITE_AGILITY_SHORTCUT_ENTRIES) {
  for (const objectId of entry.objectIds) {
    const entries = shortcutEntriesByObjectId.get(objectId) ?? [];
    entries.push(entry);
    shortcutEntriesByObjectId.set(objectId, entries);
  }
}

export const RUNELITE_AGILITY_SHORTCUT_OBJECT_IDS = [...shortcutEntriesByObjectId.keys()].sort((a, b) => a - b);

export function isRuneliteAgilityShortcutObjectId(objectId: number): boolean {
  return shortcutEntriesByObjectId.has(objectId);
}

export function getRuneliteAgilityShortcutsForObjectId(objectId: number): readonly RuneliteAgilityShortcutEntry[] {
  return shortcutEntriesByObjectId.get(objectId) ?? [];
}

function getWorldTileDistance(
  a: Pick<WorldTile, "x" | "y" | "z">,
  b: Pick<WorldTile, "x" | "y" | "z">,
): number {
  if (a.z !== b.z) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function getRuneliteAgilityShortcutForObject(params: {
  objectId: number;
  worldX: number;
  worldY: number;
  z: number;
}): RuneliteAgilityShortcutEntry | null {
  const entries = getRuneliteAgilityShortcutsForObjectId(params.objectId);
  if (entries.length === 0) {
    return null;
  }

  const objectTile = { x: params.worldX, y: params.worldY, z: params.z };
  return [...entries].sort((a, b) => {
    const aDistance = a.worldLocation ? getWorldTileDistance(objectTile, a.worldLocation) : 0;
    const bDistance = b.worldLocation ? getWorldTileDistance(objectTile, b.worldLocation) : 0;
    return aDistance - bDistance || a.level - b.level || a.key.localeCompare(b.key);
  })[0];
}
