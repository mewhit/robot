import type { RobotBitmap } from "./ocr-engine";
import { findNearestBoxByAnchor, type CenteredLocalBox, type LocalPoint } from "./osrs-helper";

export type ArceuusDenseRunestoneStatus = "active" | "depleted";

export type ArceuusDenseRunestone = CenteredLocalBox & {
  status: ArceuusDenseRunestoneStatus;
  pixelCount: number;
  fillRatio: number;
  score: number;
};

type ColorMask = "green" | "red";

type Candidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const MIN_RUNESTONE_PIXELS = 1_800;
const MIN_RUNESTONE_WIDTH_PX = 90;
const MIN_RUNESTONE_HEIGHT_PX = 90;
const MIN_FILL_RATIO = 0.08;
const MAX_COMPONENT_WIDTH_RATIO = 0.34;
const MAX_COMPONENT_HEIGHT_RATIO = 0.32;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.02), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.24), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.86), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.76), 0, bitmap.height - 1),
  };
}

function isGreenRunestonePixel(r: number, g: number, b: number): boolean {
  return g >= 105 && r <= 125 && b <= 125 && g - Math.max(r, b) >= 35;
}

function isRedRunestonePixel(r: number, g: number, b: number): boolean {
  return r >= 115 && g <= 115 && b <= 115 && r - Math.max(g, b) >= 35;
}

function buildMask(bitmap: RobotBitmap, bounds: SearchBounds, color: ColorMask): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);
  const predicate = color === "green" ? isGreenRunestonePixel : isRedRunestonePixel;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (predicate(r, g, b)) {
        mask[y * bitmap.width + x] = 1;
      }
    }
  }

  return mask;
}

function collectCandidates(mask: Uint8Array, bitmap: RobotBitmap): Candidate[] {
  const visited = new Uint8Array(mask.length);
  const candidates: Candidate[] = [];
  const queueX: number[] = [];
  const queueY: number[] = [];

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const startIndex = y * bitmap.width + x;
      if (mask[startIndex] === 0 || visited[startIndex] === 1) {
        continue;
      }

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let pixelCount = 0;
      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);
      visited[startIndex] = 1;

      for (let index = 0; index < queueX.length; index += 1) {
        const currentX = queueX[index];
        const currentY = queueY[index];
        pixelCount += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        const neighbors = [
          [currentX + 1, currentY],
          [currentX - 1, currentY],
          [currentX, currentY + 1],
          [currentX, currentY - 1],
        ];

        for (const [nextX, nextY] of neighbors) {
          if (nextX < 0 || nextY < 0 || nextX >= bitmap.width || nextY >= bitmap.height) {
            continue;
          }

          const nextIndex = nextY * bitmap.width + nextX;
          if (mask[nextIndex] === 0 || visited[nextIndex] === 1) {
            continue;
          }

          visited[nextIndex] = 1;
          queueX.push(nextX);
          queueY.push(nextY);
        }
      }

      candidates.push({ minX, minY, maxX, maxY, pixelCount });
    }
  }

  return candidates;
}

function toRunestone(candidate: Candidate, bitmap: RobotBitmap, status: ArceuusDenseRunestoneStatus): ArceuusDenseRunestone | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const area = width * height;
  const fillRatio = area > 0 ? candidate.pixelCount / area : 0;
  const maxWidth = Math.max(180, Math.round(bitmap.width * MAX_COMPONENT_WIDTH_RATIO));
  const maxHeight = Math.max(180, Math.round(bitmap.height * MAX_COMPONENT_HEIGHT_RATIO));

  if (
    candidate.pixelCount < MIN_RUNESTONE_PIXELS ||
    width < MIN_RUNESTONE_WIDTH_PX ||
    height < MIN_RUNESTONE_HEIGHT_PX ||
    width > maxWidth ||
    height > maxHeight ||
    fillRatio < MIN_FILL_RATIO
  ) {
    return null;
  }

  return {
    status,
    x: candidate.minX,
    y: candidate.minY,
    width,
    height,
    centerX: Math.round((candidate.minX + candidate.maxX) / 2),
    centerY: Math.round((candidate.minY + candidate.maxY) / 2),
    pixelCount: candidate.pixelCount,
    fillRatio,
    score: candidate.pixelCount + fillRatio * 10_000,
  };
}

export function detectArceuusDenseRunestones(bitmap: RobotBitmap): ArceuusDenseRunestone[] {
  const bounds = resolveSearchBounds(bitmap);
  const active = collectCandidates(buildMask(bitmap, bounds, "green"), bitmap)
    .map((candidate) => toRunestone(candidate, bitmap, "active"))
    .filter((runestone): runestone is ArceuusDenseRunestone => runestone !== null);
  const depleted = collectCandidates(buildMask(bitmap, bounds, "red"), bitmap)
    .map((candidate) => toRunestone(candidate, bitmap, "depleted"))
    .filter((runestone): runestone is ArceuusDenseRunestone => runestone !== null);

  return [...active, ...depleted].sort((a, b) => b.score - a.score);
}

export function pickNearestActiveArceuusDenseRunestone(
  runestones: readonly ArceuusDenseRunestone[],
  anchor: LocalPoint | null,
  viewport: Pick<RobotBitmap, "width" | "height">,
): ArceuusDenseRunestone | null {
  return findNearestBoxByAnchor(
    runestones.filter((runestone) => runestone.status === "active"),
    viewport,
    anchor,
  );
}

export function isPointInsideArceuusDenseRunestone(
  point: LocalPoint | null,
  runestone: ArceuusDenseRunestone,
  marginPx = 24,
): boolean {
  if (!point) {
    return false;
  }

  return (
    point.x >= runestone.x - marginPx &&
    point.x <= runestone.x + runestone.width - 1 + marginPx &&
    point.y >= runestone.y - marginPx &&
    point.y <= runestone.y + runestone.height - 1 + marginPx
  );
}
