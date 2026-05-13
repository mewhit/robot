import { CacheInputStream } from "./cache-input-stream";

export const OSRS_REGION_SIZE = 64;
export const OSRS_PLANES = 4;

export type OsrsTerrainTile = {
  height: number;
  overlayId: number;
  overlayPath: number;
  overlayRotation: number;
  settings: number;
  underlayId: number;
};

export type OsrsMapRegion = {
  regionX: number;
  regionY: number;
  tiles: OsrsTerrainTile[][][];
};

function createEmptyTile(): OsrsTerrainTile {
  return {
    height: 0,
    overlayId: 0,
    overlayPath: 0,
    overlayRotation: 0,
    settings: 0,
    underlayId: 0,
  };
}

function createEmptyTiles(): OsrsTerrainTile[][][] {
  return Array.from({ length: OSRS_PLANES }, () =>
    Array.from({ length: OSRS_REGION_SIZE }, () =>
      Array.from({ length: OSRS_REGION_SIZE }, () => createEmptyTile()),
    ),
  );
}

export function loadOsrsMapRegion(data: Buffer, regionX: number, regionY: number): OsrsMapRegion {
  const stream = new CacheInputStream(data);
  const tiles = createEmptyTiles();

  for (let z = 0; z < OSRS_PLANES; z += 1) {
    for (let x = 0; x < OSRS_REGION_SIZE; x += 1) {
      for (let y = 0; y < OSRS_REGION_SIZE; y += 1) {
        const tile = tiles[z][x][y];
        while (true) {
          const opcode = stream.readUnsignedByte();
          if (opcode === 0) {
            break;
          }

          if (opcode === 1) {
            tile.height = stream.readUnsignedByte();
            break;
          }

          if (opcode <= 49) {
            tile.overlayId = stream.readShort();
            tile.overlayPath = Math.floor((opcode - 2) / 4);
            tile.overlayRotation = (opcode - 2) & 3;
            continue;
          }

          if (opcode <= 81) {
            tile.settings = opcode - 49;
            continue;
          }

          tile.underlayId = opcode - 81;
        }
      }
    }
  }

  return {
    regionX,
    regionY,
    tiles,
  };
}
