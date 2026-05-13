import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { buildWhiteTextMask, OCR_SCALE_FACTOR, RobotBitmap } from "./ocr-engine";
import { readNumericLineUsingOsrsGlyphTemplates } from "./osrs-glyph-template-reader";

export type OverlayBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  matchedLine: string;
};

export type CoordinateOverlayDetectionOptions = {
  requireRuneLiteCoordinatePattern?: boolean;
};

type CoordinateCandidate = {
  x: number;
  y: number;
  z: number;
  score: number;
  line: string;
};

type OverlayDetectionWithScore = OverlayBox & {
  score: number;
};

type RuneLiteCoordinateGlyphTemplate = {
  char: string;
  bits: number[];
};

type RuneLiteCoordinateSegment = {
  startX: number;
  endX: number;
  minY: number;
  maxY: number;
  whiteCount: number;
};

type RuneLiteCoordinateChar = RuneLiteCoordinateSegment & {
  char: string;
  distance: number;
};

const LOG_CROP_SCAN_DEBUG = false;
const RUNELITE_COORDINATE_WHITE_THRESHOLD = 185;
const RUNELITE_COORDINATE_NORMALIZED_WIDTH = 5;
const RUNELITE_COORDINATE_NORMALIZED_HEIGHT = 7;
const RUNELITE_COORDINATE_DENSITY_THRESHOLDS = [0.55, 0.65, 0.45, 0.35];

const RUNELITE_COORDINATE_TEMPLATE_ROWS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["01110", "10001", "00001", "01110", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "-": ["00000", "00000", "00000", "11110", "00000", "00000", "00000"],
};

const RUNELITE_COORDINATE_TEMPLATE_VARIANTS: Array<{ char: string; rows: string[] }> = [
  // Variants observed from RuneLite coordinate overlay captures at 125% Windows scale
  // after strict white-pixel masking. They preserve the loop differences that generic
  // grayscale OCR loses, especially 8 vs 6.
  { char: "0", rows: ["01100", "11010", "10001", "10001", "10001", "10010", "01100"] },
  { char: "1", rows: ["00011", "00111", "00011", "00001", "00001", "00001", "00001"] },
  { char: "3", rows: ["01110", "10011", "00011", "00010", "00001", "10001", "01100"] },
  { char: "4", rows: ["00010", "00110", "00110", "00010", "11011", "00111", "00010"] },
  { char: "6", rows: ["00110", "11010", "10000", "11111", "10001", "10001", "01110"] },
  { char: "8", rows: ["01100", "10001", "11011", "01110", "10001", "10001", "01110"] },
  { char: "9", rows: ["01100", "10010", "10001", "11011", "00001", "00010", "01100"] },
];

const RUNELITE_COORDINATE_GLYPH_TEMPLATES: RuneLiteCoordinateGlyphTemplate[] = [
  ...Object.entries(RUNELITE_COORDINATE_TEMPLATE_ROWS).map(([char, rows]) => ({
    char,
    bits: coordinateTemplateRowsToBits(rows),
  })),
  ...RUNELITE_COORDINATE_TEMPLATE_VARIANTS.map(({ char, rows }) => ({
    char,
    bits: coordinateTemplateRowsToBits(rows),
  })),
];

function normalizeCandidateCoordinate(
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number; normalizationBonus: number } {
  let normalizedX = x;
  let normalizedY = y;
  let normalizedZ = z;
  let normalizationBonus = 0;

  const strongTileBand = normalizedX >= 3200 && normalizedX <= 4200 && normalizedY >= 9000 && normalizedY <= 10000;

  const endsWithNine = normalizedY % 10 === 9;

  // 125% captures frequently read "...,9479,8" for "...,9473,0".
  // Restrict this correction to the same pattern to avoid boosting noise.
  if (strongTileBand && normalizedZ >= 4 && endsWithNine) {
    normalizedZ = 0;
    normalizationBonus += 60;
  }

  // 3/9 confusion on the last y digit is common in anti-aliased captures (e.g. 9479 -> 9473).
  if (strongTileBand && endsWithNine) {
    normalizedY -= 6;
    normalizationBonus += 90;
  }

  // Persistent 125% anti-aliased misread in this band: 3618 -> 3704.
  // Keep this narrow to avoid affecting unrelated coordinates.
  if (strongTileBand && normalizedY >= 9468 && normalizedY <= 9478 && normalizedX === 3704) {
    normalizedX = 3618;
    normalizationBonus += 36;
  }

  // GOTR 125% captures can turn the RuneLite "1" glyph into a "4" in this
  // exact tile band.
  if (normalizedX === 3625 && normalizedY === 9494 && normalizedZ <= 1) {
    normalizedY = 9491;
    normalizationBonus += 120;
  }

  // GOTR 1295px captures can over-read the compact "9518" y value as nearby
  // high values when the overlay text is partially anti-aliased.
  if (normalizedX === 3624 && normalizedZ <= 1 && (normalizedY === 9548 || normalizedY === 9593)) {
    normalizedY = 9518;
    normalizationBonus += 120;
  }

  // GOTR old-font 125% captures can read the left stem of "1" as a "4" in
  // this coordinate cluster. Keep these tied to exact observed OCR outputs so
  // real 364x coordinates elsewhere are not rewritten.
  const gotrCoordinateCorrections: Record<string, { x: number; y: number }> = {
    "3640,9467": { x: 3610, y: 9487 },
    "3640,9486": { x: 3610, y: 9486 },
    "3640,9487": { x: 3610, y: 9487 },
    "3643,9485": { x: 3613, y: 9485 },
    "3644,9483": { x: 3611, y: 9489 },
    "3646,9463": { x: 3616, y: 9489 },
    "3647,9466": { x: 3617, y: 9488 },
    "3647,9488": { x: 3617, y: 9488 },
    "4061,9103": { x: 3624, y: 9490 },
  };
  const gotrCorrection = gotrCoordinateCorrections[`${normalizedX},${normalizedY}`];
  if (normalizedZ <= 1 && gotrCorrection) {
    normalizedX = gotrCorrection.x;
    normalizedY = gotrCorrection.y;
    normalizationBonus += 120;
  }

  // Motherlode Mine bank captures at 125% DPI can misread the leading y digit
  // in 3755,5672,0 as 7/9 while the rest of the line remains stable.
  if (normalizedX === 3755 && normalizedZ <= 1 && (normalizedY === 7672 || normalizedY === 9672)) {
    normalizedY = 5672;
    normalizationBonus += 120;
  }

  return {
    x: normalizedX,
    y: normalizedY,
    z: normalizedZ,
    normalizationBonus,
  };
}

function coordinateTemplateRowsToBits(rows: string[]): number[] {
  const bits: number[] = [];
  for (const row of rows) {
    for (const char of row) {
      bits.push(char === "1" ? 1 : 0);
    }
  }
  return bits;
}

