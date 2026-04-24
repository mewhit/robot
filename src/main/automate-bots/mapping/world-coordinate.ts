export type WorldTile = {
  key: string;
  x: number;
  y: number;
  z: number;
  regionId: number;
  regionX: number;
  regionY: number;
  worldChunkX: number;
  worldChunkY: number;
  regionChunkX: number;
  regionChunkY: number;
};

export function buildWorldTileKey(tile: Pick<WorldTile, "x" | "y" | "z">): string {
  return `${tile.x},${tile.y},${tile.z}`;
}

export function deriveWorldTile(x: number, y: number, z: number): WorldTile {
  const regionX = x >> 6;
  const regionY = y >> 6;
  const worldChunkX = x >> 3;
  const worldChunkY = y >> 3;

  return {
    key: buildWorldTileKey({ x, y, z }),
    x,
    y,
    z,
    regionId: (regionX << 8) | regionY,
    regionX,
    regionY,
    worldChunkX,
    worldChunkY,
    regionChunkX: worldChunkX & 7,
    regionChunkY: worldChunkY & 7,
  };
}

export function parseWorldTileFromMatchedLine(matchedLine: string): WorldTile | null {
  const parts = matchedLine.split(",");
  if (parts.length < 3) {
    return null;
  }

  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return deriveWorldTile(x, y, z);
}
