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
  executeMinimapWorldClickPlan,
  inferRuneliteMinimapWorldClickGeometry,
  projectWorldTileToMinimapClick,
  type MinimapWorldClickGeometry,
  type MinimapWorldClickPlan,
} from "./shared/minimap-world-clicker";
import {
  formatStartupPlayerTileCalibrationLog,
  readStartupPlayerTileCalibration,
  type StartupPlayerTileCalibration,
} from "./shared/startup-calibration";
import {
  RUNELITE_AGILITY_OBSTACLE_ID_ENTRIES,
  type RuneliteAgilityObstacleIdEntry,
} from "./cache/runelite-agility-obstacles";
import {
  fetchRuneLiteLocalApiSnapshot,
  formatRuneLiteLocalApiSnapshot,
  type RuneLiteLocalApiSnapshot,
} from "./runelite-local-api/runelite-local-api";

const BOT_NAME = "Rooftop";
const BOT_LOG_PREFIX = `Automate Bot (${BOT_NAME})`;

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
const MARK_OF_GRACE_CLICK_CENTER_RADIUS_PX = 0;
const MARK_OF_GRACE_MIN_WIDTH_PX = 20;
const MARK_OF_GRACE_MIN_HEIGHT_PX = 10;
const MARK_OF_GRACE_MAX_HEIGHT_PX = 36;
const MARK_OF_GRACE_MIN_ASPECT_RATIO = 1.2;
const MARK_OF_GRACE_OBSTACLE_OUTLINE_EXCLUSION_MARGIN_PX = 80;
const CACHE_OBSTACLE_OUTLINE_EXCLUSION_MARGIN_PX = 18;
const STATUS_LOG_INTERVAL_MS = 2200;
const CLICK_INNER_RATIO = 0.55;
const CLICK_DEBUG_DIR = "test-image-debug";
const ROOFTOP_MINIMAP_MAX_CLICK_RADIUS_RATIO = 0.8;
const ROOFTOP_MINIMAP_MIN_MOVE_DISTANCE_TILES = 6;
const ROOFTOP_MINIMAP_ASSUMED_RUN_TILES_PER_TICK = 2;
const POST_MINIMAP_3D_CLICK_STABLE_MS = GAME_TICK_MS;
const ROOFTOP_MINIMAP_GEOMETRY_MIN_SCORE = 0.84;
const ROOFTOP_MINIMAP_GEOMETRY_MAX_CENTER_DRIFT_RATIO = 0.09;
const ROOFTOP_MINIMAP_GEOMETRY_MAX_RADIUS_DRIFT_RATIO = 0.08;
const ROOFTOP_MINIMAP_GEOMETRY_SMOOTHING_ALPHA = 0.18;

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
  courseKey: string;
  label: string;
  regionX: number;
  regionY: number;
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

type PendingPostMinimap3dStability = {
  clickedAtMs: number;
  targetLabel: string;
  waypointTile: WorldTile;
  reason: string;
};

type StableMinimapGeometryState = {
  geometry: MinimapWorldClickGeometry;
  captureWidth: number;
  captureHeight: number;
  scalePercent: number;
  acceptedCount: number;
  rejectedCount: number;
  updatedAtMs: number;
};

type FaladorState = BotEngineLoopState<FaladorFunctionKey> & {
  course: FaladorCourse | null;
  nextClickAllowedAtMs: number;
  lastClickPoint: ScreenPoint | null;
  lastConfirmedObstacleIndex: number | null;
  completedObstacleOrdersThisLap: number[];
  pendingObstacle: PendingObstacleTraversal | null;
  pendingMarkOfGracePickup: PendingMarkOfGracePickup | null;
  pendingPostMinimap3dStability: PendingPostMinimap3dStability | null;
  stableMinimapGeometry: StableMinimapGeometryState | null;
  ignoredMarkOfGraceOutlines: IgnoredMarkOfGraceOutline[];
  lapIndex: number;
  observedPlayerTile: WorldTile | null;
  playerTileStableSinceMs: number;
  lastStatusLogAtMs: number;
  lastMarkOfGraceStatusLogAtMs: number;
  missingTargetTicks: number;
  loggedStartupCalibration: boolean;
  lastLoggedPlayerRegionAgilityScanKey: string | null;
};

type RooftopTickCapture = {
  course: FaladorCourse | null;
  calibration: StartupPlayerTileCalibration | null;
  bitmap: ScreenBitmap | null;
  playerTile: WorldTile | null;
  outlines: AgilityOutlineDetection[];
};