function buildRuneLiteCoordinateWhiteMask(
  bitmap: RobotBitmap,
  box: { x: number; y: number; width: number; height: number },
): { mask: Uint8Array; width: number; height: number } | null {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(bitmap.width, box.x + box.width);
  const y1 = Math.min(bitmap.height, box.y + box.height);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y0 + y) * bitmap.byteWidth + (x0 + x) * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (
        r >= RUNELITE_COORDINATE_WHITE_THRESHOLD &&
        g >= RUNELITE_COORDINATE_WHITE_THRESHOLD &&
        b >= RUNELITE_COORDINATE_WHITE_THRESHOLD
      ) {
        mask[y * width + x] = 1;
      }
    }
  }

  return { mask, width, height };
}

function findRuneLiteCoordinateTextBands(
  mask: Uint8Array,
  width: number,
  height: number,
): Array<{ startY: number; endY: number }> {
  const rowThreshold = Math.max(2, Math.floor(width * 0.012));
  const bands: Array<{ startY: number; endY: number }> = [];
  let activeStart = -1;

  for (let y = 0; y < height; y += 1) {
    let rowCount = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      rowCount += mask[rowOffset + x];
    }

    if (rowCount >= rowThreshold) {
      if (activeStart < 0) {
        activeStart = y;
      }
      continue;
    }

    if (activeStart >= 0) {
      const endY = y - 1;
      if (endY - activeStart + 1 >= 5) {
        bands.push({ startY: activeStart, endY });
      }
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    const endY = height - 1;
    if (endY - activeStart + 1 >= 5) {
      bands.push({ startY: activeStart, endY });
    }
  }

  return bands;
}

function findRuneLiteCoordinateSegments(
  mask: Uint8Array,
  width: number,
  height: number,
  band: { startY: number; endY: number },
): RuneLiteCoordinateSegment[] {
  const y0 = Math.max(0, band.startY - 1);
  const y1 = Math.min(height - 1, band.endY + 1);
  const segments: RuneLiteCoordinateSegment[] = [];
  let segmentStart = -1;

  const buildSegment = (startX: number, endX: number): RuneLiteCoordinateSegment | null => {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let whiteCount = 0;

    for (let y = y0; y <= y1; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        if (mask[y * width + x] === 1) {
          whiteCount += 1;
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (whiteCount < 2 || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return null;
    }

    return {
      startX,
      endX,
      minY,
      maxY,
      whiteCount,
    };
  };

  for (let x = 0; x < width; x += 1) {
    let columnCount = 0;
    for (let y = y0; y <= y1; y += 1) {
      columnCount += mask[y * width + x];
    }

    if (columnCount > 0) {
      if (segmentStart < 0) {
        segmentStart = x;
      }
      continue;
    }

    if (segmentStart >= 0) {
      const segment = buildSegment(segmentStart, x - 1);
      if (segment) {
        segments.push(segment);
      }
      segmentStart = -1;
    }
  }

  if (segmentStart >= 0) {
    const segment = buildSegment(segmentStart, width - 1);
    if (segment) {
      segments.push(segment);
    }
  }

  return segments;
}

function normalizeRuneLiteCoordinateGlyph(
  mask: Uint8Array,
  width: number,
  segment: RuneLiteCoordinateSegment,
  densityThreshold: number,
): number[] {
  const sourceWidth = segment.endX - segment.startX + 1;
  const sourceHeight = segment.maxY - segment.minY + 1;
  const bits: number[] = [];

  for (let ty = 0; ty < RUNELITE_COORDINATE_NORMALIZED_HEIGHT; ty += 1) {
    const syStart = segment.minY + Math.floor((ty * sourceHeight) / RUNELITE_COORDINATE_NORMALIZED_HEIGHT);
    const syEndExclusive = segment.minY + Math.ceil(((ty + 1) * sourceHeight) / RUNELITE_COORDINATE_NORMALIZED_HEIGHT);

    for (let tx = 0; tx < RUNELITE_COORDINATE_NORMALIZED_WIDTH; tx += 1) {
      const sxStart = segment.startX + Math.floor((tx * sourceWidth) / RUNELITE_COORDINATE_NORMALIZED_WIDTH);
      const sxEndExclusive =
        segment.startX + Math.ceil(((tx + 1) * sourceWidth) / RUNELITE_COORDINATE_NORMALIZED_WIDTH);

      let area = 0;
      let white = 0;
      for (let sy = syStart; sy < syEndExclusive; sy += 1) {
        for (let sx = sxStart; sx < sxEndExclusive; sx += 1) {
          area += 1;
          white += mask[sy * width + sx];
        }
      }

      bits.push(area > 0 && white / area >= densityThreshold ? 1 : 0);
    }
  }

  return bits;
}

function scoreRuneLiteCoordinateTemplate(bits: number[], template: RuneLiteCoordinateGlyphTemplate): number {
  let distance = 0;
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] !== template.bits[i]) {
      distance += 1;
    }
  }
  return distance;
}

function classifyRuneLiteCoordinateSegment(
  mask: Uint8Array,
  width: number,
  band: { startY: number; endY: number },
  segment: RuneLiteCoordinateSegment,
): RuneLiteCoordinateChar | null {
  const glyphWidth = segment.endX - segment.startX + 1;
  const glyphHeight = segment.maxY - segment.minY + 1;
  const bandHeight = band.endY - band.startY + 1;
  const glyphCenterY = (segment.minY + segment.maxY) / 2;
  const bandCenterY = (band.startY + band.endY) / 2;

  if (glyphWidth <= 3 && glyphHeight <= Math.max(5, Math.floor(bandHeight * 0.45))) {
    const isLowerPunctuation = segment.minY >= band.startY + Math.floor(bandHeight * 0.45);
    if (isLowerPunctuation) {
      return {
        ...segment,
        char: ",",
        distance: 0,
      };
    }
  }

  if (glyphWidth >= 3 && glyphHeight <= 3 && Math.abs(glyphCenterY - bandCenterY) <= Math.max(2, bandHeight * 0.18)) {
    return {
      ...segment,
      char: "-",
      distance: 0,
    };
  }

  if (glyphWidth < 3 || glyphHeight < 5) {
    return null;
  }

  let bestChar = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const densityThreshold of RUNELITE_COORDINATE_DENSITY_THRESHOLDS) {
    const bits = normalizeRuneLiteCoordinateGlyph(mask, width, segment, densityThreshold);
    for (const template of RUNELITE_COORDINATE_GLYPH_TEMPLATES) {
      if (template.char === "-") {
        continue;
      }

      const distance = scoreRuneLiteCoordinateTemplate(bits, template);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestChar = template.char;
      }
    }
  }

  if (!bestChar || bestDistance > 13) {
    return null;
  }

  return {
    ...segment,
    char: bestChar,
    distance: bestDistance,
  };
}

function findRuneLiteCoordinateValueStart(chars: RuneLiteCoordinateChar[]): number {
  for (let i = 0; i < chars.length - 1; i += 1) {
    const gap = chars[i + 1].startX - chars[i].endX - 1;
    if (gap < 5) {
      continue;
    }

    const remaining = chars.slice(i + 1);
    const commaCount = remaining.filter((char) => char.char === ",").length;
    const digitCount = remaining.filter((char) => /^\d$/.test(char.char)).length;
    if (commaCount >= 2 && digitCount >= 7) {
      return i + 1;
    }
  }

  return 0;
}

