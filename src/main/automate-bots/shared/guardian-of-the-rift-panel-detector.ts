import type { RobotBitmap } from "./ocr-engine";

export type GuardianOfTheRiftTimeSincePortalColor = "green" | "yellow" | "white" | "red";

export type GuardianOfTheRiftTimeSincePortalDetection = {
  color: GuardianOfTheRiftTimeSincePortalColor | null;
  confidence: number;
  pixelCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  counts: Record<GuardianOfTheRiftTimeSincePortalColor, number>;
};

type Roi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const TIME_SINCE_PORTAL_VALUE_ROI: Roi = {
  x: 168,
  y: 398,
  width: 44,
  height: 32,
};

const MIN_TIME_SINCE_PORTAL_COLOR_PIXELS = 20;
const TIME_SINCE_PORTAL_COLORS: GuardianOfTheRiftTimeSincePortalColor[] = ["green", "yellow", "white", "red"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampRoi(bitmap: RobotBitmap, roi: Roi): Roi {
  const x = clamp(Math.floor(roi.x), 0, bitmap.width - 1);
  const y = clamp(Math.floor(roi.y), 0, bitmap.height - 1);
  const maxX = clamp(Math.floor(roi.x + roi.width - 1), x, bitmap.width - 1);
  const maxY = clamp(Math.floor(roi.y + roi.height - 1), y, bitmap.height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function createCounts(): Record<GuardianOfTheRiftTimeSincePortalColor, number> {
  return {
    green: 0,
    yellow: 0,
    white: 0,
    red: 0,
  };
}

function createBounds(): Record<GuardianOfTheRiftTimeSincePortalColor, Bounds | null> {
  return {
    green: null,
    yellow: null,
    white: null,
    red: null,
  };
}

function includePixelInBounds(bounds: Bounds | null, x: number, y: number): Bounds {
  if (!bounds) {
    return {
      minX: x,
      minY: y,
      maxX: x,
      maxY: y,
    };
  }

  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  };
}

function classifyTimeSincePortalPixel(r: number, g: number, b: number): GuardianOfTheRiftTimeSincePortalColor | null {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  if (g >= 130 && g - r >= 45 && g - b >= 45) {
    return "green";
  }

  if (r >= 150 && g >= 125 && b <= 110 && Math.abs(r - g) <= 95 && r - b >= 70 && g - b >= 55) {
    return "yellow";
  }

  if (r >= 140 && r - g >= 35 && r - b >= 35 && g <= 140 && b <= 130) {
    return "red";
  }

  if (luminance >= 145 && maxChannel - minChannel <= 55) {
    return "white";
  }

  return null;
}

function pickBestColor(
  counts: Record<GuardianOfTheRiftTimeSincePortalColor, number>,
): GuardianOfTheRiftTimeSincePortalColor | null {
  return TIME_SINCE_PORTAL_COLORS
    .slice()
    .sort((a, b) => counts[b] - counts[a])[0];
}

export function detectGuardianOfTheRiftTimeSincePortal(
  bitmap: RobotBitmap,
): GuardianOfTheRiftTimeSincePortalDetection {
  const roi = clampRoi(bitmap, TIME_SINCE_PORTAL_VALUE_ROI);
  const counts = createCounts();
  const boundsByColor = createBounds();

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const color = classifyTimeSincePortalPixel(r, g, b);

      if (!color) {
        continue;
      }

      counts[color] += 1;
      boundsByColor[color] = includePixelInBounds(boundsByColor[color], x, y);
    }
  }

  const bestColor = pickBestColor(counts);
  const bestPixelCount = bestColor ? counts[bestColor] : 0;
  const totalColorPixels = TIME_SINCE_PORTAL_COLORS.reduce((sum, color) => sum + counts[color], 0);
  const color = bestColor && bestPixelCount >= MIN_TIME_SINCE_PORTAL_COLOR_PIXELS ? bestColor : null;
  const bounds = color ? boundsByColor[color] : null;

  return {
    color,
    confidence: totalColorPixels > 0 ? bestPixelCount / totalColorPixels : 0,
    pixelCount: color ? bestPixelCount : 0,
    x: bounds ? bounds.minX : roi.x,
    y: bounds ? bounds.minY : roi.y,
    width: bounds ? bounds.maxX - bounds.minX + 1 : roi.width,
    height: bounds ? bounds.maxY - bounds.minY + 1 : roi.height,
    counts,
  };
}
