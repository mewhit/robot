import { promises as fs } from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, describe, expect, it } from "vitest";
import { OSRS_AREA_DEFINITION_ARCHIVE_ID } from "./area-loader";
import { decompressCacheContainer } from "./cache-container";
import { readOsrsCacheMapRegionView } from "./cache-map-view";
import {
  findOsrsCacheDirectory,
  openOsrsCacheStore,
  OSRS_CACHE_INDEX_CONFIGS,
  OSRS_CACHE_INDEX_MAPS,
  OSRS_MAP_LOCATIONS_FILE_ID,
  OSRS_MAP_TERRAIN_FILE_ID,
  OSRS_OBJECT_DEFINITION_ARCHIVE_ID,
} from "./cache-store";
import { loadOsrsRegionLocations } from "./locations-loader";
import { loadOsrsMapRegion, OSRS_PLANES, OSRS_REGION_SIZE, OsrsMapRegion } from "./map-loader";
import { loadOsrsObjectDefinition, OsrsObjectDefinition } from "./object-loader";
import {
  getOsrsRegionArchiveId,
  loadOsrsObjectDefinitionsFromCache,
  loadOsrsRegionCacheDataFromStore,
  loadOsrsRegionCollisionFromCacheData,
} from "./osrs-region-cache";
import {
  getRuneliteAgilityObstacleKey,
  isRuneliteAgilityObstacleId,
  RUNELITE_AGILITY_OBSTACLE_IDS,
} from "./runelite-agility-obstacles";
import {
  getRuneliteAgilityShortcutForObject,
  isRuneliteAgilityShortcutObjectId,
  RUNELITE_AGILITY_SHORTCUT_OBJECT_IDS,
} from "./runelite-agility-shortcuts";
import {
  CollisionFlag,
  buildOsrsRegionCollision,
  canMoveWithinRegion,
  findRegionPath,
  getRegionCollisionFlags,
  isRegionTileBlocked,
} from "./region-collision";
import { encryptXtea, XteaKey, decryptXtea } from "./xtea";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    }),
  );
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "robot-osrs-cache-"));
  tempRoots.push(root);
  return root;
}

function writeUnsignedShortSmart(output: number[], value: number): void {
  if (value < 128) {
    output.push(value);
    return;
  }

  const encoded = value + 32768;
  output.push((encoded >> 8) & 0xff, encoded & 0xff);
}

function writeMedium(buffer: Buffer, offset: number, value: number): void {
  buffer[offset] = (value >> 16) & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = value & 0xff;
}

function writeInt(output: number[], value: number): void {
  output.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

function writeUnsignedShort(output: number[], value: number): void {
  output.push((value >> 8) & 0xff, value & 0xff);
}

function writeShort(output: number[], value: number): void {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value, 0);
  output.push(buffer[0], buffer[1]);
}

function writeTerrainAttributes(output: number[], attributes: readonly number[]): void {
  for (let i = 0; i < attributes.length; i += 1) {
    const attribute = attributes[i];
    writeUnsignedShort(output, attribute);

    if (attribute === 0) {
      return;
    }

    if (attribute === 1) {
      output.push(attributes[i + 1] ?? 0);
      return;
    }

    if (attribute <= 49) {
      i += 1;
      writeShort(output, attributes[i] ?? 0);
    }
  }
}

function createCacheContainer(data: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0);
  header.writeInt32BE(data.length, 1);
  return Buffer.concat([header, data]);
}

function createReferenceTable(archives: Array<{ id: number; fileIds: number[] }>): Buffer {
  const sortedArchives = [...archives].sort((a, b) => a.id - b.id);
  const output: number[] = [7, 0, 0, 0, 1, 4];
  writeUnsignedShort(output, sortedArchives.length);

  let lastArchiveId = 0;
  for (const archive of sortedArchives) {
    writeUnsignedShort(output, archive.id - lastArchiveId);
    lastArchiveId = archive.id;
  }

  for (const archive of sortedArchives) {
    writeInt(output, archive.id);
  }

  for (const archive of sortedArchives) {
    writeInt(output, 0);
    writeInt(output, 0);
  }

  for (const archive of sortedArchives) {
    writeInt(output, 1);
    writeUnsignedShort(output, archive.fileIds.length);
  }

  for (const archive of sortedArchives) {
    let lastFileId = 0;
    for (const fileId of archive.fileIds) {
      writeUnsignedShort(output, fileId - lastFileId);
      lastFileId = fileId;
    }
  }

  return createCacheContainer(Buffer.from(output));
}

