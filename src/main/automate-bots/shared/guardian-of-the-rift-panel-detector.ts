import type { RobotBitmap } from "./ocr-engine";
import { getGuardianOfTheRiftOverlayMode, type GuardianOfTheRiftOverlayMode } from "./guardian-of-the-rift-overlay-mode";

export type GuardianOfTheRiftTimeSincePortalColor = "green" | "yellow" | "white" | "red";

export type GuardianOfTheRiftTimeSincePortalDetection = {
  color: GuardianOfTheRiftTimeSincePortalColor | null;
  secondsElapsed: number | null;
  rawText: string | null;
  confidence: number;
  pixelCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  counts: Record<GuardianOfTheRiftTimeSincePortalColor, number>;
};

export type GuardianOfTheRiftRewardPointFocus = "elemental" | "catalytic" | "balanced";

export type GuardianOfTheRiftRewardPointsDetection = {
  elementalPoints: number | null;
  catalyticPoints: number | null;
  rawText: string | null;
  focus: GuardianOfTheRiftRewardPointFocus | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GuardianOfTheRiftPowerBarFillColor = "blue" | "yellow" | "empty" | "missing";

export type GuardianOfTheRiftPowerBarDetection = {
  fillColor: GuardianOfTheRiftPowerBarFillColor;
  fillPercent: number | null;
  filledPixels: number;
  bluePixels: number;
  yellowPixels: number;
  emptyPixels: number;
  visiblePixels: number;
  x: number;
  y: number;
  width: number;
  height: number;
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

type DigitComponent = Bounds & {
  pixelCount: number;
  pixels: Array<{ x: number; y: number }>;
};

type TimeSincePortalParseResult = {
  secondsElapsed: number | null;
  rawText: string | null;
  components: DigitComponent[];
};

type TimeSincePortalParseMode = "seconds" | "mmss";

type TimeSincePortalColorStats = {
  counts: Record<GuardianOfTheRiftTimeSincePortalColor, number>;
  boundsByColor: Record<GuardianOfTheRiftTimeSincePortalColor, Bounds | null>;
};

const TIME_SINCE_PORTAL_VALUE_ROI: Roi = {
  x: 168,
  y: 398,
  width: 44,
  height: 32,
};

const OPTIMIZER_TIME_SINCE_PORTAL_VALUE_ROIS: Roi[] = [
  {
    x: 116,
    y: 392,
    width: 112,
    height: 38,
  },
  {
    x: 96,
    y: 388,
    width: 132,
    height: 42,
  },
];

const REWARD_POINTS_VALUE_ROI: Roi = {
  x: 150,
  y: 430,
  width: 58,
  height: 40,
};

const OPTIMIZER_REWARD_POINTS_VALUE_ROI: Roi = {
  x: 116,
  y: 430,
  width: 112,
  height: 42,
};

const POWER_BAR_ROI: Roi = {
  x: 17,
  y: 70,
  width: 200,
  height: 20,
};

const MIN_POWER_BAR_BLUE_PIXELS = 500;
const MIN_POWER_BAR_YELLOW_PIXELS = 80;
const MIN_POWER_BAR_EMPTY_PIXELS = 400;
const MIN_POWER_BAR_VISIBLE_PIXELS = 700;
const MIN_POWER_BAR_COLUMN_VISIBLE_PIXELS = 3;
const MIN_POWER_BAR_COLUMN_FILLED_PIXELS = 2;
const MIN_TIME_SINCE_PORTAL_COLOR_PIXELS = 20;
const TIME_SINCE_PORTAL_COLORS: GuardianOfTheRiftTimeSincePortalColor[] = ["green", "yellow", "white", "red"];
const MIN_TIME_SINCE_PORTAL_DIGIT_PIXELS = 8;
const REWARD_POINTS_MAX_DIGIT_GAP_PX = 7;
const REWARD_POINTS_MAX_SLASH_GAP_PX = 10;
const REWARD_POINTS_MAX_DIGITS_PER_SIDE = 3;
const REWARD_POINTS_LABEL_LOOKBACK_PX = 150;
const REWARD_POINTS_LABEL_PAD_Y = 5;
const MAX_DIGIT_COMPONENT_WIDTH_PX = 20;
const MAX_TIME_SINCE_PORTAL_SECONDS = 180;
const MAX_REWARD_POINTS = 999;

const TIME_SINCE_PORTAL_DIGIT_TEMPLATE_ROWS: Record<string, string[][]> = {
  "0": [
    ["01110", "11111", "11011", "11011", "11011", "11111", "11111"],
  ],
  "1": [
    ["00011", "01111", "11111", "11111", "00111", "00111", "00111"],
    ["00011", "01111", "11111", "00111", "00111", "00111", "00111"],
  ],
  "2": [
    ["01111", "11111", "11011", "00011", "00110", "11100", "11111"],
  ],
  "3": [
    ["11111", "11111", "00111", "00111", "11011", "11111", "11111"],
  ],
  "4": [
    ["00011", "00111", "01111", "11111", "11111", "11111", "00111"],
  ],
  "5": [
    ["11111", "11111", "11111", "11111", "11011", "11111", "11111"],
    ["11111", "11111", "11111", "11111", "10011", "11111", "11111"],
  ],
  "6": [
    ["01111", "11111", "11100", "11111", "11011", "11111", "11111"],
    ["11111", "11111", "11110", "11111", "11011", "11111", "11111"],
  ],
  "7": [
    ["11111", "11111", "00110", "01110", "01100", "01100", "11100"],
  ],
  "8": [
    ["01111", "11111", "11111", "11111", "11011", "11111", "11111"],
  ],
  "9": [
    ["01110", "11111", "11011", "11111", "01111", "11111", "11111"],
  ],
};

const TIME_SINCE_PORTAL_DIGIT_TEMPLATES = Object.entries(TIME_SINCE_PORTAL_DIGIT_TEMPLATE_ROWS).flatMap(
  ([digit, variants]) =>
    variants.map((rows) => ({
      digit,
      bits: rows.join("").split("").map((value) => (value === "1" ? 1 : 0)),
    })),
);

const REWARD_POINTS_SLASH_TEMPLATE = ["00111", "00111", "01110", "01110", "01110", "11110", "11100"]
  .join("")
  .split("")
  .map((value) => (value === "1" ? 1 : 0));

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

function isPowerBarBluePixel(r: number, g: number, b: number): boolean {
  return g >= 170 && b >= 170 && r <= 120 && g - r >= 70 && b - r >= 70;
}

function isPowerBarYellowPixel(r: number, g: number, b: number): boolean {
  return r >= 170 && g >= 145 && b <= 130 && r - b >= 60 && g - b >= 50;
}

function isPowerBarEmptyPixel(r: number, g: number, b: number): boolean {
  return r >= 115 && g >= 115 && b >= 105 && Math.max(r, g, b) - Math.min(r, g, b) <= 55;
}

function isRewardPointTextPixel(r: number, g: number, b: number): boolean {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  return luminance >= 130 && maxChannel - minChannel <= 80;
}

function pickBestColor(
  counts: Record<GuardianOfTheRiftTimeSincePortalColor, number>,
): GuardianOfTheRiftTimeSincePortalColor | null {
  return TIME_SINCE_PORTAL_COLORS
    .slice()
    .sort((a, b) => counts[b] - counts[a])[0];
}

function collectTimeSincePortalColorStatsFromPixels(
  bitmap: RobotBitmap,
  pixels: Array<{ x: number; y: number }>,
): TimeSincePortalColorStats {
  const counts = createCounts();
  const boundsByColor = createBounds();

  for (const pixel of pixels) {
    const offset = pixel.y * bitmap.byteWidth + pixel.x * bitmap.bytesPerPixel;
    const b = bitmap.image[offset];
    const g = bitmap.image[offset + 1];
    const r = bitmap.image[offset + 2];
    const color = classifyTimeSincePortalPixel(r, g, b);

    if (!color) {
      continue;
    }

    counts[color] += 1;
    boundsByColor[color] = includePixelInBounds(boundsByColor[color], pixel.x, pixel.y);
  }

  return {
    counts,
    boundsByColor,
  };
}

function collectTimeSincePortalColorStatsFromRoi(bitmap: RobotBitmap, roi: Roi): TimeSincePortalColorStats {
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

  return {
    counts,
    boundsByColor,
  };
}

function buildDigitMask(
  bitmap: RobotBitmap,
  roi: Roi,
  isDigitPixel: (r: number, g: number, b: number) => boolean,
): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isDigitPixel(r, g, b)) {
        mask[y * bitmap.width + x] = 1;
      }
    }
  }

  return mask;
}