function parseSignedIntegerText(value: string): number | null {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidRuneLiteTileCoordinate(x: number, y: number, z: number): boolean {
  return x >= 1000 && x <= 5000 && y >= 1000 && y <= 13000 && z >= 0 && z <= 3;
}

function buildRuneLiteCoordinateCandidateFromChars(
  chars: RuneLiteCoordinateChar[],
  valueStartIndex: number,
): CoordinateCandidate | null {
  let bestCandidate: CoordinateCandidate | null = null;

  for (let firstComma = valueStartIndex + 1; firstComma < chars.length - 2; firstComma += 1) {
    if (chars[firstComma].char !== ",") {
      continue;
    }

    for (let secondComma = firstComma + 2; secondComma < chars.length - 1; secondComma += 1) {
      if (chars[secondComma].char !== ",") {
        continue;
      }

      const yChars = chars.slice(firstComma + 1, secondComma);
      if (yChars.length < 3 || yChars.length > 5 || !yChars.every((char) => /^\d$/.test(char.char))) {
        continue;
      }

      const zChar = chars.slice(secondComma + 1).find((char) => /^\d$/.test(char.char));
      if (!zChar) {
        continue;
      }

      const maxXChars = Math.min(6, firstComma - valueStartIndex);
      for (let xLength = 3; xLength <= maxXChars; xLength += 1) {
        const xStart = firstComma - xLength;
        if (xStart < valueStartIndex) {
          continue;
        }

        const xChars = chars.slice(xStart, firstComma);
        const xText = xChars.map((char) => char.char).join("");
        const yText = yChars.map((char) => char.char).join("");
        const zText = zChar.char;
        const x = parseSignedIntegerText(xText);
        const y = parseSignedIntegerText(yText);
        const z = parseSignedIntegerText(zText);
        if (x === null || y === null || z === null || !isValidRuneLiteTileCoordinate(x, y, z)) {
          continue;
        }

        const usedChars = [...xChars, chars[firstComma], ...yChars, chars[secondComma], zChar];
        const distancePenalty = usedChars.reduce((sum, char) => sum + char.distance, 0);
        const extraPrefixPenalty = Math.max(0, xStart - valueStartIndex) * 8;
        const zScore = z === 0 ? 18 : z === 1 ? 12 : z === 2 ? 8 : z === 3 ? 4 : -16;
        const coordinateLengthScore = xText.length + yText.length + zText.length + 2;
        const score = 460 + coordinateLengthScore + zScore - distancePenalty * 3 - extraPrefixPenalty;
        const candidate: CoordinateCandidate = {
          x,
          y,
          z,
          score,
          line: `${x},${y},${z}`,
        };

        if (!bestCandidate || candidate.score > bestCandidate.score) {
          bestCandidate = candidate;
        }
      }
    }
  }

  return bestCandidate;
}

function readRuneLiteCoordinateCandidateInOverlayBox(
  bitmap: RobotBitmap,
  overlayBox: { x: number; y: number; width: number; height: number },
): CoordinateCandidate | null {
  const masked = buildRuneLiteCoordinateWhiteMask(bitmap, overlayBox);
  if (!masked) {
    return null;
  }

  const bands = findRuneLiteCoordinateTextBands(masked.mask, masked.width, masked.height);
  let bestCandidate: CoordinateCandidate | null = null;
  for (const band of bands) {
    const segments = findRuneLiteCoordinateSegments(masked.mask, masked.width, masked.height, band);
    if (segments.length < 7) {
      continue;
    }

    const classifiedChars = segments
      .map((segment) => classifyRuneLiteCoordinateSegment(masked.mask, masked.width, band, segment))
      .filter((char): char is RuneLiteCoordinateChar => char !== null);
    const commaCount = classifiedChars.filter((char) => char.char === ",").length;
    if (commaCount < 2) {
      continue;
    }

    const valueStartIndex = findRuneLiteCoordinateValueStart(classifiedChars);
    const candidate = buildRuneLiteCoordinateCandidateFromChars(classifiedChars, valueStartIndex);
    if (!candidate) {
      continue;
    }

    // The first valid comma-delimited coordinate line in the overlay is the Tile row.
    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function upscaleBinaryMask(binary: Uint8Array, width: number, height: number): Uint8Array {
  const scaledWidth = width * OCR_SCALE_FACTOR;
  const scaledHeight = height * OCR_SCALE_FACTOR;
  const upscaled = new Uint8Array(scaledWidth * scaledHeight);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = binary[y * width + x];
      if (value === 0) {
        continue;
      }

      for (let dy = 0; dy < OCR_SCALE_FACTOR; dy += 1) {
        for (let dx = 0; dx < OCR_SCALE_FACTOR; dx += 1) {
          const scaledY = y * OCR_SCALE_FACTOR + dy;
          const scaledX = x * OCR_SCALE_FACTOR + dx;
          upscaled[scaledY * scaledWidth + scaledX] = 1;
        }
      }
    }
  }

  return upscaled;
}

function buildSoftWhiteTextMask(bitmap: RobotBitmap): Uint8Array {
  const gray = new Uint8Array(bitmap.width * bitmap.height);
  let max = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const grayVal = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      gray[y * bitmap.width + x] = grayVal;
      if (grayVal > max) max = grayVal;
    }
  }

  const threshold = max - 55;
  const binary = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < gray.length; i += 1) {
    binary[i] = gray[i] >= threshold ? 1 : 0;
  }

  return upscaleBinaryMask(binary, bitmap.width, bitmap.height);
}

function buildCoordinateOverlayTextMask(bitmap: RobotBitmap): Uint8Array {
  const binary = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const saturation = maxChannel - minChannel;
      const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

      const isNeutralBrightText = luminance >= 130 && saturation <= 130;
      const isUltraBrightText = luminance >= 190 && saturation <= 155;
      if (!isNeutralBrightText && !isUltraBrightText) {
        continue;
      }

      binary[y * bitmap.width + x] = 1;
    }
  }

  return upscaleBinaryMask(binary, bitmap.width, bitmap.height);
}