function createArchiveData(files: Buffer[]): Buffer {
  if (files.length === 1) {
    return createCacheContainer(files[0]);
  }

  const footer = Buffer.alloc(files.length * 4 + 1);
  let previousSize = 0;
  for (let i = 0; i < files.length; i += 1) {
    const delta = files[i].length - previousSize;
    footer.writeInt32BE(delta, i * 4);
    previousSize = files[i].length;
  }
  footer[footer.length - 1] = 1;
  return createCacheContainer(Buffer.concat([...files, footer]));
}

async function createSyntheticCacheStore(files: Record<string, Buffer>): Promise<string> {
  const root = await createTempRoot();
  const sectors: Buffer[] = [Buffer.alloc(520)];
  const indexEntries = new Map<number, Map<number, { size: number; sector: number }>>();

  for (const [key, data] of Object.entries(files)) {
    const [indexId, archiveId] = key.split(":").map(Number);
    const firstSector = sectors.length;
    let offset = 0;
    let chunk = 0;
    while (offset < data.length) {
      const sector = Buffer.alloc(520);
      const nextSector = offset + 512 < data.length ? sectors.length + 1 : 0;
      sector.writeUInt16BE(archiveId, 0);
      sector.writeUInt16BE(chunk, 2);
      writeMedium(sector, 4, nextSector);
      sector[7] = indexId;
      const payloadSize = Math.min(512, data.length - offset);
      data.copy(sector, 8, offset, offset + payloadSize);
      sectors.push(sector);
      offset += payloadSize;
      chunk += 1;
    }

    const index = indexEntries.get(indexId) ?? new Map<number, { size: number; sector: number }>();
    index.set(archiveId, { size: data.length, sector: firstSector });
    indexEntries.set(indexId, index);
  }

  await fs.writeFile(path.join(root, "main_file_cache.dat2"), Buffer.concat(sectors));
  for (const [indexId, entries] of indexEntries) {
    const maxArchiveId = Math.max(...entries.keys());
    const indexFile = Buffer.alloc((maxArchiveId + 1) * 6);
    for (const [archiveId, entry] of entries) {
      writeMedium(indexFile, archiveId * 6, entry.size);
      writeMedium(indexFile, archiveId * 6 + 3, entry.sector);
    }

    await fs.writeFile(path.join(root, `main_file_cache.idx${indexId}`), indexFile);
  }

  return root;
}

function createEmptyMapData(overrides: Record<string, readonly number[]> = {}): Buffer {
  const output: number[] = [];
  for (let z = 0; z < OSRS_PLANES; z += 1) {
    for (let x = 0; x < OSRS_REGION_SIZE; x += 1) {
      for (let y = 0; y < OSRS_REGION_SIZE; y += 1) {
        const attributes = overrides[`${x},${y},${z}`] ?? [82, 0];
        writeTerrainAttributes(output, attributes);
      }
    }
  }

  return Buffer.from(output);
}

function createLocationData(location: {
  id: number;
  localX: number;
  localY: number;
  z: number;
  type: number;
  orientation: number;
}): Buffer {
  const output: number[] = [];
  writeUnsignedShortSmart(output, location.id + 1);
  writeUnsignedShortSmart(output, (location.z << 12) + (location.localX << 6) + location.localY + 1);
  output.push((location.type << 2) | location.orientation);
  writeUnsignedShortSmart(output, 0);
  writeUnsignedShortSmart(output, 0);
  return Buffer.from(output);
}

function createObjectData(
  options: Partial<Pick<OsrsObjectDefinition, "name" | "sizeX" | "sizeY" | "wallOrDoor" | "interactType">> = {},
): Buffer {
  const name = options.name ?? "Test object";
  return Buffer.from([
    2,
    ...Buffer.from(name, "latin1"),
    0,
    14,
    options.sizeX ?? 1,
    15,
    options.sizeY ?? 1,
    ...(options.interactType === 0 ? [17] : []),
    ...(options.interactType === 1 ? [27] : []),
    ...(options.wallOrDoor === undefined ? [] : [19, options.wallOrDoor]),
    0,
  ]);
}