function collectDigitComponents(bitmap: RobotBitmap, roi: Roi, mask: Uint8Array): DigitComponent[] {
  const visited = new Uint8Array(bitmap.width * bitmap.height);
  const components: DigitComponent[] = [];
  const minX = roi.x;
  const minY = roi.y;
  const maxX = roi.x + roi.width - 1;
  const maxY = roi.y + roi.height - 1;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const startIndex = y * bitmap.width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      if (mask[startIndex] === 0) {
        continue;
      }

      const stack = [{ x, y }];
      const pixels: Array<{ x: number; y: number }> = [];
      let componentMinX = x;
      let componentMinY = y;
      let componentMaxX = x;
      let componentMaxY = y;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        pixels.push(current);
        componentMinX = Math.min(componentMinX, current.x);
        componentMinY = Math.min(componentMinY, current.y);
        componentMaxX = Math.max(componentMaxX, current.x);
        componentMaxY = Math.max(componentMaxY, current.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = current.x + dx;
            const nextY = current.y + dy;
            if (nextX < minX || nextY < minY || nextX > maxX || nextY > maxY) {
              continue;
            }

            const nextIndex = nextY * bitmap.width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            if (mask[nextIndex]) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      const width = componentMaxX - componentMinX + 1;
      const height = componentMaxY - componentMinY + 1;
      if (
        pixels.length >= MIN_TIME_SINCE_PORTAL_DIGIT_PIXELS &&
        width >= 2 &&
        width <= MAX_DIGIT_COMPONENT_WIDTH_PX &&
        height >= 8 &&
        height <= 18
      ) {
        components.push({
          minX: componentMinX,
          minY: componentMinY,
          maxX: componentMaxX,
          maxY: componentMaxY,
          pixelCount: pixels.length,
          pixels,
        });
      }
    }
  }

  return components.sort((a, b) => a.minX - b.minX);
}

