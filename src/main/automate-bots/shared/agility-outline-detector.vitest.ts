import fs from "fs";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import { detectAgilityOutlines, type AgilityOutlineDetection } from "./agility-outline-detector";
import type { RobotBitmap } from "./ocr-engine";

function loadScreenshot(filePath: string): RobotBitmap {
  const png = (PNG as unknown as { sync: { read(buffer: Buffer): PNG } }).sync.read(fs.readFileSync(filePath));
  const buffer = Buffer.alloc(png.width * png.height * 4);

  for (let i = 0; i < png.data.length; i += 4) {
    buffer[i] = png.data[i + 2];
    buffer[i + 1] = png.data[i + 1];
    buffer[i + 2] = png.data[i];
    buffer[i + 3] = 255;
  }

  return {
    width: png.width,
    height: png.height,
    byteWidth: png.width * 4,
    bytesPerPixel: 4,
    image: buffer,
  };
}

function overlapsExpectedBox(outline: AgilityOutlineDetection): boolean {
  return (
    outline.color === "green" &&
    outline.centerX >= 430 &&
    outline.centerX <= 465 &&
    outline.centerY >= 790 &&
    outline.centerY <= 815 &&
    outline.width >= 200 &&
    outline.height >= 25
  );
}

describe("agility outline detector", () => {
  test("detects the Falador rooftop gap outline near the player", () => {
    const bitmap = loadScreenshot("test-images/agility-rooftop/1298x1549-2k-125-5-outlined-green.png");
    const outlines = detectAgilityOutlines(bitmap);

    expect(outlines.some(overlapsExpectedBox)).toBe(true);
  });
});
