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

const BOT_NAME = "Rooftop";
const BOT_LOG_PREFIX = `Automate Bot (${BOT_NAME})`;

const FALADOR_REGION_X = 47;
const FALADOR_REGION_Y = 52;
const FALADOR_ENTRY_TILE = deriveWorldTile(3036, 3339, 0);
const FALADOR_ENTRY_OBJECT_SEARCH_TILE = deriveWorldTile(3036, 3342, 0);
const FALADOR_ENTRY_RADIUS_TILES = 5;
const BOT_TICK_MS = 200;
const GAME_TICK_MS = 600;
const CLICK_INTERVAL_MIN_MS = 500;
const CLICK_INTERVAL_MAX_MS = 1000;
const OUTLINE_MATCH_RADIUS_PX = 170;
const ENTRY_OUTLINE_MATCH_RADIUS_PX = 320;
const ENTRY_VISIBLE_FALLBACK_RADIUS_TILES = 12;
const OBSTACLE_SUCCESS_NEXT_TARGET_RADIUS_TILES = 4;
const OBSTACLE_INTERACTION_REACH_RADIUS_TILES = 2;
const OBSTACLE_PROGRESS_CONFIRM_MIN_TILES = 3;
const OBSTACLE_RETRY_BUFFER_MIN_MS = 2600;
const OBSTACLE_RETRY_BUFFER_MAX_MS = 5200;
const SUCCESS_TILE_STABLE_MS = GAME_TICK_MS;
const MARK_OF_GRACE_OBSTACLE_EXCLUSION_RADIUS_PX = 260;
const MARK_OF_GRACE_PLAYER_RADIUS_PX = 220;
const MARK_OF_GRACE_MAX_SIDE_PX = 45;
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
  14923,
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

const FALADOR_SUCCESS_ZONE_OVERRIDES = [
  {
    afterObjectId: 14901,
    label: "handholds landing roof",
    centerTile: deriveWorldTile(3050, 3357, 3),
    radiusTiles: 2,
  },
  {
    afterObjectId: 14904,
    label: "gap landing roof before second tightrope",
    centerTile: deriveWorldTile(3041, 3361, 3),
    radiusTiles: 2,
  },
  {
    afterObjectId: 14924,
    label: "ledge landing roof before edge",
    centerTile: deriveWorldTile(3019, 3334, 3),
    radiusTiles: 2,
  },
] as const;

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
  { id: 14923, key: "ROOFTOPS_FALADOR_LEDGE_3B", name: "Ledge", x: 3014, y: 3335, z: 3, width: 1, height: 1 },
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

type FaladorCourse = {
  cacheDirectoryPath: string | null;
  targets: FaladorObstacleTarget[];
  missingMapCacheIds: number[];
  successZonesByOrder: ReadonlyMap<number, FaladorSuccessZone>;
  tilesByKey: ReadonlyMap<string, OsrsCacheMapTile>;
};

type FaladorFunctionKey = "loop";

type FaladorSuccessZone = {
  afterOrder: number;
  label: string;
  centerTile: WorldTile;
  radiusTiles: number;
  tiles: WorldTile[];
  source: "map-cache" | "fallback";
};

type PendingObstacleTraversal = {
  order: number;
  clickedAtMs: number;
  minConfirmAtMs: number;
  deadlineMs: number;
  clickedPlayerTile: WorldTile;
  estimatedDistanceTiles: number;
  estimatedWaitMs: number;
};

type FaladorState = BotEngineLoopState<FaladorFunctionKey> & {
  nextClickAllowedAtMs: number;
  lastClickPoint: ScreenPoint | null;
  lastConfirmedObstacleIndex: number | null;
  completedObstacleOrdersThisLap: number[];
  pendingObstacle: PendingObstacleTraversal | null;
  lapIndex: number;
  observedPlayerTile: WorldTile | null;
  playerTileStableSinceMs: number;
  lastStatusLogAtMs: number;
  missingTargetTicks: number;
  loggedStartupCalibration: boolean;
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
  screenPoint: ScreenPoint;
  localPoint: ScreenPoint;
};

type ObstacleOutlineMatch = ProjectedObstacle & {
  outline: AgilityOutlineDetection;
  outlineDistancePx: number;
  reachability: FaladorTargetReachability;
  decisionReason: string;
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
    lapIndex: 1,
    observedPlayerTile: null,
    playerTileStableSinceMs: 0,
    lastStatusLogAtMs: 0,
    missingTargetTicks: 0,
    loggedStartupCalibration: false,
  };
}

