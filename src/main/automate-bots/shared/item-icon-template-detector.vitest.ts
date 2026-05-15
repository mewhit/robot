import { describe, expect, it } from "vitest";
import type { RobotBitmap } from "./ocr-engine";
import { detectItemIconTemplate, loadItemIconTemplate } from "./item-icon-template-detector";

function readPixel(bitmap: RobotBitmap, x: number, y: number): { b: number; g: number; r: number; a: number } {
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
    a: bitmap.image[offset + 3] ?? 255,
  };
}

function createBitmap(width: number, height: number): RobotBitmap {
  const bytesPerPixel = 4;
  const image = Buffer.alloc(width * height * bytesPerPixel);
  for (let index = 0; index < image.length; index += bytesPerPixel) {
    image[index] = 44;
    image[index + 1] = 49;
    image[index + 2] = 55;
    image[index + 3] = 255;
  }
  return {
    width,
    height,
    byteWidth: width * bytesPerPixel,
    bytesPerPixel,
    image,
  };
}

function pasteTemplate(scene: RobotBitmap, template: RobotBitmap, left: number, top: number): void {
  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      const pixel = readPixel(template, x, y);
      if (pixel.a === 0) {
        continue;
      }

      const targetX = left + x;
      const targetY = top + y;
      const targetOffset = targetY * scene.byteWidth + targetX * scene.bytesPerPixel;
      scene.image[targetOffset] = pixel.b;
      scene.image[targetOffset + 1] = pixel.g;
      scene.image[targetOffset + 2] = pixel.r;
      scene.image[targetOffset + 3] = 255;
    }
  }
}

describe("item icon template detector", () => {
  it.each([
    ["spade", "test-images/icon/spade.png"],
    ["spade-shop", "test-images/icon/spade-shop.png"],
    ["quest-helper-confirm-chevron", "test-images/icon/runelite-confirm-quest-chevron.png"],
    ["x-marks-quest-icon", "test-images/icon/quest-icon.png"],
  ])("finds the %s icon after coarse scan refinement", async (name, iconPath) => {
    const template = await loadItemIconTemplate(name, iconPath);
    const scene = createBitmap(96, 80);
    pasteTemplate(scene, template.bitmap, 23, 19);

    const detection = detectItemIconTemplate(scene, template, {
      searchRoi: { x: 0, y: 0, width: scene.width, height: scene.height },
      minScore: 0.98,
      coarseStepPx: 2,
      refineRadiusPx: 2,
    });

    expect(detection.bestMatch).not.toBeNull();
    expect(detection.bestMatch?.x).toBe(23);
    expect(detection.bestMatch?.y).toBe(19);
    expect(detection.bestMatch?.score).toBeGreaterThanOrEqual(0.99);
  });
});
