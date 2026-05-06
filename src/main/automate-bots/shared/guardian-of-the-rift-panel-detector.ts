import type { RobotBitmap } from "./ocr-engine";

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

const TIME_SINCE_PORTAL_VALUE_ROI: Roi = {
  x: 168,
  y: 398,
  width: 44,
  height: 32,
};

const REWARD_POINTS_VALUE_ROI: Roi = {
  x: 150,
  y: 430,
  width: 58,
  height: 40,
};

const MIN_TIME_SINCE_PORTAL_COLOR_PIXELS = 20;
const TIME_SINCE_PORTAL_COLORS: GuardianOfTheRiftTimeSincePortalColor[] = ["green", "yellow", "white", "red"];
const MIN_TIME_SINCE_PORTAL_DIGIT_PIXELS = 8;
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
        width <= 12 &&
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

function parseTimeSincePortalSeconds(
  bitmap: RobotBitmap,
  roi: Roi,
): { secondsElapsed: number | null; rawText: string | null } {
  const mask = buildDigitMask(bitmap, roi, (r, g, b) => classifyTimeSincePortalPixel(r, g, b) !== null);
  const components = collectDigitComponents(bitmap, roi, mask);
  let rawText = "";

  for (const component of components) {
    const digit = classifyDigit(component);
    if (digit === null) {
      continue;
    }

    rawText += digit;
  }

  if (rawText.length === 0) {
    return {
      secondsElapsed: null,
      rawText: null,
    };
  }

  const parsed = Number(rawText);
  return {
    secondsElapsed:
      Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_TIME_SINCE_PORTAL_SECONDS ? parsed : null,
    rawText,
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

export function detectGuardianOfTheRiftRewardPoints(bitmap: RobotBitmap): GuardianOfTheRiftRewardPointsDetection {
  const roi = clampRoi(bitmap, REWARD_POINTS_VALUE_ROI);
  const mask = buildDigitMask(bitmap, roi, isRewardPointTextPixel);
  const components = collectDigitComponents(bitmap, roi, mask);
  const slashIndex = components.findIndex(isRewardPointSlash);
  const elementalComponents = slashIndex >= 0 ? components.slice(0, slashIndex) : [];
  const catalyticComponents = slashIndex >= 0 ? components.slice(slashIndex + 1) : [];
  const elementalPoints = parseRewardPointNumber(elementalComponents);
  const catalyticPoints = parseRewardPointNumber(catalyticComponents);
  const rawText =
    elementalPoints === null || catalyticPoints === null ? null : `${elementalPoints}/${catalyticPoints}`;
  const bounds = getComponentsBounds(components, roi);

  return {
    elementalPoints,
    catalyticPoints,
    rawText,
    focus: resolveRewardPointFocus(elementalPoints, catalyticPoints),
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
  };
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
  const parsedTime = parseTimeSincePortalSeconds(bitmap, roi);

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
