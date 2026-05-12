import fs from "fs";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  detectArceuusEssenceInventory,
  loadArceuusEssenceIconTemplates,
} from "./arceuus-essence-inventory-detector";
import type { RobotBitmap } from "./ocr-engine";

function loadPngBitmap(filePath: string): Promise<RobotBitmap> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new Error(`File not found: ${filePath}`));
      return;
    }

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

describe("Arceuus essence inventory detector", () => {
  test("confirms dark essence after magenta click screenshot", async () => {
    const bitmap = await loadPngBitmap("test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-block-and-chisel.png");
    const templates = await loadArceuusEssenceIconTemplates();
    const detection = detectArceuusEssenceInventory(bitmap, templates, { blockClassificationMode: "dark" });

    expect(detection.darkBlocks.length).toBeGreaterThan(0);
    expect(detection.darkFragments).toHaveLength(0);
    expect(detection.denseBlocks).toHaveLength(0);
    expect(detection.isDarkEssenceConfirmed).toBe(true);
  });

  test("classifies dense block and dark fragment screenshot in auto mode", async () => {
    const bitmap = await loadPngBitmap("test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-fragment-and-dense-essence-block-and-chisel.png");
    const templates = await loadArceuusEssenceIconTemplates();
    const detection = detectArceuusEssenceInventory(bitmap, templates);

    expect(detection.denseBlocks.length).toBeGreaterThan(0);
    expect(detection.darkFragments.length).toBeGreaterThan(0);
    expect(detection.darkBlocks).toHaveLength(0);
  });
});
