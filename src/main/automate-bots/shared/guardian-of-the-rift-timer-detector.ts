import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export type GuardianOfTheRiftTimerDetection = {
  secondsRemaining: number | null;
  rawText: string | null;
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

type TextBand = {
  startY: number;
  endY: number;
};

type TimerMaskProfile = {
  minLuminance: number;
  maxChannelSpread: number;
};

const TIMER_ROI: Roi = {
  x: 96,
  y: 116,
  width: 46,
  height: 25,
};

const MIN_ROW_PIXELS = 2;

const TIMER_MASK_PROFILES: TimerMaskProfile[] = [
  { minLuminance: 145, maxChannelSpread: 70 },
  { minLuminance: 125, maxChannelSpread: 90 },
];

const TIMER_DIGIT_TEMPLATE_ROWS: Record<string, string[][]> = {
  "0": [
    ["11111", "11011", "10111", "10111", "11111", "11111", "01110"],
    ["11110", "11011", "10111", "10111", "11111", "11111", "01110"],
    ["01110", "10011", "10111", "10111", "11111", "11110", "01100"],
    ["11110", "11111", "10111", "11111", "11111", "01100", "00000"],
    ["01100", "11111", "10111", "11111", "11111", "01100", "00000"],
    ["11110", "11011", "11110", "11011", "11111", "11100", "11100"],
    ["11111", "11011", "11111", "11111", "11111", "11110", "11110"],
    ["00100", "11111", "11111", "11111", "11111", "00100", "00000"],
    ["11110", "11111", "11111", "11101", "11111", "11110", "01111"],
  ],
  "1": [
    ["11100", "11100", "01100", "01100", "01100", "11111", "11111"],
    ["11110", "11110", "01110", "01110", "01110", "11111", "11111"],
    ["01100", "11100", "10100", "00100", "00100", "11111", "11111"],
    ["01110", "11110", "11110", "01110", "11111", "11111", "00000"],
  ],
  "2": [
    ["11111", "10001", "00011", "00110", "01100", "11111", "11111"],
    ["11111", "10011", "00011", "00110", "11100", "11110", "11111"],
    ["11110", "10011", "00011", "00110", "01100", "11111", "11111"],
    ["11111", "10011", "00011", "01110", "11111", "11111", "00000"],
    ["11111", "10111", "10110", "11110", "11110", "01101", "00001"],
  ],
  "3": [
    ["11111", "10011", "00111", "01111", "00011", "11111", "11111"],
    ["11111", "10001", "01111", "01111", "00001", "11111", "11111"],
    ["11111", "00001", "01111", "11111", "00001", "00001", "11111"],
    ["11111", "00010", "01110", "00010", "11110", "11100", "00000"],
  ],
  "4": [
    ["11000", "11000", "11000", "11110", "11111", "11111", "00110"],
    ["10000", "10000", "10000", "10110", "11111", "11111", "00110"],
    ["11000", "11000", "11110", "11110", "11111", "00110", "01100"],
    ["10001", "10011", "10111", "11111", "11111", "00100", "00000"],
  ],
  "5": [
    ["11111", "10000", "11110", "00011", "00001", "00001", "11111"],
    ["11111", "11000", "11110", "00011", "00011", "11111", "11111"],
    ["11111", "11000", "11100", "00011", "00011", "11111", "11111"],
    ["11111", "11000", "11111", "11101", "11111", "11111", "11110"],
  ],
  "6": [
    ["01111", "11000", "11100", "11111", "11011", "11111", "01110"],
    ["11111", "10000", "10100", "11011", "10011", "11110", "11100"],
  ],
  "7": [
    ["11111", "00011", "00110", "01100", "11000", "11000", "10000"],
    ["11111", "00001", "00011", "00110", "00000", "00000", "10000"],
  ],
  "8": [
    ["01110", "10011", "11110", "01110", "10011", "11110", "01100"],
  ],
  "9": [
    ["11111", "10011", "10011", "11111", "00011", "00011", "00011"],
    ["11111", "10011", "11011", "01111", "00001", "00011", "00011"],
  ],
};

const TIMER_DIGIT_TEMPLATES = Object.entries(TIMER_DIGIT_TEMPLATE_ROWS).flatMap(([digit, variants]) =>
  variants.map((rows) => ({
    digit,
    bits: rows.join("").split("").map((value) => (value === "1" ? 1 : 0)),
  })),
);

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

function cropBitmap(bitmap: RobotBitmap, roi: Roi): RobotBitmap {
  const image = Buffer.alloc(roi.width * roi.height * bitmap.bytesPerPixel);

  for (let row = 0; row < roi.height; row += 1) {
    const sourceStart = (roi.y + row) * bitmap.byteWidth + roi.x * bitmap.bytesPerPixel;
    const sourceEnd = sourceStart + roi.width * bitmap.bytesPerPixel;
    const targetStart = row * roi.width * bitmap.bytesPerPixel;
    bitmap.image.copy(image, targetStart, sourceStart, sourceEnd);
  }

  return {
    width: roi.width,
    height: roi.height,
    byteWidth: roi.width * bitmap.bytesPerPixel,
    bytesPerPixel: bitmap.bytesPerPixel,
    image,
  };
}

function isTimerTextPixel(r: number, g: number, b: number, profile: TimerMaskProfile): boolean {
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  return luminance >= profile.minLuminance && maxChannel - minChannel <= profile.maxChannelSpread;
}

function buildTimerTextMask(bitmap: RobotBitmap, profile: TimerMaskProfile): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isTimerTextPixel(r, g, b, profile)) {
        mask[y * bitmap.width + x] = 1;
      }
    }
  }

  return mask;
}