function normalizeDigitComponent(component: DigitComponent): number[] {
  const bits: number[] = [];
  const pixelSet = new Set(component.pixels.map((pixel) => `${pixel.x},${pixel.y}`));
  const sourceWidth = component.maxX - component.minX + 1;
  const sourceHeight = component.maxY - component.minY + 1;

  for (let targetY = 0; targetY < 7; targetY += 1) {
    const sourceY0 = component.minY + Math.floor((targetY * sourceHeight) / 7);
    const sourceY1 = component.minY + Math.ceil(((targetY + 1) * sourceHeight) / 7);

    for (let targetX = 0; targetX < 5; targetX += 1) {
      const sourceX0 = component.minX + Math.floor((targetX * sourceWidth) / 5);
      const sourceX1 = component.minX + Math.ceil(((targetX + 1) * sourceWidth) / 5);
      let area = 0;
      let on = 0;

      for (let y = sourceY0; y < sourceY1; y += 1) {
        for (let x = sourceX0; x < sourceX1; x += 1) {
          area += 1;
          if (pixelSet.has(`${x},${y}`)) {
            on += 1;
          }
        }
      }

      bits.push(area > 0 && on / area >= 0.25 ? 1 : 0);
    }
  }

  return bits;
}

function classifyDigit(component: DigitComponent): string | null {
  const bits = normalizeDigitComponent(component);
  let bestDigit: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const template of TIME_SINCE_PORTAL_DIGIT_TEMPLATES) {
    const distance = scoreBits(bits, template.bits);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestDigit = template.digit;
    }
  }

  return bestDistance <= 8 ? bestDigit : null;
}

