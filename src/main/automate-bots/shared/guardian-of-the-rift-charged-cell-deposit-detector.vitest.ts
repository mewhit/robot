import { describe, expect, test } from "vitest";
import { detectAllChargedCellDepositObjects } from "../runecrafting-guardian-of-the-rift-bot";
import type { RobotBitmap } from "./ocr-engine";

const CHARGED_CELL_PURPLE = { r: 130, g: 0, b: 255 };

function createBitmap(width: number, height: number): RobotBitmap {
  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image: Buffer.alloc(width * height * 4),
  };
}

function paintRectangle(
  bitmap: RobotBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = py * bitmap.byteWidth + px * bitmap.bytesPerPixel;
      bitmap.image[offset] = color.b;
      bitmap.image[offset + 1] = color.g;
      bitmap.image[offset + 2] = color.r;
      bitmap.image[offset + 3] = 255;
    }
  }
}

describe("detectAllChargedCellDepositObjects", () => {
  test("detects a charged-cell deposit marker shape", () => {
    const bitmap = createBitmap(800, 800);

    paintRectangle(bitmap, 328, 500, 49, 38, CHARGED_CELL_PURPLE);

    expect(detectAllChargedCellDepositObjects(bitmap)).toEqual([
      expect.objectContaining({
        centerX: 352,
        centerY: 519,
        width: 49,
        height: 38,
        pixelCount: 1_862,
      }),
    ]);
  });

  test("rejects thin purple strips that look like UI fragments", () => {
    const bitmap = createBitmap(800, 800);

    paintRectangle(bitmap, 491, 285, 55, 4, CHARGED_CELL_PURPLE);

    expect(detectAllChargedCellDepositObjects(bitmap)).toEqual([]);
  });
});
