import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap, type ScreenBitmap } from "../windowsScreenCapture";
import {
  ALL_IN_ONE_MINING_ORE_TYPES,
  getAllInOneMiningSelectedOreTypes,
  isAllInOneMiningOreType,
  setAllInOneMiningLearnedMiningStats,
  type AllInOneMiningConfig,
  type AllInOneMiningOreDefinition,
} from "./all-in-one-mining-config";
import { readOsrsCacheMapRegionView, type OsrsCacheMapObject, type OsrsCacheMapRegionView } from "./cache/cache-map-view";
import { MINING_ALL_IN_ONE_BOT_ID } from "./definitions";
import { runBotEngine, sleepWithAbort, type BotEngineLoopState } from "./engine/bot-engine";
import { parseWorldTileFromMatchedLine, type WorldTile } from "./mapping/world-coordinate";
import { fetchRuneLiteLocalApiInventory, type RuneLiteLocalApiItem } from "./runelite-local-api/runelite-local-api";
import type {
  EndToEndSceneMouseCalibration,
  EndToEndSceneMouseCalibrationFit,
  EndToEndSceneMouseCalibrationSample,
} from "./end-to-end-config";
import { detectOverlayBoxInScreenshot } from "./shared/coordinate-box-detector";
import { detectInventoryCount } from "./shared/inventory-count-detector";
import { detectMiningBoxStatusInScreenshot, type MiningBoxStatusDetection } from "./shared/mining-box-status-detector";
import { detectMithrilActiveMarkerBoxesInScreenshot, type MithrilActiveMarkerBox } from "./shared/mithril-active-marker-detector";
import { axisDistance, clamp, randomIntInclusive } from "./shared/osrs-helper";
import { clickScreenPoint, getSafeScreenPoint, moveMouseHumanLike, type ScreenPoint } from "./shared/robot-clicker";
import { saveBitmapWithDebugOverlay, type DebugOverlayShape } from "./shared/debug-image-overlay";
import { saveBitmapAsync } from "./shared/save-bitmap";
import {
  SCENE_MOUSE_CALIBRATION_MAX_SAMPLES,
  fitSceneMouseCalibrationSamples,
  getCompatibleSavedSceneMouseCalibration,
  isSceneMouseCalibrationFitAcceptable,
  projectSceneMouseCalibrationLocalPoint,
  saveSharedSceneMouseCalibration,
} from "./shared/scene-mouse-calibration";
import { readStartupPlayerTileCalibration, type StartupPlayerTileCalibration } from "./shared/startup-calibration";
import {
  executeMinimapWorldClickPlan,
  projectWorldTileToMinimapClick,
} from "./shared/minimap-world-clicker";
import { detectBankDepositIconWithOrb } from "./shared/bank-deposit-orb-detector";
import {
  buildWorldRouteRectanglePerimeterTiles,
  formatWorldRoutePlan,
  formatWorldTile,
  getWorldTileChebyshevDistance,
  getWorldTileDistanceToRectangle,
  planWorldRouteToTiles,
  type WorldRoutePlan,
  type WorldRouteRectangle,
  type WorldRouteTile,
} from "./shared/world-route-planner";
import type { RobotBitmap } from "./shared/ocr-engine";
import {
  getSavedAllInOneMiningConfig,
  setSavedAllInOneMiningConfig,
} from "../csvOperator";

const BOT_NAME = "Mining All-In-One";
const GAME_TICK_MS = 600;
const SEARCH_REGION_RADIUS = 1;
const BANK_TARGET_SEARCH_REGION_RADIUS = 1;
const DIRECT_SCENE_CLICK_MAX_DISTANCE_TILES = 9;
const BANK_DIRECT_SCENE_CLICK_MAX_DISTANCE_TILES = 12;
const ROCK_INTERACTION_RADIUS_TILES = 1;
const BANK_INTERACTION_RADIUS_TILES = 1;
const ROUTE_WAYPOINT_STEP_LIMIT = 18;
const ROUTE_MAX_CROSS_REGION_COUNT = 16;
const MINIMAP_MAX_CLICK_RADIUS_RATIO = 0.84;
const ACTION_LOCK_TICKS_AFTER_SCENE_CLICK = 2;
const MINING_CLICK_CONFIRM_TICKS = 8;
const BANK_CLICK_CONFIRM_TICKS = 5;
const INVENTORY_HTTP_API_TIMEOUT_MS = 140;
const FAILED_TARGET_COOLDOWN_MS = 25_000;
const STATUS_LOG_INTERVAL_MS = 2_400;
const DIRECT_CLICK_SAFE_EDGE_MARGIN_PX = 18;
const MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX = 24;
const MINING_SCENE_REFERENCE_SCALE_PERCENT = 125;
const MINING_SCENE_RIGHT_PANEL_WIDTH_LOGICAL = 245;
const MINING_SCENE_BOTTOM_UI_HEIGHT_LOGICAL = 170;
const MINING_SCENE_TARGET_EDGE_MARGIN_PX_AT_125 = 90;
const MINING_SCENE_MAX_HOVER_ATTEMPTS = 6;
const MINING_SCENE_DIRECT_FIT_MIN_SAMPLES = 5;
const MINING_SCENE_DIRECT_FIT_MAX_MEAN_ERROR_PX = 8;
const MINING_SCENE_ACCEPT_TILE_ERROR = 0;
const MINING_SCENE_FALLBACK_TILE_ERROR = 0;
const MINING_SCENE_LOCAL_FIT_MAX_TILE_ERROR = 6;
const MINING_SCENE_CORRECTION_JITTER_PX = 1;
const MINING_SCENE_CALIBRATION_MAX_EXPECTED_TILE_ERROR = 10;
const MINING_MOUSE_COORDINATE_CROP_LEFT_AT_125_PX = 28;
const MINING_MOUSE_COORDINATE_CROP_TOP_AT_125_PX = 28;
const MINING_MOUSE_COORDINATE_CROP_WIDTH_AT_125_PX = 360;
const MINING_MOUSE_COORDINATE_CROP_HEIGHT_AT_125_PX = 240;
const MINING_MOUSE_HOVER_SETTLE_MIN_MS = 70;
const MINING_MOUSE_HOVER_SETTLE_MAX_MS = 145;
const MINING_MOUSE_MOVE_MIN_MS = 105;
const MINING_MOUSE_MOVE_MAX_MS = 520;
const MINING_MOUSE_MOVE_JITTER_PX = 1.4;
const MINING_MOUSE_MOVE_OVERSHOOT_CHANCE = 0.22;
const MINING_WORK_AREA_MIN_TARGETS = 3;
const MINING_WORK_AREA_MAX_TARGETS = 8;
const MINING_WORK_AREA_BOUNDS_PADDING_TILES = 1;
const MINING_WORK_AREA_PLAYER_RESET_MARGIN_TILES = 18;
const MINING_DEFAULT_RESPAWN_MS = 30_000;
const MINING_DEFAULT_MINE_MS = 12_000;
const MINING_MIN_OBSERVED_MINE_MS = 1_200;
const MINING_MAX_OBSERVED_MINE_MS = 600_000;
const MINING_TARGET_WAIT_LOG_THRESHOLD_MS = 1_200;
const MINING_GUILD_RESPAWN_MULTIPLIER = 0.5;
const MINING_GUILD_UNDERGROUND_BOUNDS = [
  { minX: 3006, maxX: 3068, minY: 9705, maxY: 9776, z: 0 },
] as const;
const ACTIVE_TARGET_YELLOW_MARKER_MIN_RADIUS_PX = 44;
const ACTIVE_TARGET_YELLOW_MARKER_MAX_RADIUS_PX = 96;
const ACTIVE_TARGET_YELLOW_MARKER_TILE_RADIUS_MULTIPLIER = 1.45;
const BANK_UI_CLICK_SAFE_EDGE_MARGIN_PX = 3;
const INVENTORY_FULL_FREE_SLOT_COUNT = 0;
const FALLBACK_INVENTORY_EMPTY_FREE_SLOT_COUNT = 28;
const BANK_DEPOSIT_ORB_REFERENCE_ICON = "test-images/icon/bank-deposit/bank-deposit-icon.png";
const MINING_TARGET_SWITCH_DEBUG_DIR = "test-image-debug";
const BANK_DEPOSIT_ORB_REFERENCE_WIDTH_PX = 42;
const EMPTY_BAG_IN_BANK_OFFSET_FROM_ORB_REFERENCE = { x: -67.5, y: 1.5 };
const BANK_ORB_FIND_RETRY_MAX = 3;
const BANK_ORB_MAX_DISTANCE_FROM_DEPOSIT_RATIO = 0.32;
const BANK_ORB_MAX_DISTANCE_FROM_DEPOSIT_MIN_PX = 360;
const BANK_ORB_MAX_DISTANCE_FROM_DEPOSIT_MAX_PX = 700;
const BANK_TARGET_PRIORITIES = [
  { objectName: "Bank Deposit Box", priority: 0 },
  { objectName: "Bank deposit box", priority: 0 },
  { objectName: "Deposit Box", priority: 1 },
  { objectName: "Bank Deposit Chest", priority: 2 },
  { objectName: "Bank chest", priority: 3 },
] as const;
const ORE_RESPAWN_MS_BY_ID: Record<string, number> = {
  clay: 2_400,
  copper: 2_400,
  tin: 2_400,
  iron: 5_400,
  coal: 30_000,
  silver: 60_000,
  gold: 60_000,
  mithril: 120_000,
  adamantite: 240_000,
  runite: 720_000,
  blurite: 60_000,
  gem: 60_000,
  limestone: 4_800,
  sandstone: 4_800,
  granite: 4_800,
  amethyst: 240_000,
  basalt: 4_800,
  "rune-essence": 2_400,
  "dense-runestone": 7_200,
  daeyalt: 60_000,
  "volcanic-sulphur": 4_800,
  lovakite: 30_000,
  barronite: 30_000,
  calcified: 30_000,
  salt: 4_800,
  saltpetre: 4_800,
  "crashed-star": 30_000,
  "ore-vein": 30_000,
};

type EngineFunctionKey = "loop";
type BotPhase =
  | "searching"
  | "walking"
  | "confirming-click"
  | "mining"
  | "banking-search-target"
  | "banking-walking"
  | "banking-find-orb";

type PendingMiningClick = {
  targetKey: string;
  targetLabel: string;
  clickedAtMs: number;
  deadlineMs: number;
  clickTile: WorldRouteTile;
};

type ActiveMiningTarget = {
  targetKey: string;
  targetLabel: string;
  oreId: string;
  oreLabel: string;
  clickTile: WorldRouteTile;
  lastClickScreen: ScreenPoint;
  clickedAtMs: number;
};

type MiningSceneProjection = {
  screenPoint: ScreenPoint;
  localPoint: ScreenPoint;
  targetTile: WorldRouteTile;
  tilePx: number;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  source: "rough-model" | "saved-3d-calibration";
  calibrationSampleCount: number | null;
  calibrationMeanErrorPx: number | null;
};

type MiningMouseCoordinateRead = {
  tile: WorldRouteTile;
  line: string;
  cropBounds: { x: number; y: number; width: number; height: number };
  boxScreen: { x: number; y: number; width: number; height: number };
};

type MiningMouseCoordinateProbe = {
  read: MiningMouseCoordinateRead | null;
  cropBounds: { x: number; y: number; width: number; height: number };
  debugPath: string;
};

type MiningSceneHoverAttempt = {
  point: ScreenPoint;
  read: MiningMouseCoordinateRead | null;
  errorTiles: number | null;
  debugPath: string;
  cropBounds: { x: number; y: number; width: number; height: number };
};

type MiningSceneHoverObservation = {
  point: ScreenPoint;
  read: MiningMouseCoordinateRead;
  errorTiles: number;
};

type MiningSceneClickPlan = {
  screenPoint: ScreenPoint;
  localPoint: ScreenPoint;
  initialScreenPoint: ScreenPoint;
  targetTile: WorldRouteTile;
  hoveredTile: WorldRouteTile | null;
  hoveredLine: string | null;
  hoverBoxScreen: { x: number; y: number; width: number; height: number } | null;
  attempts: MiningSceneHoverAttempt[];
  finalErrorTiles: number | null;
  projectionSource: MiningSceneProjection["source"];
  calibrationSampleCount: number | null;
  calibrationMeanErrorPx: number | null;
  clickReason: "tile-location-target-footprint" | "tile-location-nearest-target" | "saved-calibration-direct" | "projection-fallback";
};

type MiningSceneClickOptions = {
  sampleSource?: string;
  allowRoughProjectionFallbackClick?: boolean;
  requireHoverValidation?: boolean;
};

type FailedTargetCooldown = {
  key: string;
  untilMs: number;
  reason: string;
};

type MiningWorkArea = {
  id: string;
  createdAtMs: number;
  oreId: string;
  oreLabel: string;
  anchorTile: WorldRouteTile;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    z: number;
  };
  targetKeys: string[];
  desiredTargetCount: number;
  estimatedRespawnMs: number;
  estimatedMineMs: number;
};

type DepletedMiningTarget = {
  key: string;
  targetLabel: string;
  oreId: string;
  depletedAtMs: number;
  untilMs: number;
  observedMineMs: number | null;
  reason: string;
};

type MiningOreSessionStats = {
  oreId: string;
  sampleCount: number;
  averageMineMs: number;
  lastMineMs: number;
  updatedAtMs: number;
};

type MiningRespawnInfo = {
  baseMs: number;
  effectiveMs: number;
  multiplier: number;
  source: "default" | "mining-guild";
};

type BotState = BotEngineLoopState<EngineFunctionKey> & {
  phase: BotPhase;
  actionLockUntilMs: number;
  expectedTile: WorldRouteTile | null;
  pendingMiningClick: PendingMiningClick | null;
  activeMiningTarget: ActiveMiningTarget | null;
  waitingForActiveTargetYellowSinceMs: number | null;
  workArea: MiningWorkArea | null;
  depletedTargets: DepletedMiningTarget[];
  miningStatsByOreId: Record<string, MiningOreSessionStats>;
  failedTargets: FailedTargetCooldown[];
  failedBankTargets: FailedTargetCooldown[];
  bankDepositScreen: ScreenPoint | null;
  bankOrbScreen: ScreenPoint | null;
  emptyBagInBankScreen: ScreenPoint | null;
  bankOrbFindAttemptCount: number;
  lastStatusLogAtMs: number;
};

type TickCapture = {
  calibration: StartupPlayerTileCalibration | null;
  bitmap: ScreenBitmap | null;
  playerTile: WorldTile | null;
  miningStatus: MiningBoxStatusDetection | null;
  inventoryCount: number | null;
  inventoryCountSource: "http-api" | "ocr" | "unavailable";
  inventoryCountSummary: string;
  inventoryItems: readonly RuneLiteLocalApiItem[] | null;
};

type MiningCacheTarget = {
  key: string;
  oreId: string;
  oreLabel: string;
  objectId: number;
  objectName: string;
  rectangle: WorldRouteRectangle;
  clickTile: WorldRouteTile;
  interactionTiles: WorldRouteTile[];
  regionX: number;
  regionY: number;
};

type BankCacheTarget = {
  key: string;
  priority: number;
  targetLabel: string;
  objectId: number;
  objectName: string;
  rectangle: WorldRouteRectangle;
  clickTile: WorldRouteTile;
  interactionTiles: WorldRouteTile[];
  regionX: number;
  regionY: number;
};

