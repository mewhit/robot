import type { ScreenBitmap } from "../../windowsScreenCapture";
import type { WorldTile } from "../mapping/world-coordinate";
import { clamp, randomIntInclusive } from "./osrs-helper";
import { clickScreenPoint, moveMouseHumanLike, type ScreenPoint } from "./robot-clicker";
import type { StartupPlayerTileCalibration } from "./startup-calibration";
import {
  searchRuneliteMinimapGeometry,
  type RuneliteMinimapGeometryCandidate,
} from "./minimap-geometry-detector";

const RUNELITE_MINIMAP_CENTER_RIGHT_OFFSET_LOGICAL = 122;
const RUNELITE_MINIMAP_CENTER_Y_LOGICAL = 84;
const RUNELITE_MINIMAP_RADIUS_LOGICAL = 73;
const RUNELITE_MINIMAP_TILE_PX_LOGICAL = 4;
const RUNELITE_MINIMAP_DEFAULT_MAX_CLICK_RADIUS_RATIO = 0.82;

export type MinimapWorldProjectionSource = string;

export type MinimapWorldProjectionAxes = {
  northX: number;
  northY: number;
  eastX: number;
  eastY: number;
  projectionSource: MinimapWorldProjectionSource;
};

export type MinimapWorldClickGeometry = {
  centerLocalX: number;
  centerLocalY: number;
  radiusPx: number;
  tilePx: number;
  source?: string;
  detectionScore: number | null;
  detectionSummary: string;
  candidates: readonly RuneliteMinimapGeometryCandidate[];
  expectedCenterLocalX: number;
  expectedCenterLocalY: number;
  expectedRadiusPx: number;
};

export type MinimapWorldClickPlan = {
  screenPoint: ScreenPoint;
  projectedScreenPoint: ScreenPoint;
  minimapCenter: ScreenPoint;
  expectedMinimapCenter: ScreenPoint;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  clickedPathTiles: number;
  minimapRadiusPx: number;
  expectedMinimapRadiusPx: number;
  minimapTilePx: number;
  effectiveMinimapTilePx: number;
  maxClickDistancePx: number;
  wasVectorClamped: boolean;
  minimapSource: string;
  projectionSource: MinimapWorldProjectionSource;
  northX: number;
  northY: number;
  eastX: number;
  eastY: number;
  minimapDetectionScore: number | null;
  minimapDetectionSummary: string;
  minimapCandidates: readonly RuneliteMinimapGeometryCandidate[];
};

export type MinimapWorldClickOptions = {
  geometry?: MinimapWorldClickGeometry | null;
  projectionAxes?: MinimapWorldProjectionAxes | null;
  centerRightOffsetLogical?: number;
  centerYLogical?: number;
  radiusLogical?: number;
  tilePxLogical?: number;
  maxClickRadiusRatio?: number;
  tilePxScale?: number;
  radiusRatio?: number;
  projectionOffsetLocalX?: number;
  projectionOffsetLocalY?: number;
  compassMinConfidence?: number;
  jitterPx?: number;
};

export type ExecuteMinimapWorldClickPlanOptions = {
  maxDurationMs?: number;
  settleMs?: number;
  safeEdgeMarginPx?: number;
  shouldContinue?: () => boolean;
};

export type ExecutableMinimapWorldClickPlan = Pick<MinimapWorldClickPlan, "screenPoint" | "minimapCenter">;

export type ExecutedMinimapWorldClick<TPlan extends ExecutableMinimapWorldClickPlan = MinimapWorldClickPlan> = {
  plan: TPlan;
  clicked: ScreenPoint;
  clickedLocal: ScreenPoint;
  clickVectorX: number;
  clickVectorY: number;
};

