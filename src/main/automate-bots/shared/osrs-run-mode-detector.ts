import type { BitmapLike } from "./save-bitmap";
import { clamp } from "./osrs-helper";

export type OsrsRunMode = "run" | "walk" | "unknown";

export type OsrsRunModeMinimapGeometry = {
  centerLocalX: number;
  centerLocalY: number;
  radiusPx: number;
};

export type OsrsRunModeDetection = {
  mode: OsrsRunMode;
  confidence: number;
  centerX: number;
  centerY: number;
  radiusPx: number;
  yellowPixels: number;
  brownPixels: number;
  sampledPixels: number;
};

const RUN_ORB_CENTER_DX_LOGICAL = -79;
const RUN_ORB_CENTER_DY_LOGICAL = 50;
const RUN_ORB_SAMPLE_RADIUS_LOGICAL = 17;
const RUNELITE_MINIMAP_RADIUS_LOGICAL = 73;

function getBitmapRgb(bitmap: BitmapLike, x: number, y: number): { r: number; g: number; b: number } | null {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= bitmap.width || py >= bitmap.height) {
    return null;
  }

  const offset = py * bitmap.byteWidth + px * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
  };
}

function isRunYellowPixel(rgb: { r: number; g: number; b: number }): boolean {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return (
    max >= 130 &&
    rgb.r >= 145 &&
    rgb.g >= 95 &&
    rgb.b <= 110 &&
    rgb.r - rgb.b >= 55 &&
    rgb.g - rgb.b >= 35 &&
    max - min >= 55
  );
}

function isWalkBrownPixel(rgb: { r: number; g: number; b: number }): boolean {
  const brightness = (rgb.r + rgb.g + rgb.b) / 3;
  const warmBrown =
    rgb.r >= 65 &&
    rgb.r <= 185 &&
    rgb.g >= 35 &&
    rgb.g <= 135 &&
    rgb.b <= 95 &&
    rgb.r >= rgb.g + 12 &&
    rgb.g >= rgb.b + 4 &&
    brightness >= 45 &&
    brightness <= 155;
  const darkBronze =
    rgb.r >= 75 &&
    rgb.g >= 45 &&
    rgb.b <= 75 &&
    rgb.r - rgb.b >= 28 &&
    rgb.g - rgb.b >= 8 &&
    brightness <= 145;
  return warmBrown || darkBronze;
}

export function detectOsrsRunModeFromMinimap(
  bitmap: BitmapLike,
  minimap: OsrsRunModeMinimapGeometry,
): OsrsRunModeDetection {
  const scale = Math.max(0.5, minimap.radiusPx / RUNELITE_MINIMAP_RADIUS_LOGICAL);
  const centerX = Math.round(minimap.centerLocalX + RUN_ORB_CENTER_DX_LOGICAL * scale);
  const centerY = Math.round(minimap.centerLocalY + RUN_ORB_CENTER_DY_LOGICAL * scale);
  const radiusPx = Math.max(8, Math.round(RUN_ORB_SAMPLE_RADIUS_LOGICAL * scale));
  let yellowPixels = 0;
  let brownPixels = 0;
  let sampledPixels = 0;

  for (let y = centerY - radiusPx; y <= centerY + radiusPx; y += 1) {
    for (let x = centerX - radiusPx; x <= centerX + radiusPx; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radiusPx * radiusPx) {
        continue;
      }

      const rgb = getBitmapRgb(bitmap, x, y);
      if (!rgb) {
        continue;
      }

      sampledPixels += 1;
      if (isRunYellowPixel(rgb)) {
        yellowPixels += 1;
      } else if (isWalkBrownPixel(rgb)) {
        brownPixels += 1;
      }
    }
  }

  const yellowRatio = sampledPixels > 0 ? yellowPixels / sampledPixels : 0;
  const brownRatio = sampledPixels > 0 ? brownPixels / sampledPixels : 0;
  const mode =
    yellowPixels >= 18 && yellowRatio >= 0.015 && yellowPixels >= brownPixels * 0.18
      ? "run"
      : sampledPixels > 0
        ? "walk"
        : "unknown";
  const confidence =
    mode === "run"
      ? clamp(yellowRatio * 8 + yellowPixels / Math.max(1, brownPixels + yellowPixels), 0, 1)
      : mode === "walk"
        ? clamp(brownRatio * 2.6 + (1 - yellowRatio * 14), 0, 1)
        : 0;

  return {
    mode,
    confidence,
    centerX,
    centerY,
    radiusPx,
    yellowPixels,
    brownPixels,
    sampledPixels,
  };
}

export function formatOsrsRunModeDetection(detection: OsrsRunModeDetection): string {
  return `${detection.mode}:${detection.confidence.toFixed(2)} orb=${detection.centerX},${detection.centerY}/r${detection.radiusPx} yellow=${detection.yellowPixels} brown=${detection.brownPixels} sampled=${detection.sampledPixels}`;
}
