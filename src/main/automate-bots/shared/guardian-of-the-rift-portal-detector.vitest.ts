import { describe, expect, test } from "vitest";
import {
  detectGuardianOfTheRiftPortalMarkersInScreenshot,
  detectGuardianOfTheRiftPortalOpenIcon,
  loadGuardianOfTheRiftPortalOpenIconTemplate,
  pickNearestGuardianOfTheRiftPortalMarker,
} from "./guardian-of-the-rift-portal-detector";
import type { RobotBitmap } from "./ocr-engine";

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
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  bitmap.image[offset] = color.b;
  bitmap.image[offset + 1] = color.g;
  bitmap.image[offset + 2] = color.r;
  bitmap.image[offset + 3] = 255;
}

function blitBitmap(target: RobotBitmap, source: RobotBitmap, targetX: number, targetY: number): void {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = y * source.byteWidth + x * source.bytesPerPixel;
      const targetOffset = (targetY + y) * target.byteWidth + (targetX + x) * target.bytesPerPixel;
      target.image[targetOffset] = source.image[sourceOffset];
      target.image[targetOffset + 1] = source.image[sourceOffset + 1];
      target.image[targetOffset + 2] = source.image[sourceOffset + 2];
      target.image[targetOffset + 3] = source.image[sourceOffset + 3];
    }
  }
}

describe("Guardian of the Rift portal detector", () => {
  test("detects the portal-open icon in the top-left fifth of the capture", async () => {
    const template = await loadGuardianOfTheRiftPortalOpenIconTemplate();
    const bitmap = createBitmap(1328, 1549, { r: 18, g: 22, b: 26 });

    blitBitmap(bitmap, template.bitmap, 52, 64);

    const detection = detectGuardianOfTheRiftPortalOpenIcon(bitmap, template);

    expect(detection.isOpen).toBe(true);
    expect(detection.match?.x).toBe(52);
    expect(detection.match?.y).toBe(64);
  });

  test("ignores portal-open icon matches outside the top-left fifth", async () => {
    const template = await loadGuardianOfTheRiftPortalOpenIconTemplate();
    const bitmap = createBitmap(1328, 1549, { r: 18, g: 22, b: 26 });

    blitBitmap(bitmap, template.bitmap, 420, 64);

    const detection = detectGuardianOfTheRiftPortalOpenIcon(bitmap, template);

    expect(detection.isOpen).toBe(false);
  });

  test("detects connected portal marker pixels near FFFF5E7E", () => {
    const bitmap = createBitmap(1328, 1549, { r: 20, g: 20, b: 20 });

    for (let y = 420; y < 428; y += 1) {
      for (let x = 510; x < 526; x += 1) {
        setPixel(bitmap, x, y, { r: 255, g: 94, b: 126 });
      }
    }

    const detections = detectGuardianOfTheRiftPortalMarkersInScreenshot(bitmap);

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      centerX: 518,
      centerY: 424,
      pixelCount: 128,
      width: 16,
      height: 8,
    });
  });

  test("picks the portal marker nearest to the player anchor", () => {
    const bitmap = createBitmap(1328, 1549, { r: 20, g: 20, b: 20 });

    for (let y = 420; y < 428; y += 1) {
      for (let x = 410; x < 426; x += 1) {
        setPixel(bitmap, x, y, { r: 255, g: 94, b: 126 });
      }
      for (let x = 700; x < 716; x += 1) {
        setPixel(bitmap, x, y, { r: 255, g: 94, b: 126 });
      }
    }

    const detections = detectGuardianOfTheRiftPortalMarkersInScreenshot(bitmap);
    const nearest = pickNearestGuardianOfTheRiftPortalMarker(detections, { centerX: 680, centerY: 430 });

    expect(nearest?.centerX).toBe(708);
  });
});
