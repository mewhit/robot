import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export const GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX = "FFFF5E7E";

export type GuardianOfTheRiftPortalOpenIconTemplate = {
  bitmap: RobotBitmap;
};

export type GuardianOfTheRiftPortalOpenIconMatch = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  averageColorError: number;
};

export type GuardianOfTheRiftPortalOpenIconSearchRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GuardianOfTheRiftPortalOpenIconDetection = {
  isOpen: boolean;
  match: GuardianOfTheRiftPortalOpenIconMatch | null;
  matches: GuardianOfTheRiftPortalOpenIconMatch[];
  searchRoi: GuardianOfTheRiftPortalOpenIconSearchRoi;
};

export type GuardianOfTheRiftPortalMarkerDetection = {
  centerX: number;
  centerY: number;
  pixelCount: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type TemplateSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  weight: number;
};

type PreparedTemplate = GuardianOfTheRiftPortalOpenIconTemplate & {
  samples: TemplateSample[];
  totalWeight: number;
};

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const DEFAULT_PORTAL_OPEN_ICON_PATH = "test-images/icon/guardin-of-the-rift/portal-open/portal-open.png";
const TEMPLATE_SAMPLE_STRIDE = 3;
const MIN_PORTAL_OPEN_ICON_SCORE = 0.84;
const PORTAL_OPEN_ICON_SEARCH_WIDTH_RATIO = 0.24;
const PORTAL_OPEN_ICON_SEARCH_HEIGHT_RATIO = 0.2;
const PORTAL_MARKER_MIN_PIXELS = 24;
const PORTAL_MARKER_SEARCH_BOUNDS = {
  minXRatio: 0.04,
  minYRatio: 0.12,
  maxXRatio: 0.82,
  maxYRatio: 0.86,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readPixel(bitmap: RobotBitmap, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;

  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
    a: bitmap.image[offset + 3] ?? 255,
  };
}

function getPixelWeight(templateBitmap: RobotBitmap, x: number, y: number): number {
  const center = readPixel(templateBitmap, x, y);
  const left = readPixel(templateBitmap, Math.max(0, x - 1), y);
  const right = readPixel(templateBitmap, Math.min(templateBitmap.width - 1, x + 1), y);
  const up = readPixel(templateBitmap, x, Math.max(0, y - 1));
  const down = readPixel(templateBitmap, x, Math.min(templateBitmap.height - 1, y + 1));

  const gradient =
    Math.abs(right.r - left.r) +
    Math.abs(right.g - left.g) +
    Math.abs(right.b - left.b) +
    Math.abs(down.r - up.r) +
    Math.abs(down.g - up.g) +
    Math.abs(down.b - up.b);
  const saturation = Math.max(center.r, center.g, center.b) - Math.min(center.r, center.g, center.b);
  const warmStrength = Math.max(0, Math.min(center.r, center.g) - center.b);

  return 1 + gradient / 180 + saturation / 80 + warmStrength / 90;
}

function prepareTemplate(template: GuardianOfTheRiftPortalOpenIconTemplate): PreparedTemplate {
  const samples: TemplateSample[] = [];
  let totalWeight = 0;

  for (let y = 0; y < template.bitmap.height; y += 1) {
    for (let x = 0; x < template.bitmap.width; x += 1) {
      if (x % TEMPLATE_SAMPLE_STRIDE !== 0 || y % TEMPLATE_SAMPLE_STRIDE !== 0) {
        continue;
      }

      const pixel = readPixel(template.bitmap, x, y);
      const alphaWeight = pixel.a / 255;
      if (alphaWeight <= 0) {
        continue;
      }

      const weight = getPixelWeight(template.bitmap, x, y) * alphaWeight;
      samples.push({
        x,
        y,
        r: pixel.r,
        g: pixel.g,
        b: pixel.b,
        weight,
      });
      totalWeight += weight;
    }
  }

  return {
    ...template,
    samples,
    totalWeight,
  };
}