type MiningTargetPathSelection = {
  target: MiningCacheTarget;
  route: WorldRoutePlan;
  targetCount: number;
};

type MiningTargetPathSelectionResult =
  | { status: "selected"; selection: MiningTargetPathSelection }
  | { status: "unavailable"; route: WorldRoutePlan }
  | { status: "unmapped"; route: WorldRoutePlan }
  | { status: "empty" };

type MiningSchedulerSelectionResult =
  | {
      status: "selected";
      selection: MiningTargetPathSelection & {
        scoreMs: number;
        travelMs: number;
        waitMs: number;
        availableAtMs: number;
        pathfinderMs: number;
      };
    }
  | {
      status: "waiting";
      target: MiningCacheTarget;
      route: WorldRoutePlan;
      waitMs: number;
      availableAtMs: number;
      targetCount: number;
    }
  | { status: "unavailable"; reason: string; targetCount: number; pathfinderMs: number }
  | { status: "empty"; targetCount: number };

type RegionCoordinate = {
  regionX: number;
  regionY: number;
};

let isLoopRunning = false;
let startedAtMs: number | null = null;
let cachedRegionViews = new Map<string, OsrsCacheMapRegionView>();
let bankDepositOrbReferenceBitmap: RobotBitmap | null = null;
let bankDepositOrbReferenceLoadAttempted = false;

function formatElapsedSinceStart(): string {
  if (startedAtMs === null) {
    return "+00:00.000";
  }

  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = elapsedMs % 1000;
  return `+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function log(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] Automate Bot (${BOT_NAME}): ${message}`);
}

function warn(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] Automate Bot (${BOT_NAME}): ${message}`);
}

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }

  stopAutomateBot("bot");
}

function createInitialState(config: AllInOneMiningConfig = getSavedAllInOneMiningConfig()): BotState {
  return {
    loopIndex: 0,
    currentFunction: "loop",
    phase: "searching",
    actionLockUntilMs: 0,
    expectedTile: null,
    pendingMiningClick: null,
    activeMiningTarget: null,
    waitingForActiveTargetYellowSinceMs: null,
    workArea: null,
    depletedTargets: [],
    miningStatsByOreId: getInitialMiningStatsByOreId(config),
    failedTargets: [],
    failedBankTargets: [],
    bankDepositScreen: null,
    bankOrbScreen: null,
    emptyBagInBankScreen: null,
    bankOrbFindAttemptCount: 0,
    lastStatusLogAtMs: 0,
  };
}

function isActionLocked(state: BotState, nowMs: number): boolean {
  return state.actionLockUntilMs > nowMs;
}

function deadlineFromNowTicks(ticks: number, nowMs: number): number {
  return nowMs + Math.max(1, Math.round(ticks)) * GAME_TICK_MS;
}

function shouldLogStatus(state: BotState, nowMs: number): boolean {
  return nowMs - state.lastStatusLogAtMs >= STATUS_LOG_INTERVAL_MS;
}

function withStatusLogTime(state: BotState, nowMs: number): BotState {
  return {
    ...state,
    lastStatusLogAtMs: nowMs,
  };
}

function formatInventoryCount(tick: Pick<TickCapture, "inventoryCount" | "inventoryCountSource" | "inventoryCountSummary">): string {
  return `${tick.inventoryCount ?? "?"} free slots via ${tick.inventoryCountSource}${
    tick.inventoryCountSummary ? ` (${tick.inventoryCountSummary})` : ""
  }`;
}

async function readInventoryFreeSlots(bitmap: ScreenBitmap): Promise<{
  count: number | null;
  source: "http-api" | "ocr";
  summary: string;
  items: readonly RuneLiteLocalApiItem[] | null;
}> {
  try {
    const inventory = await fetchRuneLiteLocalApiInventory(INVENTORY_HTTP_API_TIMEOUT_MS);
    return {
      count: inventory.freeSlots,
      source: "http-api",
      summary: `${inventory.baseUrl}${inventory.path} occupied=${inventory.occupiedSlots}/28`,
      items: inventory.inventory,
    };
  } catch (error) {
    const ocr = detectInventoryCount(bitmap);
    const message = error instanceof Error ? error.message : String(error);
    return {
      count: ocr.count,
      source: "ocr",
      summary: `http-api unavailable: ${message}`,
      items: null,
    };
  }
}

function getSelectedOreInventoryItemIds(selectedOreDefinitions: readonly AllInOneMiningOreDefinition[]): Set<number> {
  const itemIds = new Set<number>();
  for (const ore of selectedOreDefinitions) {
    for (const itemId of ore.inventoryItemIds ?? []) {
      itemIds.add(itemId);
    }
  }

  return itemIds;
}

function getInventoryItemQuantity(items: readonly RuneLiteLocalApiItem[], itemIds: ReadonlySet<number>): number {
  return items
    .filter((item) => itemIds.has(item.id))
    .reduce((total, item) => total + Math.max(0, item.quantity), 0);
}

function formatInventoryItemIds(itemIds: ReadonlySet<number>): string {
  return [...itemIds].sort((a, b) => a - b).join(",");
}

function getInitialMiningStatsByOreId(config: AllInOneMiningConfig): Record<string, MiningOreSessionStats> {
  const statsByOreId: Record<string, MiningOreSessionStats> = {};
  for (const [oreId, stats] of Object.entries(config.learnedMiningStatsByOreId ?? {})) {
    if (!Number.isFinite(stats.averageMineMs) || stats.averageMineMs <= 0) {
      continue;
    }

    statsByOreId[oreId] = {
      oreId,
      sampleCount: Math.max(0, Math.round(stats.sampleCount)),
      averageMineMs: Math.max(0, Math.round(stats.averageMineMs)),
      lastMineMs: Math.max(0, Math.round(stats.lastMineMs)),
      updatedAtMs: 0,
    };
  }

  return statsByOreId;
}

function getOreDefinition(oreId: string): AllInOneMiningOreDefinition | null {
  return ALL_IN_ONE_MINING_ORE_TYPES.find((ore) => ore.id === oreId) ?? null;
}

function getSelectedOreDefinitions(config: AllInOneMiningConfig): AllInOneMiningOreDefinition[] {
  return getAllInOneMiningSelectedOreTypes(config)
    .map(getOreDefinition)
    .filter((ore): ore is AllInOneMiningOreDefinition => ore !== null);
}

function getCacheObjectNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function buildSelectedOreDefinitionByCacheName(
  selectedOreDefinitions: readonly AllInOneMiningOreDefinition[],
): Map<string, AllInOneMiningOreDefinition> {
  const map = new Map<string, AllInOneMiningOreDefinition>();
  for (const ore of selectedOreDefinitions) {
    for (const name of ore.cacheObjectNames) {
      map.set(getCacheObjectNameKey(name), ore);
    }
  }

  return map;
}

function getRegionKey(regionX: number, regionY: number): string {
  return `${regionX},${regionY}`;
}

function readCachedRegionView(regionX: number, regionY: number): OsrsCacheMapRegionView {
  const key = getRegionKey(regionX, regionY);
  const cached = cachedRegionViews.get(key);
  if (cached) {
    return cached;
  }

  const view = readOsrsCacheMapRegionView({ regionX, regionY });
  cachedRegionViews.set(key, view);
  return view;
}

function getNearbyRegionCoordinates(playerTile: WorldTile, radius: number = SEARCH_REGION_RADIUS): RegionCoordinate[] {
  const regions: RegionCoordinate[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      regions.push({
        regionX: playerTile.regionX + dx,
        regionY: playerTile.regionY + dy,
      });
    }
  }

  return regions.sort((a, b) => {
    const aDistance = Math.max(Math.abs(a.regionX - playerTile.regionX), Math.abs(a.regionY - playerTile.regionY));
    const bDistance = Math.max(Math.abs(b.regionX - playerTile.regionX), Math.abs(b.regionY - playerTile.regionY));
    return aDistance - bDistance || a.regionX - b.regionX || a.regionY - b.regionY;
  });
}

function getObjectCenterTile(object: Pick<OsrsCacheMapObject, "worldX" | "worldY" | "z" | "sizeX" | "sizeY">): WorldRouteTile {
  return {
    x: object.worldX + Math.floor((Math.max(1, object.sizeX) - 1) / 2),
    y: object.worldY + Math.floor((Math.max(1, object.sizeY) - 1) / 2),
    z: object.z,
  };
}

function targetFromCacheObject(
  object: OsrsCacheMapObject,
  ore: AllInOneMiningOreDefinition,
  region: RegionCoordinate,
): MiningCacheTarget {
  const rectangle: WorldRouteRectangle = {
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: Math.max(1, object.sizeX),
    height: Math.max(1, object.sizeY),
  };
  const clickTile = getObjectCenterTile(object);
  return {
    key: `${ore.id}:${object.id}:${object.worldX},${object.worldY},${object.z}`,
    oreId: ore.id,
    oreLabel: ore.label,
    objectId: object.id,
    objectName: object.name,
    rectangle,
    clickTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, ROCK_INTERACTION_RADIUS_TILES),
    regionX: region.regionX,
    regionY: region.regionY,
  };
}

function getBankTargetPriority(objectName: string): { priority: number; label: string } | null {
  const objectNameKey = getCacheObjectNameKey(objectName);
  const priority = BANK_TARGET_PRIORITIES.find(
    (candidate) => getCacheObjectNameKey(candidate.objectName) === objectNameKey,
  );
  if (!priority) {
    return null;
  }

  return {
    priority: priority.priority,
    label: priority.objectName,
  };
}

function bankTargetFromCacheObject(
  object: OsrsCacheMapObject,
  region: RegionCoordinate,
  priority: { priority: number; label: string },
): BankCacheTarget {
  const rectangle: WorldRouteRectangle = {
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: Math.max(1, object.sizeX),
    height: Math.max(1, object.sizeY),
  };
  const clickTile = getObjectCenterTile(object);
  return {
    key: `bank:${object.id}:${object.worldX},${object.worldY},${object.z}`,
    priority: priority.priority,
    targetLabel: priority.label,
    objectId: object.id,
    objectName: object.name,
    rectangle,
    clickTile,
    interactionTiles: buildWorldRouteRectanglePerimeterTiles(rectangle, BANK_INTERACTION_RADIUS_TILES),
    regionX: region.regionX,
    regionY: region.regionY,
  };
}

function scanSelectedOreTargets(
  playerTile: WorldTile,
  selectedOreDefinitions: readonly AllInOneMiningOreDefinition[],
): MiningCacheTarget[] {
  const selectedByName = buildSelectedOreDefinitionByCacheName(selectedOreDefinitions);
  const targets: MiningCacheTarget[] = [];

  for (const region of getNearbyRegionCoordinates(playerTile)) {
    const view = readCachedRegionView(region.regionX, region.regionY);
    for (const object of view.objects) {
      const ore = selectedByName.get(getCacheObjectNameKey(object.name));
      if (!ore || object.z !== playerTile.z) {
        continue;
      }

      targets.push(targetFromCacheObject(object, ore, region));
    }
  }

  return targets;
}

function scanBankTargets(playerTile: WorldTile): BankCacheTarget[] {
  const targets: BankCacheTarget[] = [];

  for (const region of getNearbyRegionCoordinates(playerTile, BANK_TARGET_SEARCH_REGION_RADIUS)) {
    const view = readCachedRegionView(region.regionX, region.regionY);
    for (const object of view.objects) {
      if (object.z !== playerTile.z) {
        continue;
      }

      const priority = getBankTargetPriority(object.name);
      if (!priority) {
        continue;
      }

      targets.push(bankTargetFromCacheObject(object, region, priority));
    }
  }

  return targets;
}

function pruneFailedTargets(failedTargets: readonly FailedTargetCooldown[], nowMs: number): FailedTargetCooldown[] {
  return failedTargets.filter((entry) => entry.untilMs > nowMs);
}

function isTargetCoolingDown(target: { key: string }, failedTargets: readonly FailedTargetCooldown[]): boolean {
  return failedTargets.some((entry) => entry.key === target.key);
}

function getRouteTileKey(tile: Pick<WorldRouteTile, "x" | "y" | "z">): string {
  return `${tile.x},${tile.y},${tile.z}`;
}

function addFailedTargetCooldown(
  state: BotState,
  nowMs: number,
  targetKey: string,
  reason: string,
): BotState {
  return {
    ...state,
    failedTargets: [
      ...pruneFailedTargets(state.failedTargets, nowMs).filter((entry) => entry.key !== targetKey),
      { key: targetKey, untilMs: nowMs + FAILED_TARGET_COOLDOWN_MS, reason },
    ],
  };
}

function addFailedBankTargetCooldown(
  state: BotState,
  nowMs: number,
  targetKey: string,
  reason: string,
): BotState {
  return {
    ...state,
    failedBankTargets: [
      ...pruneFailedTargets(state.failedBankTargets, nowMs).filter((entry) => entry.key !== targetKey),
      { key: targetKey, untilMs: nowMs + FAILED_TARGET_COOLDOWN_MS, reason },
    ],
  };
}

function selectNearestBankTarget(playerTile: WorldRouteTile, targets: readonly BankCacheTarget[]): BankCacheTarget | null {
  return [...targets].sort((a, b) => {
    const aDistance = getWorldTileDistanceToRectangle(playerTile, a.rectangle);
    const bDistance = getWorldTileDistanceToRectangle(playerTile, b.rectangle);
    const aCenterDistance = getWorldTileChebyshevDistance(playerTile, a.clickTile);
    const bCenterDistance = getWorldTileChebyshevDistance(playerTile, b.clickTile);
    return (
      a.priority - b.priority ||
      aDistance - bDistance ||
      aCenterDistance - bCenterDistance ||
      a.objectId - b.objectId
    );
  })[0] ?? null;
}

function sortMiningTargetsByDirectDistance(playerTile: WorldRouteTile, targets: readonly MiningCacheTarget[]): MiningCacheTarget[] {
  return [...targets].sort((a, b) => {
    const aDistance = getWorldTileDistanceToRectangle(playerTile, a.rectangle);
    const bDistance = getWorldTileDistanceToRectangle(playerTile, b.rectangle);
    const aCenterDistance = getWorldTileChebyshevDistance(playerTile, a.clickTile);
    const bCenterDistance = getWorldTileChebyshevDistance(playerTile, b.clickTile);
    return (
      aDistance - bDistance ||
      aCenterDistance - bCenterDistance ||
      a.oreLabel.localeCompare(b.oreLabel) ||
      a.objectId - b.objectId
    );
  });
}

function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs)) {
    return "n/a";
  }

  if (durationMs >= 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(durationMs)}ms`;
}

function isTileInsideMiningGuildRespawnArea(tile: Pick<WorldRouteTile, "x" | "y" | "z">): boolean {
  return MINING_GUILD_UNDERGROUND_BOUNDS.some(
    (bounds) =>
      tile.z === bounds.z &&
      tile.x >= bounds.minX &&
      tile.x <= bounds.maxX &&
      tile.y >= bounds.minY &&
      tile.y <= bounds.maxY,
  );
}