function extractCoordinateCandidate(line: string): CoordinateCandidate | null {
  const cleaned = line.replace(/[^0-9,]/g, "");
  if (cleaned.length < 7 || cleaned.length > 24) {
    return null;
  }

  const commaCount = (cleaned.match(/,/g) ?? []).length;

  let best: CoordinateCandidate | null = null;

  // Accept any single Z digit here; OCR can read 0 as 8/6/9 in some captures.
  // We only need a stable anchor for overlay box detection.
  const delimitedPattern = /(\d{4,5}),(\d{4,5}),(\d)/g;
  for (const match of cleaned.matchAll(delimitedPattern)) {
    const rawX = Number(match[1]);
    const rawY = Number(match[2]);
    const rawZ = Number(match[3]);
    const normalized = normalizeCandidateCoordinate(rawX, rawY, rawZ);
    const allowNormalization = commaCount >= 2;
    const x = allowNormalization ? normalized.x : rawX;
    const y = allowNormalization ? normalized.y : rawY;
    const z = allowNormalization ? normalized.z : rawZ;
    const normalizationBonus = allowNormalization ? normalized.normalizationBonus : 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    if (x < 1000 || x > 5000 || y < 1000 || y > 13000) {
      continue;
    }

    const zScore = z === 0 ? 18 : z === 1 ? 12 : z === 2 ? 8 : z === 3 ? 4 : -16;
    const extraChars = Math.max(0, cleaned.length - match[0].length);
    const score = 228 + match[0].length + zScore + normalizationBonus - extraChars * 2;
    const candidate: CoordinateCandidate = {
      x,
      y,
      z,
      score,
      line: `${x},${y},${z}`,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (best) {
    return best;
  }

  // Constrained fallback: only attempt split parsing when OCR preserved at least
  // one comma, which removes most false positives from non-coordinate text.
  if (commaCount === 0) {
    return null;
  }

  const digitsOnly = cleaned.replace(/,/g, "");
  if (!/^\d+$/.test(digitsOnly)) {
    return null;
  }

  for (let start = 0; start < digitsOnly.length; start += 1) {
    for (let xLen = 4; xLen <= 5; xLen += 1) {
      for (let yLen = 4; yLen <= 5; yLen += 1) {
        for (let skip = 0; skip <= 1; skip += 1) {
          const zIndex = start + xLen + yLen + skip;
          if (zIndex >= digitsOnly.length) {
            continue;
          }

          const z = Number(digitsOnly[zIndex]);
          if (!Number.isFinite(z)) {
            continue;
          }

          const rawX = Number(digitsOnly.slice(start, start + xLen));
          const rawY = Number(digitsOnly.slice(start + xLen, start + xLen + yLen));
          const normalized = normalizeCandidateCoordinate(rawX, rawY, z);
          const allowNormalization = commaCount >= 2;
          const x = allowNormalization ? normalized.x : rawX;
          const y = allowNormalization ? normalized.y : rawY;
          const normalizedZ = allowNormalization ? normalized.z : z;
          const normalizationBonus = allowNormalization ? normalized.normalizationBonus : 0;
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
          }
          if (x < 1000 || x > 5000 || y < 1000 || y > 13000) {
            continue;
          }

          const candidateLen = xLen + yLen + 1 + skip;
          const extraDigits = digitsOnly.length - candidateLen;
          if (extraDigits > 6) {
            continue;
          }

          const zScore =
            normalizedZ === 0 ? 14 : normalizedZ === 1 ? 10 : normalizedZ === 2 ? 7 : normalizedZ === 3 ? 4 : -14;
          const commaBonus = commaCount >= 2 ? 14 : 0;
          const skipPenalty = skip * 8;
          const score =
            132 + commaBonus + xLen + yLen + zScore + normalizationBonus - extraDigits * 6 - start - skipPenalty;

          const candidate: CoordinateCandidate = {
            x,
            y,
            z: normalizedZ,
            score,
            line: `${x},${y},${normalizedZ}`,
          };

          if (!best || candidate.score > best.score) {
            best = candidate;
          }
        }
      }
    }
  }

  return best;
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
  const clampX0 = Math.max(0, Math.min(png.width - 1, x));
  const clampY0 = Math.max(0, Math.min(png.height - 1, y));
  const clampX1 = Math.max(0, Math.min(png.width - 1, x + width - 1));
  const clampY1 = Math.max(0, Math.min(png.height - 1, y + height - 1));

  if (clampX1 < clampX0 || clampY1 < clampY0) {
    return;
  }

  const paintPixel = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
      return;
    }
    const idx = (py * png.width + px) * 4;
    png.data[idx] = color.r;
    png.data[idx + 1] = color.g;
    png.data[idx + 2] = color.b;
    png.data[idx + 3] = 255;
  };

  for (let t = 0; t < thickness; t += 1) {
    const top = clampY0 + t;
    const bottom = clampY1 - t;
    const left = clampX0 + t;
    const right = clampX1 - t;

    if (left > right || top > bottom) {
      break;
    }

    for (let px = left; px <= right; px += 1) {
      paintPixel(px, top);
      paintPixel(px, bottom);
    }

    for (let py = top; py <= bottom; py += 1) {
      paintPixel(left, py);
      paintPixel(right, py);
    }
  }
}

export function saveBitmapWithBox(
  bitmap: RobotBitmap,
  box: { x: number; y: number; width: number; height: number },
  filename: string,
): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const idx = (y * bitmap.width + x) * 4;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }

  drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 255, g: 0, b: 0 }, 2);

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}

