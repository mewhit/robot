import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import type { ScreenBitmap } from "../../windowsScreenCapture";
import { detectRuneliteMinimapGeometry } from "./minimap-geometry-detector";

type PngWithSync = typeof PNG & {
  sync: {
    read(buffer: Buffer): PNG;
  };
};

function loadScreenBitmap(filePath: string): ScreenBitmap {
  const png = (PNG as PngWithSync).sync.read(fs.readFileSync(filePath));
  const image = Buffer.alloc(png.width * png.height * 4);

  for (let offset = 0; offset < png.data.length; offset += 4) {
    image[offset] = png.data[offset + 2];
    image[offset + 1] = png.data[offset + 1];
    image[offset + 2] = png.data[offset];
    image[offset + 3] = png.data[offset + 3];
  }

  return {
    width: png.width,
    height: png.height,
    byteWidth: png.width * 4,
    bytesPerPixel: 4,
    image,
    colorAt: () => "000000",
  };
}

describe("detectRuneliteMinimapGeometry", () => {
  it.each([
    {
      file: "test-images/runescrafting/arceuus/1335x1549-2k-125-dense-runestone-green.png",
      expected: { xMin: 1140, xMax: 1210, yMin: 115, yMax: 165, radiusMin: 84, radiusMax: 106 },
    },
    {
      file: "test-images/runescrafting/arceuus/1639x1549-2k-125-dense-runestone-green.png",
      expected: { xMin: 1135, xMax: 1210, yMin: 115, yMax: 170, radiusMin: 84, radiusMax: 106 },
    },
    {
      file: "test-images/runescrafting/arceuus/1335x1548-2k-125-dark-essence-block-outlined.png",
      expected: { xMin: 830, xMax: 900, yMin: 110, yMax: 165, radiusMin: 84, radiusMax: 102 },
    },
  ])("finds the minimap contour in $file", ({ file, expected }) => {
    const bitmap = loadScreenBitmap(path.resolve(file));
    const detection = detectRuneliteMinimapGeometry(bitmap, { scale: 1.25 });

    expect(detection, file).not.toBeNull();
    expect(detection!.score, file).toBeGreaterThan(0.75);
    expect(detection!.centerLocalX, file).toBeGreaterThanOrEqual(expected.xMin);
    expect(detection!.centerLocalX, file).toBeLessThanOrEqual(expected.xMax);
    expect(detection!.centerLocalY, file).toBeGreaterThanOrEqual(expected.yMin);
    expect(detection!.centerLocalY, file).toBeLessThanOrEqual(expected.yMax);
    expect(detection!.radiusPx, file).toBeGreaterThanOrEqual(expected.radiusMin);
    expect(detection!.radiusPx, file).toBeLessThanOrEqual(expected.radiusMax);
  });
});
