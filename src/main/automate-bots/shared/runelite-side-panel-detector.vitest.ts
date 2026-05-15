import fs from "fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { RobotBitmap } from "./ocr-engine";
import { detectRuneLiteSidePanelOrangeIndicator } from "./runelite-side-panel-detector";

function createBitmap(width: number, height: number): RobotBitmap {
  const bytesPerPixel = 4;
  const image = Buffer.alloc(width * height * bytesPerPixel);
  for (let index = 0; index < image.length; index += bytesPerPixel) {
    image[index] = 38;
    image[index + 1] = 43;
    image[index + 2] = 47;
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

function setRgb(bitmap: RobotBitmap, x: number, y: number, r: number, g: number, b: number): void {
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  bitmap.image[offset] = b;
  bitmap.image[offset + 1] = g;
  bitmap.image[offset + 2] = r;
  bitmap.image[offset + 3] = 255;
}

function fillRect(bitmap: RobotBitmap, left: number, top: number, width: number, height: number, r: number, g: number, b: number): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      setRgb(bitmap, x, y, r, g, b);
    }
  }
}

function loadPngBitmap(filePath: string): RobotBitmap {
  const png = (PNG as typeof PNG & { sync: { read(buffer: Buffer): PNG } }).sync.read(fs.readFileSync(filePath));
  const image = Buffer.alloc(png.width * png.height * 4);
  for (let index = 0; index < png.data.length; index += 4) {
    image[index] = png.data[index + 2];
    image[index + 1] = png.data[index + 1];
    image[index + 2] = png.data[index];
    image[index + 3] = png.data[index + 3];
  }

  return {
    width: png.width,
    height: png.height,
    byteWidth: png.width * 4,
    bytesPerPixel: 4,
    image,
  };
}

describe("RuneLite side panel orange detector", () => {
  it("detects the selected side-panel indicator in the right sidebar", () => {
    const bitmap = createBitmap(320, 220);
    fillRect(bitmap, 276, 72, 2, 32, 220, 138, 0);

    const detection = detectRuneLiteSidePanelOrangeIndicator(bitmap);

    expect(detection.bestIndicator).not.toBeNull();
    expect(detection.bestIndicator?.x).toBe(276);
    expect(detection.bestIndicator?.y).toBe(72);
    expect(detection.bestIndicator?.width).toBe(2);
    expect(detection.bestIndicator?.height).toBe(32);
  });

  it("ignores small orange noise in the sidebar", () => {
    const bitmap = createBitmap(320, 220);
    fillRect(bitmap, 260, 80, 6, 9, 220, 138, 0);
    fillRect(bitmap, 280, 150, 5, 4, 235, 130, 10);

    const detection = detectRuneLiteSidePanelOrangeIndicator(bitmap);

    expect(detection.bestIndicator).toBeNull();
  });

  it("matches the recorded full-open RuneLite sidebar and rejects compact states when screenshots are available", () => {
    const closedPath = "test-images/1335x1549-2k-125-small-side-bar-runelite.png";
    const openPath = "test-images/1639x1549-2k-125-open-sidebar-runelite.png";
    if (!fs.existsSync(closedPath) || !fs.existsSync(openPath)) {
      return;
    }

    const closed = detectRuneLiteSidePanelOrangeIndicator(loadPngBitmap(closedPath));
    const open = detectRuneLiteSidePanelOrangeIndicator(loadPngBitmap(openPath));

    expect(closed.bestIndicator).toBeNull();
    expect(open.bestIndicator).not.toBeNull();
    expect(open.bestIndicator?.centerY).toBeGreaterThanOrEqual(350);
    expect(open.bestIndicator?.centerY).toBeLessThanOrEqual(400);
  });
});
