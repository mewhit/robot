import path from "path";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { getSavedArceuusBloodRuneConfig } from "../csvOperator";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { focusRuneLiteWindowForAutomation, getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap, type ScreenBitmap } from "../windowsScreenCapture";
import { readOsrsCacheMapRegionView, type OsrsCacheMapObject } from "./cache/cache-map-view";
import {
  RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID,
  RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS,
} from "./definitions";
import { sleepWithAbort } from "./engine/bot-engine";
import { deriveWorldTile, type WorldTile } from "./mapping/world-coordinate";
import {
  fetchRuneLiteLocalApiSnapshot,
  formatRuneLiteLocalApiSnapshot,
  type RuneLiteLocalApiItem,
  type RuneLiteLocalApiSnapshot,
} from "./runelite-local-api/runelite-local-api";
import {
  detectArceuusDenseRunestones,
  pickNearestActiveArceuusDenseRunestone,
  type ArceuusDenseRunestone,
} from "./shared/arceuus-dense-runestone-detector";
import {
  detectGreenOutlines,
  detectGreenOutlinesNearPoint,
  formatGreenOutline,
  pickNearestGreenOutlineToPoint,
  type GreenOutlineDetection,
} from "./shared/green-outline-detector";
import { detectMiningBoxStatusInScreenshot, type MiningBoxStatusDetection } from "./shared/mining-box-status-detector";
import {
  saveBitmapWithDebugOverlay,
  type DebugOverlayShape,
} from "./shared/debug-image-overlay";
import {
  detectInventoryPanelInScreenshot,
  formatInventoryPanelDetection,
  getInventoryPanelSlot,
  type InventoryPanelSlot,
} from "./shared/inventory-panel-detector";
import {
  clamp,
  pickBoxInteractionScreenPoint,
  randomIntInclusive,
  ticksToMs,
} from "./shared/osrs-helper";
import { clickScreenPoint, moveMouseHumanLike, type ScreenPoint } from "./shared/robot-clicker";
import {
  formatRuneLitePluginPreflightChecks,
  runArceuusBloodRuneV2PluginPreflight,
} from "./shared/runelite-plugin-preflight";
import { holdRobotKey } from "./shared/robot-keyboard";
import { readStartupPlayerTileCalibration, type StartupPlayerTileCalibration } from "./shared/startup-calibration";
import {
  buildWorldRouteAgilityContext,
  formatWorldRouteAgilityShortcutSummary,
  formatWorldRouteAgilityShortcutTarget,
  type WorldRouteAgilityContext,
  type WorldRouteAgilityShortcutTarget,
} from "./shared/world-route-agility-shortcuts";
import {
  buildWorldRouteCandidateTilesAround,
  buildWorldRouteRectanglePerimeterTiles,
  formatWorldRoutePath,
  formatWorldRoutePlan,
  formatWorldTile,
  getWorldTileChebyshevDistance,
  getWorldTileDistanceToRectangle,
  isSameWorldTile,
  isWorldTileInsideRectangle,
  planWorldRouteToTiles,
  rebaseWorldRoutePlanFromTile,
  type WorldRoutePlan,
  type WorldRouteRectangle,
  type WorldRouteTile,
} from "./shared/world-route-planner";

const BOT_NAME = "Runecrafting Arceuus Blood Rune V2";
const STEP_MINE_ID = RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[1].id;
const STEP_ALTAR_TRAVEL_ID = RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[2].id;
const STEP_CHISEL_DARK_ESSENCE_ID = RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[3].id;
const STEP_RE_MINE_ID = RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[4].id;
const STEP_DARK_ALTAR_SECOND_ID = RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[5].id;
const STEP_BLOOD_ALTAR_ID = RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[6].id;
const STEP_CHISEL_BLOOD_ALTAR_ID = RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[7].id;
const BOT_TICK_MS = 200;
const GAME_TICK_MS = 600;
const INVENTORY_TOTAL_SLOTS = 28;
const INVENTORY_GRID_COLUMNS = 4;
const INVENTORY_USE_CLICK_GAP_MS = 180;
const ARCEUUS_CHISEL_ITEM_ID = 1755;
const ARCEUUS_MINING_INVENTORY_CHECK_INTERVAL_MS = GAME_TICK_MS * 2;
const ARCEUUS_MINING_OBJECT_CLICK_DISTANCE_TILES = 1;
const ARCEUUS_MINING_ROUTE_WAYPOINT_STEP_LIMIT = 24;
const ARCEUUS_MINING_CLICK_CONFIRM_MS = 700;
const ARCEUUS_MINING_CLICK_CONFIRM_ATTEMPTS = 5;
const ARCEUUS_ROUTE_PROJECTED_CLICK_MAX_PATH_TILES = 6;
const ARCEUUS_ALTAR_SHORTCUT_CLICK_DISTANCE_TILES = 2;
const ARCEUUS_ALTAR_SHORTCUT_GREEN_OUTLINE_MAX_DISTANCE_PX = 150;
const ARCEUUS_ALTAR_SHORTCUT_WAIT_TICKS = 8;
const ARCEUUS_ALTAR_SHORTCUT_CAMERA_SEARCH_DISTANCE_TILES = 6;
const ARCEUUS_ALTAR_SHORTCUT_CAMERA_ROTATE_HOLD_MS_MIN = 135;
const ARCEUUS_ALTAR_SHORTCUT_CAMERA_ROTATE_HOLD_MS_MAX = 240;
const ARCEUUS_ALTAR_SHORTCUT_CAMERA_SETTLE_MS = 180;
const ARCEUUS_ALTAR_ROUTE_WAYPOINT_STEP_LIMIT = 14;
const ARCEUUS_ALTAR_MINIMAP_ROUTE_WAYPOINT_STEP_LIMIT = 24;
const ARCEUUS_ALTAR_ROUTE_TARGET_RADIUS_TILES = 5;
const ARCEUUS_ALTAR_REACHED_DISTANCE_TILES = 5;
const ARCEUUS_DARK_ALTAR_OBJECT_ID = 27979;
const ARCEUUS_DARK_ALTAR_CLICK_DISTANCE_TILES = 3;
const ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS = 8;
const ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_MS = GAME_TICK_MS;
const ARCEUUS_BLOOD_ALTAR_OBJECT_ID = 27978;
const ARCEUUS_BLOOD_ALTAR_CLICK_DISTANCE_TILES = 3;
const ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_ATTEMPTS = 8;
const ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_MS = GAME_TICK_MS;
const ARCEUUS_DARK_ESSENCE_CHISEL_WAIT_MS = GAME_TICK_MS * 3;
const ARCEUUS_DARK_ESSENCE_CHISEL_CLICK_INNER_RATIO = 0.7;
const ARCEUUS_MINIMAP_PLAYER_CENTER_RIGHT_OFFSET_LOGICAL = 122;
const ARCEUUS_MINIMAP_PLAYER_CENTER_Y_LOGICAL = 84;
const ARCEUUS_MINIMAP_PLAYER_CENTER_FROM_COMPASS_X_LOGICAL = 88;
const ARCEUUS_MINIMAP_PLAYER_CENTER_FROM_COMPASS_Y_LOGICAL = 35;
const ARCEUUS_MINIMAP_RADIUS_LOGICAL = 73;
const ARCEUUS_MINIMAP_TILE_PX_LOGICAL = 4;
const ARCEUUS_MINIMAP_MAX_CLICK_RADIUS_RATIO = 0.74;
const ARCEUUS_MINIMAP_LEARN_TILE_SCALE_MIN = 0.9;
const ARCEUUS_MINIMAP_LEARN_TILE_SCALE_MAX = 1.14;
const ARCEUUS_MINIMAP_LEARN_RADIUS_RATIO_MIN = 0.66;
const ARCEUUS_MINIMAP_LEARN_RADIUS_RATIO_MAX = 0.88;
const ARCEUUS_MINIMAP_LEARN_PENDING_EXPIRE_MS = 18_000;
const ARCEUUS_MINIMAP_LEARN_MAX_PATH_DISTANCE_TILES = 3;
const ARCEUUS_MINIMAP_EDGE_CENTER_SEARCH_X_LOGICAL = 34;
const ARCEUUS_MINIMAP_EDGE_CENTER_SEARCH_Y_LOGICAL = 28;
const ARCEUUS_MINIMAP_EDGE_RADIUS_SEARCH_LOGICAL = 16;
const ARCEUUS_MINIMAP_EDGE_COARSE_STEP_PX = 3;
const ARCEUUS_MINIMAP_EDGE_SAMPLE_COUNT = 72;
const ARCEUUS_MINIMAP_EDGE_MIN_SCORE = 0.42;
const ARCEUUS_V2_CLICK_DEBUG_IMAGE_DIR = path.join("test-image-debug", "arceuus-v2-clicks");
const ARCEUUS_V2_CLICK_DEBUG_COMPASS_VECTOR_PX = 55;
const ARCEUUS_DARK_ALTAR_TARGET_TILE = { x: 1717, y: 3882, z: 0 } as const;
const ARCEUUS_DARK_ALTAR_FALLBACK_TARGET = {
  id: ARCEUUS_DARK_ALTAR_OBJECT_ID,
  x: 1715,
  y: 3882,
  z: 0,
  width: 3,
  height: 3,
  label: "dark altar fallback",
} as const;
const ARCEUUS_BLOOD_ALTAR_TARGET_TILE = { x: 1717, y: 3830, z: 0 } as const;
const ARCEUUS_BLOOD_ALTAR_FALLBACK_TARGET = {
  id: ARCEUUS_BLOOD_ALTAR_OBJECT_ID,
  x: 1715,
  y: 3828,
  z: 0,
  width: 4,
  height: 4,
  label: "blood altar fallback",
} as const;
const ARCEUUS_DENSE_ESSENCE_BLOCK_ITEM_ID = 13445;
const ARCEUUS_DARK_ESSENCE_BLOCK_ITEM_ID = 13446;
const ARCEUUS_DARK_ESSENCE_FRAGMENTS_ITEM_ID = 7938;
const ARCEUUS_BLOOD_RUNE_ITEM_ID = 565;
const ARCEUUS_MINING_OBJECT_IDS = new Set([10796, 8981]);
const ARCEUUS_MINING_TARGET_ANCHORS = [
  { x: 1764, y: 3858, z: 0, label: "north dense runestone" },
  { x: 1764, y: 3846, z: 0, label: "south dense runestone" },
] as const;
const ARCEUUS_MINING_FALLBACK_TARGETS = [
  { id: 8981, x: 1762, y: 3856, z: 0, width: 5, height: 5, label: "north dense runestone fallback" },
  { id: 10796, x: 1762, y: 3844, z: 0, width: 5, height: 5, label: "south dense runestone fallback" },
] as const;

type ArceuusBloodRuneV2Step = (typeof RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS)[number];
type ArceuusBloodRuneV2StepId = ArceuusBloodRuneV2Step["id"];
type StepHandlerResult = {
  nextStepId?: ArceuusBloodRuneV2StepId | null;
  stop?: boolean;
};
type StepHandler = (
  step: ArceuusBloodRuneV2Step,
) => Promise<StepHandlerResult | void> | StepHandlerResult | void;
type ArceuusMiningObjectTarget = {
  id: number;
  label: string;
  rectangle: WorldRouteRectangle;
  centerTile: WorldRouteTile;
  interactionTiles: WorldRouteTile[];
};

type ArceuusAltarRouteClickResult =
  | { status: "clicked"; route: WorldRoutePlan; shortcutTarget?: WorldRouteAgilityShortcutTarget }
  | { status: "missing-shortcut-green"; route: WorldRoutePlan; shortcutTarget: WorldRouteAgilityShortcutTarget; distanceToShortcut: number }
  | { status: "unavailable"; route: WorldRoutePlan | null };

type ArceuusRoutePlanCache = {
  key: string | null;
  route: WorldRoutePlan | null;
  reuseCount: number;
  planCount: number;
};

type ArceuusDarkAltarTarget = {
  id: number;
  label: string;
  rectangle: WorldRouteRectangle;
  clickTile: WorldRouteTile;
  interactionTiles: WorldRouteTile[];
};

type ArceuusBloodAltarTarget = {
  id: number;
  label: string;
  rectangle: WorldRouteRectangle;
  clickTile: WorldRouteTile;
  interactionTiles: WorldRouteTile[];
};

type ArceuusMiningTick = {
  calibration: StartupPlayerTileCalibration;
  bitmap: ScreenBitmap;
  apiSnapshot: RuneLiteLocalApiSnapshot | null;
  playerTile: WorldTile | null;
  miningStatus: MiningBoxStatusDetection;
  visibleTarget: ArceuusDenseRunestone | null;
  greenOutlines: GreenOutlineDetection[];
};

type ArceuusAltarTravelTick = {
  calibration: StartupPlayerTileCalibration;
  bitmap: ScreenBitmap;
  apiSnapshot: RuneLiteLocalApiSnapshot | null;
  playerTile: WorldTile | null;
  greenOutlines: GreenOutlineDetection[];
};

type ArceuusMinimapSource = "detected-from-edge" | "inferred-from-compass" | "inferred-from-capture";

type ArceuusMinimapGeometry = {
  centerLocalX: number;
  centerLocalY: number;
  radiusPx: number;
  tilePx: number;
  source: ArceuusMinimapSource;
  detectionScore: number | null;
  expectedCenterLocalX: number;
  expectedCenterLocalY: number;
  expectedRadiusPx: number;
};

type ArceuusMinimapEdgeDetection = {
  centerLocalX: number;
  centerLocalY: number;
  radiusPx: number;
  score: number;
};

type ArceuusMinimapClickPlan = {
  screenPoint: ScreenPoint;
  projectedScreenPoint: ScreenPoint;
  minimapCenter: ScreenPoint;
  expectedMinimapCenter: ScreenPoint;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  pathTiles: number;
  minimapRadiusPx: number;
  expectedMinimapRadiusPx: number;
  minimapTilePx: number;
  effectiveMinimapTilePx: number;
  learnedTilePxScale: number;
  learnedRadiusRatio: number;
  maxClickDistancePx: number;
  wasVectorClamped: boolean;
  minimapSource: ArceuusMinimapSource;
  minimapDetectionScore: number | null;
  projectionSource: "compass-rotated" | "north-up-fallback";
};

type ArceuusMinimapMovementPendingSample = {
  id: number;
  stepLabel: string;
  destinationLabel: string;
  startTile: WorldRouteTile;
  waypointTile: WorldRouteTile;
  routePathTiles: WorldRouteTile[];
  pathStep: number;
  pathLength: number;
  waitPathTiles: number;
  estimatedRunTicks: number;
  estimatedWalkTicks: number;
  waitMs: number;
  clickedAtMs: number;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  clickVectorX: number;
  clickVectorY: number;
  minimapTilePx: number;
  effectiveMinimapTilePx: number;
  tilePxScaleBefore: number;
  radiusRatioBefore: number;
  wasVectorClamped: boolean;
  minimapSource: ArceuusMinimapSource;
  projectionSource: "compass-rotated" | "north-up-fallback";
  debugPath: string | null;
};

type ArceuusMinimapMovementLearningState = {
  nextSampleId: number;
  pending: ArceuusMinimapMovementPendingSample | null;
  tilePxScale: number;
  radiusRatio: number;
  acceptedSamples: number;
  rejectedSamples: number;
};

type ArceuusInventoryStatus = {
  snapshot: RuneLiteLocalApiSnapshot;
  occupiedSlots: number;
  freeSlots: number;
  isFull: boolean;
  checkedAtMs: number;
};

type ArceuusAltarInventoryStatus = {
  snapshot: RuneLiteLocalApiSnapshot;
  occupiedSlots: number;
  freeSlots: number;
  chisel: RuneLiteLocalApiItem | null;
  denseBlocks: RuneLiteLocalApiItem[];
  darkBlocks: RuneLiteLocalApiItem[];
  darkFragments: RuneLiteLocalApiItem[];
  bloodRunes: RuneLiteLocalApiItem[];
  checkedAtMs: number;
};

const stepById = new Map<ArceuusBloodRuneV2StepId, ArceuusBloodRuneV2Step>(
  RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS.map((step) => [
    step.id,
    step,
  ] as [ArceuusBloodRuneV2StepId, ArceuusBloodRuneV2Step]),
);

// Add implemented v2 step handlers here. Any missing handler intentionally stops the bot.
const stepHandlers: Partial<Record<ArceuusBloodRuneV2StepId, StepHandler>> = {
  [STEP_MINE_ID]: runMiningStep,
  [STEP_ALTAR_TRAVEL_ID]: runAltarTravelStep,
  [STEP_CHISEL_DARK_ESSENCE_ID]: runChiselDarkEssenceStep,
  [STEP_RE_MINE_ID]: runReMineStep,
  [STEP_DARK_ALTAR_SECOND_ID]: runSecondDarkAltarStep,
  [STEP_BLOOD_ALTAR_ID]: runBloodAltarTravelStep,
  [STEP_CHISEL_BLOOD_ALTAR_ID]: runChiselBloodAltarStep,
};

let isArceuusV2LoopRunning = false;
let arceuusV2StartedAtMs: number | null = null;
let cachedMiningTargets: ArceuusMiningObjectTarget[] | null = null;
let cachedDarkAltarTarget: ArceuusDarkAltarTarget | null = null;
let cachedBloodAltarTarget: ArceuusBloodAltarTarget | null = null;
let arceuusV2ClickDebugImageIndex = 0;
let arceuusMinimapMovementLearning = createArceuusMinimapMovementLearningState();

function toClickDebugLabel(stepLabel: string, suffix: string): string {
  const stepToken = stepLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${stepToken}-${suffix}`;
}

function formatElapsedSinceStart(): string {
  if (arceuusV2StartedAtMs === null) {
    return "+0ms";
  }

  const elapsedMs = Math.max(0, Date.now() - arceuusV2StartedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = elapsedMs % 1000;

  return `+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function logWithDelta(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] Automate Bot (${BOT_NAME}): ${message}`);
}

function warnWithDelta(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] Automate Bot (${BOT_NAME}): ${message}`);
}

function sanitizeDebugImageLabel(label: string): string {
  const safe = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "click";
}

function buildClickDebugImagePath(label: string): string {
  arceuusV2ClickDebugImageIndex += 1;
  const index = String(arceuusV2ClickDebugImageIndex).padStart(4, "0");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(ARCEUUS_V2_CLICK_DEBUG_IMAGE_DIR, `${index}-${timestamp}-${sanitizeDebugImageLabel(label)}.png`);
}

function screenPointToLocal(calibration: StartupPlayerTileCalibration, point: ScreenPoint): ScreenPoint {
  return {
    x: point.x - calibration.captureBounds.x,
    y: point.y - calibration.captureBounds.y,
  };
}

function createArceuusMinimapMovementLearningState(): ArceuusMinimapMovementLearningState {
  return {
    nextSampleId: 1,
    pending: null,
    tilePxScale: 1,
    radiusRatio: ARCEUUS_MINIMAP_MAX_CLICK_RADIUS_RATIO,
    acceptedSamples: 0,
    rejectedSamples: 0,
  };
}

function resetArceuusMinimapMovementLearning(reason: string): void {
  arceuusMinimapMovementLearning = createArceuusMinimapMovementLearningState();
  logWithDelta(
    `Movement learn reset: reason=${reason} tilePxScale=${arceuusMinimapMovementLearning.tilePxScale.toFixed(3)} radiusRatio=${arceuusMinimapMovementLearning.radiusRatio.toFixed(3)}.`,
  );
}

function getNearestRoutePathIndex(
  tile: WorldRouteTile,
  pathTiles: readonly WorldRouteTile[],
): { index: number; distance: number; exact: boolean } {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pathTiles.length; index += 1) {
    const candidate = pathTiles[index];
    const distance = candidate.z === tile.z ? getWorldTileChebyshevDistance(tile, candidate) : Number.POSITIVE_INFINITY;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
      if (distance === 0) {
        break;
      }
    }
  }

  return {
    index: bestIndex,
    distance: bestDistance,
    exact: bestIndex >= 0 && isSameWorldTile(tile, pathTiles[bestIndex]),
  };
}