function detectGuardianOfTheRiftPowerBarInRoi(bitmap: RobotBitmap, sourceRoi: Roi): GuardianOfTheRiftPowerBarDetection {
  const roi = clampRoi(bitmap, sourceRoi);
  let bluePixels = 0;
  let yellowPixels = 0;
  let emptyPixels = 0;
  const filledPixelsByColumn = new Array<number>(roi.width).fill(0);
  const visiblePixelsByColumn = new Array<number>(roi.width).fill(0);

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const localX = x - roi.x;

      if (isPowerBarBluePixel(r, g, b)) {
        bluePixels += 1;
        filledPixelsByColumn[localX] += 1;
        visiblePixelsByColumn[localX] += 1;
      } else if (isPowerBarYellowPixel(r, g, b)) {
        yellowPixels += 1;
        filledPixelsByColumn[localX] += 1;
        visiblePixelsByColumn[localX] += 1;
      } else if (isPowerBarEmptyPixel(r, g, b)) {
        emptyPixels += 1;
        visiblePixelsByColumn[localX] += 1;
      }
    }
  }

  const filledPixels = bluePixels + yellowPixels;
  const visiblePixels = bluePixels + yellowPixels + emptyPixels;
  let filledColumns = 0;
  let visibleColumns = 0;
  for (let i = 0; i < roi.width; i += 1) {
    if (visiblePixelsByColumn[i] >= MIN_POWER_BAR_COLUMN_VISIBLE_PIXELS) {
      visibleColumns += 1;
    }

    if (filledPixelsByColumn[i] >= MIN_POWER_BAR_COLUMN_FILLED_PIXELS) {
      filledColumns += 1;
    }
  }

  let fillColor: GuardianOfTheRiftPowerBarFillColor = "missing";
  if (bluePixels >= MIN_POWER_BAR_BLUE_PIXELS && bluePixels > yellowPixels) {
    fillColor = "blue";
  } else if (yellowPixels >= MIN_POWER_BAR_YELLOW_PIXELS) {
    fillColor = "yellow";
  } else if (emptyPixels >= MIN_POWER_BAR_EMPTY_PIXELS && visiblePixels >= MIN_POWER_BAR_VISIBLE_PIXELS) {
    fillColor = "empty";
  }
  const fillPercent =
    fillColor === "missing" || visibleColumns === 0
      ? null
      : Math.max(0, Math.min(100, Math.round((filledColumns / visibleColumns) * 100)));

  return {
    fillColor,
    fillPercent,
    filledPixels,
    bluePixels,
    yellowPixels,
    emptyPixels,
    visiblePixels,
    x: roi.x,
    y: roi.y,
    width: roi.width,
    height: roi.height,
  };
}

export function detectGuardianOfTheRiftPowerBarFromHelperPanel(bitmap: RobotBitmap): GuardianOfTheRiftPowerBarDetection {
  return detectGuardianOfTheRiftPowerBarInRoi(bitmap, POWER_BAR_ROI);
}

export function detectGuardianOfTheRiftPowerBarFromOptimizerPanel(bitmap: RobotBitmap): GuardianOfTheRiftPowerBarDetection {
  return detectGuardianOfTheRiftPowerBarInRoi(bitmap, POWER_BAR_ROI);
}