function findTextBands(mask: Uint8Array, width: number, height: number): TextBand[] {
  const bands: TextBand[] = [];
  let activeStart = -1;

  for (let y = 0; y < height; y += 1) {
    let rowCount = 0;
    const rowOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      rowCount += mask[rowOffset + x];
    }

    if (rowCount >= MIN_ROW_PIXELS) {
      if (activeStart < 0) {
        activeStart = y;
      }
      continue;
    }

    if (activeStart >= 0) {
      const endY = y - 1;
      if (endY - activeStart + 1 >= 8) {
        bands.push({ startY: activeStart, endY });
      }
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    bands.push({ startY: activeStart, endY: height - 1 });
  }

  return bands;
}

function parseTimerSeconds(digits: string): number | null {
  if (digits.length < 3 || digits.length > 4) {
    return null;
  }

  const seconds = Number(digits.slice(-2));
  const minutes = Number(digits.slice(0, -2));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) {
    return null;
  }

  return minutes * 60 + seconds;
}

function getBandInkBounds(mask: Uint8Array, width: number, band: TextBand): { minX: number; maxX: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (let y = band.startY; y <= band.endY; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[rowOffset + x] === 0) {
        continue;
      }

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  return Number.isFinite(minX) && Number.isFinite(maxX) ? { minX, maxX } : null;
}

function countBandPixels(mask: Uint8Array, width: number, band: TextBand): number {
  let count = 0;
  for (let y = band.startY; y <= band.endY; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      count += mask[rowOffset + x];
    }
  }
  return count;
}

function pickTimerTextBand(mask: Uint8Array, width: number, height: number): TextBand | null {
  const bands = findTextBands(mask, width, height).filter((band) => {
    const bandHeight = band.endY - band.startY + 1;
    return band.startY >= 7 && bandHeight >= 8 && bandHeight <= 18;
  });

  return bands.sort((a, b) => countBandPixels(mask, width, b) - countBandPixels(mask, width, a))[0] ?? null;
}

function collectColumnSegments(mask: Uint8Array, width: number, band: TextBand): Array<{ startX: number; endX: number }> {
  const segments: Array<{ startX: number; endX: number }> = [];
  let activeStart = -1;

  for (let x = 0; x < width; x += 1) {
    let columnCount = 0;
    for (let y = band.startY; y <= band.endY; y += 1) {
      columnCount += mask[y * width + x];
    }

    if (columnCount > 0) {
      if (activeStart < 0) {
        activeStart = x;
      }
      continue;
    }

    if (activeStart >= 0) {
      segments.push({ startX: activeStart, endX: x - 1 });
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    segments.push({ startX: activeStart, endX: width - 1 });
  }

  return segments;
}

function getSegmentWidth(segment: { startX: number; endX: number }): number {
  return segment.endX - segment.startX + 1;
}

function splitWideSegment(segment: { startX: number; endX: number }): Array<{ startX: number; endX: number }> {
  const midpoint = Math.floor((segment.startX + segment.endX) / 2);
  return [
    { startX: segment.startX, endX: midpoint },
    { startX: midpoint + 1, endX: segment.endX },
  ];
}

function resolveDigitSegments(
  mask: Uint8Array,
  width: number,
  band: TextBand,
): Array<{ startX: number; endX: number }> {
  let segments = collectColumnSegments(mask, width, band);

  if (segments.length === 3 && getSegmentWidth(segments[0]) >= 10) {
    segments = [{ startX: segments[0].startX, endX: segments[0].endX - 2 }, segments[1], segments[2]];
  }

  segments = segments.filter((segment) => getSegmentWidth(segment) > 2);

  if (segments.length === 2 && getSegmentWidth(segments[1]) >= 14) {
    segments = [segments[0], ...splitWideSegment(segments[1])];
  }

  if (segments.length === 3 && getSegmentWidth(segments[1]) >= 14) {
    segments = [segments[0], ...splitWideSegment(segments[1]), segments[2]];
  }

  if (segments.length > 3) {
    segments = segments
      .sort((a, b) => getSegmentWidth(b) - getSegmentWidth(a))
      .slice(0, 3)
      .sort((a, b) => a.startX - b.startX);
  }

  return segments;
}

function normalizeSegmentBits(
  mask: Uint8Array,
  width: number,
  band: TextBand,
  segment: { startX: number; endX: number },
): number[] {
  const bits: number[] = [];
  const sourceWidth = getSegmentWidth(segment);
  const sourceHeight = band.endY - band.startY + 1;

  for (let targetY = 0; targetY < 7; targetY += 1) {
    const sourceY0 = band.startY + Math.floor((targetY * sourceHeight) / 7);
    const sourceY1 = band.startY + Math.ceil(((targetY + 1) * sourceHeight) / 7);

    for (let targetX = 0; targetX < 5; targetX += 1) {
      const sourceX0 = segment.startX + Math.floor((targetX * sourceWidth) / 5);
      const sourceX1 = segment.startX + Math.ceil(((targetX + 1) * sourceWidth) / 5);
      let area = 0;
      let on = 0;

      for (let y = sourceY0; y < sourceY1; y += 1) {
        for (let x = sourceX0; x < sourceX1; x += 1) {
          area += 1;
          on += mask[y * width + x];
        }
      }

      bits.push(area > 0 && on / area >= 0.25 ? 1 : 0);
    }
  }

  return bits;
}

function classifyDigit(bits: number[]): string | null {
  let bestDigit: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const template of TIMER_DIGIT_TEMPLATES) {
    let distance = 0;
    for (let index = 0; index < bits.length; index += 1) {
      if (bits[index] !== template.bits[index]) {
        distance += 1;
      }
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      bestDigit = template.digit;
    }
  }

  return bestDistance <= 12 ? bestDigit : null;
}