type FaladorTickCapture = RooftopTickCapture & {
  course: FaladorCourse;
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

type RooftopMinimapNavigationTarget = {
  target: FaladorObstacleTarget;
  waypointTile: WorldTile;
  reason: string;
  reachability: FaladorTargetReachability | null;
};

type ClickOutlineOptions = {
  preferredLocalPoint?: ScreenPoint | null;
  preferredRadiusPx?: number;
  usePreferredOutlineInteriorScan?: boolean;
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
    course: null,
    nextClickAllowedAtMs: 0,
    lastClickPoint: null,
    lastConfirmedObstacleIndex: null,
    completedObstacleOrdersThisLap: [],
    pendingObstacle: null,
    pendingMarkOfGracePickup: null,
    pendingPostMinimap3dStability: null,
    stableMinimapGeometry: null,
    ignoredMarkOfGraceOutlines: [],
    lapIndex: 1,
    observedPlayerTile: null,
    playerTileStableSinceMs: 0,
    lastStatusLogAtMs: 0,
    lastMarkOfGraceStatusLogAtMs: 0,
    missingTargetTicks: 0,
    loggedStartupCalibration: false,
    lastLoggedPlayerRegionAgilityScanKey: null,
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
  return course?.targets.length ?? 0;
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
  return deriveWorldTile(
    x + Math.floor((Math.max(1, width) - 1) / 2),
    y + Math.floor((Math.max(1, height) - 1) / 2),
    z,
  );
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
  const previewTiles = zone.tiles.slice(0, 8).map(toWorldTileLabel).join("|");
  const suffix = zone.tiles.length > 8 ? `|+${zone.tiles.length - 8}` : "";
  return `${zone.afterOrder + 1}:${zone.label} components=${zone.componentIds.join(",") || "none"} center=${toWorldTileLabel(zone.centerTile)} tiles=${zone.tiles.length} source=${zone.source}${previewTiles ? ` [${previewTiles}${suffix}]` : ""}`;
}

function formatSuccessZoneSummary(
  zone: FaladorSuccessZone,
  course: Pick<FaladorCourse, "targets"> | null = null,
): string {
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
      if (
        !cacheTile ||
        cacheTile.blocked ||
        distanceToTargetRectangle(tile, target) > OBSTACLE_INTERACTION_REACH_RADIUS_TILES
      ) {
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

function isPlayerOnCourseStartPlane(course: FaladorCourse, playerTile: WorldTile): boolean {
  const entryTarget = course.targets[0] ?? null;
  return !!entryTarget && playerTile.z === entryTarget.z;
}

function getCourseProgressAtPlayer(course: FaladorCourse, playerTile: WorldTile): FaladorCourseProgress | null {
  const entryTarget = course.targets[0] ?? null;
  if (entryTarget && isPlayerOnCourseStartPlane(course, playerTile)) {
    const entryDistance = distanceToTargetRectangle(playerTile, entryTarget);
    return {
      completedThroughOrder: -1,
      currentTarget: entryTarget,
      zone: null,
      reason: entryDistance <= ENTRY_VISIBLE_FALLBACK_RADIUS_TILES ? "ground-entry-zone" : "ground-restart-plane",
    };
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

  return formatCacheTargetDecision(pickCacheTargetDecision(tick.course, playerTile), tick.course);
}

function getRooftopCourseKey(object: OsrsCacheMapObject): string | null {
  const key = object.agilityObstacleKey;
  if (!key?.startsWith("ROOFTOPS_")) {
    return null;
  }

  const match = /^ROOFTOPS_[A-Z0-9]+/.exec(key);
  return match?.[0] ?? null;
}

function getMapObjectCenterTile(object: OsrsCacheMapObject): WorldTile {
  return centerTileForRectangle(object.worldX, object.worldY, object.z, object.sizeX, object.sizeY);
}

function getMapObjectDistanceToPlayer(object: OsrsCacheMapObject, playerTile: WorldTile): number {
  return tileDistance(getMapObjectCenterTile(object), playerTile);
}

function compareMapObjectsByDistanceToPlayer(
  playerTile: WorldTile,
): (a: OsrsCacheMapObject, b: OsrsCacheMapObject) => number {
  return (a, b) => {
    const distanceDelta = getMapObjectDistanceToPlayer(a, playerTile) - getMapObjectDistanceToPlayer(b, playerTile);
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    const zDelta = Math.abs(a.z - playerTile.z) - Math.abs(b.z - playerTile.z);
    if (zDelta !== 0) {
      return zDelta;
    }

    return a.id - b.id || compareWorldTiles(getMapObjectCenterTile(a), getMapObjectCenterTile(b));
  };
}

function formatRooftopCourseKey(courseKey: string): string {
  return courseKey.replace(/^ROOFTOPS_/, "").toLowerCase();
}

function formatRooftopMapObjectSummary(object: OsrsCacheMapObject, playerTile: WorldTile): string {
  const centerTile = getMapObjectCenterTile(object);
  return `${object.agilityObstacleKey ?? `object-${object.id}`} id=${object.id} ${object.name}@${object.worldX},${object.worldY},${object.z} size=${object.sizeX}x${object.sizeY} center=${toWorldTileLabel(
    centerTile,
  )} dist=${getMapObjectDistanceToPlayer(object, playerTile)} zDelta=${Math.abs(object.z - playerTile.z)}`;
}

function normalizeRooftopObstacleOrderKey(key: string): string {
  return key.replace(/_(\d+)[A-Z]$/, "_$1");
}

function getRooftopCourseOrderEntries(courseKey: string): RuneliteAgilityObstacleIdEntry[] {
  const seenOrderKeys = new Set<string>();
  const entries: RuneliteAgilityObstacleIdEntry[] = [];
  for (const entry of RUNELITE_AGILITY_OBSTACLE_ID_ENTRIES) {
    if (!entry.key.startsWith(`${courseKey}_`)) {
      continue;
    }

    const orderKey = normalizeRooftopObstacleOrderKey(entry.key);
    if (seenOrderKeys.has(orderKey)) {
      continue;
    }

    seenOrderKeys.add(orderKey);
    entries.push(entry);
  }

  return entries;
}

function pickNearestMapObject(
  objects: readonly OsrsCacheMapObject[],
  playerTile: WorldTile,
): OsrsCacheMapObject | null {
  return [...objects].sort(compareMapObjectsByDistanceToPlayer(playerTile))[0] ?? null;
}

function pickNearestRooftopCourseKey(
  objectsByCourse: ReadonlyMap<string, readonly OsrsCacheMapObject[]>,
  playerTile: WorldTile,
): string | null {
  return (
    [...objectsByCourse.entries()]
      .map(([courseKey, objects]) => ({
        courseKey,
        nearestObject: pickNearestMapObject(objects, playerTile),
      }))
      .filter(
        (candidate): candidate is { courseKey: string; nearestObject: OsrsCacheMapObject } =>
          candidate.nearestObject !== null,
      )
      .sort((a, b) => {
        const distanceDelta =
          getMapObjectDistanceToPlayer(a.nearestObject, playerTile) -
          getMapObjectDistanceToPlayer(b.nearestObject, playerTile);
        if (distanceDelta !== 0) {
          return distanceDelta;
        }

        return a.courseKey.localeCompare(b.courseKey);
      })[0]?.courseKey ?? null
  );
}

function buildRooftopObjectsByCourse(objects: readonly OsrsCacheMapObject[]): Map<string, OsrsCacheMapObject[]> {
  const objectsByCourse = new Map<string, OsrsCacheMapObject[]>();
  for (const object of objects) {
    const courseKey = getRooftopCourseKey(object);
    if (!courseKey) {
      continue;
    }

    const courseObjects = objectsByCourse.get(courseKey) ?? [];
    courseObjects.push(object);
    objectsByCourse.set(courseKey, courseObjects);
  }

  return objectsByCourse;
}

function pickCourseObjectForOrderEntry(
  objectsById: ReadonlyMap<number, readonly OsrsCacheMapObject[]>,
  entry: RuneliteAgilityObstacleIdEntry,
  playerTile: WorldTile,
  previousTarget: FaladorObstacleTarget | null,
): OsrsCacheMapObject | null {
  const objects = objectsById.get(entry.id) ?? [];
  const anchor = previousTarget?.clickTile ?? playerTile;
  return (
    [...objects].sort((a, b) => {
      const anchorDistanceDelta =
        tileDistance(getMapObjectCenterTile(a), anchor) - tileDistance(getMapObjectCenterTile(b), anchor);
      if (anchorDistanceDelta !== 0) {
        return anchorDistanceDelta;
      }

      return getMapObjectDistanceToPlayer(a, playerTile) - getMapObjectDistanceToPlayer(b, playerTile);
    })[0] ?? null
  );
}

function buildDynamicRooftopCourseFromRegionView(params: {
  view: ReturnType<typeof readOsrsCacheMapRegionView>;
  playerTile: WorldTile;
  courseKey: string;
}): FaladorCourse | null {
  const courseObjects = params.view.objects.filter((object) => getRooftopCourseKey(object) === params.courseKey);
  if (courseObjects.length === 0) {
    return null;
  }

  const objectsById = new Map<number, OsrsCacheMapObject[]>();
  for (const object of courseObjects) {
    const objects = objectsById.get(object.id) ?? [];
    objects.push(object);
    objectsById.set(object.id, objects);
  }

  const targets: FaladorObstacleTarget[] = [];
  for (const entry of getRooftopCourseOrderEntries(params.courseKey)) {
    const object = pickCourseObjectForOrderEntry(
      objectsById,
      entry,
      params.playerTile,
      targets[targets.length - 1] ?? null,
    );
    if (!object) {
      continue;
    }

    targets.push(targetFromMapObject(object, targets.length));
  }

  if (targets.length < 2) {
    return null;
  }

  const tilesByKey = buildCourseTilesByKey(params.view.tiles);
  const { componentsById, componentIdByTileKey } = buildCourseWalkableComponents(tilesByKey);
  const courseWithoutSuccessZones: FaladorCourseConnectivity = {
    targets,
    tilesByKey,
    componentsById,
    componentIdByTileKey,
  };

  return {
    courseKey: params.courseKey,
    label: `${formatRooftopCourseKey(params.courseKey)} rooftop`,
    regionX: params.view.regionX,
    regionY: params.view.regionY,
    cacheDirectoryPath: params.view.cacheDirectoryPath,
    targets,
    mapCacheObstacleCount: targets.length,
    missingMapCacheIds: [],
    successZonesByOrder: buildFaladorSuccessZones(courseWithoutSuccessZones),
    tilesByKey,
    componentsById,
    componentIdByTileKey,
  };
}

function loadNearestRooftopCourseFromPlayerRegion(playerTile: WorldTile): FaladorCourse | null {
  const view = readOsrsCacheMapRegionView({ regionX: playerTile.regionX, regionY: playerTile.regionY });
  const objectsByCourse = buildRooftopObjectsByCourse(view.objects);
  const courseKey = pickNearestRooftopCourseKey(objectsByCourse, playerTile);
  if (!courseKey) {
    return null;
  }

  return buildDynamicRooftopCourseFromRegionView({ view, playerTile, courseKey });
}

function withDynamicRooftopCourse(state: FaladorState, playerTile: WorldTile): FaladorState {
  const currentCourse = state.course;
  if (currentCourse && currentCourse.regionX === playerTile.regionX && currentCourse.regionY === playerTile.regionY) {
    return state;
  }

  const course = loadNearestRooftopCourseFromPlayerRegion(playerTile);
  if (!course) {
    if (currentCourse) {
      warnWithDelta(
        `${BOT_LOG_PREFIX}: no rooftop agility course found in current player region; clearing active course. player=${toWorldTileLabel(
          playerTile,
        )} region=${playerTile.regionX},${playerTile.regionY}.`,
      );
    }

    return {
      ...state,
      course: null,
      pendingObstacle: null,
      pendingMarkOfGracePickup: null,
      lastConfirmedObstacleIndex: null,
      completedObstacleOrdersThisLap: [],
    };
  }

  logWithDelta(
    `${BOT_LOG_PREFIX}: selected nearest rooftop course from player region. course=${course.courseKey} label=${course.label} player=${toWorldTileLabel(
      playerTile,
    )} region=${course.regionX},${course.regionY} obstacles=${course.targets.length} mapCacheObstacles=${
      course.mapCacheObstacleCount
    }/${course.targets.length} cache=${course.cacheDirectoryPath ?? "unavailable"} order=${course.targets
      .map((target) => toTargetLabel(target, course))
      .join(" -> ")} zones=${[...course.successZonesByOrder.values()].map(formatSuccessZone).join(" -> ") || "none"}.`,
  );

  return {
    ...state,
    course,
    pendingObstacle: null,
    pendingMarkOfGracePickup: null,
    ignoredMarkOfGraceOutlines: [],
    lastConfirmedObstacleIndex: null,
    completedObstacleOrdersThisLap: [],
    missingTargetTicks: 0,
  };
}

function withPlayerRegionAgilityCourseScanLog(state: FaladorState, tick: RooftopTickCapture): FaladorState {
  const playerTile = tick.playerTile;
  if (!playerTile) {
    return state;
  }

  const regionKey = `${playerTile.regionX},${playerTile.regionY}`;
  if (state.lastLoggedPlayerRegionAgilityScanKey === regionKey) {
    return state;
  }

  try {
    const view = readOsrsCacheMapRegionView({ regionX: playerTile.regionX, regionY: playerTile.regionY });
    const rooftopObjects = view.objects
      .filter((object) => getRooftopCourseKey(object) !== null)
      .sort(compareMapObjectsByDistanceToPlayer(playerTile));
    if (rooftopObjects.length === 0) {
      logWithDelta(
        `${BOT_LOG_PREFIX}: current player region rooftop scan found no rooftop agility course objects. player=${toWorldTileLabel(
          playerTile,
        )} region=${regionKey} cache=${view.cacheDirectoryPath} missing=${view.missing === true} error=${
          view.error ?? "none"
        } objects=${view.objects.length}.`,
      );
      return { ...state, lastLoggedPlayerRegionAgilityScanKey: regionKey };
    }

    const objectsByCourse = new Map<string, OsrsCacheMapObject[]>();
    for (const object of rooftopObjects) {
      const courseKey = getRooftopCourseKey(object);
      if (!courseKey) {
        continue;
      }

      const objects = objectsByCourse.get(courseKey) ?? [];
      objects.push(object);
      objectsByCourse.set(courseKey, objects);
    }

    const courseSummaries = [...objectsByCourse.entries()]
      .map(([courseKey, objects]) => {
        const nearest = [...objects].sort(compareMapObjectsByDistanceToPlayer(playerTile))[0];
        return `${formatRooftopCourseKey(courseKey)} objects=${objects.length} nearest=${formatRooftopMapObjectSummary(
          nearest,
          playerTile,
        )}`;
      })
      .join(" | ");
    const nearestObjects = rooftopObjects
      .slice(0, 8)
      .map((object) => formatRooftopMapObjectSummary(object, playerTile));

    logWithDelta(
      `${BOT_LOG_PREFIX}: current player region rooftop scan. player=${toWorldTileLabel(
        playerTile,
      )} region=${regionKey} cache=${view.cacheDirectoryPath} rooftopObjects=${rooftopObjects.length} courses=${courseSummaries} nearestObjects=${nearestObjects.join(
        "; ",
      )}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(
      `${BOT_LOG_PREFIX}: current player region rooftop scan failed. player=${toWorldTileLabel(
        playerTile,
      )} region=${regionKey}: ${message}.`,
    );
  }

  return { ...state, lastLoggedPlayerRegionAgilityScanKey: regionKey };
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
      `${BOT_LOG_PREFIX}: synced ${tick.course.label} progress from ground entry zone; player=${toWorldTileLabel(
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
    `${BOT_LOG_PREFIX}: synced ${tick.course.label} progress from map-cache course zone; player=${toWorldTileLabel(
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

function targetFromMapObject(object: OsrsCacheMapObject, order: number): FaladorObstacleTarget {
  return {
    order,
    id: object.id,
    key: object.agilityObstacleKey ?? `object-${object.id}`,
    name: object.name,
    x: object.worldX,
    y: object.worldY,
    z: object.z,
    width: Math.max(1, object.sizeX),
    height: Math.max(1, object.sizeY),
    clickTile: centerTileForRectangle(object.worldX, object.worldY, object.z, object.sizeX, object.sizeY),
    source: "map-cache",
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
  const bottomRightUiMinY = Math.round(bitmap.height * 0.7);
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
  return target.order === 0 ? ENTRY_OUTLINE_MATCH_RADIUS_PX : OUTLINE_MATCH_RADIUS_PX;
}

function isWideHorizontalCourseTarget(target: FaladorObstacleTarget): boolean {
  return target.width >= 3 && target.height === 1;
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
    candidates.sort((a, b) => {
      const boxDistanceDelta =
        getOutlineBoxDistance(a, projected.localPoint) - getOutlineBoxDistance(b, projected.localPoint);
      if (boxDistanceDelta !== 0) {
        return boxDistanceDelta;
      }

      const centerDistanceDelta =
        getOutlineDistance(a, projected.localPoint) - getOutlineDistance(b, projected.localPoint);
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
  return reachability.nearestTile &&
    reachability.nearestTile.z === target.z &&
    !excludedKeys.has(reachability.nearestTile.key)
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
  const clickableOutlines = tick.bitmap
    ? tick.outlines.filter((outline) => isClickableOutline(outline, tick.bitmap!))
    : tick.outlines;
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

function sortObstacleOutlineMatches(
  matches: ObstacleOutlineMatch[],
  target: FaladorObstacleTarget,
): ObstacleOutlineMatch[] {
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

  const fallbackProjectionTiles = getReachableFallbackProjectionTiles(
    target,
    cacheDecision.reachability,
    targetProjectionTiles,
  );
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
  if (!calibration || !playerTile || !bitmap || !entryTarget || playerTile.z !== entryTarget.z) {
    return null;
  }

  const entryDistance = distanceToTargetRectangle(playerTile, entryTarget);
  const roughWallDistance = distanceToTargetRectangle(playerTile, entryTarget);
  if (entryDistance > ENTRY_VISIBLE_FALLBACK_RADIUS_TILES && roughWallDistance > ENTRY_VISIBLE_FALLBACK_RADIUS_TILES) {
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
  if (!calibration || !playerTile) {
    return null;
  }

  const progress = getCourseProgressAtPlayer(tick.course, playerTile);
  if (progress?.completedThroughOrder === -1) {
    return null;
  }

  const componentId = getCourseTileComponentId(tick.course, playerTile);
  const component = componentId !== null ? (tick.course.componentsById.get(componentId) ?? null) : null;
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

function isOutlineOnCacheObstacle(
  tick: FaladorTickCapture,
  outline: AgilityOutlineDetection,
  marginPx = CACHE_OBSTACLE_OUTLINE_EXCLUSION_MARGIN_PX,
): boolean {
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
      if (isPointInsideOutline(outline, localPoint, marginPx)) {
        return true;
      }
    }
  }

  return false;
}

function isMarkOfGraceOutlineShape(outline: AgilityOutlineDetection): boolean {
  const aspectRatio = outline.height > 0 ? outline.width / outline.height : 0;
  return (
    outline.width >= MARK_OF_GRACE_MIN_WIDTH_PX &&
    outline.height >= MARK_OF_GRACE_MIN_HEIGHT_PX &&
    outline.width <= MARK_OF_GRACE_MAX_SIDE_PX &&
    outline.height <= MARK_OF_GRACE_MAX_HEIGHT_PX &&
    outline.pixelCount >= MARK_OF_GRACE_MIN_PIXELS &&
    outline.pixelCount <= 700 &&
    aspectRatio >= MARK_OF_GRACE_MIN_ASPECT_RATIO
  );
}

function getOutlineBoxDistance(outline: AgilityOutlineDetection, point: ScreenPoint): number {
  const dx = point.x < outline.minX ? outline.minX - point.x : point.x > outline.maxX ? point.x - outline.maxX : 0;
  const dy = point.y < outline.minY ? outline.minY - point.y : point.y > outline.maxY ? point.y - outline.maxY : 0;
  return Math.max(dx, dy);
}

function getOutlineBoxCenterPoint(outline: AgilityOutlineDetection): ScreenPoint {
  return {
    x: Math.round((outline.minX + outline.maxX) / 2),
    y: Math.round((outline.minY + outline.maxY) / 2),
  };
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
  if (!calibration || !playerTile || !bitmap) {
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

      if (!isMarkOfGraceOutlineShape(outline)) {
        return false;
      }

      if (playerDistance > MARK_OF_GRACE_PLAYER_RADIUS_PX) {
        return false;
      }

      if (isOutlineOnCacheObstacle(tick, outline, MARK_OF_GRACE_OBSTACLE_OUTLINE_EXCLUSION_MARGIN_PX)) {
        return false;
      }

      return accessibleDistance <= MARK_OF_GRACE_ACCESSIBLE_TILE_RADIUS_PX;
    });
  const best =
    markCandidates.sort((a, b) => {
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

function withMarkOfGraceZoneScanLogIfNeeded(
  state: FaladorState,
  tick: FaladorTickCapture,
  nowMs: number,
): FaladorState {
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
    return withMarkOfGraceStatusLog(
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
      onCacheObstacle: isOutlineOnCacheObstacle(tick, outline, MARK_OF_GRACE_OBSTACLE_OUTLINE_EXCLUSION_MARGIN_PX),
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
      const shapeOk = isMarkOfGraceOutlineShape(outline);
      return `${formatAgilityOutline(
        outline,
      )} zoneDist=${zoneDistance}px playerDist=${playerDistance}px shapeOk=${shapeOk} cacheObstacle=${onCacheObstacle} ignored=${ignored}`;
    })
    .join("; ");

  return withMarkOfGraceStatusLog(
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
  if (pending.beforeQuantity !== null && inventory.quantity !== null && inventory.quantity > pending.beforeQuantity) {
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

function resolvePostMinimap3dClickStability(
  state: FaladorState,
  nowMs: number,
  playerTile: WorldTile,
): { state: FaladorState; handled: boolean } {
  const pending = state.pendingPostMinimap3dStability;
  if (!pending) {
    return { state, handled: false };
  }

  const stableMs = getPlayerTileStableMs(state, nowMs, playerTile);
  if (stableMs < POST_MINIMAP_3D_CLICK_STABLE_MS) {
    return {
      state: withStatusLog(
        state,
        nowMs,
        `${BOT_LOG_PREFIX}: waiting for player to settle after minimap navigation before 3D click. player=${toWorldTileLabel(
          playerTile,
        )} stable=${stableMs}/${POST_MINIMAP_3D_CLICK_STABLE_MS}ms target=${pending.targetLabel} waypoint=${toWorldTileLabel(
          pending.waypointTile,
        )} reason=${pending.reason} sinceMinimap=${Math.max(0, nowMs - pending.clickedAtMs)}ms.`,
      ),
      handled: true,
    };
  }

  return {
    state: {
      ...state,
      pendingPostMinimap3dStability: null,
    },
    handled: false,
  };
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
    const entryTarget = course.targets[0] ?? null;
    return !!entryTarget && playerTile.z === entryTarget.z && isPlayerTileStableForSuccess(state, nowMs, playerTile);
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

  if (
    pending.order > 0 &&
    !isFinalCourseObstacle(tick.course, pending.order) &&
    isPlayerOnCourseStartPlane(tick.course, playerTile)
  ) {
    const retryDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
    warnWithDelta(
      `${BOT_LOG_PREFIX}: player returned to course start plane during non-final traversal; assuming fall/off-course and restarting from first obstacle. pending=${formatPendingObstacleTraversal(
        tick.course,
        pending,
      )} player=${toWorldTileLabel(playerTile)} startTarget=${toTargetLabel(
        tick.course.targets[0],
        tick.course,
      )} nextClickDelay=${retryDelayMs}ms.`,
    );
    return {
      state: {
        ...state,
        pendingObstacle: null,
        pendingMarkOfGracePickup: null,
        lastConfirmedObstacleIndex: null,
        completedObstacleOrdersThisLap: [],
        nextClickAllowedAtMs: nowMs + retryDelayMs,
        missingTargetTicks: 0,
      },
      handled: true,
    };
  }

  const progress = getCourseProgressAtPlayer(tick.course, playerTile);
  const changedComponent = hasMovedToDifferentWalkableComponent(tick.course, pending.clickedPlayerTile, playerTile);
  const successZone = tick.course.successZonesByOrder.get(pending.order);
  const sourceZone = pending.order > 0 ? (tick.course.successZonesByOrder.get(pending.order - 1) ?? null) : null;
  const entryTarget = tick.course.targets[0] ?? null;
  const inSuccessZone = successZone
    ? isPlayerInSuccessZone(playerTile, successZone)
    : !!entryTarget && playerTile.z === entryTarget.z;
  const inSourceZone =
    pending.order === 0
      ? !!entryTarget && playerTile.z === entryTarget.z
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
        progress.completedThroughOrder >= 0
          ? formatCourseObstacleIndex(progress.completedThroughOrder, tick.course)
          : "entry"
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
    `rooftop-click-${String(faladorClickDebugIndex).padStart(4, "0")}-${outline.color}-${clickedLocal.x}x${clickedLocal.y}.png`,
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
    pickPreferredOutlineScreenPoint(
      tick.bitmap,
      outline,
      calibration.captureBounds,
      state,
      options.preferredLocalPoint ?? null,
      {
        radiusPx: options.preferredRadiusPx ?? OBSTACLE_PROJECTION_CLICK_JITTER_PX,
        useInteriorScan: options.usePreferredOutlineInteriorScan,
      },
    ) ??
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

  const clickSettleMs = randomIntInclusive(45, 125);
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, calibration.captureBounds, {
    settleMs: clickSettleMs,
    safeEdgeMarginPx: 12,
  });
  const clickedLocal = screenPointToLocal(calibration, clicked);
  const nextDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
  const clickDebugPath = saveFaladorClickDebugImage(tick, outline, clickedLocal, options.preferredLocalPoint ?? null);

  logWithDelta(
    `${BOT_LOG_PREFIX}: clicked ${reason} at screen=${clicked.x},${clicked.y} local=${clickedLocal.x},${clickedLocal.y}; outline=${formatAgilityOutline(outline)} clickSettle=${clickSettleMs}ms clickDebug=${clickDebugPath ?? "unavailable"} nextClickDelay=${nextDelayMs}ms.`,
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

function pickRooftopMinimapNavigationTarget(tick: FaladorTickCapture): RooftopMinimapNavigationTarget | null {
  const playerTile = tick.playerTile;
  if (!playerTile) {
    return null;
  }

  const cacheDecision = pickCacheTargetDecision(tick.course, playerTile);
  const progress = cacheDecision ? null : getCourseProgressAtPlayer(tick.course, playerTile);
  const target = cacheDecision?.target ?? progress?.currentTarget ?? null;
  if (!target) {
    return null;
  }

  const waypointTile = cacheDecision?.reachability.nearestTile ?? target.clickTile;
  if (waypointTile.z !== playerTile.z) {
    return null;
  }

  const distanceTiles = tileDistance(playerTile, waypointTile);
  if (distanceTiles < ROOFTOP_MINIMAP_MIN_MOVE_DISTANCE_TILES) {
    return null;
  }

  return {
    target,
    waypointTile,
    reason: cacheDecision ? `cache:${cacheDecision.reason}` : `progress:${progress?.reason ?? "unknown"}`,
    reachability: cacheDecision?.reachability ?? null,
  };
}

type ResolvedStableMinimapGeometry = {
  geometry: MinimapWorldClickGeometry;
  stableState: StableMinimapGeometryState;
  logDetails: string;
};

function hasStableMinimapGeometryForCapture(
  stable: StableMinimapGeometryState | null,
  calibration: StartupPlayerTileCalibration,
  bitmap: ScreenBitmap,
): stable is StableMinimapGeometryState {
  return (
    !!stable &&
    stable.captureWidth === bitmap.width &&
    stable.captureHeight === bitmap.height &&
    stable.scalePercent === calibration.windowsScalePercent
  );
}

function cloneMinimapGeometry(
  geometry: MinimapWorldClickGeometry,
  overrides: Partial<MinimapWorldClickGeometry> = {},
): MinimapWorldClickGeometry {
  const hasSourceOverride = Object.prototype.hasOwnProperty.call(overrides, "source");
  const hasDetectionScoreOverride = Object.prototype.hasOwnProperty.call(overrides, "detectionScore");

  return {
    centerLocalX: overrides.centerLocalX ?? geometry.centerLocalX,
    centerLocalY: overrides.centerLocalY ?? geometry.centerLocalY,
    radiusPx: overrides.radiusPx ?? geometry.radiusPx,
    tilePx: overrides.tilePx ?? geometry.tilePx,
    source: hasSourceOverride ? overrides.source : geometry.source,
    detectionScore: hasDetectionScoreOverride ? overrides.detectionScore ?? null : geometry.detectionScore,
    detectionSummary: overrides.detectionSummary ?? geometry.detectionSummary,
    candidates: overrides.candidates ?? [...geometry.candidates],
    expectedCenterLocalX: overrides.expectedCenterLocalX ?? geometry.expectedCenterLocalX,
    expectedCenterLocalY: overrides.expectedCenterLocalY ?? geometry.expectedCenterLocalY,
    expectedRadiusPx: overrides.expectedRadiusPx ?? geometry.expectedRadiusPx,
  };
}

function getMinimapGeometryDrift(stable: MinimapWorldClickGeometry, detected: MinimapWorldClickGeometry): {
  centerPx: number;
  centerRatio: number;
  radiusPx: number;
  radiusRatio: number;
} {
  const radiusBase = Math.max(1, stable.radiusPx);
  const centerPx = Math.hypot(detected.centerLocalX - stable.centerLocalX, detected.centerLocalY - stable.centerLocalY);
  const radiusPx = Math.abs(detected.radiusPx - stable.radiusPx);

  return {
    centerPx,
    centerRatio: centerPx / radiusBase,
    radiusPx,
    radiusRatio: radiusPx / radiusBase,
  };
}

function smoothMinimapGeometry(
  stable: MinimapWorldClickGeometry,
  detected: MinimapWorldClickGeometry,
): MinimapWorldClickGeometry {
  const alpha = ROOFTOP_MINIMAP_GEOMETRY_SMOOTHING_ALPHA;
  const smooth = (current: number, next: number) => Math.round(current + (next - current) * alpha);

  return cloneMinimapGeometry(detected, {
    centerLocalX: smooth(stable.centerLocalX, detected.centerLocalX),
    centerLocalY: smooth(stable.centerLocalY, detected.centerLocalY),
    radiusPx: smooth(stable.radiusPx, detected.radiusPx),
    tilePx: smooth(stable.tilePx, detected.tilePx),
    source: "stable-smoothed",
    detectionSummary: `smoothed-from=${detected.detectionSummary}`,
  });
}

function formatMinimapGeometry(geometry: MinimapWorldClickGeometry): string {
  return `${geometry.centerLocalX},${geometry.centerLocalY}/r${geometry.radiusPx}/tile=${geometry.tilePx}`;
}

function formatMinimapGeometryScore(geometry: MinimapWorldClickGeometry | null): string {
  return geometry?.detectionScore?.toFixed(2) ?? "n/a";
}

function resolveStableRooftopMinimapGeometry(
  state: FaladorState,
  calibration: StartupPlayerTileCalibration,
  bitmap: ScreenBitmap,
  nowMs: number,
): ResolvedStableMinimapGeometry | null {
  const stable = hasStableMinimapGeometryForCapture(state.stableMinimapGeometry, calibration, bitmap)
    ? state.stableMinimapGeometry
    : null;
  const detected = inferRuneliteMinimapWorldClickGeometry(calibration, bitmap, {
    maxClickRadiusRatio: ROOFTOP_MINIMAP_MAX_CLICK_RADIUS_RATIO,
  });
  const detectionScore = detected?.detectionScore ?? null;

  if (!detected) {
    if (!stable) {
      return null;
    }

    const stableState = {
      ...stable,
      rejectedCount: stable.rejectedCount + 1,
    };
    return {
      geometry: cloneMinimapGeometry(stable.geometry, {
        source: "stable-no-detection",
        detectionScore: null,
        detectionSummary: "no-current-detection",
      }),
      stableState,
      logDetails: `minimapGeometry=stable-no-detection stable=${formatMinimapGeometry(
        stable.geometry,
      )} accepted=${stableState.acceptedCount} rejected=${stableState.rejectedCount}`,
    };
  }

  if (detectionScore === null || detectionScore < ROOFTOP_MINIMAP_GEOMETRY_MIN_SCORE) {
    if (!stable) {
      return null;
    }

    const stableState = {
      ...stable,
      rejectedCount: stable.rejectedCount + 1,
    };
    return {
      geometry: cloneMinimapGeometry(stable.geometry, {
        source: "stable-low-score",
        detectionScore,
        detectionSummary: `rejected-low-score=${detected.detectionSummary}`,
        candidates: detected.candidates,
      }),
      stableState,
      logDetails: `minimapGeometry=stable-low-score stable=${formatMinimapGeometry(
        stable.geometry,
      )} detected=${formatMinimapGeometry(detected)} score=${formatMinimapGeometryScore(
        detected,
      )} minScore=${ROOFTOP_MINIMAP_GEOMETRY_MIN_SCORE.toFixed(2)} accepted=${
        stableState.acceptedCount
      } rejected=${stableState.rejectedCount}`,
    };
  }

  if (!stable) {
    const geometry = cloneMinimapGeometry(detected, { source: "stable-bootstrap" });
    const stableState: StableMinimapGeometryState = {
      geometry,
      captureWidth: bitmap.width,
      captureHeight: bitmap.height,
      scalePercent: calibration.windowsScalePercent,
      acceptedCount: 1,
      rejectedCount: 0,
      updatedAtMs: nowMs,
    };

    return {
      geometry,
      stableState,
      logDetails: `minimapGeometry=bootstrap stable=${formatMinimapGeometry(geometry)} score=${formatMinimapGeometryScore(
        detected,
      )} accepted=1 rejected=0`,
    };
  }

  const drift = getMinimapGeometryDrift(stable.geometry, detected);
  const acceptDrift =
    drift.centerRatio <= ROOFTOP_MINIMAP_GEOMETRY_MAX_CENTER_DRIFT_RATIO &&
    drift.radiusRatio <= ROOFTOP_MINIMAP_GEOMETRY_MAX_RADIUS_DRIFT_RATIO;
  if (!acceptDrift) {
    const stableState = {
      ...stable,
      rejectedCount: stable.rejectedCount + 1,
    };
    return {
      geometry: cloneMinimapGeometry(stable.geometry, {
        source: "stable-rejected-drift",
        detectionScore,
        detectionSummary: `rejected-drift=${detected.detectionSummary}`,
        candidates: detected.candidates,
      }),
      stableState,
      logDetails: `minimapGeometry=rejected-drift stable=${formatMinimapGeometry(
        stable.geometry,
      )} detected=${formatMinimapGeometry(detected)} centerDrift=${drift.centerPx.toFixed(
        1,
      )}px/${drift.centerRatio.toFixed(2)}r radiusDrift=${drift.radiusPx.toFixed(
        1,
      )}px/${drift.radiusRatio.toFixed(2)}r max=${ROOFTOP_MINIMAP_GEOMETRY_MAX_CENTER_DRIFT_RATIO.toFixed(
        2,
      )}/${ROOFTOP_MINIMAP_GEOMETRY_MAX_RADIUS_DRIFT_RATIO.toFixed(2)} score=${formatMinimapGeometryScore(
        detected,
      )} accepted=${stableState.acceptedCount} rejected=${stableState.rejectedCount}`,
    };
  }

  const geometry = smoothMinimapGeometry(stable.geometry, detected);
  const stableState: StableMinimapGeometryState = {
    ...stable,
    geometry,
    acceptedCount: stable.acceptedCount + 1,
    updatedAtMs: nowMs,
  };

  return {
    geometry,
    stableState,
    logDetails: `minimapGeometry=accepted stable=${formatMinimapGeometry(
      stable.geometry,
    )} detected=${formatMinimapGeometry(detected)} smoothed=${formatMinimapGeometry(
      geometry,
    )} centerDrift=${drift.centerPx.toFixed(1)}px/${drift.centerRatio.toFixed(
      2,
    )}r radiusDrift=${drift.radiusPx.toFixed(1)}px/${drift.radiusRatio.toFixed(
      2,
    )}r score=${formatMinimapGeometryScore(detected)} accepted=${stableState.acceptedCount} rejected=${
      stableState.rejectedCount
    }`,
  };
}

function saveRooftopMinimapClickDebugImage(
  tick: FaladorTickCapture,
  plan: MinimapWorldClickPlan,
  clickedLocal: ScreenPoint,
): string | null {
  const bitmap = tick.bitmap;
  const calibration = tick.calibration;
  if (!bitmap || !calibration) {
    return null;
  }

  faladorClickDebugIndex += 1;
  const index = String(faladorClickDebugIndex).padStart(4, "0");
  const filePath = path.join(CLICK_DEBUG_DIR, `${index}-rooftop-minimap-click-${clickedLocal.x}x${clickedLocal.y}.png`);
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
      radius: plan.minimapRadiusPx,
      color: { r: 255, g: 140, b: 0 },
      thickness: 2,
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

  void saveBitmapWithDebugOverlay(bitmap, filePath, shapes).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    warnWithDelta(`${BOT_LOG_PREFIX}: minimap click debug screenshot failed: ${message}`);
  });

  return filePath;
}

async function clickRooftopMinimapNavigation(
  state: FaladorState,
  tick: FaladorTickCapture,
  navTarget: RooftopMinimapNavigationTarget,
): Promise<{ state: FaladorState; clicked: boolean; skipReason: string | null }> {
  const calibration = tick.calibration;
  const bitmap = tick.bitmap;
  const playerTile = tick.playerTile;
  if (!calibration || !bitmap || !playerTile) {
    return { state, clicked: false, skipReason: "missing-calibration-bitmap-or-player" };
  }

  const geometry = resolveStableRooftopMinimapGeometry(state, calibration, bitmap, Date.now());
  if (!geometry) {
    return { state, clicked: false, skipReason: "minimap-geometry-unavailable" };
  }

  const plan = projectWorldTileToMinimapClick(calibration, bitmap, playerTile, navTarget.waypointTile, {
    geometry: geometry.geometry,
    maxClickRadiusRatio: ROOFTOP_MINIMAP_MAX_CLICK_RADIUS_RATIO,
  });
  if (!plan) {
    return {
      state: {
        ...state,
        stableMinimapGeometry: geometry.stableState,
      },
      clicked: false,
      skipReason: "projection-unavailable",
    };
  }

  const execution = await executeMinimapWorldClickPlan(calibration, plan, {
    maxDurationMs: randomIntInclusive(180, 320),
    safeEdgeMarginPx: 8,
    shouldContinue: () => AppState.automateBotRunning,
    settleMs: randomIntInclusive(45, 120),
  });
  const clicked = execution.clicked;
  const clickedLocal = execution.clickedLocal;
  const travelTicks = Math.max(1, Math.ceil(plan.clickedPathTiles / ROOFTOP_MINIMAP_ASSUMED_RUN_TILES_PER_TICK) + 1);
  const waitMs = travelTicks * GAME_TICK_MS + randomIntInclusive(80, 240);
  const clickedAtMs = Date.now();
  const debugPath = saveRooftopMinimapClickDebugImage(tick, plan, clickedLocal);

  logWithDelta(
    `${BOT_LOG_PREFIX}: minimap navigation click. course=${tick.course.courseKey} target=${toTargetLabel(
      navTarget.target,
      tick.course,
    )} waypoint=${toWorldTileLabel(navTarget.waypointTile)} reason=${navTarget.reason} ${
      navTarget.reachability ? formatTargetReachability(navTarget.reachability) : "reachability=not-required"
    } player=${toWorldTileLabel(playerTile)} delta=${plan.dxTiles},${plan.dyTiles} distance=${plan.distanceTiles} clickedPath=${
      plan.clickedPathTiles
    } waitTicks=${travelTicks} minimap=${plan.minimapSource}/${plan.projectionSource} radius=${plan.minimapRadiusPx}px maxClick=${
      plan.maxClickDistancePx
    }px clamped=${plan.wasVectorClamped ? "yes" : "no"} tilePx=${plan.minimapTilePx}px effectiveTilePx=${plan.effectiveMinimapTilePx.toFixed(
      2,
    )} center=${plan.minimapCenter.x},${plan.minimapCenter.y} detectionScore=${
      plan.minimapDetectionScore?.toFixed(2) ?? "n/a"
    } ${geometry.logDetails} detector=${plan.minimapDetectionSummary} projected=${plan.projectedScreenPoint.x},${plan.projectedScreenPoint.y} screen=${
      clicked.x
    },${clicked.y} local=${clickedLocal.x},${clickedLocal.y} clickVector=${execution.clickVectorX},${
      execution.clickVectorY
    } wait=${waitMs}ms debug=${debugPath ?? "none"}`,
  );

  return {
    clicked: true,
    skipReason: null,
    state: {
      ...state,
      nextClickAllowedAtMs: clickedAtMs + waitMs,
      lastClickPoint: clicked,
      stableMinimapGeometry: geometry.stableState,
      pendingPostMinimap3dStability: {
        clickedAtMs,
        targetLabel: toTargetLabel(navTarget.target, tick.course),
        waypointTile: navTarget.waypointTile,
        reason: navTarget.reason,
      },
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

function withMarkOfGraceStatusLog(state: FaladorState, nowMs: number, message: string): FaladorState {
  if (nowMs - state.lastMarkOfGraceStatusLogAtMs >= STATUS_LOG_INTERVAL_MS) {
    logWithDelta(message);
    return { ...state, lastMarkOfGraceStatusLogAtMs: nowMs };
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
  options: { radiusPx: number; useInteriorScan?: boolean },
): ScreenPoint | null {
  if (!preferredLocalPoint || !Number.isFinite(preferredLocalPoint.x) || !Number.isFinite(preferredLocalPoint.y)) {
    return null;
  }

  if (getOutlineBoxDistance(outline, preferredLocalPoint) > 0) {
    return null;
  }

  const interiorLocalPoint =
    bitmap && options.useInteriorScan !== false
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

function captureFaladorTick(window: Window, state: FaladorState): RooftopTickCapture {
  const calibration = readStartupPlayerTileCalibration(window, {
    requireRuneLiteCoordinatePattern: true,
  });
  if (!calibration) {
    return {
      course: state.course,
      calibration: null,
      bitmap: null,
      playerTile: null,
      outlines: [],
    };
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  return {
    course: state.course,
    calibration,
    bitmap,
    playerTile: calibration.playerTile,
    outlines: detectAgilityOutlines(bitmap),
  };
}

async function handleFaladorLoop(params: {
  state: FaladorState;
  nowMs: number;
  tickCapture: RooftopTickCapture;
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
  state = withPlayerRegionAgilityCourseScanLog(state, tickCapture);
  state = withDynamicRooftopCourse(state, playerTile);
  const course = state.course;
  if (!course) {
    return withStatusLog(
      { ...state, missingTargetTicks: state.missingTargetTicks + 1 },
      nowMs,
      `${BOT_LOG_PREFIX}: waiting for rooftop course selection from current player region. player=${toWorldTileLabel(
        playerTile,
      )} region=${playerTile.regionX},${playerTile.regionY} outlines=${tickCapture.outlines.length}.`,
    );
  }

  const tickWithCourse: FaladorTickCapture = { ...tickCapture, course };
  state = syncFaladorProgressFromCourseZone(state, tickWithCourse);
  state = pruneIgnoredMarkOfGraceOutlines(state, nowMs);

  const pendingResult = resolvePendingObstacleTraversal(state, tickWithCourse, nowMs);
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

  const postMinimapStability = resolvePostMinimap3dClickStability(state, nowMs, playerTile);
  state = postMinimapStability.state;
  if (postMinimapStability.handled) {
    return state;
  }

  const markOfGrace = pickMarkOfGraceRedOutline(state, tickWithCourse, nowMs);
  if (markOfGrace) {
    const beforeInventory = await readMarkOfGraceInventoryQuantity();
    const markClickPoint = getOutlineBoxCenterPoint(markOfGrace.outline);
    const result = await clickOutline(
      state,
      tickWithCourse,
      markOfGrace.outline,
      `red Mark of Grace zone=${markOfGrace.zoneLabel} component=${markOfGrace.componentId ?? "none"} boxCenter=${markClickPoint.x},${markClickPoint.y} pixelCenter=${markOfGrace.outline.centerX},${markOfGrace.outline.centerY} accessibleDistance=${markOfGrace.accessibleDistancePx}px playerDistance=${markOfGrace.playerDistancePx}px inventoryBefore=${formatNullableQuantity(
        beforeInventory.quantity,
      )}`,
      {
        preferredLocalPoint: markClickPoint,
        preferredRadiusPx: MARK_OF_GRACE_CLICK_CENTER_RADIUS_PX,
        usePreferredOutlineInteriorScan: false,
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

  state = withMarkOfGraceZoneScanLogIfNeeded(state, tickWithCourse, nowMs);

  const obstacleMatch = pickBestObstacleMatch(tickWithCourse);
  if (!obstacleMatch) {
    const minimapNavTarget = pickRooftopMinimapNavigationTarget(tickWithCourse);
    let minimapDetails = "minimapNav=none";
    if (minimapNavTarget) {
      const minimapResult = await clickRooftopMinimapNavigation(state, tickWithCourse, minimapNavTarget);
      if (minimapResult.clicked) {
        return minimapResult.state;
      }

      minimapDetails = `minimapNav=skipped target=${toTargetLabel(
        minimapNavTarget.target,
        course,
      )} waypoint=${toWorldTileLabel(minimapNavTarget.waypointTile)} reason=${minimapNavTarget.reason} skip=${
        minimapResult.skipReason ?? "unknown"
      }`;
    }

    const entryTarget = course.targets[0] ?? null;
    const groundStartDetails =
      entryTarget && playerTile.z === entryTarget.z
        ? ` entry=${toWorldTileLabel(entryTarget.clickTile)} entryDistance=${distanceToTargetRectangle(
            playerTile,
            entryTarget,
          )} hintRadius=${ENTRY_VISIBLE_FALLBACK_RADIUS_TILES};`
        : "";
    return withStatusLog(
      { ...state, missingTargetTicks: state.missingTargetTicks + 1 },
      nowMs,
      `${BOT_LOG_PREFIX}: cache selected no clickable obstacle outline confirmation. course=${course.courseKey} player=${toWorldTileLabel(playerTile)}${groundStartDetails} cacheTarget=${formatAllowedTargetReachability(tickWithCourse)} ${minimapDetails} ${formatObstacleSearchProjectionDebug(tickWithCourse)} outlines=${tickWithCourse.outlines.map(formatAgilityOutline).join("; ") || "none"} missing=${state.missingTargetTicks + 1}.`,
    );
  }

  const result = await clickOutline(
    state,
    tickWithCourse,
    obstacleMatch.outline,
    `cache-selected rooftop obstacle ${toTargetLabel(obstacleMatch.target, tickWithCourse.course)} decision=${obstacleMatch.decisionReason} projectedLocal=${obstacleMatch.localPoint.x},${obstacleMatch.localPoint.y} outlineColor=${obstacleMatch.outline.color} outlineDistance=${obstacleMatch.outlineDistancePx}px ${formatTargetReachability(obstacleMatch.reachability)}`,
    {
      preferredLocalPoint: obstacleMatch.localPoint,
      preferredRadiusPx: OBSTACLE_PROJECTION_CLICK_JITTER_PX,
    },
  );
  const pendingObstacle = createPendingObstacleTraversal(tickWithCourse.course, obstacleMatch.target, playerTile);
  logWithDelta(
    `${BOT_LOG_PREFIX}: pending traversal started; ${formatPendingObstacleTraversal(
      tickWithCourse.course,
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
    logWithDelta(`${BOT_LOG_PREFIX}: dynamic rooftop course selection enabled; waiting for player region calibration.`);
    await runBotEngine<FaladorState, FaladorFunctionKey, RooftopTickCapture>({
      tickMs: BOT_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState,
      captureTick: ({ state }) => captureFaladorTick(window, state),
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