function toWorldTileLabel(tile: Pick<WorldTile, "x" | "y" | "z"> | null): string {
  return tile ? `${tile.x},${tile.y},${tile.z}` : "unavailable";
}

function toTargetLabel(target: FaladorObstacleTarget): string {
  return `${target.order + 1}/${FALADOR_ROOFTOP_OBSTACLE_IDS.length} ${target.key} id=${target.id} ${target.name}@${target.x},${target.y},${target.z} size=${target.width}x${target.height} source=${target.source}`;
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

function isSameWorldTile(a: Pick<WorldTile, "x" | "y" | "z"> | null, b: Pick<WorldTile, "x" | "y" | "z"> | null): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
}

function centerTileForRectangle(x: number, y: number, z: number, width: number, height: number): WorldTile {
  return deriveWorldTile(x + Math.floor((Math.max(1, width) - 1) / 2), y + Math.floor((Math.max(1, height) - 1) / 2), z);
}

function getFaladorSuccessZoneOverrideForTarget(
  target: Pick<FaladorObstacleTarget, "id">,
): (typeof FALADOR_SUCCESS_ZONE_OVERRIDES)[number] | null {
  return FALADOR_SUCCESS_ZONE_OVERRIDES.find((zone) => zone.afterObjectId === target.id) ?? null;
}

function collectWalkableTilesNear(
  regionTiles: readonly OsrsCacheMapTile[],
  centerTile: WorldTile,
  radiusTiles: number,
): WorldTile[] {
  return regionTiles
    .filter((tile) => {
      return (
        tile.z === centerTile.z &&
        Math.abs(tile.worldX - centerTile.x) <= radiusTiles &&
        Math.abs(tile.worldY - centerTile.y) <= radiusTiles &&
        !tile.blocked
      );
    })
    .map((tile) => deriveWorldTile(tile.worldX, tile.worldY, tile.z))
    .sort((a, b) => {
      const distanceDelta = tileDistance(a, centerTile) - tileDistance(b, centerTile);
      if (distanceDelta !== 0) {
        return distanceDelta;
      }
      return a.x - b.x || a.y - b.y || a.z - b.z;
    });
}

function buildFaladorSuccessZones(
  targets: readonly FaladorObstacleTarget[],
  regionTiles: readonly OsrsCacheMapTile[],
): ReadonlyMap<number, FaladorSuccessZone> {
  const zones = new Map<number, FaladorSuccessZone>();
  for (const target of targets) {
    const nextTarget = targets[target.order + 1] ?? null;
    if (!nextTarget) {
      continue;
    }

    const override = getFaladorSuccessZoneOverrideForTarget(target);
    const centerTile = override?.centerTile ?? nextTarget.clickTile;
    const radiusTiles = override?.radiusTiles ?? (target.order === 0 ? 6 : OBSTACLE_SUCCESS_NEXT_TARGET_RADIUS_TILES);
    const tiles = collectWalkableTilesNear(regionTiles, centerTile, radiusTiles);
    zones.set(target.order, {
      afterOrder: target.order,
      label: override?.label ?? `near next ${nextTarget.key}`,
      centerTile,
      radiusTiles,
      tiles: tiles.length > 0 ? tiles : [centerTile],
      source: tiles.length > 0 ? "map-cache" : "fallback",
    });
  }

  return zones;
}

function formatSuccessZone(zone: FaladorSuccessZone): string {
  const previewTiles = zone.tiles
    .slice(0, 8)
    .map(toWorldTileLabel)
    .join("|");
  const suffix = zone.tiles.length > 8 ? `|+${zone.tiles.length - 8}` : "";
  return `${zone.afterOrder + 1}:${zone.label} center=${toWorldTileLabel(zone.centerTile)} radius=${zone.radiusTiles} tiles=${zone.tiles.length} source=${zone.source}${previewTiles ? ` [${previewTiles}${suffix}]` : ""}`;
}