export function detectGuardianOfTheRiftPowerBar(
  bitmap: RobotBitmap,
  mode: GuardianOfTheRiftOverlayMode = getGuardianOfTheRiftOverlayMode(),
): GuardianOfTheRiftPowerBarDetection {
  return mode === "helper"
    ? detectGuardianOfTheRiftPowerBarFromHelperPanel(bitmap)
    : detectGuardianOfTheRiftPowerBarFromOptimizerPanel(bitmap);
}

function parseTimeSincePortalSeconds(
  bitmap: RobotBitmap,
  roi: Roi,
  parseMode: TimeSincePortalParseMode,
): TimeSincePortalParseResult {
  const mask = buildDigitMask(bitmap, roi, (r, g, b) => classifyTimeSincePortalPixel(r, g, b) !== null);
  const components = collectDigitComponents(bitmap, roi, mask);
  const parsedComponents: DigitComponent[] = [];
  let rawText = "";

  for (const component of components) {
    const digit = classifyDigit(component);
    if (digit === null) {
      continue;
    }

    rawText += digit;
    parsedComponents.push(component);
  }

  if (rawText.length === 0) {
    return {
      secondsElapsed: null,
      rawText: null,
      components: [],
    };
  }

  const parsed =
    parseMode === "mmss" && rawText.length >= 3
      ? Number(rawText.slice(0, -2)) * 60 + Number(rawText.slice(-2))
      : Number(rawText);
  const fallbackParsed =
    parseMode === "mmss" &&
    rawText.length === 3 &&
    parsed > MAX_TIME_SINCE_PORTAL_SECONDS &&
    Number(rawText.slice(-2)) < 60
      ? Number(rawText.slice(-2))
      : parsed;
  return {
    secondsElapsed:
      Number.isFinite(fallbackParsed) &&
      fallbackParsed >= 0 &&
      fallbackParsed <= MAX_TIME_SINCE_PORTAL_SECONDS &&
      (parseMode !== "mmss" || rawText.length < 3 || Number(rawText.slice(-2)) < 60)
        ? fallbackParsed
        : null,
    rawText,
    components: parsedComponents,
  };
}

function scoreBits(bits: number[], template: number[]): number {
  let distance = 0;
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] !== template[index]) {
      distance += 1;
    }
  }

  return distance;
}

function isRewardPointSlash(component: DigitComponent): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  if (width < 3 || width > 6 || height < 10 || height > 18) {
    return false;
  }

  return scoreBits(normalizeDigitComponent(component), REWARD_POINTS_SLASH_TEMPLATE) <= 7;
}

function createDigitComponentFromPixels(pixels: Array<{ x: number; y: number }>): DigitComponent | null {
  if (pixels.length < MIN_TIME_SINCE_PORTAL_DIGIT_PIXELS) {
    return null;
  }

  const minX = Math.min(...pixels.map((pixel) => pixel.x));
  const minY = Math.min(...pixels.map((pixel) => pixel.y));
  const maxX = Math.max(...pixels.map((pixel) => pixel.x));
  const maxY = Math.max(...pixels.map((pixel) => pixel.y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  if (width < 2 || width > MAX_DIGIT_COMPONENT_WIDTH_PX || height < 8 || height > 18) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    pixelCount: pixels.length,
    pixels,
  };
}

function splitConnectedRewardPointComponent(component: DigitComponent): DigitComponent[] {
  const width = component.maxX - component.minX + 1;
  if (width <= 12) {
    return [component];
  }

  for (let splitX = component.minX + 2; splitX <= component.maxX - 2; splitX += 1) {
    const left = createDigitComponentFromPixels(component.pixels.filter((pixel) => pixel.x <= splitX));
    const right = createDigitComponentFromPixels(component.pixels.filter((pixel) => pixel.x > splitX));
    if (!left || !right) {
      continue;
    }

    if ((isRewardPointSlash(left) && classifyDigit(right) !== null) || (classifyDigit(left) !== null && isRewardPointSlash(right))) {
      return [left, right];
    }
  }

  return [component];
}

function splitConnectedRewardPointComponents(components: DigitComponent[]): DigitComponent[] {
  return components
    .flatMap(splitConnectedRewardPointComponent)
    .sort((a, b) => a.minX - b.minX);
}

function parseRewardPointNumber(components: DigitComponent[]): number | null {
  let rawText = "";

  for (const component of components) {
    const digit = classifyDigit(component);
    if (digit === null) {
      return null;
    }

    rawText += digit;
  }

  if (rawText.length === 0) {
    return null;
  }

  const parsed = Number(rawText);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_REWARD_POINTS ? parsed : null;
}

function componentCenterY(component: DigitComponent): number {
  return (component.minY + component.maxY) / 2;
}

function isSameTextRow(a: DigitComponent, b: DigitComponent): boolean {
  const overlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) + 1;
  const minHeight = Math.min(a.maxY - a.minY + 1, b.maxY - b.minY + 1);

  return overlap >= Math.max(3, minHeight * 0.45) && Math.abs(componentCenterY(a) - componentCenterY(b)) <= 7;
}