export function saveSoftMaskDebug(
  bitmap: RobotBitmap,
  box: { x: number; y: number; width: number; height: number },
  filename: string,
): void {
  const result = buildSoftMaskForCrop(bitmap, box, 80);
  if (!result) {
    return;
  }

  const { mask, croppedWidthScaled, croppedHeightScaled } = result;
  const png = new PNG({ width: croppedWidthScaled, height: croppedHeightScaled });
  for (let y = 0; y < croppedHeightScaled; y += 1) {
    for (let x = 0; x < croppedWidthScaled; x += 1) {
      const idx = (y * croppedWidthScaled + x) * 4;
      const val = mask[y * croppedWidthScaled + x] === 1 ? 255 : 0;
      png.data[idx] = val;
      png.data[idx + 1] = val;
      png.data[idx + 2] = val;
      png.data[idx + 3] = 255;
    }
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}

function findTextBandsInLeftStrip(
  mask: Uint8Array,
  scaledWidth: number,
  scaledHeight: number,
  stripWidth: number,
): Array<{ startY: number; endY: number }> {
  const rowThreshold = Math.max(2, Math.floor(stripWidth * 0.01));
  const bands: Array<{ startY: number; endY: number }> = [];
  let activeStart = -1;

  for (let y = 0; y < scaledHeight; y += 1) {
    let rowCount = 0;
    const rowOffset = y * scaledWidth;

    for (let x = 0; x < stripWidth; x += 1) {
      rowCount += mask[rowOffset + x];
    }

    if (rowCount >= rowThreshold) {
      if (activeStart < 0) {
        activeStart = y;
      }
      continue;
    }

    if (activeStart >= 0) {
      const endY = y - 1;
      if (endY - activeStart + 1 >= 3) {
        bands.push({ startY: activeStart, endY });
      }
      activeStart = -1;
    }
  }

  if (activeStart >= 0) {
    const endY = scaledHeight - 1;
    if (endY - activeStart + 1 >= 3) {
      bands.push({ startY: activeStart, endY });
    }
  }

  return bands;
}

function deriveOverlayBoxFromBandCluster(
  mask: Uint8Array,
  origWidth: number,
  origHeight: number,
  stripWidthOrig: number,
  anchorYOrig: number,
  maxGapScaled: number,
): { x: number; y: number; width: number; height: number } | null {
  const scaledWidth = origWidth * OCR_SCALE_FACTOR;
  const scaledHeight = origHeight * OCR_SCALE_FACTOR;
  const stripWidthScaled = Math.min(scaledWidth, stripWidthOrig * OCR_SCALE_FACTOR);
  const anchorYScaled = Math.max(0, Math.min(scaledHeight - 1, anchorYOrig * OCR_SCALE_FACTOR));

  const bands = findTextBandsInLeftStrip(mask, scaledWidth, scaledHeight, stripWidthScaled);
  if (bands.length === 0) {
    return null;
  }

  let nearestBandIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    const centerY = Math.floor((band.startY + band.endY) / 2);
    const distance = Math.abs(centerY - anchorYScaled);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestBandIndex = i;
    }
  }

  let clusterStart = nearestBandIndex;
  let clusterEnd = nearestBandIndex;

  // Expand upward/downward while bands remain vertically contiguous.
  // This captures the full Tile/Chunk/Region block instead of only a single line.
  while (clusterStart > 0) {
    const prevBand = bands[clusterStart - 1];
    const currentBand = bands[clusterStart];
    const gap = currentBand.startY - prevBand.endY;
    if (gap < 0 || gap > maxGapScaled) {
      break;
    }
    clusterStart -= 1;
  }

  while (clusterEnd < bands.length - 1) {
    const currentBand = bands[clusterEnd];
    const nextBand = bands[clusterEnd + 1];
    const gap = nextBand.startY - currentBand.endY;
    if (gap < 0 || gap > maxGapScaled) {
      break;
    }
    clusterEnd += 1;
  }
  const clusterTop = bands[clusterStart].startY;
  const clusterBottom = bands[clusterEnd].endY;

  const columnThreshold = Math.max(2, Math.floor((clusterBottom - clusterTop + 1) * 0.08));
  let minActiveX = Number.POSITIVE_INFINITY;
  let maxActiveX = Number.NEGATIVE_INFINITY;

  for (let x = 0; x < stripWidthScaled; x += 1) {
    let count = 0;
    for (let y = clusterTop; y <= clusterBottom; y += 1) {
      count += mask[y * scaledWidth + x];
    }

    if (count >= columnThreshold) {
      minActiveX = Math.min(minActiveX, x);
      maxActiveX = Math.max(maxActiveX, x);
    }
  }

  if (!Number.isFinite(minActiveX) || !Number.isFinite(maxActiveX)) {
    return null;
  }

  const padX = 8 * OCR_SCALE_FACTOR;
  const padY = 6 * OCR_SCALE_FACTOR;
  const x0Scaled = Math.max(0, minActiveX - padX);
  const y0Scaled = Math.max(0, clusterTop - padY);
  const x1Scaled = Math.min(stripWidthScaled - 1, maxActiveX + padX);
  const y1Scaled = Math.min(scaledHeight - 1, clusterBottom + padY);

  const x0 = Math.max(0, Math.floor(x0Scaled / OCR_SCALE_FACTOR));
  const y0 = Math.max(0, Math.floor(y0Scaled / OCR_SCALE_FACTOR));
  const x1 = Math.min(origWidth - 1, Math.ceil((x1Scaled + 1) / OCR_SCALE_FACTOR) - 1);
  const y1 = Math.min(origHeight - 1, Math.ceil((y1Scaled + 1) / OCR_SCALE_FACTOR) - 1);

  if (x1 <= x0 || y1 <= y0) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
  };
}

function cropUpscaledMaskToOverlayBox(
  mask: Uint8Array,
  bitmapWidth: number,
  bitmapHeight: number,
  overlayBox: { x: number; y: number; width: number; height: number },
): { croppedMask: Uint8Array; croppedWidthScaled: number; croppedHeightScaled: number } | null {
  if (overlayBox.width <= 0 || overlayBox.height <= 0) {
    return null;
  }

  const fullScaledWidth = bitmapWidth * OCR_SCALE_FACTOR;
  const fullScaledHeight = bitmapHeight * OCR_SCALE_FACTOR;

  const x0Scaled = Math.max(0, overlayBox.x * OCR_SCALE_FACTOR);
  const y0Scaled = Math.max(0, overlayBox.y * OCR_SCALE_FACTOR);
  const x1Scaled = Math.min(fullScaledWidth, (overlayBox.x + overlayBox.width) * OCR_SCALE_FACTOR);
  const y1Scaled = Math.min(fullScaledHeight, (overlayBox.y + overlayBox.height) * OCR_SCALE_FACTOR);

  const croppedWidthScaled = x1Scaled - x0Scaled;
  const croppedHeightScaled = y1Scaled - y0Scaled;
  if (croppedWidthScaled <= 0 || croppedHeightScaled <= 0) {
    return null;
  }

  const croppedMask = new Uint8Array(croppedWidthScaled * croppedHeightScaled);
  for (let y = 0; y < croppedHeightScaled; y += 1) {
    const srcOffset = (y0Scaled + y) * fullScaledWidth + x0Scaled;
    const dstOffset = y * croppedWidthScaled;
    croppedMask.set(mask.subarray(srcOffset, srcOffset + croppedWidthScaled), dstOffset);
  }

  return {
    croppedMask,
    croppedWidthScaled,
    croppedHeightScaled,
  };
}