function formatMovementSpeedMode(tilesPerTick: number): string {
  if (!Number.isFinite(tilesPerTick) || tilesPerTick < 0.2) {
    return "stuck";
  }

  if (tilesPerTick >= 1.45) {
    return "run";
  }

  if (tilesPerTick >= 0.65) {
    return "walk";
  }

  return "slow";
}

function registerArceuusMinimapMovementSample(params: Omit<ArceuusMinimapMovementPendingSample, "id">): void {
  const state = arceuusMinimapMovementLearning;
  if (state.pending) {
    state.rejectedSamples += 1;
    warnWithDelta(
      `Movement learn sample ${state.pending.id}: rejected reason=overwritten pendingStep='${state.pending.stepLabel}' start=${formatWorldTile(
        state.pending.startTile,
      )} waypoint=${formatWorldTile(state.pending.waypointTile)}.`,
    );
  }

  const id = state.nextSampleId;
  state.nextSampleId += 1;
  state.pending = { id, ...params };
  logWithDelta(
    `Movement learn sample ${id}: pending step='${params.stepLabel}' destination='${params.destinationLabel}' start=${formatWorldTile(
      params.startTile,
    )} waypoint=${formatWorldTile(params.waypointTile)} pathStep=${params.pathStep}/${params.pathLength} waitPath=${params.waitPathTiles} estimatedRunTicks=${params.estimatedRunTicks} estimatedWalkTicks=${params.estimatedWalkTicks} wait=${params.waitMs}ms clickVector=${params.clickVectorX},${params.clickVectorY} tilePx=${params.minimapTilePx}px effectiveTilePx=${params.effectiveMinimapTilePx.toFixed(2)} tilePxScale=${params.tilePxScaleBefore.toFixed(3)} radiusRatio=${params.radiusRatioBefore.toFixed(3)} clamped=${params.wasVectorClamped ? "yes" : "no"} minimap=${params.minimapSource}/${params.projectionSource} debug=${params.debugPath ?? "none"}.`,
  );
}

function observeArceuusMinimapMovement(stepLabel: string, playerTile: WorldRouteTile | null): void {
  const state = arceuusMinimapMovementLearning;
  const pending = state.pending;
  if (!pending) {
    return;
  }

  const elapsedMs = Math.max(0, Date.now() - pending.clickedAtMs);
  if (!playerTile) {
    if (elapsedMs > ARCEUUS_MINIMAP_LEARN_PENDING_EXPIRE_MS) {
      state.pending = null;
      state.rejectedSamples += 1;
      warnWithDelta(`Movement learn sample ${pending.id}: rejected reason=no-player-tile elapsed=${elapsedMs}ms observer='${stepLabel}'.`);
    }
    return;
  }

  const nearest = getNearestRoutePathIndex(playerTile, pending.routePathTiles);
  const actualChebyshevTiles = getWorldTileChebyshevDistance(pending.startTile, playerTile);
  const actualPathTiles =
    nearest.index >= 0 && nearest.distance <= ARCEUUS_MINIMAP_LEARN_MAX_PATH_DISTANCE_TILES
      ? nearest.index
      : actualChebyshevTiles;
  const elapsedTicks = elapsedMs / GAME_TICK_MS;
  const actualTilesPerTick = elapsedTicks > 0 ? actualPathTiles / elapsedTicks : 0;
  const modeEstimate = formatMovementSpeedMode(actualTilesPerTick);
  const expectedRunTiles = Math.min(pending.pathStep, Math.floor(elapsedTicks * 2));
  const expectedWalkTiles = Math.min(pending.pathStep, Math.floor(elapsedTicks));
  const expectedRunError = actualPathTiles - expectedRunTiles;
  const expectedWalkError = actualPathTiles - expectedWalkTiles;
  const progressRatio = expectedRunTiles > 0 ? actualPathTiles / expectedRunTiles : 0;
  const oldTilePxScale = state.tilePxScale;
  const oldRadiusRatio = state.radiusRatio;
  const planeOk = playerTile.z === pending.startTile.z;
  const nearRoute = nearest.index >= 0 && nearest.distance <= ARCEUUS_MINIMAP_LEARN_MAX_PATH_DISTANCE_TILES;
  const expired = elapsedMs > ARCEUUS_MINIMAP_LEARN_PENDING_EXPIRE_MS;
  const usable = planeOk && nearRoute && actualPathTiles > 0 && !expired;
  let adjustmentReason = "rejected";

  if (usable) {
    state.acceptedSamples += 1;
    const underMoved = progressRatio < 0.72 && actualPathTiles < pending.pathStep - 1;
    const overMoved = actualPathTiles > pending.pathStep + 2;
    if (underMoved) {
      if (pending.wasVectorClamped) {
        state.radiusRatio = clamp(state.radiusRatio + 0.015, ARCEUUS_MINIMAP_LEARN_RADIUS_RATIO_MIN, ARCEUUS_MINIMAP_LEARN_RADIUS_RATIO_MAX);
        adjustmentReason = "under-run-increase-radius";
      } else {
        state.tilePxScale = clamp(state.tilePxScale + 0.02, ARCEUUS_MINIMAP_LEARN_TILE_SCALE_MIN, ARCEUUS_MINIMAP_LEARN_TILE_SCALE_MAX);
        adjustmentReason = "under-run-increase-tile-scale";
      }
    } else if (overMoved) {
      if (pending.wasVectorClamped) {
        state.radiusRatio = clamp(state.radiusRatio - 0.01, ARCEUUS_MINIMAP_LEARN_RADIUS_RATIO_MIN, ARCEUUS_MINIMAP_LEARN_RADIUS_RATIO_MAX);
        adjustmentReason = "over-run-decrease-radius";
      } else {
        state.tilePxScale = clamp(state.tilePxScale - 0.015, ARCEUUS_MINIMAP_LEARN_TILE_SCALE_MIN, ARCEUUS_MINIMAP_LEARN_TILE_SCALE_MAX);
        adjustmentReason = "over-run-decrease-tile-scale";
      }
    } else {
      adjustmentReason = "stable";
    }
  } else {
    state.rejectedSamples += 1;
    adjustmentReason = expired
      ? "expired"
      : !planeOk
        ? "plane-changed"
        : !nearRoute
          ? "off-route-rebalanced-too-far"
          : "no-movement";
  }

  state.pending = null;
  logWithDelta(
    `Movement learn sample ${pending.id}: observed step='${pending.stepLabel}' observer='${stepLabel}' accepted=${usable ? "yes" : "no"} reason=${adjustmentReason} start=${formatWorldTile(
      pending.startTile,
    )} waypoint=${formatWorldTile(pending.waypointTile)} actual=${formatWorldTile(playerTile)} actualPath=${actualPathTiles} actualCheb=${actualChebyshevTiles} nearestPathIndex=${nearest.index} nearestPathDistance=${Number.isFinite(nearest.distance) ? nearest.distance : "n/a"} exactPath=${nearest.exact ? "yes" : "no"} expectedRunTiles=${expectedRunTiles} expectedWalkTiles=${expectedWalkTiles} runError=${expectedRunError} walkError=${expectedWalkError} elapsed=${elapsedMs}ms elapsedTicks=${elapsedTicks.toFixed(2)} speed=${actualTilesPerTick.toFixed(2)}tiles/tick mode=${modeEstimate} wait=${pending.waitMs}ms pathStep=${pending.pathStep}/${pending.pathLength} waitPath=${pending.waitPathTiles} clamped=${pending.wasVectorClamped ? "yes" : "no"} tilePxScale=${oldTilePxScale.toFixed(3)}->${state.tilePxScale.toFixed(3)} radiusRatio=${oldRadiusRatio.toFixed(3)}->${state.radiusRatio.toFixed(3)} acceptedSamples=${state.acceptedSamples} rejectedSamples=${state.rejectedSamples}.`,
  );
}

function addCompassDebugOverlay(
  shapes: DebugOverlayShape[],
  calibration: StartupPlayerTileCalibration,
): void {
  const compass = calibration.compassNorth;
  if (!compass) {
    return;
  }

  shapes.push({
    type: "cross",
    x: compass.centerX,
    y: compass.centerY,
    radius: 7,
    color: { r: 64, g: 180, b: 255 },
    thickness: 2,
  });
  shapes.push({
    type: "line",
    x1: compass.centerX,
    y1: compass.centerY,
    x2: compass.centerX + compass.northVectorX * ARCEUUS_V2_CLICK_DEBUG_COMPASS_VECTOR_PX,
    y2: compass.centerY + compass.northVectorY * ARCEUUS_V2_CLICK_DEBUG_COMPASS_VECTOR_PX,
    color: { r: 64, g: 180, b: 255 },
    thickness: 3,
  });
}

function getArceuusBlockedRouteTiles(routeContext: WorldRouteAgilityContext): WorldRouteTile[] {
  return [...routeContext.blockedShortcutTiles];
}

function createArceuusRoutePlanCache(): ArceuusRoutePlanCache {
  return {
    key: null,
    route: null,
    reuseCount: 0,
    planCount: 0,
  };
}

function getRoutePlanTileListKey(tiles: readonly WorldRouteTile[]): string {
  return tiles.map(formatWorldTile).join(";");
}

function getArceuusRoutePlanCacheKey(params: {
  destinationLabel: string;
  destinationTile: WorldRouteTile;
  targetTiles: readonly WorldRouteTile[];
  blockedTiles: readonly WorldRouteTile[];
  routeContext: WorldRouteAgilityContext;
  waypointStepLimit: number;
}): string {
  return [
    params.destinationLabel,
    formatWorldTile(params.destinationTile),
    `waypoint=${params.waypointStepLimit}`,
    `agility=${params.routeContext.agilityLevel}`,
    `targets=${getRoutePlanTileListKey(params.targetTiles)}`,
    `blocked=${getRoutePlanTileListKey(params.blockedTiles)}`,
    `links=${params.routeContext.routeLinks.length}`,
    `available=${formatWorldRouteAgilityShortcutSummary(params.routeContext.availableShortcuts)}`,
    `unavailable=${formatWorldRouteAgilityShortcutSummary(params.routeContext.unavailableShortcuts)}`,
  ].join("|");
}

function getOrPlanArceuusRoute(params: {
  playerTile: WorldTile;
  destinationLabel: string;
  destinationTile: WorldRouteTile;
  targetTiles: readonly WorldRouteTile[];
  routeContext: WorldRouteAgilityContext;
  waypointStepLimit: number;
  routeCache?: ArceuusRoutePlanCache;
}): { route: WorldRoutePlan; cacheStatus: "planned" | "reused" | "replanned"; cacheCount: number } {
  const blockedTiles = getArceuusBlockedRouteTiles(params.routeContext);
  const key = getArceuusRoutePlanCacheKey({
    destinationLabel: params.destinationLabel,
    destinationTile: params.destinationTile,
    targetTiles: params.targetTiles,
    blockedTiles,
    routeContext: params.routeContext,
    waypointStepLimit: params.waypointStepLimit,
  });
  const hadMatchingCache = params.routeCache?.key === key && !!params.routeCache.route;
  if (hadMatchingCache && params.routeCache?.route) {
    const rebasedRoute = rebaseWorldRoutePlanFromTile(params.routeCache.route, params.playerTile, {
      waypointStepLimit: params.waypointStepLimit,
    });
    if (rebasedRoute) {
      params.routeCache.route = rebasedRoute;
      params.routeCache.reuseCount += 1;
      return {
        route: rebasedRoute,
        cacheStatus: "reused",
        cacheCount: params.routeCache.reuseCount,
      };
    }
  }

  const route = planWorldRouteToTiles(params.playerTile, {
    destinationLabel: params.destinationLabel,
    destinationTile: params.destinationTile,
    targetTiles: [...params.targetTiles],
    blockedTiles,
    links: params.routeContext.routeLinks,
    waypointStepLimit: params.waypointStepLimit,
  });
  if (params.routeCache) {
    params.routeCache.key = key;
    params.routeCache.route = route.status === "unavailable" ? null : route;
    params.routeCache.reuseCount = 0;
    params.routeCache.planCount += 1;
    return {
      route,
      cacheStatus: hadMatchingCache ? "replanned" : "planned",
      cacheCount: params.routeCache.planCount,
    };
  }

  return {
    route,
    cacheStatus: "planned",
    cacheCount: 0,
  };
}

async function saveClickDebugImage(
  label: string,
  bitmap: ScreenBitmap,
  shapes: readonly DebugOverlayShape[],
): Promise<string | null> {
  const filePath = buildClickDebugImagePath(label);
  try {
    await saveBitmapWithDebugOverlay(bitmap, filePath, shapes);
    return filePath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`Click debug image save failed: label=${label} path=${filePath} error=${message}.`);
    return null;
  }
}

function errorWithDelta(message: string): void {
  logger.error(`[${formatElapsedSinceStart()}] Automate Bot (${BOT_NAME}): ${message}`);
}

function isArceuusBloodRuneV2StepId(stepId: string): stepId is ArceuusBloodRuneV2StepId {
  return stepById.has(stepId as ArceuusBloodRuneV2StepId);
}

function getDefaultStartStep(): ArceuusBloodRuneV2Step {
  return RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[0];
}

function getFirstAutomationStep(): ArceuusBloodRuneV2Step {
  return RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[1];
}

function getPluginCheckStep(): ArceuusBloodRuneV2Step {
  return RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_STEPS[0];
}

function notifyAutomateBotError(message: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message,
    });
  }
}

function objectFootprintContainsTile(object: Pick<OsrsCacheMapObject, "worldX" | "worldY" | "z" | "sizeX" | "sizeY">, tile: WorldRouteTile): boolean {
  return (
    object.z === tile.z &&
    tile.x >= object.worldX &&
    tile.x <= object.worldX + object.sizeX - 1 &&
    tile.y >= object.worldY &&
    tile.y <= object.worldY + object.sizeY - 1
  );
}

function getObjectDistanceToAnchor(object: Pick<OsrsCacheMapObject, "worldX" | "worldY" | "z" | "sizeX" | "sizeY">, anchor: WorldRouteTile): number {
  return getWorldTileDistanceToRectangle(anchor, {
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: object.sizeX,
    height: object.sizeY,
  });
}

function toMiningTargetFromObject(anchorLabel: string, object: OsrsCacheMapObject): ArceuusMiningObjectTarget {
  const rectangle: WorldRouteRectangle = {
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: object.sizeX,
    height: object.sizeY,
  };
  const centerTile = {
    x: object.worldX + Math.floor(object.sizeX / 2),
    y: object.worldY + Math.floor(object.sizeY / 2),
    z: object.z,
  };

  return {
    id: object.id,
    label: `${anchorLabel} object ${object.id}`,
    rectangle,
    centerTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, ARCEUUS_MINING_OBJECT_CLICK_DISTANCE_TILES),
  };
}

function toMiningTargetFromFallback(target: (typeof ARCEUUS_MINING_FALLBACK_TARGETS)[number]): ArceuusMiningObjectTarget {
  const rectangle: WorldRouteRectangle = {
    x: target.x,
    y: target.y,
    z: target.z,
    width: target.width,
    height: target.height,
  };

  return {
    id: target.id,
    label: target.label,
    rectangle,
    centerTile: {
      x: target.x + Math.floor(target.width / 2),
      y: target.y + Math.floor(target.height / 2),
      z: target.z,
    },
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, ARCEUUS_MINING_OBJECT_CLICK_DISTANCE_TILES),
  };
}

function pickMiningObjectForAnchor(
  objects: readonly OsrsCacheMapObject[],
  anchor: (typeof ARCEUUS_MINING_TARGET_ANCHORS)[number],
): OsrsCacheMapObject | null {
  const containingObjects = objects.filter(
    (object) =>
      object.z === anchor.z &&
      object.sizeX === 5 &&
      object.sizeY === 5 &&
      object.interactType === 1 &&
      objectFootprintContainsTile(object, anchor),
  );
  const nearbyObjects = containingObjects.length > 0
    ? containingObjects
    : objects.filter(
        (object) =>
          object.z === anchor.z &&
          object.sizeX === 5 &&
          object.sizeY === 5 &&
          object.interactType === 1 &&
          getObjectDistanceToAnchor(object, anchor) <= 3,
      );

  return [...nearbyObjects].sort((a, b) => {
    const aKnown = ARCEUUS_MINING_OBJECT_IDS.has(a.id) ? 0 : 1;
    const bKnown = ARCEUUS_MINING_OBJECT_IDS.has(b.id) ? 0 : 1;
    const aDistance = getObjectDistanceToAnchor(a, anchor);
    const bDistance = getObjectDistanceToAnchor(b, anchor);
    return aKnown - bKnown || aDistance - bDistance || a.id - b.id;
  })[0] ?? null;
}

