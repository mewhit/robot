import path from "path";
import type { Window } from "node-window-manager";
import { captureScreenBitmap, type ScreenBitmap } from "../../windowsScreenCapture";
import type { WorldTile } from "../mapping/world-coordinate";
import {
  createMinimapClickCalibrationState,
  formatMinimapClickCalibrationProfile,
  getMinimapClickCalibrationProfile,
  observeMinimapClickCalibration,
  readSavedMinimapClickCalibration,
  readStablePlayerTileForMinimapClickCalibration,
  shouldRunMinimapClickCalibration,
} from "./minimap-click-calibration";
import {
  executeMinimapWorldClickPlan,
  projectWorldTileToMinimapClick,
  type ExecutedMinimapWorldClick,
  type MinimapWorldClickPlan,
  type MinimapWorldProjectionAxes,
} from "./minimap-world-clicker";
import { saveBitmapWithDebugOverlay, type DebugOverlayShape } from "./debug-image-overlay";
import { readStartupPlayerTileCalibration, type StartupPlayerTileCalibration } from "./startup-calibration";
import {
  formatWorldTile,
  getWorldTileChebyshevDistance,
  planWorldRouteToTiles,
  type WorldRoutePlan,
  type WorldRouteTile,
} from "./world-route-planner";

const MINIMAP_AUTO_CALIBRATION_DEBUG_DIR = "test-image-debug";
const MINIMAP_AUTO_CALIBRATION_GAME_TICK_MS = 600;
const MINIMAP_AUTO_CALIBRATION_TARGET_SAMPLE_COUNT = 3;
const MINIMAP_AUTO_CALIBRATION_MAX_ATTEMPTS = 6;
const MINIMAP_AUTO_CALIBRATION_MAX_CLICK_RADIUS_RATIO = 0.84;
const MINIMAP_AUTO_CALIBRATION_WAYPOINT_STEP_LIMIT = 5;
const MINIMAP_AUTO_CALIBRATION_MAX_TILE_JUMP = 256;
const MINIMAP_AUTO_CALIBRATION_NORTH_UP_AXES: MinimapWorldProjectionAxes = {
  northX: 0,
  northY: -1,
  eastX: 1,
  eastY: 0,
  projectionSource: "calibrated-camera-north",
};
const MINIMAP_AUTO_CALIBRATION_OFFSETS: Array<{ dx: number; dy: number }> = [
  { dx: 4, dy: 0 },
  { dx: 0, dy: 4 },
  { dx: -4, dy: 0 },
  { dx: 0, dy: -4 },
  { dx: 3, dy: 3 },
  { dx: -3, dy: 3 },
  { dx: 3, dy: -3 },
  { dx: -3, dy: -3 },
];

export type MinimapClickAutoCalibrationResult = {
  ok: boolean;
  error?: string;
  sampleCount: number;
  trusted: boolean;
  savedCalibrationPath: string | null;
};

export type MinimapClickAutoCalibrationOptions = {
  log?: (message: string) => void;
  isRunning?: () => boolean;
  targetSampleCount?: number;
  maxAttempts?: number;
  assumeCameraNorth?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function screenPointToLocal(calibration: StartupPlayerTileCalibration, point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: point.x - calibration.captureBounds.x,
    y: point.y - calibration.captureBounds.y,
  };
}

function formatCalibrationState(state: ReturnType<typeof createMinimapClickCalibrationState>): string {
  return `trusted=${state.isCalibrationTrusted ? "yes" : "no"} startupValidation=${
    state.startupValidationPending ? "pending" : "none"
  } samples=${state.calibrationSampleCount} goodStreak=${state.calibrationGoodStreak} tilePxScale=${state.tilePxScale.toFixed(
    3,
  )} radiusRatio=${state.radiusRatio.toFixed(3)} offset=${state.projectionOffsetLocalX.toFixed(
    1,
  )},${state.projectionOffsetLocalY.toFixed(1)} profile=${state.calibrationProfileKey ?? "none"} path=${
    state.savedCalibrationPath ?? "none"
  }`;
}

function getOffsetTargetTile(playerTile: Pick<WorldRouteTile, "x" | "y" | "z">, attemptIndex: number): WorldRouteTile {
  const offset = MINIMAP_AUTO_CALIBRATION_OFFSETS[attemptIndex % MINIMAP_AUTO_CALIBRATION_OFFSETS.length];
  return {
    x: playerTile.x + offset.dx,
    y: playerTile.y + offset.dy,
    z: playerTile.z,
  };
}

