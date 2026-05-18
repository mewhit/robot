import path from "path";
import { Window } from "node-window-manager";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap, type ScreenBitmap } from "../windowsScreenCapture";
import { readOsrsCacheMapRegionView, type OsrsCacheMapObject, type OsrsCacheMapTile } from "./cache/cache-map-view";
import { CollisionFlag } from "./cache/region-collision";
import { runBotEngine, type BotEngineLoopState } from "./engine/bot-engine";
import { buildWorldTileKey, deriveWorldTile, type WorldTile } from "./mapping/world-coordinate";
import {
  detectAgilityOutlines,
  formatAgilityOutline,
  pickNearestAgilityOutlineToPoint,
  type AgilityOutlineColor,
  type AgilityOutlineDetection,
} from "./shared/agility-outline-detector";
import { clamp, pickBoxInteractionScreenPoint, randomIntInclusive } from "./shared/osrs-helper";
import { clickScreenPoint, moveMouseHumanLike, type ScreenPoint } from "./shared/robot-clicker";
import { saveBitmapWithDebugOverlay, type DebugOverlayShape } from "./shared/debug-image-overlay";
import {
  formatStartupPlayerTileCalibrationLog,
  readStartupPlayerTileCalibration,
  type StartupPlayerTileCalibration,
} from "./shared/startup-calibration";
import {
  fetchRuneLiteLocalApiSnapshot,
  formatRuneLiteLocalApiSnapshot,
  type RuneLiteLocalApiSnapshot,
} from "./runelite-local-api/runelite-local-api";

const BOT_NAME = "Rooftop";
const BOT_LOG_PREFIX = `Automate Bot (${BOT_NAME})`;
const FALADOR_COURSE_LABEL = "Falador rooftop";

const FALADOR_REGION_X = 47;
const FALADOR_REGION_Y = 52;
const FALADOR_ENTRY_TILE = deriveWorldTile(3036, 3339, 0);
const FALADOR_ENTRY_OBJECT_SEARCH_TILE = deriveWorldTile(3036, 3342, 0);
const FALADOR_ENTRY_RADIUS_TILES = 5;
const BOT_TICK_MS = 200;
const GAME_TICK_MS = 600;
const CLICK_INTERVAL_MIN_MS = 500;
const CLICK_INTERVAL_MAX_MS = 1000;
const OUTLINE_MATCH_RADIUS_PX = 300;
const ENTRY_OUTLINE_MATCH_RADIUS_PX = 320;
const OBSTACLE_PROJECTION_CLICK_JITTER_PX = 0;
const OUTLINE_INTERIOR_SCAN_RADIUS_PX = 24;
const OUTLINE_INTERIOR_MIN_GAP_PX = 6;
const WIDE_HORIZONTAL_OUTLINE_Y_TOLERANCE_PX = 90;
const WIDE_HORIZONTAL_OUTLINE_MIN_WIDTH_PX = 150;
const WIDE_HORIZONTAL_OUTLINE_MAX_HEIGHT_PX = 115;
const WIDE_HORIZONTAL_OUTLINE_MIN_PIXELS = 450;
const ENTRY_VISIBLE_FALLBACK_RADIUS_TILES = 12;
const OBSTACLE_INTERACTION_REACH_RADIUS_TILES = 2;
const OBSTACLE_RETRY_BUFFER_MIN_MS = 2600;
const OBSTACLE_RETRY_BUFFER_MAX_MS = 5200;
const OBSTACLE_TRANSIT_DEADLINE_EXTENSION_MS = 2500;
const OBSTACLE_TRAVERSAL_HARD_TIMEOUT_MS = 15_000;
const SUCCESS_TILE_STABLE_MS = GAME_TICK_MS;
const MARK_OF_GRACE_PLAYER_RADIUS_PX = 800;
const MARK_OF_GRACE_ACCESSIBLE_TILE_RADIUS_PX = 80;
const MARK_OF_GRACE_MAX_SIDE_PX = 70;
const MARK_OF_GRACE_MIN_PIXELS = 35;
const MARK_OF_GRACE_ITEM_ID = 11849;
const MARK_OF_GRACE_INVENTORY_TIMEOUT_MS = 350;
const MARK_OF_GRACE_PICKUP_CONFIRM_MS = 6500;
const MARK_OF_GRACE_PICKUP_FIRST_CHECK_DELAY_MS = 900;
const MARK_OF_GRACE_PICKUP_CHECK_INTERVAL_MS = 850;
const MARK_OF_GRACE_BLOCKED_IGNORE_MS = 45_000;
const MARK_OF_GRACE_IGNORE_MATCH_RADIUS_PX = 80;
const CACHE_OBSTACLE_OUTLINE_EXCLUSION_MARGIN_PX = 18;
const STATUS_LOG_INTERVAL_MS = 2200;
const CLICK_INNER_RATIO = 0.55;
const CLICK_DEBUG_DIR = "test-image-debug";
const COURSE_Z = 3;
const FALADOR_ROOFTOP_ENTRY_OBJECT_ID = 40090;

const FALADOR_ROOFTOP_OBSTACLE_IDS = [
  FALADOR_ROOFTOP_ENTRY_OBJECT_ID,
  14899,
  14901,
  14903,
  14904,
  14905,
  14911,
  14919,
  14920,
  14921,
  14922,
  14924,
  14925,
] as const;

type CourseStep = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

const COURSE_CARDINAL_DIRECTIONS: readonly (CourseStep & { fromFlag: number; toFlag: number })[] = [
  { dx: 0, dy: 1, fromFlag: CollisionFlag.North, toFlag: CollisionFlag.South },
  { dx: 1, dy: 0, fromFlag: CollisionFlag.East, toFlag: CollisionFlag.West },
  { dx: 0, dy: -1, fromFlag: CollisionFlag.South, toFlag: CollisionFlag.North },
  { dx: -1, dy: 0, fromFlag: CollisionFlag.West, toFlag: CollisionFlag.East },
];

const COURSE_DIRECTIONS: readonly CourseStep[] = [
  ...COURSE_CARDINAL_DIRECTIONS.map(({ dx, dy }) => ({ dx, dy })),
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
];

type FaladorFallbackObstacle = {
  id: (typeof FALADOR_ROOFTOP_OBSTACLE_IDS)[number];
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
};

const FALADOR_ROOFTOP_FALLBACK_OBSTACLES: readonly FaladorFallbackObstacle[] = [
  {
    id: FALADOR_ROOFTOP_ENTRY_OBJECT_ID,
    key: "FALADOR_ROOFTOP_ENTRY_OBJECT",
    name: "Rooftop entry",
    x: 3036,
    y: 3342,
    z: 0,
    width: 1,
    height: 2,
  },
  { id: 14899, key: "ROOFTOPS_FALADOR_TIGHTROPE_1", name: "Tightrope", x: 3040, y: 3343, z: 3, width: 1, height: 1 },
  { id: 14901, key: "ROOFTOPS_FALADOR_HANDHOLDS_START", name: "Hand holds", x: 3050, y: 3350, z: 3, width: 1, height: 2 },
  { id: 14903, key: "ROOFTOPS_FALADOR_GAP_1", name: "Gap", x: 3048, y: 3359, z: 3, width: 1, height: 1 },
  { id: 14904, key: "ROOFTOPS_FALADOR_GAP_2", name: "Gap", x: 3044, y: 3361, z: 3, width: 1, height: 4 },
  { id: 14905, key: "ROOFTOPS_FALADOR_TIGHTROPE_2", name: "Tightrope", x: 3034, y: 3361, z: 3, width: 1, height: 2 },
  { id: 14911, key: "ROOFTOPS_FALADOR_TIGHTROPE_3", name: "Tightrope", x: 3026, y: 3353, z: 3, width: 1, height: 1 },
  { id: 14919, key: "ROOFTOPS_FALADOR_GAP_3", name: "Gap", x: 3016, y: 3352, z: 3, width: 3, height: 1 },
  { id: 14920, key: "ROOFTOPS_FALADOR_LEDGE_1", name: "Ledge", x: 3015, y: 3345, z: 3, width: 1, height: 2 },
  { id: 14921, key: "ROOFTOPS_FALADOR_LEDGE_2", name: "Ledge", x: 3011, y: 3343, z: 3, width: 3, height: 1 },
  { id: 14922, key: "ROOFTOPS_FALADOR_LEDGE_3A", name: "Ledge", x: 3012, y: 3334, z: 3, width: 2, height: 1 },
  { id: 14924, key: "ROOFTOPS_FALADOR_LEDGE_4", name: "Ledge", x: 3018, y: 3332, z: 3, width: 1, height: 3 },
  { id: 14925, key: "ROOFTOPS_FALADOR_EDGE", name: "Edge", x: 3025, y: 3332, z: 3, width: 1, height: 4 },
];

type FaladorObstacleTarget = {
  order: number;
  id: number;
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  clickTile: WorldTile;
  source: "map-cache" | "fallback";
};

type FaladorWalkableBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  z: number;
};

type FaladorWalkableComponent = {
  id: number;
  z: number;
  tiles: WorldTile[];
  tileKeys: ReadonlySet<string>;
  bounds: FaladorWalkableBounds;
};

type FaladorSuccessZone = {
  afterOrder: number;
  label: string;
  centerTile: WorldTile;
  tiles: WorldTile[];
  tileKeys: ReadonlySet<string>;
  componentIds: readonly number[];
  source: "map-cache" | "fallback";
};

type FaladorCourseMap = {
  tilesByKey: ReadonlyMap<string, OsrsCacheMapTile>;
};

type FaladorCourseConnectivity = FaladorCourseMap & {
  targets: readonly FaladorObstacleTarget[];
  componentsById: ReadonlyMap<number, FaladorWalkableComponent>;
  componentIdByTileKey: ReadonlyMap<string, number>;
};

type FaladorCourse = FaladorCourseConnectivity & {
  cacheDirectoryPath: string | null;
  targets: FaladorObstacleTarget[];
  mapCacheObstacleCount: number;
  missingMapCacheIds: number[];
  successZonesByOrder: ReadonlyMap<number, FaladorSuccessZone>;
};

type FaladorFunctionKey = "loop";

type PendingObstacleTraversal = {
  order: number;
  clickedAtMs: number;
  minConfirmAtMs: number;
  deadlineMs: number;
  clickedPlayerTile: WorldTile;
  estimatedDistanceTiles: number;
  estimatedWaitMs: number;
};

type MarkOfGraceOutlineSignature = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  pixelCount: number;
};

type PendingMarkOfGracePickup = {
  clickedAtMs: number;
  deadlineMs: number;
  nextInventoryCheckAtMs: number;
  beforeQuantity: number | null;
  lastQuantity: number | null;
  outline: MarkOfGraceOutlineSignature;
  clickedPlayerTile: WorldTile;
  inventorySummary: string;
};

type IgnoredMarkOfGraceOutline = {
  ignoredUntilMs: number;
  outline: MarkOfGraceOutlineSignature;
  reason: string;
};

type FaladorState = BotEngineLoopState<FaladorFunctionKey> & {
  nextClickAllowedAtMs: number;
  lastClickPoint: ScreenPoint | null;
  lastConfirmedObstacleIndex: number | null;
  completedObstacleOrdersThisLap: number[];
  pendingObstacle: PendingObstacleTraversal | null;
  pendingMarkOfGracePickup: PendingMarkOfGracePickup | null;
  ignoredMarkOfGraceOutlines: IgnoredMarkOfGraceOutline[];
  lapIndex: number;
  observedPlayerTile: WorldTile | null;
  playerTileStableSinceMs: number;
  lastStatusLogAtMs: number;
  missingTargetTicks: number;
  loggedStartupCalibration: boolean;
  loggedFaladorRegionTarget: boolean;
};

type FaladorTickCapture = {
  course: FaladorCourse;
  calibration: StartupPlayerTileCalibration | null;
  bitmap: ScreenBitmap | null;
  playerTile: WorldTile | null;
  outlines: AgilityOutlineDetection[];
};

type ProjectedObstacle = {
  target: FaladorObstacleTarget;
  projectionTile: WorldTile;
  screenPoint: ScreenPoint;
  localPoint: ScreenPoint;
};

type ObstacleOutlineMatch = ProjectedObstacle & {
  outline: AgilityOutlineDetection;
  outlineDistancePx: number;
  outlinePickPriority: number;
  reachability: FaladorTargetReachability;
  decisionReason: string;
};

type MarkOfGraceOutlineMatch = {
  outline: AgilityOutlineDetection;
  accessibleDistancePx: number;
  playerDistancePx: number;
  componentId: number | null;
  zoneLabel: string;
};

type MarkOfGraceZoneProjection = {
  componentId: number | null;
  label: string;
  points: ScreenPoint[];
};

type ClickOutlineOptions = {
  preferredLocalPoint?: ScreenPoint | null;
  preferredRadiusPx?: number;
};

type FaladorTargetReachability = {
  reachable: boolean;
  nearestTile: WorldTile | null;
  pathTiles: number | null;
  candidateTiles: number;
};

type FaladorCacheTargetDecision = {
  target: FaladorObstacleTarget;
  reachability: FaladorTargetReachability;
  reason: string;
};

type FaladorCacheTargetDecisionOptions = {
  minOrder?: number;
  maxOrder?: number;
};

type FaladorCourseProgress = {
  completedThroughOrder: number;
  currentTarget: FaladorObstacleTarget | null;
  zone: FaladorSuccessZone | null;
  reason: string;
};

let isFaladorRooftopLoopRunning = false;
let faladorRooftopStartedAtMs: number | null = null;
let faladorClickDebugIndex = 0;

function formatElapsedSinceStart(): string {
  if (faladorRooftopStartedAtMs === null) {
    return "+0ms";
  }

  const elapsedMs = Math.max(0, Date.now() - faladorRooftopStartedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = elapsedMs % 1000;
  return `+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function logWithDelta(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] ${message}`);
}