function collectAdjacentRewardPointDigits(
  rowComponents: DigitComponent[],
  slash: DigitComponent,
  direction: "left" | "right",
): DigitComponent[] {
  const result: DigitComponent[] = [];

  if (direction === "left") {
    const candidates = rowComponents
      .filter((component) => component.maxX < slash.minX)
      .sort((a, b) => b.maxX - a.maxX);

    let previousMinX = slash.minX;
    for (const component of candidates) {
      const gap = previousMinX - component.maxX;
      if (gap > (result.length === 0 ? REWARD_POINTS_MAX_SLASH_GAP_PX : REWARD_POINTS_MAX_DIGIT_GAP_PX)) {
        break;
      }

      result.push(component);
      previousMinX = component.minX;

      if (result.length >= REWARD_POINTS_MAX_DIGITS_PER_SIDE) {
        break;
      }
    }

    return result.reverse();
  }

  const candidates = rowComponents
    .filter((component) => component.minX > slash.maxX)
    .sort((a, b) => a.minX - b.minX);

  let previousMaxX = slash.maxX;
  for (const component of candidates) {
    const gap = component.minX - previousMaxX;
    if (gap > (result.length === 0 ? REWARD_POINTS_MAX_SLASH_GAP_PX : REWARD_POINTS_MAX_DIGIT_GAP_PX)) {
      break;
    }

    result.push(component);
    previousMaxX = component.maxX;

    if (result.length >= REWARD_POINTS_MAX_DIGITS_PER_SIDE) {
      break;
    }
  }

  return result;
}

function resolveRewardPointFocus(
  elementalPoints: number | null,
  catalyticPoints: number | null,
): GuardianOfTheRiftRewardPointFocus | null {
  if (elementalPoints === null || catalyticPoints === null) {
    return null;
  }

  if (elementalPoints < catalyticPoints) {
    return "elemental";
  }

  if (catalyticPoints < elementalPoints) {
    return "catalytic";
  }

  return "balanced";
}

function getComponentsBounds(components: DigitComponent[], fallbackRoi: Roi): Bounds {
  if (components.length === 0) {
    return {
      minX: fallbackRoi.x,
      minY: fallbackRoi.y,
      maxX: fallbackRoi.x + fallbackRoi.width - 1,
      maxY: fallbackRoi.y + fallbackRoi.height - 1,
    };
  }

  return {
    minX: Math.min(...components.map((component) => component.minX)),
    minY: Math.min(...components.map((component) => component.minY)),
    maxX: Math.max(...components.map((component) => component.maxX)),
    maxY: Math.max(...components.map((component) => component.maxY)),
  };
}

type RewardPointCandidate = GuardianOfTheRiftRewardPointsDetection & {
  score: number;
};