function isPlayerInSuccessZone(playerTile: WorldTile, zone: FaladorSuccessZone): boolean {
  if (playerTile.z !== zone.centerTile.z) {
    return false;
  }

  return zone.tiles.some((tile) => isSameWorldTile(tile, playerTile));
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

function getCourseTile(course: FaladorCourse, tile: Pick<WorldTile, "x" | "y" | "z">): OsrsCacheMapTile | null {
  return course.tilesByKey.get(getCourseTileKey(tile)) ?? null;
}

function getCourseTileFlags(course: FaladorCourse, x: number, y: number, z: number): number {
  return getCourseTile(course, { x, y, z })?.flags ?? CollisionFlag.Blocked;
}

function isCourseTileBlocked(course: FaladorCourse, x: number, y: number, z: number): boolean {
  return (getCourseTileFlags(course, x, y, z) & CollisionFlag.Blocked) !== 0;
}

function canMoveWithinCourse(
  course: FaladorCourse,
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

function getTargetInteractionCandidateTiles(course: FaladorCourse, target: FaladorObstacleTarget): WorldTile[] {
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
  course: FaladorCourse,
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
  course: FaladorCourse,
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

function getNextTargetIndexFromSuccessZone(
  course: FaladorCourse,
  playerTile: WorldTile,
  options: FaladorCacheTargetDecisionOptions,
): { index: number; zone: FaladorSuccessZone } | null {
  const zones = [...course.successZonesByOrder.values()].sort((a, b) => b.afterOrder - a.afterOrder);
  for (const zone of zones) {
    if (!isPlayerInSuccessZone(playerTile, zone)) {
      continue;
    }

    const nextIndex = zone.afterOrder + 1;
    if (course.targets[nextIndex] && isTargetOrderAllowed(nextIndex, options)) {
      return { index: nextIndex, zone };
    }
  }

  return null;
}

function getStateCacheTargetDecisionOptions(
  state: FaladorState,
  course: FaladorCourse,
  playerTile: WorldTile,
): FaladorCacheTargetDecisionOptions {
  if (playerTile.z === FALADOR_ENTRY_TILE.z) {
    return { minOrder: 0, maxOrder: 0 };
  }

  const lastConfirmed = state.lastConfirmedObstacleIndex;
  if (lastConfirmed !== null) {
    const nextOrder = lastConfirmed + 1;
    return nextOrder < course.targets.length ? { minOrder: nextOrder, maxOrder: nextOrder } : { minOrder: course.targets.length };
  }

  const lastCompleted = state.completedObstacleOrdersThisLap[state.completedObstacleOrdersThisLap.length - 1];
  if (lastCompleted !== undefined) {
    const nextOrder = lastCompleted + 1;
    return nextOrder < course.targets.length ? { minOrder: nextOrder, maxOrder: nextOrder } : { minOrder: course.targets.length };
  }

  return {};
}

function pickCacheTargetDecision(
  course: FaladorCourse,
  playerTile: WorldTile,
  options: FaladorCacheTargetDecisionOptions = {},
): FaladorCacheTargetDecision | null {
  const entryTarget = course.targets[0];
  if (playerTile.z === FALADOR_ENTRY_TILE.z && entryTarget) {
    if (!isTargetOrderAllowed(entryTarget.order, options)) {
      return null;
    }

    const reachability = getTargetReachability(course, playerTile, entryTarget);
    return reachability.reachable
      ? {
          target: entryTarget,
          reachability,
          reason: "ground-entry",
        }
      : null;
  }

  if (playerTile.z !== COURSE_Z) {
    return null;
  }

  const zoneNext = getNextTargetIndexFromSuccessZone(course, playerTile, options);
  if (zoneNext) {
    const target = course.targets[zoneNext.index];
    const reachability = getTargetReachability(course, playerTile, target);
    return reachability.reachable
      ? {
          target,
          reachability,
          reason: `landing-zone-after-${zoneNext.zone.afterOrder + 1}:${zoneNext.zone.label}`,
        }
      : null;
  }

  const candidates = course.targets
    .filter((target) => target.z === COURSE_Z && isTargetOrderAllowed(target.order, options))
    .map((target) => ({
      target,
      reachability: getTargetReachability(course, playerTile, target),
      distance: distanceToTargetRectangle(playerTile, target),
    }))
    .filter((entry) => entry.reachability.reachable)
    .sort((a, b) => {
      const pathDelta = (a.reachability.pathTiles ?? 4096) - (b.reachability.pathTiles ?? 4096);
      if (pathDelta !== 0) {
        return pathDelta;
      }

      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }

      return a.target.order - b.target.order;
    });

  const best = candidates[0] ?? null;
  return best
    ? {
        target: best.target,
        reachability: best.reachability,
        reason: `nearest-cache-reachable distance=${best.distance}`,
      }
    : null;
}

function isCacheDecisionPastPending(decision: FaladorCacheTargetDecision | null, pending: PendingObstacleTraversal): boolean {
  return decision !== null && decision.target.order > pending.order;
}

function formatCacheTargetDecision(decision: FaladorCacheTargetDecision | null): string {
  return decision
    ? `${toTargetLabel(decision.target)} reason=${decision.reason} ${formatTargetReachability(decision.reachability)}`
    : "none";
}

function formatAllowedTargetReachability(state: FaladorState, tick: FaladorTickCapture): string {
  const playerTile = tick.playerTile;
  if (!playerTile) {
    return "unavailable";
  }

  return formatCacheTargetDecision(
    pickCacheTargetDecision(tick.course, playerTile, getStateCacheTargetDecisionOptions(state, tick.course, playerTile)),
  );
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

  return {
    cacheDirectoryPath,
    targets,
    missingMapCacheIds,
    successZonesByOrder: buildFaladorSuccessZones(targets, regionTiles),
    tilesByKey: buildCourseTilesByKey(regionTiles),
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
): ProjectedObstacle | null {
  const screenPoint = projectWorldTileToScreen(calibration, playerTile, target.clickTile);
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

  return { target, screenPoint, localPoint };
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

function getAllowedTargetIndicesForPlayer(
  state: FaladorState,
  playerTile: WorldTile,
  targets: readonly FaladorObstacleTarget[],
): number[] {
  const completedOrders = new Set(state.completedObstacleOrdersThisLap);
  if (playerTile.z === 0) {
    return completedOrders.has(0) ? [] : [0];
  }

  if (playerTile.z !== COURSE_Z) {
    return [];
  }

  if (state.lastConfirmedObstacleIndex !== null) {
    const nextIndex = state.lastConfirmedObstacleIndex + 1;
    const nextTarget = targets[nextIndex];
    return nextTarget && nextTarget.z === playerTile.z && !completedOrders.has(nextIndex) ? [nextIndex] : [];
  }

  return targets
    .map((target, index) => ({ index, distance: distanceToTargetRectangle(playerTile, target) }))
    .filter((entry) => Number.isFinite(entry.distance) && !completedOrders.has(entry.index))
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.index);
}

function getOutlineDistance(outline: AgilityOutlineDetection, point: ScreenPoint): number {
  return Math.max(Math.abs(outline.centerX - point.x), Math.abs(outline.centerY - point.y));
}

function getOutlineMatchRadiusForTarget(target: FaladorObstacleTarget): number {
  return target.order === 0 && target.z === FALADOR_ENTRY_TILE.z ? ENTRY_OUTLINE_MATCH_RADIUS_PX : OUTLINE_MATCH_RADIUS_PX;
}

function pickObstacleOutlineNearProjection(
  tick: FaladorTickCapture,
  projected: ProjectedObstacle,
): { outline: AgilityOutlineDetection; distance: number } | null {
  if (!tick.bitmap) {
    return null;
  }

  const candidates = tick.outlines.filter((outline) => {
    return (
      isClickableOutline(outline, tick.bitmap!) &&
      getOutlineDistance(outline, projected.localPoint) <= getOutlineMatchRadiusForTarget(projected.target)
    );
  });
  const outline = pickNearestAgilityOutlineToPoint(
    candidates,
    projected.localPoint,
    getOutlineMatchRadiusForTarget(projected.target),
  );
  return outline ? { outline, distance: getOutlineDistance(outline, projected.localPoint) } : null;
}

function findObstacleOutlineMatches(state: FaladorState, tick: FaladorTickCapture): ObstacleOutlineMatch[] {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  const bitmap = tick.bitmap;
  if (!calibration || !playerTile || !bitmap) {
    return [];
  }

  const cacheDecision = pickCacheTargetDecision(
    tick.course,
    playerTile,
    getStateCacheTargetDecisionOptions(state, tick.course, playerTile),
  );
  if (!cacheDecision) {
    return [];
  }

  const matches: ObstacleOutlineMatch[] = [];
  const target = cacheDecision.target;

  const projected = projectObstacleTarget(calibration, playerTile, target);
  if (!projected) {
    return [];
  }

  const matchedOutline = pickObstacleOutlineNearProjection(tick, projected);
  if (!matchedOutline) {
    return [];
  }

  matches.push({
    ...projected,
    outline: matchedOutline.outline,
    outlineDistancePx: matchedOutline.distance,
    reachability: cacheDecision.reachability,
    decisionReason: cacheDecision.reason,
  });

  return matches;
}

function pickBestObstacleMatch(state: FaladorState, tick: FaladorTickCapture): ObstacleOutlineMatch | null {
  const playerTile = tick.playerTile;
  if (!playerTile) {
    return null;
  }

  const matches = findObstacleOutlineMatches(state, tick);
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

function getProjectedObstacleLocalPoints(tick: FaladorTickCapture): ScreenPoint[] {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  if (!calibration || !playerTile) {
    return [];
  }

  return tick.course.targets
    .map((target) => projectObstacleTarget(calibration, playerTile, target)?.localPoint ?? null)
    .filter((point): point is ScreenPoint => point !== null);
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

function pickMarkOfGraceRedOutline(tick: FaladorTickCapture): AgilityOutlineDetection | null {
  const calibration = tick.calibration;
  const playerTile = tick.playerTile;
  const bitmap = tick.bitmap;
  if (!calibration || !playerTile || !bitmap || playerTile.z !== COURSE_Z) {
    return null;
  }

  const obstaclePoints = getProjectedObstacleLocalPoints(tick);
  const playerAnchor = getPlayerLocalAnchor(calibration);
  const markCandidates = tick.outlines.filter((outline) => {
    if (outline.color !== "red" || !isClickableOutline(outline, bitmap) || !isLikelyObjectOutline(outline)) {
      return false;
    }

    if (outline.width > MARK_OF_GRACE_MAX_SIDE_PX || outline.height > MARK_OF_GRACE_MAX_SIDE_PX || outline.pixelCount > 700) {
      return false;
    }

    if (getOutlineDistance(outline, playerAnchor) > MARK_OF_GRACE_PLAYER_RADIUS_PX) {
      return false;
    }

    if (isOutlineOnCacheObstacle(tick, outline)) {
      return false;
    }

    return obstaclePoints.every((point) => getOutlineDistance(outline, point) > MARK_OF_GRACE_OBSTACLE_EXCLUSION_RADIUS_PX);
  });
  return pickNearestAgilityOutlineToPoint(markCandidates, playerAnchor, Math.max(bitmap.width, bitmap.height));
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

function hasStableTraversalProgress(
  state: FaladorState,
  pending: PendingObstacleTraversal,
  nowMs: number,
  playerTile: WorldTile,
): boolean {
  return (
    nowMs >= pending.minConfirmAtMs &&
    playerTile.z === COURSE_Z &&
    !isSameWorldTile(playerTile, pending.clickedPlayerTile) &&
    getTraversalProgressDistance(pending, playerTile) >= OBSTACLE_PROGRESS_CONFIRM_MIN_TILES &&
    isPlayerTileStableForSuccess(state, nowMs, playerTile)
  );
}

function getDeadlineProgressConfirmTiles(pending: PendingObstacleTraversal): number {
  return Math.max(OBSTACLE_PROGRESS_CONFIRM_MIN_TILES, Math.min(6, Math.ceil(pending.estimatedDistanceTiles * 0.6)));
}

function hasDeadlineTraversalProgress(pending: PendingObstacleTraversal, playerTile: WorldTile): boolean {
  return playerTile.z === COURSE_Z && getTraversalProgressDistance(pending, playerTile) >= getDeadlineProgressConfirmTiles(pending);
}

function hasPendingObstacleTraversalSucceeded(
  state: FaladorState,
  course: FaladorCourse,
  pending: PendingObstacleTraversal,
  nowMs: number,
  playerTile: WorldTile,
): boolean {
  const target = course.targets[pending.order];
  if (!target) {
    return false;
  }

  if (isFinalCourseObstacle(course, target.order)) {
    return playerTile.z === FALADOR_ENTRY_TILE.z && isPlayerTileStableForSuccess(state, nowMs, playerTile);
  }

  const successZone = course.successZonesByOrder.get(target.order);
  if (!successZone || playerTile.key === pending.clickedPlayerTile.key) {
    return hasStableTraversalProgress(state, pending, nowMs, playerTile);
  }

  return (
    (isPlayerInSuccessZone(playerTile, successZone) && isPlayerTileStableForSuccess(state, nowMs, playerTile)) ||
    hasStableTraversalProgress(state, pending, nowMs, playerTile)
  );
}

function formatPendingObstacleTraversal(course: FaladorCourse, pending: PendingObstacleTraversal): string {
  const target = course.targets[pending.order];
  const nextTarget = getNextCourseTarget(course, pending.order);
  const successZone = course.successZonesByOrder.get(pending.order);
  return `${target ? toTargetLabel(target) : `order=${pending.order}`} next=${nextTarget ? toTargetLabel(nextTarget) : "lap-complete"} successZone=${successZone ? formatSuccessZone(successZone) : "ground-plane"} clickedFrom=${toWorldTileLabel(pending.clickedPlayerTile)} estimateDistance=${pending.estimatedDistanceTiles}tiles estimateWait=${pending.estimatedWaitMs}ms`;
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
      `${BOT_LOG_PREFIX}: confirmed lap ${state.lapIndex} complete after ${toTargetLabel(target)}; player=${toWorldTileLabel(playerTile)}. Next lap can use the entry obstacle again after ${nextDelayMs}ms.`,
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

  const confirmedThroughOrder =
    nextReachableTarget && nextReachableTarget.order > target.order
      ? Math.min(course.targets.length - 1, nextReachableTarget.order - 1)
      : target.order;
  const completedOrders = addCompletedObstacleOrderRange(
    state.completedObstacleOrdersThisLap,
    target.order,
    confirmedThroughOrder,
  );
  const skippedDetails =
    confirmedThroughOrder > target.order && nextReachableTarget
      ? ` advancedThrough=${confirmedThroughOrder + 1}/${
          course.targets.length
        } because cache already sees nextReachable=${toTargetLabel(nextReachableTarget)}`
      : "";
  logWithDelta(
    `${BOT_LOG_PREFIX}: confirmed traversal of ${toTargetLabel(target)}; player=${toWorldTileLabel(
      playerTile,
    )}${skippedDetails} completedThisLap=${completedOrders.map((order) => order + 1).join(",")} nextClickDelay=${nextDelayMs}ms.`,
  );
  return {
    ...state,
    pendingObstacle: null,
    lastConfirmedObstacleIndex: confirmedThroughOrder,
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

  const cacheDecision = pickCacheTargetDecision(tick.course, playerTile, { minOrder: pending.order + 1 });
  if (cacheDecision && isCacheDecisionPastPending(cacheDecision, pending) && isPlayerTileStableForSuccess(state, nowMs, playerTile)) {
    logWithDelta(
      `${BOT_LOG_PREFIX}: confirmed traversal by cache next-target decision. ${formatPendingObstacleTraversal(
        tick.course,
        pending,
      )} player=${toWorldTileLabel(playerTile)} cacheTarget=${formatCacheTargetDecision(cacheDecision)}.`,
    );
    return {
      state: confirmPendingObstacleTraversal(state, tick.course, pending, nowMs, playerTile, cacheDecision.target),
      handled: true,
    };
  }

  if (hasPendingObstacleTraversalSucceeded(state, tick.course, pending, nowMs, playerTile)) {
    return {
      state: confirmPendingObstacleTraversal(state, tick.course, pending, nowMs, playerTile, cacheDecision?.target ?? null),
      handled: true,
    };
  }

  const successZone = tick.course.successZonesByOrder.get(pending.order);
  const inSuccessZone = successZone ? isPlayerInSuccessZone(playerTile, successZone) : playerTile.z === FALADOR_ENTRY_TILE.z;
  const stableMs = getPlayerTileStableMs(state, nowMs, playerTile);
  const progressDistance = getTraversalProgressDistance(pending, playerTile);
  if (nowMs < pending.minConfirmAtMs) {
    return {
      state: withStatusLog(
        state,
        nowMs,
        `${BOT_LOG_PREFIX}: waiting for map-cache traversal time before next click. ${formatPendingObstacleTraversal(
          tick.course,
          pending,
        )} player=${toWorldTileLabel(playerTile)} inSuccessZone=${inSuccessZone} stableFor=${stableMs}ms progress=${progressDistance}tiles remaining=${Math.max(0, pending.minConfirmAtMs - nowMs)}ms.`,
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
        )} player=${toWorldTileLabel(playerTile)} inSuccessZone=${inSuccessZone} stableFor=${stableMs}ms requiredStable=${SUCCESS_TILE_STABLE_MS}ms progress=${progressDistance}tiles progressRequired=${OBSTACLE_PROGRESS_CONFIRM_MIN_TILES}tiles deadlineIn=${Math.max(0, pending.deadlineMs - nowMs)}ms.`,
      ),
      handled: true,
    };
  }

  const deadlineProgressRequired = getDeadlineProgressConfirmTiles(pending);
  if (!isFinalCourseObstacle(tick.course, pending.order) && hasDeadlineTraversalProgress(pending, playerTile)) {
    logWithDelta(
      `${BOT_LOG_PREFIX}: confirmed traversal at deadline by rooftop progress. ${formatPendingObstacleTraversal(
        tick.course,
        pending,
      )} player=${toWorldTileLabel(playerTile)} progress=${progressDistance}tiles progressRequired=${deadlineProgressRequired}tiles.`,
    );
    return {
      state: confirmPendingObstacleTraversal(state, tick.course, pending, nowMs, playerTile, cacheDecision?.target ?? null),
      handled: true,
    };
  }

  const retryDelayMs = randomIntInclusive(CLICK_INTERVAL_MIN_MS, CLICK_INTERVAL_MAX_MS);
  warnWithDelta(
    `${BOT_LOG_PREFIX}: traversal was not confirmed before deadline; allowing retry because success was not proven. ${formatPendingObstacleTraversal(
      tick.course,
      pending,
    )} player=${toWorldTileLabel(playerTile)} retryDelay=${retryDelayMs}ms.`,
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

function saveFaladorClickDebugImage(
  tick: FaladorTickCapture,
  outline: AgilityOutlineDetection,
  clickedLocal: ScreenPoint,
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
      type: "box",
      x: outline.x,
      y: outline.y,
      width: outline.width,
      height: outline.height,
      color: getOutlineDebugColor(outline),
      thickness: 3,
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
      color: { r: 0, g: 255, b: 255 },
      thickness: 3,
    },
  ];

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
): Promise<{ state: FaladorState; clicked: ScreenPoint }> {
  const calibration = tick.calibration!;
  const clickPoint = pickBoxInteractionScreenPoint(outline, calibration.captureBounds, {
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
  const clickDebugPath = saveFaladorClickDebugImage(tick, outline, clickedLocal);

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

  const pendingResult = resolvePendingObstacleTraversal(state, tickCapture, nowMs);
  state = pendingResult.state;
  if (pendingResult.handled) {
    return state;
  }

  if (nowMs < state.nextClickAllowedAtMs) {
    return state;
  }

  const obstacleMatch = pickBestObstacleMatch(state, tickCapture);
  if (!obstacleMatch) {
    const markOfGrace = pickMarkOfGraceRedOutline(tickCapture);
    if (markOfGrace) {
      const result = await clickOutline(state, tickCapture, markOfGrace, "red Mark of Grace");
      return result.state;
    }

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
      `${BOT_LOG_PREFIX}: cache selected no clickable obstacle outline confirmation. player=${toWorldTileLabel(playerTile)}${groundStartDetails} cacheTarget=${formatAllowedTargetReachability(state, tickCapture)} outlines=${tickCapture.outlines.map(formatAgilityOutline).join("; ") || "none"} missing=${state.missingTargetTicks + 1}.`,
    );
  }

  const result = await clickOutline(
    state,
    tickCapture,
    obstacleMatch.outline,
    `cache-selected rooftop obstacle ${toTargetLabel(obstacleMatch.target)} decision=${obstacleMatch.decisionReason} projectedLocal=${obstacleMatch.localPoint.x},${obstacleMatch.localPoint.y} outlineColor=${obstacleMatch.outline.color} outlineDistance=${obstacleMatch.outlineDistancePx}px ${formatTargetReachability(obstacleMatch.reachability)}`,
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
      `${BOT_LOG_PREFIX}: loaded ${course.targets.length} rooftop course object(s) from region ${FALADOR_REGION_X},${FALADOR_REGION_Y}; cache=${course.cacheDirectoryPath ?? "fallback-only"} mapTiles=${course.tilesByKey.size} missingMapCacheIds=${course.missingMapCacheIds.join(",") || "none"}.`,
    );
    logWithDelta(`${BOT_LOG_PREFIX}: course order ${course.targets.map(toTargetLabel).join(" -> ")}.`);
    logWithDelta(`${BOT_LOG_PREFIX}: success zones ${[...course.successZonesByOrder.values()].map(formatSuccessZone).join(" -> ")}.`);

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