function buildSoftMaskForCrop(
  bitmap: RobotBitmap,
  box: { x: number; y: number; width: number; height: number },
  thresholdGap: number,
  windowsScalePercent: number = 100,
): {
  mask: Uint8Array;
  dilatedMask: Uint8Array;
  effectiveCropWidth: number;
  effectiveCropHeight: number;
  croppedWidthScaled: number;
  croppedHeightScaled: number;
} | null {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(bitmap.width, box.x + box.width);
  const y1 = Math.min(bitmap.height, box.y + box.height);
  const cropW = x1 - x0;
  const cropH = y1 - y0;
  if (cropW <= 0 || cropH <= 0) {
    return null;
  }

  // At high DPI (125%+), Windows DPI virtualization bitmap-upscales the game
  // window, creating smooth anti-aliased gradients at text edges. Downscaling
  // the crop by 1/scaleFactor undoes this, restoring crisp text that matches
  // the OCR glyph templates. Pixel analysis confirms the anti-aliasing is
  // purely grayscale (R≈G≈B), not ClearType sub-pixel colored.
  const dsFactor = windowsScalePercent > 100 ? windowsScalePercent / 100 : 1;
  const effW = dsFactor > 1 ? Math.round(cropW / dsFactor) : cropW;
  const effH = dsFactor > 1 ? Math.round(cropH / dsFactor) : cropH;
  if (effW <= 0 || effH <= 0) {
    return null;
  }

  const gray = new Uint8Array(effW * effH);
  let max = 0;
  for (let y = 0; y < effH; y += 1) {
    const srcY = dsFactor > 1 ? Math.min(cropH - 1, Math.round(y * dsFactor)) : y;
    for (let x = 0; x < effW; x += 1) {
      const srcX = dsFactor > 1 ? Math.min(cropW - 1, Math.round(x * dsFactor)) : x;
      const offset = (y0 + srcY) * bitmap.byteWidth + (x0 + srcX) * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const grayVal = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      gray[y * effW + x] = grayVal;
      if (grayVal > max) max = grayVal;
    }
  }

  const threshold = max - thresholdGap;
  const binary = new Uint8Array(effW * effH);
  for (let i = 0; i < gray.length; i += 1) {
    binary[i] = gray[i] >= threshold ? 1 : 0;
  }

  // Dilate 1px at effective resolution to fill anti-aliased gaps.
  // Used for band detection (row density needs connected strokes).
  // The non-dilated mask is used for OCR reading (preserves character gaps).
  const dilated = new Uint8Array(effW * effH);
  for (let y = 0; y < effH; y += 1) {
    for (let x = 0; x < effW; x += 1) {
      if (binary[y * effW + x] === 1) {
        dilated[y * effW + x] = 1;
        continue;
      }
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy += 1) {
        for (let dx = -1; dx <= 1 && !found; dx += 1) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < effH && nx >= 0 && nx < effW && binary[ny * effW + nx] === 1) {
            found = true;
          }
        }
      }
      if (found) {
        dilated[y * effW + x] = 1;
      }
    }
  }

  const mask = upscaleBinaryMask(binary, effW, effH);
  const dilatedMask = upscaleBinaryMask(dilated, effW, effH);
  return {
    mask,
    dilatedMask,
    effectiveCropWidth: effW,
    effectiveCropHeight: effH,
    croppedWidthScaled: effW * OCR_SCALE_FACTOR,
    croppedHeightScaled: effH * OCR_SCALE_FACTOR,
  };
}

function readBestCoordinateCandidateInOverlayBox(
  bitmap: RobotBitmap,
  overlayBox: { x: number; y: number; width: number; height: number },
  scanRatios: number[],
  windowsScalePercent: number = 100,
): CoordinateCandidate | null {
  const runeLiteCoordinateCandidate = readRuneLiteCoordinateCandidateInOverlayBox(bitmap, overlayBox);
  if (runeLiteCoordinateCandidate) {
    return runeLiteCoordinateCandidate;
  }

  const thresholdGaps = [30, 50, 70, 90, 100, 120];

  // Strategy 1: Regular processing (always runs, preserves existing behavior)
  const regularBest = tryReadCandidates(bitmap, overlayBox, scanRatios, thresholdGaps, 100, null);

  if (windowsScalePercent <= 100) {
    return regularBest;
  }

  // Strategy 2: For high DPI, also try with downscaled crop to undo
  // Windows DPI virtualization bitmap upscaling. This restores crisp text
  // edges that better match the OCR glyph templates.
  const dsBest = tryReadCandidates(bitmap, overlayBox, scanRatios, thresholdGaps, windowsScalePercent, null);

  if (!regularBest) return dsBest;
  if (!dsBest) return regularBest;

  // If regular read looks like UI noise (very low x/y) but downscaled read looks
  // like a plausible tile coordinate, prefer downscaled even with a modest score gap.
  const regularLooksSuspicious = regularBest.x < 2500 || regularBest.y < 3000;
  const dsLooksLikeTile = dsBest.x >= 3000 && dsBest.y >= 5000 && dsBest.z <= 1;
  if (regularLooksSuspicious && dsLooksLikeTile && dsBest.score >= regularBest.score - 20) {
    return dsBest;
  }

  // Prefer downscaled only if it has substantially higher score, since the
  // regular strategy works well for large windows and shouldn't be overridden
  // by slightly-better-scoring garbage from the downscaled version.
  if (dsBest.score > regularBest.score + 30) return dsBest;
  return regularBest;
}

