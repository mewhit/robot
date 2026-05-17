import { loadOsrsRegionLocations, OsrsLocation } from "./locations-loader";
import { loadOsrsMapRegion } from "./map-loader";
import { loadOsrsObjectDefinitionsFromCache, getOsrsRegionArchiveId } from "./osrs-region-cache";
import {
  OSRS_CACHE_INDEX_CONFIGS,
  OSRS_CACHE_INDEX_MAPS,
  OSRS_MAP_LOCATIONS_FILE_ID,
  OSRS_MAP_TERRAIN_FILE_ID,
  openOsrsCacheStore,
} from "./cache-store";
import {
  buildOsrsRegionCollision,
  CollisionFlag,
  getRegionCollisionFlags,
  isKnownWalkableBridgeSurfaceObject,
} from "./region-collision";
import { getRuneliteAgilityObstacleKey, isRuneliteAgilityObstacleId } from "./runelite-agility-obstacles";
import { OsrsObjectDefinition, OsrsObjectDefinitionMap } from "./object-loader";
import {
  loadOsrsAreaDefinitions,
  OSRS_AREA_DEFINITION_ARCHIVE_ID,
  OsrsAreaDefinitionMap,
} from "./area-loader";
import { resolveOsrsMapIconLabel } from "./map-icon-labels";
import {
  getRuneliteAgilityShortcutForObject,
  isRuneliteAgilityShortcutObjectId,
} from "./runelite-agility-shortcuts";

export type OsrsCacheMapTile = {
  localX: number;
  localY: number;
  worldX: number;
  worldY: number;
  z: number;
  flags: number;
  terrainSettings: number;
  height: number;
  underlayId: number;
  overlayId: number;
  overlayPath: number;
  overlayRotation: number;
  blocked: boolean;
  projectileBlocked: boolean;
};

export type OsrsCacheMapObject = {
  id: number;
  name: string;
  type: number;
  orientation: number;
  localX: number;
  localY: number;
  worldX: number;
  worldY: number;
  z: number;
  sizeX: number;
  sizeY: number;
  definitionSizeX: number;
  definitionSizeY: number;
  interactType: number;
  blocksProjectile: boolean;
  wallOrDoor: number;
  mapAreaId: number;
  clipped: boolean;
  modelClipped: boolean;
  obstructsGround: boolean;
  isHollow: boolean;
  supportsItems: number;
  agilityObstacle: boolean;
  agilityObstacleKey: string | null;
  agilityShortcut: boolean;
  agilityShortcutKey: string | null;
  agilityShortcutLevel: number | null;
  agilityShortcutDescription: string | null;
};

export type OsrsCacheMapIcon = {
  areaId: number;
  spriteId: number;
  name: string | null;
  label: string | null;
  category: number;
  objectId: number;
  objectName: string;
  type: number;
  orientation: number;
  localX: number;
  localY: number;
  worldX: number;
  worldY: number;
  z: number;
};

export type OsrsCacheMapRegionView = {
  cacheDirectoryPath: string;
  regionId: number;
  regionX: number;
  regionY: number;
  baseX: number;
  baseY: number;
  missing?: boolean;
  error?: string;
  objectDefinitionCount: number;
  locationCount: number;
  tiles: OsrsCacheMapTile[];
  objects: OsrsCacheMapObject[];
  icons: OsrsCacheMapIcon[];
};

let cachedObjectDefinitions: OsrsObjectDefinitionMap | null = null;
let cachedAreaDefinitions: OsrsAreaDefinitionMap | null = null;

function createEmptyCacheMapRegionView(params: {
  cacheDirectoryPath: string;
  regionX: number;
  regionY: number;
  objectDefinitionCount?: number;
  error?: string;
}): OsrsCacheMapRegionView {
  const archiveId = getOsrsRegionArchiveId(params.regionX, params.regionY);
  return {
    cacheDirectoryPath: params.cacheDirectoryPath,
    regionId: archiveId,
    regionX: params.regionX,
    regionY: params.regionY,
    baseX: params.regionX * 64,
    baseY: params.regionY * 64,
    missing: true,
    error: params.error,
    objectDefinitionCount: params.objectDefinitionCount ?? 0,
    locationCount: 0,
    tiles: [],
    objects: [],
    icons: [],
  };
}

