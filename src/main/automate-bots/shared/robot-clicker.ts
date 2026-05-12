import { mouseClick, moveMouse } from "robotjs";
import type { ScreenCaptureBounds } from "../../windowsScreenCapture";

export type ScreenPoint = {
  x: number;
  y: number;
};

export const DEFAULT_PRE_CLICK_MOUSE_SETTLE_MS = 50;
const DEFAULT_SAFE_EDGE_MARGIN_PX = 3;
const syncSleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sleepSyncMs(ms: number): void {
  if (ms <= 0) {
    return;
  }

  Atomics.wait(syncSleepBuffer, 0, 0, ms);
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