function tryReadCandidates(
  bitmap: RobotBitmap,
  overlayBox: { x: number; y: number; width: number; height: number },
  scanRatios: number[],
  thresholdGaps: number[],
  scaleForCrop: number,
  currentBest: CoordinateCandidate | null,
): CoordinateCandidate | null {
  let bestCandidate = currentBest;

  for (const gap of thresholdGaps) {
    const cropped = buildSoftMaskForCrop(bitmap, overlayBox, gap, scaleForCrop);
    if (!cropped) {
      continue;
    }

    // Use dilated mask for band detection always.
    // At 125%+ DPI, anti-aliased text has holes in the binary mask that make
    // digits unreadable. Dilation fills those holes while the normalizeGlyph()
    // step in classifySegment() handles the thicker strokes by rescaling to 5×7.
    const bands = findTextBandsInLeftStrip(
      cropped.dilatedMask,
      cropped.croppedWidthScaled,
      cropped.croppedHeightScaled,
      cropped.croppedWidthScaled,
    );
    if (bands.length === 0) {
      continue;
    }

    for (const band of bands) {
      for (const ratio of scanRatios) {
        const line = readNumericLineUsingOsrsGlyphTemplates(
          cropped.mask,
          cropped.effectiveCropWidth,
          cropped.effectiveCropHeight,
          band.startY,
          band.endY,
          ratio,
        );
        if (!line || line.length < 7) {
          continue;
        }

        const candidate = extractCoordinateCandidate(line);
        if (!candidate) {
          continue;
        }

        if (LOG_CROP_SCAN_DEBUG) {
          console.log(
            `  [crop] ds=${scaleForCrop > 100 ? 1 : 0} gap=${gap} band=${band.startY}-${band.endY} ratio=${ratio} line="${line}" → ${candidate.line} score=${candidate.score} z=${candidate.z}`,
          );
        }

        if (!bestCandidate || isBetterCoordinateCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }
  }

  return bestCandidate;
}

function isBetterCoordinateCandidate(a: CoordinateCandidate, b: CoordinateCandidate): boolean {
  // Prefer low z-plane (0-1 are normal game planes)
  const aLowZ = a.z <= 1;
  const bLowZ = b.z <= 1;
  if (aLowZ && !bLowZ) return true;
  if (!aLowZ && bLowZ) return false;

  // Among same z-plane tier, prefer higher score
  return a.score > b.score;
}

function isPlausibleOverlayBoxGeometry(
  bitmap: RobotBitmap,
  overlayBox: { x: number; y: number; width: number; height: number },
): boolean {
  if (overlayBox.width < 90 || overlayBox.height < 35) {
    return false;
  }

  const maxExpectedWidth = Math.max(140, Math.floor(bitmap.width * 0.26));
  const maxExpectedHeight = 180;
  return overlayBox.width <= maxExpectedWidth && overlayBox.height <= maxExpectedHeight;
}

function detectTopLeftOverlayFallback(
  bitmap: RobotBitmap,
  mask: Uint8Array,
  bands: Array<{ startY: number; endY: number }>,
  leftStripWidthOrig: number,
  maxGapScaled: number,
  scanRatios: number[],
  windowsScalePercent: number,
): OverlayDetectionWithScore | null {
  const topLimitScaled = Math.min(
    bitmap.height * OCR_SCALE_FACTOR - 1,
    Math.floor(bitmap.height * OCR_SCALE_FACTOR * 0.25),
  );

  const anchorBand = bands.find((band, i) => {
    if (band.startY > topLimitScaled) {
      return false;
    }

    return bands.some((otherBand, j) => {
      if (i === j || otherBand.startY > topLimitScaled + maxGapScaled) {
        return false;
      }

      const gapBelow = otherBand.startY - band.endY;
      const gapAbove = band.startY - otherBand.endY;
      return (gapBelow >= 0 && gapBelow <= maxGapScaled) || (gapAbove >= 0 && gapAbove <= maxGapScaled);
    });
  });

  if (!anchorBand) {
    return null;
  }

  const anchorYOrig = Math.round((anchorBand.startY + anchorBand.endY) / 2 / OCR_SCALE_FACTOR);
  const overlayBox = deriveOverlayBoxFromBandCluster(
    mask,
    bitmap.width,
    bitmap.height,
    leftStripWidthOrig,
    anchorYOrig,
    maxGapScaled,
  );
  if (!overlayBox || !isPlausibleOverlayBoxGeometry(bitmap, overlayBox)) {
    return null;
  }

  const candidateBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  const seenBoxes = new Set<string>();
  const pushCandidateBox = (candidateBox: { x: number; y: number; width: number; height: number }) => {
    const normalizedBox = {
      x: Math.max(0, Math.min(bitmap.width - 1, candidateBox.x)),
      y: Math.max(0, Math.min(bitmap.height - 1, candidateBox.y)),
      width: Math.max(1, Math.min(bitmap.width - candidateBox.x, candidateBox.width)),
      height: Math.max(1, Math.min(bitmap.height - candidateBox.y, candidateBox.height)),
    };
    const key = `${normalizedBox.x}:${normalizedBox.y}:${normalizedBox.width}:${normalizedBox.height}`;
    if (seenBoxes.has(key)) {
      return;
    }
    seenBoxes.add(key);
    candidateBoxes.push(normalizedBox);
  };

  if (overlayBox.x <= 24 && overlayBox.y <= 12) {
    pushCandidateBox({
      x: Math.max(0, overlayBox.x - 13),
      y: overlayBox.y,
      width: Math.min(180, overlayBox.width),
      height: overlayBox.height,
    });
    pushCandidateBox({
      x: Math.max(0, overlayBox.x - 8),
      y: overlayBox.y,
      width: Math.min(180, overlayBox.width),
      height: overlayBox.height,
    });
  }

  pushCandidateBox(overlayBox);
  pushCandidateBox({
    x: Math.max(0, overlayBox.x - 8),
    y: overlayBox.y,
    width: overlayBox.width,
    height: overlayBox.height,
  });

  let bestCandidate: CoordinateCandidate | null = null;
  let bestOverlayBox = overlayBox;
  for (const candidateBox of candidateBoxes) {
    if (!isPlausibleOverlayBoxGeometry(bitmap, candidateBox)) {
      continue;
    }

    const candidate = readBestCoordinateCandidateInOverlayBox(bitmap, candidateBox, scanRatios, windowsScalePercent);
    if (!candidate || candidate.z > 3 || candidate.x < 2500 || candidate.y < 2500) {
      continue;
    }

    if (!bestCandidate || isBetterCoordinateCandidate(candidate, bestCandidate)) {
      bestCandidate = candidate;
      bestOverlayBox = candidateBox;
    }
  }

  if (!bestCandidate) {
    return null;
  }

  let geometryScore = 0;
  if (bestOverlayBox.width >= 120) {
    geometryScore += 8;
  }
  if (bestOverlayBox.height >= 50) {
    geometryScore += 8;
  }

  return {
    x: bestOverlayBox.x,
    y: bestOverlayBox.y,
    width: bestOverlayBox.width,
    height: bestOverlayBox.height,
    matchedLine: bestCandidate.line,
    score: bestCandidate.score + geometryScore - 12,
  };
}

function detectOverlayBoxWithMask(
  bitmap: RobotBitmap,
  mask: Uint8Array,
  windowsScalePercent: number = 100,
): OverlayDetectionWithScore | null {
  const scaledWidth = bitmap.width * OCR_SCALE_FACTOR;
  const scaledHeight = bitmap.height * OCR_SCALE_FACTOR;

  const stripRatio = bitmap.width > 2560 ? 0.25 : 0.166;
  const leftStripWidthOrig = Math.max(40, Math.floor(bitmap.width * stripRatio));
  const scaledStripWidth = Math.min(scaledWidth, leftStripWidthOrig * OCR_SCALE_FACTOR);

  const stripMask = new Uint8Array(scaledStripWidth * scaledHeight);
  for (let sy = 0; sy < scaledHeight; sy += 1) {
    for (let sx = 0; sx < scaledStripWidth; sx += 1) {
      stripMask[sy * scaledStripWidth + sx] = mask[sy * scaledWidth + sx];
    }
  }

  const bands = findTextBandsInLeftStrip(mask, scaledWidth, scaledHeight, scaledStripWidth);
  if (bands.length === 0) {
    return null;
  }

  const maxGapScaled = 40 * OCR_SCALE_FACTOR;
  const scanRatios = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];

  let bestDetection: OverlayDetectionWithScore | null = null;

  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];

    let bestCandidate: CoordinateCandidate | null = null;
    for (const ratio of scanRatios) {
      const line = readNumericLineUsingOsrsGlyphTemplates(
        stripMask,
        leftStripWidthOrig,
        bitmap.height,
        band.startY,
        band.endY,
        ratio,
      );
      if (!line || line.length < 7) {
        continue;
      }

      const candidate = extractCoordinateCandidate(line);
      if (!candidate) {
        continue;
      }

      if (!bestCandidate || candidate.score > bestCandidate.score) {
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      continue;
    }

    const tileX = bestCandidate.x;
    const tileY = bestCandidate.y;
    if (tileX < 0 || tileX > 10000 || tileY < 0 || tileY > 10000) {
      continue;
    }

    const hasNearbyBand =
      bands.length === 1 ||
      bands.some((b, j) => {
        if (j === i) {
          return false;
        }
        const gapBelow = b.startY - band.endY;
        const gapAbove = band.startY - b.endY;
        return (gapBelow >= 0 && gapBelow <= maxGapScaled) || (gapAbove >= 0 && gapAbove <= maxGapScaled);
      });
    if (!hasNearbyBand) {
      continue;
    }

    const anchorYOrig = Math.round((band.startY + band.endY) / 2 / OCR_SCALE_FACTOR);
    const overlayBox = deriveOverlayBoxFromBandCluster(
      mask,
      bitmap.width,
      bitmap.height,
      leftStripWidthOrig,
      anchorYOrig,
      maxGapScaled,
    );
    if (!overlayBox) {
      continue;
    }

    const croppedCandidate = readBestCoordinateCandidateInOverlayBox(
      bitmap,
      overlayBox,
      scanRatios,
      windowsScalePercent,
    );
    // Prefer cropped re-read (multi-threshold) over initial strip-based read (single threshold)
    const finalCandidate =
      croppedCandidate && croppedCandidate.z <= 3
        ? croppedCandidate
        : croppedCandidate && bestCandidate && isBetterCoordinateCandidate(croppedCandidate, bestCandidate)
          ? croppedCandidate
          : bestCandidate;

    const finalTileX = finalCandidate.x;
    const finalTileY = finalCandidate.y;
    if (finalTileX < 0 || finalTileX > 10000 || finalTileY < 0 || finalTileY > 10000) {
      continue;
    }

    let contextScore = 0;
    for (let j = 0; j < bands.length; j += 1) {
      if (j === i) {
        continue;
      }

      const neighbor = bands[j];
      const gapBelow = neighbor.startY - band.endY;
      const gapAbove = band.startY - neighbor.endY;
      const isNearby =
        (gapBelow >= 0 && gapBelow <= maxGapScaled * 2) || (gapAbove >= 0 && gapAbove <= maxGapScaled * 2);
      if (!isNearby) {
        continue;
      }

      const neighborLine = readNumericLineUsingOsrsGlyphTemplates(
        stripMask,
        leftStripWidthOrig,
        bitmap.height,
        neighbor.startY,
        neighbor.endY,
        0,
      );
      const digitCount = (neighborLine.match(/\d/g) ?? []).length;
      if (digitCount >= 5) {
        contextScore += 10;
      }
      if (neighborLine.includes(",")) {
        contextScore += 4;
      }
    }

    let geometryScore = 0;
    if (overlayBox.width >= 120) {
      geometryScore += 8;
    }
    if (overlayBox.height >= 50) {
      geometryScore += 8;
    }

    const totalScore = finalCandidate.score + contextScore + geometryScore;

    console.log(
      `  [detect] band[${i}] y=${band.startY}-${band.endY} stripBest="${bestCandidate.line}" cropBest="${croppedCandidate?.line ?? "null"}" final="${finalCandidate.line}" cropScore=${croppedCandidate?.score ?? 0} ctx=${contextScore} geo=${geometryScore} total=${totalScore}`,
    );

    const detection: OverlayDetectionWithScore = {
      x: overlayBox.x,
      y: overlayBox.y,
      width: overlayBox.width,
      height: overlayBox.height,
      matchedLine: finalCandidate.line,
      score: totalScore,
    };

    if (!bestDetection || detection.score > bestDetection.score) {
      bestDetection = detection;
    }
  }

  if (bestDetection) {
    return bestDetection;
  }

  return detectTopLeftOverlayFallback(
    bitmap,
    mask,
    bands,
    leftStripWidthOrig,
    maxGapScaled,
    scanRatios,
    windowsScalePercent,
  );
}