function getRotatedFootprint(
  definition: Pick<OsrsObjectDefinition, "sizeX" | "sizeY">,
  orientation: number,
): { sizeX: number; sizeY: number } {
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

function shouldIncludeMapObject(location: OsrsLocation, definition: OsrsObjectDefinition): boolean {
  if (isRuneliteAgilityObstacleId(location.id)) {
    return true;
  }

  if (isRuneliteAgilityShortcutObjectId(location.id)) {
    return true;
  }

  if (definition.interactType === 0) {
    return false;
  }

  if (location.type === 22) {
    return definition.interactType === 1;
  }

  if (isKnownWalkableBridgeSurfaceObject(location, definition)) {
    return false;
  }

  return (
    (location.type >= 0 && location.type <= 3) ||
    location.type === 9 ||
    location.type === 10 ||
    location.type === 11 ||
    location.type >= 12
  );
}

function toMapObject(location: OsrsLocation, definition: OsrsObjectDefinition): OsrsCacheMapObject {
  const footprint =
    location.type === 10 || location.type === 11 || location.type >= 12
      ? getRotatedFootprint(definition, location.orientation)
      : { sizeX: 1, sizeY: 1 };
  const agilityObstacleKey = getRuneliteAgilityObstacleKey(location.id);
  const agilityShortcut = getRuneliteAgilityShortcutForObject({
    objectId: location.id,
    worldX: location.worldX,
    worldY: location.worldY,
    z: location.z,
  });

  return {
    id: location.id,
    name: definition.name,
    type: location.type,
    orientation: location.orientation,
    localX: location.localX,
    localY: location.localY,
    worldX: location.worldX,
    worldY: location.worldY,
    z: location.z,
    sizeX: footprint.sizeX,
    sizeY: footprint.sizeY,
    definitionSizeX: definition.sizeX,
    definitionSizeY: definition.sizeY,
    interactType: definition.interactType,
    blocksProjectile: definition.blocksProjectile,
    wallOrDoor: definition.wallOrDoor,
    mapAreaId: definition.mapAreaId,
    clipped: definition.clipped,
    modelClipped: definition.modelClipped,
    obstructsGround: definition.obstructsGround,
    isHollow: definition.isHollow,
    supportsItems: definition.supportsItems,
    agilityObstacle: agilityObstacleKey !== null || agilityShortcut !== null,
    agilityObstacleKey: agilityObstacleKey ?? agilityShortcut?.key ?? null,
    agilityShortcut: agilityShortcut !== null,
    agilityShortcutKey: agilityShortcut?.key ?? null,
    agilityShortcutLevel: agilityShortcut?.level ?? null,
    agilityShortcutDescription: agilityShortcut?.description ?? null,
  };
}

function toMapIcon(location: OsrsLocation, definition: OsrsObjectDefinition, areas: OsrsAreaDefinitionMap): OsrsCacheMapIcon | null {
  if (definition.mapAreaId < 0) {
    return null;
  }

  const area = areas.get(definition.mapAreaId);
  if (!area) {
    return null;
  }

  return {
    areaId: area.id,
    spriteId: area.spriteId,
    name: area.name,
    label: resolveOsrsMapIconLabel({
      areaName: area.name,
      spriteId: area.spriteId,
      objectName: definition.name,
    }),
    category: area.category,
    objectId: location.id,
    objectName: definition.name,
    type: location.type,
    orientation: location.orientation,
    localX: location.localX,
    localY: location.localY,
    worldX: location.worldX,
    worldY: location.worldY,
    z: location.z,
  };
}

export function readOsrsCacheMapRegionView(params: {
  regionX: number;
  regionY: number;
  cacheDirectoryPath?: string;
}): OsrsCacheMapRegionView {
  const store = openOsrsCacheStore(params.cacheDirectoryPath);
  try {
    const objectDefinitions = cachedObjectDefinitions ?? loadOsrsObjectDefinitionsFromCache(store);
    cachedObjectDefinitions = objectDefinitions;
    const areaDefinitions =
      cachedAreaDefinitions ??
      loadOsrsAreaDefinitions(store.readArchive(OSRS_CACHE_INDEX_CONFIGS, OSRS_AREA_DEFINITION_ARCHIVE_ID).files.entries());
    cachedAreaDefinitions = areaDefinitions;

    const archiveId = getOsrsRegionArchiveId(params.regionX, params.regionY);
    let mapData: Buffer;
    let locationData: Buffer;
    try {
      mapData = store.readArchiveFile(OSRS_CACHE_INDEX_MAPS, archiveId, OSRS_MAP_TERRAIN_FILE_ID);
      locationData = store.readArchiveFile(OSRS_CACHE_INDEX_MAPS, archiveId, OSRS_MAP_LOCATIONS_FILE_ID);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createEmptyCacheMapRegionView({
        cacheDirectoryPath: store.directoryPath,
        regionX: params.regionX,
        regionY: params.regionY,
        objectDefinitionCount: objectDefinitions.size,
        error: message,
      });
    }
    const mapRegion = loadOsrsMapRegion(mapData, params.regionX, params.regionY);
    const regionLocations = loadOsrsRegionLocations(locationData, params.regionX, params.regionY);
    const collision = buildOsrsRegionCollision(mapRegion, regionLocations, objectDefinitions);
    const baseX = params.regionX * 64;
    const baseY = params.regionY * 64;
    const tiles: OsrsCacheMapTile[] = [];

    for (let z = 0; z < 4; z += 1) {
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          const terrainTile = mapRegion.tiles[z][x][y];
          const flags = getRegionCollisionFlags(collision, x, y, z);
          tiles.push({
            localX: x,
            localY: y,
            worldX: baseX + x,
            worldY: baseY + y,
            z,
            flags,
            terrainSettings: terrainTile.settings,
            height: terrainTile.height,
            underlayId: terrainTile.underlayId,
            overlayId: terrainTile.overlayId,
            overlayPath: terrainTile.overlayPath,
            overlayRotation: terrainTile.overlayRotation,
            blocked: (flags & CollisionFlag.Blocked) !== 0,
            projectileBlocked: (flags & CollisionFlag.Projectile) !== 0,
          });
        }
      }
    }

    const objects: OsrsCacheMapObject[] = [];
    const icons: OsrsCacheMapIcon[] = [];
    for (const location of regionLocations.locations) {
      const definition = objectDefinitions.get(location.id);
      if (!definition) {
        continue;
      }

      const icon = toMapIcon(location, definition, areaDefinitions);
      if (icon) {
        icons.push(icon);
      }

      if (shouldIncludeMapObject(location, definition)) {
        objects.push(toMapObject(location, definition));
      }
    }

    return {
      cacheDirectoryPath: store.directoryPath,
      regionId: archiveId,
      regionX: params.regionX,
      regionY: params.regionY,
      baseX,
      baseY,
      objectDefinitionCount: objectDefinitions.size,
      locationCount: regionLocations.locations.length,
      tiles,
      objects,
      icons,
    };
  } finally {
    store.close();
  }
}
