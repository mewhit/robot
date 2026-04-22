export type ScreenCaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

export type LocalPoint = {
  x: number;
  y: number;
};

export type LocalRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CenteredLocalBox = LocalRect & {
  centerX: number;
  centerY: number;
};

export type CenteredScreenBox = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

export type PostClickMouseMoveMode = "off" | "top-left" | "offset";

export type PostClickMouseTargetOptions = {
  mode?: PostClickMouseMoveMode;
  offsetPx?: number;
  cornerMarginPx?: number;
};

export type PickScreenPointOptions = {
  lastClickPoint?: ScreenPoint | null;
  maxAttempts?: number;
};

export type PickBoxInteractionPointOptions = PickScreenPointOptions & {
  innerRatio?: number;
  preferredLocalY?: number | null;
  preferredYBandRatio?: number;
};

export type EstimateTravelTicksOptions = {
  screenPoint: ScreenPoint;
  captureBounds: ScreenCaptureBounds;
  playerBox: CenteredScreenBox | null;
  fallbackTilePx: number;
  minTilePx: number;
  maxTilePx: number;
  playerSpeedTilesPerTick: number;
  extraTicks?: number;
  minTicks?: number;
  maxTicks?: number;
};

export type TravelEstimate = {
  tilePx: number;
  dxPx: number;
  dyPx: number;
  distanceTiles: number;
  etaTicks: number;
};

const DEFAULT_BOX_CLICK_INNER_RATIO = 0.75;
const DEFAULT_POINT_PICK_ATTEMPTS = 12;
const DEFAULT_PREFERRED_Y_BAND_RATIO = 0.45;
const DEFAULT_POST_CLICK_OFFSET_PX = 200;
const DEFAULT_POST_CLICK_CORNER_MARGIN_PX = 6;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

export function randomIntInclusive(min: number, max: number): number {
  if (max <= min) {
    return min;
  }

  return min + Math.floor(Math.random() * (max - min + 1));
}

export function ticksToMs(ticks: number, gameTickMs: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return 0;
  }

  return Math.ceil(ticks * gameTickMs);
}

export function deadlineFromNowTicks(ticks: number, gameTickMs: number, nowMs: number = Date.now()): number {
  const durationMs = ticksToMs(ticks, gameTickMs);
  return durationMs > 0 ? nowMs + durationMs : 0;
}

export function isDeadlineActive(deadlineMs: number, nowMs: number): boolean {
  return deadlineMs > nowMs;
}

export function isActionLocked(actionLockUntilMs: number, nowMs: number): boolean {
  return isDeadlineActive(actionLockUntilMs, nowMs);
}

export function getInnerRange(start: number, size: number, ratio: number = DEFAULT_BOX_CLICK_INNER_RATIO): {
  min: number;
  max: number;
} {
  const boundedSize = Math.max(1, size);
  const innerSize = Math.max(1, Math.floor(boundedSize * ratio));
  const margin = Math.max(0, Math.floor((boundedSize - innerSize) / 2));
  const min = start + margin;
  const max = min + innerSize - 1;
  return { min, max };
}

export function pickDistinctScreenPointInLocalRange(
  localMinX: number,
  localMaxX: number,
  localMinY: number,
  localMaxY: number,
  captureBounds: ScreenCaptureBounds,
  options: PickScreenPointOptions = {},
): ScreenPoint {
  const minX = captureBounds.x + Math.min(localMinX, localMaxX);
  const maxX = captureBounds.x + Math.max(localMinX, localMaxX);
  const minY = captureBounds.y + Math.min(localMinY, localMaxY);
  const maxY = captureBounds.y + Math.max(localMinY, localMaxY);
  const lastClickPoint = options.lastClickPoint ?? null;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_POINT_PICK_ATTEMPTS);

  let candidate: ScreenPoint = { x: minX, y: minY };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const x = randomIntInclusive(minX, maxX);
    const y = randomIntInclusive(minY, maxY);
    candidate = { x, y };
    if (!lastClickPoint || x !== lastClickPoint.x || y !== lastClickPoint.y) {
      return candidate;
    }
  }

  if (minX < maxX) {
    const nextX = candidate.x > minX ? candidate.x - 1 : candidate.x + 1;
    return { x: nextX, y: candidate.y };
  }

  if (minY < maxY) {
    const nextY = candidate.y > minY ? candidate.y - 1 : candidate.y + 1;
    return { x: candidate.x, y: nextY };
  }

  return candidate;
}

