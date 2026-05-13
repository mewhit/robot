import {
  OSRS_CACHE_INDEX_CONFIGS,
  OSRS_CACHE_INDEX_MAPS,
  OSRS_MAP_LOCATIONS_FILE_ID,
  OSRS_MAP_TERRAIN_FILE_ID,
  OSRS_OBJECT_DEFINITION_ARCHIVE_ID,
  OsrsCacheStore,
  openOsrsCacheStore,
} from "./cache-store";
import { loadOsrsRegionLocations } from "./locations-loader";
import { loadOsrsMapRegion } from "./map-loader";
import { loadOsrsObjectDefinitions, OsrsObjectDefinitionMap } from "./object-loader";
import {
  BuildRegionCollisionOptions,
  OsrsRegionCollision,
  buildOsrsRegionCollision,
} from "./region-collision";
import { XteaKey } from "./xtea";

export type OsrsRegionCacheData = {
  regionX: number;
  regionY: number;
  mapData: Buffer;
  locationData: Buffer;
  objectDefinitions: OsrsObjectDefinitionMap;
};

export function loadOsrsRegionCollisionFromCacheData(
  data: OsrsRegionCacheData,
  options?: BuildRegionCollisionOptions,
): OsrsRegionCollision {
  const mapRegion = loadOsrsMapRegion(data.mapData, data.regionX, data.regionY);
  const locations = loadOsrsRegionLocations(data.locationData, data.regionX, data.regionY);
  return buildOsrsRegionCollision(mapRegion, locations, data.objectDefinitions, options);
}

export function getOsrsRegionArchiveId(regionX: number, regionY: number): number {
  return (regionX << 8) | regionY;
}

export function loadOsrsObjectDefinitionsFromCache(store: OsrsCacheStore): OsrsObjectDefinitionMap {
  const objectArchive = store.readArchive(OSRS_CACHE_INDEX_CONFIGS, OSRS_OBJECT_DEFINITION_ARCHIVE_ID);
  return loadOsrsObjectDefinitions(objectArchive.files.entries(), {
    rev220SoundData: (objectArchive.reference?.revision ?? 0) >= 1673,
  });
}

export function loadOsrsRegionCacheDataFromStore(params: {
  store: OsrsCacheStore;
  regionX: number;
  regionY: number;
  locationXteaKey?: XteaKey;
  objectDefinitions?: OsrsObjectDefinitionMap;
}): OsrsRegionCacheData {
  const archiveId = getOsrsRegionArchiveId(params.regionX, params.regionY);
  return {
    regionX: params.regionX,
    regionY: params.regionY,
    mapData: params.store.readArchiveFile(OSRS_CACHE_INDEX_MAPS, archiveId, OSRS_MAP_TERRAIN_FILE_ID),
    locationData: params.store.readArchiveFile(
      OSRS_CACHE_INDEX_MAPS,
      archiveId,
      OSRS_MAP_LOCATIONS_FILE_ID,
      params.locationXteaKey,
    ),
    objectDefinitions: params.objectDefinitions ?? loadOsrsObjectDefinitionsFromCache(params.store),
  };
}

export function loadOsrsRegionCollisionFromCache(params: {
  regionX: number;
  regionY: number;
  cacheDirectoryPath?: string;
  locationXteaKey?: XteaKey;
  collisionOptions?: BuildRegionCollisionOptions;
}): OsrsRegionCollision {
  const store = openOsrsCacheStore(params.cacheDirectoryPath);
  try {
    return loadOsrsRegionCollisionFromCacheData(
      loadOsrsRegionCacheDataFromStore({
        store,
        regionX: params.regionX,
        regionY: params.regionY,
        locationXteaKey: params.locationXteaKey,
      }),
      params.collisionOptions,
    );
  } finally {
    store.close();
  }
}
