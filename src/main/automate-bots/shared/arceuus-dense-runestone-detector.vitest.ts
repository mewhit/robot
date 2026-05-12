import fs from "fs";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  detectArceuusDenseRunestones,
  isPointInsideArceuusDenseRunestone,
  pickNearestActiveArceuusDenseRunestone,
} from "./arceuus-dense-runestone-detector";
import type { RobotBitmap } from "./ocr-engine";

const GREEN_SCREENSHOT = "test-images/runescrafting/arceuus/1335x1549-2k-125-dense-runestone-green.png";
const RED_SCREENSHOT = "test-images/runescrafting/arceuus/1335x1549-2k-125-dense-runestone-red.png";

function loadPngBitmap(filePath: string): Promise<RobotBitmap> {
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

describe("Arceuus dense runestone detector", () => {
  test("detects two active green dense runestones", async () => {
    const bitmap = await loadPngBitmap(GREEN_SCREENSHOT);
    const runestones = detectArceuusDenseRunestones(bitmap);
    const active = runestones.filter((runestone) => runestone.status === "active");
    const depleted = runestones.filter((runestone) => runestone.status === "depleted");

    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(depleted.length).toBe(0);
    expect(active.some((runestone) => Math.abs(runestone.centerX - 390) <= 35)).toBe(true);
    expect(active.some((runestone) => Math.abs(runestone.centerX - 985) <= 35)).toBe(true);
  });

  test("detects one active and one depleted dense runestone", async () => {
    const bitmap = await loadPngBitmap(RED_SCREENSHOT);
    const runestones = detectArceuusDenseRunestones(bitmap);
    const active = runestones.filter((runestone) => runestone.status === "active");
    const depleted = runestones.filter((runestone) => runestone.status === "depleted");

    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(depleted.length).toBeGreaterThanOrEqual(1);
    expect(active.some((runestone) => Math.abs(runestone.centerX - 190) <= 45)).toBe(true);
    expect(depleted.some((runestone) => Math.abs(runestone.centerX - 800) <= 45)).toBe(true);
  });

  test("selects the nearest active runestone and recognizes a depleted clicked target", async () => {
    const bitmap = await loadPngBitmap(RED_SCREENSHOT);
    const runestones = detectArceuusDenseRunestones(bitmap);
    const selected = pickNearestActiveArceuusDenseRunestone(runestones, { x: 640, y: 760 }, bitmap);
    const depleted = runestones.find((runestone) => runestone.status === "depleted");

    expect(selected?.status).toBe("active");
    expect(selected?.centerX).toBeLessThan(360);
    expect(depleted).toBeDefined();
    expect(isPointInsideArceuusDenseRunestone({ x: 800, y: 720 }, depleted!)).toBe(true);
  });
});
