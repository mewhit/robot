import type { RobotBitmap } from "./ocr-engine";
import { findNearestBoxByAnchor, type CenteredLocalBox, type LocalPoint } from "./osrs-helper";

export type ArceuusYellowMarkerTier = "base" | "agility-52" | "agility-69" | "agility-73";

export type ArceuusYellowMarker = CenteredLocalBox & {
  tier: ArceuusYellowMarkerTier;
  pixelCount: number;
  fillRatio: number;
  score: number;
};

type YellowProfile = {
  tier: ArceuusYellowMarkerTier;
  rgb: { r: number; g: number; b: number };
};

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

export const ARCEUUS_YELLOW_MARKER_PROFILES: readonly YellowProfile[] = [
  { tier: "base", rgb: { r: 255, g: 255, b: 0 } },
  { tier: "agility-52", rgb: { r: 255, g: 210, b: 0 } },
  { tier: "agility-69", rgb: { r: 255, g: 165, b: 0 } },
  { tier: "agility-73", rgb: { r: 255, g: 122, b: 0 } },
] as const;

const PROFILE_TOLERANCE = 32;
const MIN_MARKER_PIXELS = 40;
const MIN_MARKER_WIDTH_PX = 8;
const MIN_MARKER_HEIGHT_PX = 8;
const MAX_MARKER_WIDTH_RATIO = 0.24;
const MAX_MARKER_HEIGHT_RATIO = 0.24;
const MIN_FILL_RATIO = 0.08;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function colorDistanceSquared(
  color: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
): number {
  const dr = color.r - target.r;
  const dg = color.g - target.g;
  const db = color.b - target.b;
  return dr * dr + dg * dg + db * db;
}

function classifyYellowTier(r: number, g: number, b: number): ArceuusYellowMarkerTier | null {
  if (r < 160 || g < 120 || b > 85 || r - b < 120 || g - b < 80) {
    return null;
  }

  let bestProfile: YellowProfile | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const profile of ARCEUUS_YELLOW_MARKER_PROFILES) {
    const distance = colorDistanceSquared({ r, g, b }, profile.rgb);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestProfile = profile;
    }
  }

  return bestProfile && bestDistance <= PROFILE_TOLERANCE * PROFILE_TOLERANCE ? bestProfile.tier : null;
}

function resolveSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.02), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.18), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.9), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.82), 0, bitmap.height - 1),
  };
}

function buildTierMask(bitmap: RobotBitmap, bounds: SearchBounds, tier: ArceuusYellowMarkerTier): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (classifyYellowTier(r, g, b) === tier) {
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

function toYellowMarker(candidate: Candidate, bitmap: RobotBitmap, tier: ArceuusYellowMarkerTier): ArceuusYellowMarker | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const area = width * height;
  const fillRatio = area > 0 ? candidate.pixelCount / area : 0;
  const maxWidth = Math.max(80, Math.round(bitmap.width * MAX_MARKER_WIDTH_RATIO));
  const maxHeight = Math.max(80, Math.round(bitmap.height * MAX_MARKER_HEIGHT_RATIO));

  if (
    candidate.pixelCount < MIN_MARKER_PIXELS ||
    width < MIN_MARKER_WIDTH_PX ||
    height < MIN_MARKER_HEIGHT_PX ||
    width > maxWidth ||
    height > maxHeight ||
    fillRatio < MIN_FILL_RATIO
  ) {
    return null;
  }

  return {
    tier,
    x: candidate.minX,
    y: candidate.minY,
    width,
    height,
    centerX: Math.round((candidate.minX + candidate.maxX) / 2),
    centerY: Math.round((candidate.minY + candidate.maxY) / 2),
    pixelCount: candidate.pixelCount,
    fillRatio,
    score: candidate.pixelCount + fillRatio * 1_000,
  };
}

export function getArceuusYellowMarkerTierForAgilityLevel(agilityLevel: number): ArceuusYellowMarkerTier {
  if (agilityLevel >= 73) {
    return "agility-73";
  }

  if (agilityLevel >= 69) {
    return "agility-69";
  }

  if (agilityLevel > 52) {
    return "agility-52";
  }

  return "base";
}

export function detectArceuusYellowMarkers(bitmap: RobotBitmap): ArceuusYellowMarker[] {
  const bounds = resolveSearchBounds(bitmap);
  return ARCEUUS_YELLOW_MARKER_PROFILES.flatMap((profile) =>
    collectCandidates(buildTierMask(bitmap, bounds, profile.tier), bitmap)
      .map((candidate) => toYellowMarker(candidate, bitmap, profile.tier))
      .filter((marker): marker is ArceuusYellowMarker => marker !== null),
  ).sort((a, b) => b.score - a.score);
}

export function pickArceuusYellowMarkerForAgilityLevel(
  markers: readonly ArceuusYellowMarker[],
  agilityLevel: number,
  anchor: LocalPoint | null,
  viewport: Pick<RobotBitmap, "width" | "height">,
): ArceuusYellowMarker | null {
  const tier = getArceuusYellowMarkerTierForAgilityLevel(agilityLevel);
  return findNearestBoxByAnchor(
    markers.filter((marker) => marker.tier === tier),
    viewport,
    anchor,
  );
}