function countRewardLabelPixels(bitmap: RobotBitmap, bounds: Bounds): number {
  const minX = clamp(bounds.minX - REWARD_POINTS_LABEL_LOOKBACK_PX, 0, bitmap.width - 1);
  const maxX = clamp(bounds.minX - 1, 0, bitmap.width - 1);
  const minY = clamp(bounds.minY - REWARD_POINTS_LABEL_PAD_Y, 0, bitmap.height - 1);
  const maxY = clamp(bounds.maxY + REWARD_POINTS_LABEL_PAD_Y, minY, bitmap.height - 1);
  let pixels = 0;

  if (maxX <= minX) {
    return 0;
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isRewardPointTextPixel(r, g, b)) {
        pixels += 1;
      }
    }
  }

  return pixels;
}

function detectRewardPointsInRoi(bitmap: RobotBitmap, roi: Roi): RewardPointCandidate[] {
  const mask = buildDigitMask(bitmap, roi, isRewardPointTextPixel);
  const components = splitConnectedRewardPointComponents(collectDigitComponents(bitmap, roi, mask));
  const candidates: RewardPointCandidate[] = [];

  for (const slash of components.filter(isRewardPointSlash)) {
    const rowComponents = components.filter((component) => component !== slash && isSameTextRow(component, slash));
    const elementalComponents = collectAdjacentRewardPointDigits(rowComponents, slash, "left");
    const catalyticComponents = collectAdjacentRewardPointDigits(rowComponents, slash, "right");
    const elementalPoints = parseRewardPointNumber(elementalComponents);
    const catalyticPoints = parseRewardPointNumber(catalyticComponents);

    if (elementalPoints === null || catalyticPoints === null) {
      continue;
    }

    const bounds = getComponentsBounds([...elementalComponents, slash, ...catalyticComponents], roi);
    const labelPixels = countRewardLabelPixels(bitmap, bounds);

    candidates.push({
      elementalPoints,
      catalyticPoints,
      rawText: `${elementalPoints}/${catalyticPoints}`,
      focus: resolveRewardPointFocus(elementalPoints, catalyticPoints),
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX + 1,
      height: bounds.maxY - bounds.minY + 1,
      score: labelPixels,
    });
  }

  return candidates;
}

function resolveRewardPointSearchRois(bitmap: RobotBitmap): Roi[] {
  const fixedRoi = clampRoi(bitmap, REWARD_POINTS_VALUE_ROI);
  const broadRoi = clampRoi(bitmap, {
    x: 0,
    y: 0,
    width: Math.min(bitmap.width, Math.max(650, Math.round(bitmap.width * 0.48))),
    height: Math.min(bitmap.height, Math.max(520, Math.round(bitmap.height * 0.5))),
  });

  return [fixedRoi, broadRoi];
}

function createEmptyRewardPointsDetection(roi: Roi): GuardianOfTheRiftRewardPointsDetection {
  return {
    elementalPoints: null,
    catalyticPoints: null,
    rawText: null,
    focus: null,
    x: roi.x,
    y: roi.y,
    width: roi.width,
    height: roi.height,
  };
}

export function detectGuardianOfTheRiftRewardPointsFromHelperPanel(bitmap: RobotBitmap): GuardianOfTheRiftRewardPointsDetection {
  const rois = resolveRewardPointSearchRois(bitmap);
  const candidates = rois.flatMap((roi) => detectRewardPointsInRoi(bitmap, roi));
  const bestCandidate = candidates.sort((a, b) => b.score - a.score || a.y - b.y)[0];
  if (bestCandidate) {
    return {
      elementalPoints: bestCandidate.elementalPoints,
      catalyticPoints: bestCandidate.catalyticPoints,
      rawText: bestCandidate.rawText,
      focus: bestCandidate.focus,
      x: bestCandidate.x,
      y: bestCandidate.y,
      width: bestCandidate.width,
      height: bestCandidate.height,
    };
  }

  return createEmptyRewardPointsDetection(rois[0]);
}