export function pickBoxInteractionScreenPoint(
  box: LocalRect,
  captureBounds: ScreenCaptureBounds,
  options: PickBoxInteractionPointOptions = {},
): ScreenPoint {
  const innerRatio = options.innerRatio ?? DEFAULT_BOX_CLICK_INNER_RATIO;
  const innerX = getInnerRange(box.x, box.width, innerRatio);
  const innerY = getInnerRange(box.y, box.height, innerRatio);
  const preferredLocalY = options.preferredLocalY ?? null;

  if (preferredLocalY === null || !Number.isFinite(preferredLocalY)) {
    return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, innerY.max, captureBounds, options);
  }

  const boundedPreferredY = clamp(preferredLocalY, innerY.min, innerY.max);
  const preferredYBandRatio = options.preferredYBandRatio ?? DEFAULT_PREFERRED_Y_BAND_RATIO;
  const yBandHeight = Math.max(1, Math.floor((innerY.max - innerY.min + 1) * preferredYBandRatio));
  const yMin = Math.max(innerY.min, boundedPreferredY - yBandHeight + 1);
  const yMax = Math.max(yMin, boundedPreferredY);

  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, yMin, yMax, captureBounds, options);
}

export function resolvePostClickMouseTarget(
  clickedScreenPoint: ScreenPoint,
  captureBounds: ScreenCaptureBounds,
  options: PostClickMouseTargetOptions = {},
): ScreenPoint | null {
  const mode = options.mode ?? "off";
  const cornerMarginPx = Math.max(0, options.cornerMarginPx ?? DEFAULT_POST_CLICK_CORNER_MARGIN_PX);
  const offsetPx = Math.max(0, options.offsetPx ?? DEFAULT_POST_CLICK_OFFSET_PX);
  const minX = captureBounds.x + cornerMarginPx;
  const minY = captureBounds.y + cornerMarginPx;
  const maxX = captureBounds.x + captureBounds.width - 1 - cornerMarginPx;
  const maxY = captureBounds.y + captureBounds.height - 1 - cornerMarginPx;

  if (minX > maxX || minY > maxY) {
    return null;
  }

  if (mode === "top-left") {
    return { x: minX, y: minY };
  }

  if (mode === "offset") {
    return {
      x: clamp(clickedScreenPoint.x - offsetPx, minX, maxX),
      y: clamp(clickedScreenPoint.y - offsetPx, minY, maxY),
    };
  }

  return null;
}

export function estimateTilePxFromPlayerBox(
  playerBox: CenteredScreenBox | null,
  options: {
    fallbackTilePx: number;
    minTilePx: number;
    maxTilePx: number;
  },
): number {
  if (!playerBox) {
    return options.fallbackTilePx;
  }

  const estimatedTilePx = Math.round((playerBox.width + playerBox.height) / 2);
  return clamp(estimatedTilePx, options.minTilePx, options.maxTilePx);
}

export function estimateTravelTicks(options: EstimateTravelTicksOptions): TravelEstimate {
  const anchorScreenX = options.captureBounds.x + (options.playerBox?.centerX ?? Math.round(options.captureBounds.width / 2));
  const anchorScreenY =
    options.captureBounds.y + (options.playerBox?.centerY ?? Math.round(options.captureBounds.height / 2));
  const tilePx = estimateTilePxFromPlayerBox(options.playerBox, {
    fallbackTilePx: options.fallbackTilePx,
    minTilePx: options.minTilePx,
    maxTilePx: options.maxTilePx,
  });
  const dxPx = options.screenPoint.x - anchorScreenX;
  const dyPx = options.screenPoint.y - anchorScreenY;
  const distanceTiles = Math.max(Math.abs(dxPx) / tilePx, Math.abs(dyPx) / tilePx);
  const extraTicks = options.extraTicks ?? 0;
  const minTicks = options.minTicks ?? 1;
  const maxTicks = options.maxTicks ?? Number.MAX_SAFE_INTEGER;
  const speed = Math.max(0.01, options.playerSpeedTilesPerTick);
  const etaTicks = clamp(Math.ceil(distanceTiles / speed) + extraTicks, minTicks, maxTicks);

  return {
    tilePx,
    dxPx,
    dyPx,
    distanceTiles,
    etaTicks,
  };
}

export function findNearestBoxByAnchor<T extends CenteredLocalBox>(
  boxes: readonly T[],
  viewport: Pick<ScreenCaptureBounds, "width" | "height">,
  anchor: LocalPoint | null,
): T | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(viewport.width / 2);
  const anchorY = anchor?.y ?? Math.round(viewport.height / 2);

  let best: T | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
    const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
    const edgeDx = anchorX - nearestX;
    const edgeDy = anchorY - nearestY;
    const edgeDistance = axisDistance(edgeDx, edgeDy);

    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (
      edgeDistance < bestEdgeDistance ||
      (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)
    ) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}