function getScaleFromCalibration(calibration: StartupPlayerTileCalibration): number {
  const scale = calibration.windowsScalePercent / 100;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function inferRuneliteMinimapWorldClickGeometry(
  calibration: StartupPlayerTileCalibration,
  bitmap: ScreenBitmap,
  options: MinimapWorldClickOptions = {},
): MinimapWorldClickGeometry | null {
  const scale = getScaleFromCalibration(calibration);
  const expectedCenterLocalX =
    calibration.captureBounds.width -
    Math.round((options.centerRightOffsetLogical ?? RUNELITE_MINIMAP_CENTER_RIGHT_OFFSET_LOGICAL) * scale);
  const expectedCenterLocalY = Math.round((options.centerYLogical ?? RUNELITE_MINIMAP_CENTER_Y_LOGICAL) * scale);
  const expectedRadiusPx = clamp(
    Math.round((options.radiusLogical ?? RUNELITE_MINIMAP_RADIUS_LOGICAL) * scale),
    55,
    96,
  );
  const expectedTilePx = clamp(
    Math.round((options.tilePxLogical ?? RUNELITE_MINIMAP_TILE_PX_LOGICAL) * scale),
    3,
    7,
  );
  const search = searchRuneliteMinimapGeometry(bitmap, {
    scale,
    expectedCenterLocalX,
    expectedCenterLocalY,
    expectedRadiusPx,
    expectedTilePx,
  });
  const detection = search.detection;
  if (!detection) {
    return null;
  }

  return {
    centerLocalX: detection.centerLocalX,
    centerLocalY: detection.centerLocalY,
    radiusPx: detection.radiusPx,
    tilePx: detection.tilePx,
    detectionScore: detection.score,
    detectionSummary: detection.summary,
    candidates: detection.candidates,
    expectedCenterLocalX: detection.expectedCenterLocalX,
    expectedCenterLocalY: detection.expectedCenterLocalY,
    expectedRadiusPx: detection.expectedRadiusPx,
  };
}

export function getMinimapWorldProjectionAxes(
  calibration: StartupPlayerTileCalibration,
  options: MinimapWorldClickOptions = {},
): MinimapWorldProjectionAxes {
  const compass = calibration.compassNorth;
  const rawNorthX = compass?.northVectorX;
  const rawNorthY = compass?.northVectorY;
  const northLength =
    typeof rawNorthX === "number" && typeof rawNorthY === "number"
      ? Math.hypot(rawNorthX, rawNorthY)
      : 0;
  if (northLength > 0 && (compass?.confidence ?? 0) >= (options.compassMinConfidence ?? 0.2)) {
    const northX = rawNorthX! / northLength;
    const northY = rawNorthY! / northLength;
    return {
      northX,
      northY,
      eastX: -northY,
      eastY: northX,
      projectionSource: "compass-rotated",
    };
  }

  return {
    northX: 0,
    northY: -1,
    eastX: 1,
    eastY: 0,
    projectionSource: "north-up-fallback",
  };
}

export function projectWorldTileToMinimapClick(
  calibration: StartupPlayerTileCalibration,
  bitmap: ScreenBitmap | null,
  playerTile: Pick<WorldTile, "x" | "y" | "z">,
  targetTile: Pick<WorldTile, "x" | "y" | "z">,
  options: MinimapWorldClickOptions = {},
): MinimapWorldClickPlan | null {
  if (playerTile.z !== targetTile.z) {
    return null;
  }

  const minimap = options.geometry ?? (bitmap ? inferRuneliteMinimapWorldClickGeometry(calibration, bitmap, options) : null);
  if (!minimap) {
    return null;
  }

  const dxTiles = targetTile.x - playerTile.x;
  const dyTiles = targetTile.y - playerTile.y;
  const distanceTiles = Math.max(Math.abs(dxTiles), Math.abs(dyTiles));
  const effectiveTilePx = Math.max(1, minimap.tilePx * (options.tilePxScale ?? 1));
  const jitterPx = Math.max(0, Math.round(options.jitterPx ?? effectiveTilePx * 0.5));
  const axes = options.projectionAxes ?? getMinimapWorldProjectionAxes(calibration, options);
  let localDx = (axes.eastX * dxTiles + axes.northX * dyTiles) * effectiveTilePx;
  let localDy = (axes.eastY * dxTiles + axes.northY * dyTiles) * effectiveTilePx;
  const vectorLength = Math.hypot(localDx, localDy);
  const maxClickDistancePx = Math.max(
    1,
    Math.round(
      minimap.radiusPx *
        (options.radiusRatio ?? options.maxClickRadiusRatio ?? RUNELITE_MINIMAP_DEFAULT_MAX_CLICK_RADIUS_RATIO),
    ),
  );
  let wasVectorClamped = false;
  if (vectorLength > maxClickDistancePx) {
    wasVectorClamped = true;
    const vectorScale = maxClickDistancePx / vectorLength;
    localDx *= vectorScale;
    localDy *= vectorScale;
  }

  const projectedLocalX = minimap.centerLocalX + localDx + (options.projectionOffsetLocalX ?? 0);
  const projectedLocalY = minimap.centerLocalY + localDy + (options.projectionOffsetLocalY ?? 0);
  const localX = projectedLocalX + (jitterPx > 0 ? randomIntInclusive(-jitterPx, jitterPx) : 0);
  const localY = projectedLocalY + (jitterPx > 0 ? randomIntInclusive(-jitterPx, jitterPx) : 0);
  const clickedPathTiles = Math.max(
    1,
    Math.min(distanceTiles, Math.floor(maxClickDistancePx / effectiveTilePx)),
  );

  return {
    screenPoint: {
      x: calibration.captureBounds.x + Math.round(localX),
      y: calibration.captureBounds.y + Math.round(localY),
    },
    projectedScreenPoint: {
      x: calibration.captureBounds.x + Math.round(projectedLocalX),
      y: calibration.captureBounds.y + Math.round(projectedLocalY),
    },
    minimapCenter: {
      x: calibration.captureBounds.x + minimap.centerLocalX,
      y: calibration.captureBounds.y + minimap.centerLocalY,
    },
    expectedMinimapCenter: {
      x: calibration.captureBounds.x + minimap.expectedCenterLocalX,
      y: calibration.captureBounds.y + minimap.expectedCenterLocalY,
    },
    dxTiles,
    dyTiles,
    distanceTiles,
    clickedPathTiles,
    minimapRadiusPx: minimap.radiusPx,
    expectedMinimapRadiusPx: minimap.expectedRadiusPx,
    minimapTilePx: minimap.tilePx,
    effectiveMinimapTilePx: effectiveTilePx,
    maxClickDistancePx,
    wasVectorClamped,
    minimapSource: minimap.source ?? "detected-from-contour",
    minimapDetectionScore: minimap.detectionScore,
    minimapDetectionSummary: minimap.detectionSummary,
    minimapCandidates: minimap.candidates,
    ...axes,
  };
}

export async function executeMinimapWorldClickPlan<TPlan extends ExecutableMinimapWorldClickPlan>(
  calibration: StartupPlayerTileCalibration,
  plan: TPlan,
  options: ExecuteMinimapWorldClickPlanOptions = {},
): Promise<ExecutedMinimapWorldClick<TPlan>> {
  await moveMouseHumanLike(plan.screenPoint.x, plan.screenPoint.y, calibration.captureBounds, {
    maxDurationMs: options.maxDurationMs ?? randomIntInclusive(180, 320),
    safeEdgeMarginPx: options.safeEdgeMarginPx ?? 8,
    shouldContinue: options.shouldContinue,
  });
  const clicked = clickScreenPoint(plan.screenPoint.x, plan.screenPoint.y, calibration.captureBounds, {
    settleMs: options.settleMs ?? randomIntInclusive(45, 120),
    safeEdgeMarginPx: options.safeEdgeMarginPx ?? 8,
  });
  const clickedLocal = {
    x: clicked.x - calibration.captureBounds.x,
    y: clicked.y - calibration.captureBounds.y,
  };

  return {
    plan,
    clicked,
    clickedLocal,
    clickVectorX: clicked.x - plan.minimapCenter.x,
    clickVectorY: clicked.y - plan.minimapCenter.y,
  };
}