export function detectGuardianOfTheRiftRewardPointsFromOptimizerPanel(bitmap: RobotBitmap): GuardianOfTheRiftRewardPointsDetection {
  const roi = clampRoi(bitmap, OPTIMIZER_REWARD_POINTS_VALUE_ROI);
  return createEmptyRewardPointsDetection(roi);
}

export function detectGuardianOfTheRiftRewardPoints(
  bitmap: RobotBitmap,
  mode: GuardianOfTheRiftOverlayMode = getGuardianOfTheRiftOverlayMode(),
): GuardianOfTheRiftRewardPointsDetection {
  return mode === "helper"
    ? detectGuardianOfTheRiftRewardPointsFromHelperPanel(bitmap)
    : detectGuardianOfTheRiftRewardPointsFromOptimizerPanel(bitmap);
}

function detectGuardianOfTheRiftTimeSincePortalInRoi(
  bitmap: RobotBitmap,
  sourceRoi: Roi,
  parseMode: TimeSincePortalParseMode,
): GuardianOfTheRiftTimeSincePortalDetection {
  const roi = clampRoi(bitmap, sourceRoi);
  const parsedTime = parseTimeSincePortalSeconds(bitmap, roi, parseMode);
  const digitPixels = parsedTime.components.flatMap((component) => component.pixels);
  const colorStats =
    digitPixels.length > 0
      ? collectTimeSincePortalColorStatsFromPixels(bitmap, digitPixels)
      : collectTimeSincePortalColorStatsFromRoi(bitmap, roi);
  const { counts, boundsByColor } = colorStats;

  const bestColor = pickBestColor(counts);
  const bestPixelCount = bestColor ? counts[bestColor] : 0;
  const totalColorPixels = TIME_SINCE_PORTAL_COLORS.reduce((sum, color) => sum + counts[color], 0);
  const color = bestColor && bestPixelCount >= MIN_TIME_SINCE_PORTAL_COLOR_PIXELS ? bestColor : null;
  const bounds = color ? boundsByColor[color] : null;

  return {
    color,
    secondsElapsed: parsedTime.secondsElapsed,
    rawText: parsedTime.rawText,
    confidence: totalColorPixels > 0 ? bestPixelCount / totalColorPixels : 0,
    pixelCount: color ? bestPixelCount : 0,
    x: bounds ? bounds.minX : roi.x,
    y: bounds ? bounds.minY : roi.y,
    width: bounds ? bounds.maxX - bounds.minX + 1 : roi.width,
    height: bounds ? bounds.maxY - bounds.minY + 1 : roi.height,
    counts,
  };
}

export function detectGuardianOfTheRiftTimeSincePortalFromHelperPanel(
  bitmap: RobotBitmap,
): GuardianOfTheRiftTimeSincePortalDetection {
  return detectGuardianOfTheRiftTimeSincePortalInRoi(bitmap, TIME_SINCE_PORTAL_VALUE_ROI, "seconds");
}

export function detectGuardianOfTheRiftTimeSincePortalFromOptimizerPanel(
  bitmap: RobotBitmap,
): GuardianOfTheRiftTimeSincePortalDetection {
  const detections = OPTIMIZER_TIME_SINCE_PORTAL_VALUE_ROIS.map((roi) =>
    detectGuardianOfTheRiftTimeSincePortalInRoi(bitmap, roi, "mmss"),
  );

  return (
    detections.find((detection) => detection.secondsElapsed !== null) ??
    detections.find((detection) => detection.color !== null) ??
    detections[0]
  );
}

export function detectGuardianOfTheRiftTimeSincePortal(
  bitmap: RobotBitmap,
  mode: GuardianOfTheRiftOverlayMode = getGuardianOfTheRiftOverlayMode(),
): GuardianOfTheRiftTimeSincePortalDetection {
  return mode === "helper"
    ? detectGuardianOfTheRiftTimeSincePortalFromHelperPanel(bitmap)
    : detectGuardianOfTheRiftTimeSincePortalFromOptimizerPanel(bitmap);
}