function warnWithDelta(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] ${message}`);
}

function errorWithDelta(message: string): void {
  logger.error(`[${formatElapsedSinceStart()}] ${message}`);
}

function createInitialState(): FaladorState {
  return {
    loopIndex: 0,
    currentFunction: "loop",
    nextClickAllowedAtMs: 0,
    lastClickPoint: null,
    lastConfirmedObstacleIndex: null,
    completedObstacleOrdersThisLap: [],
    pendingObstacle: null,
    pendingMarkOfGracePickup: null,
    ignoredMarkOfGraceOutlines: [],
    lapIndex: 1,
    observedPlayerTile: null,
    playerTileStableSinceMs: 0,
    lastStatusLogAtMs: 0,
    missingTargetTicks: 0,
    loggedStartupCalibration: false,
    loggedFaladorRegionTarget: false,
  };
}

function toWorldTileLabel(tile: Pick<WorldTile, "x" | "y" | "z"> | null): string {
  return tile ? `${tile.x},${tile.y},${tile.z}` : "unavailable";
}

function getMarkOfGraceInventoryQuantity(snapshot: RuneLiteLocalApiSnapshot): number {
  return snapshot.inventory
    .filter((item) => item.id === MARK_OF_GRACE_ITEM_ID)
    .reduce((total, item) => total + Math.max(0, item.quantity), 0);
}

async function readMarkOfGraceInventoryQuantity(): Promise<{ quantity: number | null; summary: string }> {
  try {
    const snapshot = await fetchRuneLiteLocalApiSnapshot(MARK_OF_GRACE_INVENTORY_TIMEOUT_MS);
    return {
      quantity: getMarkOfGraceInventoryQuantity(snapshot),
      summary: formatRuneLiteLocalApiSnapshot(snapshot),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      quantity: null,
      summary: `unavailable: ${message}`,
    };
  }
}

function getMarkOfGraceOutlineSignature(outline: AgilityOutlineDetection): MarkOfGraceOutlineSignature {
  return {
    centerX: outline.centerX,
    centerY: outline.centerY,
    width: outline.width,
    height: outline.height,
    pixelCount: outline.pixelCount,
  };
}

function formatMarkOfGraceOutlineSignature(outline: MarkOfGraceOutlineSignature): string {
  return `center=(${outline.centerX},${outline.centerY}) size=${outline.width}x${outline.height} pixels=${outline.pixelCount}`;
}

function getMarkOfGraceOutlineSignatureDistance(
  a: Pick<MarkOfGraceOutlineSignature, "centerX" | "centerY">,
  b: Pick<MarkOfGraceOutlineSignature, "centerX" | "centerY">,
): number {
  return Math.max(Math.abs(a.centerX - b.centerX), Math.abs(a.centerY - b.centerY));
}

function pruneIgnoredMarkOfGraceOutlines(state: FaladorState, nowMs: number): FaladorState {
  const ignoredMarkOfGraceOutlines = state.ignoredMarkOfGraceOutlines.filter((entry) => entry.ignoredUntilMs > nowMs);
  return ignoredMarkOfGraceOutlines.length === state.ignoredMarkOfGraceOutlines.length
    ? state
    : { ...state, ignoredMarkOfGraceOutlines };
}

function isIgnoredMarkOfGraceOutline(state: FaladorState, outline: AgilityOutlineDetection, nowMs: number): boolean {
  const signature = getMarkOfGraceOutlineSignature(outline);
  return state.ignoredMarkOfGraceOutlines.some((entry) => {
    if (entry.ignoredUntilMs <= nowMs) {
      return false;
    }

    return (
      getMarkOfGraceOutlineSignatureDistance(signature, entry.outline) <= MARK_OF_GRACE_IGNORE_MATCH_RADIUS_PX &&
      Math.abs(signature.width - entry.outline.width) <= MARK_OF_GRACE_IGNORE_MATCH_RADIUS_PX &&
      Math.abs(signature.height - entry.outline.height) <= MARK_OF_GRACE_IGNORE_MATCH_RADIUS_PX
    );
  });
}

function addIgnoredMarkOfGraceOutline(
  state: FaladorState,
  pending: PendingMarkOfGracePickup,
  nowMs: number,
  reason: string,
): FaladorState {
  const ignoredMarkOfGraceOutlines = [
    ...state.ignoredMarkOfGraceOutlines.filter((entry) => entry.ignoredUntilMs > nowMs),
    {
      ignoredUntilMs: nowMs + MARK_OF_GRACE_BLOCKED_IGNORE_MS,
      outline: pending.outline,
      reason,
    },
  ];

  return {
    ...state,
    ignoredMarkOfGraceOutlines,
  };
}

function getCourseObstacleTotal(course: Pick<FaladorCourse, "targets"> | null = null): number {
  return course?.targets.length ?? FALADOR_ROOFTOP_OBSTACLE_IDS.length;
}

function formatCourseObstacleIndex(order: number, course: Pick<FaladorCourse, "targets"> | null = null): string {
  return `${order + 1}/${getCourseObstacleTotal(course)}`;
}

function toTargetLabel(target: FaladorObstacleTarget, course: Pick<FaladorCourse, "targets"> | null = null): string {
  return `${formatCourseObstacleIndex(target.order, course)} ${target.key} id=${target.id} ${target.name}@${target.x},${target.y},${target.z} size=${target.width}x${target.height} source=${target.source}`;
}

function screenPointToLocal(calibration: StartupPlayerTileCalibration, point: ScreenPoint): ScreenPoint {
  return {
    x: point.x - calibration.captureBounds.x,
    y: point.y - calibration.captureBounds.y,
  };
}

function chebyshevDistance(a: Pick<WorldTile, "x" | "y" | "z">, b: Pick<WorldTile, "x" | "y" | "z">): number {
  if (a.z !== b.z) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function distanceToTargetRectangle(tile: WorldTile, target: FaladorObstacleTarget): number {
  if (tile.z !== target.z) {
    return Number.POSITIVE_INFINITY;
  }

  const maxX = target.x + target.width - 1;
  const maxY = target.y + target.height - 1;
  const dx = tile.x < target.x ? target.x - tile.x : tile.x > maxX ? tile.x - maxX : 0;
  const dy = tile.y < target.y ? target.y - tile.y : tile.y > maxY ? tile.y - maxY : 0;
  return Math.max(dx, dy);
}

function tileDistance(a: Pick<WorldTile, "x" | "y">, b: Pick<WorldTile, "x" | "y">): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function centerTileForRectangle(x: number, y: number, z: number, width: number, height: number): WorldTile {
  return deriveWorldTile(x + Math.floor((Math.max(1, width) - 1) / 2), y + Math.floor((Math.max(1, height) - 1) / 2), z);
}

function compareWorldTiles(a: Pick<WorldTile, "x" | "y" | "z">, b: Pick<WorldTile, "x" | "y" | "z">): number {
  return a.z - b.z || a.x - b.x || a.y - b.y;
}

function getCourseTileComponentId(
  course: Pick<FaladorCourseConnectivity, "componentIdByTileKey">,
  tile: Pick<WorldTile, "x" | "y" | "z">,
): number | null {
  return course.componentIdByTileKey.get(getCourseTileKey(tile)) ?? null;
}

function getUniqueComponentIdsForTiles(
  course: Pick<FaladorCourseConnectivity, "componentIdByTileKey">,
  tiles: readonly WorldTile[],
): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const tile of tiles) {
    const componentId = getCourseTileComponentId(course, tile);
    if (componentId === null || seen.has(componentId)) {
      continue;
    }

    seen.add(componentId);
    ids.push(componentId);
  }

  return ids.sort((a, b) => a - b);
}

function getTilesForComponentIds(
  course: Pick<FaladorCourseConnectivity, "componentsById">,
  componentIds: readonly number[],
): WorldTile[] {
  return componentIds
    .flatMap((componentId) => course.componentsById.get(componentId)?.tiles ?? [])
    .sort(compareWorldTiles);
}

function pickSuccessZoneCenterTile(
  tiles: readonly WorldTile[],
  candidateTiles: readonly WorldTile[],
  nextTarget: FaladorObstacleTarget,
): WorldTile {
  const candidateKeys = new Set(candidateTiles.map((tile) => tile.key));
  const walkableCandidate = tiles.find((tile) => candidateKeys.has(tile.key));
  return walkableCandidate ?? candidateTiles[0] ?? nextTarget.clickTile;
}

function getTargetAdjacentComponentIds(course: FaladorCourseConnectivity, target: FaladorObstacleTarget): number[] {
  if (target.z !== COURSE_Z) {
    return [];
  }

  return getUniqueComponentIdsForTiles(course, getTargetInteractionCandidateTiles(course, target));
}

function intersectComponentIds(a: readonly number[], b: readonly number[]): number[] {
  const bSet = new Set(b);
  return a.filter((componentId) => bSet.has(componentId)).sort((left, right) => left - right);
}

function subtractComponentIds(componentIds: readonly number[], excluded: readonly number[]): number[] {
  const excludedSet = new Set(excluded);
  return componentIds.filter((componentId) => !excludedSet.has(componentId)).sort((left, right) => left - right);
}

function pickTransitionComponentIds(
  course: FaladorCourseConnectivity,
  target: FaladorObstacleTarget,
  nextTarget: FaladorObstacleTarget,
  previousZoneComponentIds: readonly number[],
): number[] {
  const currentAdjacentComponentIds = getTargetAdjacentComponentIds(course, target);
  const nextAdjacentComponentIds = getTargetAdjacentComponentIds(course, nextTarget);
  const sharedAdjacentComponentIds =
    currentAdjacentComponentIds.length > 0
      ? intersectComponentIds(currentAdjacentComponentIds, nextAdjacentComponentIds)
      : nextAdjacentComponentIds;
  const forwardSharedComponentIds = subtractComponentIds(sharedAdjacentComponentIds, previousZoneComponentIds);
  if (forwardSharedComponentIds.length > 0) {
    return forwardSharedComponentIds;
  }

  if (sharedAdjacentComponentIds.length > 0) {
    return sharedAdjacentComponentIds;
  }

  const forwardNextComponentIds = subtractComponentIds(nextAdjacentComponentIds, previousZoneComponentIds);
  return forwardNextComponentIds.length > 0 ? forwardNextComponentIds : nextAdjacentComponentIds;
}

function buildFaladorSuccessZones(course: FaladorCourseConnectivity): ReadonlyMap<number, FaladorSuccessZone> {
  const zones = new Map<number, FaladorSuccessZone>();
  let previousZoneComponentIds: readonly number[] = [];
  for (const target of course.targets) {
    const nextTarget = course.targets[target.order + 1] ?? null;
    if (!nextTarget) {
      continue;
    }

    const nextCandidateTiles = getTargetInteractionCandidateTiles(course, nextTarget);
    const componentIds = pickTransitionComponentIds(course, target, nextTarget, previousZoneComponentIds);
    const tiles = getTilesForComponentIds(course, componentIds);
    const centerTile = pickSuccessZoneCenterTile(tiles, nextCandidateTiles, nextTarget);
    const zoneTiles = tiles.length > 0 ? tiles : [centerTile];
    zones.set(target.order, {
      afterOrder: target.order,
      label: `transition landing before ${nextTarget.key}`,
      centerTile,
      tiles: zoneTiles,
      tileKeys: new Set(zoneTiles.map((tile) => tile.key)),
      componentIds,
      source: tiles.length > 0 ? "map-cache" : "fallback",
    });
    previousZoneComponentIds = componentIds;
  }

  return zones;
}

function formatSuccessZone(zone: FaladorSuccessZone): string {
  const previewTiles = zone.tiles
    .slice(0, 8)
    .map(toWorldTileLabel)
    .join("|");
  const suffix = zone.tiles.length > 8 ? `|+${zone.tiles.length - 8}` : "";
  return `${zone.afterOrder + 1}:${zone.label} components=${zone.componentIds.join(",") || "none"} center=${toWorldTileLabel(zone.centerTile)} tiles=${zone.tiles.length} source=${zone.source}${previewTiles ? ` [${previewTiles}${suffix}]` : ""}`;
}

function formatSuccessZoneSummary(zone: FaladorSuccessZone, course: Pick<FaladorCourse, "targets"> | null = null): string {
  return `${formatCourseObstacleIndex(zone.afterOrder, course)}:${zone.label} components=${zone.componentIds.join(",") || "none"} center=${toWorldTileLabel(zone.centerTile)} tiles=${zone.tiles.length} source=${zone.source}`;
}

function isPlayerInSuccessZone(playerTile: WorldTile, zone: FaladorSuccessZone): boolean {
  return zone.tileKeys.has(playerTile.key);
}

function buildCourseTilesByKey(regionTiles: readonly OsrsCacheMapTile[]): ReadonlyMap<string, OsrsCacheMapTile> {
  const tilesByKey = new Map<string, OsrsCacheMapTile>();
  for (const tile of regionTiles) {
    tilesByKey.set(buildWorldTileKey({ x: tile.worldX, y: tile.worldY, z: tile.z }), tile);
  }
  return tilesByKey;
}

function getCourseTileKey(tile: Pick<WorldTile, "x" | "y" | "z">): string {
  return buildWorldTileKey(tile);
}

function getCourseTile(course: FaladorCourseMap, tile: Pick<WorldTile, "x" | "y" | "z">): OsrsCacheMapTile | null {
  return course.tilesByKey.get(getCourseTileKey(tile)) ?? null;
}

function getCourseTileFlags(course: FaladorCourseMap, x: number, y: number, z: number): number {
  return getCourseTile(course, { x, y, z })?.flags ?? CollisionFlag.Blocked;
}

function isCourseTileBlocked(course: FaladorCourseMap, x: number, y: number, z: number): boolean {
  return (getCourseTileFlags(course, x, y, z) & CollisionFlag.Blocked) !== 0;
}

function canMoveWithinCourse(
  course: FaladorCourseMap,
  x: number,
  y: number,
  z: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): boolean {
  const axisDistance = Math.abs(dx) + Math.abs(dy);
  if (axisDistance < 1 || axisDistance > 2) {
    return false;
  }

  const nextX = x + dx;
  const nextY = y + dy;
  if (!getCourseTile(course, { x, y, z }) || !getCourseTile(course, { x: nextX, y: nextY, z })) {
    return false;
  }

  if (axisDistance === 2) {
    return (
      !isCourseTileBlocked(course, nextX, nextY, z) &&
      canMoveWithinCourse(course, x, y, z, dx, 0) &&
      canMoveWithinCourse(course, x, y, z, 0, dy) &&
      canMoveWithinCourse(course, x + dx, y, z, 0, dy) &&
      canMoveWithinCourse(course, x, y + dy, z, dx, 0)
    );
  }

  const direction = COURSE_CARDINAL_DIRECTIONS.find((candidate) => candidate.dx === dx && candidate.dy === dy);
  if (!direction) {
    return false;
  }

  const fromFlags = getCourseTileFlags(course, x, y, z);
  const toFlags = getCourseTileFlags(course, nextX, nextY, z);
  return (fromFlags & direction.fromFlag) === 0 && (toFlags & (CollisionFlag.Blocked | direction.toFlag)) === 0;
}

function buildCourseWalkableComponents(tilesByKey: ReadonlyMap<string, OsrsCacheMapTile>): {
  componentsById: ReadonlyMap<number, FaladorWalkableComponent>;
  componentIdByTileKey: ReadonlyMap<string, number>;
} {
  const courseMap: FaladorCourseMap = { tilesByKey };
  const componentIdByTileKey = new Map<string, number>();
  const componentsById = new Map<number, FaladorWalkableComponent>();
  const visited = new Set<string>();
  let nextComponentId = 1;
  const walkableTiles = [...tilesByKey.values()]
    .filter((tile) => !tile.blocked)
    .sort((a, b) => a.z - b.z || a.worldX - b.worldX || a.worldY - b.worldY);

  for (const cacheTile of walkableTiles) {
    const startTile = deriveWorldTile(cacheTile.worldX, cacheTile.worldY, cacheTile.z);
    if (visited.has(startTile.key)) {
      continue;
    }

    const componentId = nextComponentId;
    nextComponentId += 1;
    const queue = [startTile.key];
    const tiles: WorldTile[] = [];
    let bounds: FaladorWalkableBounds = {
      minX: startTile.x,
      maxX: startTile.x,
      minY: startTile.y,
      maxY: startTile.y,
      z: startTile.z,
    };
    visited.add(startTile.key);

    for (let readIndex = 0; readIndex < queue.length; readIndex += 1) {
      const currentCacheTile = tilesByKey.get(queue[readIndex]);
      if (!currentCacheTile || currentCacheTile.blocked) {
        continue;
      }

      const currentTile = deriveWorldTile(currentCacheTile.worldX, currentCacheTile.worldY, currentCacheTile.z);
      tiles.push(currentTile);
      bounds = {
        minX: Math.min(bounds.minX, currentTile.x),
        maxX: Math.max(bounds.maxX, currentTile.x),
        minY: Math.min(bounds.minY, currentTile.y),
        maxY: Math.max(bounds.maxY, currentTile.y),
        z: currentTile.z,
      };

      for (const direction of COURSE_DIRECTIONS) {
        if (!canMoveWithinCourse(courseMap, currentTile.x, currentTile.y, currentTile.z, direction.dx, direction.dy)) {
          continue;
        }

        const nextKey = buildWorldTileKey({
          x: currentTile.x + direction.dx,
          y: currentTile.y + direction.dy,
          z: currentTile.z,
        });
        if (visited.has(nextKey)) {
          continue;
        }

        visited.add(nextKey);
        queue.push(nextKey);
      }
    }

    const sortedTiles = tiles.sort(compareWorldTiles);
    const tileKeys = new Set(sortedTiles.map((tile) => tile.key));
    for (const tileKey of tileKeys) {
      componentIdByTileKey.set(tileKey, componentId);
    }

    componentsById.set(componentId, {
      id: componentId,
      z: startTile.z,
      tiles: sortedTiles,
      tileKeys,
      bounds,
    });
  }

  return { componentsById, componentIdByTileKey };
}

function getTargetInteractionCandidateTiles(course: FaladorCourseMap, target: FaladorObstacleTarget): WorldTile[] {
  const minX = target.x - OBSTACLE_INTERACTION_REACH_RADIUS_TILES;
  const maxX = target.x + target.width - 1 + OBSTACLE_INTERACTION_REACH_RADIUS_TILES;
  const minY = target.y - OBSTACLE_INTERACTION_REACH_RADIUS_TILES;
  const maxY = target.y + target.height - 1 + OBSTACLE_INTERACTION_REACH_RADIUS_TILES;
  const candidates: WorldTile[] = [];

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const tile = deriveWorldTile(x, y, target.z);
      const cacheTile = getCourseTile(course, tile);
      if (!cacheTile || cacheTile.blocked || distanceToTargetRectangle(tile, target) > OBSTACLE_INTERACTION_REACH_RADIUS_TILES) {
        continue;
      }
      candidates.push(tile);
    }
  }

  return candidates.sort((a, b) => {
    const rectangleDistanceDelta = distanceToTargetRectangle(a, target) - distanceToTargetRectangle(b, target);
    if (rectangleDistanceDelta !== 0) {
      return rectangleDistanceDelta;
    }

    const clickTileDistanceDelta = tileDistance(a, target.clickTile) - tileDistance(b, target.clickTile);
    if (clickTileDistanceDelta !== 0) {
      return clickTileDistanceDelta;
    }

    return a.x - b.x || a.y - b.y || a.z - b.z;
  });
}

function findNearestReachableCourseTile(
  course: FaladorCourseMap,
  start: WorldTile,
  candidates: readonly WorldTile[],
): { tile: WorldTile; pathTiles: number } | null {
  const candidatesOnPlane = candidates.filter((tile) => tile.z === start.z);
  if (candidatesOnPlane.length === 0 || !getCourseTile(course, start)) {
    return null;
  }

  const candidateByKey = new Map(candidatesOnPlane.map((tile) => [tile.key, tile]));
  const startKey = start.key;
  const queue = [startKey];
  const distances = new Map<string, number>([[startKey, 0]]);

  for (let readIndex = 0; readIndex < queue.length; readIndex += 1) {
    const currentKey = queue[readIndex];
    const candidate = candidateByKey.get(currentKey);
    if (candidate) {
      return { tile: candidate, pathTiles: distances.get(currentKey) ?? 0 };
    }

    const [x, y, z] = currentKey.split(",").map(Number);
    for (const direction of COURSE_DIRECTIONS) {
      if (!canMoveWithinCourse(course, x, y, z, direction.dx, direction.dy)) {
        continue;
      }

      const nextKey = buildWorldTileKey({ x: x + direction.dx, y: y + direction.dy, z });
      if (distances.has(nextKey) || distances.size >= 4096) {
        continue;
      }

      distances.set(nextKey, (distances.get(currentKey) ?? 0) + 1);
      queue.push(nextKey);
    }
  }

  return null;
}

function getTargetReachability(
  course: FaladorCourseMap,
  playerTile: WorldTile,
  target: FaladorObstacleTarget,
): FaladorTargetReachability {
  const candidates = getTargetInteractionCandidateTiles(course, target);
  if (playerTile.z !== target.z || candidates.length === 0 || course.tilesByKey.size === 0) {
    return {
      reachable: false,
      nearestTile: null,
      pathTiles: null,
      candidateTiles: candidates.length,
    };
  }

  const nearest = findNearestReachableCourseTile(course, playerTile, candidates);
  return {
    reachable: nearest !== null,
    nearestTile: nearest?.tile ?? null,
    pathTiles: nearest?.pathTiles ?? null,
    candidateTiles: candidates.length,
  };
}

function formatTargetReachability(reachability: FaladorTargetReachability): string {
  return `reachable=${reachability.reachable} nearest=${toWorldTileLabel(reachability.nearestTile)} path=${reachability.pathTiles ?? "none"} candidates=${reachability.candidateTiles}`;
}

function isTargetOrderAllowed(order: number, options: FaladorCacheTargetDecisionOptions): boolean {
  return order >= (options.minOrder ?? 0) && order <= (options.maxOrder ?? Number.POSITIVE_INFINITY);
}

function getCourseProgressAtPlayer(course: FaladorCourse, playerTile: WorldTile): FaladorCourseProgress | null {
  const entryTarget = course.targets[0] ?? null;
  if (playerTile.z === FALADOR_ENTRY_TILE.z && entryTarget) {
    return {
      completedThroughOrder: -1,
      currentTarget: entryTarget,
      zone: null,
      reason: "ground-entry-zone",
    };
  }

  if (playerTile.z !== COURSE_Z) {
    return null;
  }

  const zone = getSuccessZoneContainingPlayer(course, playerTile);
  if (!zone) {
    return null;
  }

  const nextOrder = zone.afterOrder + 1;
  return {
    completedThroughOrder: zone.afterOrder,
    currentTarget: course.targets[nextOrder] ?? null,
    zone,
    reason: `course-zone-after-${formatCourseObstacleIndex(zone.afterOrder, course)}:${zone.label}`,
  };
}

function pickCacheTargetDecision(
  course: FaladorCourse,
  playerTile: WorldTile,
  options: FaladorCacheTargetDecisionOptions = {},
): FaladorCacheTargetDecision | null {
  const progress = getCourseProgressAtPlayer(course, playerTile);
  const target = progress?.currentTarget ?? null;
  if (!progress || !target || !isTargetOrderAllowed(target.order, options)) {
    return null;
  }

  const reachability = getTargetReachability(course, playerTile, target);
  return reachability.reachable
    ? {
        target,
        reachability,
        reason: progress.reason,
      }
    : null;
}

function formatCacheTargetDecision(
  decision: FaladorCacheTargetDecision | null,
  course: Pick<FaladorCourse, "targets"> | null = null,
): string {
  return decision
    ? `${toTargetLabel(decision.target, course)} reason=${decision.reason} ${formatTargetReachability(decision.reachability)}`
    : "none";
}

function formatAllowedTargetReachability(tick: FaladorTickCapture): string {
  const playerTile = tick.playerTile;
  if (!playerTile) {
    return "unavailable";
  }

  return formatCacheTargetDecision(
    pickCacheTargetDecision(tick.course, playerTile),
    tick.course,
  );
}

function isPlayerInFaladorRooftopRegion(playerTile: WorldTile): boolean {
  return playerTile.regionX === FALADOR_REGION_X && playerTile.regionY === FALADOR_REGION_Y;
}

function getSuccessZoneContainingPlayer(course: FaladorCourse, playerTile: WorldTile): FaladorSuccessZone | null {
  return (
    [...course.successZonesByOrder.values()]
      .sort((a, b) => b.afterOrder - a.afterOrder)
      .find((zone) => isPlayerInSuccessZone(playerTile, zone)) ?? null
  );
}

function syncFaladorProgressFromCourseZone(state: FaladorState, tick: FaladorTickCapture): FaladorState {
  const playerTile = tick.playerTile;
  if (!playerTile || state.pendingObstacle) {
    return state;
  }

  const progress = getCourseProgressAtPlayer(tick.course, playerTile);
  if (!progress) {
    return state;
  }

  const lastConfirmedOrder = state.lastConfirmedObstacleIndex ?? -1;
  if (progress.completedThroughOrder === -1) {
    if (state.lastConfirmedObstacleIndex === null && state.completedObstacleOrdersThisLap.length === 0) {
      return state;
    }

    logWithDelta(
      `${BOT_LOG_PREFIX}: synced ${FALADOR_COURSE_LABEL} progress from ground entry zone; player=${toWorldTileLabel(
        playerTile,
      )} currentTarget=${progress.currentTarget ? toTargetLabel(progress.currentTarget, tick.course) : "none"}.`,
    );
    return {
      ...state,
      lastConfirmedObstacleIndex: null,
      completedObstacleOrdersThisLap: [],
      missingTargetTicks: 0,
    };
  }

  const completedOrders = addCompletedObstacleOrderRange(
    state.completedObstacleOrdersThisLap,
    Math.max(0, lastConfirmedOrder + 1),
    progress.completedThroughOrder,
  );
  const alreadySynced =
    progress.completedThroughOrder <= lastConfirmedOrder &&
    completedOrders.length === state.completedObstacleOrdersThisLap.length;
  if (alreadySynced) {
    return state;
  }

  const nextTarget = progress.currentTarget;
  const nextReachability = nextTarget ? getTargetReachability(tick.course, playerTile, nextTarget) : null;
  logWithDelta(
    `${BOT_LOG_PREFIX}: synced ${FALADOR_COURSE_LABEL} progress from map-cache course zone; player=${toWorldTileLabel(
      playerTile,
    )} completedThrough=${formatCourseObstacleIndex(
      progress.completedThroughOrder,
      tick.course,
    )} zone=${progress.zone ? formatSuccessZoneSummary(progress.zone, tick.course) : "ground-entry"} nextTarget=${
      nextTarget && nextReachability
        ? `${toTargetLabel(nextTarget, tick.course)} ${formatTargetReachability(nextReachability)}`
        : "lap-complete"
    }.`,
  );

  return {
    ...state,
    lastConfirmedObstacleIndex: progress.completedThroughOrder,
    completedObstacleOrdersThisLap: completedOrders,
    missingTargetTicks: 0,
  };
}

function withFaladorRegionTargetLog(state: FaladorState, tick: FaladorTickCapture): FaladorState {
  const playerTile = tick.playerTile;
  if (state.loggedFaladorRegionTarget || !playerTile || !isPlayerInFaladorRooftopRegion(playerTile)) {
    return state;
  }

  const cacheDecision = pickCacheTargetDecision(tick.course, playerTile);
  const progress = getCourseProgressAtPlayer(tick.course, playerTile);
  const zoneDetails = progress?.zone ? ` currentZone=${formatSuccessZoneSummary(progress.zone, tick.course)}` : "";
  logWithDelta(
    `${BOT_LOG_PREFIX}: player is in Falador region ${FALADOR_REGION_X},${FALADOR_REGION_Y}; targeting ${FALADOR_COURSE_LABEL} course. player=${toWorldTileLabel(
      playerTile,
    )} mapCacheObstacles=${tick.course.mapCacheObstacleCount}/${tick.course.targets.length} currentTarget=${formatCacheTargetDecision(
      cacheDecision,
      tick.course,
    )}${zoneDetails}.`,
  );

  return { ...state, loggedFaladorRegionTarget: true };
}

function isFaladorRooftopEntryObjectCandidate(object: OsrsCacheMapObject): boolean {
  return (
    object.id === FALADOR_ROOFTOP_ENTRY_OBJECT_ID &&
    object.z === FALADOR_ENTRY_OBJECT_SEARCH_TILE.z &&
    object.type === 10 &&
    object.interactType === 2 &&
    object.orientation === 3 &&
    object.sizeX === 1 &&
    object.sizeY === 2 &&
    object.definitionSizeX === 2 &&
    object.definitionSizeY === 1 &&
    object.wallOrDoor === 1 &&
    object.clipped
  );
}

function pickNearestFaladorRooftopEntryObject(objects: readonly OsrsCacheMapObject[]): OsrsCacheMapObject | null {
  const candidates = objects.filter(isFaladorRooftopEntryObjectCandidate);
  return (
    candidates.sort((a, b) => {
      const aTile = { x: a.worldX, y: a.worldY };
      const bTile = { x: b.worldX, y: b.worldY };
      const aDistance = tileDistance(aTile, FALADOR_ENTRY_OBJECT_SEARCH_TILE);
      const bDistance = tileDistance(bTile, FALADOR_ENTRY_OBJECT_SEARCH_TILE);
      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }

      return tileDistance(aTile, FALADOR_ENTRY_TILE) - tileDistance(bTile, FALADOR_ENTRY_TILE);
    })[0] ?? null
  );
}

function targetFromMapObject(object: OsrsCacheMapObject, order: number): FaladorObstacleTarget {
  const isEntryObject = object.id === FALADOR_ROOFTOP_ENTRY_OBJECT_ID;
  return {
    order,
    id: object.id,
    key: isEntryObject ? "FALADOR_ROOFTOP_ENTRY_OBJECT" : object.agilityObstacleKey ?? `object-${object.id}`,
    name: isEntryObject ? "Rooftop entry" : object.name,
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: Math.max(1, object.sizeX),
    height: Math.max(1, object.sizeY),
    clickTile: centerTileForRectangle(object.worldX, object.worldY, object.z, object.sizeX, object.sizeY),
    source: "map-cache",
  };
}

function targetFromFallback(fallback: FaladorFallbackObstacle, order: number): FaladorObstacleTarget {
  return {
    order,
    id: fallback.id,
    key: fallback.key,
    name: fallback.name,
    x: fallback.x,
    y: fallback.y,
    z: fallback.z,
    width: fallback.width,
    height: fallback.height,
    clickTile: centerTileForRectangle(fallback.x, fallback.y, fallback.z, fallback.width, fallback.height),
    source: "fallback",
  };
}

function loadFaladorCourseFromMapCache(): FaladorCourse {
  const fallbackById = new Map(FALADOR_ROOFTOP_FALLBACK_OBSTACLES.map((target) => [target.id, target]));
  let cacheDirectoryPath: string | null = null;
  let regionTiles: readonly OsrsCacheMapTile[] = [];
  const objectById = new Map<number, OsrsCacheMapObject>();
  const missingMapCacheIds: number[] = [];

  try {
    const view = readOsrsCacheMapRegionView({ regionX: FALADOR_REGION_X, regionY: FALADOR_REGION_Y });
    cacheDirectoryPath = view.cacheDirectoryPath;
    regionTiles = view.tiles;
    const entryObject = pickNearestFaladorRooftopEntryObject(view.objects);
    if (entryObject) {
      objectById.set(FALADOR_ROOFTOP_ENTRY_OBJECT_ID, entryObject);
      logWithDelta(
        `${BOT_LOG_PREFIX}: map-cache entry object resolved id=${entryObject.id} type=${entryObject.type} orient=${entryObject.orientation} world=${entryObject.worldX},${entryObject.worldY},${entryObject.z} size=${entryObject.sizeX}x${entryObject.sizeY} def=${entryObject.definitionSizeX}x${entryObject.definitionSizeY} interact=${entryObject.interactType} wall=${entryObject.wallOrDoor} clipped=${entryObject.clipped}.`,
      );
    }

    for (const object of view.objects) {
      if (
        object.id !== FALADOR_ROOFTOP_ENTRY_OBJECT_ID &&
        FALADOR_ROOFTOP_OBSTACLE_IDS.includes(object.id as (typeof FALADOR_ROOFTOP_OBSTACLE_IDS)[number])
      ) {
        objectById.set(object.id, object);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`${BOT_LOG_PREFIX}: map cache read failed for region ${FALADOR_REGION_X},${FALADOR_REGION_Y}: ${message}.`);
  }

  const targets = FALADOR_ROOFTOP_OBSTACLE_IDS.map((id, order) => {
    const object = objectById.get(id);
    if (object) {
      return targetFromMapObject(object, order);
    }

    missingMapCacheIds.push(id);
    const fallback = fallbackById.get(id);
    if (!fallback) {
      throw new Error(`Rooftop course object ${id} missing from map cache and fallback table.`);
    }

    return targetFromFallback(fallback, order);
  });
  const tilesByKey = buildCourseTilesByKey(regionTiles);
  const { componentsById, componentIdByTileKey } = buildCourseWalkableComponents(tilesByKey);
  const courseWithoutSuccessZones: FaladorCourseConnectivity = {
    targets,
    tilesByKey,
    componentsById,
    componentIdByTileKey,
  };

  return {
    cacheDirectoryPath,
    targets,
    mapCacheObstacleCount: targets.filter((target) => target.source === "map-cache").length,
    missingMapCacheIds,
    successZonesByOrder: buildFaladorSuccessZones(courseWithoutSuccessZones),
    tilesByKey,
    componentsById,
    componentIdByTileKey,
  };
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

function projectObstacleTarget(
  calibration: StartupPlayerTileCalibration,
  playerTile: WorldTile,
  target: FaladorObstacleTarget,
  projectionTile: WorldTile = target.clickTile,
): ProjectedObstacle | null {
  const screenPoint = projectWorldTileToScreen(calibration, playerTile, projectionTile);
  if (!screenPoint) {
    return null;
  }

  const localPoint = screenPointToLocal(calibration, screenPoint);
  const searchMargin = getOutlineMatchRadiusForTarget(target);
  if (
    localPoint.x < -searchMargin ||
    localPoint.y < -searchMargin ||
    localPoint.x > calibration.captureBounds.width - 1 + searchMargin ||
    localPoint.y > calibration.captureBounds.height - 1 + searchMargin
  ) {
    return null;
  }

  return { target, projectionTile, screenPoint, localPoint };
}

function isOutlineInsideRuneLiteUi(outline: AgilityOutlineDetection, bitmap: ScreenBitmap): boolean {
  const topUiMaxY = Math.max(95, Math.round(bitmap.height * 0.065));
  const rightPluginRailMinX = Math.round(bitmap.width - 70);
  const topRightUiMinX = Math.round(bitmap.width - 360);
  const topRightUiMaxY = Math.round(bitmap.height * 0.28);
  const bottomRightUiMinX = Math.round(bitmap.width - 390);
  const bottomRightUiMinY = Math.round(bitmap.height * 0.70);
  const bottomLeftChatMaxX = Math.round(bitmap.width * 0.54);
  const bottomLeftChatMinY = Math.round(bitmap.height * 0.84);

  return (
    outline.centerY <= topUiMaxY ||
    outline.centerX >= rightPluginRailMinX ||
    (outline.centerX >= topRightUiMinX && outline.centerY <= topRightUiMaxY) ||
    (outline.centerX >= bottomRightUiMinX && outline.centerY >= bottomRightUiMinY) ||
    (outline.centerX <= bottomLeftChatMaxX && outline.centerY >= bottomLeftChatMinY)
  );
}

function isClickableOutline(outline: AgilityOutlineDetection, bitmap: ScreenBitmap): boolean {
  const maxWidth = Math.max(120, Math.round(bitmap.width * 0.5));
  const maxHeight = Math.max(120, Math.round(bitmap.height * 0.35));
  return outline.width <= maxWidth && outline.height <= maxHeight && !isOutlineInsideRuneLiteUi(outline, bitmap);
}

function isLikelyObjectOutline(outline: AgilityOutlineDetection): boolean {
  const longestSide = Math.max(outline.width, outline.height);
  const shortestSide = Math.max(1, Math.min(outline.width, outline.height));
  return outline.width >= 10 && outline.height >= 10 && outline.pixelCount >= 50 && longestSide / shortestSide <= 4.5;
}

function getPlayerLocalAnchor(calibration: StartupPlayerTileCalibration): ScreenPoint {
  return calibration.playerBox
    ? { x: calibration.playerBox.centerX, y: calibration.playerBox.centerY }
    : { x: Math.round(calibration.captureBounds.width * 0.5), y: Math.round(calibration.captureBounds.height * 0.52) };
}

function getOutlineDistance(outline: AgilityOutlineDetection, point: ScreenPoint): number {
  return Math.max(Math.abs(outline.centerX - point.x), Math.abs(outline.centerY - point.y));
}

function getOutlineMatchRadiusForTarget(target: FaladorObstacleTarget): number {
  return target.order === 0 && target.z === FALADOR_ENTRY_TILE.z ? ENTRY_OUTLINE_MATCH_RADIUS_PX : OUTLINE_MATCH_RADIUS_PX;
}

function isWideHorizontalCourseTarget(target: FaladorObstacleTarget): boolean {
  return target.z === COURSE_Z && target.width >= 3 && target.height === 1;
}

function pickWideHorizontalCourseOutline(
  tick: FaladorTickCapture,
  projected: ProjectedObstacle,
): { outline: AgilityOutlineDetection; distance: number; reason: string } | null {
  if (!tick.bitmap || !isWideHorizontalCourseTarget(projected.target)) {
    return null;
  }

  const candidates = tick.outlines
    .filter((outline) => {
      return (
        (outline.color === "green" || outline.color === "red") &&
        isClickableOutline(outline, tick.bitmap!) &&
        outline.width >= WIDE_HORIZONTAL_OUTLINE_MIN_WIDTH_PX &&
        outline.height <= WIDE_HORIZONTAL_OUTLINE_MAX_HEIGHT_PX &&
        outline.pixelCount >= WIDE_HORIZONTAL_OUTLINE_MIN_PIXELS &&
        Math.abs(outline.centerY - projected.localPoint.y) <= WIDE_HORIZONTAL_OUTLINE_Y_TOLERANCE_PX
      );
    })
    .sort((a, b) => {
      const yDelta = Math.abs(a.centerY - projected.localPoint.y) - Math.abs(b.centerY - projected.localPoint.y);
      if (yDelta !== 0) {
        return yDelta;
      }

      const widthDelta = b.width - a.width;
      if (widthDelta !== 0) {
        return widthDelta;
      }

      return getOutlineDistance(a, projected.localPoint) - getOutlineDistance(b, projected.localPoint);
    });

  const outline = candidates[0] ?? null;
  return outline
    ? {
        outline,
        distance: getOutlineBoxDistance(outline, projected.localPoint),
        reason: `wide-horizontal yDelta=${Math.abs(outline.centerY - projected.localPoint.y)}px`,
      }
    : null;
}

function pickObstacleOutlineNearProjection(
  tick: FaladorTickCapture,
  projected: ProjectedObstacle,
): { outline: AgilityOutlineDetection; distance: number; reason: string } | null {
  if (!tick.bitmap) {
    return null;
  }

  const targetSpecificOutline = pickWideHorizontalCourseOutline(tick, projected);
  if (targetSpecificOutline) {
    return targetSpecificOutline;
  }

  const candidates = tick.outlines.filter((outline) => {
    return (
      isClickableOutline(outline, tick.bitmap!) &&
      getOutlineBoxDistance(outline, projected.localPoint) <= getOutlineMatchRadiusForTarget(projected.target)
    );
  });
  const outline =
    candidates
      .sort((a, b) => {
        const boxDistanceDelta = getOutlineBoxDistance(a, projected.localPoint) - getOutlineBoxDistance(b, projected.localPoint);
        if (boxDistanceDelta !== 0) {
          return boxDistanceDelta;
        }

        const centerDistanceDelta = getOutlineDistance(a, projected.localPoint) - getOutlineDistance(b, projected.localPoint);
        if (centerDistanceDelta !== 0) {
          return centerDistanceDelta;
        }

        return b.pixelCount - a.pixelCount;
      })[0] ?? null;
  return outline
    ? {
        outline,
        distance: getOutlineBoxDistance(outline, projected.localPoint),
        reason: "nearest-projection-box",
      }
    : null;
}

function getObstacleProjectionTiles(
  target: FaladorObstacleTarget,
  reachability: FaladorTargetReachability,
): WorldTile[] {
  const targetTiles = getTargetFootprintProjectionTiles(target);
  const targetTileKeys = new Set(targetTiles.map((tile) => tile.key));
  const tiles = [
    ...targetTiles,
    reachability.nearestTile && !targetTileKeys.has(reachability.nearestTile.key) ? reachability.nearestTile : null,
  ].filter((tile): tile is WorldTile => !!tile && tile.z === target.z);
  const uniqueTiles = new Map<string, WorldTile>();
  for (const tile of tiles) {
    uniqueTiles.set(tile.key, tile);
  }

  return [...uniqueTiles.values()];
}

function getTargetFootprintProjectionTiles(target: FaladorObstacleTarget): WorldTile[] {
  const tiles = [target.clickTile, ...getObstacleFootprintTiles(target)].filter((tile) => tile.z === target.z);
  const uniqueTiles = new Map<string, WorldTile>();
  for (const tile of tiles) {
    uniqueTiles.set(tile.key, tile);
  }

  return [...uniqueTiles.values()];
}

function getReachableFallbackProjectionTiles(
  target: FaladorObstacleTarget,
  reachability: FaladorTargetReachability,
  excludedTiles: readonly WorldTile[],
): WorldTile[] {
  const excludedKeys = new Set(excludedTiles.map((tile) => tile.key));
  return reachability.nearestTile && reachability.nearestTile.z === target.z && !excludedKeys.has(reachability.nearestTile.key)
    ? [reachability.nearestTile]
    : [];
}

function formatObstacleSearchProjectionDebug(tick: FaladorTickCapture): string {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  if (!calibration || !playerTile) {
    return "projectionDebug=unavailable";
  }

  const cacheDecision = pickCacheTargetDecision(tick.course, playerTile);
  if (!cacheDecision) {
    return "projectionDebug=cacheTarget=none";
  }

  const target = cacheDecision.target;
  const clickableOutlines = tick.bitmap ? tick.outlines.filter((outline) => isClickableOutline(outline, tick.bitmap!)) : tick.outlines;
  const projections = getObstacleProjectionTiles(target, cacheDecision.reachability)
    .map((projectionTile) => {
      const projected = projectObstacleTarget(calibration, playerTile, target, projectionTile);
      if (!projected) {
        return `${toWorldTileLabel(projectionTile)}:offscreen`;
      }

      const nearestOutlines = clickableOutlines
        .map((outline) => ({
          outline,
          centerDistance: getOutlineDistance(outline, projected.localPoint),
          boxDistance: getOutlineBoxDistance(outline, projected.localPoint),
        }))
        .sort((a, b) => {
          const boxDistanceDelta = a.boxDistance - b.boxDistance;
          if (boxDistanceDelta !== 0) {
            return boxDistanceDelta;
          }

          return a.centerDistance - b.centerDistance;
        })
        .slice(0, 3)
        .map(
          ({ outline, centerDistance, boxDistance }) =>
            `${formatAgilityOutline(outline)} centerDist=${centerDistance}px boxDist=${boxDistance}px`,
        )
        .join(" | ");

      return `${toWorldTileLabel(projectionTile)}=>${projected.localPoint.x},${projected.localPoint.y} nearest=[${nearestOutlines || "none"}]`;
    })
    .join("; ");

  return `projectionDebug=target=${toTargetLabel(target, tick.course)} tiles=${projections || "none"}`;
}

function sortObstacleOutlineMatches(matches: ObstacleOutlineMatch[], target: FaladorObstacleTarget): ObstacleOutlineMatch[] {
  return matches.sort((a, b) => {
    const priorityDelta = a.outlinePickPriority - b.outlinePickPriority;
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const distanceDelta = a.outlineDistancePx - b.outlineDistancePx;
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    return tileDistance(a.projectionTile, target.clickTile) - tileDistance(b.projectionTile, target.clickTile);
  });
}

function getObstacleOutlinePickPriority(matchedOutlineReason: string, projectionGroupPriority: number): number {
  return projectionGroupPriority + (matchedOutlineReason.startsWith("wide-horizontal") ? 0 : 1);
}

function collectObstacleOutlineMatches(
  tick: FaladorTickCapture,
  target: FaladorObstacleTarget,
  reachability: FaladorTargetReachability,
  projectionTiles: readonly WorldTile[],
  projectionGroup: string,
  projectionGroupPriority: number,
): ObstacleOutlineMatch[] {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  if (!calibration || !playerTile) {
    return [];
  }

  const matches: ObstacleOutlineMatch[] = [];
  const projectedCandidates = projectionTiles
    .map((projectionTile) => projectObstacleTarget(calibration, playerTile, target, projectionTile))
    .filter((projected): projected is ProjectedObstacle => projected !== null);

  for (const projected of projectedCandidates) {
    const matchedOutline = pickObstacleOutlineNearProjection(tick, projected);
    if (!matchedOutline) {
      continue;
    }

    matches.push({
      ...projected,
      outline: matchedOutline.outline,
      outlineDistancePx: matchedOutline.distance,
      outlinePickPriority: getObstacleOutlinePickPriority(matchedOutline.reason, projectionGroupPriority),
      reachability,
      decisionReason: `${projectionGroup} ${matchedOutline.reason} projectionTile=${toWorldTileLabel(projected.projectionTile)}`,
    });
  }

  return sortObstacleOutlineMatches(matches, target);
}

function findObstacleOutlineMatches(tick: FaladorTickCapture): ObstacleOutlineMatch[] {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  const bitmap = tick.bitmap;
  if (!calibration || !playerTile || !bitmap) {
    return [];
  }

  const cacheDecision = pickCacheTargetDecision(tick.course, playerTile);
  if (!cacheDecision) {
    return [];
  }

  const matches: ObstacleOutlineMatch[] = [];
  const target = cacheDecision.target;
  const targetProjectionTiles = getTargetFootprintProjectionTiles(target);
  const targetMatches = collectObstacleOutlineMatches(
    tick,
    target,
    cacheDecision.reachability,
    targetProjectionTiles,
    `${cacheDecision.reason} outlinePick=target-footprint`,
    0,
  );
  if (targetMatches.length > 0) {
    return targetMatches;
  }

  const fallbackProjectionTiles = getReachableFallbackProjectionTiles(target, cacheDecision.reachability, targetProjectionTiles);
  matches.push(
    ...collectObstacleOutlineMatches(
      tick,
      target,
      cacheDecision.reachability,
      fallbackProjectionTiles,
      `${cacheDecision.reason} outlinePick=reachable-fallback`,
      10,
    ),
  );

  return matches;
}

function pickBestObstacleMatch(tick: FaladorTickCapture): ObstacleOutlineMatch | null {
  const playerTile = tick.playerTile;
  if (!playerTile) {
    return null;
  }

  const matches = findObstacleOutlineMatches(tick);
  return matches[0] ?? null;
}

function pickVisibleGroundEntryOutlineFallback(tick: FaladorTickCapture): {
  outline: AgilityOutlineDetection;
  entryDistance: number;
  roughWallDistance: number;
  reachability: FaladorTargetReachability;
} | null {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  const bitmap = tick.bitmap;
  const entryTarget = tick.course.targets[0];
  if (!calibration || !playerTile || !bitmap || !entryTarget || playerTile.z !== FALADOR_ENTRY_TILE.z) {
    return null;
  }

  const entryDistance = chebyshevDistance(playerTile, FALADOR_ENTRY_TILE);
  const roughWallDistance = distanceToTargetRectangle(playerTile, entryTarget);
  if (
    entryDistance > ENTRY_VISIBLE_FALLBACK_RADIUS_TILES &&
    roughWallDistance > ENTRY_VISIBLE_FALLBACK_RADIUS_TILES
  ) {
    return null;
  }

  const reachability = getTargetReachability(tick.course, playerTile, entryTarget);
  if (!reachability.reachable) {
    return null;
  }

  const candidates = tick.outlines.filter((outline) => {
    return outline.color !== "red" && isClickableOutline(outline, bitmap) && isLikelyObjectOutline(outline);
  });
  if (candidates.length === 0) {
    return null;
  }

  const projectedEntry = projectObstacleTarget(calibration, playerTile, entryTarget);
  const anchor = projectedEntry?.localPoint ?? getPlayerLocalAnchor(calibration);
  const outline = pickNearestAgilityOutlineToPoint(candidates, anchor, Math.max(bitmap.width, bitmap.height));
  return outline ? { outline, entryDistance, roughWallDistance, reachability } : null;
}

function getProjectedMarkOfGraceZone(tick: FaladorTickCapture): MarkOfGraceZoneProjection | null {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  if (!calibration || !playerTile || playerTile.z !== COURSE_Z) {
    return null;
  }

  const componentId = getCourseTileComponentId(tick.course, playerTile);
  const component = componentId !== null ? tick.course.componentsById.get(componentId) ?? null : null;
  const progress = getCourseProgressAtPlayer(tick.course, playerTile);
  const zone = progress?.zone ?? null;
  const tiles = zone?.tiles ?? component?.tiles ?? [];
  if (tiles.length === 0) {
    return null;
  }

  const label = zone
    ? formatSuccessZoneSummary(zone, tick.course)
    : component
      ? `component=${component.id}[${component.bounds.minX},${component.bounds.minY},${component.bounds.z}-${component.bounds.maxX},${component.bounds.maxY},${component.bounds.z} tiles=${component.tiles.length}]`
      : "unknown-zone";

  const points = tiles
    .map((tile) => projectWorldTileToScreen(calibration, playerTile, tile))
    .filter((point): point is ScreenPoint => point !== null)
    .map((point) => screenPointToLocal(calibration, point))
    .filter((point) => {
      return (
        point.x >= -MARK_OF_GRACE_ACCESSIBLE_TILE_RADIUS_PX &&
        point.y >= -MARK_OF_GRACE_ACCESSIBLE_TILE_RADIUS_PX &&
        point.x <= calibration.captureBounds.width - 1 + MARK_OF_GRACE_ACCESSIBLE_TILE_RADIUS_PX &&
        point.y <= calibration.captureBounds.height - 1 + MARK_OF_GRACE_ACCESSIBLE_TILE_RADIUS_PX
      );
    });

  return points.length > 0 ? { componentId, label, points } : null;
}

function isPointInsideOutline(outline: AgilityOutlineDetection, point: ScreenPoint, marginPx: number): boolean {
  return (
    point.x >= outline.minX - marginPx &&
    point.x <= outline.maxX + marginPx &&
    point.y >= outline.minY - marginPx &&
    point.y <= outline.maxY + marginPx
  );
}

function getObstacleFootprintTiles(target: FaladorObstacleTarget): WorldTile[] {
  const tiles: WorldTile[] = [];
  for (let x = target.x; x < target.x + target.width; x += 1) {
    for (let y = target.y; y < target.y + target.height; y += 1) {
      tiles.push(deriveWorldTile(x, y, target.z));
    }
  }
  return tiles;
}

function isOutlineOnCacheObstacle(tick: FaladorTickCapture, outline: AgilityOutlineDetection): boolean {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  if (!calibration || !playerTile) {
    return false;
  }

  for (const target of tick.course.targets) {
    if (target.z !== playerTile.z) {
      continue;
    }

    for (const tile of getObstacleFootprintTiles(target)) {
      const screenPoint = projectWorldTileToScreen(calibration, playerTile, tile);
      if (!screenPoint) {
        continue;
      }

      const localPoint = screenPointToLocal(calibration, screenPoint);
      if (isPointInsideOutline(outline, localPoint, CACHE_OBSTACLE_OUTLINE_EXCLUSION_MARGIN_PX)) {
        return true;
      }
    }
  }

  return false;
}

function getOutlineBoxDistance(outline: AgilityOutlineDetection, point: ScreenPoint): number {
  const dx = point.x < outline.minX ? outline.minX - point.x : point.x > outline.maxX ? point.x - outline.maxX : 0;
  const dy = point.y < outline.minY ? outline.minY - point.y : point.y > outline.maxY ? point.y - outline.maxY : 0;
  return Math.max(dx, dy);
}

function getNearestOutlineDistanceToPoints(outline: AgilityOutlineDetection, points: readonly ScreenPoint[]): number {
  return points.reduce(
    (bestDistance, point) => Math.min(bestDistance, getOutlineBoxDistance(outline, point)),
    Number.POSITIVE_INFINITY,
  );
}

function pickMarkOfGraceRedOutline(
  state: FaladorState,
  tick: FaladorTickCapture,
  nowMs: number,
): MarkOfGraceOutlineMatch | null {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  const bitmap = tick.bitmap;
  if (!calibration || !playerTile || !bitmap || playerTile.z !== COURSE_Z) {
    return null;
  }

  const componentId = getCourseTileComponentId(tick.course, playerTile);
  const zoneProjection = getProjectedMarkOfGraceZone(tick);
  if (!zoneProjection) {
    return null;
  }

  const accessiblePoints = zoneProjection.points;

  const playerAnchor = getPlayerLocalAnchor(calibration);
  const markCandidates = tick.outlines
    .map((outline) => ({
      outline,
      accessibleDistance: getNearestOutlineDistanceToPoints(outline, accessiblePoints),
      playerDistance: getOutlineDistance(outline, playerAnchor),
    }))
    .filter(({ outline, accessibleDistance, playerDistance }) => {
      if (outline.color !== "red" || !isClickableOutline(outline, bitmap)) {
        return false;
      }

      if (isIgnoredMarkOfGraceOutline(state, outline, nowMs)) {
        return false;
      }

      if (
        outline.width > MARK_OF_GRACE_MAX_SIDE_PX ||
        outline.height > MARK_OF_GRACE_MAX_SIDE_PX ||
        outline.pixelCount < MARK_OF_GRACE_MIN_PIXELS ||
        outline.pixelCount > 700
      ) {
        return false;
      }

      if (playerDistance > MARK_OF_GRACE_PLAYER_RADIUS_PX) {
        return false;
      }

      if (isOutlineOnCacheObstacle(tick, outline)) {
        return false;
      }

      return accessibleDistance <= MARK_OF_GRACE_ACCESSIBLE_TILE_RADIUS_PX;
    });
  const best = markCandidates.sort((a, b) => {
      const accessibleDistanceDelta = a.accessibleDistance - b.accessibleDistance;
      if (accessibleDistanceDelta !== 0) {
        return accessibleDistanceDelta;
      }

      const playerDistanceDelta = a.playerDistance - b.playerDistance;
      if (playerDistanceDelta !== 0) {
        return playerDistanceDelta;
      }

      return b.outline.pixelCount - a.outline.pixelCount;
    })[0] ?? null;

  return best
    ? {
        outline: best.outline,
        accessibleDistancePx: best.accessibleDistance,
        playerDistancePx: best.playerDistance,
        componentId,
        zoneLabel: zoneProjection.label,
      }
    : null;
}

function withMarkOfGraceZoneScanLogIfNeeded(state: FaladorState, tick: FaladorTickCapture, nowMs: number): FaladorState {
  const bitmap = tick.bitmap;
  const calibration = tick.calibration;
  if (!bitmap || !calibration) {
    return state;
  }

  const redOutlines = tick.outlines.filter((outline) => outline.color === "red" && isClickableOutline(outline, bitmap));
  if (redOutlines.length === 0) {
    return state;
  }

  const zoneProjection = getProjectedMarkOfGraceZone(tick);
  if (!zoneProjection) {
    return withStatusLog(
      state,
      nowMs,
      `${BOT_LOG_PREFIX}: red outline(s) visible, but Mark of Grace zone scan is unavailable; continuing rooftop obstacle. redOutlines=${redOutlines
        .slice(0, 5)
        .map(formatAgilityOutline)
        .join("; ")}.`,
    );
  }

  const playerAnchor = getPlayerLocalAnchor(calibration);
  const redDebug = redOutlines
    .map((outline) => ({
      outline,
      zoneDistance: getNearestOutlineDistanceToPoints(outline, zoneProjection.points),
      playerDistance: getOutlineDistance(outline, playerAnchor),
      onCacheObstacle: isOutlineOnCacheObstacle(tick, outline),
      ignored: isIgnoredMarkOfGraceOutline(state, outline, nowMs),
    }))
    .sort((a, b) => {
      const zoneDistanceDelta = a.zoneDistance - b.zoneDistance;
      if (zoneDistanceDelta !== 0) {
        return zoneDistanceDelta;
      }

      return a.playerDistance - b.playerDistance;
    })
    .slice(0, 5)
    .map(({ outline, zoneDistance, playerDistance, onCacheObstacle, ignored }) => {
      const sizeOk =
        outline.width <= MARK_OF_GRACE_MAX_SIDE_PX &&
        outline.height <= MARK_OF_GRACE_MAX_SIDE_PX &&
        outline.pixelCount >= MARK_OF_GRACE_MIN_PIXELS &&
        outline.pixelCount <= 700;
      return `${formatAgilityOutline(
        outline,
      )} zoneDist=${zoneDistance}px playerDist=${playerDistance}px sizeOk=${sizeOk} cacheObstacle=${onCacheObstacle} ignored=${ignored}`;
    })
    .join("; ");

  return withStatusLog(
    state,
    nowMs,
    `${BOT_LOG_PREFIX}: red outline(s) visible but no Mark of Grace inside current zone; continuing rooftop obstacle. player=${toWorldTileLabel(
      tick.playerTile,
    )} zone=${zoneProjection.label} component=${zoneProjection.componentId ?? "none"} zonePoints=${
      zoneProjection.points.length
    } redOutlines=${redOutlines.length} nearest=${redDebug || "none"}.`,
  );
}

function formatNullableQuantity(quantity: number | null): string {
  return quantity === null ? "unavailable" : String(quantity);
}

async function resolvePendingMarkOfGracePickup(
  state: FaladorState,
  nowMs: number,
): Promise<{ state: FaladorState; handled: boolean }> {
  const pending = state.pendingMarkOfGracePickup;
  if (!pending) {
    return { state, handled: false };
  }

  if (nowMs < pending.nextInventoryCheckAtMs && nowMs < pending.deadlineMs) {
    return {
      state: withStatusLog(
        state,
        nowMs,
        `${BOT_LOG_PREFIX}: waiting for Mark of Grace inventory confirmation. clickedFrom=${toWorldTileLabel(
          pending.clickedPlayerTile,
        )} beforeQty=${formatNullableQuantity(pending.beforeQuantity)} lastQty=${formatNullableQuantity(
          pending.lastQuantity,
        )} outline=${formatMarkOfGraceOutlineSignature(pending.outline)} deadlineIn=${Math.max(
          0,
          pending.deadlineMs - nowMs,
        )}ms.`,
      ),
      handled: true,
    };
  }

  const inventory = await readMarkOfGraceInventoryQuantity();
  const lastQuantity = inventory.quantity ?? pending.lastQuantity;
  if (
    pending.beforeQuantity !== null &&
    inventory.quantity !== null &&
    inventory.quantity > pending.beforeQuantity
  ) {
    const nextDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
    logWithDelta(
      `${BOT_LOG_PREFIX}: confirmed Mark of Grace pickup by inventory. qty=${pending.beforeQuantity}->${inventory.quantity} clickedFrom=${toWorldTileLabel(
        pending.clickedPlayerTile,
      )} outline=${formatMarkOfGraceOutlineSignature(pending.outline)} inventory=${inventory.summary} nextClickDelay=${nextDelayMs}ms.`,
    );
    return {
      state: {
        ...state,
        pendingMarkOfGracePickup: null,
        nextClickAllowedAtMs: nowMs + nextDelayMs,
        missingTargetTicks: 0,
      },
      handled: true,
    };
  }

  if (nowMs >= pending.deadlineMs) {
    const retryDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
    const reason = `inventory-not-increased before=${formatNullableQuantity(
      pending.beforeQuantity,
    )} after=${formatNullableQuantity(inventory.quantity)}`;
    warnWithDelta(
      `${BOT_LOG_PREFIX}: Mark of Grace pickup not confirmed; treating this red outline as blocked for ${MARK_OF_GRACE_BLOCKED_IGNORE_MS}ms. ${reason} clickedFrom=${toWorldTileLabel(
        pending.clickedPlayerTile,
      )} outline=${formatMarkOfGraceOutlineSignature(pending.outline)} inventory=${inventory.summary} retryDelay=${retryDelayMs}ms.`,
    );
    const nextState = addIgnoredMarkOfGraceOutline(state, pending, nowMs, reason);
    return {
      state: {
        ...nextState,
        pendingMarkOfGracePickup: null,
        nextClickAllowedAtMs: nowMs + retryDelayMs,
        missingTargetTicks: state.missingTargetTicks + 1,
      },
      handled: true,
    };
  }

  return {
    state: withStatusLog(
      {
        ...state,
        pendingMarkOfGracePickup: {
          ...pending,
          nextInventoryCheckAtMs: nowMs + MARK_OF_GRACE_PICKUP_CHECK_INTERVAL_MS,
          lastQuantity,
          inventorySummary: inventory.summary,
        },
      },
      nowMs,
      `${BOT_LOG_PREFIX}: Mark of Grace inventory not updated yet. beforeQty=${formatNullableQuantity(
        pending.beforeQuantity,
      )} currentQty=${formatNullableQuantity(inventory.quantity)} clickedFrom=${toWorldTileLabel(
        pending.clickedPlayerTile,
      )} outline=${formatMarkOfGraceOutlineSignature(pending.outline)} inventory=${inventory.summary}.`,
    ),
    handled: true,
  };
}

function getNextCourseTarget(course: FaladorCourse, order: number): FaladorObstacleTarget | null {
  return course.targets[order + 1] ?? null;
}

function addCompletedObstacleOrder(orders: readonly number[], order: number): number[] {
  return orders.includes(order) ? [...orders] : [...orders, order].sort((a, b) => a - b);
}

function addCompletedObstacleOrderRange(orders: readonly number[], startOrder: number, endOrder: number): number[] {
  let nextOrders = [...orders];
  for (let order = startOrder; order <= endOrder; order += 1) {
    nextOrders = addCompletedObstacleOrder(nextOrders, order);
  }
  return nextOrders;
}

function updatePlayerTileStability(state: FaladorState, playerTile: WorldTile, nowMs: number): FaladorState {
  if (state.observedPlayerTile?.key === playerTile.key) {
    return state;
  }

  return {
    ...state,
    observedPlayerTile: playerTile,
    playerTileStableSinceMs: nowMs,
  };
}

function getPlayerTileStableMs(state: FaladorState, nowMs: number, playerTile: WorldTile): number {
  return state.observedPlayerTile?.key === playerTile.key ? Math.max(0, nowMs - state.playerTileStableSinceMs) : 0;
}

function isPlayerTileStableForSuccess(state: FaladorState, nowMs: number, playerTile: WorldTile): boolean {
  return getPlayerTileStableMs(state, nowMs, playerTile) >= SUCCESS_TILE_STABLE_MS;
}

function estimateObstacleTraversalTiming(
  course: FaladorCourse,
  target: FaladorObstacleTarget,
): { distanceTiles: number; waitMs: number; deadlineBufferMs: number } {
  const nextTarget = getNextCourseTarget(course, target.order) ?? course.targets[0];
  const distanceTiles = nextTarget ? tileDistance(target.clickTile, nextTarget.clickTile) : 6;
  const baseTicks = clamp(Math.ceil(distanceTiles / 3) + 2, 3, 10);
  const waitTicks =
    target.order === 0
      ? Math.max(baseTicks, 4)
      : target.order === course.targets.length - 1
        ? Math.max(baseTicks, 5)
        : baseTicks;

  return {
    distanceTiles,
    waitMs: waitTicks * GAME_TICK_MS + randomIntInclusive(80, 260),
    deadlineBufferMs: randomIntInclusive(OBSTACLE_RETRY_BUFFER_MIN_MS, OBSTACLE_RETRY_BUFFER_MAX_MS),
  };
}

function createPendingObstacleTraversal(
  course: FaladorCourse,
  target: FaladorObstacleTarget,
  playerTile: WorldTile,
): PendingObstacleTraversal {
  const clickedAtMs = Date.now();
  const timing = estimateObstacleTraversalTiming(course, target);
  return {
    order: target.order,
    clickedAtMs,
    minConfirmAtMs: clickedAtMs + timing.waitMs,
    deadlineMs: clickedAtMs + timing.waitMs + timing.deadlineBufferMs,
    clickedPlayerTile: playerTile,
    estimatedDistanceTiles: timing.distanceTiles,
    estimatedWaitMs: timing.waitMs,
  };
}

function isFinalCourseObstacle(course: FaladorCourse, order: number): boolean {
  return order === course.targets.length - 1;
}

function getTraversalProgressDistance(pending: PendingObstacleTraversal, playerTile: WorldTile): number {
  return chebyshevDistance(pending.clickedPlayerTile, playerTile);
}

function formatCourseComponentAt(course: FaladorCourseConnectivity, tile: Pick<WorldTile, "x" | "y" | "z">): string {
  const componentId = getCourseTileComponentId(course, tile);
  if (componentId === null) {
    return "none";
  }

  const component = course.componentsById.get(componentId);
  return component
    ? `${componentId}[${component.bounds.minX},${component.bounds.minY},${component.bounds.z}-${component.bounds.maxX},${component.bounds.maxY},${component.bounds.z} tiles=${component.tiles.length}]`
    : String(componentId);
}

function hasMovedToDifferentWalkableComponent(
  course: FaladorCourseConnectivity,
  fromTile: WorldTile,
  toTile: WorldTile,
): boolean {
  const fromComponentId = getCourseTileComponentId(course, fromTile);
  const toComponentId = getCourseTileComponentId(course, toTile);
  return fromComponentId !== null && toComponentId !== null && fromComponentId !== toComponentId;
}

function hasPendingObstacleReachedExpectedZone(
  state: FaladorState,
  course: FaladorCourse,
  pending: PendingObstacleTraversal,
  nowMs: number,
  playerTile: WorldTile,
  progress: FaladorCourseProgress | null,
): boolean {
  const target = course.targets[pending.order];
  if (!target) {
    return false;
  }

  if (isFinalCourseObstacle(course, target.order)) {
    return playerTile.z === FALADOR_ENTRY_TILE.z && isPlayerTileStableForSuccess(state, nowMs, playerTile);
  }

  if (!progress?.zone || progress.completedThroughOrder !== pending.order) {
    return false;
  }

  return isPlayerTileStableForSuccess(state, nowMs, playerTile);
}

function formatPendingObstacleTraversal(course: FaladorCourse, pending: PendingObstacleTraversal): string {
  const target = course.targets[pending.order];
  const nextTarget = getNextCourseTarget(course, pending.order);
  const successZone = course.successZonesByOrder.get(pending.order);
  return `${target ? toTargetLabel(target, course) : `order=${pending.order}`} next=${nextTarget ? toTargetLabel(nextTarget, course) : "lap-complete"} landingZone=${successZone ? formatSuccessZone(successZone) : "ground-plane"} clickedFrom=${toWorldTileLabel(pending.clickedPlayerTile)} estimateDistance=${pending.estimatedDistanceTiles}tiles estimateWait=${pending.estimatedWaitMs}ms`;
}

function confirmPendingObstacleTraversal(
  state: FaladorState,
  course: FaladorCourse,
  pending: PendingObstacleTraversal,
  nowMs: number,
  playerTile: WorldTile,
  nextReachableTarget: FaladorObstacleTarget | null = null,
): FaladorState {
  const target = course.targets[pending.order];
  if (!target) {
    return { ...state, pendingObstacle: null };
  }

  const nextDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
  if (isFinalCourseObstacle(course, target.order)) {
    logWithDelta(
      `${BOT_LOG_PREFIX}: confirmed lap ${state.lapIndex} complete after ${toTargetLabel(target, course)}; player=${toWorldTileLabel(playerTile)}. Next lap can use the entry obstacle again after ${nextDelayMs}ms.`,
    );
    return {
      ...state,
      pendingObstacle: null,
      lastConfirmedObstacleIndex: null,
      completedObstacleOrdersThisLap: [],
      lapIndex: state.lapIndex + 1,
      nextClickAllowedAtMs: nowMs + nextDelayMs,
      missingTargetTicks: 0,
    };
  }

  const completedOrders = addCompletedObstacleOrder(state.completedObstacleOrdersThisLap, target.order);
  const nextReachableDetails = nextReachableTarget
    ? ` nextReachable=${toTargetLabel(nextReachableTarget, course)}`
    : "";
  logWithDelta(
    `${BOT_LOG_PREFIX}: confirmed traversal of ${toTargetLabel(target, course)}; player=${toWorldTileLabel(
      playerTile,
    )}${nextReachableDetails} completedThisLap=${completedOrders
      .map((order) => formatCourseObstacleIndex(order, course))
      .join(",")} nextClickDelay=${nextDelayMs}ms.`,
  );
  return {
    ...state,
    pendingObstacle: null,
    lastConfirmedObstacleIndex: target.order,
    completedObstacleOrdersThisLap: completedOrders,
    nextClickAllowedAtMs: nowMs + nextDelayMs,
    missingTargetTicks: 0,
  };
}

function resolvePendingObstacleTraversal(
  state: FaladorState,
  tick: FaladorTickCapture,
  nowMs: number,
): { state: FaladorState; handled: boolean } {
  const pending = state.pendingObstacle;
  const playerTile = tick.playerTile;
  if (!pending || !playerTile) {
    return { state, handled: false };
  }

  const target = tick.course.targets[pending.order] ?? null;
  if (!target) {
    return {
      state: {
        ...state,
        pendingObstacle: null,
      },
      handled: true,
    };
  }

  const progress = getCourseProgressAtPlayer(tick.course, playerTile);
  const changedComponent = hasMovedToDifferentWalkableComponent(tick.course, pending.clickedPlayerTile, playerTile);
  const successZone = tick.course.successZonesByOrder.get(pending.order);
  const sourceZone = pending.order > 0 ? tick.course.successZonesByOrder.get(pending.order - 1) ?? null : null;
  const inSuccessZone = successZone ? isPlayerInSuccessZone(playerTile, successZone) : playerTile.z === FALADOR_ENTRY_TILE.z;
  const inSourceZone =
    pending.order === 0
      ? playerTile.z === FALADOR_ENTRY_TILE.z
      : sourceZone
        ? isPlayerInSuccessZone(playerTile, sourceZone)
        : false;
  const stableMs = getPlayerTileStableMs(state, nowMs, playerTile);
  const progressDistance = getTraversalProgressDistance(pending, playerTile);
  const playerComponentId = getCourseTileComponentId(tick.course, playerTile);
  const nextTarget = getNextCourseTarget(tick.course, pending.order);
  const componentDetails = `componentChanged=${changedComponent} fromComponent=${formatCourseComponentAt(
    tick.course,
    pending.clickedPlayerTile,
  )} playerComponent=${formatCourseComponentAt(tick.course, playerTile)}`;
  const zoneDetails = progress
    ? `courseProgress=completedThrough=${
        progress.completedThroughOrder >= 0 ? formatCourseObstacleIndex(progress.completedThroughOrder, tick.course) : "entry"
      } currentTarget=${progress.currentTarget ? toTargetLabel(progress.currentTarget, tick.course) : "lap-complete"}`
    : "courseProgress=between-zones";

  if (hasPendingObstacleReachedExpectedZone(state, tick.course, pending, nowMs, playerTile, progress)) {
    logWithDelta(
      `${BOT_LOG_PREFIX}: confirmed traversal by map-cache course zone. ${formatPendingObstacleTraversal(
        tick.course,
        pending,
      )} player=${toWorldTileLabel(playerTile)} inSuccessZone=${inSuccessZone} ${componentDetails} ${zoneDetails}.`,
    );
    return {
      state: confirmPendingObstacleTraversal(state, tick.course, pending, nowMs, playerTile, nextTarget),
      handled: true,
    };
  }

  if (nowMs < pending.minConfirmAtMs) {
    return {
      state: withStatusLog(
        state,
        nowMs,
        `${BOT_LOG_PREFIX}: waiting for map-cache traversal time before next click. ${formatPendingObstacleTraversal(
          tick.course,
          pending,
        )} player=${toWorldTileLabel(
          playerTile,
        )} inSourceZone=${inSourceZone} inSuccessZone=${inSuccessZone} ${componentDetails} ${zoneDetails} stableFor=${stableMs}ms progress=${progressDistance}tiles remaining=${Math.max(0, pending.minConfirmAtMs - nowMs)}ms.`,
      ),
      handled: true,
    };
  }

  if (nowMs < pending.deadlineMs) {
    return {
      state: withStatusLog(
        state,
        nowMs,
        `${BOT_LOG_PREFIX}: traversal not confirmed yet; blocking reclick while waiting. ${formatPendingObstacleTraversal(
          tick.course,
          pending,
        )} player=${toWorldTileLabel(
          playerTile,
        )} inSourceZone=${inSourceZone} inSuccessZone=${inSuccessZone} ${componentDetails} ${zoneDetails} stableFor=${stableMs}ms requiredStable=${SUCCESS_TILE_STABLE_MS}ms progress=${progressDistance}tiles deadlineIn=${Math.max(0, pending.deadlineMs - nowMs)}ms.`,
      ),
      handled: true,
    };
  }

  const retryDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
  const hardDeadlineMs = pending.clickedAtMs + OBSTACLE_TRAVERSAL_HARD_TIMEOUT_MS;
  const stillInTransit =
    !isFinalCourseObstacle(tick.course, pending.order) &&
    playerTile.z === COURSE_Z &&
    playerComponentId === null &&
    Number.isFinite(progressDistance) &&
    !progress &&
    nowMs < hardDeadlineMs;
  if (stillInTransit) {
    const extendedDeadlineMs = Math.min(hardDeadlineMs, nowMs + OBSTACLE_TRANSIT_DEADLINE_EXTENSION_MS);
    return {
      state: withStatusLog(
        {
          ...state,
          pendingObstacle: {
            ...pending,
            deadlineMs: extendedDeadlineMs,
          },
        },
        nowMs,
        `${BOT_LOG_PREFIX}: keeping traversal context while player is between map-cache components. ${formatPendingObstacleTraversal(
          tick.course,
          pending,
        )} player=${toWorldTileLabel(
          playerTile,
        )} ${componentDetails} ${zoneDetails} progress=${progressDistance}tiles extendedDeadlineIn=${Math.max(0, extendedDeadlineMs - nowMs)}ms hardDeadlineIn=${Math.max(0, hardDeadlineMs - nowMs)}ms.`,
      ),
      handled: true,
    };
  }

  warnWithDelta(
    `${BOT_LOG_PREFIX}: traversal was not confirmed before deadline; allowing retry because success was not proven. ${formatPendingObstacleTraversal(
      tick.course,
      pending,
    )} player=${toWorldTileLabel(
      playerTile,
    )} inSourceZone=${inSourceZone} inSuccessZone=${inSuccessZone} ${componentDetails} ${zoneDetails} progress=${progressDistance}tiles retryDelay=${retryDelayMs}ms.`,
  );
  return {
    state: {
      ...state,
      pendingObstacle: null,
      nextClickAllowedAtMs: nowMs + retryDelayMs,
      missingTargetTicks: state.missingTargetTicks + 1,
    },
    handled: true,
  };
}

function getOutlineDebugColor(outline: AgilityOutlineDetection): { r: number; g: number; b: number } {
  return outline.color === "green" ? { r: 0, g: 255, b: 0 } : { r: 255, g: 32, b: 32 };
}

function getOutlineDebugPixels(bitmap: ScreenBitmap, outline: AgilityOutlineDetection): ScreenPoint[] {
  const points: ScreenPoint[] = [];
  for (let y = outline.minY; y <= outline.maxY; y += 1) {
    for (let x = outline.minX; x <= outline.maxX; x += 1) {
      if (isOutlineColorPixel(bitmap, outline.color, x, y)) {
        points.push({ x, y });
      }
    }
  }

  return points;
}

function saveFaladorClickDebugImage(
  tick: FaladorTickCapture,
  outline: AgilityOutlineDetection,
  clickedLocal: ScreenPoint,
  preferredLocalPoint: ScreenPoint | null = null,
): string | null {
  const bitmap = tick.bitmap;
  if (!bitmap) {
    return null;
  }

  faladorClickDebugIndex += 1;
  const filePath = path.join(
    CLICK_DEBUG_DIR,
    `falador-rooftop-click-${String(faladorClickDebugIndex).padStart(4, "0")}-${outline.color}-${clickedLocal.x}x${clickedLocal.y}.png`,
  );
  const shapes: DebugOverlayShape[] = [
    {
      type: "points",
      points: getOutlineDebugPixels(bitmap, outline),
      color: { r: 0, g: 255, b: 255 },
      thickness: 2,
    },
    {
      type: "box",
      x: outline.x,
      y: outline.y,
      width: outline.width,
      height: outline.height,
      color: getOutlineDebugColor(outline),
      thickness: 1,
    },
    {
      type: "circle",
      x: outline.centerX,
      y: outline.centerY,
      radius: 10,
      color: { r: 255, g: 255, b: 255 },
      thickness: 2,
    },
    {
      type: "cross",
      x: clickedLocal.x,
      y: clickedLocal.y,
      radius: 14,
      color: { r: 255, g: 0, b: 255 },
      thickness: 3,
    },
  ];

  if (preferredLocalPoint) {
    shapes.push({
      type: "cross",
      x: preferredLocalPoint.x,
      y: preferredLocalPoint.y,
      radius: 9,
      color: { r: 255, g: 255, b: 255 },
      thickness: 2,
    });
  }

  const playerBox = tick.calibration?.playerBox ?? null;
  if (playerBox) {
    shapes.push({
      type: "box",
      x: playerBox.centerX - Math.round(playerBox.width / 2),
      y: playerBox.centerY - Math.round(playerBox.height / 2),
      width: playerBox.width,
      height: playerBox.height,
      color: { r: 255, g: 255, b: 0 },
      thickness: 2,
    });
  }

  void saveBitmapWithDebugOverlay(bitmap, filePath, shapes).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`${BOT_LOG_PREFIX}: click debug screenshot failed: ${message}`);
  });

  return filePath;
}

async function clickOutline(
  state: FaladorState,
  tick: FaladorTickCapture,
  outline: AgilityOutlineDetection,
  reason: string,
  options: ClickOutlineOptions = {},
): Promise<{ state: FaladorState; clicked: ScreenPoint }> {
  const calibration = tick.calibration!;
  const clickPoint =
    pickPreferredOutlineScreenPoint(tick.bitmap, outline, calibration.captureBounds, state, options.preferredLocalPoint ?? null, {
      radiusPx: options.preferredRadiusPx ?? OBSTACLE_PROJECTION_CLICK_JITTER_PX,
    }) ??
    pickBoxInteractionScreenPoint(outline, calibration.captureBounds, {
      innerRatio: CLICK_INNER_RATIO,
      preferredLocalY: outline.centerY,
      lastClickPoint: state.lastClickPoint,
    });

  await moveMouseHumanLike(clickPoint.x, clickPoint.y, calibration.captureBounds, {
    maxDurationMs: randomIntInclusive(180, 360),
    safeEdgeMarginPx: 12,
    shouldContinue: () => AppState.automateBotRunning,
  });

  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(45, 125),
    safeEdgeMarginPx: 12,
  });
  const clickedLocal = screenPointToLocal(calibration, clicked);
  const nextDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
  const clickDebugPath = saveFaladorClickDebugImage(tick, outline, clickedLocal, options.preferredLocalPoint ?? null);

  logWithDelta(
    `${BOT_LOG_PREFIX}: clicked ${reason} at screen=${clicked.x},${clicked.y} local=${clickedLocal.x},${clickedLocal.y}; outline=${formatAgilityOutline(outline)} clickDebug=${clickDebugPath ?? "unavailable"} nextClickDelay=${nextDelayMs}ms.`,
  );

  return {
    clicked,
    state: {
      ...state,
      nextClickAllowedAtMs: Date.now() + nextDelayMs,
      lastClickPoint: clicked,
      missingTargetTicks: 0,
    },
  };
}

function withStatusLog(state: FaladorState, nowMs: number, message: string): FaladorState {
  if (nowMs - state.lastStatusLogAtMs >= STATUS_LOG_INTERVAL_MS) {
    logWithDelta(message);
    return { ...state, lastStatusLogAtMs: nowMs };
  }

  return state;
}

function pickDistinctScreenPointNearLocalPoint(
  localPoint: ScreenPoint,
  localMinX: number,
  localMaxX: number,
  localMinY: number,
  localMaxY: number,
  captureBounds: StartupPlayerTileCalibration["captureBounds"],
  state: Pick<FaladorState, "lastClickPoint">,
): ScreenPoint {
  const minX = Math.min(localMinX, localMaxX);
  const maxX = Math.max(localMinX, localMaxX);
  const minY = Math.min(localMinY, localMaxY);
  const maxY = Math.max(localMinY, localMaxY);
  let candidate: ScreenPoint = {
    x: captureBounds.x + clamp(Math.round(localPoint.x), minX, maxX),
    y: captureBounds.y + clamp(Math.round(localPoint.y), minY, maxY),
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = {
      x: captureBounds.x + randomIntInclusive(minX, maxX),
      y: captureBounds.y + randomIntInclusive(minY, maxY),
    };
    candidate = next;
    if (!state.lastClickPoint || next.x !== state.lastClickPoint.x || next.y !== state.lastClickPoint.y) {
      return next;
    }
  }

  return candidate;
}

function isOutlineColorPixel(bitmap: ScreenBitmap, color: AgilityOutlineColor, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
    return false;
  }

  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  const b = bitmap.image[offset];
  const g = bitmap.image[offset + 1];
  const r = bitmap.image[offset + 2];
  return color === "green"
    ? g >= 155 && r <= 85 && b <= 110 && g - r >= 90 && g - b >= 60
    : r >= 170 && g <= 100 && b <= 110 && r - g >= 80 && r - b >= 65;
}

function pickOutlineInteriorLocalPointFromHorizontalScan(
  bitmap: ScreenBitmap,
  outline: AgilityOutlineDetection,
  anchor: ScreenPoint,
): ScreenPoint | null {
  const anchorX = clamp(Math.round(anchor.x), outline.minX, outline.maxX);
  const anchorY = clamp(Math.round(anchor.y), outline.minY, outline.maxY);
  const maxOffset = Math.max(0, Math.min(OUTLINE_INTERIOR_SCAN_RADIUS_PX, outline.maxY - outline.minY));

  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const ys = offset === 0 ? [anchorY] : [anchorY - offset, anchorY + offset];
    for (const y of ys) {
      if (y < outline.minY || y > outline.maxY) {
        continue;
      }

      let leftMost: number | null = null;
      let rightMost: number | null = null;
      for (let x = outline.minX; x <= outline.maxX; x += 1) {
        if (!isOutlineColorPixel(bitmap, outline.color, x, y)) {
          continue;
        }

        leftMost = leftMost === null ? x : Math.min(leftMost, x);
        rightMost = rightMost === null ? x : Math.max(rightMost, x);
      }

      if (leftMost === null || rightMost === null || rightMost - leftMost < OUTLINE_INTERIOR_MIN_GAP_PX) {
        continue;
      }

      return {
        x: clamp(anchorX, leftMost + 2, rightMost - 2),
        y,
      };
    }
  }

  return null;
}

function pickOutlineInteriorLocalPointFromVerticalScan(
  bitmap: ScreenBitmap,
  outline: AgilityOutlineDetection,
  anchor: ScreenPoint,
): ScreenPoint | null {
  const anchorX = clamp(Math.round(anchor.x), outline.minX, outline.maxX);
  const anchorY = clamp(Math.round(anchor.y), outline.minY, outline.maxY);
  const maxOffset = Math.max(0, Math.min(OUTLINE_INTERIOR_SCAN_RADIUS_PX, outline.maxX - outline.minX));

  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const xs = offset === 0 ? [anchorX] : [anchorX - offset, anchorX + offset];
    for (const x of xs) {
      if (x < outline.minX || x > outline.maxX) {
        continue;
      }

      let topMost: number | null = null;
      let bottomMost: number | null = null;
      for (let y = outline.minY; y <= outline.maxY; y += 1) {
        if (!isOutlineColorPixel(bitmap, outline.color, x, y)) {
          continue;
        }

        topMost = topMost === null ? y : Math.min(topMost, y);
        bottomMost = bottomMost === null ? y : Math.max(bottomMost, y);
      }

      if (topMost === null || bottomMost === null || bottomMost - topMost < OUTLINE_INTERIOR_MIN_GAP_PX) {
        continue;
      }

      return {
        x,
        y: clamp(anchorY, topMost + 2, bottomMost - 2),
      };
    }
  }

  return null;
}

function pickOutlineInteriorLocalPointNearProjection(
  bitmap: ScreenBitmap,
  outline: AgilityOutlineDetection,
  preferredLocalPoint: ScreenPoint,
): ScreenPoint | null {
  return (
    pickOutlineInteriorLocalPointFromHorizontalScan(bitmap, outline, preferredLocalPoint) ??
    pickOutlineInteriorLocalPointFromVerticalScan(bitmap, outline, preferredLocalPoint)
  );
}

function pickPreferredOutlineScreenPoint(
  bitmap: ScreenBitmap | null,
  outline: AgilityOutlineDetection,
  captureBounds: StartupPlayerTileCalibration["captureBounds"],
  state: Pick<FaladorState, "lastClickPoint">,
  preferredLocalPoint: ScreenPoint | null,
  options: { radiusPx: number },
): ScreenPoint | null {
  if (!preferredLocalPoint || !Number.isFinite(preferredLocalPoint.x) || !Number.isFinite(preferredLocalPoint.y)) {
    return null;
  }

  if (getOutlineBoxDistance(outline, preferredLocalPoint) > 0) {
    return null;
  }

  const interiorLocalPoint = bitmap
    ? pickOutlineInteriorLocalPointNearProjection(bitmap, outline, preferredLocalPoint)
    : null;
  if (interiorLocalPoint) {
    return {
      x: captureBounds.x + interiorLocalPoint.x,
      y: captureBounds.y + interiorLocalPoint.y,
    };
  }

  const radiusPx = Math.max(0, Math.round(options.radiusPx));
  const localMinX = Math.max(outline.minX, Math.round(preferredLocalPoint.x - radiusPx));
  const localMaxX = Math.min(outline.maxX, Math.round(preferredLocalPoint.x + radiusPx));
  const localMinY = Math.max(outline.minY, Math.round(preferredLocalPoint.y - radiusPx));
  const localMaxY = Math.min(outline.maxY, Math.round(preferredLocalPoint.y + radiusPx));
  if (localMinX > localMaxX || localMinY > localMaxY) {
    return null;
  }

  return pickDistinctScreenPointNearLocalPoint(
    preferredLocalPoint,
    localMinX,
    localMaxX,
    localMinY,
    localMaxY,
    captureBounds,
    state,
  );
}

function captureFaladorTick(window: Window, course: FaladorCourse, state: FaladorState): FaladorTickCapture {
  const calibration = readStartupPlayerTileCalibration(window, {
    requireRuneLiteCoordinatePattern: true,
  });
  if (!calibration) {
    return {
      course,
      calibration: null,
      bitmap: null,
      playerTile: null,
      outlines: [],
    };
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  return {
    course,
    calibration,
    bitmap,
    playerTile: calibration.playerTile,
    outlines: detectAgilityOutlines(bitmap),
  };
}

async function handleFaladorLoop(params: {
  state: FaladorState;
  nowMs: number;
  tickCapture: FaladorTickCapture;
}): Promise<FaladorState> {
  let { state } = params;
  const { tickCapture, nowMs } = params;
  const calibration = tickCapture.calibration;
  const bitmap = tickCapture.bitmap;
  const playerTile = tickCapture.playerTile;

  if (calibration && !state.loggedStartupCalibration) {
    logWithDelta(formatStartupPlayerTileCalibrationLog(BOT_NAME, calibration));
    state = { ...state, loggedStartupCalibration: true };
  }

  if (!calibration || !bitmap || !playerTile) {
    return withStatusLog(
      { ...state, missingTargetTicks: state.missingTargetTicks + 1 },
      nowMs,
      `${BOT_LOG_PREFIX}: waiting for coordinate/player calibration before rooftop click. outlines=${tickCapture.outlines.length}.`,
    );
  }

  state = updatePlayerTileStability(state, playerTile, nowMs);
  state = syncFaladorProgressFromCourseZone(state, tickCapture);
  state = withFaladorRegionTargetLog(state, tickCapture);
  state = pruneIgnoredMarkOfGraceOutlines(state, nowMs);

  const pendingResult = resolvePendingObstacleTraversal(state, tickCapture, nowMs);
  state = pendingResult.state;
  if (pendingResult.handled) {
    return state;
  }

  const pendingMarkResult = await resolvePendingMarkOfGracePickup(state, nowMs);
  state = pendingMarkResult.state;
  if (pendingMarkResult.handled) {
    return state;
  }

  if (nowMs < state.nextClickAllowedAtMs) {
    return state;
  }

  const markOfGrace = pickMarkOfGraceRedOutline(state, tickCapture, nowMs);
  if (markOfGrace) {
    const beforeInventory = await readMarkOfGraceInventoryQuantity();
    const result = await clickOutline(
      state,
      tickCapture,
      markOfGrace.outline,
      `red Mark of Grace zone=${markOfGrace.zoneLabel} component=${markOfGrace.componentId ?? "none"} accessibleDistance=${markOfGrace.accessibleDistancePx}px playerDistance=${markOfGrace.playerDistancePx}px inventoryBefore=${formatNullableQuantity(
        beforeInventory.quantity,
      )}`,
      {
        preferredLocalPoint: { x: markOfGrace.outline.centerX, y: markOfGrace.outline.centerY },
        preferredRadiusPx: 0,
      },
    );
    const clickedAtMs = Date.now();
    logWithDelta(
      `${BOT_LOG_PREFIX}: Mark of Grace inventory confirmation started. beforeQty=${formatNullableQuantity(
        beforeInventory.quantity,
      )} clickedFrom=${toWorldTileLabel(playerTile)} outline=${formatAgilityOutline(
        markOfGrace.outline,
      )} inventory=${beforeInventory.summary}.`,
    );
    return {
      ...result.state,
      pendingMarkOfGracePickup: {
        clickedAtMs,
        deadlineMs: clickedAtMs + MARK_OF_GRACE_PICKUP_CONFIRM_MS,
        nextInventoryCheckAtMs: clickedAtMs + MARK_OF_GRACE_PICKUP_FIRST_CHECK_DELAY_MS,
        beforeQuantity: beforeInventory.quantity,
        lastQuantity: beforeInventory.quantity,
        outline: getMarkOfGraceOutlineSignature(markOfGrace.outline),
        clickedPlayerTile: playerTile,
        inventorySummary: beforeInventory.summary,
      },
    };
  }

  state = withMarkOfGraceZoneScanLogIfNeeded(state, tickCapture, nowMs);

  const obstacleMatch = pickBestObstacleMatch(tickCapture);
  if (!obstacleMatch) {
    const groundStartDetails =
      playerTile.z === 0
        ? ` entry=${toWorldTileLabel(FALADOR_ENTRY_TILE)} entryDistance=${chebyshevDistance(
            playerTile,
            FALADOR_ENTRY_TILE,
          )} roughWallDistance=${distanceToTargetRectangle(playerTile, tickCapture.course.targets[0])} hintRadius=${FALADOR_ENTRY_RADIUS_TILES};`
        : "";
    return withStatusLog(
      { ...state, missingTargetTicks: state.missingTargetTicks + 1 },
      nowMs,
      `${BOT_LOG_PREFIX}: cache selected no clickable obstacle outline confirmation. player=${toWorldTileLabel(playerTile)}${groundStartDetails} cacheTarget=${formatAllowedTargetReachability(tickCapture)} ${formatObstacleSearchProjectionDebug(tickCapture)} outlines=${tickCapture.outlines.map(formatAgilityOutline).join("; ") || "none"} missing=${state.missingTargetTicks + 1}.`,
    );
  }

  const result = await clickOutline(
    state,
    tickCapture,
    obstacleMatch.outline,
    `cache-selected rooftop obstacle ${toTargetLabel(obstacleMatch.target, tickCapture.course)} decision=${obstacleMatch.decisionReason} projectedLocal=${obstacleMatch.localPoint.x},${obstacleMatch.localPoint.y} outlineColor=${obstacleMatch.outline.color} outlineDistance=${obstacleMatch.outlineDistancePx}px ${formatTargetReachability(obstacleMatch.reachability)}`,
    {
      preferredLocalPoint: obstacleMatch.localPoint,
      preferredRadiusPx: OBSTACLE_PROJECTION_CLICK_JITTER_PX,
    },
  );
  const pendingObstacle = createPendingObstacleTraversal(tickCapture.course, obstacleMatch.target, playerTile);
  logWithDelta(
    `${BOT_LOG_PREFIX}: pending traversal started; ${formatPendingObstacleTraversal(
      tickCapture.course,
      pendingObstacle,
    )}. Obstacles already passed this lap will stay blocked until lap completion.`,
  );

  return {
    ...result.state,
    pendingObstacle,
  };
}

async function runFaladorRooftopLoop(window: Window): Promise<void> {
  if (isFaladorRooftopLoopRunning) {
    logWithDelta(`${BOT_LOG_PREFIX}: loop already running; skipping new start.`);
    return;
  }

  isFaladorRooftopLoopRunning = true;
  faladorClickDebugIndex = 0;
  try {
    const course = loadFaladorCourseFromMapCache();
    logWithDelta(
      `${BOT_LOG_PREFIX}: loaded ${course.targets.length} rooftop course object(s) from region ${FALADOR_REGION_X},${FALADOR_REGION_Y}; mapCacheObstacles=${course.mapCacheObstacleCount}/${course.targets.length} cache=${course.cacheDirectoryPath ?? "fallback-only"} mapTiles=${course.tilesByKey.size} missingMapCacheIds=${course.missingMapCacheIds.join(",") || "none"}.`,
    );
    logWithDelta(`${BOT_LOG_PREFIX}: course order ${course.targets.map((target) => toTargetLabel(target, course)).join(" -> ")}.`);
    logWithDelta(`${BOT_LOG_PREFIX}: course zones ${[...course.successZonesByOrder.values()].map(formatSuccessZone).join(" -> ")}.`);

    await runBotEngine<FaladorState, FaladorFunctionKey, FaladorTickCapture>({
      tickMs: BOT_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState,
      captureTick: ({ state }) => captureFaladorTick(window, course, state),
      functions: {
        loop: handleFaladorLoop,
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        errorWithDelta(`${BOT_LOG_PREFIX}: loop #${state.loopIndex} failed: ${message}`);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorWithDelta(`${BOT_LOG_PREFIX}: startup failed: ${message}`);
    stopAutomateBot("bot");
  } finally {
    isFaladorRooftopLoopRunning = false;
    faladorRooftopStartedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onAgilityFaladorRooftopBotStart(): void {
  if (!isFaladorRooftopLoopRunning) {
    faladorRooftopStartedAtMs = Date.now();
  }

  logWithDelta(`Automate Bot STARTED (${BOT_NAME}).`);
  const window = getRuneLite();
  if (!window) {
    warnWithDelta(`${BOT_LOG_PREFIX}: RuneLite window not found.`);
    stopAutomateBot("bot");
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();
  void runFaladorRooftopLoop(window);
}
