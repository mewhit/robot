import fs from "fs";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  createGuardianOfTheRiftPouchDetectorCache,
  detectGuardianOfTheRiftPouches,
  loadGuardianOfTheRiftPouchTemplatesFromDirectory,
  type GuardianOfTheRiftPouchTemplate,
} from "./guardian-of-the-rift-pouch-detector";
import type { RobotBitmap } from "./ocr-engine";

const POUCH_ICON_DIR = "test-images/icon/guardin-of-the-rift/pouch";
const POUCH_SCREENSHOT_PATH =
  "test-images/runescrafting/guardian-of-the-rift/phase-dectector/1289x1549-2k-125-workbench-phase-2.png";

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

function createBitmap(width: number, height: number, color: { r: number; g: number; b: number }): RobotBitmap {
  const image = Buffer.alloc(width * height * 4);

  for (let index = 0; index < image.length; index += 4) {
    image[index] = color.b;
    image[index + 1] = color.g;
    image[index + 2] = color.r;
    image[index + 3] = 255;
  }

  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image,
  };
}

function setPixel(bitmap: RobotBitmap, x: number, y: number, color: { r: number; g: number; b: number }): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
    return;
  }

  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  bitmap.image[offset] = color.b;
  bitmap.image[offset + 1] = color.g;
  bitmap.image[offset + 2] = color.r;
  bitmap.image[offset + 3] = 255;
}

function blitOpaquePixels(target: RobotBitmap, source: RobotBitmap, targetX: number, targetY: number): void {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = y * source.byteWidth + x * source.bytesPerPixel;
      const alpha = source.image[sourceOffset + 3] ?? 255;
      if (alpha === 0) {
        continue;
      }

      const targetOffset = (targetY + y) * target.byteWidth + (targetX + x) * target.bytesPerPixel;
      target.image[targetOffset] = source.image[sourceOffset];
      target.image[targetOffset + 1] = source.image[sourceOffset + 1];
      target.image[targetOffset + 2] = source.image[sourceOffset + 2];
      target.image[targetOffset + 3] = 255;
    }
  }
}

function drawCyanPixelsOverTransparentTemplateArea(
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPouchTemplate,
  targetX: number,
  targetY: number,
): void {
  for (let y = 0; y < template.bitmap.height; y += 1) {
    for (let x = 0; x < template.bitmap.width; x += 1) {
      if (x > 24 || y < 20) {
        continue;
      }

      const sourceOffset = y * template.bitmap.byteWidth + x * template.bitmap.bytesPerPixel;
      const alpha = template.bitmap.image[sourceOffset + 3] ?? 255;
      if (alpha !== 0 || (x + y) % 3 !== 0) {
        continue;
      }

      setPixel(bitmap, targetX + x, targetY + y, { r: 0, g: 255, b: 255 });
    }
  }
}

function isOpaqueCyanCountPixel(r: number, g: number, b: number, a: number): boolean {
  return a > 0 && r <= 80 && g >= 75 && b >= 65 && g - r >= 20 && b - r >= 20;
}

describe("Guardian of the Rift pouch detector", () => {
  test("pouch templates do not keep opaque count pixels", async () => {
    const templates = await loadGuardianOfTheRiftPouchTemplatesFromDirectory(POUCH_ICON_DIR);

    for (const template of templates) {
      let countPixels = 0;
      for (let y = 0; y < template.bitmap.height; y += 1) {
        for (let x = 0; x < template.bitmap.width; x += 1) {
          const offset = y * template.bitmap.byteWidth + x * template.bitmap.bytesPerPixel;
          if (
            isOpaqueCyanCountPixel(
              template.bitmap.image[offset + 2],
              template.bitmap.image[offset + 1],
              template.bitmap.image[offset],
              template.bitmap.image[offset + 3] ?? 255,
            )
          ) {
            countPixels += 1;
          }
        }
      }

      expect(countPixels, `${template.pouch} template has count pixels`).toBe(0);
    }
  });

  test("detects small, medium, and giant pouches in the inventory area", async () => {
    const templates = await loadGuardianOfTheRiftPouchTemplatesFromDirectory(POUCH_ICON_DIR);
    const bitmap = await loadPngBitmap(POUCH_SCREENSHOT_PATH);

    const detection = detectGuardianOfTheRiftPouches(bitmap, templates);

    expect(detection.pouches.small?.score).toBeGreaterThanOrEqual(0.82);
    expect(detection.pouches.medium?.score).toBeGreaterThanOrEqual(0.82);
    expect(detection.pouches.giant?.score).toBeGreaterThanOrEqual(0.82);
    expect(detection.detectedPouches.map((match) => match.pouch).sort()).toEqual(["giant", "medium", "small"]);

    for (const match of detection.detectedPouches) {
      expect(match.x).toBeGreaterThan(Math.round(bitmap.width * 0.72));
      expect(match.y).toBeGreaterThan(Math.round(bitmap.height * 0.68));
    }
  });

  test("uses cached pouch ROIs before the full inventory search", async () => {
    const templates = await loadGuardianOfTheRiftPouchTemplatesFromDirectory(POUCH_ICON_DIR);
    const bitmap = await loadPngBitmap(POUCH_SCREENSHOT_PATH);
    const cache = createGuardianOfTheRiftPouchDetectorCache();

    const first = detectGuardianOfTheRiftPouches(bitmap, templates, { cache });
    const second = detectGuardianOfTheRiftPouches(bitmap, templates, { cache });

    expect(first.detectedPouches.every((match) => match.source === "full-search")).toBe(true);
    expect(second.detectedPouches.every((match) => match.source === "cached-roi")).toBe(true);
  });

  test("ignores changing count pixels where the template is transparent", async () => {
    const templates = await loadGuardianOfTheRiftPouchTemplatesFromDirectory(POUCH_ICON_DIR);
    const giantTemplate = templates.find((template) => template.pouch === "giant");
    expect(giantTemplate).toBeDefined();

    const bitmap = createBitmap(320, 220, { r: 36, g: 31, b: 24 });
    const targetX = 160;
    const targetY = 96;

    blitOpaquePixels(bitmap, giantTemplate!.bitmap, targetX, targetY);
    drawCyanPixelsOverTransparentTemplateArea(bitmap, giantTemplate!, targetX, targetY);

    const detection = detectGuardianOfTheRiftPouches(bitmap, [giantTemplate!], {
      searchRois: [{ x: 0, y: 0, width: bitmap.width, height: bitmap.height }],
    });

    expect(detection.pouches.giant?.x).toBe(targetX);
    expect(detection.pouches.giant?.y).toBe(targetY);
    expect(detection.pouches.giant?.score).toBeGreaterThan(0.98);
  });
});
