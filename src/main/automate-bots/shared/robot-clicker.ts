import { getMousePos, mouseClick, moveMouse } from "robotjs";
import type { ScreenCaptureBounds } from "../../windowsScreenCapture";

export type ScreenPoint = {
  x: number;
  y: number;
};

export const DEFAULT_PRE_CLICK_MOUSE_SETTLE_MS = 50;
const DEFAULT_SAFE_EDGE_MARGIN_PX = 10;
const DEFAULT_HUMAN_MOUSE_MIN_DURATION_MS = 85;
const DEFAULT_HUMAN_MOUSE_MAX_DURATION_MS = 480;
const DEFAULT_HUMAN_MOUSE_MIN_STEP_MS = 7;
const DEFAULT_HUMAN_MOUSE_MAX_STEP_MS = 18;
const DEFAULT_HUMAN_MOUSE_JITTER_PX = 1.6;
const DEFAULT_HUMAN_MOUSE_OVERSHOOT_CHANCE = 0.18;
const DEFAULT_HUMAN_MOUSE_MAX_OVERSHOOT_PX = 14;
const syncSleepBuffer = new Int32Array(new SharedArrayBuffer(4));

export type HumanLikeMouseMoveOptions = {
  safeEdgeMarginPx?: number;
  durationMs?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  minStepMs?: number;
  maxStepMs?: number;
  jitterPx?: number;
  overshootChance?: number;
  maxOvershootPx?: number;
  shouldContinue?: () => boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min: number, max: number): number {
  if (max <= min) {
    return min;
  }

  return min + Math.random() * (max - min);
}

