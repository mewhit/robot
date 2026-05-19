import path from "path";
import type { Window } from "node-window-manager";
import { captureScreenBitmap } from "../../windowsScreenCapture";
import type {
  EndToEndSceneMouseCalibrationFit,
  EndToEndSceneMouseCalibrationSample,
} from "../end-to-end-config";
import { deriveWorldTile, parseWorldTileFromMatchedLine, type WorldTile } from "../mapping/world-coordinate";
import { detectOverlayBoxInScreenshot } from "./coordinate-box-detector";
import { clamp, randomIntInclusive } from "./osrs-helper";
import { getSafeScreenPoint, moveMouseHumanLike, type ScreenPoint } from "./robot-clicker";
import { saveBitmapAsync } from "./save-bitmap";
import {
  SCENE_MOUSE_CALIBRATION_MAX_SAMPLES,
  SCENE_MOUSE_CALIBRATION_MIN_SAMPLES,
  fitSceneMouseCalibrationSamples,
  formatSceneMouseCalibrationFit,
  getSceneMouseCalibrationProfileKey,
  isSceneMouseCalibrationProjectiveFitAcceptable,
  saveSharedSceneMouseCalibration,
} from "./scene-mouse-calibration";
import {
  formatStartupPlayerTileCalibrationLog,
  readStartupPlayerTileCalibration,
  type StartupPlayerTileCalibration,
} from "./startup-calibration";

const SCENE_CALIBRATION_REFERENCE_SCALE_PERCENT = 125;
const SCENE_CALIBRATION_RIGHT_PANEL_WIDTH_LOGICAL = 245;
const SCENE_CALIBRATION_BOTTOM_UI_HEIGHT_LOGICAL = 170;
const SCENE_CALIBRATION_SAFE_EDGE_MARGIN_PX = 24;
const SCENE_CALIBRATION_TARGET_EDGE_MARGIN_PX_AT_125 = 90;
const SCENE_CALIBRATION_PROBE_COUNT = 12;
const SCENE_CALIBRATION_MAX_PROBES_PER_TILE = 4;
const SCENE_CALIBRATION_MICRO_OFFSET_PX_AT_125 = 9;
const SCENE_CALIBRATION_MAX_DELTA_TILES = 80;
const SCENE_CALIBRATION_MOUSE_MOVE_MIN_MS = 85;
const SCENE_CALIBRATION_MOUSE_MOVE_MAX_MS = 280;
const SCENE_CALIBRATION_MOUSE_MOVE_JITTER_PX = 0.9;
const SCENE_CALIBRATION_MOUSE_MOVE_OVERSHOOT_CHANCE = 0.08;
const SCENE_CALIBRATION_HOVER_SETTLE_MIN_MS = 75;
const SCENE_CALIBRATION_HOVER_SETTLE_MAX_MS = 135;
const SCENE_MOUSE_COORDINATE_CROP_LEFT_AT_125_PX = 28;
const SCENE_MOUSE_COORDINATE_CROP_TOP_AT_125_PX = 28;
const SCENE_MOUSE_COORDINATE_CROP_WIDTH_AT_125_PX = 360;
const SCENE_MOUSE_COORDINATE_CROP_HEIGHT_AT_125_PX = 240;
const SCENE_MOUSE_DEBUG_DIR = "test-image-debug";

type SceneCalibrationProbe = {
  label: string;
  point: ScreenPoint;
};

type SceneMouseCoordinateRead = {
  tile: WorldTile;
  line: string;
};

type SceneMouseCoordinateProbe = {
  read: SceneMouseCoordinateRead | null;
  debugPath: string;
};

export type SceneMouseAutoCalibrationResult = {
  ok: boolean;
  error?: string;
  sampleCount: number;
  fit: EndToEndSceneMouseCalibrationFit | null;
  accepted: boolean;
};

