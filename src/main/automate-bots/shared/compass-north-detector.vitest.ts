import { describe, expect, it } from "vitest";
import { detectCompassNorthDirection } from "./compass-north-detector";
import type { RobotBitmap } from "./ocr-engine";

function createBitmap(width: number, height: number): RobotBitmap {
  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image: Buffer.alloc(width * height * 4),
  };
}

function setPixel(bitmap: RobotBitmap, x: number, y: number, r: number, g: number, b: number): void {
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  bitmap.image[offset] = b;
  bitmap.image[offset + 1] = g;
  bitmap.image[offset + 2] = r;
  bitmap.image[offset + 3] = 255;
}

function drawRedBlock(bitmap: RobotBitmap, centerX: number, centerY: number): void {
  for (let y = centerY - 2; y <= centerY + 2; y += 1) {
    for (let x = centerX - 2; x <= centerX + 2; x += 1) {
      setPixel(bitmap, x, y, 220, 20, 20);
    }
  }
}

describe("compass-north-detector", () => {
  it("detects an upward north vector from the compass red component", () => {
    const bitmap = createBitmap(1298, 1549);
    drawRedBlock(bitmap, 1088, 35);

    const detection = detectCompassNorthDirection(bitmap, 100);

    expect(detection).not.toBeNull();
    expect(detection?.northVectorY).toBeLessThan(-0.9);
    expect(Math.abs(detection?.northVectorX ?? 1)).toBeLessThan(0.2);
  });

  it("detects a westward north vector when the red component is left of center", () => {
    const bitmap = createBitmap(1298, 1549);
    drawRedBlock(bitmap, 1068, 49);

    const detection = detectCompassNorthDirection(bitmap, 100);

    expect(detection).not.toBeNull();
    expect(detection?.northVectorX).toBeLessThan(-0.9);
    expect(Math.abs(detection?.northVectorY ?? 1)).toBeLessThan(0.2);
  });
});