function easeInOutCubic(progress: number): number {
  if (progress < 0.5) {
    return 4 * progress * progress * progress;
  }

  return 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function sleepAsyncMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function getRoundedScreenPoint(screenX: number, screenY: number): ScreenPoint {
  return {
    x: Math.round(screenX),
    y: Math.round(screenY),
  };
}

function clampPointToBounds(
  point: ScreenPoint,
  captureBounds: ScreenCaptureBounds | undefined,
  safeEdgeMarginPx: number | undefined,
): ScreenPoint {
  if (!captureBounds) {
    return getRoundedScreenPoint(point.x, point.y);
  }

  return getSafeScreenPoint(point.x, point.y, captureBounds, safeEdgeMarginPx);
}

function estimateHumanMouseDurationMs(distancePx: number, options: HumanLikeMouseMoveOptions): number {
  if (typeof options.durationMs === "number" && Number.isFinite(options.durationMs)) {
    return Math.max(0, Math.round(options.durationMs));
  }

  const minDurationMs = Math.max(0, options.minDurationMs ?? DEFAULT_HUMAN_MOUSE_MIN_DURATION_MS);
  const maxDurationMs = Math.max(minDurationMs, options.maxDurationMs ?? DEFAULT_HUMAN_MOUSE_MAX_DURATION_MS);
  const distanceComponent = distancePx * randomBetween(0.45, 0.8);
  const reactionComponent = randomBetween(35, 115);
  return Math.round(clamp(distanceComponent + reactionComponent, minDurationMs, maxDurationMs));
}

function getHumanMouseCurvePoint(
  start: ScreenPoint,
  target: ScreenPoint,
  control: ScreenPoint,
  progress: number,
): ScreenPoint {
  const inverse = 1 - progress;
  return {
    x: Math.round(inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * target.x),
    y: Math.round(inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * target.y),
  };
}

async function moveMouseAlongHumanCurve(
  start: ScreenPoint,
  target: ScreenPoint,
  captureBounds: ScreenCaptureBounds | undefined,
  options: HumanLikeMouseMoveOptions,
): Promise<ScreenPoint> {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  if (distancePx < 1) {
    moveMouse(target.x, target.y);
    return target;
  }

  const durationMs = estimateHumanMouseDurationMs(distancePx, options);
  if (durationMs <= 0) {
    moveMouse(target.x, target.y);
    return target;
  }

  const minStepMs = Math.max(1, Math.round(options.minStepMs ?? DEFAULT_HUMAN_MOUSE_MIN_STEP_MS));
  const maxStepMs = Math.max(minStepMs, Math.round(options.maxStepMs ?? DEFAULT_HUMAN_MOUSE_MAX_STEP_MS));
  const jitterPx = Math.max(0, options.jitterPx ?? DEFAULT_HUMAN_MOUSE_JITTER_PX);
  const safeEdgeMarginPx = options.safeEdgeMarginPx;
  const perpendicularLength = Math.max(1, distancePx);
  const perpendicularX = -dy / perpendicularLength;
  const perpendicularY = dx / perpendicularLength;
  const bendPx = randomBetween(-Math.min(60, distancePx * 0.18), Math.min(60, distancePx * 0.18));
  const control: ScreenPoint = clampPointToBounds(
    {
      x: Math.round(start.x + dx * randomBetween(0.35, 0.65) + perpendicularX * bendPx),
      y: Math.round(start.y + dy * randomBetween(0.35, 0.65) + perpendicularY * bendPx),
    },
    captureBounds,
    safeEdgeMarginPx,
  );
  const startedAt = Date.now();

  while (true) {
    if (options.shouldContinue && !options.shouldContinue()) {
      return clampPointToBounds(getMousePos(), captureBounds, safeEdgeMarginPx);
    }

    const elapsedMs = Date.now() - startedAt;
    const progress = clamp(elapsedMs / durationMs, 0, 1);
    const easedProgress = easeInOutCubic(progress);
    const curvePoint = getHumanMouseCurvePoint(start, target, control, easedProgress);
    const remainingRatio = 1 - progress;
    const noisyPoint = clampPointToBounds(
      {
        x: curvePoint.x + Math.round(randomBetween(-jitterPx, jitterPx) * remainingRatio),
        y: curvePoint.y + Math.round(randomBetween(-jitterPx, jitterPx) * remainingRatio),
      },
      captureBounds,
      safeEdgeMarginPx,
    );
    moveMouse(noisyPoint.x, noisyPoint.y);

    if (progress >= 1) {
      break;
    }

    await sleepAsyncMs(randomBetween(minStepMs, maxStepMs));
  }

  moveMouse(target.x, target.y);
  return target;
}

export function sleepSyncMs(ms: number): void {
  if (ms <= 0) {
    return;
  }

  Atomics.wait(syncSleepBuffer, 0, 0, ms);
}

export async function moveMouseHumanLike(
  screenX: number,
  screenY: number,
  captureBounds?: ScreenCaptureBounds,
  options: HumanLikeMouseMoveOptions = {},
): Promise<ScreenPoint> {
  const safeTarget = clampPointToBounds(getRoundedScreenPoint(screenX, screenY), captureBounds, options.safeEdgeMarginPx);
  const start = clampPointToBounds(getMousePos(), captureBounds, options.safeEdgeMarginPx);
  const dx = safeTarget.x - start.x;
  const dy = safeTarget.y - start.y;
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  if (distancePx < 2) {
    moveMouse(safeTarget.x, safeTarget.y);
    return safeTarget;
  }

  const overshootChance = clamp(options.overshootChance ?? DEFAULT_HUMAN_MOUSE_OVERSHOOT_CHANCE, 0, 1);
  const maxOvershootPx = Math.max(0, options.maxOvershootPx ?? DEFAULT_HUMAN_MOUSE_MAX_OVERSHOOT_PX);
  const shouldOvershoot = distancePx > 90 && maxOvershootPx > 0 && Math.random() < overshootChance;
  if (!shouldOvershoot) {
    return moveMouseAlongHumanCurve(start, safeTarget, captureBounds, options);
  }

  const overshootDistance = randomBetween(4, maxOvershootPx);
  const unitX = dx / distancePx;
  const unitY = dy / distancePx;
  const overshootPoint = clampPointToBounds(
    {
      x: Math.round(safeTarget.x + unitX * overshootDistance + randomBetween(-2, 2)),
      y: Math.round(safeTarget.y + unitY * overshootDistance + randomBetween(-2, 2)),
    },
    captureBounds,
    options.safeEdgeMarginPx,
  );
  const firstLeg = await moveMouseAlongHumanCurve(start, overshootPoint, captureBounds, {
    ...options,
    overshootChance: 0,
    durationMs: options.durationMs ? Math.round(options.durationMs * randomBetween(0.72, 0.86)) : undefined,
  });
  if (options.shouldContinue && !options.shouldContinue()) {
    return firstLeg;
  }

  await sleepAsyncMs(randomBetween(18, 55));
  return moveMouseAlongHumanCurve(firstLeg, safeTarget, captureBounds, {
    ...options,
    overshootChance: 0,
    durationMs: randomBetween(45, 120),
    jitterPx: Math.min(options.jitterPx ?? DEFAULT_HUMAN_MOUSE_JITTER_PX, 0.8),
  });
}

export function getSafeScreenPoint(
  screenX: number,
  screenY: number,
  captureBounds: ScreenCaptureBounds,
  safeEdgeMarginPx: number = DEFAULT_SAFE_EDGE_MARGIN_PX,
): ScreenPoint {
  const safeMinX = Math.round(captureBounds.x + safeEdgeMarginPx);
  const safeMaxX = Math.round(captureBounds.x + captureBounds.width - 1 - safeEdgeMarginPx);
  const safeMinY = Math.round(captureBounds.y + safeEdgeMarginPx);
  const safeMaxY = Math.round(captureBounds.y + captureBounds.height - 1 - safeEdgeMarginPx);

  return {
    x: clamp(Math.round(screenX), safeMinX, safeMaxX),
    y: clamp(Math.round(screenY), safeMinY, safeMaxY),
  };
}

export function clickScreenPointImmediate(
  screenX: number,
  screenY: number,
  captureBounds: ScreenCaptureBounds,
  options: { button?: "left" | "right"; safeEdgeMarginPx?: number } = {},
): ScreenPoint {
  const safePoint = getSafeScreenPoint(screenX, screenY, captureBounds, options.safeEdgeMarginPx);
  moveMouse(safePoint.x, safePoint.y);
  mouseClick(options.button ?? "left", false);
  return safePoint;
}

export function clickScreenPoint(
  screenX: number,
  screenY: number,
  captureBounds: ScreenCaptureBounds,
  options: { button?: "left" | "right"; settleMs?: number; safeEdgeMarginPx?: number } = {},
): ScreenPoint {
  const safePoint = getSafeScreenPoint(screenX, screenY, captureBounds, options.safeEdgeMarginPx);
  moveMouse(safePoint.x, safePoint.y);
  sleepSyncMs(options.settleMs ?? DEFAULT_PRE_CLICK_MOUSE_SETTLE_MS);
  mouseClick(options.button ?? "left", false);
  return safePoint;
}