function resolveArceuusMiningTargets(): ArceuusMiningObjectTarget[] {
  if (cachedMiningTargets) {
    return cachedMiningTargets;
  }

  try {
    const targets: ArceuusMiningObjectTarget[] = [];
    const seen = new Set<string>();
    for (const anchor of ARCEUUS_MINING_TARGET_ANCHORS) {
      const view = readOsrsCacheMapRegionView({
        regionX: anchor.x >> 6,
        regionY: anchor.y >> 6,
      });
      const object = pickMiningObjectForAnchor(view.objects, anchor);
      if (!object) {
        continue;
      }

      const key = `${object.id}:${object.worldX}:${object.worldY}:${object.z}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      targets.push(toMiningTargetFromObject(anchor.label, object));
    }

    cachedMiningTargets = targets.length > 0 ? targets : ARCEUUS_MINING_FALLBACK_TARGETS.map(toMiningTargetFromFallback);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`Could not resolve Arceuus mining objects from cache; using hardcoded 5x5 targets. ${message}`);
    cachedMiningTargets = ARCEUUS_MINING_FALLBACK_TARGETS.map(toMiningTargetFromFallback);
  }

  logWithDelta(`Mining targets: ${cachedMiningTargets.map(formatMiningTarget).join("; ")}.`);
  return cachedMiningTargets;
}

function formatMiningTarget(target: ArceuusMiningObjectTarget): string {
  return `${target.label} footprint=${target.rectangle.x},${target.rectangle.y},${target.rectangle.z} ${target.rectangle.width}x${target.rectangle.height} center=${formatWorldTile(target.centerTile)}`;
}

function toDarkAltarTargetFromObject(object: OsrsCacheMapObject): ArceuusDarkAltarTarget {
  const rectangle: WorldRouteRectangle = {
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: object.sizeX,
    height: object.sizeY,
  };
  const clickTile = {
    x: object.worldX + Math.floor(object.sizeX / 2),
    y: object.worldY + Math.floor(object.sizeY / 2),
    z: object.z,
  };

  return {
    id: object.id,
    label: `dark altar object ${object.id}`,
    rectangle,
    clickTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, ARCEUUS_DARK_ALTAR_CLICK_DISTANCE_TILES),
  };
}

function toDarkAltarTargetFromFallback(): ArceuusDarkAltarTarget {
  const target = ARCEUUS_DARK_ALTAR_FALLBACK_TARGET;
  const rectangle: WorldRouteRectangle = {
    x: target.x,
    y: target.y,
    z: target.z,
    width: target.width,
    height: target.height,
  };
  const clickTile = {
    x: target.x + Math.floor(target.width / 2),
    y: target.y + Math.floor(target.height / 2),
    z: target.z,
  };

  return {
    id: target.id,
    label: target.label,
    rectangle,
    clickTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, ARCEUUS_DARK_ALTAR_CLICK_DISTANCE_TILES),
  };
}

function pickDarkAltarObject(objects: readonly OsrsCacheMapObject[]): OsrsCacheMapObject | null {
  return objects
    .filter(
      (object) =>
        object.z === ARCEUUS_DARK_ALTAR_TARGET_TILE.z &&
        getObjectDistanceToAnchor(object, ARCEUUS_DARK_ALTAR_TARGET_TILE) <= 8 &&
        (object.id === ARCEUUS_DARK_ALTAR_OBJECT_ID || object.name.toLowerCase() === "dark altar"),
    )
    .sort((a, b) => {
      const aKnown = a.id === ARCEUUS_DARK_ALTAR_OBJECT_ID ? 0 : 1;
      const bKnown = b.id === ARCEUUS_DARK_ALTAR_OBJECT_ID ? 0 : 1;
      return (
        aKnown - bKnown ||
        getObjectDistanceToAnchor(a, ARCEUUS_DARK_ALTAR_TARGET_TILE) -
          getObjectDistanceToAnchor(b, ARCEUUS_DARK_ALTAR_TARGET_TILE) ||
        a.id - b.id
      );
    })[0] ?? null;
}

function resolveArceuusDarkAltarTarget(): ArceuusDarkAltarTarget {
  if (cachedDarkAltarTarget) {
    return cachedDarkAltarTarget;
  }

  try {
    const view = readOsrsCacheMapRegionView({
      regionX: ARCEUUS_DARK_ALTAR_TARGET_TILE.x >> 6,
      regionY: ARCEUUS_DARK_ALTAR_TARGET_TILE.y >> 6,
    });
    const object = pickDarkAltarObject(view.objects);
    cachedDarkAltarTarget = object ? toDarkAltarTargetFromObject(object) : toDarkAltarTargetFromFallback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`Could not resolve Arceuus dark altar from cache; using hardcoded target. ${message}`);
    cachedDarkAltarTarget = toDarkAltarTargetFromFallback();
  }

  logWithDelta(`Dark altar target: ${formatDarkAltarTarget(cachedDarkAltarTarget)}.`);
  return cachedDarkAltarTarget;
}

function formatDarkAltarTarget(target: ArceuusDarkAltarTarget): string {
  return `${target.label} click=${formatWorldTile(target.clickTile)} footprint=${target.rectangle.x},${target.rectangle.y},${target.rectangle.z} ${target.rectangle.width}x${target.rectangle.height}`;
}

function toBloodAltarTargetFromObject(object: OsrsCacheMapObject): ArceuusBloodAltarTarget {
  const rectangle: WorldRouteRectangle = {
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: object.sizeX,
    height: object.sizeY,
  };
  const clickTile = {
    x: object.worldX + Math.floor(object.sizeX / 2),
    y: object.worldY + Math.floor(object.sizeY / 2),
    z: object.z,
  };

  return {
    id: object.id,
    label: `blood altar object ${object.id}`,
    rectangle,
    clickTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, ARCEUUS_BLOOD_ALTAR_CLICK_DISTANCE_TILES),
  };
}

function toBloodAltarTargetFromFallback(): ArceuusBloodAltarTarget {
  const target = ARCEUUS_BLOOD_ALTAR_FALLBACK_TARGET;
  const rectangle: WorldRouteRectangle = {
    x: target.x,
    y: target.y,
    z: target.z,
    width: target.width,
    height: target.height,
  };
  const clickTile = {
    x: target.x + Math.floor(target.width / 2),
    y: target.y + Math.floor(target.height / 2),
    z: target.z,
  };

  return {
    id: target.id,
    label: target.label,
    rectangle,
    clickTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, ARCEUUS_BLOOD_ALTAR_CLICK_DISTANCE_TILES),
  };
}

function pickBloodAltarObject(objects: readonly OsrsCacheMapObject[]): OsrsCacheMapObject | null {
  return objects
    .filter(
      (object) =>
        object.z === ARCEUUS_BLOOD_ALTAR_TARGET_TILE.z &&
        getObjectDistanceToAnchor(object, ARCEUUS_BLOOD_ALTAR_TARGET_TILE) <= 8 &&
        (object.id === ARCEUUS_BLOOD_ALTAR_OBJECT_ID || object.name.toLowerCase() === "blood altar"),
    )
    .sort((a, b) => {
      const aKnown = a.id === ARCEUUS_BLOOD_ALTAR_OBJECT_ID ? 0 : 1;
      const bKnown = b.id === ARCEUUS_BLOOD_ALTAR_OBJECT_ID ? 0 : 1;
      return (
        aKnown - bKnown ||
        getObjectDistanceToAnchor(a, ARCEUUS_BLOOD_ALTAR_TARGET_TILE) -
          getObjectDistanceToAnchor(b, ARCEUUS_BLOOD_ALTAR_TARGET_TILE) ||
        a.id - b.id
      );
    })[0] ?? null;
}

function resolveArceuusBloodAltarTarget(): ArceuusBloodAltarTarget {
  if (cachedBloodAltarTarget) {
    return cachedBloodAltarTarget;
  }

  try {
    const view = readOsrsCacheMapRegionView({
      regionX: ARCEUUS_BLOOD_ALTAR_TARGET_TILE.x >> 6,
      regionY: ARCEUUS_BLOOD_ALTAR_TARGET_TILE.y >> 6,
    });
    const object = pickBloodAltarObject(view.objects);
    cachedBloodAltarTarget = object ? toBloodAltarTargetFromObject(object) : toBloodAltarTargetFromFallback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`Could not resolve Arceuus blood altar from cache; using hardcoded target. ${message}`);
    cachedBloodAltarTarget = toBloodAltarTargetFromFallback();
  }

  logWithDelta(`Blood altar target: ${formatBloodAltarTarget(cachedBloodAltarTarget)}.`);
  return cachedBloodAltarTarget;
}

function formatBloodAltarTarget(target: ArceuusBloodAltarTarget): string {
  return `${target.label} click=${formatWorldTile(target.clickTile)} footprint=${target.rectangle.x},${target.rectangle.y},${target.rectangle.z} ${target.rectangle.width}x${target.rectangle.height}`;
}

function getInventoryItemsById(snapshot: RuneLiteLocalApiSnapshot, itemId: number): RuneLiteLocalApiItem[] {
  return snapshot.inventory.filter((item) => item.id === itemId);
}

function getInventoryItemSlot(item: RuneLiteLocalApiItem | null): number | null {
  const slot = item?.slot;
  if (!Number.isInteger(slot) || slot === undefined || slot < 0 || slot >= INVENTORY_TOTAL_SLOTS) {
    return null;
  }

  return slot;
}

function getInventoryItemRow(item: RuneLiteLocalApiItem): number | null {
  const slot = getInventoryItemSlot(item);
  return slot === null ? null : Math.floor(slot / INVENTORY_GRID_COLUMNS);
}

function getInventoryItemCol(item: RuneLiteLocalApiItem): number | null {
  const slot = getInventoryItemSlot(item);
  return slot === null ? null : slot % INVENTORY_GRID_COLUMNS;
}

function pickBottomRightInventoryItem(items: readonly RuneLiteLocalApiItem[]): RuneLiteLocalApiItem | null {
  let best: RuneLiteLocalApiItem | null = null;
  let bestSlot = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const slot = getInventoryItemSlot(item);
    if (slot !== null && slot > bestSlot) {
      best = item;
      bestSlot = slot;
    }
  }

  return best ?? items[items.length - 1] ?? null;
}

function pickDarkEssenceBlockForChisel(
  darkBlocks: readonly RuneLiteLocalApiItem[],
  chisel: RuneLiteLocalApiItem | null,
): { target: RuneLiteLocalApiItem | null; source: "chisel-row" | "bottom-right" | "none" } {
  const chiselRow = chisel ? getInventoryItemRow(chisel) : null;
  if (chiselRow !== null) {
    const rowMatches = darkBlocks.filter((item) => getInventoryItemRow(item) === chiselRow);
    let rowBest: RuneLiteLocalApiItem | null = null;
    let bestCol = Number.NEGATIVE_INFINITY;
    for (const item of rowMatches) {
      const col = getInventoryItemCol(item);
      if (col !== null && col > bestCol) {
        rowBest = item;
        bestCol = col;
      }
    }

    if (rowBest) {
      return { target: rowBest, source: "chisel-row" };
    }
  }

  const bottomRight = pickBottomRightInventoryItem(darkBlocks);
  return bottomRight ? { target: bottomRight, source: "bottom-right" } : { target: null, source: "none" };
}

function formatRuneLiteInventoryItem(item: RuneLiteLocalApiItem | null): string {
  if (!item) {
    return "none";
  }

  return `id=${item.id} qty=${item.quantity} slot=${item.slot ?? "unknown"}`;
}

function countOccupiedInventorySlots(snapshot: RuneLiteLocalApiSnapshot): number {
  const occupiedSlots = new Set<number>();
  for (const item of snapshot.inventory) {
    const slot = getInventoryItemSlot(item);
    if (slot !== null) {
      occupiedSlots.add(slot);
    }
  }

  return occupiedSlots.size > 0 ? occupiedSlots.size : Math.min(INVENTORY_TOTAL_SLOTS, snapshot.inventory.length);
}

function createInventoryStatus(snapshot: RuneLiteLocalApiSnapshot, checkedAtMs: number): ArceuusInventoryStatus {
  const occupiedSlots = countOccupiedInventorySlots(snapshot);
  const freeSlots = Math.max(0, INVENTORY_TOTAL_SLOTS - occupiedSlots);
  return {
    snapshot,
    occupiedSlots,
    freeSlots,
    isFull: freeSlots <= 0,
    checkedAtMs,
  };
}

function createAltarInventoryStatus(snapshot: RuneLiteLocalApiSnapshot, checkedAtMs: number): ArceuusAltarInventoryStatus {
  const occupiedSlots = countOccupiedInventorySlots(snapshot);
  return {
    snapshot,
    occupiedSlots,
    freeSlots: Math.max(0, INVENTORY_TOTAL_SLOTS - occupiedSlots),
    chisel: pickBottomRightInventoryItem(getInventoryItemsById(snapshot, ARCEUUS_CHISEL_ITEM_ID)),
    denseBlocks: getInventoryItemsById(snapshot, ARCEUUS_DENSE_ESSENCE_BLOCK_ITEM_ID),
    darkBlocks: getInventoryItemsById(snapshot, ARCEUUS_DARK_ESSENCE_BLOCK_ITEM_ID),
    darkFragments: getInventoryItemsById(snapshot, ARCEUUS_DARK_ESSENCE_FRAGMENTS_ITEM_ID),
    bloodRunes: getInventoryItemsById(snapshot, ARCEUUS_BLOOD_RUNE_ITEM_ID),
    checkedAtMs,
  };
}

function formatInventoryStatus(
  status: ArceuusInventoryStatus | null,
  options: { includeApiSkills?: boolean } = {},
): string {
  if (!status) {
    return "inventory=unavailable";
  }

  return `inventory free=${status.freeSlots} occupied=${status.occupiedSlots}/${INVENTORY_TOTAL_SLOTS} checked=${new Date(
    status.checkedAtMs,
  ).toLocaleTimeString()} ${formatRuneLiteLocalApiSnapshot(status.snapshot, { includeSkills: options.includeApiSkills })}`;
}

function sumItemQuantities(items: readonly RuneLiteLocalApiItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

function isDarkAltarInventoryConverted(status: ArceuusAltarInventoryStatus): boolean {
  return status.denseBlocks.length === 0 && status.darkBlocks.length > 0;
}

function isDarkEssenceChiselComplete(status: ArceuusAltarInventoryStatus): boolean {
  return status.denseBlocks.length === 0 && status.darkBlocks.length === 0 && status.darkFragments.length > 0;
}

function isBloodAltarCraftComplete(status: ArceuusAltarInventoryStatus): boolean {
  return status.denseBlocks.length === 0 && status.darkBlocks.length === 0 && status.darkFragments.length === 0;
}

function areDarkEssenceFragmentsGone(status: ArceuusAltarInventoryStatus): boolean {
  return status.darkFragments.length === 0;
}

function isFullOfDenseEssenceBlocks(status: ArceuusAltarInventoryStatus): boolean {
  return status.freeSlots === 0 && status.denseBlocks.length > 0;
}

function formatAltarInventoryStatus(
  status: ArceuusAltarInventoryStatus | null,
  options: { includeApiSkills?: boolean } = {},
): string {
  if (!status) {
    return "altarInventory=unavailable";
  }

  return `altarInventory free=${status.freeSlots} occupied=${status.occupiedSlots}/${INVENTORY_TOTAL_SLOTS} dense=${status.denseBlocks.length} darkBlocks=${status.darkBlocks.length} fragments=${status.darkFragments.length} fragmentQty=${sumItemQuantities(status.darkFragments)} bloodRunes=${status.bloodRunes.length} bloodRuneQty=${sumItemQuantities(status.bloodRunes)} chisel=${formatRuneLiteInventoryItem(status.chisel)} converted=${isDarkAltarInventoryConverted(status) ? "yes" : "no"} chiselComplete=${isDarkEssenceChiselComplete(status) ? "yes" : "no"} craftComplete=${isBloodAltarCraftComplete(status) ? "yes" : "no"} checked=${new Date(status.checkedAtMs).toLocaleTimeString()} ${formatRuneLiteLocalApiSnapshot(status.snapshot, { includeSkills: options.includeApiSkills })}`;
}

function selectNearestMiningTarget(
  playerTile: WorldRouteTile,
  targets: readonly ArceuusMiningObjectTarget[],
): ArceuusMiningObjectTarget {
  return [...targets].sort((a, b) => {
    const aDistance = getWorldTileDistanceToRectangle(playerTile, a.rectangle);
    const bDistance = getWorldTileDistanceToRectangle(playerTile, b.rectangle);
    const aCenterDistance = getWorldTileChebyshevDistance(playerTile, a.centerTile);
    const bCenterDistance = getWorldTileChebyshevDistance(playerTile, b.centerTile);
    return aDistance - bDistance || aCenterDistance - bCenterDistance || a.id - b.id;
  })[0];
}

function isPlayerInMiningObjectClickDistance(playerTile: WorldRouteTile, target: ArceuusMiningObjectTarget): boolean {
  return (
    getWorldTileDistanceToRectangle(playerTile, target.rectangle) <= ARCEUUS_MINING_OBJECT_CLICK_DISTANCE_TILES &&
    !isWorldTileInsideRectangle(playerTile, target.rectangle)
  );
}

function getMiningRouteDestinationTile(
  playerTile: WorldRouteTile,
  targets: readonly ArceuusMiningObjectTarget[],
): WorldRouteTile {
  return selectNearestMiningTarget(playerTile, targets).centerTile;
}

async function readMiningTick(
  window: NonNullable<ReturnType<typeof getRuneLite>>,
  expectedTile: WorldRouteTile | null,
  apiSnapshot: RuneLiteLocalApiSnapshot | null,
): Promise<ArceuusMiningTick | null> {
  const calibration = readStartupPlayerTileCalibration(window, {
    expectedTile,
    maxTileJump: expectedTile ? 96 : undefined,
  });
  if (!calibration) {
    return null;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const playerTile = apiSnapshot?.playerTile ?? calibration.playerTile;
  const miningStatus = detectMiningBoxStatusInScreenshot(bitmap);
  const playerAnchor = calibration.playerBox ? { x: calibration.playerBox.centerX, y: calibration.playerBox.centerY } : null;
  const visibleTarget = pickNearestActiveArceuusDenseRunestone(
    detectArceuusDenseRunestones(bitmap),
    playerAnchor,
    bitmap,
  );
  const greenOutlines = detectGreenOutlines(bitmap);

  return {
    calibration,
    bitmap,
    apiSnapshot,
    playerTile,
    miningStatus,
    visibleTarget,
    greenOutlines,
  };
}

async function readAltarTravelTick(
  window: NonNullable<ReturnType<typeof getRuneLite>>,
  expectedTile: WorldRouteTile | null,
  apiSnapshot: RuneLiteLocalApiSnapshot | null,
): Promise<ArceuusAltarTravelTick | null> {
  const calibration = readStartupPlayerTileCalibration(window, {
    expectedTile,
    maxTileJump: expectedTile ? 128 : undefined,
  });
  if (!calibration) {
    return null;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const playerTile = apiSnapshot?.playerTile ?? calibration.playerTile;
  const greenOutlines = detectGreenOutlines(bitmap);

  return {
    calibration,
    bitmap,
    apiSnapshot,
    playerTile,
    greenOutlines,
  };
}

function projectWorldTileToScreen(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldRouteTile,
  targetTile: WorldRouteTile,
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

function projectWorldTileInsideCapture(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldRouteTile,
  targetTile: WorldRouteTile,
  safeEdgeMarginPx: number,
): { screenPoint: ScreenPoint; localPoint: ScreenPoint } | null {
  const screenPoint = projectWorldTileToScreen(calibration, playerTile, targetTile);
  if (!screenPoint) {
    return null;
  }

  const localPoint = screenPointToLocal(calibration, screenPoint);
  if (
    localPoint.x < safeEdgeMarginPx ||
    localPoint.y < safeEdgeMarginPx ||
    localPoint.x > calibration.captureBounds.width - 1 - safeEdgeMarginPx ||
    localPoint.y > calibration.captureBounds.height - 1 - safeEdgeMarginPx
  ) {
    return null;
  }

  return { screenPoint, localPoint };
}

function getScaleFromCalibration(calibration: StartupPlayerTileCalibration): number {
  const scale = calibration.windowsScalePercent / 100;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getBitmapRgb(bitmap: ScreenBitmap, x: number, y: number): { r: number; g: number; b: number } | null {
  const localX = Math.round(x);
  const localY = Math.round(y);
  if (localX < 0 || localY < 0 || localX >= bitmap.width || localY >= bitmap.height) {
    return null;
  }

  const offset = localY * bitmap.byteWidth + localX * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
  };
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function scoreMinimapCircleEdge(bitmap: ScreenBitmap, centerX: number, centerY: number, radiusPx: number): number {
  let score = 0;
  let samples = 0;
  const innerRadius = Math.max(1, radiusPx - 7);
  const outerRadius = radiusPx + 7;
  const borderRadius = radiusPx;

  for (let index = 0; index < ARCEUUS_MINIMAP_EDGE_SAMPLE_COUNT; index += 1) {
    const angle = (index / ARCEUUS_MINIMAP_EDGE_SAMPLE_COUNT) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const inner = getBitmapRgb(bitmap, centerX + cos * innerRadius, centerY + sin * innerRadius);
    const border = getBitmapRgb(bitmap, centerX + cos * borderRadius, centerY + sin * borderRadius);
    const outer = getBitmapRgb(bitmap, centerX + cos * outerRadius, centerY + sin * outerRadius);
    if (!inner || !border || !outer) {
      continue;
    }

    const insideOutside = colorDistance(inner, outer);
    const borderContrast = Math.max(colorDistance(border, inner), colorDistance(border, outer));
    const contrastScore = Math.max(insideOutside, borderContrast * 0.85);
    score += Math.min(1, contrastScore / 115);
    samples += 1;
  }

  if (samples < Math.round(ARCEUUS_MINIMAP_EDGE_SAMPLE_COUNT * 0.8)) {
    return 0;
  }

  return score / samples;
}

function detectArceuusMinimapFromEdges(
  bitmap: ScreenBitmap,
  expectedCenterLocalX: number,
  expectedCenterLocalY: number,
  expectedRadiusPx: number,
  scale: number,
): ArceuusMinimapEdgeDetection | null {
  const searchX = Math.max(8, Math.round(ARCEUUS_MINIMAP_EDGE_CENTER_SEARCH_X_LOGICAL * scale));
  const searchY = Math.max(8, Math.round(ARCEUUS_MINIMAP_EDGE_CENTER_SEARCH_Y_LOGICAL * scale));
  const searchRadius = Math.max(5, Math.round(ARCEUUS_MINIMAP_EDGE_RADIUS_SEARCH_LOGICAL * scale));
  const coarseStep = Math.max(1, Math.round(ARCEUUS_MINIMAP_EDGE_COARSE_STEP_PX * scale));

  let best: ArceuusMinimapEdgeDetection | null = null;

  const evaluate = (centerLocalX: number, centerLocalY: number, radiusPx: number, fine: boolean): void => {
    if (
      centerLocalX - radiusPx < 0 ||
      centerLocalY - radiusPx < 0 ||
      centerLocalX + radiusPx >= bitmap.width ||
      centerLocalY + radiusPx >= bitmap.height
    ) {
      return;
    }

    const rawScore = scoreMinimapCircleEdge(bitmap, centerLocalX, centerLocalY, radiusPx);
    const centerPenalty =
      (Math.hypot(centerLocalX - expectedCenterLocalX, centerLocalY - expectedCenterLocalY) /
        Math.max(1, Math.hypot(searchX, searchY))) *
      (fine ? 0.04 : 0.08);
    const radiusPenalty = (Math.abs(radiusPx - expectedRadiusPx) / Math.max(1, searchRadius)) * (fine ? 0.025 : 0.05);
    const score = rawScore - centerPenalty - radiusPenalty;
    if (!best || score > best.score) {
      best = {
        centerLocalX,
        centerLocalY,
        radiusPx,
        score,
      };
    }
  };

  for (
    let centerY = expectedCenterLocalY - searchY;
    centerY <= expectedCenterLocalY + searchY;
    centerY += coarseStep
  ) {
    for (
      let centerX = expectedCenterLocalX - searchX;
      centerX <= expectedCenterLocalX + searchX;
      centerX += coarseStep
    ) {
      for (
        let radiusPx = expectedRadiusPx - searchRadius;
        radiusPx <= expectedRadiusPx + searchRadius;
        radiusPx += coarseStep
      ) {
        evaluate(Math.round(centerX), Math.round(centerY), Math.round(radiusPx), false);
      }
    }
  }

  if (!best) {
    return null;
  }

  const coarseBest = best as ArceuusMinimapEdgeDetection;
  for (let centerY = coarseBest.centerLocalY - coarseStep; centerY <= coarseBest.centerLocalY + coarseStep; centerY += 1) {
    for (let centerX = coarseBest.centerLocalX - coarseStep; centerX <= coarseBest.centerLocalX + coarseStep; centerX += 1) {
      for (let radiusPx = coarseBest.radiusPx - coarseStep; radiusPx <= coarseBest.radiusPx + coarseStep; radiusPx += 1) {
        evaluate(centerX, centerY, radiusPx, true);
      }
    }
  }

  const refinedBest = best as ArceuusMinimapEdgeDetection | null;
  if (!refinedBest || refinedBest.score < ARCEUUS_MINIMAP_EDGE_MIN_SCORE) {
    return null;
  }

  return refinedBest;
}

function inferArceuusMinimap(
  calibration: StartupPlayerTileCalibration,
  bitmap: ScreenBitmap | null,
): ArceuusMinimapGeometry {
  const scale = getScaleFromCalibration(calibration);
  const radiusPx = clamp(Math.round(ARCEUUS_MINIMAP_RADIUS_LOGICAL * scale), 55, 96);
  const tilePx = clamp(Math.round(ARCEUUS_MINIMAP_TILE_PX_LOGICAL * scale), 3, 7);
  const expected = calibration.compassNorth
    ? {
        centerLocalX:
          calibration.compassNorth.centerX +
          Math.round(ARCEUUS_MINIMAP_PLAYER_CENTER_FROM_COMPASS_X_LOGICAL * scale),
        centerLocalY:
          calibration.compassNorth.centerY +
          Math.round(ARCEUUS_MINIMAP_PLAYER_CENTER_FROM_COMPASS_Y_LOGICAL * scale),
        source: "inferred-from-compass" as const,
      }
    : {
        centerLocalX:
          calibration.captureBounds.width -
          Math.round(ARCEUUS_MINIMAP_PLAYER_CENTER_RIGHT_OFFSET_LOGICAL * scale),
        centerLocalY: Math.round(ARCEUUS_MINIMAP_PLAYER_CENTER_Y_LOGICAL * scale),
        source: "inferred-from-capture" as const,
      };

  const detected = bitmap
    ? detectArceuusMinimapFromEdges(bitmap, expected.centerLocalX, expected.centerLocalY, radiusPx, scale)
    : null;
  if (detected) {
    return {
      centerLocalX: detected.centerLocalX,
      centerLocalY: detected.centerLocalY,
      radiusPx: detected.radiusPx,
      tilePx,
      source: "detected-from-edge",
      detectionScore: detected.score,
      expectedCenterLocalX: expected.centerLocalX,
      expectedCenterLocalY: expected.centerLocalY,
      expectedRadiusPx: radiusPx,
    };
  }

  return {
    centerLocalX: expected.centerLocalX,
    centerLocalY: expected.centerLocalY,
    radiusPx,
    tilePx,
    source: expected.source,
    detectionScore: null,
    expectedCenterLocalX: expected.centerLocalX,
    expectedCenterLocalY: expected.centerLocalY,
    expectedRadiusPx: radiusPx,
  };
}

function projectWorldTileToMinimap(
  calibration: StartupPlayerTileCalibration,
  bitmap: ScreenBitmap | null,
  playerTile: WorldRouteTile,
  targetTile: WorldRouteTile,
  pathTiles: number,
): ArceuusMinimapClickPlan | null {
  if (playerTile.z !== targetTile.z) {
    return null;
  }

  const minimap = inferArceuusMinimap(calibration, bitmap);
  const dxTiles = targetTile.x - playerTile.x;
  const dyTiles = targetTile.y - playerTile.y;
  const distanceTiles = Math.max(Math.abs(dxTiles), Math.abs(dyTiles));
  const learning = arceuusMinimapMovementLearning;
  const effectiveTilePx = minimap.tilePx * learning.tilePxScale;
  const jitterPx = Math.max(1, Math.round(effectiveTilePx * 0.6));
  const rawNorthX = calibration.compassNorth?.northVectorX ?? 0;
  const rawNorthY = calibration.compassNorth?.northVectorY ?? -1;
  const northLength = Math.hypot(rawNorthX, rawNorthY);
  const northX = northLength > 0 ? rawNorthX / northLength : 0;
  const northY = northLength > 0 ? rawNorthY / northLength : -1;
  const eastX = -northY;
  const eastY = northX;
  let localDx = (eastX * dxTiles + northX * dyTiles) * effectiveTilePx;
  let localDy = (eastY * dxTiles + northY * dyTiles) * effectiveTilePx;
  const vectorLength = Math.hypot(localDx, localDy);
  const maxClickDistance = Math.max(1, Math.round(minimap.radiusPx * learning.radiusRatio));
  let wasVectorClamped = false;
  if (vectorLength > maxClickDistance) {
    wasVectorClamped = true;
    const vectorScale = maxClickDistance / vectorLength;
    localDx *= vectorScale;
    localDy *= vectorScale;
  }

  const projectedLocalX = minimap.centerLocalX + localDx;
  const projectedLocalY = minimap.centerLocalY + localDy;
  const localX = projectedLocalX + randomIntInclusive(-jitterPx, jitterPx);
  const localY = projectedLocalY + randomIntInclusive(-jitterPx, jitterPx);
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
    pathTiles: Math.max(1, pathTiles),
    minimapRadiusPx: minimap.radiusPx,
    expectedMinimapRadiusPx: minimap.expectedRadiusPx,
    minimapTilePx: minimap.tilePx,
    effectiveMinimapTilePx: effectiveTilePx,
    learnedTilePxScale: learning.tilePxScale,
    learnedRadiusRatio: learning.radiusRatio,
    maxClickDistancePx: maxClickDistance,
    wasVectorClamped,
    minimapSource: minimap.source,
    minimapDetectionScore: minimap.detectionScore,
    projectionSource: calibration.compassNorth ? "compass-rotated" : "north-up-fallback",
  };
}

async function clickVisibleRunestoneTarget(
  tick: ArceuusMiningTick,
  target: ArceuusDenseRunestone,
  reason: string,
  stepLabel = "Step 1 mining",
): Promise<ScreenPoint> {
  const clickPoint = pickBoxInteractionScreenPoint(target, tick.calibration.captureBounds, {
    innerRatio: 0.5,
    preferredLocalY: target.centerY,
  });
  await moveMouseHumanLike(clickPoint.x, clickPoint.y, tick.calibration.captureBounds, {
    maxDurationMs: 240,
    safeEdgeMarginPx: 12,
    shouldContinue: () => AppState.automateBotRunning,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, tick.calibration.captureBounds, {
    settleMs: randomIntInclusive(45, 120),
    safeEdgeMarginPx: 12,
  });
  const clickedLocal = screenPointToLocal(tick.calibration, clicked);
  const debugPath = await saveClickDebugImage(toClickDebugLabel(stepLabel, "visible-runestone-click"), tick.bitmap, [
    {
      type: "box",
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
      color: { r: 0, g: 255, b: 80 },
      thickness: 3,
    },
    {
      type: "cross",
      x: target.centerX,
      y: target.centerY,
      radius: 10,
      color: { r: 255, g: 220, b: 0 },
      thickness: 2,
    },
    {
      type: "cross",
      x: clickedLocal.x,
      y: clickedLocal.y,
      radius: 7,
      color: { r: 255, g: 0, b: 0 },
      thickness: 3,
    },
  ]);
  logWithDelta(
    `${stepLabel} click: mode=visible-active-runestone reason=${reason} screen=${clicked.x},${clicked.y} local=${clickedLocal.x},${clickedLocal.y} target=${target.status} center=${target.centerX},${target.centerY} size=${target.width}x${target.height} miningStatus=${tick.miningStatus.status} debug=${debugPath ?? "none"}.`,
  );
  return clicked;
}

async function clickProjectedWorldTile(
  tick: ArceuusMiningTick,
  playerTile: WorldRouteTile,
  targetTile: WorldRouteTile,
  reason: string,
  stepLabel = "Step 1 mining",
): Promise<ScreenPoint | null> {
  const projected = projectWorldTileInsideCapture(tick.calibration, playerTile, targetTile, 18);
  if (!projected) {
    return null;
  }

  await moveMouseHumanLike(projected.screenPoint.x, projected.screenPoint.y, tick.calibration.captureBounds, {
    maxDurationMs: 280,
    safeEdgeMarginPx: 18,
    shouldContinue: () => AppState.automateBotRunning,
  });
  const clicked = clickScreenPoint(projected.screenPoint.x, projected.screenPoint.y, tick.calibration.captureBounds, {
    settleMs: randomIntInclusive(45, 135),
    safeEdgeMarginPx: 18,
  });
  const plannedLocal = projected.localPoint;
  const clickedLocal = screenPointToLocal(tick.calibration, clicked);
  const debugShapes: DebugOverlayShape[] = [
    {
      type: "cross",
      x: plannedLocal.x,
      y: plannedLocal.y,
      radius: 12,
      color: { r: 255, g: 220, b: 0 },
      thickness: 2,
    },
    {
      type: "cross",
      x: clickedLocal.x,
      y: clickedLocal.y,
      radius: 7,
      color: { r: 255, g: 0, b: 0 },
      thickness: 3,
    },
  ];
  addCompassDebugOverlay(debugShapes, tick.calibration);
  const debugPath = await saveClickDebugImage(toClickDebugLabel(stepLabel, "projected-world-tile-click"), tick.bitmap, debugShapes);
  logWithDelta(
    `${stepLabel} click: mode=projected-world-tile reason=${reason} player=${formatWorldTile(playerTile)} target=${formatWorldTile(targetTile)} screen=${clicked.x},${clicked.y} local=${clickedLocal.x},${clickedLocal.y} plannedLocal=${plannedLocal.x},${plannedLocal.y} compass=${tick.calibration.compassNorth?.confidence.toFixed(2) ?? "fallback"} tilePx=${tick.calibration.tilePx}px miningStatus=${tick.miningStatus.status} debug=${debugPath ?? "none"}.`,
  );
  return clicked;
}

async function clickProjectedWorldTileForStep(
  stepLabel: string,
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldRouteTile,
  targetTile: WorldRouteTile,
  reason: string,
  options: {
    debugBitmap?: ScreenBitmap;
    debugLabel?: string;
  } = {},
): Promise<ScreenPoint | null> {
  const projected = projectWorldTileInsideCapture(calibration, playerTile, targetTile, 18);
  if (!projected) {
    return null;
  }

  await moveMouseHumanLike(projected.screenPoint.x, projected.screenPoint.y, calibration.captureBounds, {
    maxDurationMs: 280,
    safeEdgeMarginPx: 18,
    shouldContinue: () => AppState.automateBotRunning,
  });
  const clicked = clickScreenPoint(projected.screenPoint.x, projected.screenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(45, 135),
    safeEdgeMarginPx: 18,
  });
  const plannedLocal = projected.localPoint;
  const clickedLocal = screenPointToLocal(calibration, clicked);
  let debugPath: string | null = null;
  if (options.debugBitmap) {
    const debugShapes: DebugOverlayShape[] = [
      {
        type: "cross",
        x: plannedLocal.x,
        y: plannedLocal.y,
        radius: 12,
        color: { r: 255, g: 220, b: 0 },
        thickness: 2,
      },
      {
        type: "cross",
        x: clickedLocal.x,
        y: clickedLocal.y,
        radius: 7,
        color: { r: 255, g: 0, b: 0 },
        thickness: 3,
      },
    ];
    addCompassDebugOverlay(debugShapes, calibration);
    debugPath = await saveClickDebugImage(
      options.debugLabel ?? `${stepLabel}-projected-world-tile-click`,
      options.debugBitmap,
      debugShapes,
    );
  }
  logWithDelta(
    `${stepLabel} click: mode=projected-world-tile reason=${reason} player=${formatWorldTile(playerTile)} target=${formatWorldTile(targetTile)} screen=${clicked.x},${clicked.y} local=${clickedLocal.x},${clickedLocal.y} plannedLocal=${plannedLocal.x},${plannedLocal.y} compass=${calibration.compassNorth?.confidence.toFixed(2) ?? "fallback"} tilePx=${calibration.tilePx}px debug=${debugPath ?? "none"}.`,
  );
  return clicked;
}

async function confirmMiningStartedAfterClick(
  tick: ArceuusMiningTick,
  reason: string,
  stepLabel = "Step 1 mining",
  attempts = ARCEUUS_MINING_CLICK_CONFIRM_ATTEMPTS,
): Promise<boolean> {
  let lastConfirmation: MiningBoxStatusDetection | null = null;
  for (let attempt = 1; attempt <= attempts && AppState.automateBotRunning; attempt += 1) {
    await sleepWithAbort(ARCEUUS_MINING_CLICK_CONFIRM_MS, () => AppState.automateBotRunning);
    const confirmBitmap = captureScreenBitmap(tick.calibration.captureBounds);
    const confirmation = detectMiningBoxStatusInScreenshot(confirmBitmap);
    lastConfirmation = confirmation;
    if (confirmation.isMining) {
      logWithDelta(
        `${stepLabel} confirmed by Mining tool: reason=${reason} confirm=${attempt}/${attempts} status=${confirmation.status} confidence=${confirmation.confidence.toFixed(2)} pixels green=${confirmation.greenPixelCount} red=${confirmation.redPixelCount} text=${confirmation.textComponentCount}c/${confirmation.textColumnCount}col/${confirmation.textWidth}x${confirmation.textHeight}.`,
      );
      return true;
    }
  }

  warnWithDelta(
    `${stepLabel} not confirmed after click: reason=${reason} attempts=${attempts} status=${lastConfirmation?.status ?? "none"} confidence=${lastConfirmation?.confidence.toFixed(2) ?? "0.00"} pixels green=${lastConfirmation?.greenPixelCount ?? 0} red=${lastConfirmation?.redPixelCount ?? 0} text=${lastConfirmation?.textComponentCount ?? 0}c/${lastConfirmation?.textColumnCount ?? 0}col/${lastConfirmation?.textWidth ?? 0}x${lastConfirmation?.textHeight ?? 0}.`,
  );
  return false;
}

async function clickMiningObjectFromDistance(
  tick: ArceuusMiningTick,
  playerTile: WorldRouteTile,
  target: ArceuusMiningObjectTarget,
  stepLabel = "Step 1 mining",
): Promise<boolean> {
  if (tick.visibleTarget) {
    await clickVisibleRunestoneTarget(tick, tick.visibleTarget, `${target.label}; player in object click distance`, stepLabel);
  } else {
    const clicked = await clickProjectedWorldTile(tick, playerTile, target.centerTile, `${target.label}; object-center`, stepLabel);
    if (!clicked) {
      warnWithDelta(`${stepLabel} click skipped: cannot project ${target.label} center ${formatWorldTile(target.centerTile)} from player=${formatWorldTile(playerTile)}.`);
      return false;
    }
  }

  return confirmMiningStartedAfterClick(tick, `${target.label}; object-distance`, stepLabel);
}

async function clickRouteWaypoint(
  tick: ArceuusMiningTick,
  playerTile: WorldTile,
  targets: readonly ArceuusMiningObjectTarget[],
  attempt: number,
  routeContext: WorldRouteAgilityContext,
  stepLabel = "Step 1 mining",
  routeCache?: ArceuusRoutePlanCache,
): Promise<boolean> {
  const destinationLabel = "Arceuus dense runestone mining objects";
  const destinationTile = getMiningRouteDestinationTile(playerTile, targets);
  const targetTiles = targets.flatMap((target) => target.interactionTiles);
  const { route, cacheStatus, cacheCount } = getOrPlanArceuusRoute({
    playerTile,
    destinationLabel,
    destinationTile,
    targetTiles,
    routeContext,
    waypointStepLimit: ARCEUUS_MINING_ROUTE_WAYPOINT_STEP_LIMIT,
    routeCache,
  });

  logWithDelta(`${stepLabel} route ${attempt}: cache=${cacheStatus}${cacheCount ? `#${cacheCount}` : ""} ${formatWorldRoutePlan(route)}.`);
  if (cacheStatus !== "reused") {
    logWithDelta(`${stepLabel} route path ${attempt}: ${formatWorldRoutePath(route)}.`);
  }

  if (route.status === "unavailable" || !route.nextWaypoint) {
    warnWithDelta(`${stepLabel} route unavailable: ${route.reason ?? "missing waypoint"}.`);
    return false;
  }

  if (!route.nextLinkUsage) {
    if (tick.visibleTarget) {
      logWithDelta(
        `${stepLabel} route has no shortcut before target; clicking visible mining node directly instead of waypoint. player=${formatWorldTile(
          playerTile,
        )} routeTarget=${formatWorldTile(route.targetTile)} path=${route.pathLength} visible=${tick.visibleTarget.centerX},${tick.visibleTarget.centerY} size=${tick.visibleTarget.width}x${tick.visibleTarget.height}.`,
      );
      await clickVisibleRunestoneTarget(tick, tick.visibleTarget, "route-has-no-shortcut-before-target", stepLabel);
      const confirmed = await confirmMiningStartedAfterClick(tick, "visible-active-runestone-no-shortcut-before-target", stepLabel);
      if (confirmed) {
        logWithDelta(`${stepLabel} started from visible node after no-shortcut route check; staying in this mining step until inventory is full.`);
        return true;
      }

      warnWithDelta(
        `${stepLabel} visible node click did not start mining after no-shortcut route check; falling back to route waypoint ${formatWorldTile(route.nextWaypoint)}.`,
      );
    } else {
      const projected = projectWorldTileInsideCapture(tick.calibration, playerTile, destinationTile, 18);
      if (projected) {
        logWithDelta(
          `${stepLabel} route has no shortcut before target and object center projects inside the 3D capture; clicking theoretical visible mining object. player=${formatWorldTile(
            playerTile,
          )} objectCenter=${formatWorldTile(destinationTile)} routeTarget=${formatWorldTile(route.targetTile)} path=${route.pathLength} projectedLocal=${projected.localPoint.x},${projected.localPoint.y}.`,
        );
        const clicked = await clickProjectedWorldTile(
          tick,
          playerTile,
          destinationTile,
          "projected-object-center-no-shortcut-before-target",
          stepLabel,
        );
        if (clicked) {
          const confirmed = await confirmMiningStartedAfterClick(tick, "projected-object-center-no-shortcut-before-target", stepLabel);
          if (confirmed) {
            logWithDelta(`${stepLabel} started from projected object-center click after no-shortcut route check; staying in this mining step until inventory is full.`);
            return true;
          }
        }

        warnWithDelta(
          `${stepLabel} projected object-center click did not start mining after no-shortcut route check; falling back to route waypoint ${formatWorldTile(route.nextWaypoint)}.`,
        );
      }
    }
  }

  const clickedRoute = await clickPlannedRouteWaypoint(
    tick,
    playerTile,
    route,
    attempt,
    stepLabel,
    destinationLabel,
    routeContext,
  );
  if (clickedRoute.status === "missing-shortcut-green") {
    warnWithDelta(
      `${stepLabel} shortcut green outline missing for planner-selected shortcut. attempt=${attempt} distance=${clickedRoute.distanceToShortcut} target=${formatWorldRouteAgilityShortcutTarget(clickedRoute.shortcutTarget)} routeLink=${clickedRoute.route.nextLinkUsage ? `${clickedRoute.route.nextLinkUsage.label}@${formatWorldTile(clickedRoute.route.nextLinkUsage.fromTile)}->${formatWorldTile(clickedRoute.route.nextLinkUsage.toTile)}` : "none"} green=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"}.`,
    );
    await rotateCameraForAltarShortcutSearch(attempt, clickedRoute.shortcutTarget, stepLabel);
    return true;
  }
  return clickedRoute.status === "clicked";
}