function getOreRespawnInfo(oreId: string, tile?: Pick<WorldRouteTile, "x" | "y" | "z"> | null): MiningRespawnInfo {
  const baseMs = ORE_RESPAWN_MS_BY_ID[oreId] ?? MINING_DEFAULT_RESPAWN_MS;
  if (tile && isTileInsideMiningGuildRespawnArea(tile)) {
    return {
      baseMs,
      effectiveMs: Math.max(GAME_TICK_MS, Math.round(baseMs * MINING_GUILD_RESPAWN_MULTIPLIER)),
      multiplier: MINING_GUILD_RESPAWN_MULTIPLIER,
      source: "mining-guild",
    };
  }

  return {
    baseMs,
    effectiveMs: baseMs,
    multiplier: 1,
    source: "default",
  };
}

function getOreRespawnMs(oreId: string, tile?: Pick<WorldRouteTile, "x" | "y" | "z"> | null): number {
  return getOreRespawnInfo(oreId, tile).effectiveMs;
}

function formatRespawnInfo(respawn: MiningRespawnInfo): string {
  if (respawn.source === "mining-guild") {
    return `${formatDurationMs(respawn.effectiveMs)} source=mining-guild base=${formatDurationMs(respawn.baseMs)} multiplier=${respawn.multiplier}`;
  }

  return `${formatDurationMs(respawn.effectiveMs)} source=default`;
}

function getOreEstimatedMineMs(
  oreId: string,
  miningStatsByOreId: Readonly<Record<string, MiningOreSessionStats>>,
): number {
  const observed = miningStatsByOreId[oreId]?.averageMineMs;
  if (Number.isFinite(observed) && observed > 0) {
    return clamp(Math.round(observed), MINING_MIN_OBSERVED_MINE_MS, MINING_MAX_OBSERVED_MINE_MS);
  }

  return MINING_DEFAULT_MINE_MS;
}

function getDesiredMiningWorkAreaTargetCount(respawnMs: number, estimatedMineMs: number): number {
  const rawCount = Math.ceil(respawnMs / Math.max(MINING_MIN_OBSERVED_MINE_MS, estimatedMineMs)) + 2;
  return clamp(rawCount, MINING_WORK_AREA_MIN_TARGETS, MINING_WORK_AREA_MAX_TARGETS);
}

function getMiningTargetSortDistance(anchorTile: WorldRouteTile, playerTile: WorldRouteTile, target: MiningCacheTarget): number {
  return (
    getWorldTileChebyshevDistance(anchorTile, target.clickTile) * 10 +
    getWorldTileDistanceToRectangle(playerTile, target.rectangle)
  );
}

function isTargetInsideWorkArea(target: MiningCacheTarget, workArea: MiningWorkArea): boolean {
  return (
    target.oreId === workArea.oreId &&
    target.rectangle.z === workArea.bounds.z &&
    target.rectangle.x <= workArea.bounds.maxX &&
    target.rectangle.x + Math.max(1, target.rectangle.width) - 1 >= workArea.bounds.minX &&
    target.rectangle.y <= workArea.bounds.maxY &&
    target.rectangle.y + Math.max(1, target.rectangle.height) - 1 >= workArea.bounds.minY
  );
}

