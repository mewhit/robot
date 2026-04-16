import * as robotModule from "robotjs";
import { Coordinate, DetectColorShapesOptions, RgbColor, Shape, WatchBounds } from "./colorDetection.types";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type RobotColorApi = {
  screen: {
    capture: (x: number, y: number, width: number, height: number) => RobotBitmap;
  };
};

const robot = ((robotModule as unknown as { default?: RobotColorApi }).default ??
  robotModule) as unknown as RobotColorApi;

// First function for colorDetection: find connected shapes of a target color in a bounded screen region.
export function findColorShapesInBounds(
  bounds: WatchBounds,
  color: string | RgbColor,
  options: DetectColorShapesOptions = {}
): Array<Shape> {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return [];
  }

  const target = normalizeColor(color);
  if (!target) {
    return [];
  }

  const tolerance = clampNumber(options.tolerance ?? 22, 0, 255);
  const minShapeSize = Math.max(1, Math.floor(options.minShapeSize ?? 1));
  const stepPx = Math.max(1, Math.floor(options.stepPx ?? 1));
  const mergeGapPx = Math.max(0, Math.floor(options.mergeGapPx ?? 0));

  const bitmap = robot.screen.capture(
    normalizedBounds.x,
    normalizedBounds.y,
    normalizedBounds.width,
    normalizedBounds.height
  );

  const sampledMatches = collectMatchingPixels(
    bitmap,
    normalizedBounds.x,
    normalizedBounds.y,
    target,
    tolerance,
    stepPx
  );
  const groupedShapes = groupConnectedPixels(sampledMatches, minShapeSize);
  return mergeOverlappingShapes(groupedShapes, mergeGapPx, minShapeSize);
}

function collectMatchingPixels(
  bitmap: RobotBitmap,
  absLeft: number,
  absTop: number,
  target: RgbColor,
  tolerance: number,
  stepPx: number
): Coordinate[] {
  const matches: Coordinate[] = [];
  const image = bitmap.image;

  for (let y = 0; y < bitmap.height; y += stepPx) {
    for (let x = 0; x < bitmap.width; x += stepPx) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = image[offset];
      const g = image[offset + 1];
      const r = image[offset + 2];

      if (isColorMatch(r, g, b, target, tolerance)) {
        matches.push({
          x: absLeft + x,
          y: absTop + y,
        });
      }
    }
  }

  return matches;
}

function groupConnectedPixels(matches: Coordinate[], minShapeSize: number): Array<Shape> {
  if (matches.length === 0) {
    return [];
  }

  const pointMap = new Map<string, Coordinate>();
  for (const point of matches) {
    pointMap.set(keyFromPoint(point.x, point.y), point);
  }

  const visited = new Set<string>();
  const shapes: Array<Coordinate[]> = [];

  for (const point of matches) {
    const startKey = keyFromPoint(point.x, point.y);
    if (visited.has(startKey)) {
      continue;
    }

    const shape: Coordinate[] = [];
    const queue: Coordinate[] = [point];
    visited.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      shape.push(current);

      for (const neighbor of getNeighbors(current)) {
        const neighborKey = keyFromPoint(neighbor.x, neighbor.y);
        if (visited.has(neighborKey)) {
          continue;
        }

        const matchedPoint = pointMap.get(neighborKey);
        if (!matchedPoint) {
          continue;
        }

        visited.add(neighborKey);
        queue.push(matchedPoint);
      }
    }

    if (shape.length >= minShapeSize) {
      shapes.push(shape);
    }
  }

  return shapes.map((shape) => constructShape(shape));
}

function mergeOverlappingShapes(shapes: Array<Shape>, mergeGapPx: number, minShapeSize: number): Array<Shape> {
  if (shapes.length <= 1) {
    return shapes;
  }

  const shapeBoxes = shapes.map((shape) => ({
    minX: shape.minX,
    maxX: shape.maxX,
    minY: shape.minY,
    maxY: shape.maxY,
  }));
  const parent = Array.from({ length: shapes.length }, (_, index) => index);

  const find = (index: number): number => {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]);
    }

    return parent[index];
  };

  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);

    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
  };

  for (let i = 0; i < shapeBoxes.length; i += 1) {
    for (let j = i + 1; j < shapeBoxes.length; j += 1) {
      if (boxesOverlapOrTouch(shapeBoxes[i], shapeBoxes[j], mergeGapPx)) {
        union(i, j);
      }
    }
  }

  const groupedByRoot = new Map<number, Coordinate[]>();
  for (let i = 0; i < shapes.length; i += 1) {
    const root = find(i);
    const existing = groupedByRoot.get(root);
    if (existing) {
      existing.push(...shapes[i].coordinates);
    } else {
      groupedByRoot.set(root, [...shapes[i].coordinates]);
    }
  }

  const mergedShapes: Array<Shape> = [];
  for (const shape of groupedByRoot.values()) {
    const uniquePoints = dedupePoints(shape);
    if (uniquePoints.length >= minShapeSize) {
      mergedShapes.push(constructShape(uniquePoints));
    }
  }

  return mergedShapes;
}

function dedupePoints(points: Coordinate[]): Coordinate[] {
  const seen = new Set<string>();
  const unique: Coordinate[] = [];

  for (const point of points) {
    const key = keyFromPoint(point.x, point.y);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(point);
  }

  return unique;
}

function getBoundingBox(points: Coordinate[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
}

function constructShape(coordinates: Coordinate[]): Shape {
  const box = getBoundingBox(coordinates);
  const width = box.maxX - box.minX + 1;
  const height = box.maxY - box.minY + 1;
  const centerX = box.minX + width / 2 - 0.5;
  const centerY = box.minY + height / 2 - 0.5;

  return {
    coordinates,
    center: { x: centerX, y: centerY },
    minX: box.minX,
    maxX: box.maxX,
    minY: box.minY,
    maxY: box.maxY,
    width,
    height,
    area: coordinates.length,
  };
}

function boxesOverlapOrTouch(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
  gap: number
): boolean {
  return a.minX <= b.maxX + gap && a.maxX + gap >= b.minX && a.minY <= b.maxY + gap && a.maxY + gap >= b.minY;
}

function getNeighbors(point: Coordinate): Coordinate[] {
  return [
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 },
    { x: point.x - 1, y: point.y - 1 },
    { x: point.x + 1, y: point.y - 1 },
    { x: point.x - 1, y: point.y + 1 },
    { x: point.x + 1, y: point.y + 1 },
  ];
}

function isColorMatch(r: number, g: number, b: number, target: RgbColor, tolerance: number): boolean {
  return (
    Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance
  );
}

function normalizeBounds(bounds: WatchBounds): WatchBounds | null {
  const x = Math.floor(bounds.x);
  const y = Math.floor(bounds.y);
  const width = Math.floor(bounds.width);
  const height = Math.floor(bounds.height);

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function normalizeColor(color: string | RgbColor): RgbColor | null {
  if (typeof color !== "string") {
    if (!Number.isFinite(color.r) || !Number.isFinite(color.g) || !Number.isFinite(color.b)) {
      return null;
    }

    return {
      r: clampNumber(Math.round(color.r), 0, 255),
      g: clampNumber(Math.round(color.g), 0, 255),
      b: clampNumber(Math.round(color.b), 0, 255),
    };
  }

  const safeHex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(safeHex)) {
    return null;
  }

  const value = Number.parseInt(safeHex, 16);
  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function keyFromPoint(x: number, y: number): string {
  return `${x},${y}`;
}

export type { Coordinate, DetectColorShapesOptions, RgbColor, Shape, WatchBounds } from "./colorDetection.types";