type ArceuusShortcutClickTick = {
  calibration: StartupPlayerTileCalibration;
  bitmap: ScreenBitmap;
  greenOutlines: GreenOutlineDetection[];
};

function getProjectedShortcutLocalPoint(
  tick: ArceuusShortcutClickTick,
  playerTile: WorldRouteTile,
  target: WorldRouteAgilityShortcutTarget,
): { x: number; y: number } | null {
  const projected = projectWorldTileToScreen(tick.calibration, playerTile, target.clickTile);
  return projected
    ? {
        x: projected.x - tick.calibration.captureBounds.x,
        y: projected.y - tick.calibration.captureBounds.y,
      }
    : null;
}

async function clickArceuusShortcutGreenOutline(
  stepLabel: string,
  tick: ArceuusShortcutClickTick,
  playerTile: WorldRouteTile,
  target: WorldRouteAgilityShortcutTarget,
): Promise<boolean> {
  const projectedLocal = getProjectedShortcutLocalPoint(tick, playerTile, target);
  if (!projectedLocal) {
    warnWithDelta(`${stepLabel} shortcut skipped: cannot project ${target.label} from player=${formatWorldTile(playerTile)}.`);
    return false;
  }

  const greenOutlinesNearProjectedTile = detectGreenOutlinesNearPoint(
    tick.bitmap,
    projectedLocal,
    ARCEUUS_ALTAR_SHORTCUT_GREEN_OUTLINE_MAX_DISTANCE_PX,
  );
  const greenOutline = pickNearestGreenOutlineToPoint(
    [...greenOutlinesNearProjectedTile, ...tick.greenOutlines],
    projectedLocal,
    ARCEUUS_ALTAR_SHORTCUT_GREEN_OUTLINE_MAX_DISTANCE_PX,
  );
  if (!greenOutline) {
    const debugShapes: DebugOverlayShape[] = [
      {
        type: "cross",
        x: projectedLocal.x,
        y: projectedLocal.y,
        radius: 12,
        color: { r: 255, g: 220, b: 0 },
        thickness: 2,
      },
    ];
    for (const outline of tick.greenOutlines) {
      debugShapes.push({
        type: "box",
        x: outline.x,
        y: outline.y,
        width: outline.width,
        height: outline.height,
        color: { r: 255, g: 0, b: 255 },
        thickness: 1,
      });
    }
    addCompassDebugOverlay(debugShapes, tick.calibration);
    const debugPath = await saveClickDebugImage(`${sanitizeDebugImageLabel(stepLabel)}-shortcut-green-outline-missing`, tick.bitmap, debugShapes);
    warnWithDelta(
      `${stepLabel} shortcut waiting for green outline near projected map tile: target=${formatWorldRouteAgilityShortcutTarget(target)} projectedLocal=${projectedLocal.x},${projectedLocal.y} maxDistance=${ARCEUUS_ALTAR_SHORTCUT_GREEN_OUTLINE_MAX_DISTANCE_PX}px nearGreen=${greenOutlinesNearProjectedTile.map(formatGreenOutline).join("; ") || "none"} globalGreen=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"} debug=${debugPath ?? "none"}.`,
    );
    return false;
  }

  const clickPoint = pickBoxInteractionScreenPoint(greenOutline, tick.calibration.captureBounds, {
    innerRatio: 0.55,
    preferredLocalY: greenOutline.centerY,
  });
  await moveMouseHumanLike(clickPoint.x, clickPoint.y, tick.calibration.captureBounds, {
    maxDurationMs: 260,
    safeEdgeMarginPx: 12,
    shouldContinue: () => AppState.automateBotRunning,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, tick.calibration.captureBounds, {
    settleMs: randomIntInclusive(45, 120),
    safeEdgeMarginPx: 12,
  });
  const clickedLocal = screenPointToLocal(tick.calibration, clicked);
  const debugShapes: DebugOverlayShape[] = [
    {
      type: "cross",
      x: projectedLocal.x,
      y: projectedLocal.y,
      radius: 12,
      color: { r: 255, g: 220, b: 0 },
      thickness: 2,
    },
  ];
  for (const outline of greenOutlinesNearProjectedTile) {
    debugShapes.push({
      type: "box",
      x: outline.x,
      y: outline.y,
      width: outline.width,
      height: outline.height,
      color: { r: 255, g: 0, b: 255 },
      thickness: 1,
    });
  }
  debugShapes.push({
    type: "box",
    x: greenOutline.x,
    y: greenOutline.y,
    width: greenOutline.width,
    height: greenOutline.height,
    color: { r: 0, g: 255, b: 80 },
    thickness: 4,
  });
  debugShapes.push({
    type: "cross",
    x: greenOutline.centerX,
    y: greenOutline.centerY,
    radius: 8,
    color: { r: 0, g: 255, b: 80 },
    thickness: 2,
  });
  debugShapes.push({
    type: "cross",
    x: clickedLocal.x,
    y: clickedLocal.y,
    radius: 7,
    color: { r: 255, g: 0, b: 0 },
    thickness: 3,
  });
  addCompassDebugOverlay(debugShapes, tick.calibration);
  const debugPath = await saveClickDebugImage(`${sanitizeDebugImageLabel(stepLabel)}-shortcut-green-outline-click`, tick.bitmap, debugShapes);

  logWithDelta(
    `${stepLabel} shortcut click: mode=green-outline-near-projected-tile target=${formatWorldRouteAgilityShortcutTarget(target)} projectedLocal=${projectedLocal.x},${projectedLocal.y} outline=${formatGreenOutline(greenOutline)} nearCandidates=${greenOutlinesNearProjectedTile.length} globalCandidates=${tick.greenOutlines.length} screen=${clicked.x},${clicked.y} local=${clickedLocal.x},${clickedLocal.y} debug=${debugPath ?? "none"}.`,
  );

  await sleepWithAbort(ticksToMs(ARCEUUS_ALTAR_SHORTCUT_WAIT_TICKS, GAME_TICK_MS) + randomIntInclusive(80, 220), () => AppState.automateBotRunning);
  return true;
}

async function rotateCameraForAltarShortcutSearch(
  missingGreenOutlineCount: number,
  target: WorldRouteAgilityShortcutTarget,
  stepLabel = "Step 2 altar",
): Promise<void> {
  const key = missingGreenOutlineCount % 4 === 0 ? "a" : "d";
  const holdMs = randomIntInclusive(
    ARCEUUS_ALTAR_SHORTCUT_CAMERA_ROTATE_HOLD_MS_MIN,
    ARCEUUS_ALTAR_SHORTCUT_CAMERA_ROTATE_HOLD_MS_MAX,
  );
  const result = await holdRobotKey(key, holdMs, {
    shouldContinue: () => AppState.automateBotRunning,
  });
  if (!result.ok) {
    warnWithDelta(
      `${stepLabel} shortcut camera search failed: key=${key} hold=${holdMs}ms target=${formatWorldRouteAgilityShortcutTarget(target)} error=${result.error ?? "stopped"}.`,
    );
    return;
  }

  logWithDelta(
    `${stepLabel} shortcut camera search: held '${key}' for ${holdMs}ms after missing green outline ${missingGreenOutlineCount} time(s), target=${formatWorldRouteAgilityShortcutTarget(target)}.`,
  );
  await sleepWithAbort(ARCEUUS_ALTAR_SHORTCUT_CAMERA_SETTLE_MS + randomIntInclusive(30, 90), () => AppState.automateBotRunning);
}

type ArceuusRouteClickTick = {
  calibration: StartupPlayerTileCalibration;
  bitmap: ScreenBitmap;
  greenOutlines: GreenOutlineDetection[];
};

async function clickProjectedPlannedRouteWaypoint(
  tick: ArceuusRouteClickTick,
  playerTile: WorldRouteTile,
  route: WorldRoutePlan,
  attempt: number,
  stepLabel: string,
): Promise<ArceuusAltarRouteClickResult> {
  if (!route.nextWaypoint) {
    warnWithDelta(`${stepLabel} route skipped: missing projected waypoint.`);
    return { status: "unavailable", route };
  }

  const clicked = await clickProjectedWorldTileForStep(
    `${stepLabel} travel`,
    tick.calibration,
    playerTile,
    route.nextWaypoint,
    `route-waypoint pathStep=${route.nextWaypointPathLength}/${route.pathLength}`,
    {
      debugBitmap: tick.bitmap,
      debugLabel: `${toClickDebugLabel(stepLabel, "projected-route-click")}-${attempt}`,
    },
  );
  if (!clicked) {
    warnWithDelta(`${stepLabel} route skipped: cannot project next waypoint ${formatWorldTile(route.nextWaypoint)}.`);
    return { status: "unavailable", route };
  }

  const travelTicks = clamp(Math.ceil(route.nextWaypointPathLength / 2) + 1, 2, 14);
  const waitMs = ticksToMs(travelTicks, GAME_TICK_MS) + randomIntInclusive(80, 260);
  logWithDelta(
    `${stepLabel} movement click ${attempt}: mode=projected waypoint=${formatWorldTile(route.nextWaypoint)} pathStep=${route.nextWaypointPathLength}/${route.pathLength} wait=${waitMs}ms screen=${clicked.x},${clicked.y}.`,
  );
  await sleepWithAbort(waitMs, () => AppState.automateBotRunning);
  return { status: "clicked", route };
}

async function clickMinimapPlannedRouteWaypoint(
  tick: ArceuusRouteClickTick,
  playerTile: WorldRouteTile,
  route: WorldRoutePlan,
  attempt: number,
  stepLabel: string,
  destinationLabel: string,
): Promise<ArceuusAltarRouteClickResult> {
  if (!route.nextWaypoint) {
    warnWithDelta(`${stepLabel} minimap route skipped: missing minimap waypoint.`);
    return { status: "unavailable", route };
  }

  const clickPlan = projectWorldTileToMinimap(
    tick.calibration,
    tick.bitmap,
    playerTile,
    route.nextWaypoint,
    route.nextWaypointPathLength,
  );
  if (!clickPlan) {
    warnWithDelta(`${stepLabel} minimap route skipped: cannot project next waypoint ${formatWorldTile(route.nextWaypoint)}.`);
    return { status: "unavailable", route };
  }

  await moveMouseHumanLike(clickPlan.screenPoint.x, clickPlan.screenPoint.y, tick.calibration.captureBounds, {
    maxDurationMs: 260,
    safeEdgeMarginPx: 8,
    shouldContinue: () => AppState.automateBotRunning,
  });
  const clicked = clickScreenPoint(clickPlan.screenPoint.x, clickPlan.screenPoint.y, tick.calibration.captureBounds, {
    settleMs: randomIntInclusive(45, 120),
    safeEdgeMarginPx: 8,
  });
  const clickedAtMs = Date.now();
  const minimapCenterLocal = screenPointToLocal(tick.calibration, clickPlan.minimapCenter);
  const expectedMinimapCenterLocal = screenPointToLocal(tick.calibration, clickPlan.expectedMinimapCenter);
  const projectedLocal = screenPointToLocal(tick.calibration, clickPlan.projectedScreenPoint);
  const clickedLocal = screenPointToLocal(tick.calibration, clicked);
  const debugShapes: DebugOverlayShape[] = [
    {
      type: "circle",
      x: expectedMinimapCenterLocal.x,
      y: expectedMinimapCenterLocal.y,
      radius: clickPlan.expectedMinimapRadiusPx,
      color: { r: 255, g: 0, b: 255 },
      thickness: 1,
    },
    {
      type: "cross",
      x: expectedMinimapCenterLocal.x,
      y: expectedMinimapCenterLocal.y,
      radius: 6,
      color: { r: 255, g: 0, b: 255 },
      thickness: 1,
    },
    {
      type: "circle",
      x: minimapCenterLocal.x,
      y: minimapCenterLocal.y,
      radius: clickPlan.minimapRadiusPx,
      color: { r: 255, g: 140, b: 0 },
      thickness: 2,
    },
    {
      type: "circle",
      x: minimapCenterLocal.x,
      y: minimapCenterLocal.y,
      radius: Math.round(clickPlan.minimapRadiusPx * ARCEUUS_MINIMAP_MAX_CLICK_RADIUS_RATIO),
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
      x: clickedLocal.x,
      y: clickedLocal.y,
      radius: 7,
      color: { r: 255, g: 0, b: 0 },
      thickness: 3,
    },
  ];
  addCompassDebugOverlay(debugShapes, tick.calibration);
  const debugPath = await saveClickDebugImage(`${toClickDebugLabel(stepLabel, "minimap-click")}-${attempt}`, tick.bitmap, debugShapes);

  const maxExpectedTravelTiles = Math.max(
    1,
    Math.round(clickPlan.maxClickDistancePx / clickPlan.effectiveMinimapTilePx),
  );
  const waitPathTiles = Math.min(
    Math.max(1, route.nextWaypointPathLength),
    maxExpectedTravelTiles,
    Math.max(1, clickPlan.distanceTiles),
  );
  const travelTicks = clamp(Math.ceil(waitPathTiles / 2) + 2, 3, 12);
  const waitMs = ticksToMs(travelTicks, GAME_TICK_MS) + randomIntInclusive(80, 260);
  const estimatedRunTicks = Math.max(1, Math.ceil(route.nextWaypointPathLength / 2));
  const estimatedWalkTicks = Math.max(1, route.nextWaypointPathLength);
  const compass = tick.calibration.compassNorth;
  const compassSummary = compass
    ? `compassNorth=(${compass.northVectorX.toFixed(3)},${compass.northVectorY.toFixed(3)}) compassConfidence=${compass.confidence.toFixed(2)} compassCenter=${compass.centerX},${compass.centerY}`
    : "compassNorth=missing";
  const clickVectorX = clicked.x - clickPlan.minimapCenter.x;
  const clickVectorY = clicked.y - clickPlan.minimapCenter.y;
  const expectedCenterSummary =
    clickPlan.minimapSource === "detected-from-edge"
      ? ` expectedCenter=${clickPlan.expectedMinimapCenter.x},${clickPlan.expectedMinimapCenter.y} expectedRadius=${clickPlan.expectedMinimapRadiusPx}px edgeScore=${clickPlan.minimapDetectionScore?.toFixed(2) ?? "n/a"}`
      : "";
  logWithDelta(
    `${stepLabel} movement click ${attempt}: mode=minimap destination=${destinationLabel} player=${formatWorldTile(playerTile)} waypoint=${formatWorldTile(route.nextWaypoint)} pathStep=${route.nextWaypointPathLength}/${route.pathLength} delta=${clickPlan.dxTiles},${clickPlan.dyTiles} distance=${clickPlan.distanceTiles} waitPath=${waitPathTiles} estimatedRunTicks=${estimatedRunTicks} estimatedWalkTicks=${estimatedWalkTicks} minimap=${clickPlan.minimapSource}/${clickPlan.projectionSource} radius=${clickPlan.minimapRadiusPx}px maxClick=${clickPlan.maxClickDistancePx}px clamped=${clickPlan.wasVectorClamped ? "yes" : "no"} tilePx=${clickPlan.minimapTilePx}px effectiveTilePx=${clickPlan.effectiveMinimapTilePx.toFixed(2)} learnTileScale=${clickPlan.learnedTilePxScale.toFixed(3)} learnRadiusRatio=${clickPlan.learnedRadiusRatio.toFixed(3)} center=${clickPlan.minimapCenter.x},${clickPlan.minimapCenter.y}${expectedCenterSummary} projected=${clickPlan.projectedScreenPoint.x},${clickPlan.projectedScreenPoint.y} screen=${clicked.x},${clicked.y} local=${clickedLocal.x},${clickedLocal.y} clickVector=${clickVectorX},${clickVectorY} ${compassSummary} wait=${waitMs}ms debug=${debugPath ?? "none"}.`,
  );
  registerArceuusMinimapMovementSample({
    stepLabel,
    destinationLabel,
    startTile: playerTile,
    waypointTile: route.nextWaypoint,
    routePathTiles: route.pathTiles,
    pathStep: route.nextWaypointPathLength,
    pathLength: route.pathLength,
    waitPathTiles,
    estimatedRunTicks,
    estimatedWalkTicks,
    waitMs,
    clickedAtMs,
    dxTiles: clickPlan.dxTiles,
    dyTiles: clickPlan.dyTiles,
    distanceTiles: clickPlan.distanceTiles,
    clickVectorX,
    clickVectorY,
    minimapTilePx: clickPlan.minimapTilePx,
    effectiveMinimapTilePx: clickPlan.effectiveMinimapTilePx,
    tilePxScaleBefore: clickPlan.learnedTilePxScale,
    radiusRatioBefore: clickPlan.learnedRadiusRatio,
    wasVectorClamped: clickPlan.wasVectorClamped,
    minimapSource: clickPlan.minimapSource,
    projectionSource: clickPlan.projectionSource,
    debugPath,
  });
  await sleepWithAbort(waitMs, () => AppState.automateBotRunning);
  return { status: "clicked", route };
}

async function clickPlannedRouteWaypoint(
  tick: ArceuusRouteClickTick,
  playerTile: WorldRouteTile,
  route: WorldRoutePlan,
  attempt: number,
  stepLabel: string,
  destinationLabel: string,
  routeContext: WorldRouteAgilityContext,
): Promise<ArceuusAltarRouteClickResult> {
  if (route.status === "unavailable" || !route.nextWaypoint) {
    warnWithDelta(`${stepLabel} route unavailable: ${route.reason ?? "missing waypoint"}.`);
    return { status: "unavailable", route };
  }

  const plannedLinkUsage = route.nextLinkUsage;
  const plannedShortcut = plannedLinkUsage ? routeContext.shortcutByLinkId.get(plannedLinkUsage.id) ?? null : null;
  if (plannedShortcut) {
    const distanceToShortcut = getWorldTileDistanceToRectangle(playerTile, plannedShortcut.rectangle);
    if (tick.greenOutlines.length > 0 || distanceToShortcut <= ARCEUUS_ALTAR_SHORTCUT_CAMERA_SEARCH_DISTANCE_TILES) {
      const clickedShortcut = await clickArceuusShortcutGreenOutline(stepLabel, tick, playerTile, plannedShortcut);
      if (clickedShortcut) {
        return { status: "clicked", route, shortcutTarget: plannedShortcut };
      }
    }

    if (distanceToShortcut <= ARCEUUS_ALTAR_SHORTCUT_CLICK_DISTANCE_TILES) {
      return {
        status: "missing-shortcut-green",
        route,
        shortcutTarget: plannedShortcut,
        distanceToShortcut,
      };
    }

    if (distanceToShortcut <= ARCEUUS_ALTAR_SHORTCUT_CAMERA_SEARCH_DISTANCE_TILES) {
      logWithDelta(
        `${stepLabel} route planned shortcut is not visible yet; closing distance before camera search: player=${formatWorldTile(
          playerTile,
        )} distance=${distanceToShortcut} target=${formatWorldRouteAgilityShortcutTarget(plannedShortcut)} linkPathIndex=${plannedLinkUsage?.pathIndex ?? "n/a"}.`,
      );
    }
  }

  if (route.nextWaypointPathLength <= ARCEUUS_ROUTE_PROJECTED_CLICK_MAX_PATH_TILES) {
    return clickProjectedPlannedRouteWaypoint(tick, playerTile, route, attempt, stepLabel);
  }

  return clickMinimapPlannedRouteWaypoint(tick, playerTile, route, attempt, stepLabel, destinationLabel);
}

async function clickAltarRouteWaypoint(
  tick: ArceuusAltarTravelTick,
  playerTile: WorldTile,
  attempt: number,
  destinationLabel: string,
  destinationTile: WorldRouteTile,
  targetTiles: readonly WorldRouteTile[],
  routeContext: WorldRouteAgilityContext,
  stepLabel = "Step 2 altar",
  routeCache?: ArceuusRoutePlanCache,
): Promise<boolean> {
  const { route, cacheStatus, cacheCount } = getOrPlanArceuusRoute({
    playerTile,
    destinationLabel,
    destinationTile,
    targetTiles,
    routeContext,
    waypointStepLimit: ARCEUUS_ALTAR_ROUTE_WAYPOINT_STEP_LIMIT,
    routeCache,
  });

  logWithDelta(`${stepLabel} route ${attempt}: cache=${cacheStatus}${cacheCount ? `#${cacheCount}` : ""} ${formatWorldRoutePlan(route)}.`);
  if (cacheStatus !== "reused") {
    logWithDelta(`${stepLabel} route path ${attempt}: ${formatWorldRoutePath(route)}.`);
  }
  const clickedRoute = await clickPlannedRouteWaypoint(
    tick,
    playerTile,
    route,
    attempt,
    stepLabel,
    destinationLabel,
    routeContext,
  );
  if (clickedRoute.status === "missing-shortcut-green") {
    warnWithDelta(
      `${stepLabel} shortcut green outline missing for planner-selected shortcut. attempt=${attempt} distance=${clickedRoute.distanceToShortcut} target=${formatWorldRouteAgilityShortcutTarget(clickedRoute.shortcutTarget)} routeLink=${clickedRoute.route.nextLinkUsage ? `${clickedRoute.route.nextLinkUsage.label}@${formatWorldTile(clickedRoute.route.nextLinkUsage.fromTile)}->${formatWorldTile(clickedRoute.route.nextLinkUsage.toTile)}` : "none"} green=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"}.`,
    );
    await rotateCameraForAltarShortcutSearch(attempt, clickedRoute.shortcutTarget, stepLabel);
    return true;
  }
  return clickedRoute.status === "clicked";
}

async function clickAltarMinimapWaypoint(
  tick: ArceuusAltarTravelTick,
  playerTile: WorldTile,
  attempt: number,
  destinationLabel: string,
  destinationTile: WorldRouteTile,
  targetTiles: readonly WorldRouteTile[],
  routeContext: WorldRouteAgilityContext,
  stepLabel = "Step 2 altar",
  routeCache?: ArceuusRoutePlanCache,
): Promise<ArceuusAltarRouteClickResult> {
  const { route, cacheStatus, cacheCount } = getOrPlanArceuusRoute({
    playerTile,
    destinationLabel,
    destinationTile,
    targetTiles,
    routeContext,
    waypointStepLimit: ARCEUUS_ALTAR_MINIMAP_ROUTE_WAYPOINT_STEP_LIMIT,
    routeCache,
  });

  logWithDelta(`${stepLabel} route ${attempt}: cache=${cacheStatus}${cacheCount ? `#${cacheCount}` : ""} ${formatWorldRoutePlan(route)}.`);
  if (cacheStatus !== "reused") {
    logWithDelta(`${stepLabel} route path ${attempt}: ${formatWorldRoutePath(route)}.`);
  }
  return clickPlannedRouteWaypoint(tick, playerTile, route, attempt, stepLabel, destinationLabel, routeContext);
}

async function confirmDarkAltarInventoryConversion(reason: string, stepLabel = "Step 2 dark altar"): Promise<ArceuusAltarInventoryStatus | null> {
  let lastInventory: ArceuusAltarInventoryStatus | null = null;
  for (let attempt = 1; attempt <= ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS && AppState.automateBotRunning; attempt += 1) {
    await sleepWithAbort(
      ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_MS + randomIntInclusive(40, 140),
      () => AppState.automateBotRunning,
    );

    try {
      lastInventory = createAltarInventoryStatus(await fetchRuneLiteLocalApiSnapshot(350), Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1 || attempt === ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS) {
        warnWithDelta(`${stepLabel} inventory confirmation unavailable: reason=${reason} confirm=${attempt}/${ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS} error=${message}.`);
      }
      continue;
    }

    logWithDelta(
      `${stepLabel} inventory confirmation ${attempt}/${ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS}: reason=${reason} ${formatAltarInventoryStatus(lastInventory)}.`,
    );
    if (isDarkAltarInventoryConverted(lastInventory)) {
      return lastInventory;
    }
  }

  warnWithDelta(
    `${stepLabel} conversion not confirmed after click: reason=${reason} attempts=${ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS} ${formatAltarInventoryStatus(lastInventory)}.`,
  );
  return null;
}

async function clickDarkAltarAndConfirm(
  tick: ArceuusAltarTravelTick,
  playerTile: WorldRouteTile,
  target: ArceuusDarkAltarTarget,
  attempt: number,
  stepLabel = "Step 2 dark altar",
): Promise<ArceuusAltarInventoryStatus | null> {
  const clicked = await clickProjectedWorldTileForStep(
    stepLabel,
    tick.calibration,
    playerTile,
    target.clickTile,
    `dark-altar target=${formatDarkAltarTarget(target)}`,
    {
      debugBitmap: tick.bitmap,
      debugLabel: `${toClickDebugLabel(stepLabel, "click")}-${attempt}`,
    },
  );
  if (!clicked) {
    warnWithDelta(`${stepLabel} click skipped: cannot project ${formatDarkAltarTarget(target)} from player=${formatWorldTile(playerTile)}.`);
    return null;
  }

  logWithDelta(
    `${stepLabel} click ${attempt}: target=${formatDarkAltarTarget(target)} player=${formatWorldTile(playerTile)} screen=${clicked.x},${clicked.y} local=${clicked.x - tick.calibration.captureBounds.x},${clicked.y - tick.calibration.captureBounds.y}; waiting for dense essence conversion.`,
  );
  return confirmDarkAltarInventoryConversion(`dark-altar-click attempt=${attempt}`, stepLabel);
}

async function confirmDarkEssenceChiselCompletion(
  reason: string,
  stepLabel = "Step 3 chisel",
): Promise<ArceuusAltarInventoryStatus | null> {
  let lastInventory: ArceuusAltarInventoryStatus | null = null;
  for (let attempt = 1; attempt <= ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS && AppState.automateBotRunning; attempt += 1) {
    await sleepWithAbort(
      ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_MS + randomIntInclusive(40, 140),
      () => AppState.automateBotRunning,
    );

    try {
      lastInventory = createAltarInventoryStatus(await fetchRuneLiteLocalApiSnapshot(350), Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1 || attempt === ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS) {
        warnWithDelta(`${stepLabel} chisel confirmation unavailable: reason=${reason} confirm=${attempt}/${ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS} error=${message}.`);
      }
      continue;
    }

    logWithDelta(
      `${stepLabel} chisel confirmation ${attempt}/${ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS}: reason=${reason} ${formatAltarInventoryStatus(lastInventory)}.`,
    );
    if (isDarkEssenceChiselComplete(lastInventory)) {
      return lastInventory;
    }
  }

  warnWithDelta(
    `${stepLabel} chisel not confirmed after click: reason=${reason} attempts=${ARCEUUS_DARK_ALTAR_CLICK_CONFIRM_ATTEMPTS} ${formatAltarInventoryStatus(lastInventory)}.`,
  );
  return null;
}

async function confirmBloodAltarCraft(
  reason: string,
  stepLabel = "Step 7 blood altar",
  isComplete: (status: ArceuusAltarInventoryStatus) => boolean = isBloodAltarCraftComplete,
): Promise<ArceuusAltarInventoryStatus | null> {
  let lastInventory: ArceuusAltarInventoryStatus | null = null;
  for (let attempt = 1; attempt <= ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_ATTEMPTS && AppState.automateBotRunning; attempt += 1) {
    await sleepWithAbort(
      ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_MS + randomIntInclusive(40, 140),
      () => AppState.automateBotRunning,
    );

    try {
      lastInventory = createAltarInventoryStatus(await fetchRuneLiteLocalApiSnapshot(350), Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1 || attempt === ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_ATTEMPTS) {
        warnWithDelta(`${stepLabel} craft confirmation unavailable: reason=${reason} confirm=${attempt}/${ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_ATTEMPTS} error=${message}.`);
      }
      continue;
    }

    logWithDelta(
      `${stepLabel} craft confirmation ${attempt}/${ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_ATTEMPTS}: reason=${reason} ${formatAltarInventoryStatus(lastInventory)}.`,
    );
    if (isComplete(lastInventory)) {
      return lastInventory;
    }
  }

  warnWithDelta(
    `${stepLabel} craft not confirmed after click: reason=${reason} attempts=${ARCEUUS_BLOOD_ALTAR_CRAFT_CONFIRM_ATTEMPTS} ${formatAltarInventoryStatus(lastInventory)}.`,
  );
  return null;
}

async function clickBloodAltarAndConfirm(
  tick: ArceuusAltarTravelTick,
  playerTile: WorldRouteTile,
  target: ArceuusBloodAltarTarget,
  attempt: number,
  stepLabel = "Step 7 blood altar",
  isComplete: (status: ArceuusAltarInventoryStatus) => boolean = isBloodAltarCraftComplete,
): Promise<ArceuusAltarInventoryStatus | null> {
  const clicked = await clickProjectedWorldTileForStep(
    stepLabel,
    tick.calibration,
    playerTile,
    target.clickTile,
    `blood-altar target=${formatBloodAltarTarget(target)}`,
    {
      debugBitmap: tick.bitmap,
      debugLabel: `${toClickDebugLabel(stepLabel, "click")}-${attempt}`,
    },
  );
  if (!clicked) {
    warnWithDelta(`${stepLabel} click skipped: cannot project ${formatBloodAltarTarget(target)} from player=${formatWorldTile(playerTile)}.`);
    return null;
  }

  logWithDelta(
    `${stepLabel} click ${attempt}: target=${formatBloodAltarTarget(target)} player=${formatWorldTile(playerTile)} screen=${clicked.x},${clicked.y} local=${clicked.x - tick.calibration.captureBounds.x},${clicked.y - tick.calibration.captureBounds.y}; waiting for blood rune craft.`,
  );
  return confirmBloodAltarCraft(`blood-altar-click attempt=${attempt}`, stepLabel, isComplete);
}

async function clickInventoryPanelSlotForChisel(
  slot: InventoryPanelSlot,
  calibration: StartupPlayerTileCalibration,
): Promise<ScreenPoint> {
  const clickPoint = pickBoxInteractionScreenPoint(slot, calibration.captureBounds, {
    innerRatio: ARCEUUS_DARK_ESSENCE_CHISEL_CLICK_INNER_RATIO,
  });
  await moveMouseHumanLike(clickPoint.x, clickPoint.y, calibration.captureBounds, {
    maxDurationMs: 180,
    safeEdgeMarginPx: 8,
    shouldContinue: () => AppState.automateBotRunning,
  });
  return clickScreenPoint(clickPoint.x, clickPoint.y, calibration.captureBounds, {
    settleMs: 50,
    safeEdgeMarginPx: 8,
  });
}

function formatInventoryClickOffset(clicked: ScreenPoint, slot: InventoryPanelSlot, calibration: StartupPlayerTileCalibration): string {
  const centerScreenX = calibration.captureBounds.x + slot.centerX;
  const centerScreenY = calibration.captureBounds.y + slot.centerY;
  return `slotOffset=${clicked.x - centerScreenX},${clicked.y - centerScreenY}`;
}

async function clickChiselOnDarkEssenceBlock(
  calibration: StartupPlayerTileCalibration,
  bitmap: ScreenBitmap,
  inventory: ArceuusAltarInventoryStatus,
  attempt: number,
  stepLabel = "Step 3 chisel",
): Promise<boolean> {
  const darkBlockTarget = pickDarkEssenceBlockForChisel(inventory.darkBlocks, inventory.chisel);
  if (!inventory.chisel || !darkBlockTarget.target) {
    warnWithDelta(
      `${stepLabel} blocked: missing chisel or dark essence block target. target=${formatRuneLiteInventoryItem(
        darkBlockTarget.target,
      )} source=${darkBlockTarget.source} ${formatAltarInventoryStatus(inventory)}.`,
    );
    return false;
  }

  const panel = detectInventoryPanelInScreenshot(bitmap, {
    scalePercentHint: calibration.windowsScalePercent,
  });
  const chiselSlot = getInventoryPanelSlot(panel, getInventoryItemSlot(inventory.chisel) ?? -1);
  const blockSlot = getInventoryPanelSlot(panel, getInventoryItemSlot(darkBlockTarget.target) ?? -1);
  if (!chiselSlot || !blockSlot) {
    warnWithDelta(
      `${stepLabel} blocked: HTTP item slot outside detected inventory geometry. chisel=${formatRuneLiteInventoryItem(
        inventory.chisel,
      )} darkBlock=${formatRuneLiteInventoryItem(darkBlockTarget.target)} ${formatInventoryPanelDetection(panel)}.`,
    );
    return false;
  }

  const chiselClick = await clickInventoryPanelSlotForChisel(chiselSlot, calibration);
  await sleepWithAbort(INVENTORY_USE_CLICK_GAP_MS, () => AppState.automateBotRunning);
  const blockClick = await clickInventoryPanelSlotForChisel(blockSlot, calibration);
  const chiselLocal = screenPointToLocal(calibration, chiselClick);
  const blockLocal = screenPointToLocal(calibration, blockClick);
  const debugPath = await saveClickDebugImage(`${toClickDebugLabel(stepLabel, "dark-essence-click")}-${attempt}`, bitmap, [
    {
      type: "box",
      x: panel.inventoryBox.x,
      y: panel.inventoryBox.y,
      width: panel.inventoryBox.width,
      height: panel.inventoryBox.height,
      color: { r: 255, g: 220, b: 0 },
      thickness: 2,
    },
    {
      type: "box",
      x: chiselSlot.x,
      y: chiselSlot.y,
      width: chiselSlot.width,
      height: chiselSlot.height,
      color: { r: 64, g: 180, b: 255 },
      thickness: 3,
    },
    {
      type: "box",
      x: blockSlot.x,
      y: blockSlot.y,
      width: blockSlot.width,
      height: blockSlot.height,
      color: { r: 0, g: 255, b: 80 },
      thickness: 3,
    },
    {
      type: "cross",
      x: chiselLocal.x,
      y: chiselLocal.y,
      radius: 7,
      color: { r: 255, g: 0, b: 0 },
      thickness: 3,
    },
    {
      type: "cross",
      x: blockLocal.x,
      y: blockLocal.y,
      radius: 7,
      color: { r: 255, g: 0, b: 0 },
      thickness: 3,
    },
  ]);

  logWithDelta(
    `${stepLabel} click ${attempt}: clicked chisel -> dark essence block. chisel=${formatRuneLiteInventoryItem(
      inventory.chisel,
    )} darkBlock=${formatRuneLiteInventoryItem(darkBlockTarget.target)} source=${darkBlockTarget.source} chiselClick=${chiselClick.x},${chiselClick.y} ${formatInventoryClickOffset(
      chiselClick,
      chiselSlot,
      calibration,
    )} blockClick=${blockClick.x},${blockClick.y} ${formatInventoryClickOffset(
      blockClick,
      blockSlot,
      calibration,
    )} ${formatInventoryPanelDetection(panel)} ${formatAltarInventoryStatus(inventory)} debug=${debugPath ?? "none"}.`,
  );
  return true;
}

function formatMiningTick(tick: ArceuusMiningTick, inventoryStatus: ArceuusInventoryStatus | null): string {
  const api = tick.apiSnapshot ? formatRuneLiteLocalApiSnapshot(tick.apiSnapshot) : "api=unavailable";
  return `player=${tick.playerTile ? formatWorldTile(tick.playerTile) : "unavailable"} overlay=${tick.calibration.coordinateLine ?? "unavailable"} mining=${tick.miningStatus.status}:${tick.miningStatus.confidence.toFixed(2)} box=${tick.miningStatus.x},${tick.miningStatus.y},${tick.miningStatus.width}x${tick.miningStatus.height} pixels green=${tick.miningStatus.greenPixelCount} red=${tick.miningStatus.redPixelCount} text=${tick.miningStatus.textComponentCount}c/${tick.miningStatus.textColumnCount}col/${tick.miningStatus.textWidth}x${tick.miningStatus.textHeight} visibleActive=${tick.visibleTarget ? `${tick.visibleTarget.centerX},${tick.visibleTarget.centerY}` : "none"} greenOutlines=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"} ${formatInventoryStatus(inventoryStatus)} ${api}`;
}

function formatAltarTravelTick(
  tick: ArceuusAltarTravelTick,
  routeContext: WorldRouteAgilityContext,
  darkAltarTarget: ArceuusDarkAltarTarget,
): string {
  const api = tick.apiSnapshot ? formatRuneLiteLocalApiSnapshot(tick.apiSnapshot) : "api=unavailable";
  const altarTile = darkAltarTarget.clickTile;
  const distanceToAltar = tick.playerTile
    ? getWorldTileChebyshevDistance(tick.playerTile, altarTile)
    : Number.POSITIVE_INFINITY;
  return `player=${tick.playerTile ? formatWorldTile(tick.playerTile) : "unavailable"} altar=${formatWorldTile(
    altarTile,
  )} distance=${Number.isFinite(distanceToAltar) ? distanceToAltar : "unavailable"} darkAltar=${formatDarkAltarTarget(darkAltarTarget)} overlay=${tick.calibration.coordinateLine ?? "unavailable"} availableShortcuts=${formatWorldRouteAgilityShortcutSummary(routeContext.availableShortcuts)} unavailableShortcuts=${formatWorldRouteAgilityShortcutSummary(routeContext.unavailableShortcuts)} green=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"} ${api}`;
}

function formatBloodAltarTravelTick(
  tick: ArceuusAltarTravelTick,
  routeContext: WorldRouteAgilityContext,
  bloodAltarTarget: ArceuusBloodAltarTarget,
): string {
  const api = tick.apiSnapshot ? formatRuneLiteLocalApiSnapshot(tick.apiSnapshot) : "api=unavailable";
  const altarTile = bloodAltarTarget.clickTile;
  const distanceToAltar = tick.playerTile
    ? getWorldTileChebyshevDistance(tick.playerTile, altarTile)
    : Number.POSITIVE_INFINITY;
  return `player=${tick.playerTile ? formatWorldTile(tick.playerTile) : "unavailable"} altar=${formatWorldTile(
    altarTile,
  )} distance=${Number.isFinite(distanceToAltar) ? distanceToAltar : "unavailable"} bloodAltar=${formatBloodAltarTarget(bloodAltarTarget)} overlay=${tick.calibration.coordinateLine ?? "unavailable"} availableShortcuts=${formatWorldRouteAgilityShortcutSummary(routeContext.availableShortcuts)} unavailableShortcuts=${formatWorldRouteAgilityShortcutSummary(routeContext.unavailableShortcuts)} green=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"} ${api}`;
}

type ArceuusDarkAltarTravelOptions = {
  stepLabel: string;
  nextStepId: ArceuusBloodRuneV2StepId;
  windowMissingMessage: string;
};

async function runAltarTravelStep(): Promise<StepHandlerResult> {
  return runDarkAltarTravelStep({
    stepLabel: "Step 2 altar travel",
    nextStepId: STEP_CHISEL_DARK_ESSENCE_ID,
    windowMissingMessage: "RuneLite window not found for Arceuus Blood Rune V2 altar travel step.",
  });
}

async function runSecondDarkAltarStep(): Promise<StepHandlerResult> {
  return runDarkAltarTravelStep({
    stepLabel: "Step 5 dark altar 2",
    nextStepId: STEP_BLOOD_ALTAR_ID,
    windowMissingMessage: "RuneLite window not found for Arceuus Blood Rune V2 second dark altar step.",
  });
}

async function runDarkAltarTravelStep(options: ArceuusDarkAltarTravelOptions): Promise<StepHandlerResult> {
  focusRuneLiteWindowForAutomation();
  const window = getRuneLite();
  if (!window) {
    warnWithDelta(`${options.stepLabel} cannot start because RuneLite window was not found.`);
    notifyAutomateBotError(options.windowMissingMessage);
    return { stop: true };
  }

  const config = getSavedArceuusBloodRuneConfig();
  const routeContext = buildWorldRouteAgilityContext({ agilityLevel: config.agilityLevel });
  const darkAltarTarget = resolveArceuusDarkAltarTarget();
  const altarDestinationTile = darkAltarTarget.clickTile;
  const altarTargetTiles = darkAltarTarget.interactionTiles.length > 0
    ? darkAltarTarget.interactionTiles
    : buildWorldRouteCandidateTilesAround(altarDestinationTile, ARCEUUS_ALTAR_ROUTE_TARGET_RADIUS_TILES, {
        includeCenter: false,
      });
  logWithDelta(
    `${options.stepLabel} started: target=${formatWorldTile(altarDestinationTile)} configuredTarget=${formatWorldTile(ARCEUUS_DARK_ALTAR_TARGET_TILE)} darkAltar=${formatDarkAltarTarget(darkAltarTarget)} agilityLevel=${routeContext.agilityLevel} routeLinks=${formatWorldRouteAgilityShortcutSummary(routeContext.availableShortcuts)} blockedUnavailableShortcuts=${formatWorldRouteAgilityShortcutSummary(routeContext.unavailableShortcuts)} blockedTiles=${getArceuusBlockedRouteTiles(routeContext).length}.`,
  );

  let lastPlayerTile: WorldTile | null = null;
  let missingApiCount = 0;
  let missingGreenOutlineCount = 0;
  let attempt = 0;
  const minimapRouteCache = createArceuusRoutePlanCache();
  const projectedRouteCache = createArceuusRoutePlanCache();
  while (AppState.automateBotRunning) {
    attempt += 1;
    let apiSnapshotForTick: RuneLiteLocalApiSnapshot | null = null;
    let inventory: ArceuusAltarInventoryStatus | null = null;
    try {
      apiSnapshotForTick = await fetchRuneLiteLocalApiSnapshot(350);
      inventory = createAltarInventoryStatus(apiSnapshotForTick, Date.now());
      missingApiCount = 0;
    } catch (error) {
      missingApiCount += 1;
      if (missingApiCount === 1 || missingApiCount % 5 === 0) {
        const message = error instanceof Error ? error.message : String(error);
        warnWithDelta(`${options.stepLabel} HTTP API snapshot unavailable; using coordinate overlay. misses=${missingApiCount} error=${message}`);
      }
    }

    const tick = await readAltarTravelTick(window, lastPlayerTile, apiSnapshotForTick);
    if (!tick) {
      warnWithDelta(`${options.stepLabel} tick ${attempt}: startup calibration unavailable; retrying.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (tick.playerTile) {
      observeArceuusMinimapMovement(options.stepLabel, tick.playerTile);
      lastPlayerTile = tick.playerTile;
    }

    if (attempt === 1 || attempt % 5 === 0) {
      logWithDelta(`${options.stepLabel} tick ${attempt}: ${formatAltarTravelTick(tick, routeContext, darkAltarTarget)}.`);
    }

    const altarInventoryStatus = tick.apiSnapshot
      ? createAltarInventoryStatus(tick.apiSnapshot, Date.now())
      : null;
    if (altarInventoryStatus && isDarkAltarInventoryConverted(altarInventoryStatus)) {
      logWithDelta(
        `${options.stepLabel} complete: dense essence is gone and dark essence blocks are present; advancing to ${options.nextStepId}. ${formatAltarInventoryStatus(altarInventoryStatus)}.`,
      );
      return { nextStepId: options.nextStepId };
    }

    if (!tick.playerTile) {
      warnWithDelta(`${options.stepLabel} cannot route because player tile is unavailable. ${formatAltarTravelTick(tick, routeContext, darkAltarTarget)}.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const distanceToDarkAltar = getWorldTileDistanceToRectangle(tick.playerTile, darkAltarTarget.rectangle);
    if (distanceToDarkAltar <= ARCEUUS_ALTAR_REACHED_DISTANCE_TILES) {
      const rangeLabel = distanceToDarkAltar <= ARCEUUS_DARK_ALTAR_CLICK_DISTANCE_TILES ? "in click range" : "near click range";
      logWithDelta(
        `${options.stepLabel} ${rangeLabel}: player=${formatWorldTile(tick.playerTile)} distance=${distanceToDarkAltar} target=${formatDarkAltarTarget(darkAltarTarget)} ${formatAltarInventoryStatus(altarInventoryStatus)}.`,
      );
      const confirmedInventory = await clickDarkAltarAndConfirm(tick, tick.playerTile, darkAltarTarget, attempt, options.stepLabel);
      if (confirmedInventory) {
        logWithDelta(
          `${options.stepLabel} complete: dark altar produced dark essence blocks; advancing to ${options.nextStepId}. ${formatAltarInventoryStatus(confirmedInventory)}.`,
        );
        return { nextStepId: options.nextStepId };
      }

      if (distanceToDarkAltar > ARCEUUS_DARK_ALTAR_CLICK_DISTANCE_TILES) {
        warnWithDelta(
          `${options.stepLabel} close direct click was not confirmed; routing one ground step closer instead of using a tiny minimap click. player=${formatWorldTile(tick.playerTile)} distance=${distanceToDarkAltar} target=${formatDarkAltarTarget(darkAltarTarget)}.`,
        );
        await clickAltarRouteWaypoint(
          tick,
          tick.playerTile,
          attempt,
          "Arceuus dark altar",
          altarDestinationTile,
          altarTargetTiles,
          routeContext,
          options.stepLabel,
          projectedRouteCache,
        );
      }

      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const clickedAltarMinimap = await clickAltarMinimapWaypoint(
      tick,
      tick.playerTile,
      attempt,
      "Arceuus dark altar",
      altarDestinationTile,
      altarTargetTiles,
      routeContext,
      options.stepLabel,
      minimapRouteCache,
    );
    if (clickedAltarMinimap.status === "missing-shortcut-green") {
      missingGreenOutlineCount += 1;
      if (missingGreenOutlineCount === 1 || missingGreenOutlineCount % 5 === 0) {
        warnWithDelta(
          `${options.stepLabel} shortcut green outline missing for planner-selected shortcut. misses=${missingGreenOutlineCount} distance=${clickedAltarMinimap.distanceToShortcut} target=${formatWorldRouteAgilityShortcutTarget(clickedAltarMinimap.shortcutTarget)} routeLink=${clickedAltarMinimap.route.nextLinkUsage ? `${clickedAltarMinimap.route.nextLinkUsage.label}@${formatWorldTile(clickedAltarMinimap.route.nextLinkUsage.fromTile)}->${formatWorldTile(clickedAltarMinimap.route.nextLinkUsage.toTile)}` : "none"} green=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"}.`,
        );
      }

      await rotateCameraForAltarShortcutSearch(missingGreenOutlineCount, clickedAltarMinimap.shortcutTarget, options.stepLabel);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (clickedAltarMinimap.status === "clicked") {
      missingGreenOutlineCount = 0;
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (clickedAltarMinimap.status === "unavailable") {
      warnWithDelta(`${options.stepLabel} minimap click unavailable; falling back to projected world-tile route click.`);
      await clickAltarRouteWaypoint(
        tick,
        tick.playerTile,
        attempt,
        "Arceuus dark altar",
        altarDestinationTile,
        altarTargetTiles,
        routeContext,
        options.stepLabel,
        projectedRouteCache,
      );
    }
    await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
  }

  return { stop: true };
}

async function runChiselDarkEssenceStep(): Promise<StepHandlerResult> {
  focusRuneLiteWindowForAutomation();
  const window = getRuneLite();
  if (!window) {
    warnWithDelta("Step 3 chisel cannot start because RuneLite window was not found.");
    notifyAutomateBotError("RuneLite window not found for Arceuus Blood Rune V2 chisel step.");
    return { stop: true };
  }

  let missingApiCount = 0;
  let attempt = 0;
  let chiselClickedOnce = false;
  while (AppState.automateBotRunning) {
    attempt += 1;
    let inventory: ArceuusAltarInventoryStatus | null = null;
    try {
      inventory = createAltarInventoryStatus(await fetchRuneLiteLocalApiSnapshot(350), Date.now());
      missingApiCount = 0;
    } catch (error) {
      missingApiCount += 1;
      if (missingApiCount === 1 || missingApiCount % 5 === 0) {
        const message = error instanceof Error ? error.message : String(error);
        warnWithDelta(`Step 3 chisel inventory unavailable; retrying. misses=${missingApiCount} error=${message}.`);
      }
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (attempt === 1 || attempt % 3 === 0 || inventory.darkBlocks.length === 0) {
      logWithDelta(`Step 3 chisel inventory check ${attempt}: ${formatAltarInventoryStatus(inventory)}.`);
    }

    if (inventory.denseBlocks.length > 0) {
      warnWithDelta(
        `Step 3 chisel stopped: dense essence blocks are still present, so Step 2 dark altar conversion is not complete. ${formatAltarInventoryStatus(
          inventory,
        )}.`,
      );
      return { stop: true };
    }

    if (isDarkEssenceChiselComplete(inventory)) {
      logWithDelta(
        `Step 3 chisel complete: no dark essence blocks remain and fragments are present; advancing to ${STEP_RE_MINE_ID}. ${formatAltarInventoryStatus(
          inventory,
        )}.`,
      );
      return { nextStepId: STEP_RE_MINE_ID };
    }

    if (inventory.darkBlocks.length === 0) {
      warnWithDelta(
        `Step 3 chisel waiting: no dark essence blocks remain, but fragments are not confirmed yet. ${formatAltarInventoryStatus(
          inventory,
        )}.`,
      );
      await sleepWithAbort(GAME_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (chiselClickedOnce) {
      if (attempt === 2 || attempt % 3 === 0) {
        logWithDelta(
          `Step 3 chisel waiting after single chisel click; not reclicking. ${formatAltarInventoryStatus(inventory)}.`,
        );
      }
      await sleepWithAbort(GAME_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const calibration = readStartupPlayerTileCalibration(window);
    if (!calibration) {
      warnWithDelta(`Step 3 chisel retrying: startup calibration unavailable before inventory click.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const bitmap = captureScreenBitmap(calibration.captureBounds);
    const clicked = await clickChiselOnDarkEssenceBlock(calibration, bitmap, inventory, attempt, "Step 3 chisel");
    if (clicked) {
      chiselClickedOnce = true;
      logWithDelta(
        `Step 3 chisel single click sent; waiting for all dark essence blocks to become fragments before advancing. ${formatAltarInventoryStatus(
          inventory,
        )}.`,
      );
    }
    await sleepWithAbort(
      clicked ? ARCEUUS_DARK_ESSENCE_CHISEL_WAIT_MS : GAME_TICK_MS,
      () => AppState.automateBotRunning,
    );
  }

  return { stop: true };
}

async function runBloodAltarTravelStep(): Promise<StepHandlerResult> {
  focusRuneLiteWindowForAutomation();
  const window = getRuneLite();
  if (!window) {
    warnWithDelta("Step 6 blood altar cannot start because RuneLite window was not found.");
    notifyAutomateBotError("RuneLite window not found for Arceuus Blood Rune V2 blood altar step.");
    return { stop: true };
  }

  const stepLabel = "Step 6 blood altar";
  const config = getSavedArceuusBloodRuneConfig();
  const routeContext = buildWorldRouteAgilityContext({ agilityLevel: config.agilityLevel });
  const bloodAltarTarget = resolveArceuusBloodAltarTarget();
  const bloodAltarDestinationTile = bloodAltarTarget.clickTile;
  const bloodAltarTargetTiles = bloodAltarTarget.interactionTiles.length > 0
    ? bloodAltarTarget.interactionTiles
    : buildWorldRouteCandidateTilesAround(bloodAltarDestinationTile, ARCEUUS_ALTAR_ROUTE_TARGET_RADIUS_TILES, {
        includeCenter: false,
      });
  logWithDelta(
    `${stepLabel} started: target=${formatWorldTile(bloodAltarDestinationTile)} configuredTarget=${formatWorldTile(ARCEUUS_BLOOD_ALTAR_TARGET_TILE)} bloodAltar=${formatBloodAltarTarget(bloodAltarTarget)} agilityLevel=${routeContext.agilityLevel} routeLinks=${formatWorldRouteAgilityShortcutSummary(routeContext.availableShortcuts)} blockedUnavailableShortcuts=${formatWorldRouteAgilityShortcutSummary(routeContext.unavailableShortcuts)} blockedTiles=${getArceuusBlockedRouteTiles(routeContext).length}.`,
  );

  let lastPlayerTile: WorldTile | null = null;
  let missingApiCount = 0;
  let missingGreenOutlineCount = 0;
  let attempt = 0;
  const minimapRouteCache = createArceuusRoutePlanCache();
  const projectedRouteCache = createArceuusRoutePlanCache();
  while (AppState.automateBotRunning) {
    attempt += 1;
    let apiSnapshotForTick: RuneLiteLocalApiSnapshot | null = null;
    let inventory: ArceuusAltarInventoryStatus | null = null;
    try {
      apiSnapshotForTick = await fetchRuneLiteLocalApiSnapshot(350);
      inventory = createAltarInventoryStatus(apiSnapshotForTick, Date.now());
      missingApiCount = 0;
    } catch (error) {
      missingApiCount += 1;
      if (missingApiCount === 1 || missingApiCount % 5 === 0) {
        const message = error instanceof Error ? error.message : String(error);
        warnWithDelta(`${stepLabel} HTTP API snapshot unavailable; using coordinate overlay. misses=${missingApiCount} error=${message}`);
      }
    }

    const tick = await readAltarTravelTick(window, lastPlayerTile, apiSnapshotForTick);
    if (!tick) {
      warnWithDelta(`${stepLabel} tick ${attempt}: startup calibration unavailable; retrying.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (tick.playerTile) {
      observeArceuusMinimapMovement(stepLabel, tick.playerTile);
      lastPlayerTile = tick.playerTile;
    }

    if (attempt === 1 || attempt % 5 === 0) {
      logWithDelta(`${stepLabel} tick ${attempt}: ${formatBloodAltarTravelTick(tick, routeContext, bloodAltarTarget)}.`);
    }

    if (inventory && areDarkEssenceFragmentsGone(inventory)) {
      logWithDelta(`${stepLabel} complete: no dark essence fragments remain; advancing to ${STEP_CHISEL_BLOOD_ALTAR_ID}. ${formatAltarInventoryStatus(inventory)}.`);
      return { nextStepId: STEP_CHISEL_BLOOD_ALTAR_ID };
    }

    if (!tick.playerTile) {
      warnWithDelta(`${stepLabel} cannot route because player tile is unavailable. ${formatBloodAltarTravelTick(tick, routeContext, bloodAltarTarget)}.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const distanceToBloodAltar = getWorldTileDistanceToRectangle(tick.playerTile, bloodAltarTarget.rectangle);
    if (distanceToBloodAltar <= ARCEUUS_BLOOD_ALTAR_CLICK_DISTANCE_TILES) {
      logWithDelta(
        `${stepLabel} Blood altar in click range: player=${formatWorldTile(tick.playerTile)} distance=${distanceToBloodAltar} target=${formatBloodAltarTarget(bloodAltarTarget)} ${formatAltarInventoryStatus(inventory)}.`,
      );
      const confirmedInventory = await clickBloodAltarAndConfirm(
        tick,
        tick.playerTile,
        bloodAltarTarget,
        attempt,
        stepLabel,
        areDarkEssenceFragmentsGone,
      );
      if (confirmedInventory) {
        logWithDelta(`${stepLabel} complete: Blood altar consumed dark essence fragments; advancing to ${STEP_CHISEL_BLOOD_ALTAR_ID}. ${formatAltarInventoryStatus(confirmedInventory)}.`);
        return { nextStepId: STEP_CHISEL_BLOOD_ALTAR_ID };
      }

      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const clickedAltarMinimap = await clickAltarMinimapWaypoint(
      tick,
      tick.playerTile,
      attempt,
      "Arceuus blood altar",
      bloodAltarDestinationTile,
      bloodAltarTargetTiles,
      routeContext,
      stepLabel,
      minimapRouteCache,
    );
    if (clickedAltarMinimap.status === "missing-shortcut-green") {
      missingGreenOutlineCount += 1;
      if (missingGreenOutlineCount === 1 || missingGreenOutlineCount % 5 === 0) {
        warnWithDelta(
          `${stepLabel} shortcut green outline missing for planner-selected shortcut. misses=${missingGreenOutlineCount} distance=${clickedAltarMinimap.distanceToShortcut} target=${formatWorldRouteAgilityShortcutTarget(clickedAltarMinimap.shortcutTarget)} routeLink=${clickedAltarMinimap.route.nextLinkUsage ? `${clickedAltarMinimap.route.nextLinkUsage.label}@${formatWorldTile(clickedAltarMinimap.route.nextLinkUsage.fromTile)}->${formatWorldTile(clickedAltarMinimap.route.nextLinkUsage.toTile)}` : "none"} green=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"}.`,
        );
      }

      await rotateCameraForAltarShortcutSearch(missingGreenOutlineCount, clickedAltarMinimap.shortcutTarget, stepLabel);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (clickedAltarMinimap.status === "clicked") {
      missingGreenOutlineCount = 0;
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (clickedAltarMinimap.status === "unavailable") {
      warnWithDelta(`${stepLabel} minimap click unavailable; falling back to projected world-tile route click.`);
      await clickAltarRouteWaypoint(
        tick,
        tick.playerTile,
        attempt,
        "Arceuus blood altar",
        bloodAltarDestinationTile,
        bloodAltarTargetTiles,
        routeContext,
        stepLabel,
        projectedRouteCache,
      );
    }
    await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
  }

  return { stop: true };
}

async function runChiselBloodAltarStep(): Promise<StepHandlerResult> {
  focusRuneLiteWindowForAutomation();
  const window = getRuneLite();
  if (!window) {
    warnWithDelta("Step 7 chisel blood altar cannot start because RuneLite window was not found.");
    notifyAutomateBotError("RuneLite window not found for Arceuus Blood Rune V2 chisel blood altar step.");
    return { stop: true };
  }

  const stepLabel = "Step 7 chisel blood altar";
  const config = getSavedArceuusBloodRuneConfig();
  const routeContext = buildWorldRouteAgilityContext({ agilityLevel: config.agilityLevel });
  const bloodAltarTarget = resolveArceuusBloodAltarTarget();
  const bloodAltarDestinationTile = bloodAltarTarget.clickTile;
  const bloodAltarTargetTiles = bloodAltarTarget.interactionTiles.length > 0
    ? bloodAltarTarget.interactionTiles
    : buildWorldRouteCandidateTilesAround(bloodAltarDestinationTile, ARCEUUS_ALTAR_ROUTE_TARGET_RADIUS_TILES, {
        includeCenter: false,
      });

  let lastPlayerTile: WorldTile | null = null;
  let missingApiCount = 0;
  let missingGreenOutlineCount = 0;
  let attempt = 0;
  let chiselClickedOnce = false;
  const minimapRouteCache = createArceuusRoutePlanCache();
  const projectedRouteCache = createArceuusRoutePlanCache();
  while (AppState.automateBotRunning) {
    attempt += 1;
    let apiSnapshotForTick: RuneLiteLocalApiSnapshot | null = null;
    let inventory: ArceuusAltarInventoryStatus | null = null;
    try {
      apiSnapshotForTick = await fetchRuneLiteLocalApiSnapshot(350);
      inventory = createAltarInventoryStatus(apiSnapshotForTick, Date.now());
      missingApiCount = 0;
    } catch (error) {
      missingApiCount += 1;
      if (missingApiCount === 1 || missingApiCount % 5 === 0) {
        const message = error instanceof Error ? error.message : String(error);
        warnWithDelta(`${stepLabel} inventory unavailable; retrying. misses=${missingApiCount} error=${message}.`);
      }
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (attempt === 1 || attempt % 3 === 0 || inventory.darkBlocks.length === 0) {
      logWithDelta(`${stepLabel} inventory check ${attempt}: ${formatAltarInventoryStatus(inventory)}.`);
    }

    if (inventory.denseBlocks.length > 0) {
      warnWithDelta(
        `${stepLabel} stopped: dense essence blocks are still present, so Step 5 dark altar conversion is not complete. ${formatAltarInventoryStatus(
          inventory,
        )}.`,
      );
      return { stop: true };
    }

    if (isBloodAltarCraftComplete(inventory)) {
      logWithDelta(`${stepLabel} complete: essence fragments are gone; returning to ${STEP_MINE_ID}. ${formatAltarInventoryStatus(inventory)}.`);
      return { nextStepId: STEP_MINE_ID };
    }

    if (!chiselClickedOnce && inventory.darkBlocks.length > 0 && inventory.darkFragments.length > 0) {
      warnWithDelta(
        `${stepLabel} found dark essence fragments still present with dark essence blocks; Step 6 Blood altar confirmation is incomplete. Returning to ${STEP_BLOOD_ALTAR_ID}. ${formatAltarInventoryStatus(inventory)}.`,
      );
      return { nextStepId: STEP_BLOOD_ALTAR_ID };
    }

    if (inventory.darkBlocks.length > 0) {
      if (chiselClickedOnce) {
        if (attempt === 2 || attempt % 3 === 0) {
          logWithDelta(
            `${stepLabel} waiting after single chisel click; not reclicking until dark essence blocks are gone. ${formatAltarInventoryStatus(
              inventory,
            )}.`,
          );
        }
        await sleepWithAbort(GAME_TICK_MS, () => AppState.automateBotRunning);
        continue;
      }

      const calibration = readStartupPlayerTileCalibration(window, {
        expectedTile: lastPlayerTile,
        maxTileJump: lastPlayerTile ? 128 : undefined,
      });
      if (!calibration) {
        warnWithDelta(`${stepLabel} retrying: startup calibration unavailable before inventory click.`);
        await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
        continue;
      }

      const bitmap = captureScreenBitmap(calibration.captureBounds);
      const clicked = await clickChiselOnDarkEssenceBlock(calibration, bitmap, inventory, attempt, stepLabel);
      if (!clicked) {
        await sleepWithAbort(GAME_TICK_MS, () => AppState.automateBotRunning);
        continue;
      }

      chiselClickedOnce = true;
      logWithDelta(
        `${stepLabel} single chisel click sent; waiting for dark essence blocks to become fragments before clicking Blood altar. ${formatAltarInventoryStatus(
          inventory,
        )}.`,
      );
      const confirmedInventory = await confirmDarkEssenceChiselCompletion(`chisel-dark-block attempt=${attempt}`, stepLabel);
      if (!confirmedInventory) {
        await sleepWithAbort(GAME_TICK_MS, () => AppState.automateBotRunning);
        continue;
      }

      inventory = confirmedInventory;
      apiSnapshotForTick = confirmedInventory.snapshot;
      logWithDelta(
        `${stepLabel} chisel complete: dark essence blocks are gone; Blood altar can be clicked. ${formatAltarInventoryStatus(
          inventory,
        )}.`,
      );
    }

    if (inventory.darkFragments.length === 0) {
      warnWithDelta(`${stepLabel} waiting: no dark essence blocks remain, but fragments are not confirmed. ${formatAltarInventoryStatus(inventory)}.`);
      await sleepWithAbort(GAME_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const tick = await readAltarTravelTick(window, lastPlayerTile, apiSnapshotForTick);
    if (!tick) {
      warnWithDelta(`${stepLabel} tick ${attempt}: startup calibration unavailable before Blood altar click; retrying.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (tick.playerTile) {
      observeArceuusMinimapMovement(stepLabel, tick.playerTile);
      lastPlayerTile = tick.playerTile;
    }

    if (!tick.playerTile) {
      warnWithDelta(`${stepLabel} cannot click Blood altar because player tile is unavailable. ${formatBloodAltarTravelTick(tick, routeContext, bloodAltarTarget)}.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const distanceToBloodAltar = getWorldTileDistanceToRectangle(tick.playerTile, bloodAltarTarget.rectangle);
    if (distanceToBloodAltar <= ARCEUUS_BLOOD_ALTAR_CLICK_DISTANCE_TILES) {
      logWithDelta(
        `${stepLabel} Blood altar in click range: player=${formatWorldTile(tick.playerTile)} distance=${distanceToBloodAltar} target=${formatBloodAltarTarget(bloodAltarTarget)} ${formatAltarInventoryStatus(inventory)}.`,
      );
      const confirmedInventory = await clickBloodAltarAndConfirm(tick, tick.playerTile, bloodAltarTarget, attempt, stepLabel);
      if (confirmedInventory) {
        logWithDelta(`${stepLabel} complete: Blood altar crafted runes; returning to ${STEP_MINE_ID}. ${formatAltarInventoryStatus(confirmedInventory)}.`);
        return { nextStepId: STEP_MINE_ID };
      }
    } else {
      const clickedAltarMinimap = await clickAltarMinimapWaypoint(
        tick,
        tick.playerTile,
        attempt,
        "Arceuus blood altar",
        bloodAltarDestinationTile,
        bloodAltarTargetTiles,
        routeContext,
        stepLabel,
        minimapRouteCache,
      );
      if (clickedAltarMinimap.status === "missing-shortcut-green") {
        missingGreenOutlineCount += 1;
        if (missingGreenOutlineCount === 1 || missingGreenOutlineCount % 5 === 0) {
          warnWithDelta(
            `${stepLabel} shortcut green outline missing for planner-selected shortcut. misses=${missingGreenOutlineCount} distance=${clickedAltarMinimap.distanceToShortcut} target=${formatWorldRouteAgilityShortcutTarget(clickedAltarMinimap.shortcutTarget)} routeLink=${clickedAltarMinimap.route.nextLinkUsage ? `${clickedAltarMinimap.route.nextLinkUsage.label}@${formatWorldTile(clickedAltarMinimap.route.nextLinkUsage.fromTile)}->${formatWorldTile(clickedAltarMinimap.route.nextLinkUsage.toTile)}` : "none"} green=${tick.greenOutlines.map(formatGreenOutline).join("; ") || "none"}.`,
          );
        }

        await rotateCameraForAltarShortcutSearch(missingGreenOutlineCount, clickedAltarMinimap.shortcutTarget, stepLabel);
      } else if (clickedAltarMinimap.status === "clicked") {
        missingGreenOutlineCount = 0;
      } else {
        warnWithDelta(`${stepLabel} minimap click unavailable; falling back to projected world-tile route click before Blood altar craft.`);
        await clickAltarRouteWaypoint(
          tick,
          tick.playerTile,
          attempt,
          "Arceuus blood altar",
          bloodAltarDestinationTile,
          bloodAltarTargetTiles,
          routeContext,
          stepLabel,
          projectedRouteCache,
        );
      }
    }

    await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
  }

  return { stop: true };
}

type ArceuusMiningCycleOptions = {
  stepLabel: string;
  nextStepId: ArceuusBloodRuneV2StepId;
  windowMissingMessage: string;
};

async function runMiningStep(): Promise<StepHandlerResult> {
  return runMiningCycleStep({
    stepLabel: "Step 1 mining",
    nextStepId: STEP_ALTAR_TRAVEL_ID,
    windowMissingMessage: "RuneLite window not found for Arceuus Blood Rune V2 mining step.",
  });
}

async function runReMineStep(): Promise<StepHandlerResult> {
  return runMiningCycleStep({
    stepLabel: "Step 4 re-mine",
    nextStepId: STEP_DARK_ALTAR_SECOND_ID,
    windowMissingMessage: "RuneLite window not found for Arceuus Blood Rune V2 re-mine step.",
  });
}

async function runMiningCycleStep(options: ArceuusMiningCycleOptions): Promise<StepHandlerResult> {
  focusRuneLiteWindowForAutomation();
  const window = getRuneLite();
  if (!window) {
    warnWithDelta(`${options.stepLabel} cannot start because RuneLite window was not found.`);
    notifyAutomateBotError(options.windowMissingMessage);
    return { stop: true };
  }

  const targets = resolveArceuusMiningTargets();
  const config = getSavedArceuusBloodRuneConfig();
  const routeContext = buildWorldRouteAgilityContext({ agilityLevel: config.agilityLevel });
  logWithDelta(
    `${options.stepLabel} route context: agilityLevel=${routeContext.agilityLevel} routeLinks=${formatWorldRouteAgilityShortcutSummary(routeContext.availableShortcuts)} blockedUnavailableShortcuts=${formatWorldRouteAgilityShortcutSummary(routeContext.unavailableShortcuts)} blockedTiles=${getArceuusBlockedRouteTiles(routeContext).length}.`,
  );
  let lastPlayerTile: WorldTile | null = null;
  let lastInventoryStatus: ArceuusInventoryStatus | null = null;
  let nextInventoryCheckAtMs = 0;
  let missingInventoryCheckCount = 0;
  let attempt = 0;
  const routeCache = createArceuusRoutePlanCache();
  while (AppState.automateBotRunning) {
    attempt += 1;
    const nowMs = Date.now();
    let apiSnapshotForTick: RuneLiteLocalApiSnapshot | null = null;
    if (nowMs >= nextInventoryCheckAtMs) {
      nextInventoryCheckAtMs = nowMs + ARCEUUS_MINING_INVENTORY_CHECK_INTERVAL_MS;
      try {
        apiSnapshotForTick = await fetchRuneLiteLocalApiSnapshot(350);
        const previousFreeSlots = lastInventoryStatus?.freeSlots ?? null;
        lastInventoryStatus = createInventoryStatus(apiSnapshotForTick, Date.now());
        missingInventoryCheckCount = 0;
        if (previousFreeSlots !== lastInventoryStatus.freeSlots || lastInventoryStatus.isFull || attempt === 1) {
          logWithDelta(`${options.stepLabel} inventory check: ${formatInventoryStatus(lastInventoryStatus)}.`);
        }

        if (lastInventoryStatus.isFull) {
          logWithDelta(`${options.stepLabel} complete: inventory is full; advancing to ${options.nextStepId}.`);
          return { nextStepId: options.nextStepId };
        }
      } catch (error) {
        missingInventoryCheckCount += 1;
        if (missingInventoryCheckCount === 1 || missingInventoryCheckCount % 5 === 0) {
          const message = error instanceof Error ? error.message : String(error);
          warnWithDelta(`${options.stepLabel} inventory check unavailable; retrying every 2 game ticks. misses=${missingInventoryCheckCount} error=${message}`);
        }
      }
    }

    const tick = await readMiningTick(window, lastPlayerTile, apiSnapshotForTick);
    if (!tick) {
      warnWithDelta(`${options.stepLabel} tick ${attempt}: startup calibration unavailable; retrying.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (tick.playerTile) {
      observeArceuusMinimapMovement(options.stepLabel, tick.playerTile);
      lastPlayerTile = tick.playerTile;
    }

    if (attempt === 1 || attempt % 5 === 0 || tick.miningStatus.isMining) {
      logWithDelta(`${options.stepLabel} tick ${attempt}: ${formatMiningTick(tick, lastInventoryStatus)}.`);
    }

    if (tick.miningStatus.isMining) {
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (!tick.playerTile) {
      warnWithDelta(`${options.stepLabel} cannot route because player tile is unavailable. ${formatMiningTick(tick, lastInventoryStatus)}.`);
      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    const nearestTarget = selectNearestMiningTarget(tick.playerTile, targets);
    const distanceToObject = getWorldTileDistanceToRectangle(tick.playerTile, nearestTarget.rectangle);
    if (isPlayerInMiningObjectClickDistance(tick.playerTile, nearestTarget)) {
      logWithDelta(
        `${options.stepLabel} map-data confirms click distance for ${nearestTarget.label}: player=${formatWorldTile(tick.playerTile)} distance=${distanceToObject} footprint=${nearestTarget.rectangle.x},${nearestTarget.rectangle.y} ${nearestTarget.rectangle.width}x${nearestTarget.rectangle.height} visibleActive=${tick.visibleTarget ? `${tick.visibleTarget.centerX},${tick.visibleTarget.centerY}` : "none"}.`,
      );
      const confirmed = await clickMiningObjectFromDistance(tick, tick.playerTile, nearestTarget, options.stepLabel);
      if (confirmed) {
        logWithDelta(`${options.stepLabel} started from object-distance click; staying in this mining step until inventory is full.`);
      }

      await sleepWithAbort(BOT_TICK_MS, () => AppState.automateBotRunning);
      continue;
    }

    if (tick.visibleTarget) {
      logWithDelta(
        `${options.stepLabel} active node is visible outside conservative object distance; checking route topology before direct 3D click. player=${formatWorldTile(tick.playerTile)} nearest=${nearestTarget.label} distance=${distanceToObject} visible=${tick.visibleTarget.centerX},${tick.visibleTarget.centerY} size=${tick.visibleTarget.width}x${tick.visibleTarget.height} target=${formatMiningTarget(nearestTarget)}.`,
      );
    }

    logWithDelta(
      `${options.stepLabel} player not in click distance; routing to target perimeter. player=${formatWorldTile(tick.playerTile)} nearest=${nearestTarget.label} distance=${distanceToObject} target=${formatMiningTarget(nearestTarget)}.`,
    );
    await clickRouteWaypoint(tick, tick.playerTile, targets, attempt, routeContext, options.stepLabel, routeCache);
  }

  return { stop: true };
}

function stopAtUnimplementedStep(step: ArceuusBloodRuneV2Step): void {
  warnWithDelta(`Reached ${step.name} (${step.id}), but this v2 step is empty for now. Stopping bot.`);
  stopAutomateBot("bot");
}

function resolveStartStep(stepId: string | null): ArceuusBloodRuneV2Step | null {
  if (!stepId) {
    return getDefaultStartStep();
  }

  return isArceuusBloodRuneV2StepId(stepId) ? stepById.get(stepId)! : null;
}

function resolveInventoryStartStep(inventory: ArceuusAltarInventoryStatus): { step: ArceuusBloodRuneV2Step; reason: string } {
  const hasDarkBlocks = inventory.darkBlocks.length > 0;
  const hasFragments = inventory.darkFragments.length > 0;
  const fullDense = isFullOfDenseEssenceBlocks(inventory);

  if (hasDarkBlocks && hasFragments) {
    return {
      step: stepById.get(STEP_BLOOD_ALTAR_ID)!,
      reason: "dark essence fragments and dark essence blocks are both present",
    };
  }

  if (hasDarkBlocks) {
    return {
      step: stepById.get(STEP_CHISEL_DARK_ESSENCE_ID)!,
      reason: "dark essence blocks are present without dark essence fragments",
    };
  }

  if (hasFragments && fullDense) {
    return {
      step: stepById.get(STEP_DARK_ALTAR_SECOND_ID)!,
      reason: "dark essence fragments are present and inventory is full with dense essence blocks",
    };
  }

  if (hasFragments) {
    return {
      step: stepById.get(STEP_RE_MINE_ID)!,
      reason: "dark essence fragments are present and inventory is not full with dense essence blocks",
    };
  }

  return {
    step: getFirstAutomationStep(),
    reason: "no dark essence recovery state detected",
  };
}

async function resolveAutomaticStartStepFromInventory(): Promise<ArceuusBloodRuneV2Step> {
  try {
    const inventory = createAltarInventoryStatus(await fetchRuneLiteLocalApiSnapshot(500), Date.now());
    const resolved = resolveInventoryStartStep(inventory);
    logWithDelta(
      `Initial phase inventory start decision: ${resolved.reason}; starting ${resolved.step.name} (${resolved.step.id}). ${formatAltarInventoryStatus(inventory, { includeApiSkills: true })}.`,
    );
    return resolved.step;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`Initial phase inventory start decision unavailable; defaulting to ${getFirstAutomationStep().name}. error=${message}`);
    return getFirstAutomationStep();
  }
}

async function runInitialPluginCheck(
  requestedStartStep: ArceuusBloodRuneV2Step,
): Promise<ArceuusBloodRuneV2Step | null> {
  const pluginCheckStep = getPluginCheckStep();
  setAutomateBotCurrentStep(pluginCheckStep.id);
  logWithDelta(`Initial phase: checking required RuneLite plugins before ${requestedStartStep.name}.`);

  const preflight = await runArceuusBloodRuneV2PluginPreflight();
  const checkSummary = formatRuneLitePluginPreflightChecks(preflight);
  if (!preflight.ok) {
    const message = preflight.error ?? "Arceuus Blood Rune V2 startup check failed.";
    warnWithDelta(`Initial phase failed. ${checkSummary}`);
    notifyAutomateBotError(message);
    stopAutomateBot("bot");
    return null;
  }

  logWithDelta(`Initial phase passed. ${checkSummary}`);
  return requestedStartStep.id === pluginCheckStep.id ? resolveAutomaticStartStepFromInventory() : requestedStartStep;
}

async function runArceuusBloodRuneV2(startStepId: string | null): Promise<void> {
  if (isArceuusV2LoopRunning) {
    warnWithDelta("startup skipped because the v2 loop is already running.");
    return;
  }

  const requestedStartStep = resolveStartStep(startStepId);
  if (!requestedStartStep) {
    warnWithDelta(`Unknown ${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_V2_BOT_ID} step: ${startStepId ?? "none"}.`);
    stopAutomateBot("bot");
    return;
  }

  isArceuusV2LoopRunning = true;
  if (arceuusV2StartedAtMs === null) {
    arceuusV2StartedAtMs = Date.now();
  }

  try {
    logWithDelta(`STARTED. requestedStartStep=${requestedStartStep.name} (${requestedStartStep.id}).`);
    resetArceuusMinimapMovementLearning("bot-started");

    const startStep = await runInitialPluginCheck(requestedStartStep);
    if (!startStep || !AppState.automateBotRunning) {
      return;
    }

    let currentStep: ArceuusBloodRuneV2Step | null = startStep;
    while (AppState.automateBotRunning && currentStep) {
      setAutomateBotCurrentStep(currentStep.id);

      const handler: StepHandler | undefined = stepHandlers[currentStep.id];
      if (!handler) {
        stopAtUnimplementedStep(currentStep);
        return;
      }

      const result: StepHandlerResult | void = await handler(currentStep);
      if (!AppState.automateBotRunning) {
        return;
      }

      if (!result || result.stop) {
        logWithDelta(`Stopping after implemented step ${currentStep.name}.`);
        stopAutomateBot("bot");
        return;
      }

      const nextStepId: ArceuusBloodRuneV2StepId | null = result.nextStepId ?? null;
      if (!nextStepId) {
        logWithDelta(`No next step returned after ${currentStep.name}; stopping.`);
        stopAutomateBot("bot");
        return;
      }

      currentStep = stepById.get(nextStepId) ?? null;
      if (!currentStep) {
        warnWithDelta(`Step handler returned unknown next step: ${nextStepId}.`);
        stopAutomateBot("bot");
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorWithDelta(`crashed - ${message}`);
    stopAutomateBot("bot");
  } finally {
    isArceuusV2LoopRunning = false;
    arceuusV2StartedAtMs = null;
    if (!AppState.automateBotRunning) {
      setAutomateBotCurrentStep(null);
    }
  }
}

export function onRunecraftingArceuusBloodRuneV2BotStart(): void {
  void runArceuusBloodRuneV2(null);
}

export function onRunecraftingArceuusBloodRuneV2BotStartFromStep(stepId: string): void {
  void runArceuusBloodRuneV2(stepId);
}