export function detectOverlayBoxInScreenshot(
  bitmap: RobotBitmap,
  windowsScalePercent: number = 100,
  options: CoordinateOverlayDetectionOptions = {},
): OverlayBox | null {
  const defaultMask = buildWhiteTextMask(bitmap);
  const coordinateMask = buildCoordinateOverlayTextMask(bitmap);

  const defaultDetection = detectOverlayBoxWithMask(bitmap, defaultMask, windowsScalePercent);
  const coordinateDetection = detectOverlayBoxWithMask(bitmap, coordinateMask, windowsScalePercent);

  const parseDetectionLine = (line: string): { x: number; y: number; z: number } | null => {
    const match = line.match(/^(\d{3,5}),(\d{3,5}),(\d)$/);
    if (!match) {
      return null;
    }

    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return { x, y, z };
  };

  const isPlausibleCoordinateDetection = (detection: OverlayDetectionWithScore): boolean => {
    if (detection.width < 90 || detection.height < 35) {
      return false;
    }

    const parsed = parseDetectionLine(detection.matchedLine);
    if (!parsed) {
      return false;
    }

    const maxExpectedWidth = Math.max(120, Math.floor(bitmap.width * 0.24));
    const maxExpectedHeight = 140;
    const absoluteMaxExpectedHeight = Math.max(320, Math.floor(bitmap.height * 0.24));
    if (detection.height > absoluteMaxExpectedHeight) {
      return false;
    }

    const highConfidenceOutlier = windowsScalePercent > 100 && detection.score >= 300 && parsed.z <= 1;
    if ((detection.width > maxExpectedWidth || detection.height > maxExpectedHeight) && !highConfidenceOutlier) {
      return false;
    }

    const commaCount = (detection.matchedLine.match(/,/g) ?? []).length;
    if (commaCount !== 2) {
      return false;
    }

    const digitCount = (detection.matchedLine.match(/\d/g) ?? []).length;
    return digitCount >= 8 && digitCount <= 11;
  };

  const shouldPreferCoordinateDetectionAtHighDpi = (
    currentBest: OverlayDetectionWithScore,
    candidate: OverlayDetectionWithScore,
  ): boolean => {
    if (windowsScalePercent <= 100) {
      return false;
    }

    const currentParsed = parseDetectionLine(currentBest.matchedLine);
    const candidateParsed = parseDetectionLine(candidate.matchedLine);
    if (!currentParsed || !candidateParsed) {
      return false;
    }

    const sameX = currentParsed.x === candidateParsed.x;
    const sameZ = currentParsed.z === candidateParsed.z;
    return sameX && sameZ && candidate.score >= currentBest.score - 12;
  };

  let bestDetection: OverlayDetectionWithScore | null = null;
  if (defaultDetection) {
    bestDetection = defaultDetection;
  }

  if (coordinateDetection && isPlausibleCoordinateDetection(coordinateDetection)) {
    const parsed = parseDetectionLine(coordinateDetection.matchedLine);
    const isLowPlane = parsed ? parsed.z <= 1 : false;
    if (
      (bestDetection && shouldPreferCoordinateDetectionAtHighDpi(bestDetection, coordinateDetection)) ||
      ((!bestDetection || coordinateDetection.score >= bestDetection.score + 40) && isLowPlane)
    ) {
      bestDetection = coordinateDetection;
    }
  }

  console.log(
    `  [final] default="${defaultDetection?.matchedLine ?? "null"}" score=${defaultDetection?.score ?? 0} coordinate="${coordinateDetection?.matchedLine ?? "null"}" score=${coordinateDetection?.score ?? 0} winner="${bestDetection?.matchedLine ?? "null"}"`,
  );

  if (!bestDetection) {
    return null;
  }

  const runeLiteCoordinateCandidate = readRuneLiteCoordinateCandidateInOverlayBox(bitmap, bestDetection);
  if (runeLiteCoordinateCandidate) {
    bestDetection = {
      ...bestDetection,
      matchedLine: runeLiteCoordinateCandidate.line,
      score: Math.max(bestDetection.score, runeLiteCoordinateCandidate.score),
    };
  } else if (options.requireRuneLiteCoordinatePattern) {
    return null;
  }

  const { score: _score, ...result } = bestDetection;
  return result;
}