export type SceneMouseAutoCalibrationOptions = {
  log?: (message: string) => void;
  source?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function getCurrentSceneScaleRelativeTo125(calibration: StartupPlayerTileCalibration): number {
  return calibration.windowsScalePercent / SCENE_CALIBRATION_REFERENCE_SCALE_PERCENT;
}

function getSceneBounds(calibration: StartupPlayerTileCalibration): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const scale = getCurrentSceneScaleRelativeTo125(calibration);
  const rightPanelWidth = Math.round(SCENE_CALIBRATION_RIGHT_PANEL_WIDTH_LOGICAL * scale);
  const bottomUiHeight = Math.round(SCENE_CALIBRATION_BOTTOM_UI_HEIGHT_LOGICAL * scale);
  return {
    left: 0,
    top: Math.round(calibration.captureBounds.height * 0.08),
    right: Math.max(1, calibration.captureBounds.width - rightPanelWidth),
    bottom: Math.max(
      Math.round(calibration.captureBounds.height * 0.58),
      calibration.captureBounds.height - bottomUiHeight,
    ),
  };
}

function getSceneTargetEdgeMarginPx(calibration: StartupPlayerTileCalibration): number {
  return Math.max(
    SCENE_CALIBRATION_SAFE_EDGE_MARGIN_PX,
    Math.round(SCENE_CALIBRATION_TARGET_EDGE_MARGIN_PX_AT_125 * getCurrentSceneScaleRelativeTo125(calibration)),
  );
}

function screenPointToLocal(calibration: StartupPlayerTileCalibration, point: ScreenPoint): ScreenPoint {
  return {
    x: point.x - calibration.captureBounds.x,
    y: point.y - calibration.captureBounds.y,
  };
}

function isLocalPointInsideScene(
  calibration: StartupPlayerTileCalibration,
  localPoint: ScreenPoint,
  safeEdgeMarginPx: number = SCENE_CALIBRATION_SAFE_EDGE_MARGIN_PX,
): boolean {
  const scene = getSceneBounds(calibration);
  return (
    localPoint.x >= scene.left + safeEdgeMarginPx &&
    localPoint.x <= scene.right - safeEdgeMarginPx &&
    localPoint.y >= scene.top + safeEdgeMarginPx &&
    localPoint.y <= scene.bottom - safeEdgeMarginPx
  );
}

function projectWorldTileToScreen(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldTile,
  targetTile: WorldTile,
): ScreenPoint | null {
  if (playerTile.z !== targetTile.z) {
    return null;
  }

  const anchor = calibration.playerBoxScreenCenter ?? {
    x: calibration.captureBounds.x + Math.round(calibration.captureBounds.width * 0.5),
    y: calibration.captureBounds.y + Math.round(calibration.captureBounds.height * 0.52),
  };
  const compass = calibration.compassNorth;
  const rawNorthX = compass?.northVectorX ?? 0;
  const rawNorthY = compass?.northVectorY ?? -1;
  const northLength = Math.hypot(rawNorthX, rawNorthY);
  const northX = northLength > 0 ? rawNorthX / northLength : 0;
  const northY = northLength > 0 ? rawNorthY / northLength : -1;
  const eastX = -northY;
  const eastY = northX;
  const tilePx = clamp(calibration.tilePx, 24, 96);
  const dxTiles = targetTile.x - playerTile.x;
  const dyTiles = targetTile.y - playerTile.y;

  return {
    x: Math.round(anchor.x + (eastX * dxTiles + northX * dyTiles) * tilePx),
    y: Math.round(anchor.y + (eastY * dxTiles + northY * dyTiles) * tilePx),
  };
}

function getProbeTileOffsets(): Array<{ dx: number; dy: number }> {
  return [
    { dx: 0, dy: 4 },
    { dx: 4, dy: 0 },
    { dx: 0, dy: -4 },
    { dx: -4, dy: 0 },
    { dx: 3, dy: 3 },
    { dx: -3, dy: 3 },
    { dx: 3, dy: -3 },
    { dx: -3, dy: -3 },
    { dx: 0, dy: 6 },
    { dx: 6, dy: 0 },
    { dx: 0, dy: -6 },
    { dx: -6, dy: 0 },
  ];
}