function scoreTemplateAt(template: PreparedTemplate, bitmap: RobotBitmap, x: number, y: number): number {
  let weightedError = 0;

  for (const sample of template.samples) {
    const scene = readPixel(bitmap, x + sample.x, y + sample.y);
    weightedError +=
      sample.weight *
      ((Math.abs(sample.r - scene.r) + Math.abs(sample.g - scene.g) + Math.abs(sample.b - scene.b)) / 3);
  }

  if (template.totalWeight === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return weightedError / template.totalWeight;
}

function clampRoi(
  bitmap: RobotBitmap,
  roi: GuardianOfTheRiftPortalOpenIconSearchRoi,
): GuardianOfTheRiftPortalOpenIconSearchRoi {
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

function resolveDefaultPortalOpenIconSearchRoi(
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
): GuardianOfTheRiftPortalOpenIconSearchRoi {
  if (bitmap.width <= template.bitmap.width * 3 && bitmap.height <= template.bitmap.height * 3) {
    return {
      x: 0,
      y: 0,
      width: bitmap.width,
      height: bitmap.height,
    };
  }

  return {
    x: 0,
    y: 0,
    width: Math.round(bitmap.width * PORTAL_OPEN_ICON_SEARCH_WIDTH_RATIO),
    height: Math.round(bitmap.height * PORTAL_OPEN_ICON_SEARCH_HEIGHT_RATIO),
  };
}

function findBestMatchInRoi(
  template: PreparedTemplate,
  bitmap: RobotBitmap,
  roi: GuardianOfTheRiftPortalOpenIconSearchRoi,
): GuardianOfTheRiftPortalOpenIconMatch | null {
  if (template.bitmap.width > roi.width || template.bitmap.height > roi.height) {
    return null;
  }

  let bestError = Number.POSITIVE_INFINITY;
  let bestX = roi.x;
  let bestY = roi.y;
  const maxY = roi.y + roi.height - template.bitmap.height;
  const maxX = roi.x + roi.width - template.bitmap.width;

  for (let y = roi.y; y <= maxY; y += 1) {
    for (let x = roi.x; x <= maxX; x += 1) {
      const error = scoreTemplateAt(template, bitmap, x, y);
      if (error < bestError) {
        bestError = error;
        bestX = x;
        bestY = y;
      }
    }
  }

  const score = clamp(1 - bestError / 255, 0, 1);

  return {
    x: bestX,
    y: bestY,
    width: template.bitmap.width,
    height: template.bitmap.height,
    centerX: Math.round(bestX + template.bitmap.width / 2),
    centerY: Math.round(bestY + template.bitmap.height / 2),
    score,
    averageColorError: bestError,
  };
}

export function detectGuardianOfTheRiftPortalOpenIcon(
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
  searchRoi: GuardianOfTheRiftPortalOpenIconSearchRoi = resolveDefaultPortalOpenIconSearchRoi(bitmap, template),
): GuardianOfTheRiftPortalOpenIconDetection {
  const preparedTemplate = prepareTemplate(template);
  const roi = clampRoi(bitmap, searchRoi);
  const match = findBestMatchInRoi(preparedTemplate, bitmap, roi);
  const matches = match ? [match] : [];
  const acceptedMatch = match && match.score >= MIN_PORTAL_OPEN_ICON_SCORE ? match : null;

  return {
    isOpen: acceptedMatch !== null,
    match: acceptedMatch,
    matches,
    searchRoi: roi,
  };
}

export function isGuardianOfTheRiftPortalMarkerPixel(r: number, g: number, b: number): boolean {
  return r >= 245 && g >= 74 && g <= 120 && b >= 100 && b <= 156 && r - g >= 125 && r - b >= 88;
}

function resolvePortalMarkerSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * PORTAL_MARKER_SEARCH_BOUNDS.minXRatio), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * PORTAL_MARKER_SEARCH_BOUNDS.minYRatio), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * PORTAL_MARKER_SEARCH_BOUNDS.maxXRatio), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * PORTAL_MARKER_SEARCH_BOUNDS.maxYRatio), 0, bitmap.height - 1),
  };
}