function getTargetsInsideWorkArea(targets: readonly MiningCacheTarget[], workArea: MiningWorkArea): MiningCacheTarget[] {
  const byKey = new Map(targets.filter((target) => isTargetInsideWorkArea(target, workArea)).map((target) => [target.key, target]));
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function isPlayerNearWorkArea(playerTile: WorldRouteTile, workArea: MiningWorkArea): boolean {
  if (playerTile.z !== workArea.bounds.z) {
    return false;
  }

  return (
    playerTile.x >= workArea.bounds.minX - MINING_WORK_AREA_PLAYER_RESET_MARGIN_TILES &&
    playerTile.x <= workArea.bounds.maxX + MINING_WORK_AREA_PLAYER_RESET_MARGIN_TILES &&
    playerTile.y >= workArea.bounds.minY - MINING_WORK_AREA_PLAYER_RESET_MARGIN_TILES &&
    playerTile.y <= workArea.bounds.maxY + MINING_WORK_AREA_PLAYER_RESET_MARGIN_TILES
  );
}

function createMiningWorkArea(
  nowMs: number,
  playerTile: WorldRouteTile,
  targets: readonly MiningCacheTarget[],
  miningStatsByOreId: Readonly<Record<string, MiningOreSessionStats>>,
): MiningWorkArea | null {
  const anchor = sortMiningTargetsByDirectDistance(playerTile, targets)[0] ?? null;
  if (!anchor) {
    return null;
  }

  const sameOreTargets = targets.filter((target) => target.oreId === anchor.oreId && target.clickTile.z === anchor.clickTile.z);
  const respawnInfo = getOreRespawnInfo(anchor.oreId, anchor.clickTile);
  const estimatedRespawnMs = respawnInfo.effectiveMs;
  const estimatedMineMs = getOreEstimatedMineMs(anchor.oreId, miningStatsByOreId);
  const desiredTargetCount = getDesiredMiningWorkAreaTargetCount(estimatedRespawnMs, estimatedMineMs);
  const selectedTargets = [...sameOreTargets]
    .sort((a, b) => {
      const aDistance = getMiningTargetSortDistance(anchor.clickTile, playerTile, a);
      const bDistance = getMiningTargetSortDistance(anchor.clickTile, playerTile, b);
      return aDistance - bDistance || a.key.localeCompare(b.key);
    })
    .slice(0, desiredTargetCount);

  const boundsTargets = selectedTargets.length > 0 ? selectedTargets : [anchor];
  const minX =
    Math.min(...boundsTargets.map((target) => target.rectangle.x)) - MINING_WORK_AREA_BOUNDS_PADDING_TILES;
  const maxX =
    Math.max(...boundsTargets.map((target) => target.rectangle.x + Math.max(1, target.rectangle.width) - 1)) +
    MINING_WORK_AREA_BOUNDS_PADDING_TILES;
  const minY =
    Math.min(...boundsTargets.map((target) => target.rectangle.y)) - MINING_WORK_AREA_BOUNDS_PADDING_TILES;
  const maxY =
    Math.max(...boundsTargets.map((target) => target.rectangle.y + Math.max(1, target.rectangle.height) - 1)) +
    MINING_WORK_AREA_BOUNDS_PADDING_TILES;
  const inBoundsTargets = sameOreTargets.filter((target) =>
    isTargetInsideWorkArea(target, {
      id: "",
      createdAtMs: nowMs,
      oreId: anchor.oreId,
      oreLabel: anchor.oreLabel,
      anchorTile: anchor.clickTile,
      bounds: { minX, maxX, minY, maxY, z: anchor.clickTile.z },
      targetKeys: [],
      desiredTargetCount,
      estimatedRespawnMs,
      estimatedMineMs,
    }),
  );

  return {
    id: `${anchor.oreId}:${minX},${minY},${maxX},${maxY},${anchor.clickTile.z}`,
    createdAtMs: nowMs,
    oreId: anchor.oreId,
    oreLabel: anchor.oreLabel,
    anchorTile: anchor.clickTile,
    bounds: { minX, maxX, minY, maxY, z: anchor.clickTile.z },
    targetKeys: inBoundsTargets.map((target) => target.key).sort(),
    desiredTargetCount,
    estimatedRespawnMs,
    estimatedMineMs,
  };
}

function resolveMiningWorkArea(
  state: BotState,
  nowMs: number,
  playerTile: WorldRouteTile,
  targets: readonly MiningCacheTarget[],
): { state: BotState; targets: MiningCacheTarget[] } {
  const existingArea = state.workArea;
  if (existingArea && isPlayerNearWorkArea(playerTile, existingArea)) {
    const existingTargets = getTargetsInsideWorkArea(targets, existingArea);
    if (existingTargets.length > 0) {
      return { state, targets: existingTargets };
    }
  }

  const nextArea = createMiningWorkArea(nowMs, playerTile, targets, state.miningStatsByOreId);
  if (!nextArea) {
    return { state: { ...state, workArea: null }, targets: [] };
  }

  const nextTargets = getTargetsInsideWorkArea(targets, nextArea);
  log(
    `Mining work area selected: ore=${nextArea.oreLabel} bounds=${nextArea.bounds.minX},${nextArea.bounds.minY}..${
      nextArea.bounds.maxX
    },${nextArea.bounds.maxY},${nextArea.bounds.z} targets=${nextTargets.length} desired=${
      nextArea.desiredTargetCount
    } respawn=${formatRespawnInfo(getOreRespawnInfo(nextArea.oreId, nextArea.anchorTile))} estimatedMine=${formatDurationMs(
      nextArea.estimatedMineMs,
    )} anchor=${formatWorldTile(nextArea.anchorTile)}.`,
  );

  return {
    state: { ...state, workArea: nextArea },
    targets: nextTargets,
  };
}

function pruneDepletedMiningTargets(
  depletedTargets: readonly DepletedMiningTarget[],
  nowMs: number,
): DepletedMiningTarget[] {
  return depletedTargets.filter((entry) => entry.untilMs > nowMs);
}

function getDepletedMiningTarget(
  target: MiningCacheTarget,
  depletedTargets: readonly DepletedMiningTarget[],
): DepletedMiningTarget | null {
  return depletedTargets.find((entry) => entry.key === target.key) ?? null;
}

function rememberMiningOreSessionStats(
  statsByOreId: Readonly<Record<string, MiningOreSessionStats>>,
  oreId: string,
  observedMineMs: number,
  nowMs: number,
): Record<string, MiningOreSessionStats> {
  if (
    !Number.isFinite(observedMineMs) ||
    observedMineMs < MINING_MIN_OBSERVED_MINE_MS ||
    observedMineMs > MINING_MAX_OBSERVED_MINE_MS
  ) {
    return { ...statsByOreId };
  }

  const existing = statsByOreId[oreId];
  const sampleCount = (existing?.sampleCount ?? 0) + 1;
  const averageMineMs = Math.round((((existing?.averageMineMs ?? 0) * (sampleCount - 1)) + observedMineMs) / sampleCount);
  return {
    ...statsByOreId,
    [oreId]: {
      oreId,
      sampleCount,
      averageMineMs,
      lastMineMs: Math.round(observedMineMs),
      updatedAtMs: nowMs,
    },
  };
}

function persistObservedMiningStats(oreId: string, observedMineMs: number): void {
  if (
    !isAllInOneMiningOreType(oreId) ||
    !Number.isFinite(observedMineMs) ||
    observedMineMs < MINING_MIN_OBSERVED_MINE_MS ||
    observedMineMs > MINING_MAX_OBSERVED_MINE_MS
  ) {
    return;
  }

  try {
    setSavedAllInOneMiningConfig(
      setAllInOneMiningLearnedMiningStats(getSavedAllInOneMiningConfig(), oreId, Math.round(observedMineMs)),
    );
  } catch (error) {
    warn(`Could not persist learned mining stats for ore=${oreId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function rememberDepletedMiningTarget(
  state: BotState,
  nowMs: number,
  target: ActiveMiningTarget | MiningCacheTarget,
  reason: string,
  observedMineMs: number | null = null,
): { depletedTargets: DepletedMiningTarget[]; untilMs: number; respawnMs: number } {
  const respawnMs = getOreRespawnMs(target.oreId, target.clickTile);
  const untilMs = nowMs + respawnMs;
  const targetLabel = "targetLabel" in target ? target.targetLabel : formatTarget(target);
  const targetKey = "targetKey" in target ? target.targetKey : target.key;
  const depletedTargets = [
    ...pruneDepletedMiningTargets(state.depletedTargets, nowMs).filter((entry) => entry.key !== targetKey),
    {
      key: targetKey,
      targetLabel,
      oreId: target.oreId,
      depletedAtMs: nowMs,
      untilMs,
      observedMineMs,
      reason,
    },
  ];

  return { depletedTargets, untilMs, respawnMs };
}

function estimateRouteTravelMs(route: WorldRoutePlan): number {
  const pathTiles =
    route.status === "ready"
      ? Math.max(1, route.pathLength)
      : route.status === "already-there"
        ? 0
        : ROUTE_WAYPOINT_STEP_LIMIT;
  return Math.max(0, Math.ceil(pathTiles / 2) * GAME_TICK_MS);
}

function selectMiningTargetByWorkAreaScheduler(
  nowMs: number,
  playerTile: WorldTile,
  targets: readonly MiningCacheTarget[],
  depletedTargets: readonly DepletedMiningTarget[],
): MiningSchedulerSelectionResult {
  let best:
    | {
        target: MiningCacheTarget;
        route: WorldRoutePlan;
        scoreMs: number;
        travelMs: number;
        waitMs: number;
        availableAtMs: number;
      }
    | null = null;
  let unavailableCount = 0;
  const startedAtMs = Date.now();

  for (const target of targets) {
    const route = planWorldRouteToTiles(playerTile, {
      destinationLabel: `${target.oreLabel} rock`,
      destinationTile: target.clickTile,
      targetTiles: target.interactionTiles,
      waypointStepLimit: ROUTE_WAYPOINT_STEP_LIMIT,
      maxCrossRegionCount: ROUTE_MAX_CROSS_REGION_COUNT,
    });
    if (route.status === "unavailable") {
      unavailableCount += 1;
      continue;
    }

    const depleted = getDepletedMiningTarget(target, depletedTargets);
    const availableAtMs = depleted?.untilMs ?? nowMs;
    const travelMs = estimateRouteTravelMs(route);
    const waitMs = Math.max(0, availableAtMs - nowMs);
    const scoreMs = travelMs + waitMs;
    if (
      !best ||
      scoreMs < best.scoreMs ||
      (scoreMs === best.scoreMs && route.pathLength < best.route.pathLength) ||
      (scoreMs === best.scoreMs && route.pathLength === best.route.pathLength && target.key.localeCompare(best.target.key) < 0)
    ) {
      best = { target, route, scoreMs, travelMs, waitMs, availableAtMs };
    }
  }

  const pathfinderMs = Date.now() - startedAtMs;
  if (!best) {
    if (targets.length === 0) {
      return { status: "empty", targetCount: 0 };
    }

    return {
      status: "unavailable",
      targetCount: targets.length,
      reason: unavailableCount > 0 ? "all-work-area-targets-unreachable" : "no-work-area-targets",
      pathfinderMs,
    };
  }

  if (best.waitMs > 0) {
    return {
      status: "waiting",
      target: best.target,
      route: best.route,
      waitMs: best.waitMs,
      availableAtMs: best.availableAtMs,
      targetCount: targets.length,
    };
  }

  return {
    status: "selected",
    selection: {
      target: best.target,
      route: best.route,
      targetCount: targets.length,
      scoreMs: best.scoreMs,
      travelMs: best.travelMs,
      waitMs: best.waitMs,
      availableAtMs: best.availableAtMs,
      pathfinderMs,
    },
  };
}

async function rememberVisibleYellowWorkAreaTargets(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  targets: readonly MiningCacheTarget[],
): Promise<BotState> {
  let nextState = {
    ...state,
    depletedTargets: pruneDepletedMiningTargets(state.depletedTargets, nowMs),
  };

  for (const target of targets) {
    if (getDepletedMiningTarget(target, nextState.depletedTargets)) {
      continue;
    }

    const yellowMatch = findYellowMarkerNearMiningTarget(tick, target);
    if (!yellowMatch) {
      continue;
    }

    const depletion = rememberDepletedMiningTarget(nextState, nowMs, target, "visible-yellow-marker");
    nextState = {
      ...nextState,
      depletedTargets: depletion.depletedTargets,
    };
    await saveMiningTargetSwitchDebugScreenshot(tick, {
      reason: "visible-yellow-marker",
      targetKey: target.key,
      targetLabel: formatTarget(target),
      localPoints: getMiningTargetLocalPoints(tick, target),
      marker: yellowMatch,
      observedMineMs: null,
    });
    log(
      `Work area target already yellow; marking depleted for ${formatRespawnInfo(
        getOreRespawnInfo(target.oreId, target.clickTile),
      )} target=${formatTarget(
        target,
      )} marker=${yellowMatch.box.centerX},${yellowMatch.box.centerY} distance=${yellowMatch.distancePx.toFixed(
        1,
      )}px radius=${yellowMatch.radiusPx}px.`,
    );
  }

  return nextState;
}

function formatTarget(target: MiningCacheTarget): string {
  return `${target.oreLabel} ${target.objectName} id=${target.objectId} tile=${formatWorldTile(
    target.clickTile,
  )} footprint=${target.rectangle.x},${target.rectangle.y},${target.rectangle.z} ${target.rectangle.width}x${
    target.rectangle.height
  } region=${target.regionX},${target.regionY}`;
}

function formatBankTarget(target: BankCacheTarget): string {
  return `${target.targetLabel} (${target.objectName}) id=${target.objectId} tile=${formatWorldTile(
    target.clickTile,
  )} footprint=${target.rectangle.x},${target.rectangle.y},${target.rectangle.z} ${target.rectangle.width}x${
    target.rectangle.height
  } region=${target.regionX},${target.regionY} priority=${target.priority}`;
}

function bankTargetAsSceneClickTarget(target: BankCacheTarget): MiningCacheTarget {
  return {
    key: target.key,
    oreId: "bank-target",
    oreLabel: target.targetLabel,
    objectId: target.objectId,
    objectName: target.objectName,
    rectangle: target.rectangle,
    clickTile: target.clickTile,
    interactionTiles: target.interactionTiles,
    regionX: target.regionX,
    regionY: target.regionY,
  };
}

function screenPointToLocal(calibration: StartupPlayerTileCalibration, point: ScreenPoint): ScreenPoint {
  return {
    x: point.x - calibration.captureBounds.x,
    y: point.y - calibration.captureBounds.y,
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

function getCurrentSceneScaleRelativeTo125(calibration: StartupPlayerTileCalibration): number {
  return calibration.windowsScalePercent / MINING_SCENE_REFERENCE_SCALE_PERCENT;
}

function getMiningSceneBounds(calibration: StartupPlayerTileCalibration): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const scale = getCurrentSceneScaleRelativeTo125(calibration);
  const rightPanelWidth = Math.round(MINING_SCENE_RIGHT_PANEL_WIDTH_LOGICAL * scale);
  const bottomUiHeight = Math.round(MINING_SCENE_BOTTOM_UI_HEIGHT_LOGICAL * scale);
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

function getMiningSceneTargetEdgeMarginPx(calibration: StartupPlayerTileCalibration): number {
  return Math.max(
    MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
    Math.round(MINING_SCENE_TARGET_EDGE_MARGIN_PX_AT_125 * getCurrentSceneScaleRelativeTo125(calibration)),
  );
}

function isLocalPointInsideMiningScene(
  calibration: StartupPlayerTileCalibration,
  localPoint: ScreenPoint,
  safeEdgeMarginPx: number,
): boolean {
  const scene = getMiningSceneBounds(calibration);
  return (
    localPoint.x >= scene.left + safeEdgeMarginPx &&
    localPoint.x <= scene.right - safeEdgeMarginPx &&
    localPoint.y >= scene.top + safeEdgeMarginPx &&
    localPoint.y <= scene.bottom - safeEdgeMarginPx
  );
}

function clampLocalPointToMiningScene(
  calibration: StartupPlayerTileCalibration,
  localPoint: ScreenPoint,
  safeEdgeMarginPx: number,
): { localPoint: ScreenPoint; wasClamped: boolean } {
  const scene = getMiningSceneBounds(calibration);
  const safeLocalX = clamp(Math.round(localPoint.x), scene.left + safeEdgeMarginPx, scene.right - safeEdgeMarginPx);
  const safeLocalY = clamp(Math.round(localPoint.y), scene.top + safeEdgeMarginPx, scene.bottom - safeEdgeMarginPx);
  return {
    localPoint: { x: safeLocalX, y: safeLocalY },
    wasClamped: safeLocalX !== Math.round(localPoint.x) || safeLocalY !== Math.round(localPoint.y),
  };
}

function getCompatibleMiningSceneMouseCalibration(
  calibration: StartupPlayerTileCalibration,
): EndToEndSceneMouseCalibration | null {
  return getCompatibleSavedSceneMouseCalibration(calibration);
}

function projectWorldTileWithSavedSceneCalibration(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldRouteTile,
  targetTile: WorldRouteTile,
  safeEdgeMarginPx: number,
): MiningSceneProjection | null {
  if (playerTile.z !== targetTile.z) {
    return null;
  }

  const sceneCalibration = getCompatibleMiningSceneMouseCalibration(calibration);
  const fit = sceneCalibration?.fit ?? null;
  if (!fit) {
    return null;
  }

  const dxTiles = targetTile.x - playerTile.x;
  const dyTiles = targetTile.y - playerTile.y;
  const projected = projectSceneMouseCalibrationLocalPoint(fit, dxTiles, dyTiles);
  if (!projected || !Number.isFinite(projected.localX) || !Number.isFinite(projected.localY)) {
    return null;
  }

  const { localPoint, wasClamped } = clampLocalPointToMiningScene(
    calibration,
    { x: projected.localX, y: projected.localY },
    safeEdgeMarginPx,
  );
  if (wasClamped) {
    return null;
  }

  return {
    screenPoint: {
      x: calibration.captureBounds.x + localPoint.x,
      y: calibration.captureBounds.y + localPoint.y,
    },
    localPoint,
    targetTile,
    tilePx: clamp(calibration.tilePx, 24, 96),
    dxTiles,
    dyTiles,
    distanceTiles: getWorldTileChebyshevDistance(playerTile, targetTile),
    source: "saved-3d-calibration",
    calibrationSampleCount: projected.sampleCount,
    calibrationMeanErrorPx: projected.meanErrorPx,
  };
}

function projectMiningSceneTileInsideCapture(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldRouteTile,
  targetTile: WorldRouteTile,
  safeEdgeMarginPx: number = getMiningSceneTargetEdgeMarginPx(calibration),
): MiningSceneProjection | null {
  const fitted = projectWorldTileWithSavedSceneCalibration(calibration, playerTile, targetTile, safeEdgeMarginPx);
  if (fitted) {
    return fitted;
  }

  const rough = projectWorldTileInsideCapture(calibration, playerTile, targetTile, safeEdgeMarginPx);
  if (!rough || !isLocalPointInsideMiningScene(calibration, rough.localPoint, safeEdgeMarginPx)) {
    return null;
  }

  return {
    screenPoint: rough.screenPoint,
    localPoint: rough.localPoint,
    targetTile,
    tilePx: clamp(calibration.tilePx, 24, 96),
    dxTiles: targetTile.x - playerTile.x,
    dyTiles: targetTile.y - playerTile.y,
    distanceTiles: getWorldTileChebyshevDistance(playerTile, targetTile),
    source: "rough-model",
    calibrationSampleCount: null,
    calibrationMeanErrorPx: null,
  };
}

function getMiningTargetFootprintTiles(target: MiningCacheTarget): WorldRouteTile[] {
  const tiles: WorldRouteTile[] = [];
  const width = Math.max(1, target.rectangle.width);
  const height = Math.max(1, target.rectangle.height);
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      tiles.push({
        x: target.rectangle.x + dx,
        y: target.rectangle.y + dy,
        z: target.rectangle.z,
      });
    }
  }

  return tiles.sort((a, b) => getWorldTileChebyshevDistance(a, target.clickTile) - getWorldTileChebyshevDistance(b, target.clickTile));
}

function isSameRouteTile(a: Pick<WorldRouteTile, "x" | "y" | "z">, b: Pick<WorldRouteTile, "x" | "y" | "z">): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function getNearestMiningTargetFootprintTile(
  tile: Pick<WorldRouteTile, "x" | "y" | "z">,
  target: MiningCacheTarget,
): { tile: WorldRouteTile; distance: number } {
  const footprintTiles = getMiningTargetFootprintTiles(target);
  return footprintTiles
    .map((candidate) => ({
      tile: candidate,
      distance: candidate.z === tile.z ? getWorldTileChebyshevDistance(candidate, tile) : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.distance - b.distance || getWorldTileChebyshevDistance(a.tile, target.clickTile) - getWorldTileChebyshevDistance(b.tile, target.clickTile))[0];
}

function isTileOnMiningTargetFootprint(tile: Pick<WorldRouteTile, "x" | "y" | "z">, target: MiningCacheTarget): boolean {
  return getMiningTargetFootprintTiles(target).some((candidate) => isSameRouteTile(candidate, tile));
}

function getMouseCoordinateCropBounds(
  point: ScreenPoint,
  calibration: StartupPlayerTileCalibration,
): { x: number; y: number; width: number; height: number } {
  const scale = getCurrentSceneScaleRelativeTo125(calibration);
  const capture = calibration.captureBounds;
  const width = Math.min(capture.width, Math.max(120, Math.round(MINING_MOUSE_COORDINATE_CROP_WIDTH_AT_125_PX * scale)));
  const height = Math.min(
    capture.height,
    Math.max(90, Math.round(MINING_MOUSE_COORDINATE_CROP_HEIGHT_AT_125_PX * scale)),
  );
  const leftOffset = Math.round(MINING_MOUSE_COORDINATE_CROP_LEFT_AT_125_PX * scale);
  const topOffset = Math.round(MINING_MOUSE_COORDINATE_CROP_TOP_AT_125_PX * scale);
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

function sanitizeDebugLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function buildMiningMouseCoordinateDebugPath(
  point: ScreenPoint,
  cropBounds: { x: number; y: number; width: number; height: number },
  target: MiningCacheTarget,
  attemptIndex: number,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    "test-image-debug",
    `${timestamp}-mining-mouse-ocr-try-${attemptIndex + 1}-${sanitizeDebugLabel(
      target.oreLabel,
    )}-target-${target.clickTile.x}-${target.clickTile.y}-${target.clickTile.z}-mouse-${point.x}-${point.y}-crop-${
      cropBounds.x
    }-${cropBounds.y}-${cropBounds.width}x${cropBounds.height}.png`,
  );
}

async function readMiningMouseCoordinateAtPoint(
  point: ScreenPoint,
  calibration: StartupPlayerTileCalibration,
  target: MiningCacheTarget,
  attemptIndex: number,
): Promise<MiningMouseCoordinateProbe> {
  const cropBounds = getMouseCoordinateCropBounds(point, calibration);
  const bitmap = captureScreenBitmap(cropBounds);
  const debugPath = buildMiningMouseCoordinateDebugPath(point, cropBounds, target, attemptIndex);
  try {
    await saveBitmapAsync(bitmap, debugPath);
  } catch (error) {
    warn(`Mining scene mouse OCR debug save failed: path=${debugPath} error=${error instanceof Error ? error.message : String(error)}.`);
  }

  const box = detectOverlayBoxInScreenshot(bitmap, calibration.windowsScalePercent, {
    allowCompactSingleLine: true,
    leftStripRatio: 1,
    requireRuneLiteCoordinatePattern: true,
  });
  if (!box) {
    return { read: null, cropBounds, debugPath };
  }

  const tile = parseWorldTileFromMatchedLine(box.matchedLine);
  if (!tile) {
    return { read: null, cropBounds, debugPath };
  }

  return {
    read: {
      tile: { x: tile.x, y: tile.y, z: tile.z },
      line: box.matchedLine,
      cropBounds,
      boxScreen: {
        x: cropBounds.x + box.x,
        y: cropBounds.y + box.y,
        width: box.width,
        height: box.height,
      },
    },
    cropBounds,
    debugPath,
  };
}

function rememberMiningSceneMouseCalibrationSample(
  calibration: StartupPlayerTileCalibration,
  point: ScreenPoint,
  read: MiningMouseCoordinateRead,
  target: MiningCacheTarget,
  source: string,
): { saved: boolean; fit: EndToEndSceneMouseCalibrationFit | null; sampleCount: number; reason: string } {
  const playerTile = calibration.playerTile;
  if (!playerTile || read.tile.z !== playerTile.z) {
    return { saved: false, fit: null, sampleCount: 0, reason: "plane-mismatch" };
  }

  const nearest = getNearestMiningTargetFootprintTile(read.tile, target);
  if (nearest.distance > MINING_SCENE_CALIBRATION_MAX_EXPECTED_TILE_ERROR) {
    return { saved: false, fit: null, sampleCount: 0, reason: `too-far:${nearest.distance}` };
  }

  const localPoint = screenPointToLocal(calibration, point);
  if (!isLocalPointInsideMiningScene(calibration, localPoint, MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX)) {
    return { saved: false, fit: null, sampleCount: 0, reason: "outside-scene" };
  }

  const sample: EndToEndSceneMouseCalibrationSample = {
    localX: Math.round(localPoint.x),
    localY: Math.round(localPoint.y),
    dxTiles: read.tile.x - playerTile.x,
    dyTiles: read.tile.y - playerTile.y,
    tileX: read.tile.x,
    tileY: read.tile.y,
    z: read.tile.z,
    source,
    createdAt: new Date().toISOString(),
  };

  if (Math.abs(sample.dxTiles) > 80 || Math.abs(sample.dyTiles) > 80) {
    return { saved: false, fit: null, sampleCount: 0, reason: "delta-too-large" };
  }

  const sceneCalibration = getCompatibleSavedSceneMouseCalibration(calibration);
  const existingCalibration =
    sceneCalibration && (!sceneCalibration.fit || isSceneMouseCalibrationFitAcceptable(sceneCalibration.fit))
      ? sceneCalibration
      : null;
  const samples = [...(existingCalibration?.samples ?? []), sample].slice(-SCENE_MOUSE_CALIBRATION_MAX_SAMPLES);
  const fit = fitSceneMouseCalibrationSamples(samples);
  saveSharedSceneMouseCalibration(calibration, samples, fit);

  return {
    saved: true,
    fit,
    sampleCount: samples.length,
    reason: fit ? "fit-ready" : "need-more-samples",
  };
}

function getMiningSceneCorrectionPoint(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldRouteTile,
  target: MiningCacheTarget,
  observation: MiningSceneHoverObservation,
): ScreenPoint {
  const nearest = getNearestMiningTargetFootprintTile(observation.read.tile, target);
  const readProjection = projectMiningSceneTileInsideCapture(
    calibration,
    playerTile,
    observation.read.tile,
    MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
  );
  const targetProjection = projectMiningSceneTileInsideCapture(
    calibration,
    playerTile,
    nearest.tile,
    MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
  );
  if (readProjection && targetProjection) {
    return getSafeScreenPoint(
      observation.point.x + Math.round((targetProjection.localPoint.x - readProjection.localPoint.x) * 0.9) +
        randomIntInclusive(-MINING_SCENE_CORRECTION_JITTER_PX, MINING_SCENE_CORRECTION_JITTER_PX),
      observation.point.y + Math.round((targetProjection.localPoint.y - readProjection.localPoint.y) * 0.9) +
        randomIntInclusive(-MINING_SCENE_CORRECTION_JITTER_PX, MINING_SCENE_CORRECTION_JITTER_PX),
      calibration.captureBounds,
      MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
    );
  }

  const tilePx = Math.max(18, clamp(calibration.tilePx, 24, 96));
  return getSafeScreenPoint(
    observation.point.x + Math.round((nearest.tile.x - observation.read.tile.x) * tilePx),
    observation.point.y - Math.round((nearest.tile.y - observation.read.tile.y) * tilePx),
    calibration.captureBounds,
    MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
  );
}

function formatMiningSceneHoverAttempts(attempts: readonly MiningSceneHoverAttempt[]): string {
  return attempts
    .map((attempt, index) => {
      const fileName = path.basename(attempt.debugPath);
      const read = attempt.read
        ? `${attempt.read.tile.x},${attempt.read.tile.y},${attempt.read.tile.z}/err=${attempt.errorTiles}`
        : "no-read";
      return `#${index + 1}@${attempt.point.x},${attempt.point.y}:${read} crop=${attempt.cropBounds.x},${attempt.cropBounds.y},${attempt.cropBounds.width}x${attempt.cropBounds.height} img=${fileName}`;
    })
    .join("; ");
}

async function prepareMiningSceneClickPlan(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldRouteTile,
  target: MiningCacheTarget,
  reason: string,
  options: MiningSceneClickOptions = {},
): Promise<MiningSceneClickPlan | null> {
  const sampleSource = options.sampleSource ?? "mining-click-hover";
  const allowRoughProjectionFallbackClick = options.allowRoughProjectionFallbackClick ?? true;
  const requireHoverValidation = options.requireHoverValidation ?? false;
  const targetTiles = getMiningTargetFootprintTiles(target);
  const projected =
    projectMiningSceneTileInsideCapture(calibration, playerTile, target.clickTile) ??
    targetTiles
      .map((tile) => projectMiningSceneTileInsideCapture(calibration, playerTile, tile))
      .find((projection): projection is MiningSceneProjection => projection !== null);
  if (!projected) {
    return null;
  }

  if (
    projected.source === "saved-3d-calibration" &&
    !requireHoverValidation &&
    (projected.calibrationSampleCount ?? 0) >= MINING_SCENE_DIRECT_FIT_MIN_SAMPLES &&
    (projected.calibrationMeanErrorPx ?? Number.POSITIVE_INFINITY) <= MINING_SCENE_DIRECT_FIT_MAX_MEAN_ERROR_PX
  ) {
    return {
      screenPoint: projected.screenPoint,
      localPoint: projected.localPoint,
      initialScreenPoint: projected.screenPoint,
      targetTile: target.clickTile,
      hoveredTile: null,
      hoveredLine: null,
      hoverBoxScreen: null,
      attempts: [],
      finalErrorTiles: null,
      projectionSource: projected.source,
      calibrationSampleCount: projected.calibrationSampleCount,
      calibrationMeanErrorPx: projected.calibrationMeanErrorPx,
      clickReason: "saved-calibration-direct",
    };
  }

  const attempts: MiningSceneHoverAttempt[] = [];
  const observations: MiningSceneHoverObservation[] = [];
  const initialScreenPoint = projected.screenPoint;
  let nextPoint = initialScreenPoint;
  let best:
    | {
        point: ScreenPoint;
        read: MiningMouseCoordinateRead;
        errorTiles: number;
        clickReason: MiningSceneClickPlan["clickReason"];
      }
    | null = null;
  const searchTilePx = Math.max(18, Math.round(projected.tilePx));
  const noReadOffsets = [
    { x: 0, y: 0 },
    { x: 0, y: -searchTilePx },
    { x: searchTilePx, y: 0 },
    { x: -searchTilePx, y: 0 },
    { x: 0, y: searchTilePx },
    { x: searchTilePx, y: -searchTilePx },
  ];

  for (let attempt = 0; attempt < MINING_SCENE_MAX_HOVER_ATTEMPTS && AppState.automateBotRunning; attempt += 1) {
    const offset = noReadOffsets[Math.min(attempt, noReadOffsets.length - 1)];
    const candidate =
      attempt === 0 || attempts[attempts.length - 1]?.read
        ? nextPoint
        : {
            x: initialScreenPoint.x + offset.x,
            y: initialScreenPoint.y + offset.y,
          };
    const point = getSafeScreenPoint(candidate.x, candidate.y, calibration.captureBounds, MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX);
    await moveMouseHumanLike(point.x, point.y, calibration.captureBounds, {
      safeEdgeMarginPx: MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
      minDurationMs: MINING_MOUSE_MOVE_MIN_MS,
      maxDurationMs: MINING_MOUSE_MOVE_MAX_MS,
      jitterPx: MINING_MOUSE_MOVE_JITTER_PX,
      overshootChance: MINING_MOUSE_MOVE_OVERSHOOT_CHANCE,
      shouldContinue: () => AppState.automateBotRunning,
    });
    if (!AppState.automateBotRunning) {
      return null;
    }

    await sleepWithAbort(randomIntInclusive(MINING_MOUSE_HOVER_SETTLE_MIN_MS, MINING_MOUSE_HOVER_SETTLE_MAX_MS), () =>
      AppState.automateBotRunning,
    );

    const probe = await readMiningMouseCoordinateAtPoint(point, calibration, target, attempt);
    const read = probe.read;
    const nearest = read ? getNearestMiningTargetFootprintTile(read.tile, target) : null;
    const errorTiles = nearest ? nearest.distance : null;
    attempts.push({ point, read, errorTiles, debugPath: probe.debugPath, cropBounds: probe.cropBounds });

    if (read && read.tile.z === target.clickTile.z) {
      const observation = { point, read, errorTiles: errorTiles! };
      observations.push(observation);
      const memory = rememberMiningSceneMouseCalibrationSample(calibration, point, read, target, sampleSource);
      if (memory.saved && (memory.fit || memory.sampleCount >= 1)) {
        log(
          `Mining scene calibration sample saved: hover='${read.line}' target=${formatTarget(target)} samples=${memory.sampleCount} fit=${
            memory.fit
              ? `mean=${memory.fit.meanErrorPx.toFixed(1)}px max=${memory.fit.maxErrorPx.toFixed(1)}px`
              : "not-ready"
          } reason=${memory.reason}.`,
        );
      }

      if (!best || errorTiles! < best.errorTiles) {
        best = {
          point,
          read,
          errorTiles: errorTiles!,
          clickReason: isTileOnMiningTargetFootprint(read.tile, target)
            ? "tile-location-target-footprint"
            : "tile-location-nearest-target",
        };
      }

      if (errorTiles! <= MINING_SCENE_ACCEPT_TILE_ERROR) {
        break;
      }

      nextPoint = getMiningSceneCorrectionPoint(calibration, playerTile, target, observation);
    }
  }

  if (best && best.errorTiles <= MINING_SCENE_FALLBACK_TILE_ERROR) {
    return {
      screenPoint: best.point,
      localPoint: screenPointToLocal(calibration, best.point),
      initialScreenPoint,
      targetTile: target.clickTile,
      hoveredTile: best.read.tile,
      hoveredLine: best.read.line,
      hoverBoxScreen: best.read.boxScreen,
      attempts,
      finalErrorTiles: best.errorTiles,
      projectionSource: projected.source,
      calibrationSampleCount: projected.calibrationSampleCount,
      calibrationMeanErrorPx: projected.calibrationMeanErrorPx,
      clickReason: best.clickReason,
    };
  }

  if (best) {
    warn(
      `Mining scene click hover did not land on ${formatTarget(target)} for ${reason}; closestHover='${best.read.line}' error=${
        best.errorTiles
      } tile(s). attempts=${formatMiningSceneHoverAttempts(attempts)}.`,
    );
    return null;
  }

  const hasReliableProjection = projected.source === "saved-3d-calibration";
  if (!allowRoughProjectionFallbackClick && !hasReliableProjection) {
    warn(
      `Mining scene click refused rough projection fallback for ${formatTarget(target)} because Tile Location near mouse was unreadable. attempts=${formatMiningSceneHoverAttempts(
        attempts,
      )}.`,
    );
    return null;
  }

  if (!hasReliableProjection && attempts.length > 0) {
    warn(
      `Mining scene click using rough projection fallback for ${formatTarget(target)} because Tile Location near mouse was unreadable. attempts=${formatMiningSceneHoverAttempts(
        attempts,
      )}.`,
    );
  }

  return {
    screenPoint: projected.screenPoint,
    localPoint: projected.localPoint,
    initialScreenPoint,
    targetTile: target.clickTile,
    hoveredTile: null,
    hoveredLine: null,
    hoverBoxScreen: null,
    attempts,
    finalErrorTiles: null,
    projectionSource: projected.source,
    calibrationSampleCount: projected.calibrationSampleCount,
    calibrationMeanErrorPx: projected.calibrationMeanErrorPx,
    clickReason: "projection-fallback",
  };
}

function resolveBankOrbMaxDistanceFromDepositPx(captureBounds: { width: number; height: number }): number {
  return clamp(
    Math.round(Math.min(captureBounds.width, captureBounds.height) * BANK_ORB_MAX_DISTANCE_FROM_DEPOSIT_RATIO),
    BANK_ORB_MAX_DISTANCE_FROM_DEPOSIT_MIN_PX,
    BANK_ORB_MAX_DISTANCE_FROM_DEPOSIT_MAX_PX,
  );
}

function resolveEmptyBagInBankScreenPoint(
  orbDetection: { centerX: number; centerY: number; width: number },
  captureBounds: { x: number; y: number },
): ScreenPoint {
  const scale =
    Number.isFinite(orbDetection.width) && orbDetection.width > 0
      ? orbDetection.width / BANK_DEPOSIT_ORB_REFERENCE_WIDTH_PX
      : 1;
  return {
    x: Math.round(captureBounds.x + orbDetection.centerX + EMPTY_BAG_IN_BANK_OFFSET_FROM_ORB_REFERENCE.x * scale),
    y: Math.round(captureBounds.y + orbDetection.centerY + EMPTY_BAG_IN_BANK_OFFSET_FROM_ORB_REFERENCE.y * scale),
  };
}

function resolveBankDepositOrbReferencePath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), BANK_DEPOSIT_ORB_REFERENCE_ICON),
    path.resolve(__dirname, "..", "..", "..", BANK_DEPOSIT_ORB_REFERENCE_ICON),
    path.resolve(__dirname, "..", "..", "..", "..", BANK_DEPOSIT_ORB_REFERENCE_ICON),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function toRobotBitmapFromPng(png: PNG): RobotBitmap {
  const image = Buffer.alloc(png.width * png.height * 4);
  for (let i = 0; i < png.data.length; i += 4) {
    image[i] = png.data[i + 2];
    image[i + 1] = png.data[i + 1];
    image[i + 2] = png.data[i];
    image[i + 3] = png.data[i + 3];
  }

  return {
    width: png.width,
    height: png.height,
    byteWidth: png.width * 4,
    bytesPerPixel: 4,
    image,
  };
}

