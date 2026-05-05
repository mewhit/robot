import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { detectAllReturnPortalRedMarkers } from "../runecrafting-guardian-of-the-rift-bot";
import type { RobotBitmap } from "./ocr-engine";

const SCREENSHOT_DIR = "test-images/runescrafting/guardian-of-the-rift/red-portal-back";

function loadPngAsRobotBitmap(filePath: string): Promise<RobotBitmap> {
  return new Promise((resolve, reject) => {
    const png = new PNG();

    fs.createReadStream(filePath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        const image = Buffer.alloc(png.width * png.height * 4);

        for (let index = 0; index < png.data.length; index += 4) {
          image[index] = png.data[index + 2];
          image[index + 1] = png.data[index + 1];
          image[index + 2] = png.data[index];
          image[index + 3] = png.data[index + 3];
        }

        resolve({
          width: png.width,
          height: png.height,
          byteWidth: png.width * 4,
          bytesPerPixel: 4,
          image,
        });
      })
      .on("error", reject);
  });
}

function createSyntheticBitmap(width: number, height: number): RobotBitmap {
  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image: Buffer.alloc(width * height * 4),
  };
}

function paintRedRectangle(bitmap: RobotBitmap, x: number, y: number, width: number, height: number): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = py * bitmap.byteWidth + px * bitmap.bytesPerPixel;
      bitmap.image[offset] = 0;
      bitmap.image[offset + 1] = 0;
      bitmap.image[offset + 2] = 255;
      bitmap.image[offset + 3] = 255;
    }
  }
}

describe("detectAllReturnPortalRedMarkers", () => {
  it.each([
    ["1298x1549-2k-125-water-altar.png", { minX: 1040, maxX: 1110, minY: 870, maxY: 930 }],
    ["1298x1549-2k-125-chaos-altar.png", { minX: 1060, maxX: 1135, minY: 940, maxY: 1010 }],
  ])("detects the real return portal in %s", async (filename, expectedBounds) => {
    const bitmap = await loadPngAsRobotBitmap(path.join(SCREENSHOT_DIR, filename));
    const detections = detectAllReturnPortalRedMarkers(bitmap);

    expect(detections.length).toBeGreaterThan(0);
    expect(detections[0]).toMatchObject({
      minX: expect.any(Number),
      minY: expect.any(Number),
      maxX: expect.any(Number),
      maxY: expect.any(Number),
    });
    expect(detections[0].centerX).toBeGreaterThanOrEqual(expectedBounds.minX);
    expect(detections[0].centerX).toBeLessThanOrEqual(expectedBounds.maxX);
    expect(detections[0].centerY).toBeGreaterThanOrEqual(expectedBounds.minY);
    expect(detections[0].centerY).toBeLessThanOrEqual(expectedBounds.maxY);
    expect(detections[0].pixelCount).toBeGreaterThanOrEqual(1_000);
  });

  it("rejects tiny red text-like components", () => {
    const bitmap = createSyntheticBitmap(1298, 1549);
    paintRedRectangle(bitmap, 450, 145, 8, 13);
    paintRedRectangle(bitmap, 500, 145, 2, 13);

    expect(detectAllReturnPortalRedMarkers(bitmap)).toEqual([]);
  });
});