export function detectGuardianOfTheRiftPortalMarkersInScreenshot(
  bitmap: RobotBitmap,
  minPixels: number = PORTAL_MARKER_MIN_PIXELS,
): GuardianOfTheRiftPortalMarkerDetection[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const bounds = resolvePortalMarkerSearchBounds(bitmap);
  const visited = new Uint8Array(width * height);
  const detections: GuardianOfTheRiftPortalMarkerDetection[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isGuardianOfTheRiftPortalMarkerPixel(r, g, b)) {
        continue;
      }

      const stack = [{ x, y }];
      let pixelCount = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, current.x);
        maxY = Math.max(maxY, current.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = current.x + dx;
            const nextY = current.y + dy;
            if (nextX < bounds.minX || nextY < bounds.minY || nextX > bounds.maxX || nextY > bounds.maxY) {
              continue;
            }

            const nextIndex = nextY * width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (isGuardianOfTheRiftPortalMarkerPixel(nextR, nextG, nextB)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      if (componentWidth < 3 || componentHeight < 3) {
        continue;
      }

      detections.push({
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        width: componentWidth,
        height: componentHeight,
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

export function pickNearestGuardianOfTheRiftPortalMarker(
  detections: GuardianOfTheRiftPortalMarkerDetection[],
  playerAnchor: { centerX: number; centerY: number },
): GuardianOfTheRiftPortalMarkerDetection | null {
  let best: GuardianOfTheRiftPortalMarkerDetection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const detection of detections) {
    const nearestX = clamp(playerAnchor.centerX, detection.minX, detection.maxX);
    const nearestY = clamp(playerAnchor.centerY, detection.minY, detection.maxY);
    const edgeDistance = Math.sqrt((playerAnchor.centerX - nearestX) ** 2 + (playerAnchor.centerY - nearestY) ** 2);
    const centerDistance = Math.sqrt((playerAnchor.centerX - detection.centerX) ** 2 + (playerAnchor.centerY - detection.centerY) ** 2);
    const scoreDistance = edgeDistance + centerDistance * 0.001 - detection.pixelCount * 0.0001;

    if (scoreDistance < bestDistance) {
      best = detection;
      bestDistance = scoreDistance;
    }
  }

  return best;
}

export function formatGuardianOfTheRiftPortalCandidates(
  detections: GuardianOfTheRiftPortalMarkerDetection[],
  limit = 5,
): string {
  if (detections.length === 0) {
    return "none";
  }

  return detections
    .slice(0, limit)
    .map((detection) => `(${detection.centerX},${detection.centerY}) ${detection.width}x${detection.height} px=${detection.pixelCount}`)
    .join("; ");
}

export function loadGuardianOfTheRiftPortalOpenIconTemplate(
  iconPath = DEFAULT_PORTAL_OPEN_ICON_PATH,
): Promise<GuardianOfTheRiftPortalOpenIconTemplate> {
  return loadPngBitmap(iconPath).then((bitmap) => ({ bitmap }));
}

function resolvePngPath(filePath: string): string | null {
  const candidates = [
    filePath,
    path.resolve(process.cwd(), filePath),
    path.resolve(__dirname, "..", "..", "..", "..", filePath),
    path.resolve(__dirname, "..", "..", "..", "..", "..", filePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadPngBitmap(filePath: string): Promise<RobotBitmap> {
  return new Promise((resolve, reject) => {
    const resolvedPath = resolvePngPath(filePath);
    if (!resolvedPath) {
      reject(new Error(`File not found: ${filePath}`));
      return;
    }

    const png = new PNG();
    fs.createReadStream(resolvedPath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        const image = Buffer.alloc(png.width * png.height * 4);

        for (let index = 0; index < png.data.length; index += 4) {
          image[index] = png.data[index + 2];
          image[index + 1] = png.data[index + 1];
          image[index + 2] = png.data[index];
          image[index + 3] = png.data[index + 3];
        }

        resolve({
          width: png.width,
          height: png.height,
          byteWidth: png.width * 4,
          bytesPerPixel: 4,
          image,
        });
      })
      .on("error", reject);
  });
}