function getBankDepositOrbReferenceBitmap(): RobotBitmap | null {
  if (bankDepositOrbReferenceBitmap) {
    return bankDepositOrbReferenceBitmap;
  }

  if (bankDepositOrbReferenceLoadAttempted) {
    return null;
  }

  bankDepositOrbReferenceLoadAttempted = true;
  const referencePath = resolveBankDepositOrbReferencePath();
  if (!referencePath) {
    warn(`Bank deposit orb reference icon not found (${BANK_DEPOSIT_ORB_REFERENCE_ICON}).`);
    return null;
  }

  try {
    const pngBuffer = fs.readFileSync(referencePath);
    const pngSync = (PNG as unknown as { sync?: { read: (buffer: Buffer) => PNG } }).sync;
    if (!pngSync) {
      warn("pngjs sync API unavailable; cannot load bank deposit orb reference.");
      return null;
    }

    const png = pngSync.read(pngBuffer);
    bankDepositOrbReferenceBitmap = toRobotBitmapFromPng(png);
    log(
      `Bank deposit orb reference loaded (${bankDepositOrbReferenceBitmap.width}x${bankDepositOrbReferenceBitmap.height}).`,
    );
    return bankDepositOrbReferenceBitmap;
  } catch (error) {
    warn(`Failed to load bank deposit orb reference: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function isBankingPhase(phase: BotPhase): boolean {
  return phase === "banking-search-target" || phase === "banking-walking" || phase === "banking-find-orb";
}

function createPendingMiningClick(
  target: MiningCacheTarget,
  nowMs: number,
  confirmTicks: number = MINING_CLICK_CONFIRM_TICKS,
): PendingMiningClick {
  return {
    targetKey: target.key,
    targetLabel: formatTarget(target),
    clickedAtMs: nowMs,
    deadlineMs: deadlineFromNowTicks(confirmTicks, nowMs),
    clickTile: target.clickTile,
  };
}

function createActiveMiningTarget(target: MiningCacheTarget, lastClickScreen: ScreenPoint, clickedAtMs: number): ActiveMiningTarget {
  return {
    targetKey: target.key,
    targetLabel: formatTarget(target),
    oreId: target.oreId,
    oreLabel: target.oreLabel,
    clickTile: target.clickTile,
    lastClickScreen,
    clickedAtMs,
  };
}

async function clickProjectedTarget(
  calibration: StartupPlayerTileCalibration,
  projection: { screenPoint: ScreenPoint; localPoint: ScreenPoint },
): Promise<ScreenPoint> {
  await moveMouseHumanLike(projection.screenPoint.x, projection.screenPoint.y, calibration.captureBounds, {
    safeEdgeMarginPx: DIRECT_CLICK_SAFE_EDGE_MARGIN_PX,
    maxDurationMs: randomIntInclusive(180, 360),
    shouldContinue: () => AppState.automateBotRunning,
  });
  return clickScreenPoint(projection.screenPoint.x, projection.screenPoint.y, calibration.captureBounds, {
    safeEdgeMarginPx: DIRECT_CLICK_SAFE_EDGE_MARGIN_PX,
    settleMs: randomIntInclusive(45, 120),
  });
}

async function clickMiningScenePlan(
  calibration: StartupPlayerTileCalibration,
  plan: MiningSceneClickPlan,
): Promise<ScreenPoint> {
  await moveMouseHumanLike(plan.screenPoint.x, plan.screenPoint.y, calibration.captureBounds, {
    safeEdgeMarginPx: MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
    maxDurationMs: randomIntInclusive(120, 260),
    jitterPx: MINING_MOUSE_MOVE_JITTER_PX,
    shouldContinue: () => AppState.automateBotRunning,
  });
  return clickScreenPoint(plan.screenPoint.x, plan.screenPoint.y, calibration.captureBounds, {
    safeEdgeMarginPx: MINING_SCENE_CLICK_SAFE_EDGE_MARGIN_PX,
    settleMs: randomIntInclusive(45, 120),
  });
}

function estimateMinimapWalkWaitMs(route: WorldRoutePlan): number {
  const pathTiles =
    route.status === "ready"
      ? Math.max(1, route.nextWaypointPathLength)
      : route.status === "already-there"
        ? 1
        : ROUTE_WAYPOINT_STEP_LIMIT;
  const runTicks = Math.ceil(pathTiles / 2);
  return Math.max(GAME_TICK_MS * 2, (runTicks + 1) * GAME_TICK_MS);
}

function estimateMiningSceneClickConfirmTicks(route: WorldRoutePlan): number {
  const pathTiles =
    route.status === "ready"
      ? Math.max(1, route.pathLength)
      : route.status === "already-there"
        ? 0
        : DIRECT_SCENE_CLICK_MAX_DISTANCE_TILES;
  const travelTicks = Math.ceil(pathTiles / 2);
  return Math.max(MINING_CLICK_CONFIRM_TICKS, travelTicks + MINING_CLICK_CONFIRM_TICKS + 1);
}

function createWalkingState(
  state: BotState,
  route: WorldRoutePlan,
  nowMs: number,
  phase: BotPhase = "walking",
): BotState {
  return {
    ...state,
    phase,
    expectedTile: route.nextWaypoint ?? route.targetTile ?? route.destinationTile ?? null,
    pendingMiningClick: null,
    waitingForActiveTargetYellowSinceMs: null,
    actionLockUntilMs: nowMs + estimateMinimapWalkWaitMs(route),
  };
}

async function clickRouteMinimapWaypoint(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  target: MiningCacheTarget,
  route: WorldRoutePlan,
): Promise<BotState> {
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  const playerTile = tick.playerTile;
  const waypoint = route.nextWaypoint;
  if (!calibration || !bitmap || !playerTile || !waypoint) {
    return addFailedTargetCooldown(state, nowMs, target.key, "missing-route-click-context");
  }

  const plan = projectWorldTileToMinimapClick(calibration, bitmap, playerTile, waypoint, {
    maxClickRadiusRatio: MINIMAP_MAX_CLICK_RADIUS_RATIO,
  });
  if (!plan) {
    const projected = projectWorldTileInsideCapture(calibration, playerTile, waypoint, DIRECT_CLICK_SAFE_EDGE_MARGIN_PX);
    if (!projected) {
      warn(`Route click unavailable for ${formatTarget(target)}. ${formatWorldRoutePlan(route)}.`);
      return addFailedTargetCooldown(state, nowMs, target.key, "route-click-unavailable");
    }

    const clicked = await clickProjectedTarget(calibration, projected);
    log(
      `Route fallback scene click toward ${formatWorldTile(waypoint)} for ${formatTarget(target)} screen=${clicked.x},${clicked.y}. ${formatWorldRoutePlan(
        route,
      )}.`,
    );
    return createWalkingState(state, route, nowMs);
  }

  const executed = await executeMinimapWorldClickPlan(calibration, plan, {
    safeEdgeMarginPx: DIRECT_CLICK_SAFE_EDGE_MARGIN_PX,
    shouldContinue: () => AppState.automateBotRunning,
  });
  log(
    `Minimap route click for ${formatTarget(target)} waypoint=${formatWorldTile(waypoint)} screen=${executed.clicked.x},${
      executed.clicked.y
    } delta=${plan.dxTiles},${plan.dyTiles} distance=${plan.distanceTiles} clamped=${
      plan.wasVectorClamped ? "yes" : "no"
    } calibration=${plan.minimapCalibrationSource} tilePx=${plan.minimapTilePx}px effectiveTilePx=${plan.effectiveMinimapTilePx.toFixed(
      2,
    )} tilePxScale=${plan.minimapTilePxScale.toFixed(3)} radiusRatio=${plan.minimapRadiusRatio.toFixed(
      3,
    )} offset=${plan.projectionOffsetLocalX.toFixed(1)},${plan.projectionOffsetLocalY.toFixed(
      1,
    )} minimap=${plan.minimapSource}/${plan.projectionSource}. ${formatWorldRoutePlan(route)}.`,
  );

  return createWalkingState(state, route, nowMs);
}

async function clickOrRouteToTarget(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  target: MiningCacheTarget,
  precomputedRoute?: WorldRoutePlan,
): Promise<BotState> {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  if (!calibration || !playerTile) {
    return state;
  }

  const route =
    precomputedRoute ??
    planWorldRouteToTiles(playerTile, {
      destinationLabel: `${target.oreLabel} rock`,
      destinationTile: target.clickTile,
      targetTiles: target.interactionTiles,
      waypointStepLimit: ROUTE_WAYPOINT_STEP_LIMIT,
      maxCrossRegionCount: ROUTE_MAX_CROSS_REGION_COUNT,
    });
  if (route.status === "unavailable") {
    warn(`No cached-map route to ${formatTarget(target)}: ${route.reason ?? "unknown"}.`);
    return addFailedTargetCooldown(state, nowMs, target.key, route.reason ?? "route-unavailable");
  }

  const routePathTiles = route.status === "ready" ? route.pathLength : 0;
  const targetDistanceTiles = route.directDistanceToTargetTiles || getWorldTileDistanceToRectangle(playerTile, target.rectangle);
  const scenePlan =
    routePathTiles <= DIRECT_SCENE_CLICK_MAX_DISTANCE_TILES
      ? await prepareMiningSceneClickPlan(calibration, playerTile, target, "selected-target", {
          requireHoverValidation: routePathTiles > 0,
        })
      : null;

  if (scenePlan) {
    const clicked = await clickMiningScenePlan(calibration, scenePlan);
    const confirmTicks = estimateMiningSceneClickConfirmTicks(route);
    log(
      `Clicked selected ore target ${formatTarget(target)} screen=${clicked.x},${clicked.y} local=${scenePlan.localPoint.x},${
        scenePlan.localPoint.y
      } directDistance=${targetDistanceTiles} tile(s) path=${route.pathLength} step(s) confirmTicks=${confirmTicks} projection=${scenePlan.projectionSource} fitSamples=${
        scenePlan.calibrationSampleCount ?? 0
      } fitMean=${scenePlan.calibrationMeanErrorPx?.toFixed(1) ?? "n/a"} clickReason=${scenePlan.clickReason} hover='${
        scenePlan.hoveredLine ?? "unread"
      }' finalError=${scenePlan.finalErrorTiles ?? "n/a"} attempts=${formatMiningSceneHoverAttempts(scenePlan.attempts)}.`,
    );
    return {
      ...state,
      phase: "confirming-click",
      actionLockUntilMs: deadlineFromNowTicks(ACTION_LOCK_TICKS_AFTER_SCENE_CLICK, nowMs),
      expectedTile: playerTile,
      pendingMiningClick: createPendingMiningClick(target, nowMs, confirmTicks),
      activeMiningTarget: createActiveMiningTarget(target, clicked, nowMs),
      waitingForActiveTargetYellowSinceMs: null,
    };
  }

  if (route.status === "already-there") {
    warn(
      `Already in cached interaction range for ${formatTarget(target)} but the scene projection is not clickable; cooling target briefly.`,
    );
    return addFailedTargetCooldown(state, nowMs, target.key, "in-range-projection-unavailable");
  }

  return clickRouteMinimapWaypoint(state, nowMs, tick, target, route);
}

