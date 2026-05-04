import { describe, expect, it } from "vitest";
import { detectPlayerBoxesInScreenshot } from "./player-box-detector";
import { RobotBitmap } from "./ocr-engine";

function createBitmap(width: number, height: number): RobotBitmap {
  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image: Buffer.alloc(width * height * 4),
  };
}

function paintCyanRect(bitmap: RobotBitmap, x: number, y: number, width: number, height: number): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = py * bitmap.byteWidth + px * bitmap.bytesPerPixel;
      bitmap.image[offset] = 255;
      bitmap.image[offset + 1] = 255;
      bitmap.image[offset + 2] = 0;
      bitmap.image[offset + 3] = 255;
    }
  }
}

describe("detectPlayerBoxesInScreenshot", () => {
  it("detects a filled FF00FFFF player tile", () => {
    const bitmap = createBitmap(100, 100);
    paintCyanRect(bitmap, 18, 24, 64, 64);

    const boxes = detectPlayerBoxesInScreenshot(bitmap);

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({
      x: 18,
      y: 24,
      width: 64,
      height: 64,
      centerX: 50,
      centerY: 56,
      pixelCount: 4096,
      fillRatio: 1,
    });
  });
});