function selectCalibrationWaypoint(
  playerTile: WorldTile,
  attemptIndex: number,
): { waypoint: WorldRouteTile; route: WorldRoutePlan | null; source: "route" | "direct-offset" } {
  const targetTile = getOffsetTargetTile(playerTile, attemptIndex);
  const route = planWorldRouteToTiles(playerTile, {
    destinationLabel: "minimap calibration waypoint",
    destinationTile: targetTile,
    targetTiles: [targetTile],
    waypointStepLimit: MINIMAP_AUTO_CALIBRATION_WAYPOINT_STEP_LIMIT,
    maxCrossRegionCount: 1,
  });

  if (route.status === "ready" && route.nextWaypoint) {
    return { waypoint: route.nextWaypoint, route, source: "route" };
  }

  return { waypoint: targetTile, route: route.status === "unavailable" ? null : route, source: "direct-offset" };
}

function estimateWaitMs(playerTile: WorldRouteTile, waypoint: WorldRouteTile, route: WorldRoutePlan | null): number {
  const pathTiles =
    route?.status === "ready"
      ? Math.max(1, route.nextWaypointPathLength)
      : Math.max(1, getWorldTileChebyshevDistance(playerTile, waypoint));
  return Math.max(MINIMAP_AUTO_CALIBRATION_GAME_TICK_MS * 2, (Math.ceil(pathTiles / 2) + 2) * MINIMAP_AUTO_CALIBRATION_GAME_TICK_MS);
}

function buildDebugPath(attempt: number, waypoint: WorldRouteTile): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    MINIMAP_AUTO_CALIBRATION_DEBUG_DIR,
    `${timestamp}-minimap-click-calibration-${attempt}-target-${waypoint.x}-${waypoint.y}-${waypoint.z}.png`,
  );
}

async function saveMinimapClickDebugImage(
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
  plan: MinimapWorldClickPlan,
  executed: ExecutedMinimapWorldClick<MinimapWorldClickPlan>,
  attempt: number,
  waypoint: WorldRouteTile,
): Promise<string | null> {
  const minimapCenterLocal = screenPointToLocal(calibration, plan.minimapCenter);
  const expectedMinimapCenterLocal = screenPointToLocal(calibration, plan.expectedMinimapCenter);
  const projectedLocal = screenPointToLocal(calibration, plan.projectedScreenPoint);
  const shapes: DebugOverlayShape[] = [
    {
      type: "circle",
      x: expectedMinimapCenterLocal.x,
      y: expectedMinimapCenterLocal.y,
      radius: plan.expectedMinimapRadiusPx,
      color: { r: 255, g: 0, b: 255 },
      thickness: 1,
    },
    {
      type: "circle",
      x: minimapCenterLocal.x,
      y: minimapCenterLocal.y,
      radius: plan.minimapRadiusPx,
      color: { r: 255, g: 140, b: 0 },
      thickness: 2,
    },
    {
      type: "circle",
      x: minimapCenterLocal.x,
      y: minimapCenterLocal.y,
      radius: Math.round(plan.maxClickDistancePx),
      color: { r: 255, g: 220, b: 0 },
      thickness: 1,
    },
    {
      type: "cross",
      x: minimapCenterLocal.x,
      y: minimapCenterLocal.y,
      radius: 8,
      color: { r: 64, g: 220, b: 255 },
      thickness: 2,
    },
    {
      type: "line",
      x1: minimapCenterLocal.x,
      y1: minimapCenterLocal.y,
      x2: projectedLocal.x,
      y2: projectedLocal.y,
      color: { r: 255, g: 220, b: 0 },
      thickness: 2,
    },
    {
      type: "cross",
      x: projectedLocal.x,
      y: projectedLocal.y,
      radius: 12,
      color: { r: 255, g: 220, b: 0 },
      thickness: 2,
    },
    {
      type: "cross",
      x: executed.clickedLocal.x,
      y: executed.clickedLocal.y,
      radius: 7,
      color: { r: 255, g: 0, b: 0 },
      thickness: 3,
    },
  ];

  const candidateColors = [
    { r: 0, g: 170, b: 255 },
    { r: 60, g: 255, b: 120 },
    { r: 255, g: 255, b: 255 },
  ];
  for (const [candidateIndex, candidate] of plan.minimapCandidates.slice(1, 4).entries()) {
    shapes.push({
      type: "circle",
      x: candidate.centerLocalX,
      y: candidate.centerLocalY,
      radius: candidate.radiusPx,
      color: candidateColors[candidateIndex],
      thickness: 1,
    });
  }

  const debugPath = buildDebugPath(attempt, waypoint);
  await saveBitmapWithDebugOverlay(bitmap, debugPath, shapes);
  return debugPath;
}

