import { describe, expect, test } from "vitest";
import {
  detectArceuusYellowMarkers,
  getArceuusYellowMarkerTierForAgilityLevel,
  pickArceuusYellowMarkerForAgilityLevel,
} from "./arceuus-yellow-marker-detector";
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

function fillRect(
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

describe("Arceuus yellow marker detector", () => {
  test("maps agility level to the correct marker tier", () => {
    expect(getArceuusYellowMarkerTierForAgilityLevel(1)).toBe("base");
    expect(getArceuusYellowMarkerTierForAgilityLevel(51)).toBe("base");
    expect(getArceuusYellowMarkerTierForAgilityLevel(52)).toBe("agility-52");
    expect(getArceuusYellowMarkerTierForAgilityLevel(68)).toBe("agility-52");
    expect(getArceuusYellowMarkerTierForAgilityLevel(69)).toBe("agility-69");
    expect(getArceuusYellowMarkerTierForAgilityLevel(72)).toBe("agility-69");
    expect(getArceuusYellowMarkerTierForAgilityLevel(73)).toBe("agility-73");
    expect(getArceuusYellowMarkerTierForAgilityLevel(74)).toBe("agility-73");
  });

  test("detects four distinct yellow marker shades and selects by agility", () => {
    const bitmap = createBitmap(640, 480, { r: 30, g: 30, b: 30 });
    fillRect(bitmap, 100, 220, 36, 36, { r: 255, g: 255, b: 0 });
    fillRect(bitmap, 240, 220, 36, 36, { r: 255, g: 210, b: 0 });
    fillRect(bitmap, 380, 220, 36, 36, { r: 255, g: 165, b: 0 });
    fillRect(bitmap, 520, 220, 36, 36, { r: 255, g: 122, b: 0 });

    const markers = detectArceuusYellowMarkers(bitmap);
    expect(markers.map((marker) => marker.tier).sort()).toEqual(["agility-52", "agility-69", "agility-73", "base"]);
    expect(pickArceuusYellowMarkerForAgilityLevel(markers, 1, null, bitmap)?.tier).toBe("base");
    expect(pickArceuusYellowMarkerForAgilityLevel(markers, 60, null, bitmap)?.tier).toBe("agility-52");
    expect(pickArceuusYellowMarkerForAgilityLevel(markers, 70, null, bitmap)?.tier).toBe("agility-69");
    expect(pickArceuusYellowMarkerForAgilityLevel(markers, 80, null, bitmap)?.tier).toBe("agility-73");
  });
});
