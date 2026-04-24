import { describe, expect, it } from "vitest";
import { buildWorldTileKey, deriveWorldTile, parseWorldTileFromMatchedLine } from "./world-coordinate";

describe("world-coordinate", () => {
  it("derives region and chunk coordinates from a world tile", () => {
    const tile = deriveWorldTile(3755, 5672, 0);

    expect(tile.key).toBe("3755,5672,0");
    expect(tile.regionX).toBe(58);
    expect(tile.regionY).toBe(88);
    expect(tile.regionId).toBe((58 << 8) | 88);
    expect(tile.worldChunkX).toBe(469);
    expect(tile.worldChunkY).toBe(709);
    expect(tile.regionChunkX).toBe(5);
    expect(tile.regionChunkY).toBe(5);
  });

  it("parses OCR matched lines into world tiles", () => {
    const tile = parseWorldTileFromMatchedLine("3013,9720,0");

    expect(tile).not.toBeNull();
    expect(tile?.key).toBe(buildWorldTileKey({ x: 3013, y: 9720, z: 0 }));
    expect(tile?.regionId).toBe(((3013 >> 6) << 8) | (9720 >> 6));
  });

  it("returns null when the matched line is invalid", () => {
    expect(parseWorldTileFromMatchedLine("not-a-tile")).toBeNull();
    expect(parseWorldTileFromMatchedLine("3013,9720")).toBeNull();
  });
});