function detectGuardianOfTheRiftTimerWithProfile(
  cropped: RobotBitmap,
  roi: Roi,
  profile: TimerMaskProfile,
): GuardianOfTheRiftTimerDetection | null {
  const mask = buildTimerTextMask(cropped, profile);
  const band = pickTimerTextBand(mask, cropped.width, cropped.height);
  if (!band) {
    return null;
  }

  const digitSegments = resolveDigitSegments(mask, cropped.width, band);
  if (digitSegments.length !== 3) {
    return null;
  }

  let rawText = "";
  for (const segment of digitSegments) {
    const digit = classifyDigit(normalizeSegmentBits(mask, cropped.width, band, segment));
    if (digit === null) {
      return null;
    }
    rawText += digit;
  }

  const secondsRemaining = parseTimerSeconds(rawText);
  const inkBounds = getBandInkBounds(mask, cropped.width, band);
  if (secondsRemaining === null || !inkBounds) {
    return null;
  }

  return {
    secondsRemaining,
    rawText,
    x: roi.x + inkBounds.minX,
    y: roi.y + band.startY,
    width: inkBounds.maxX - inkBounds.minX + 1,
    height: band.endY - band.startY + 1,
  };
}

export function detectGuardianOfTheRiftTimer(bitmap: RobotBitmap): GuardianOfTheRiftTimerDetection {
  const roi = clampRoi(bitmap, TIMER_ROI);
  const cropped = cropBitmap(bitmap, roi);

  for (const profile of TIMER_MASK_PROFILES) {
    const detection = detectGuardianOfTheRiftTimerWithProfile(cropped, roi, profile);
    if (detection) {
      return detection;
    }
  }

  return {
    secondsRemaining: null,
    rawText: null,
    ...roi,
  };
}

function setPngPixel(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const index = (y * png.width + x) * 4;
  png.data[index] = color.r;
  png.data[index + 1] = color.g;
  png.data[index + 2] = color.b;
  png.data[index + 3] = 255;
}

function drawRectangleOnPng(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
  thickness: number,
): void {
  const x0 = clamp(x, 0, png.width - 1);
  const y0 = clamp(y, 0, png.height - 1);
  const x1 = clamp(x + width - 1, 0, png.width - 1);
  const y1 = clamp(y + height - 1, 0, png.height - 1);

  for (let t = 0; t < thickness; t += 1) {
    for (let drawX = x0 + t; drawX <= x1 - t; drawX += 1) {
      setPngPixel(png, drawX, y0 + t, color);
      setPngPixel(png, drawX, y1 - t, color);
    }

    for (let drawY = y0 + t; drawY <= y1 - t; drawY += 1) {
      setPngPixel(png, x0 + t, drawY, color);
      setPngPixel(png, x1 - t, drawY, color);
    }
  }
}

export function saveBitmapWithGuardianOfTheRiftTimerDebug(
  bitmap: RobotBitmap,
  detection: GuardianOfTheRiftTimerDetection,
  outputPath: string,
): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pngIndex = (y * bitmap.width + x) * 4;
      const bitmapIndex = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;

      png.data[pngIndex] = bitmap.image[bitmapIndex + 2];
      png.data[pngIndex + 1] = bitmap.image[bitmapIndex + 1];
      png.data[pngIndex + 2] = bitmap.image[bitmapIndex];
      png.data[pngIndex + 3] = 255;
    }
  }

  drawRectangleOnPng(png, detection.x, detection.y, detection.width, detection.height, { r: 255, g: 210, b: 50 }, 2);

  const directory = path.dirname(outputPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(outputPath));
}