async function clickRouteMinimapWaypointToBank(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  target: BankCacheTarget,
  route: WorldRoutePlan,
): Promise<BotState> {
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  const playerTile = tick.playerTile;
  const waypoint = route.nextWaypoint;
  if (!calibration || !bitmap || !playerTile || !waypoint) {
    return addFailedBankTargetCooldown(state, nowMs, target.key, "missing-bank-route-click-context");
  }

  const plan = projectWorldTileToMinimapClick(calibration, bitmap, playerTile, waypoint, {
    maxClickRadiusRatio: MINIMAP_MAX_CLICK_RADIUS_RATIO,
  });
  if (!plan) {
    const projected = projectWorldTileInsideCapture(calibration, playerTile, waypoint, DIRECT_CLICK_SAFE_EDGE_MARGIN_PX);
    if (!projected) {
      warn(`Bank route click unavailable for ${formatBankTarget(target)}. ${formatWorldRoutePlan(route)}.`);
      return addFailedBankTargetCooldown(state, nowMs, target.key, "bank-route-click-unavailable");
    }

    const clicked = await clickProjectedTarget(calibration, projected);
    log(
      `Bank route fallback scene click toward ${formatWorldTile(waypoint)} for ${formatBankTarget(target)} screen=${
        clicked.x
      },${clicked.y}. ${formatWorldRoutePlan(route)}.`,
    );
    return createWalkingState(state, route, nowMs, "banking-walking");
  }

  const executed = await executeMinimapWorldClickPlan(calibration, plan, {
    safeEdgeMarginPx: DIRECT_CLICK_SAFE_EDGE_MARGIN_PX,
    shouldContinue: () => AppState.automateBotRunning,
  });
  log(
    `Minimap bank route click for ${formatBankTarget(target)} waypoint=${formatWorldTile(waypoint)} screen=${
      executed.clicked.x
    },${executed.clicked.y} delta=${plan.dxTiles},${plan.dyTiles} distance=${plan.distanceTiles} clamped=${
      plan.wasVectorClamped ? "yes" : "no"
    } calibration=${plan.minimapCalibrationSource} tilePx=${plan.minimapTilePx}px effectiveTilePx=${plan.effectiveMinimapTilePx.toFixed(
      2,
    )} tilePxScale=${plan.minimapTilePxScale.toFixed(3)} radiusRatio=${plan.minimapRadiusRatio.toFixed(
      3,
    )} offset=${plan.projectionOffsetLocalX.toFixed(1)},${plan.projectionOffsetLocalY.toFixed(
      1,
    )} minimap=${plan.minimapSource}/${plan.projectionSource}. ${formatWorldRoutePlan(route)}.`,
  );

  return createWalkingState(state, route, nowMs, "banking-walking");
}

async function clickOrRouteToBankTarget(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  target: BankCacheTarget,
): Promise<BotState> {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  if (!calibration || !playerTile) {
    return state;
  }

  const targetDistanceTiles = getWorldTileDistanceToRectangle(playerTile, target.rectangle);
  const scenePlan =
    targetDistanceTiles <= BANK_DIRECT_SCENE_CLICK_MAX_DISTANCE_TILES
      ? await prepareMiningSceneClickPlan(calibration, playerTile, bankTargetAsSceneClickTarget(target), "bank-target", {
          sampleSource: "bank-click-hover",
          allowRoughProjectionFallbackClick: false,
          requireHoverValidation: true,
        })
      : null;

  if (scenePlan) {
    const clicked = await clickMiningScenePlan(calibration, scenePlan);
    log(
      `Clicked bank target ${formatBankTarget(target)} screen=${clicked.x},${clicked.y} local=${scenePlan.localPoint.x},${
        scenePlan.localPoint.y
      } distance=${targetDistanceTiles} tile(s) projection=${scenePlan.projectionSource} fitSamples=${
        scenePlan.calibrationSampleCount ?? 0
      } fitMean=${scenePlan.calibrationMeanErrorPx?.toFixed(1) ?? "n/a"} clickReason=${scenePlan.clickReason} hover='${
        scenePlan.hoveredLine ?? "unread"
      }' finalError=${scenePlan.finalErrorTiles ?? "n/a"} attempts=${formatMiningSceneHoverAttempts(scenePlan.attempts)}.`,
    );
    return {
      ...state,
      phase: "banking-find-orb",
      actionLockUntilMs: deadlineFromNowTicks(BANK_CLICK_CONFIRM_TICKS, nowMs),
      expectedTile: target.clickTile,
      pendingMiningClick: null,
      activeMiningTarget: null,
      waitingForActiveTargetYellowSinceMs: null,
      bankDepositScreen: clicked,
      bankOrbScreen: null,
      emptyBagInBankScreen: null,
      bankOrbFindAttemptCount: 0,
    };
  }

  const route = planWorldRouteToTiles(playerTile, {
    destinationLabel: target.targetLabel,
    destinationTile: target.clickTile,
    targetTiles: target.interactionTiles,
    waypointStepLimit: ROUTE_WAYPOINT_STEP_LIMIT,
    maxCrossRegionCount: ROUTE_MAX_CROSS_REGION_COUNT,
  });

  if (route.status === "unavailable") {
    warn(`No cached-map route to bank target ${formatBankTarget(target)}: ${route.reason ?? "unknown"}.`);
    return addFailedBankTargetCooldown(state, nowMs, target.key, route.reason ?? "bank-route-unavailable");
  }

  if (route.status === "already-there") {
    warn(
      `Already in cached interaction range for ${formatBankTarget(
        target,
      )} but the scene projection is not clickable; cooling bank target briefly.`,
    );
    return addFailedBankTargetCooldown(state, nowMs, target.key, "bank-in-range-projection-unavailable");
  }

  return clickRouteMinimapWaypointToBank(state, nowMs, tick, target, route);
}

function isLocalPointInsideBitmap(point: ScreenPoint, bitmap: Pick<RobotBitmap, "width" | "height">): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < bitmap.width && point.y < bitmap.height;
}

function getActiveTargetMarkerSearchRadiusPx(calibration: StartupPlayerTileCalibration): number {
  return clamp(
    Math.round(calibration.tilePx * ACTIVE_TARGET_YELLOW_MARKER_TILE_RADIUS_MULTIPLIER),
    ACTIVE_TARGET_YELLOW_MARKER_MIN_RADIUS_PX,
    ACTIVE_TARGET_YELLOW_MARKER_MAX_RADIUS_PX,
  );
}

function sanitizeDebugFileSegment(value: string, maxLength: number = 90): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (sanitized || "unknown").slice(0, maxLength).replace(/-+$/g, "") || "unknown";
}

function buildMiningTargetSwitchDebugPath(reason: string, targetKey: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    MINING_TARGET_SWITCH_DEBUG_DIR,
    `${timestamp}-mining-target-switch-${sanitizeDebugFileSegment(reason, 36)}-${sanitizeDebugFileSegment(
      targetKey,
      70,
    )}.png`,
  );
}

