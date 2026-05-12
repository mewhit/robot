import fs from "fs";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  detectArceuusChiselInventory,
  loadArceuusChiselIconTemplate,
} from "./arceuus-chisel-inventory-detector";
import {
  detectArceuusEssenceInventory,
  loadArceuusEssenceIconTemplates,
} from "./arceuus-essence-inventory-detector";
import type { RobotBitmap } from "./ocr-engine";

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

describe("Arceuus chisel inventory detector", () => {
  test("loads the chisel icon template", async () => {
    const template = await loadArceuusChiselIconTemplate();

    expect(template.width).toBeGreaterThan(0);
    expect(template.height).toBeGreaterThan(0);
  });

  test("detects chisel in Arceuus inventory screenshot when present", async () => {
    const bitmap = await loadPngBitmap("test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-block-and-chisel.png");
    const template = await loadArceuusChiselIconTemplate();
    const detection = detectArceuusChiselInventory(bitmap, template);

    expect(detection.searchRoi.width).toBeGreaterThan(0);
    expect(detection.searchRoi.height).toBeGreaterThan(0);
    expect(detection.hasChisel).toBe(true);
  });

  test("matches Arceuus detector expectations encoded in screenshot filenames", async () => {
    const essenceTemplates = await loadArceuusEssenceIconTemplates();
    const chiselTemplate = await loadArceuusChiselIconTemplate();
    const cases = [
      {
        path: "test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-block-and-chisel.png",
        dense: false,
        darkBlock: true,
        darkFragment: false,
        chisel: true,
      },
      {
        path: "test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-fragment-and-dense-essence-block-and-chisel.png",
        dense: true,
        darkBlock: false,
        darkFragment: true,
        chisel: true,
      },
      {
        path: "test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essense-fragments-and-dense-essence-block-and-chisel.png",
        dense: true,
        darkBlock: false,
        darkFragment: true,
        chisel: true,
      },
      {
        path: "test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-fragments-and-chisel.png",
        dense: false,
        darkBlock: false,
        darkFragment: true,
        chisel: true,
      },
    ];

    const failures: string[] = [];
    for (const testCase of cases) {
      const bitmap = await loadPngBitmap(testCase.path);
      const essence = detectArceuusEssenceInventory(bitmap, essenceTemplates);
      const chisel = detectArceuusChiselInventory(bitmap, chiselTemplate);

      const actual = {
        dense: essence.denseBlocks.length > 0,
        darkBlock: essence.darkBlocks.length > 0,
        darkFragment: essence.darkFragments.length > 0,
        chisel: chisel.hasChisel,
      };
      for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
        if (actual[key] !== testCase[key]) {
          failures.push(`${testCase.path} ${key}: expected=${testCase[key]} actual=${actual[key]}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("does not start Step 12 when dense essence blocks are still present", async () => {
    const bitmap = await loadPngBitmap("test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essense-fragments-and-dense-essence-block-and-chisel.png");
    const essenceTemplates = await loadArceuusEssenceIconTemplates();
    const detection = detectArceuusEssenceInventory(bitmap, essenceTemplates);
    const startAtReturnBlue =
      detection.denseBlocks.length === 0 &&
      (detection.darkBlocks.length > 0 || detection.darkFragments.length > 0);

    expect(detection.denseBlocks.length).toBeGreaterThan(0);
    expect(detection.darkFragments.length).toBeGreaterThan(0);
    expect(startAtReturnBlue).toBe(false);
  });

  test("starts Step 12 when inventory has dark essence blocks and fragments", async () => {
    const bitmap = await loadPngBitmap("test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-fragment-and-dense-essence-block-and-chisel.png");
    const essenceTemplates = await loadArceuusEssenceIconTemplates();
    const detection = detectArceuusEssenceInventory(bitmap, essenceTemplates, { blockClassificationMode: "dark" });
    const startAtStep12FollowAnother =
      detection.darkFragments.length > 0 &&
      detection.darkBlocks.length > 0 &&
      detection.denseBlocks.length === 0;
    const startAtStep6ReturnBlue =
      detection.denseBlocks.length === 0 &&
      detection.darkBlocks.length > 0 &&
      detection.darkFragments.length === 0;

    expect(detection.denseBlocks).toHaveLength(0);
    expect(detection.darkBlocks.length).toBeGreaterThan(0);
    expect(detection.darkFragments.length).toBeGreaterThan(0);
    expect(startAtStep12FollowAnother).toBe(true);
    expect(startAtStep6ReturnBlue).toBe(false);
  });

  test("starts Step 6 when inventory has dark essence blocks and no fragments", async () => {
    const bitmap = await loadPngBitmap("test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-block-and-chisel.png");
    const essenceTemplates = await loadArceuusEssenceIconTemplates();
    const detection = detectArceuusEssenceInventory(bitmap, essenceTemplates, { blockClassificationMode: "dark" });
    const startAtStep6ReturnBlue = detection.denseBlocks.length === 0 && detection.darkBlocks.length > 0;
    const startAtStep12FollowAnother =
      detection.denseBlocks.length === 0 &&
      detection.darkBlocks.length === 0 &&
      detection.darkFragments.length > 0;

    expect(detection.denseBlocks).toHaveLength(0);
    expect(detection.darkBlocks.length).toBeGreaterThan(0);
    expect(detection.darkFragments).toHaveLength(0);
    expect(startAtStep6ReturnBlue).toBe(true);
    expect(startAtStep12FollowAnother).toBe(false);
  });

  test("starts mining again when inventory only has dark essence fragments", async () => {
    const bitmap = await loadPngBitmap("test-images/runescrafting/arceuus/1335x1549-2k-125-blood-rune-and-dark-essence-fragments-and-chisel.png");
    const essenceTemplates = await loadArceuusEssenceIconTemplates();
    const detection = detectArceuusEssenceInventory(bitmap, essenceTemplates);
    const startAtStep6ReturnBlue = detection.denseBlocks.length === 0 && detection.darkBlocks.length > 0;
    const startAtMiningAgain =
      detection.denseBlocks.length === 0 &&
      detection.darkBlocks.length === 0 &&
      detection.darkFragments.length > 0;

    expect(detection.denseBlocks).toHaveLength(0);
    expect(detection.darkBlocks).toHaveLength(0);
    expect(detection.darkFragments.length).toBeGreaterThan(0);
    expect(startAtStep6ReturnBlue).toBe(false);
    expect(startAtMiningAgain).toBe(true);
  });
});
