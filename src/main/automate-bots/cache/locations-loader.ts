import { CacheInputStream } from "./cache-input-stream";

export type OsrsLocation = {
  id: number;
  type: number;
  orientation: number;
  localX: number;
  localY: number;
  z: number;
  worldX: number;
  worldY: number;
};

export type OsrsRegionLocations = {
  regionX: number;
  regionY: number;
  locations: OsrsLocation[];
};

export function loadOsrsRegionLocations(data: Buffer, regionX: number, regionY: number): OsrsRegionLocations {
  const stream = new CacheInputStream(data);
  const locations: OsrsLocation[] = [];
  let id = -1;

  while (stream.remaining > 0) {
    const idOffset = stream.readUnsignedShortSmart();
    if (idOffset === 0) {
      break;
    }

    id += idOffset;
    let position = 0;

    while (stream.remaining > 0) {
      const positionOffset = stream.readUnsignedShortSmart();
      if (positionOffset === 0) {
        break;
      }

      position += positionOffset - 1;
      const localY = position & 0x3f;
      const localX = (position >> 6) & 0x3f;
      const z = position >> 12;
      const attributes = stream.readUnsignedByte();

      locations.push({
        id,
        type: attributes >> 2,
        orientation: attributes & 3,
        localX,
        localY,
        z,
        worldX: regionX * 64 + localX,
        worldY: regionY * 64 + localY,
      });
    }
  }

  return {
    regionX,
    regionY,
    locations,
  };
}