async function saveMiningTargetSwitchDebugScreenshot(
  tick: TickCapture,
  context: {
    reason: string;
    targetKey: string;
    targetLabel: string;
    localPoints: readonly ScreenPoint[];
    marker: { box: MithrilActiveMarkerBox; distancePx: number; radiusPx: number } | null;
    lastClickScreen?: ScreenPoint | null;
    observedMineMs?: number | null;
  },
): Promise<void> {
  const bitmap = tick.bitmap;
  const calibration = tick.calibration;
  if (!bitmap || !calibration) {
    return;
  }

  const shapes: DebugOverlayShape[] = [
    {
      type: "points",
      points: context.localPoints,
      color: { r: 0, g: 220, b: 255 },
      thickness: 4,
    },
  ];
  if (context.lastClickScreen) {
    const lastClickLocal = screenPointToLocal(calibration, context.lastClickScreen);
    shapes.push({
      type: "cross",
      x: lastClickLocal.x,
      y: lastClickLocal.y,
      radius: 14,
      color: { r: 255, g: 0, b: 255 },
      thickness: 3,
    });
  }
  if (context.marker) {
    shapes.push(
      {
        type: "box",
        x: context.marker.box.x,
        y: context.marker.box.y,
        width: context.marker.box.width,
        height: context.marker.box.height,
        color: { r: 255, g: 230, b: 0 },
        thickness: 3,
      },
      {
        type: "circle",
        x: context.marker.box.centerX,
        y: context.marker.box.centerY,
        radius: context.marker.radiusPx,
        color: { r: 255, g: 230, b: 0 },
        thickness: 2,
      },
    );
  }

  const debugPath = buildMiningTargetSwitchDebugPath(context.reason, context.targetKey);
  try {
    await saveBitmapWithDebugOverlay(bitmap, debugPath, shapes);
    log(
      `Mining target switch screenshot saved: reason=${context.reason} target=${context.targetLabel} path=${debugPath} marker=${
        context.marker
          ? `${context.marker.box.centerX},${context.marker.box.centerY} distance=${context.marker.distancePx.toFixed(
              1,
            )}px radius=${context.marker.radiusPx}px`
          : "none"
      } points=${context.localPoints.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join("|") || "none"} miningStatus=${
        tick.miningStatus?.status ?? "unavailable"
      } observedMine=${context.observedMineMs !== undefined && context.observedMineMs !== null ? formatDurationMs(context.observedMineMs) : "n/a"}.`,
    );
  } catch (error) {
    warn(
      `Mining target switch screenshot save failed: reason=${context.reason} target=${context.targetLabel} path=${debugPath} error=${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }
}

function getActiveMiningTargetLocalPoints(state: BotState, tick: TickCapture): ScreenPoint[] {
  const activeTarget = state.activeMiningTarget;
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  const playerTile = tick.playerTile;
  if (!activeTarget || !calibration || !bitmap) {
    return [];
  }

  const points: ScreenPoint[] = [];
  const addPoint = (point: ScreenPoint | null) => {
    if (!point || !isLocalPointInsideBitmap(point, bitmap)) {
      return;
    }

    if (points.some((existing) => Math.hypot(existing.x - point.x, existing.y - point.y) <= 2)) {
      return;
    }

    points.push(point);
  };

  if (playerTile) {
    const projected = projectWorldTileToScreen(calibration, playerTile, activeTarget.clickTile);
    addPoint(projected ? screenPointToLocal(calibration, projected) : null);
  }

  addPoint(screenPointToLocal(calibration, activeTarget.lastClickScreen));
  return points;
}

function findYellowMarkerNearActiveMiningTarget(
  state: BotState,
  tick: TickCapture,
): { box: MithrilActiveMarkerBox; distancePx: number; radiusPx: number } | null {
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  if (!state.activeMiningTarget || !calibration || !bitmap) {
    return null;
  }

  const localPoints = getActiveMiningTargetLocalPoints(state, tick);
  if (localPoints.length === 0) {
    return null;
  }

  const radiusPx = getActiveTargetMarkerSearchRadiusPx(calibration);
  let bestMatch: { box: MithrilActiveMarkerBox; distancePx: number; radiusPx: number } | null = null;

  for (const box of detectMithrilActiveMarkerBoxesInScreenshot(bitmap)) {
    for (const point of localPoints) {
      const distancePx = Math.hypot(box.centerX - point.x, box.centerY - point.y);
      if (distancePx > radiusPx || (bestMatch && bestMatch.distancePx <= distancePx)) {
        continue;
      }

      bestMatch = { box, distancePx, radiusPx };
    }
  }

  return bestMatch;
}

function getMiningTargetLocalPoints(tick: TickCapture, target: MiningCacheTarget): ScreenPoint[] {
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  const playerTile = tick.playerTile;
  if (!calibration || !bitmap || !playerTile) {
    return [];
  }

  const points: ScreenPoint[] = [];
  const addPoint = (point: ScreenPoint | null) => {
    if (!point || !isLocalPointInsideBitmap(point, bitmap)) {
      return;
    }

    if (points.some((existing) => Math.hypot(existing.x - point.x, existing.y - point.y) <= 2)) {
      return;
    }

    points.push(point);
  };

  const projectedClickTile = projectWorldTileToScreen(calibration, playerTile, target.clickTile);
  addPoint(projectedClickTile ? screenPointToLocal(calibration, projectedClickTile) : null);
  for (const tile of getMiningTargetFootprintTiles(target)) {
    const projected = projectWorldTileToScreen(calibration, playerTile, tile);
    addPoint(projected ? screenPointToLocal(calibration, projected) : null);
  }

  return points;
}

function findYellowMarkerNearMiningTarget(
  tick: TickCapture,
  target: MiningCacheTarget,
): { box: MithrilActiveMarkerBox; distancePx: number; radiusPx: number } | null {
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  if (!calibration || !bitmap) {
    return null;
  }

  const localPoints = getMiningTargetLocalPoints(tick, target);
  if (localPoints.length === 0) {
    return null;
  }

  const radiusPx = getActiveTargetMarkerSearchRadiusPx(calibration);
  let bestMatch: { box: MithrilActiveMarkerBox; distancePx: number; radiusPx: number } | null = null;
  for (const box of detectMithrilActiveMarkerBoxesInScreenshot(bitmap)) {
    for (const point of localPoints) {
      const distancePx = Math.hypot(box.centerX - point.x, box.centerY - point.y);
      if (distancePx > radiusPx || (bestMatch && bestMatch.distancePx <= distancePx)) {
        continue;
      }

      bestMatch = { box, distancePx, radiusPx };
    }
  }

  return bestMatch;
}

function selectClosestMiningTargetByPath(
  playerTile: WorldTile,
  targets: readonly MiningCacheTarget[],
): MiningTargetPathSelectionResult {
  const targetTilesByKey = new Map<string, MiningCacheTarget[]>();
  const targetTiles: WorldRouteTile[] = [];
  for (const target of targets) {
    for (const tile of target.interactionTiles) {
      if (tile.z !== playerTile.z) {
        continue;
      }

      const key = getRouteTileKey(tile);
      const entries = targetTilesByKey.get(key) ?? [];
      entries.push(target);
      targetTilesByKey.set(key, entries);
      if (entries.length === 1) {
        targetTiles.push(tile);
      }
    }
  }

  if (targetTiles.length === 0) {
    return { status: "empty" };
  }

  const route = planWorldRouteToTiles(playerTile, {
    destinationLabel: "selected ore rocks",
    targetTiles,
    waypointStepLimit: ROUTE_WAYPOINT_STEP_LIMIT,
    maxCrossRegionCount: ROUTE_MAX_CROSS_REGION_COUNT,
  });

  if (route.status === "unavailable") {
    return { status: "unavailable", route };
  }

  if (!route.targetTile) {
    return { status: "unmapped", route };
  }

  const matchingTargets = targetTilesByKey.get(getRouteTileKey(route.targetTile)) ?? [];
  const target = sortMiningTargetsByDirectDistance(playerTile, matchingTargets)[0] ?? null;
  if (!target) {
    return { status: "unmapped", route };
  }

  return {
    status: "selected",
    selection: {
      target,
      route,
      targetCount: targets.length,
    },
  };
}

async function handleActiveMiningTargetYellowMarker(state: BotState, nowMs: number, tick: TickCapture): Promise<BotState | null> {
  if (state.phase !== "mining" && state.phase !== "confirming-click") {
    return null;
  }

  const activeTarget = state.activeMiningTarget;
  if (!activeTarget) {
    return null;
  }

  const match = findYellowMarkerNearActiveMiningTarget(state, tick);
  if (!match) {
    return null;
  }

  const observedMineMs = nowMs - activeTarget.clickedAtMs;
  const nextMiningStatsByOreId = rememberMiningOreSessionStats(
    state.miningStatsByOreId,
    activeTarget.oreId,
    observedMineMs,
    nowMs,
  );
  const nextStats = nextMiningStatsByOreId[activeTarget.oreId] ?? null;
  persistObservedMiningStats(activeTarget.oreId, observedMineMs);
  const depletion = rememberDepletedMiningTarget(
    { ...state, miningStatsByOreId: nextMiningStatsByOreId },
    nowMs,
    activeTarget,
    "yellow-marker",
    Number.isFinite(observedMineMs) ? Math.round(observedMineMs) : null,
  );
  await saveMiningTargetSwitchDebugScreenshot(tick, {
    reason: "active-target-yellow-marker",
    targetKey: activeTarget.targetKey,
    targetLabel: activeTarget.targetLabel,
    localPoints: getActiveMiningTargetLocalPoints(state, tick),
    marker: match,
    lastClickScreen: activeTarget.lastClickScreen,
    observedMineMs,
  });

  log(
    `Active ore target marker turned yellow near ${activeTarget.targetLabel} marker=${match.box.centerX},${
      match.box.centerY
    } distance=${match.distancePx.toFixed(1)}px radius=${match.radiusPx}px; marking depleted for ${formatRespawnInfo(
      getOreRespawnInfo(activeTarget.oreId, activeTarget.clickTile),
    )} observedMine=${formatDurationMs(observedMineMs)} avgMine=${
      nextStats ? formatDurationMs(nextStats.averageMineMs) : "n/a"
    } samples=${nextStats?.sampleCount ?? 0}.`,
  );

  return {
    ...state,
    phase: "searching",
    actionLockUntilMs: 0,
    expectedTile: null,
    pendingMiningClick: null,
    activeMiningTarget: null,
    waitingForActiveTargetYellowSinceMs: null,
    depletedTargets: depletion.depletedTargets,
    miningStatsByOreId: nextMiningStatsByOreId,
  };
}

function handleMiningStatus(state: BotState, nowMs: number, miningStatus: MiningBoxStatusDetection | null): BotState | null {
  if (!miningStatus?.isMining) {
    if (state.phase === "mining") {
      const activeTarget = state.activeMiningTarget;
      if (activeTarget) {
        const waitingSince = state.waitingForActiveTargetYellowSinceMs ?? nowMs;
        if (!state.waitingForActiveTargetYellowSinceMs) {
          log(
            `Mining status is ${miningStatus?.status ?? "unavailable"} before active ore marker turned yellow; waiting for yellow marker on ${activeTarget.targetLabel} before scanning another target.`,
          );
        } else if (shouldLogStatus(state, nowMs)) {
          return withStatusLogTime(
            {
              ...state,
              waitingForActiveTargetYellowSinceMs: waitingSince,
              actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
            },
            nowMs,
          );
        }

        return {
          ...state,
          waitingForActiveTargetYellowSinceMs: waitingSince,
          actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
        };
      } else {
        log("Mining status ended with no active ore target; searching for the next selected ore target.");
      }

      return {
        ...state,
        phase: "searching",
        pendingMiningClick: null,
        activeMiningTarget: null,
        waitingForActiveTargetYellowSinceMs: null,
        actionLockUntilMs: 0,
      };
    }

    return null;
  }

  if (state.phase !== "mining") {
    log(
      `Mining confirmed by status box confidence=${miningStatus.confidence.toFixed(2)} green=${miningStatus.greenPixelCount} red=${miningStatus.redPixelCount}.`,
    );
  } else if (shouldLogStatus(state, nowMs)) {
    return withStatusLogTime(
    {
      ...state,
      waitingForActiveTargetYellowSinceMs: null,
      actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
    },
      nowMs,
    );
  }

  return {
    ...state,
    phase: "mining",
    pendingMiningClick: null,
    waitingForActiveTargetYellowSinceMs: null,
    actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
  };
}

function handlePendingMiningClick(state: BotState, nowMs: number): BotState | null {
  const pending = state.pendingMiningClick;
  if (!pending) {
    return null;
  }

  if (nowMs < pending.deadlineMs) {
    return state;
  }

  warn(
    `Mining did not start after clicking ${pending.targetLabel}; cooling target for ${Math.round(
      FAILED_TARGET_COOLDOWN_MS / 1000,
    )}s.`,
  );
  return addFailedTargetCooldown(
    {
      ...state,
      phase: "searching",
      pendingMiningClick: null,
      activeMiningTarget: null,
      waitingForActiveTargetYellowSinceMs: null,
      actionLockUntilMs: 0,
    },
    nowMs,
    pending.targetKey,
    "mining-not-confirmed",
  );
}

function createMiningSearchStateAfterBanking(state: BotState, nowMs: number): BotState {
  return {
    ...state,
    phase: "searching",
    actionLockUntilMs: nowMs,
    expectedTile: null,
    pendingMiningClick: null,
    activeMiningTarget: null,
    waitingForActiveTargetYellowSinceMs: null,
    bankDepositScreen: null,
    bankOrbScreen: null,
    emptyBagInBankScreen: null,
    bankOrbFindAttemptCount: 0,
  };
}

function createBankSearchState(state: BotState, nowMs: number): BotState {
  return {
    ...state,
    phase: "banking-search-target",
    actionLockUntilMs: nowMs,
    pendingMiningClick: null,
    activeMiningTarget: null,
    waitingForActiveTargetYellowSinceMs: null,
    bankDepositScreen: null,
    bankOrbScreen: null,
    emptyBagInBankScreen: null,
    bankOrbFindAttemptCount: 0,
  };
}

function reClickBankDepositScreen(state: BotState, nowMs: number, tick: TickCapture, reason: string): BotState {
  if (!tick.calibration || !state.bankDepositScreen) {
    warn(`${reason}; restarting cached-map bank search because no bank deposit screen point is cached.`);
    return createBankSearchState(state, deadlineFromNowTicks(1, nowMs));
  }

  const clicked = clickScreenPoint(state.bankDepositScreen.x, state.bankDepositScreen.y, tick.calibration.captureBounds, {
    safeEdgeMarginPx: BANK_UI_CLICK_SAFE_EDGE_MARGIN_PX,
    settleMs: randomIntInclusive(45, 120),
  });
  log(`${reason}; re-clicking cached bank target at (${clicked.x},${clicked.y}) before retrying deposit-orb detection.`);
  return {
    ...state,
    phase: "banking-find-orb",
    actionLockUntilMs: deadlineFromNowTicks(BANK_CLICK_CONFIRM_TICKS, nowMs),
    bankDepositScreen: clicked,
    bankOrbScreen: null,
    emptyBagInBankScreen: null,
    bankOrbFindAttemptCount: 0,
  };
}

function runBankingFindOrbTick(state: BotState, nowMs: number, tick: TickCapture): BotState {
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  if (!calibration || !bitmap) {
    return state;
  }

  const captureBounds = calibration.captureBounds;
  if (state.bankOrbScreen && state.emptyBagInBankScreen) {
    const clickedOrb = clickScreenPoint(state.bankOrbScreen.x, state.bankOrbScreen.y, captureBounds, {
      safeEdgeMarginPx: BANK_UI_CLICK_SAFE_EDGE_MARGIN_PX,
      settleMs: randomIntInclusive(45, 120),
    });
    const clickedEmptyBag = clickScreenPoint(
      state.emptyBagInBankScreen.x,
      state.emptyBagInBankScreen.y,
      captureBounds,
      {
        safeEdgeMarginPx: BANK_UI_CLICK_SAFE_EDGE_MARGIN_PX,
        settleMs: randomIntInclusive(45, 120),
      },
    );
    log(
      `Re-clicking cached bank orb (${clickedOrb.x},${clickedOrb.y}) and empty-bag (${clickedEmptyBag.x},${clickedEmptyBag.y}).`,
    );

    return {
      ...state,
      bankOrbFindAttemptCount: 0,
      actionLockUntilMs: deadlineFromNowTicks(2, nowMs),
    };
  }

  const orbReferenceBitmap = getBankDepositOrbReferenceBitmap();
  if (!orbReferenceBitmap) {
    return {
      ...createBankSearchState(state, deadlineFromNowTicks(2, nowMs)),
      failedBankTargets: pruneFailedTargets(state.failedBankTargets, nowMs),
    };
  }

  const orbResult = detectBankDepositIconWithOrb(orbReferenceBitmap, bitmap);
  if (!orbResult.detection) {
    const nextAttemptCount = state.bankOrbFindAttemptCount + 1;
    if (nextAttemptCount >= BANK_ORB_FIND_RETRY_MAX) {
      return reClickBankDepositScreen(
        state,
        nowMs,
        tick,
        `Bank deposit orb not found after ${nextAttemptCount} attempt(s)`,
      );
    }

    if (state.loopIndex % 3 === 0) {
      log(
        `Waiting for bank deposit orb after cached-map bank click (attempt ${nextAttemptCount}/${BANK_ORB_FIND_RETRY_MAX}, sceneKeypoints=${orbResult.sceneKeypointCount}, rawMatches=${orbResult.rawMatchCount}).`,
      );
    }

    return {
      ...state,
      bankOrbFindAttemptCount: nextAttemptCount,
      actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
    };
  }

  const orbScreenX = captureBounds.x + orbResult.detection.centerX;
  const orbScreenY = captureBounds.y + orbResult.detection.centerY;
  if (state.bankDepositScreen) {
    const orbDistanceFromDepositPx = axisDistance(
      orbScreenX - state.bankDepositScreen.x,
      orbScreenY - state.bankDepositScreen.y,
    );
    const maxDistanceFromDepositPx = resolveBankOrbMaxDistanceFromDepositPx(captureBounds);
    if (orbDistanceFromDepositPx > maxDistanceFromDepositPx) {
      const nextAttemptCount = state.bankOrbFindAttemptCount + 1;
      const rejectionMessage = `Ignoring bank orb candidate at (${orbResult.detection.centerX},${
        orbResult.detection.centerY
      }) score=${orbResult.detection.score.toFixed(1)} because it is ${orbDistanceFromDepositPx}px from cached bank click (${
        state.bankDepositScreen.x
      },${state.bankDepositScreen.y}) and exceeds ${maxDistanceFromDepositPx}px`;

      if (nextAttemptCount >= BANK_ORB_FIND_RETRY_MAX) {
        return reClickBankDepositScreen(state, nowMs, tick, rejectionMessage);
      }

      warn(`${rejectionMessage}; waiting for a closer orb candidate (${nextAttemptCount}/${BANK_ORB_FIND_RETRY_MAX}).`);
      return {
        ...state,
        bankOrbFindAttemptCount: nextAttemptCount,
        actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
      };
    }
  }

  const clickedOrb = clickScreenPoint(orbScreenX, orbScreenY, captureBounds, {
    safeEdgeMarginPx: BANK_UI_CLICK_SAFE_EDGE_MARGIN_PX,
    settleMs: randomIntInclusive(45, 120),
  });
  const emptyBagScreen = resolveEmptyBagInBankScreenPoint(orbResult.detection, captureBounds);
  const clickedEmptyBag = clickScreenPoint(emptyBagScreen.x, emptyBagScreen.y, captureBounds, {
    safeEdgeMarginPx: BANK_UI_CLICK_SAFE_EDGE_MARGIN_PX,
    settleMs: randomIntInclusive(45, 120),
  });

  log(
    `Bank orb detected at (${orbResult.detection.centerX},${orbResult.detection.centerY}) score=${orbResult.detection.score.toFixed(
      1,
    )}; clicked bank orb (${clickedOrb.x},${clickedOrb.y}) and empty-bag (${clickedEmptyBag.x},${clickedEmptyBag.y}), then waiting for selected ore to clear from inventory.`,
  );

  return {
    ...state,
    bankOrbScreen: clickedOrb,
    emptyBagInBankScreen: clickedEmptyBag,
    bankOrbFindAttemptCount: 0,
    actionLockUntilMs: deadlineFromNowTicks(2, nowMs),
  };
}

async function runBankingTick(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  selectedOreDefinitions: readonly AllInOneMiningOreDefinition[],
): Promise<BotState> {
  const selectedOreItemIds = getSelectedOreInventoryItemIds(selectedOreDefinitions);
  if (tick.inventoryItems && selectedOreItemIds.size > 0) {
    const remainingSelectedOreQuantity = getInventoryItemQuantity(tick.inventoryItems, selectedOreItemIds);
    if (remainingSelectedOreQuantity === 0) {
      log(
        `Inventory has no selected ore after deposit; returning to ore search. selectedOreItemIds=${formatInventoryItemIds(
          selectedOreItemIds,
        )} ${formatInventoryCount(tick)}.`,
      );
      return createMiningSearchStateAfterBanking(state, nowMs);
    }
  } else if (tick.inventoryCount === FALLBACK_INVENTORY_EMPTY_FREE_SLOT_COUNT) {
    log(`Inventory has ${formatInventoryCount(tick)} after deposit; returning to ore search.`);
    return createMiningSearchStateAfterBanking(state, nowMs);
  }

  if (!tick.calibration || !tick.bitmap || !tick.playerTile) {
    if (shouldLogStatus(state, nowMs)) {
      warn("Waiting for coordinate/player calibration before cached-map bank scan.");
      return withStatusLogTime(state, nowMs);
    }
    return state;
  }

  if (isActionLocked(state, nowMs)) {
    return state;
  }

  if (state.phase === "banking-find-orb") {
    return runBankingFindOrbTick(state, nowMs, tick);
  }

  const failedBankTargets = pruneFailedTargets(state.failedBankTargets, nowMs);
  const targets = scanBankTargets(tick.playerTile).filter((target) => !isTargetCoolingDown(target, failedBankTargets));
  if (targets.length === 0) {
    if (shouldLogStatus(state, nowMs)) {
      log(
        `No cached bank deposit box/chest found in nearby map regions. player=${formatWorldTile(
          tick.playerTile,
        )} priority=Bank Deposit Box cooling=${failedBankTargets.length}.`,
      );
      return withStatusLogTime({ ...state, failedBankTargets }, nowMs);
    }

    return { ...state, failedBankTargets };
  }

  const target = selectNearestBankTarget(tick.playerTile, targets);
  if (!target) {
    return { ...state, failedBankTargets };
  }

  return clickOrRouteToBankTarget(
    {
      ...state,
      phase: state.phase === "banking-walking" ? "banking-search-target" : state.phase,
      failedBankTargets,
    },
    nowMs,
    tick,
    target,
  );
}

async function runMiningSearchTick(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  selectedOreDefinitions: readonly AllInOneMiningOreDefinition[],
): Promise<BotState> {
  if (!tick.calibration || !tick.bitmap || !tick.playerTile) {
    if (shouldLogStatus(state, nowMs)) {
      warn("Waiting for coordinate/player calibration before cached-map mining scan.");
      return withStatusLogTime(state, nowMs);
    }
    return state;
  }

  if (isActionLocked(state, nowMs)) {
    return state;
  }

  const failedTargets = pruneFailedTargets(state.failedTargets, nowMs);
  const targets = scanSelectedOreTargets(tick.playerTile, selectedOreDefinitions).filter(
    (target) => !isTargetCoolingDown(target, failedTargets),
  );
  if (targets.length === 0) {
    if (shouldLogStatus(state, nowMs)) {
      log(
        `No selected ore rocks found in nearby cached map regions. player=${formatWorldTile(
          tick.playerTile,
        )} selected=${selectedOreDefinitions.map((ore) => ore.label).join(", ")} cooling=${failedTargets.length}.`,
      );
      return withStatusLogTime({ ...state, failedTargets }, nowMs);
    }

    return { ...state, failedTargets };
  }

  const workAreaResult = resolveMiningWorkArea({ ...state, failedTargets }, nowMs, tick.playerTile, targets);
  const workAreaTargets = workAreaResult.targets;
  if (workAreaTargets.length === 0) {
    if (shouldLogStatus(state, nowMs)) {
      log(
        `No selected ore rocks inside the active mining work area. player=${formatWorldTile(
          tick.playerTile,
        )} selected=${selectedOreDefinitions.map((ore) => ore.label).join(", ")} candidates=${targets.length}.`,
      );
      return withStatusLogTime(workAreaResult.state, nowMs);
    }

    return workAreaResult.state;
  }

  const schedulerState = await rememberVisibleYellowWorkAreaTargets(workAreaResult.state, nowMs, tick, workAreaTargets);
  const selectionResult = selectMiningTargetByWorkAreaScheduler(
    nowMs,
    tick.playerTile,
    workAreaTargets,
    schedulerState.depletedTargets,
  );
  if (selectionResult.status === "selected") {
    const { target, route, targetCount, scoreMs, travelMs, waitMs, pathfinderMs } = selectionResult.selection;

    if (pathfinderMs >= 250 || shouldLogStatus(schedulerState, nowMs)) {
      log(
        `Mining scheduler selected target: target=${formatTarget(target)} path=${route.pathLength} step(s) direct=${
          route.directDistanceToTargetTiles
        } score=${formatDurationMs(scoreMs)} travel=${formatDurationMs(travelMs)} wait=${formatDurationMs(
          waitMs,
        )} pathfinder=${pathfinderMs}ms workAreaTargets=${targetCount} depleted=${
          schedulerState.depletedTargets.length
        }.`,
      );
    }

    return clickOrRouteToTarget(
      {
        ...schedulerState,
        phase: state.phase === "walking" ? "searching" : state.phase,
        failedTargets,
      },
      nowMs,
      tick,
      target,
      route,
    );
  }

  if (shouldLogStatus(state, nowMs)) {
    if (selectionResult.status === "waiting") {
      log(
        `Mining scheduler waiting for work area target respawn: target=${formatTarget(
          selectionResult.target,
        )} wait=${formatDurationMs(selectionResult.waitMs)} path=${selectionResult.route.pathLength} step(s) workAreaTargets=${
          selectionResult.targetCount
        } depleted=${schedulerState.depletedTargets.length}.`,
      );
      return withStatusLogTime(
        {
          ...schedulerState,
          actionLockUntilMs:
            selectionResult.waitMs > MINING_TARGET_WAIT_LOG_THRESHOLD_MS
              ? deadlineFromNowTicks(1, nowMs)
              : nowMs + Math.max(80, Math.round(selectionResult.waitMs)),
        },
        nowMs,
      );
    }

    const reason = selectionResult.status === "unavailable" ? selectionResult.reason : "no same-plane interaction tiles";
    log(
      `No pathfinder-reachable selected ore target found. player=${formatWorldTile(tick.playerTile)} selected=${selectedOreDefinitions
        .map((ore) => ore.label)
        .join(", ")} candidates=${targets.length} workAreaTargets=${workAreaTargets.length} reason=${reason}.`,
    );
    return withStatusLogTime(schedulerState, nowMs);
  }

  return schedulerState;
}

async function runLoopTick(
  state: BotState,
  nowMs: number,
  tick: TickCapture,
  selectedOreDefinitions: readonly AllInOneMiningOreDefinition[],
): Promise<BotState> {
  const bankingPhase = isBankingPhase(state.phase);
  if (tick.inventoryCount === INVENTORY_FULL_FREE_SLOT_COUNT && !bankingPhase) {
    log(`Inventory is full (${formatInventoryCount(tick)}); switching to cached-map banking.`);
    return runBankingTick(createBankSearchState(state, nowMs), nowMs, tick, selectedOreDefinitions);
  }

  if (bankingPhase) {
    return runBankingTick(state, nowMs, tick, selectedOreDefinitions);
  }

  const yellowMarkerState = await handleActiveMiningTargetYellowMarker(state, nowMs, tick);
  if (yellowMarkerState) {
    return runMiningSearchTick(yellowMarkerState, nowMs, tick, selectedOreDefinitions);
  }

  const miningState = handleMiningStatus(state, nowMs, tick.miningStatus);
  if (miningState) {
    if (miningState.phase === "mining") {
      return miningState;
    }

    return runMiningSearchTick(miningState, nowMs, tick, selectedOreDefinitions);
  }

  const pendingState = handlePendingMiningClick(state, nowMs);
  if (pendingState) {
    return pendingState;
  }

  return runMiningSearchTick(state, nowMs, tick, selectedOreDefinitions);
}

async function runLoop(
  window: NonNullable<ReturnType<typeof getRuneLite>>,
  config: AllInOneMiningConfig,
  selectedOreDefinitions: readonly AllInOneMiningOreDefinition[],
): Promise<void> {
  if (isLoopRunning) {
    log("Loop already running.");
    return;
  }

  isLoopRunning = true;
  setAutomateBotCurrentStep(MINING_ALL_IN_ONE_BOT_ID);

  try {
    await runBotEngine<BotState, EngineFunctionKey, TickCapture>({
      tickMs: GAME_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: () => createInitialState(config),
      captureTick: async ({ state }) => {
        const calibration = readStartupPlayerTileCalibration(window, {
          expectedTile: state.expectedTile,
          maxTileJump: state.expectedTile ? 256 : undefined,
        });
        if (!calibration) {
          return {
            calibration: null,
            bitmap: null,
            playerTile: null,
            miningStatus: null,
            inventoryCount: null,
            inventoryCountSource: "unavailable",
            inventoryCountSummary: "calibration unavailable",
            inventoryItems: null,
          };
        }

        const bitmap = captureScreenBitmap(calibration.captureBounds);
        const inventory = await readInventoryFreeSlots(bitmap);
        return {
          calibration,
          bitmap,
          playerTile: calibration.playerTile,
          miningStatus: detectMiningBoxStatusInScreenshot(bitmap),
          inventoryCount: inventory.count,
          inventoryCountSource: inventory.source,
          inventoryCountSummary: inventory.summary,
          inventoryItems: inventory.items,
        };
      },
      functions: {
        loop: ({ state, nowMs, tickCapture }) =>
          runLoopTick(state, nowMs, tickCapture, selectedOreDefinitions),
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          `[${formatElapsedSinceStart()}] Automate Bot (${BOT_NAME}): #${state.loopIndex} [${state.phase}] tick error - ${message}`,
        );
      },
    });
  } finally {
    isLoopRunning = false;
    startedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onMiningAllInOneBotStart(): void {
  const config = getSavedAllInOneMiningConfig();
  const selectedOreDefinitions = getSelectedOreDefinitions(config);

  if (selectedOreDefinitions.length === 0) {
    const message = "Select at least one ore rock in the All-In-One mining config before starting.";
    notifyUserAndStop(message);
    return;
  }

  if (!isLoopRunning) {
    startedAtMs = Date.now();
    cachedRegionViews = new Map();
  }

  log("STARTED.");
  log(
    `Config: engineTick=${GAME_TICK_MS}ms, cached-map=on, selected=${selectedOreDefinitions
      .map((ore) => ore.label)
      .join(", ")}, regionRadius=${SEARCH_REGION_RADIUS}, directSceneClick=${DIRECT_SCENE_CLICK_MAX_DISTANCE_TILES} path step(s), sceneClick=end-to-end-hover-calibrated, targetSelection=pathfinder-closest-wait-yellow-clear, bankTargetPriority=Bank Deposit Box, bankOnFreeSlots=${INVENTORY_FULL_FREE_SLOT_COUNT}, resumeWhenSelectedOreMissing=on, fallbackResumeOnFreeSlots=${FALLBACK_INVENTORY_EMPTY_FREE_SLOT_COUNT}.`,
  );

  const window = getRuneLite();
  if (!window) {
    const message = "All-In-One mining could not start because the RuneLite window was not found.";
    warn(message);
    notifyUserAndStop(message);
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();
  void runLoop(window, config, selectedOreDefinitions).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Startup failed: ${message}`);
    notifyUserAndStop(message);
  });
}