export async function runMinimapClickAutoCalibration(
  window: Window,
  options: MinimapClickAutoCalibrationOptions = {},
): Promise<MinimapClickAutoCalibrationResult> {
  const log = options.log ?? (() => undefined);
  const isRunning = options.isRunning ?? (() => true);
  const targetSampleCount = options.targetSampleCount ?? MINIMAP_AUTO_CALIBRATION_TARGET_SAMPLE_COUNT;
  const maxAttempts = options.maxAttempts ?? MINIMAP_AUTO_CALIBRATION_MAX_ATTEMPTS;
  const calibrationOptions = {
    defaultRadiusRatio: MINIMAP_AUTO_CALIBRATION_MAX_CLICK_RADIUS_RATIO,
    trustedErrorTiles: 1,
    warn: (message: string) => log(message),
  };
  let state: ReturnType<typeof createMinimapClickCalibrationState> | null = null;
  let observedSamples = 0;

  for (let attempt = 1; attempt <= maxAttempts && isRunning(); attempt += 1) {
    if (state && observedSamples >= targetSampleCount && state.isCalibrationTrusted) {
      break;
    }

    const calibration = readStartupPlayerTileCalibration(window, {
      requireRuneLiteCoordinatePattern: true,
    });
    const playerTile = calibration?.playerTile ?? null;
    if (!calibration || !playerTile) {
      return {
        ok: false,
        error: `startup calibration could not read player tile for minimap calibration; coordinate=${calibration?.coordinateLine ?? "unavailable"} debug=${calibration?.coordinateDebugPath ?? "none"}`,
        sampleCount: observedSamples,
        trusted: state?.isCalibrationTrusted ?? false,
        savedCalibrationPath: state?.savedCalibrationPath ?? null,
      };
    }

    const profile = getMinimapClickCalibrationProfile(calibration);
    const profileOptions = { ...calibrationOptions, profile };
    const profileKey = formatMinimapClickCalibrationProfile(profile);
    if (!state || state.calibrationProfileKey !== profileKey) {
      state = createMinimapClickCalibrationState(readSavedMinimapClickCalibration(profileOptions), profileOptions);
      log(`Minimap calibration startup: profile=${profileKey} ${formatCalibrationState(state)}.`);
    }

    const bitmap = captureScreenBitmap(calibration.captureBounds);
    const { waypoint, route, source } = selectCalibrationWaypoint(playerTile, attempt - 1);
    const calibrationActive = shouldRunMinimapClickCalibration(state);
    const plan = projectWorldTileToMinimapClick(calibration, bitmap, playerTile, waypoint, {
      maxClickRadiusRatio: MINIMAP_AUTO_CALIBRATION_MAX_CLICK_RADIUS_RATIO,
      tilePxScale: state.tilePxScale,
      radiusRatio: state.radiusRatio,
      projectionOffsetLocalX: state.projectionOffsetLocalX,
      projectionOffsetLocalY: state.projectionOffsetLocalY,
      projectionAxes: options.assumeCameraNorth ? MINIMAP_AUTO_CALIBRATION_NORTH_UP_AXES : undefined,
      jitterPx: calibrationActive ? 0 : undefined,
    });
    if (!plan) {
      log(`Minimap calibration attempt ${attempt}: skipped; cannot project waypoint=${formatWorldTile(waypoint)} player=${formatWorldTile(playerTile)} source=${source}.`);
      continue;
    }
    if (plan.wasVectorClamped) {
      log(
        `Minimap calibration attempt ${attempt}: skipped; projected vector clamped waypoint=${formatWorldTile(
          waypoint,
        )} distance=${plan.distanceTiles} maxClick=${plan.maxClickDistancePx}px.`,
      );
      continue;
    }

    const executed = await executeMinimapWorldClickPlan(calibration, plan, {
      maxDurationMs: 260,
      safeEdgeMarginPx: 8,
      shouldContinue: isRunning,
    });
    let debugPath: string | null = null;
    try {
      debugPath = await saveMinimapClickDebugImage(bitmap, calibration, plan, executed, attempt, waypoint);
    } catch (error) {
      log(`Minimap calibration attempt ${attempt}: debug image save failed: ${error instanceof Error ? error.message : String(error)}.`);
    }

    const waitMs = estimateWaitMs(playerTile, waypoint, route);
    log(
      `Minimap calibration attempt ${attempt}: clicked waypoint=${formatWorldTile(waypoint)} player=${formatWorldTile(
        playerTile,
      )} source=${source} screen=${executed.clicked.x},${executed.clicked.y} delta=${plan.dxTiles},${
        plan.dyTiles
      } distance=${plan.distanceTiles} projection=${plan.projectionSource} north=${plan.northX.toFixed(
        2,
      )},${plan.northY.toFixed(2)} tilePx=${plan.minimapTilePx}px effectiveTilePx=${plan.effectiveMinimapTilePx.toFixed(
        2,
      )} tilePxScale=${state.tilePxScale.toFixed(3)} radiusRatio=${state.radiusRatio.toFixed(
        3,
      )} offset=${state.projectionOffsetLocalX.toFixed(1)},${state.projectionOffsetLocalY.toFixed(
        1,
      )} wait=${waitMs}ms debug=${debugPath ?? "none"}.`,
    );

    await sleep(waitMs);
    const stableRead = await readStablePlayerTileForMinimapClickCalibration({
      expectedTile: waypoint,
      getWindow: () => window,
      readTile: (readWindow, expectedTile, previousTile) =>
        readStartupPlayerTileCalibration(readWindow, {
          expectedTile: previousTile ?? expectedTile ?? undefined,
          maxTileJump: MINIMAP_AUTO_CALIBRATION_MAX_TILE_JUMP,
          requireRuneLiteCoordinatePattern: true,
        })?.playerTile ?? null,
      sleep,
      isRunning,
      gameTickMs: MINIMAP_AUTO_CALIBRATION_GAME_TICK_MS,
      warn: (message) => log(message),
    });
    if (!stableRead) {
      log(`Minimap calibration attempt ${attempt}: rejected; stable player tile unavailable after waypoint=${formatWorldTile(waypoint)}.`);
      continue;
    }

    const oldTilePxScale = state.tilePxScale;
    const oldRadiusRatio = state.radiusRatio;
    const oldOffsetX = state.projectionOffsetLocalX;
    const oldOffsetY = state.projectionOffsetLocalY;
    const observation = observeMinimapClickCalibration(
      state,
      {
        targetTile: waypoint,
        actualTile: stableRead.tile,
        northX: plan.northX,
        northY: plan.northY,
        eastX: plan.eastX,
        eastY: plan.eastY,
        effectiveTilePx: plan.effectiveMinimapTilePx,
        sourceCalibration: calibration,
      },
      profileOptions,
    );
    observedSamples += 1;
    log(
      `Minimap calibration attempt ${attempt}: observed actual=${formatWorldTile(stableRead.tile)} first=${formatWorldTile(
        stableRead.firstTile,
      )} target=${formatWorldTile(waypoint)} attempts=${stableRead.attempts} waited=${
        stableRead.waitedMs
      }ms error=${observation.targetErrorTiles} delta=${observation.targetErrorX},${
        observation.targetErrorY
      } correction=${observation.correctionLocalX.toFixed(1)},${observation.correctionLocalY.toFixed(1)} tilePxScale=${oldTilePxScale.toFixed(
        3,
      )}->${state.tilePxScale.toFixed(3)} radiusRatio=${oldRadiusRatio.toFixed(3)}->${state.radiusRatio.toFixed(
        3,
      )} offset=${oldOffsetX.toFixed(1)},${oldOffsetY.toFixed(1)}->${state.projectionOffsetLocalX.toFixed(
        1,
      )},${state.projectionOffsetLocalY.toFixed(1)} result=${observation.summary}${
        observation.saved ? "-saved" : ""
      } trusted=${state.isCalibrationTrusted ? "yes" : "no"} samples=${state.calibrationSampleCount}.`,
    );
  }

  if (!state?.isCalibrationTrusted) {
    return {
      ok: false,
      error: `minimap calibration did not reach trusted state; samples=${observedSamples} ${
        state ? formatCalibrationState(state) : "state=unavailable"
      }`,
      sampleCount: observedSamples,
      trusted: false,
      savedCalibrationPath: state?.savedCalibrationPath ?? null,
    };
  }

  return {
    ok: true,
    sampleCount: observedSamples,
    trusted: true,
    savedCalibrationPath: state.savedCalibrationPath,
  };
}