function getFallbackProbePixelOffsets(calibration: StartupPlayerTileCalibration): Array<{ x: number; y: number }> {
  const tilePx = clamp(calibration.tilePx, 24, 96);
  const step = Math.max(120, Math.round(tilePx * 3.2));
  return [
    { x: 0, y: -step },
    { x: step, y: 0 },
    { x: 0, y: step },
    { x: -step, y: 0 },
    { x: step, y: -step },
    { x: -step, y: -step },
    { x: step, y: step },
    { x: -step, y: step },
  ];
}

function getSceneExtremityRatios(): Array<{ label: string; xRatio: number; yRatio: number }> {
  return [
    { label: "scene-top-left", xRatio: 0.16, yRatio: 0.16 },
    { label: "scene-top", xRatio: 0.5, yRatio: 0.12 },
    { label: "scene-top-right", xRatio: 0.84, yRatio: 0.16 },
    { label: "scene-right", xRatio: 0.88, yRatio: 0.5 },
    { label: "scene-bottom-right", xRatio: 0.84, yRatio: 0.84 },
    { label: "scene-bottom", xRatio: 0.5, yRatio: 0.88 },
    { label: "scene-bottom-left", xRatio: 0.16, yRatio: 0.84 },
    { label: "scene-left", xRatio: 0.12, yRatio: 0.5 },
  ];
}