function createEmptyMapRegion(): OsrsMapRegion {
  return loadOsrsMapRegion(createEmptyMapData(), 50, 50);
}

describe("OSRS cache loaders", () => {
  it("round-trips XTEA block encryption", () => {
    const key: XteaKey = [0x12345678, 0x0badc0de, 0xfeedface, 0x01020304];
    const plain = Buffer.from("12345678ABCDEFGH");

    const encrypted = encryptXtea(plain, key);
    expect(encrypted.equals(plain)).toBe(false);
    expect(decryptXtea(encrypted, key).equals(plain)).toBe(true);
  });

  it("decompresses uncompressed and gzip cache containers", () => {
    const plain = Buffer.from("cache payload", "utf8");
    const noneHeader = Buffer.alloc(5);
    noneHeader.writeUInt8(0, 0);
    noneHeader.writeInt32BE(plain.length, 1);

    expect(decompressCacheContainer(Buffer.concat([noneHeader, plain])).data.toString("utf8")).toBe("cache payload");

    const compressed = zlib.gzipSync(plain);
    const gzipHeader = Buffer.alloc(9);
    gzipHeader.writeUInt8(2, 0);
    gzipHeader.writeInt32BE(compressed.length, 1);
    gzipHeader.writeInt32BE(plain.length, 5);

    expect(decompressCacheContainer(Buffer.concat([gzipHeader, compressed])).data.toString("utf8")).toBe("cache payload");
  });

  it("loads terrain attributes from map data", () => {
    const region = loadOsrsMapRegion(
      createEmptyMapData({
        "3,4,0": [50, 0],
        "4,5,0": [153, 0],
        "6,7,0": [2, 72, 0],
      }),
      50,
      50,
    );

    expect(region.tiles[0][3][4].settings).toBe(1);
    expect(region.tiles[0][3][5].settings).toBe(0);
    expect(region.tiles[0][4][5].underlayId).toBe(72);
    expect(region.tiles[0][6][7].overlayId).toBe(72);
    expect(region.tiles[0][6][7].overlayPath).toBe(0);
    expect(region.tiles[0][6][7].overlayRotation).toBe(0);
  });

  it("blocks movement for terrain setting bit 0", () => {
    const mapRegion = loadOsrsMapRegion(createEmptyMapData({ "3,4,0": [50, 0] }), 50, 50);
    const locations = loadOsrsRegionLocations(Buffer.from([0]), 50, 50);
    const collision = buildOsrsRegionCollision(mapRegion, locations, new Map());

    expect(isRegionTileBlocked(collision, 3, 4, 0)).toBe(true);
    expect(isRegionTileBlocked(collision, 3, 5, 0)).toBe(false);
  });

  it("loads location ids and packed local coordinates", () => {
    const region = loadOsrsRegionLocations(
      createLocationData({ id: 42, localX: 3, localY: 4, z: 2, type: 10, orientation: 1 }),
      50,
      51,
    );

    expect(region.locations).toEqual([
      {
        id: 42,
        type: 10,
        orientation: 1,
        localX: 3,
        localY: 4,
        z: 2,
        worldX: 3203,
        worldY: 3268,
      },
    ]);
  });

  it("loads object footprint metadata", () => {
    const object = loadOsrsObjectDefinition(42, createObjectData({ name: "Rockfall", sizeX: 2, sizeY: 3 }));

    expect(object).toMatchObject({
      id: 42,
      name: "Rockfall",
      sizeX: 2,
      sizeY: 3,
      interactType: 2,
      blocksProjectile: true,
    });
  });

  it("copies RuneLite agility obstacle ids as local numeric ids", () => {
    expect(RUNELITE_AGILITY_OBSTACLE_IDS).toHaveLength(269);
    expect(isRuneliteAgilityObstacleId(23134)).toBe(true);
    expect(getRuneliteAgilityObstacleKey(23134)).toBe("OBSTICAL_NET2");
    expect(getRuneliteAgilityObstacleKey(55194)).toBe("VARLAMORE_WYRM_AGILITY_ADVANCED_BALANCE_1_TRIGGER");
    expect(isRuneliteAgilityObstacleId(27987)).toBe(false);
  });

  it("copies RuneLite agility shortcut levels for Arceuus dense essence mine", () => {
    expect(RUNELITE_AGILITY_SHORTCUT_OBJECT_IDS).toEqual([27984, 27985, 27987, 27988, 27990, 34741]);
    expect(isRuneliteAgilityShortcutObjectId(27987)).toBe(true);
    expect(getRuneliteAgilityShortcutForObject({ objectId: 27987, worldX: 1773, worldY: 3849, z: 0 })).toMatchObject({
      key: "ARCEUUS_ESSENCE_MINE_EAST_SCRAMBLE",
      level: 52,
      description: "Rock Climb",
    });
    expect(getRuneliteAgilityShortcutForObject({ objectId: 34741, worldX: 1761, worldY: 3873, z: 0 })).toMatchObject({
      key: "ARCEUUS_ESSENCE_NORTH",
      level: 69,
    });
  });

  it("builds object collision with rotated footprint", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 42, localX: 10, localY: 10, z: 0, type: 10, orientation: 1 }),
      50,
      50,
    );
    const definitions = new Map([[42, loadOsrsObjectDefinition(42, createObjectData({ sizeX: 2, sizeY: 3 }))]]);

    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);

    expect(isRegionTileBlocked(collision, 10, 10, 0)).toBe(true);
    expect(isRegionTileBlocked(collision, 12, 11, 0)).toBe(true);
    expect(isRegionTileBlocked(collision, 11, 12, 0)).toBe(false);
    expect(getRegionCollisionFlags(collision, 10, 10, 0) & CollisionFlag.Projectile).not.toBe(0);
  });

  it("does not treat non-floor-blocking type 22 decorations as game objects", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 42, localX: 18, localY: 19, z: 0, type: 22, orientation: 3 }),
      50,
      50,
    );
    const definitions = new Map([[42, loadOsrsObjectDefinition(42, createObjectData({ name: "null" }))]]);

    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);

    expect(isRegionTileBlocked(collision, 18, 19, 0)).toBe(false);
  });

  it("does not block known walkable Lumbridge bridge surface objects", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 3002, localX: 44, localY: 26, z: 0, type: 10, orientation: 2 }),
      50,
      50,
    );
    const definitions = new Map([[3002, loadOsrsObjectDefinition(3002, createObjectData({ name: "null" }))]]);

    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);

    expect(isRegionTileBlocked(collision, 44, 26, 0)).toBe(false);
  });

  it("does not block movement for interactable type 22 ground objects", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 42, localX: 18, localY: 19, z: 0, type: 22, orientation: 3 }),
      50,
      50,
    );
    const definitions = new Map([[42, loadOsrsObjectDefinition(42, createObjectData({ interactType: 1 }))]]);

    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);
    const flags = getRegionCollisionFlags(collision, 18, 19, 0);

    expect(flags & CollisionFlag.Blocked).toBe(0);
    expect(flags & CollisionFlag.Projectile).toBe(0);
  });

  it("blocks terrain tiles without a floor", () => {
    const mapRegion = loadOsrsMapRegion(createEmptyMapData({ "12,35,0": [0] }), 50, 50);
    const locations = loadOsrsRegionLocations(Buffer.from([0]), 50, 50);
    const collision = buildOsrsRegionCollision(mapRegion, locations, new Map(), { blockNoFloorTiles: true });

    expect(isRegionTileBlocked(collision, 12, 35, 0)).toBe(true);
    expect(isRegionTileBlocked(collision, 12, 34, 0)).toBe(false);
  });

  it("loads region collision through the cache-data facade", () => {
    const definitions = new Map([[42, loadOsrsObjectDefinition(42, createObjectData({ sizeX: 1, sizeY: 1 }))]]);
    const collision = loadOsrsRegionCollisionFromCacheData({
      regionX: 50,
      regionY: 50,
      mapData: createEmptyMapData(),
      locationData: createLocationData({ id: 42, localX: 8, localY: 9, z: 0, type: 10, orientation: 0 }),
      objectDefinitions: definitions,
    });

    expect(isRegionTileBlocked(collision, 8, 9, 0)).toBe(true);
  });

  it("uses bridge render flags to expose logical object and terrain planes", async () => {
    const regionX = 50;
    const regionY = 50;
    const regionArchiveId = getOsrsRegionArchiveId(regionX, regionY);
    const mapData = createEmptyMapData({
      "10,10,1": [51, 0],
    });
    const locationData = createLocationData({ id: 42, localX: 10, localY: 10, z: 3, type: 10, orientation: 0 });
    const objectData = createObjectData({ sizeX: 1, sizeY: 1 });
    const root = await createSyntheticCacheStore({
      [`255:${OSRS_CACHE_INDEX_MAPS}`]: createReferenceTable([
        {
          id: regionArchiveId,
          fileIds: [OSRS_MAP_TERRAIN_FILE_ID, OSRS_MAP_LOCATIONS_FILE_ID],
        },
      ]),
      [`255:${OSRS_CACHE_INDEX_CONFIGS}`]: createReferenceTable([
        {
          id: OSRS_OBJECT_DEFINITION_ARCHIVE_ID,
          fileIds: [42],
        },
        {
          id: OSRS_AREA_DEFINITION_ARCHIVE_ID,
          fileIds: [0],
        },
      ]),
      [`${OSRS_CACHE_INDEX_MAPS}:${regionArchiveId}`]: createArchiveData([mapData, locationData]),
      [`${OSRS_CACHE_INDEX_CONFIGS}:${OSRS_OBJECT_DEFINITION_ARCHIVE_ID}`]: createArchiveData([objectData]),
      [`${OSRS_CACHE_INDEX_CONFIGS}:${OSRS_AREA_DEFINITION_ARCHIVE_ID}`]: createArchiveData([Buffer.from([0])]),
    });

    const view = readOsrsCacheMapRegionView({ regionX, regionY, cacheDirectoryPath: root });
    const object = view.objects.find((candidate) => candidate.id === 42);
    const logicalRoofTile = view.tiles.find((tile) => tile.localX === 10 && tile.localY === 10 && tile.z === 2);
    const shiftedAwayTopTile = view.tiles.find((tile) => tile.localX === 10 && tile.localY === 10 && tile.z === 3);

    expect(object).toMatchObject({ rawZ: 3, z: 2 });
    expect(logicalRoofTile).toMatchObject({ z: 2, terrainZ: 3, blocked: true });
    expect(shiftedAwayTopTile).toMatchObject({ z: 3, terrainZ: null, blocked: true });
  });

  it("loads map, locations, and object definitions from a real cache-store layout", async () => {
    const regionX = 50;
    const regionY = 50;
    const regionArchiveId = getOsrsRegionArchiveId(regionX, regionY);
    const mapData = createEmptyMapData();
    const locationData = createLocationData({ id: 42, localX: 8, localY: 9, z: 0, type: 10, orientation: 0 });
    const objectData = createObjectData({ sizeX: 1, sizeY: 1 });
    const root = await createSyntheticCacheStore({
      [`255:${OSRS_CACHE_INDEX_MAPS}`]: createReferenceTable([
        {
          id: regionArchiveId,
          fileIds: [OSRS_MAP_TERRAIN_FILE_ID, OSRS_MAP_LOCATIONS_FILE_ID],
        },
      ]),
      [`255:${OSRS_CACHE_INDEX_CONFIGS}`]: createReferenceTable([
        {
          id: OSRS_OBJECT_DEFINITION_ARCHIVE_ID,
          fileIds: [42],
        },
      ]),
      [`${OSRS_CACHE_INDEX_MAPS}:${regionArchiveId}`]: createArchiveData([mapData, locationData]),
      [`${OSRS_CACHE_INDEX_CONFIGS}:${OSRS_OBJECT_DEFINITION_ARCHIVE_ID}`]: createArchiveData([objectData]),
    });
    const store = openOsrsCacheStore(root);
    try {
      const objectDefinitions = loadOsrsObjectDefinitionsFromCache(store);
      const cacheData = loadOsrsRegionCacheDataFromStore({
        store,
        regionX,
        regionY,
        objectDefinitions,
      });
      const collision = loadOsrsRegionCollisionFromCacheData(cacheData);

      expect(cacheData.mapData.equals(mapData)).toBe(true);
      expect(cacheData.locationData.equals(locationData)).toBe(true);
      expect(objectDefinitions.get(42)?.sizeX).toBe(1);
      expect(isRegionTileBlocked(collision, 8, 9, 0)).toBe(true);
    } finally {
      store.close();
    }
  });

  it.runIf(Boolean(findOsrsCacheDirectory()))("loads terrain and location files from the installed OSRS cache", () => {
    const store = openOsrsCacheStore();
    try {
      const cacheData = loadOsrsRegionCacheDataFromStore({
        store,
        regionX: 50,
        regionY: 50,
        objectDefinitions: new Map(),
      });

      expect(cacheData.mapData.length).toBeGreaterThan(16_384);
      expect(cacheData.locationData.length).toBeGreaterThan(0);
      expect(() => loadOsrsMapRegion(cacheData.mapData, 50, 50)).not.toThrow();
      expect(() => loadOsrsRegionLocations(cacheData.locationData, 50, 50)).not.toThrow();
    } finally {
      store.close();
    }
  });

  it("adds directional wall blockers", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 7, localX: 20, localY: 20, z: 0, type: 0, orientation: 0 }),
      50,
      50,
    );
    const definitions = new Map([[7, loadOsrsObjectDefinition(7, createObjectData())]]);

    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);

    expect(canMoveWithinRegion(collision, 20, 20, 0, -1, 0)).toBe(false);
    expect(canMoveWithinRegion(collision, 20, 20, 0, 0, 1)).toBe(true);
  });

  it("allows paths through named door wall blockers", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 7, localX: 2, localY: 2, z: 0, type: 0, orientation: 1 }),
      50,
      50,
    );
    const definitions = new Map([[7, loadOsrsObjectDefinition(7, createObjectData({ name: "Door", wallOrDoor: 1 }))]]);
    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);

    const path = findRegionPath(collision, { localX: 2, localY: 1, z: 0 }, { localX: 2, localY: 3, z: 0 });

    expect(path?.map((step) => step.key)).toEqual(["3202,3201,0", "3202,3202,0", "3202,3203,0"]);
  });

  it("finds a local region path around blocked tiles", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 42, localX: 2, localY: 1, z: 0, type: 10, orientation: 0 }),
      50,
      50,
    );
    const definitions = new Map([[42, loadOsrsObjectDefinition(42, createObjectData({ sizeX: 1, sizeY: 3 }))]]);
    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);

    const path = findRegionPath(collision, { localX: 1, localY: 2, z: 0 }, { localX: 3, localY: 2, z: 0 });

    expect(path).not.toBeNull();
    expect(path?.[0].key).toBe("3201,3202,0");
    expect(path?.[path.length - 1].key).toBe("3203,3202,0");
    expect(path?.some((step) => step.x === 3202 && step.y >= 3201 && step.y <= 3203)).toBe(false);
  });

  it("can path away from a blocked start tile", () => {
    const mapRegion = createEmptyMapRegion();
    const locations = loadOsrsRegionLocations(
      createLocationData({ id: 42, localX: 1, localY: 1, z: 0, type: 10, orientation: 0 }),
      50,
      50,
    );
    const definitions = new Map([[42, loadOsrsObjectDefinition(42, createObjectData())]]);
    const collision = buildOsrsRegionCollision(mapRegion, locations, definitions);

    const path = findRegionPath(collision, { localX: 1, localY: 1, z: 0 }, { localX: 1, localY: 3, z: 0 });

    expect(path).not.toBeNull();
    expect(path?.map((step) => step.key)).toEqual(["3201,3201,0", "3201,3202,0", "3201,3203,0"]);
  });

  it("allows diagonal movement without cutting blocked corners", () => {
    const openCollision = buildOsrsRegionCollision(createEmptyMapRegion(), loadOsrsRegionLocations(Buffer.from([0]), 50, 50), new Map());
    const openPath = findRegionPath(openCollision, { localX: 1, localY: 1, z: 0 }, { localX: 2, localY: 2, z: 0 });

    expect(openPath?.map((step) => step.key)).toEqual(["3201,3201,0", "3202,3202,0"]);

    const blockedLocations = loadOsrsRegionLocations(
      createLocationData({ id: 42, localX: 2, localY: 1, z: 0, type: 10, orientation: 0 }),
      50,
      50,
    );
    const blockedCollision = buildOsrsRegionCollision(
      createEmptyMapRegion(),
      blockedLocations,
      new Map([[42, loadOsrsObjectDefinition(42, createObjectData())]]),
    );

    expect(canMoveWithinRegion(blockedCollision, 1, 1, 0, 1, 1)).toBe(false);
  });
});