function addProbe(probes: SceneCalibrationProbe[], seen: Set<string>, probe: SceneCalibrationProbe): void {
  const key = `${Math.round(probe.point.x / 8)}:${Math.round(probe.point.y / 8)}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  probes.push(probe);
}

function selectSceneCalibrationProbes(calibration: StartupPlayerTileCalibration, playerTile: WorldTile): SceneCalibrationProbe[] {
  const probes: SceneCalibrationProbe[] = [];
  const seen = new Set<string>();
  const safeEdgeMarginPx = getSceneTargetEdgeMarginPx(calibration);
  const scene = getSceneBounds(calibration);
  const sceneWidth = Math.max(1, scene.right - scene.left);
  const sceneHeight = Math.max(1, scene.bottom - scene.top);

  for (const ratioProbe of getSceneExtremityRatios()) {
    const localX = clamp(
      Math.round(scene.left + sceneWidth * ratioProbe.xRatio),
      scene.left + safeEdgeMarginPx,
      scene.right - safeEdgeMarginPx,
    );
    const localY = clamp(
      Math.round(scene.top + sceneHeight * ratioProbe.yRatio),
      scene.top + safeEdgeMarginPx,
      scene.bottom - safeEdgeMarginPx,
    );
    const point = {
      x: calibration.captureBounds.x + localX,
      y: calibration.captureBounds.y + localY,
    };
    const localPoint = screenPointToLocal(calibration, point);
    if (!isLocalPointInsideScene(calibration, localPoint, safeEdgeMarginPx)) {
      continue;
    }

    addProbe(probes, seen, {
      label: ratioProbe.label,
      point,
    });
  }

  for (const offset of getProbeTileOffsets()) {
    const tile = deriveWorldTile(
      playerTile.x + offset.dx,
      playerTile.y + offset.dy,
      playerTile.z,
    );
    const point = projectWorldTileToScreen(calibration, playerTile, tile);
    if (!point) {
      continue;
    }

    const localPoint = screenPointToLocal(calibration, point);
    if (!isLocalPointInsideScene(calibration, localPoint, safeEdgeMarginPx)) {
      continue;
    }

    addProbe(probes, seen, {
      label: `tile-delta=${offset.dx},${offset.dy}`,
      point,
    });
    if (probes.length >= SCENE_CALIBRATION_PROBE_COUNT) {
      return probes;
    }
  }

  const anchor = calibration.playerBoxScreenCenter ?? {
    x: calibration.captureBounds.x + Math.round(calibration.captureBounds.width * 0.5),
    y: calibration.captureBounds.y + Math.round(calibration.captureBounds.height * 0.52),
  };
  for (const offset of getFallbackProbePixelOffsets(calibration)) {
    const point = getSafeScreenPoint(
      anchor.x + offset.x,
      anchor.y + offset.y,
      calibration.captureBounds,
      safeEdgeMarginPx,
    );
    const localPoint = screenPointToLocal(calibration, point);
    if (!isLocalPointInsideScene(calibration, localPoint, safeEdgeMarginPx)) {
      continue;
    }

    addProbe(probes, seen, {
      label: `pixel-offset=${offset.x},${offset.y}`,
      point,
    });
    if (probes.length >= SCENE_CALIBRATION_PROBE_COUNT) {
      return probes;
    }
  }

  return probes;
}

function getSceneCalibrationMicroOffsets(calibration: StartupPlayerTileCalibration): Array<{ x: number; y: number }> {
  const scale = getCurrentSceneScaleRelativeTo125(calibration);
  const step = Math.max(3, Math.round(SCENE_CALIBRATION_MICRO_OFFSET_PX_AT_125 * scale));
  return [
    { x: 0, y: 0 },
    { x: 0, y: -step },
    { x: step, y: 0 },
    { x: -step, y: 0 },
    { x: 0, y: step },
  ].slice(0, SCENE_CALIBRATION_MAX_PROBES_PER_TILE);
}

function getMouseCoordinateCropBounds(
  point: ScreenPoint,
  calibration: StartupPlayerTileCalibration,
): { x: number; y: number; width: number; height: number } {
  const scale = getCurrentSceneScaleRelativeTo125(calibration);
  const capture = calibration.captureBounds;
  const width = Math.min(capture.width, Math.max(120, Math.round(SCENE_MOUSE_COORDINATE_CROP_WIDTH_AT_125_PX * scale)));
  const height = Math.min(
    capture.height,
    Math.max(90, Math.round(SCENE_MOUSE_COORDINATE_CROP_HEIGHT_AT_125_PX * scale)),
  );
  const leftOffset = Math.round(SCENE_MOUSE_COORDINATE_CROP_LEFT_AT_125_PX * scale);
  const topOffset = Math.round(SCENE_MOUSE_COORDINATE_CROP_TOP_AT_125_PX * scale);
  const minX = capture.x;
  const minY = capture.y;
  const maxX = capture.x + capture.width - width;
  const maxY = capture.y + capture.height - height;

  return {
    x: clamp(point.x - leftOffset, minX, Math.max(minX, maxX)),
    y: clamp(point.y - topOffset, minY, Math.max(minY, maxY)),
    width,
    height,
  };
}

function buildSceneMouseCalibrationDebugPath(point: ScreenPoint, probeIndex: number, offsetIndex: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    SCENE_MOUSE_DEBUG_DIR,
    `${timestamp}-scene-mouse-calibration-probe-${probeIndex + 1}-${offsetIndex + 1}-mouse-${point.x}-${point.y}.png`,
  );
}

async function readSceneMouseCoordinateAtPoint(
  point: ScreenPoint,
  calibration: StartupPlayerTileCalibration,
  probeIndex: number,
  offsetIndex: number,
): Promise<SceneMouseCoordinateProbe> {
  const cropBounds = getMouseCoordinateCropBounds(point, calibration);
  const bitmap = captureScreenBitmap(cropBounds);
  const debugPath = buildSceneMouseCalibrationDebugPath(point, probeIndex, offsetIndex);
  try {
    await saveBitmapAsync(bitmap, debugPath);
  } catch {
    // Debug screenshots are best-effort only.
  }

  const box = detectOverlayBoxInScreenshot(bitmap, calibration.windowsScalePercent, {
    allowCompactSingleLine: true,
    leftStripRatio: 1,
    requireRuneLiteCoordinatePattern: true,
  });
  const tile = box ? parseWorldTileFromMatchedLine(box.matchedLine) : null;
  if (!box || !tile) {
    return { read: null, debugPath };
  }

  return {
    read: {
      tile,
      line: box.matchedLine,
    },
    debugPath,
  };
}

function isDuplicateSample(
  samples: readonly EndToEndSceneMouseCalibrationSample[],
  sample: EndToEndSceneMouseCalibrationSample,
): boolean {
  return samples.some(
    (existing) =>
      existing.z === sample.z &&
      (existing.tileX === sample.tileX && existing.tileY === sample.tileY
        ? true
        : Math.hypot(existing.localX - sample.localX, existing.localY - sample.localY) <= 3),
  );
}

function buildSample(
  calibration: StartupPlayerTileCalibration,
  point: ScreenPoint,
  read: SceneMouseCoordinateRead,
  source: string,
): EndToEndSceneMouseCalibrationSample | null {
  const playerTile = calibration.playerTile;
  if (!playerTile || read.tile.z !== playerTile.z) {
    return null;
  }

  const localPoint = screenPointToLocal(calibration, point);
  if (!isLocalPointInsideScene(calibration, localPoint, SCENE_CALIBRATION_SAFE_EDGE_MARGIN_PX)) {
    return null;
  }

  const dxTiles = read.tile.x - playerTile.x;
  const dyTiles = read.tile.y - playerTile.y;
  if (Math.abs(dxTiles) > SCENE_CALIBRATION_MAX_DELTA_TILES || Math.abs(dyTiles) > SCENE_CALIBRATION_MAX_DELTA_TILES) {
    return null;
  }

  return {
    localX: Math.round(localPoint.x),
    localY: Math.round(localPoint.y),
    dxTiles,
    dyTiles,
    tileX: read.tile.x,
    tileY: read.tile.y,
    z: read.tile.z,
    source,
    createdAt: new Date().toISOString(),
  };
}

function saveSceneMouseCalibration(
  calibration: StartupPlayerTileCalibration,
  samples: EndToEndSceneMouseCalibrationSample[],
  fit: EndToEndSceneMouseCalibrationFit | null,
): void {
  saveSharedSceneMouseCalibration(calibration, samples.slice(-SCENE_MOUSE_CALIBRATION_MAX_SAMPLES), fit);
}

function formatSample(sample: EndToEndSceneMouseCalibrationSample): string {
  return `tile=${sample.tileX},${sample.tileY},${sample.z} delta=${sample.dxTiles},${sample.dyTiles} local=${sample.localX},${sample.localY}`;
}

export async function runSceneMouseAutoCalibration(
  window: Window,
  options: SceneMouseAutoCalibrationOptions = {},
): Promise<SceneMouseAutoCalibrationResult> {
  const log = options.log ?? (() => undefined);
  const source = options.source ?? "automate-button-calibration";
  const calibration = readStartupPlayerTileCalibration(window, {
    requireRuneLiteCoordinatePattern: true,
  });
  if (!calibration) {
    const error = "startup calibration could not resolve RuneLite capture bounds";
    log(`3D scene calibration startup failed: ${error}.`);
    return {
      ok: false,
      error,
      sampleCount: 0,
      fit: null,
      accepted: false,
    };
  }

  log(formatStartupPlayerTileCalibrationLog("Calibration", calibration));

  if (!calibration.playerTile) {
    const error = `startup calibration could not read the player tile; coordinate=${calibration.coordinateLine ?? "unavailable"} debug=${calibration.coordinateDebugPath ?? "none"}`;
    log(
      `3D scene calibration startup failed: ${error} rejected=${
        calibration.rejectedCoordinateLine
          ? `'${calibration.rejectedCoordinateLine}' reason=${calibration.coordinateRejectReason ?? "unknown"}`
          : "none"
      } attempts=${calibration.coordinateReadAttempts.join(" | ") || "none"}.`,
    );
    return {
      ok: false,
      error,
      sampleCount: 0,
      fit: null,
      accepted: false,
    };
  }

  const playerTile = calibration.playerTile;
  const scene = getSceneBounds(calibration);
  const safeEdgeMarginPx = getSceneTargetEdgeMarginPx(calibration);
  const microOffsets = getSceneCalibrationMicroOffsets(calibration);
  log(
    `3D scene calibration startup: playerTile=${playerTile.x},${playerTile.y},${playerTile.z} profile=${getSceneMouseCalibrationProfileKey(
      calibration,
    )} coordinate='${
      calibration.coordinateLine ?? "unavailable"
    }' coordinateSource=${calibration.coordinateReadSource ?? "unavailable"} tilePx=${calibration.tilePx}px rawTilePx=${
      calibration.rawTilePx ?? "unavailable"
    } tilePxSource=${calibration.tilePxSource} capture=${calibration.captureBounds.width}x${
      calibration.captureBounds.height
    }@${calibration.captureBounds.x},${calibration.captureBounds.y} window=${calibration.windowBounds.width}x${
      calibration.windowBounds.height
    }@${calibration.windowBounds.x},${calibration.windowBounds.y} scale=${calibration.windowsScalePercent}% compass=${
      calibration.compassNorth
        ? `${calibration.compassNorth.northVectorX.toFixed(2)},${calibration.compassNorth.northVectorY.toFixed(
            2,
          )}/confidence=${calibration.compassNorth.confidence.toFixed(2)}`
        : "unavailable"
    }.`,
  );
  log(
    `3D scene calibration scene bounds: local=${scene.left},${scene.top}-${scene.right},${
      scene.bottom
    } targetEdgeMargin=${safeEdgeMarginPx}px microOffsets=${microOffsets.map((offset) => `${offset.x},${offset.y}`).join("|")}.`,
  );

  const probes = selectSceneCalibrationProbes(calibration, playerTile);
  if (probes.length < SCENE_MOUSE_CALIBRATION_MIN_SAMPLES) {
    log(
      `3D scene calibration failed before sampling: not enough visible scene probes (${probes.length}/${SCENE_MOUSE_CALIBRATION_MIN_SAMPLES}).`,
    );
    return {
      ok: false,
      error: `not enough visible scene probes (${probes.length}) for 3D calibration`,
      sampleCount: 0,
      fit: null,
      accepted: false,
    };
  }

  log(
    `3D scene calibration probes selected: count=${probes.length} edgeProbes=${probes.filter((probe) =>
      probe.label.startsWith("scene-"),
    ).length} centerProbes=${probes.filter((probe) => !probe.label.startsWith("scene-")).length} probes=${probes
      .map((probe, index) => `#${index + 1}:${probe.label}@${probe.point.x},${probe.point.y}`)
      .join("|")}.`,
  );

  const samples: EndToEndSceneMouseCalibrationSample[] = [];
  const probeSummaries: string[] = [];

  for (let probeIndex = 0; probeIndex < probes.length; probeIndex += 1) {
    const probe = probes[probeIndex];
    const attempts: string[] = [];
    log(`3D scene calibration probe #${probeIndex + 1}/${probes.length}: ${probe.label} start=${probe.point.x},${probe.point.y}.`);
    for (let offsetIndex = 0; offsetIndex < microOffsets.length; offsetIndex += 1) {
      const offset = microOffsets[offsetIndex];
      const point = getSafeScreenPoint(
        probe.point.x + offset.x,
        probe.point.y + offset.y,
        calibration.captureBounds,
        SCENE_CALIBRATION_SAFE_EDGE_MARGIN_PX,
      );
      await moveMouseHumanLike(point.x, point.y, calibration.captureBounds, {
        safeEdgeMarginPx: SCENE_CALIBRATION_SAFE_EDGE_MARGIN_PX,
        minDurationMs: SCENE_CALIBRATION_MOUSE_MOVE_MIN_MS,
        maxDurationMs: SCENE_CALIBRATION_MOUSE_MOVE_MAX_MS,
        jitterPx: SCENE_CALIBRATION_MOUSE_MOVE_JITTER_PX,
        overshootChance: SCENE_CALIBRATION_MOUSE_MOVE_OVERSHOOT_CHANCE,
      });
      await sleep(randomIntInclusive(SCENE_CALIBRATION_HOVER_SETTLE_MIN_MS, SCENE_CALIBRATION_HOVER_SETTLE_MAX_MS));

      const read = await readSceneMouseCoordinateAtPoint(point, calibration, probeIndex, offsetIndex);
      if (!read.read) {
        attempts.push(`off=${offset.x},${offset.y}:no-read img=${path.basename(read.debugPath)}`);
        log(
          `3D scene calibration probe #${probeIndex + 1} attempt #${offsetIndex + 1}: point=${point.x},${
            point.y
          } offset=${offset.x},${offset.y} result=no-read img=${path.basename(read.debugPath)}.`,
        );
        continue;
      }

      const sample = buildSample(calibration, point, read.read, source);
      if (!sample) {
        attempts.push(`off=${offset.x},${offset.y}:hover=${read.read.line}/rejected img=${path.basename(read.debugPath)}`);
        log(
          `3D scene calibration probe #${probeIndex + 1} attempt #${offsetIndex + 1}: point=${point.x},${
            point.y
          } offset=${offset.x},${offset.y} hover='${read.read.line}' result=rejected img=${path.basename(
            read.debugPath,
          )}.`,
        );
        continue;
      }

      if (isDuplicateSample(samples, sample)) {
        attempts.push(
          `off=${offset.x},${offset.y}:hover=${read.read.line}/duplicate ${formatSample(sample)} img=${path.basename(
            read.debugPath,
          )}`,
        );
        log(
          `3D scene calibration probe #${probeIndex + 1} attempt #${offsetIndex + 1}: point=${point.x},${
            point.y
          } offset=${offset.x},${offset.y} hover='${read.read.line}' result=duplicate ${formatSample(
            sample,
          )} img=${path.basename(read.debugPath)}.`,
        );
        continue;
      }

      samples.push(sample);
      attempts.push(
        `off=${offset.x},${offset.y}:hover=${read.read.line}/saved ${formatSample(sample)} img=${path.basename(
          read.debugPath,
        )}`,
      );
      log(
        `3D scene calibration probe #${probeIndex + 1} attempt #${offsetIndex + 1}: point=${point.x},${
          point.y
        } offset=${offset.x},${offset.y} hover='${read.read.line}' result=saved sample=${samples.length} ${formatSample(
          sample,
        )} img=${path.basename(read.debugPath)}.`,
      );
      break;
    }

    if (attempts.length === 0) {
      log(`3D scene calibration probe #${probeIndex + 1}: no attempts recorded.`);
    }
    probeSummaries.push(`#${probeIndex + 1}:${probe.label} attempts=[${attempts.join("|") || "none"}]`);
  }

  const fit = fitSceneMouseCalibrationSamples(samples);
  const accepted = isSceneMouseCalibrationProjectiveFitAcceptable(fit?.projective ?? null);
  if (samples.length >= SCENE_MOUSE_CALIBRATION_MIN_SAMPLES) {
    saveSceneMouseCalibration(calibration, samples, fit);
    log(
      `3D scene calibration saved: samples=${samples.length} accepted=${accepted ? "yes" : "no"} ${formatSceneMouseCalibrationFit(
        fit,
      )}.`,
    );
  } else {
    log(
      `3D scene calibration not saved: samples=${samples.length}/${SCENE_MOUSE_CALIBRATION_MIN_SAMPLES} ${formatSceneMouseCalibrationFit(
        fit,
      )}.`,
    );
  }

  log(
    `3D scene calibration result: samples=${samples.length} accepted=${accepted ? "yes" : "no"} ${formatSceneMouseCalibrationFit(
      fit,
    )} probes=${probeSummaries.join("; ") || "none"}.`,
  );

  if (accepted) {
    return {
      ok: true,
      sampleCount: samples.length,
      fit,
      accepted,
    };
  }

  const error =
    samples.length < SCENE_MOUSE_CALIBRATION_MIN_SAMPLES
      ? `not enough Tile Location samples (${samples.length}/${SCENE_MOUSE_CALIBRATION_MIN_SAMPLES})`
      : `3D calibration fit rejected (${formatSceneMouseCalibrationFit(fit)})`;
  return {
    ok: false,
    error,
    sampleCount: samples.length,
    fit,
    accepted,
  };
}
