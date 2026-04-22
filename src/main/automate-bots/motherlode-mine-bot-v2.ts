import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { keyToggle, mouseClick, moveMouse, scrollMouse } from "robotjs";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap } from "../windowsScreenCapture";
import { MINING_MOTHERLODE_MINE_V2_BOT_ID } from "./definitions";
import {
  MotherlodeMineBox,
  detectMotherlodeMineBoxesInScreenshot,
  saveBitmapWithMotherlodeMineBoxes,
} from "./shared/motherlode-mine-box-detector";
import {
  MotherlodeBagFullState,
  detectMotherlodeBagFullBoxInScreenshot,
} from "./shared/motherlode-bag-full-box-detector";
import { MotherlodeBagStats, detectMotherlodeBagStatsInScreenshot } from "./shared/motherlode-bag-stats-detector";
import {
  MotherlodeDepositBox,
  detectBestMotherlodeDepositBoxInScreenshot,
  saveBitmapWithMotherlodeDepositBoxes,
} from "./shared/motherlode-deposit-box-detector";
import {
  MotherlodeObstacleRedBox,
  detectBestMotherlodeObstacleRedBoxInScreenshot,
  saveBitmapWithMotherlodeObstacleRedBoxes,
} from "./shared/motherlode-obstacle-red-detector";
import {
  MotherlodeBankingYellowBox,
  detectMotherlodeBankingYellowBoxesInScreenshot,
  saveBitmapWithMotherlodeBankingYellowBoxes,
} from "./shared/motherlode-banking-yellow-detector";
import {
  MotherlodeBankingGreenBox,
  detectMotherlodeBankingGreenBoxesInScreenshot,
} from "./shared/motherlode-banking-green-detector";
import {
  BankDepositOrbDetection,
  BankDepositOrbDetectorResult,
  detectBankDepositIconWithOrb,
  saveBitmapWithBankDepositOrbDetection,
} from "./shared/bank-deposit-orb-detector";
import { isPlayerCollidingWithObstacle as isPlayerCollidingWithObstacleBox } from "./shared/player-obstacle-collision";
import { PlayerBox, detectBestPlayerBoxInScreenshot, saveBitmapWithPlayerBoxes } from "./shared/player-box-detector";
import { selectNearestGreenMotherlodeNode } from "./shared/motherlode-target-selection";
import { screen as electronScreen } from "electron";
import { detectTileLocationBoxInScreenshot } from "./shared/tile-location-detection";
import { detectOverlayBoxInScreenshot } from "./shared/coordinate-box-detector";
import { RobotBitmap } from "./shared/ocr-engine";

const BOT_NAME = "Motherlode Mine V2";
const DEBUG_DIR = "ocr-debug";
const CAMERA_SCROLL_TICKS = 35;
const CAMERA_SCROLL_DELTA_Y = 120;
const NORTH_KEY_HOLD_MS = 100;

const GAME_TICK_MS = 600;
const BASE_TICK_MS = GAME_TICK_MS;
const TOOLTIP_SETTLE_MS = 400;
const ENABLE_TILE_LOCATION_DETECTION = false;
const ENABLE_NODE_HOVER_BEFORE_TILE_READ = true;
const ENABLE_OBSTACLE_RED_CLICK = true;
const POST_CLICK_MOUSE_MOVE_MODE: PostClickMouseMoveMode = "offset-200";
const POST_CLICK_MOUSE_OFFSET_PX = 200;
const POST_CLICK_CORNER_MARGIN_PX = 6;
const OBSTACLE_PLAYER_COLLISION_PADDING_PX = 4;
const DEPOSIT_PLAYER_NEAR_RADIUS_PX = 48;
const DEPOSIT_OBSTACLE_PATH_PLAYER_RADIUS_PX = 52;
const DEPOSIT_OBSTACLE_PATH_DEPOSIT_RADIUS_PX = 52;
const DEPOSIT_OBSTACLE_PATH_ROUTE_PADDING_PX = 42;

const DEPOSIT_TRIGGER_STABLE_TICKS = 2;
const NODE_CLICK_LOCK_TICKS = 3;
const OBSTACLE_CLICK_LOCK_TICKS = 2;
const DEPOSIT_CLICK_LOCK_TICKS = 1;
const BANK_CLICK_LOCK_TICKS = 1;
const BANK_POST_ORANGE_WAIT_TICKS = 3;
const BANK_SOUTH_CLICK_LOCK_TICKS = 1;
const BANK_SOUTH_POST_CLICK_SETTLE_TICKS = 1;
const BANK_YELLOW_TILE_CLICK_LOCK_TICKS = 2;
const BANK_YELLOW_POST_CLICK_EXTRA_TICKS = 1;
const BANK_YELLOW_WALK_WAIT_MAX_TICKS = 10;
const BANK_YELLOW_SACK_WAIT_MAX_TICKS = 8;
const BANK_GREEN_CLICK_LOCK_TICKS = 1;
const BANK_GREEN_POST_CLICK_EXTRA_TICKS = 1;
const BANK_GREEN_WALK_WAIT_MAX_TICKS = 10;
const BANK_ORB_CLICK_LOCK_TICKS = 2;
const BANK_ORB_CONFIRM_CLICK_COUNT = 3;
const BANK_ORB_CACHED_RETRY_MAX = 2;
const BANK_ORB_BAG_STATS_FAIL_MAX_TICKS = 10;
const BANK_ORB_STABLE_TICKS = 2;
const BANK_ORB_STABLE_DISTANCE_PX = 32;
const BANK_ORB_MIN_CENTER_Y_RATIO = 0.45;
const BANK_ORB_LOCAL_SEARCH_BOX_PX = 200;
const BANK_PLAYER_SPEED_TILES_PER_TICK = 2;
const BANK_TILE_PX_FALLBACK = 64;
const BANK_TILE_PX_MIN = 24;
const BANK_TILE_PX_MAX = 96;
const BANK_SOUTH_CLICK_RANDOM_RADIUS_PX = 14;
const BANK_SOUTH_RECLICK_WAIT_MAX_TICKS = 5;
const BANK_SOUTHWEST_CLICK_OFFSET_TILES_X = -1.15;
const BANK_SOUTHWEST_CLICK_OFFSET_TILES_Y = 2.25;
const BANK_SOUTHWEST_CLICK_RANDOM_TILE_RADIUS = 0.28;
const BANK_EXPECTED_LADDER_DOWN_X = 3755;
const BANK_EXPECTED_LADDER_DOWN_Y = 5672;
const BANK_LADDER_RECHECK_MAX = 2;
const BANK_LADDER_RECHECK_WAIT_MIN_TICKS = 2;
const BANK_LADDER_RECHECK_WAIT_MAX_TICKS = 4;
const BANK_EXPECTED_LADDER_UP_X = 3755;
const BANK_EXPECTED_LADDER_UP_Y = 5675;
const BANK_LADDER_UP_RECHECK_MAX = 2;
const BANK_LADDER_UP_RECHECK_WAIT_MIN_TICKS = 2;
const BANK_LADDER_UP_RECHECK_WAIT_MAX_TICKS = 4;
const BANK_RETURN_TO_SEARCH_AFTER_ORANGE_TICKS = 4;
const BANK_RETURN_TO_SEARCH_WAIT_MAX_TICKS = 16;
const BANK_MOVE_MARGIN_PX = 8;
const DEPOSIT_NEAR_STABLE_TICKS = 2;
const DEPOSIT_STUCK_RETRY_TICKS = 3;
const DEPOSIT_PROGRESS_EPSILON_PX = 2;
const ACTIVE_NODE_MISSING_GRACE_TICKS = 2;
const ACTIVE_NODE_MAX_WAIT_TICKS_MIN = 80;
const ACTIVE_NODE_MAX_WAIT_TICKS_MAX = 86;
const ACTIVE_NODE_MATCH_RADIUS_PX = 34;
const ACTIVE_NODE_YELLOW_PREFERENCE_MARGIN_PX = 6;
const BANK_ORANGE_TARGET_R = 255;
const BANK_ORANGE_TARGET_G = 125;
const BANK_ORANGE_TARGET_B = 0;
const BANK_ORANGE_R_TOLERANCE = 10;
const BANK_ORANGE_G_TOLERANCE = 18;
const BANK_ORANGE_B_TOLERANCE = 20;
const BANK_ORANGE_MIN_COMPONENT_PIXELS = 40;
const BOX_CLICK_INNER_RATIO = 0.75;
const BOX_CLICK_PICK_MAX_ATTEMPTS = 12;
const BANK_DEPOSIT_ORB_REFERENCE_ICON = "test-images/icon/bank-deposit/bank-deposit-icon.png";

interface ScreenCaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TileCoord {
  x: number;
  y: number;
  z: number;
}

type HoverTileReadSource = "tile-location" | "overlay" | "none";
type PostClickMouseMoveMode = "off" | "top-left" | "offset-200";
type BotPhase = "searching" | "mining" | "depositing" | "descending-to-bank" | "banking" | "ascending-to-mine";
type MineTickDebugCaptureLabel = "search" | "mine" | "bank" | "bank-ladder";
type TickDebugCaptureLabel = MineTickDebugCaptureLabel | "deposit";
type BankingStep =
  | "find-orange"
  | "wait-after-orange"
  | "wait-after-return-orange"
  | "wait-after-orb-click"
  | "move-south-until-yellow"
  | "yellow-clicked"
  | "green-clicked"
  | "wait-for-orb";

type HoverTileReadResult = {
  tile: TileCoord | null;
  source: HoverTileReadSource;
  rawLine: string | null;
};

type BankSouthMovePlan = {
  point: { x: number; y: number };
  tilePx: number;
  dxPx: number;
  dyPx: number;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  etaTicks: number;
};

type BankTargetTravelEstimate = {
  tilePx: number;
  dxPx: number;
  dyPx: number;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  etaTicks: number;
};

const DEBUG_TICK_CAPTURE_ENABLED: Record<TickDebugCaptureLabel, boolean> = {
  search: false,
  mine: false,
  deposit: true,
  bank: true,
  "bank-ladder": true,
};

type BotState = {
  phase: BotPhase;
  activeTile: TileCoord | null;
  activeScreen: { x: number; y: number } | null;
  missingActiveTicks: number;
  miningWaitTicks: number;
  activeNodeMaxWaitTicks: number;
  bagFullState: MotherlodeBagFullState | null;
  depositTriggerStableTicks: number;
  depositNearStableTicks: number;
  depositRetryTicks: number;
  depositInFlight: boolean;
  depositLastDistancePx: number | null;
  actionLockUntilMs: number;
  bankingStep: BankingStep;
  bankValidateStartTile: boolean;
  bankSouthClicks: number;
  bankSouthWaitUntilMs: number;
  bankYellowPreClickSackCount: number | null;
  bankYellowSackWaitTicks: number;
  bankLadderRecheckCount: number;
  bankOrbClickCount: number;
  bankOrbCandidateCenter: { x: number; y: number } | null;
  bankOrbStableTicks: number;
  bankOrbCachedLocalPoint: { x: number; y: number } | null;
  bankOrbCachedRetryCount: number;
  bankOrbLastClickUsedCache: boolean;
  bankOrbBagStatsFailTicks: number;
  loopIndex: number;
};

type MineCaptureResult = {
  bitmap: RobotBitmap;
  boxes: MotherlodeMineBox[];
  greenBoxes: MotherlodeMineBox[];
  orangeBoxes: OrangeTargetBox[];
  bankingYellowBoxes: MotherlodeBankingYellowBox[];
  bankingGreenBoxes: MotherlodeBankingGreenBox[];
  obstacleBox: MotherlodeObstacleRedBox | null;
  playerBoxInCapture: PlayerBox | null;
  playerAnchorInCapture: { x: number; y: number } | null;
  playerTileFromOverlay: TileCoord | null;
  bagFullState: MotherlodeBagFullState;
  bagStats: MotherlodeBagStats | null;
};

type DepositCaptureResult = {
  bitmap: RobotBitmap;
  depositBox: MotherlodeDepositBox | null;
  obstacleBox: MotherlodeObstacleRedBox | null;
  playerBoxInCapture: PlayerBox | null;
  playerAnchorInCapture: { x: number; y: number } | null;
  bagFullState: MotherlodeBagFullState;
};

type OrangeTargetBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
};

let isLoopRunning = false;
let startedAtMs: number | null = null;
let debugCaptureIndex = 0;
let lastClickPoint: { x: number; y: number } | null = null;
let currentWindowsScalePercent = 100;
let bankDepositOrbReferenceBitmap: RobotBitmap | null = null;
let bankDepositOrbReferencePath: string | null = null;
let bankDepositOrbReferenceLoadAttempted = false;
let currentLogLoopIndex = 0;

function formatElapsedSinceStart(): string {
  if (startedAtMs === null) return "+0ms";
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const ms = String(elapsedMs % 1000).padStart(3, "0");
  return `+${mm}:${ss}.${ms}`;
}

function setCurrentLogLoopIndex(loopIndex: number): void {
  if (!Number.isFinite(loopIndex) || loopIndex < 0) {
    currentLogLoopIndex = 0;
    return;
  }

  currentLogLoopIndex = Math.floor(loopIndex);
}

function withLoopCountAtBeginning(message: string): string {
  const alreadyPrefixed = message.match(/^#\d+\s/);
  if (alreadyPrefixed) {
    return message;
  }

  const embeddedLoop = message.match(/^(Automate Bot \([^)]*\):)\s*#(\d+)\s*(.*)$/);
  if (embeddedLoop) {
    const [, prefix, loop, rest] = embeddedLoop;
    return `#${loop} ${prefix} ${rest}`.trimEnd();
  }

  return `#${currentLogLoopIndex} ${message}`;
}

function log(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] ${withLoopCountAtBeginning(message)}`);
}

function warn(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] ${withLoopCountAtBeginning(message)}`);
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
    warn(
      `Automate Bot (${BOT_NAME}): bank deposit orb reference icon not found (${BANK_DEPOSIT_ORB_REFERENCE_ICON}). Orb click step will wait until icon is available.`,
    );
    return null;
  }

  try {
    const pngBuffer = fs.readFileSync(referencePath);
    const pngSync = (PNG as unknown as { sync?: { read: (buffer: Buffer) => PNG } }).sync;
    if (!pngSync) {
      warn(`Automate Bot (${BOT_NAME}): pngjs sync API unavailable; cannot load bank deposit orb reference.`);
      return null;
    }

    const png = pngSync.read(pngBuffer);
    bankDepositOrbReferenceBitmap = toRobotBitmapFromPng(png);
    bankDepositOrbReferencePath = referencePath;
    log(
      `Automate Bot (${BOT_NAME}): bank deposit orb reference loaded (${bankDepositOrbReferenceBitmap.width}x${bankDepositOrbReferenceBitmap.height}) from ${referencePath}.`,
    );
    return bankDepositOrbReferenceBitmap;
  } catch (error) {
    warn(
      `Automate Bot (${BOT_NAME}): failed to load bank deposit orb reference icon at ${referencePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function formatCollisionBox(box: { x: number; y: number; width: number; height: number }): string {
  return `(${box.x},${box.y}) ${box.width}x${box.height}`;
}

function formatPoint(point: { x: number; y: number } | null): string {
  return point ? `(${point.x},${point.y})` : "missing";
}

function sanitizeDebugToken(token: string): string {
  const normalized = token
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

function buildCollisionDebugSummary(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
  paddingPx: number,
): string {
  if (!playerBoxInCapture || !obstacleBox) {
    return `player=${playerBoxInCapture ? formatCollisionBox(playerBoxInCapture) : "missing"}, obstacle=${obstacleBox ? formatCollisionBox(obstacleBox) : "missing"}, padding=${paddingPx}`;
  }

  const playerLeft = playerBoxInCapture.x;
  const playerTop = playerBoxInCapture.y;
  const playerRight = playerBoxInCapture.x + playerBoxInCapture.width - 1;
  const playerBottom = playerBoxInCapture.y + playerBoxInCapture.height - 1;

  const obstacleLeft = obstacleBox.x - paddingPx;
  const obstacleTop = obstacleBox.y - paddingPx;
  const obstacleRight = obstacleBox.x + obstacleBox.width - 1 + paddingPx;
  const obstacleBottom = obstacleBox.y + obstacleBox.height - 1 + paddingPx;

  const overlapLeft = Math.max(playerLeft, obstacleLeft);
  const overlapTop = Math.max(playerTop, obstacleTop);
  const overlapRight = Math.min(playerRight, obstacleRight);
  const overlapBottom = Math.min(playerBottom, obstacleBottom);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft + 1);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop + 1);
  const overlapArea = overlapWidth * overlapHeight;

  return [
    `player=${formatCollisionBox(playerBoxInCapture)}`,
    `obstacle=${formatCollisionBox(obstacleBox)}`,
    `obstacle+p=${formatCollisionBox({
      x: obstacleLeft,
      y: obstacleTop,
      width: obstacleRight - obstacleLeft + 1,
      height: obstacleBottom - obstacleTop + 1,
    })}`,
    `overlap=${overlapWidth}x${overlapHeight}`,
    `area=${overlapArea}`,
    `padding=${paddingPx}`,
  ].join(", ");
}

function saveCollisionDebugArtifacts(
  phase: BotPhase,
  loopIndex: number,
  clearReason: string,
  bitmap: RobotBitmap,
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): void {
  const reasonToken = sanitizeDebugToken(clearReason);
  const base = path.join(DEBUG_DIR, `collision-${phase}-loop${loopIndex}-${reasonToken}`);
  const obstaclePath = `${base}-obstacle.png`;
  const playerPath = `${base}-player.png`;

  saveBitmapWithMotherlodeObstacleRedBoxes(bitmap, obstacleBox ? [obstacleBox] : [], obstaclePath);
  void saveBitmapWithPlayerBoxes(bitmap, playerBoxInCapture ? [playerBoxInCapture] : [], playerPath).catch((error) => {
    warn(
      `Automate Bot (${BOT_NAME}): collision debug player screenshot failed for loop #${loopIndex}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  warn(
    `Automate Bot (${BOT_NAME}): collision debug screenshots saved (${phase}/${clearReason}) obstacle=${obstaclePath}, player=${playerPath}.`,
  );
}

function buildDepositDebugSummary(
  playerAnchorInCapture: { x: number; y: number } | null,
  playerBoxInCapture: PlayerBox | null,
  depositBox: MotherlodeDepositBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
  depositDistancePx: number | null,
  depositInFlight: boolean,
  depositRetryTicks: number,
): string {
  const isNearDeposit = depositDistancePx !== null && depositDistancePx <= DEPOSIT_PLAYER_NEAR_RADIUS_PX;
  const collidingWithObstacle = isPlayerCollidingWithObstacle(playerBoxInCapture, obstacleBox);
  const distanceText = depositDistancePx === null ? "n/a" : depositDistancePx.toFixed(1);

  return [
    `inFlight=${depositInFlight ? "yes" : "no"}`,
    `retryTicks=${depositRetryTicks}`,
    `distancePx=${distanceText}`,
    `nearDeposit=${isNearDeposit ? "yes" : "no"}`,
    `anchor=${formatPoint(playerAnchorInCapture)}`,
    `player=${playerBoxInCapture ? formatCollisionBox(playerBoxInCapture) : "missing"}`,
    `deposit=${depositBox ? formatCollisionBox(depositBox) : "missing"}`,
    `obstacle=${obstacleBox ? formatCollisionBox(obstacleBox) : "missing"}`,
    `collision=${collidingWithObstacle ? "yes" : "no"}`,
  ].join(", ");
}

function saveDepositDebugArtifacts(eventName: string, loopIndex: number, capture: DepositCaptureResult): void {
  const eventToken = sanitizeDebugToken(eventName);
  const base = path.join(DEBUG_DIR, `deposit-${eventToken}-loop${loopIndex}`);
  const depositPath = `${base}-deposit.png`;
  const obstaclePath = `${base}-obstacle.png`;
  const playerPath = `${base}-player.png`;

  saveBitmapWithMotherlodeDepositBoxes(capture.bitmap, capture.depositBox ? [capture.depositBox] : [], depositPath);
  saveBitmapWithMotherlodeObstacleRedBoxes(
    capture.bitmap,
    capture.obstacleBox ? [capture.obstacleBox] : [],
    obstaclePath,
  );
  void saveBitmapWithPlayerBoxes(
    capture.bitmap,
    capture.playerBoxInCapture ? [capture.playerBoxInCapture] : [],
    playerPath,
  ).catch((error) => {
    warn(
      `Automate Bot (${BOT_NAME}): deposit debug player screenshot failed for loop #${loopIndex}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  warn(
    `Automate Bot (${BOT_NAME}): deposit debug screenshots saved (${eventName}) deposit=${depositPath}, obstacle=${obstaclePath}, player=${playerPath}.`,
  );
}

function saveBankDepositOrbDebugArtifacts(
  eventName: string,
  loopIndex: number,
  orbClickCount: number,
  bitmap: RobotBitmap,
  orbResult: BankDepositOrbDetectorResult,
): void {
  const eventToken = sanitizeDebugToken(eventName);
  const orbPath = path.join(DEBUG_DIR, `${loopIndex}-bank-orb-${eventToken}-click${orbClickCount}.png`);
  saveBitmapWithBankDepositOrbDetection(bitmap, orbResult, orbPath);
  warn(
    `Automate Bot (${BOT_NAME}): bank orb debug screenshot saved (${eventName}) click=${orbClickCount}/${BANK_ORB_CONFIRM_CLICK_COUNT} path=${orbPath}.`,
  );
}

function mapLocalOrbResultToScene(
  localResult: BankDepositOrbDetectorResult,
  localSearchBounds: { x: number; y: number },
): BankDepositOrbDetectorResult {
  if (!localResult.detection) {
    return localResult;
  }

  const { detection } = localResult;
  return {
    ...localResult,
    detection: {
      ...detection,
      x: detection.x + localSearchBounds.x,
      y: detection.y + localSearchBounds.y,
      centerX: detection.centerX + localSearchBounds.x,
      centerY: detection.centerY + localSearchBounds.y,
      matches: detection.matches.map((match) => ({
        ...match,
        sceneX: match.sceneX + localSearchBounds.x,
        sceneY: match.sceneY + localSearchBounds.y,
      })),
    },
  };
}

function saveBankYellowDebugArtifacts(
  eventName: string,
  loopIndex: number,
  yellowSource: "banking-yellow" | "mine-yellow",
  capture: MineCaptureResult,
  captureBounds: ScreenCaptureBounds,
  clickedScreenPoint: { x: number; y: number },
): void {
  const eventToken = sanitizeDebugToken(eventName);
  const localClickPoint = {
    x: clickedScreenPoint.x - captureBounds.x,
    y: clickedScreenPoint.y - captureBounds.y,
  };
  const yellowPath = path.join(DEBUG_DIR, `${loopIndex}-bank-yellow-${yellowSource}-${eventToken}.png`);

  if (yellowSource === "banking-yellow") {
    saveBitmapWithMotherlodeBankingYellowBoxes(
      capture.bitmap,
      capture.bankingYellowBoxes,
      yellowPath,
      localClickPoint,
      capture.playerBoxInCapture,
      { r: 64, g: 220, b: 255 },
    );
  } else {
    const mineYellowBoxes = capture.boxes.filter((box) => box.color === "yellow");
    saveBitmapWithMotherlodeMineBoxes(
      capture.bitmap,
      mineYellowBoxes,
      yellowPath,
      localClickPoint,
      capture.playerBoxInCapture,
      {
        r: 255,
        g: 220,
        b: 64,
      },
    );
  }

  warn(
    `Automate Bot (${BOT_NAME}): bank yellow debug screenshot saved (${eventName}) source=${yellowSource} path=${yellowPath} click=(${clickedScreenPoint.x},${clickedScreenPoint.y}).`,
  );
}

function getWindowsDisplayScaleFactor(bounds: ScreenCaptureBounds): number {
  const display = electronScreen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });
  return Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
}

function toPhysicalBounds(bounds: ScreenCaptureBounds, scaleFactor: number): ScreenCaptureBounds {
  const s = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(bounds.x * s),
    y: Math.round(bounds.y * s),
    width: Math.max(1, Math.round(bounds.width * s)),
    height: Math.max(1, Math.round(bounds.height * s)),
  };
}

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }
  stopAutomateBot("bot");
}

function sleepWithAbort(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const tick = 50;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += tick;
      if (!AppState.automateBotRunning || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, tick);
  });
}

function moveMouseToWindowCenter(bounds: ScreenCaptureBounds): void {
  const centerX = Math.round(bounds.x + bounds.width / 2);
  const centerY = Math.round(bounds.y + bounds.height / 2);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
  moveMouse(centerX, centerY);
}

function scrollCameraDownToMaximum(): void {
  if (typeof scrollMouse !== "function") {
    warn(`Automate Bot (${BOT_NAME}): RobotJS scrollMouse unavailable; skipping startup camera scroll.`);
    return;
  }
  for (let i = 0; i < CAMERA_SCROLL_TICKS; i += 1) {
    scrollMouse(0, CAMERA_SCROLL_DELTA_Y);
  }
}

function tapCompassNorth(): void {
  if (typeof keyToggle !== "function") {
    warn(`Automate Bot (${BOT_NAME}): RobotJS keyToggle unavailable; skipping startup compass alignment.`);
    return;
  }
  keyToggle("n", "down");
  setTimeout(() => {
    keyToggle("n", "up");
  }, NORTH_KEY_HOLD_MS);
}

function parseTileCoord(matchedLine: string): TileCoord | null {
  const parts = matchedLine.split(",");
  if (parts.length < 3) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function isAtBankLadderDownTile(tile: TileCoord | null): boolean {
  return tile?.x === BANK_EXPECTED_LADDER_DOWN_X && tile?.y === BANK_EXPECTED_LADDER_DOWN_Y;
}

function isAtLadderUpTile(tile: TileCoord | null): boolean {
  return tile?.x === BANK_EXPECTED_LADDER_UP_X && tile?.y === BANK_EXPECTED_LADDER_UP_Y;
}

function ticksToMs(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return 0;
  }
  return Math.ceil(ticks * GAME_TICK_MS);
}

function deadlineFromNowTicks(ticks: number): number {
  const durationMs = ticksToMs(ticks);
  return durationMs > 0 ? Date.now() + durationMs : 0;
}

function isDeadlineActive(deadlineMs: number, nowMs: number): boolean {
  return deadlineMs > nowMs;
}

function remainingDeadlineTicks(deadlineMs: number, nowMs: number): number {
  if (!isDeadlineActive(deadlineMs, nowMs)) {
    return 0;
  }
  return Math.ceil((deadlineMs - nowMs) / GAME_TICK_MS);
}

function saveTickDebugCapture(
  label: TickDebugCaptureLabel,
  bitmap: RobotBitmap,
  boxes: MotherlodeMineBox[],
  activeTargetInCapture: { x: number; y: number } | null,
  playerBox: PlayerBox | null,
): void {
  if (!DEBUG_TICK_CAPTURE_ENABLED[label]) {
    return;
  }

  const usesStaticFilename = label === "deposit" || label === "bank" || label === "bank-ladder";
  if (!usesStaticFilename) {
    debugCaptureIndex += 1;
  }

  const filename = usesStaticFilename
    ? path.join(DEBUG_DIR, `motherlode-v2-${label}.png`)
    : path.join(DEBUG_DIR, `${debugCaptureIndex}-motherlode-v2-${label}.png`);
  saveBitmapWithMotherlodeMineBoxes(bitmap, boxes, filename, activeTargetInCapture, playerBox);
}

function isActionLocked(state: BotState, nowMs: number): boolean {
  return isDeadlineActive(state.actionLockUntilMs, nowMs);
}

function isBankSouthWaitActive(state: BotState, nowMs: number): boolean {
  return isDeadlineActive(state.bankSouthWaitUntilMs, nowMs);
}

function createInitialBotState(): BotState {
  return {
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    bagFullState: null,
    depositTriggerStableTicks: 0,
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    actionLockUntilMs: 0,
    bankingStep: "find-orange",
    bankValidateStartTile: false,
    bankSouthClicks: 0,
    bankSouthWaitUntilMs: 0,
    bankYellowPreClickSackCount: null,
    bankYellowSackWaitTicks: 0,
    bankLadderRecheckCount: 0,
    bankOrbClickCount: 0,
    bankOrbCandidateCenter: null,
    bankOrbStableTicks: 0,
    bankOrbCachedLocalPoint: null,
    bankOrbCachedRetryCount: 0,
    bankOrbLastClickUsedCache: false,
    bankOrbBagStatsFailTicks: 0,
    loopIndex: 0,
  };
}

function detectStartupBotState(captureBounds: ScreenCaptureBounds): BotState {
  const initialState = createInitialBotState();
  const bitmap = captureScreenBitmap(captureBounds);
  const overlayBox = detectOverlayBoxInScreenshot(bitmap, currentWindowsScalePercent);

  if (!overlayBox) {
    warn(`Automate Bot (${BOT_NAME}): startup coordinate overlay unavailable. Defaulting initial phase to searching.`);
    return initialState;
  }

  const startupTile = parseTileCoord(overlayBox.matchedLine);
  if (!startupTile) {
    warn(
      `Automate Bot (${BOT_NAME}): startup coordinate overlay could not be parsed ('${overlayBox.matchedLine}'). Defaulting initial phase to searching.`,
    );
    return initialState;
  }

  if (isAtBankLadderDownTile(startupTile)) {
    log(
      `Automate Bot (${BOT_NAME}): startup tile ${startupTile.x},${startupTile.y},${startupTile.z} matches bank ladder bottom (${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y},*). Initial phase=banking.`,
    );
    return resetToBanking(initialState);
  }

  log(
    `Automate Bot (${BOT_NAME}): startup tile ${startupTile.x},${startupTile.y},${startupTile.z} is not bank ladder bottom (${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y},*). Initial phase=searching.`,
  );
  return initialState;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function randomIntInclusive(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function getInnerRange(start: number, size: number, ratio: number): { min: number; max: number } {
  const boundedSize = Math.max(1, size);
  const innerSize = Math.max(1, Math.floor(boundedSize * ratio));
  const margin = Math.max(0, Math.floor((boundedSize - innerSize) / 2));
  const min = start + margin;
  const max = min + innerSize - 1;
  return { min, max };
}

function pickDistinctScreenPointInLocalRange(
  localMinX: number,
  localMaxX: number,
  localMinY: number,
  localMaxY: number,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const minX = captureBounds.x + Math.min(localMinX, localMaxX);
  const maxX = captureBounds.x + Math.max(localMinX, localMaxX);
  const minY = captureBounds.y + Math.min(localMinY, localMaxY);
  const maxY = captureBounds.y + Math.max(localMinY, localMaxY);

  let candidate = { x: minX, y: minY };
  for (let attempt = 0; attempt < BOX_CLICK_PICK_MAX_ATTEMPTS; attempt += 1) {
    const x = randomIntInclusive(minX, maxX);
    const y = randomIntInclusive(minY, maxY);
    candidate = { x, y };
    if (!lastClickPoint || x !== lastClickPoint.x || y !== lastClickPoint.y) {
      return candidate;
    }
  }

  if (minX < maxX) {
    const nextX = candidate.x > minX ? candidate.x - 1 : candidate.x + 1;
    return { x: nextX, y: candidate.y };
  }

  if (minY < maxY) {
    const nextY = candidate.y > minY ? candidate.y - 1 : candidate.y + 1;
    return { x: candidate.x, y: nextY };
  }

  return candidate;
}

function pickDistinctScreenPointInBox(
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getInnerRange(boxX, boxWidth, BOX_CLICK_INNER_RATIO);
  const innerY = getInnerRange(boxY, boxHeight, BOX_CLICK_INNER_RATIO);
  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, innerY.max, captureBounds);
}

function toScreenPointFromLocalPoint(
  localX: number,
  localY: number,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return {
    x: captureBounds.x + Math.round(localX),
    y: captureBounds.y + Math.round(localY),
  };
}

function isBankOrangePixel(r: number, g: number, b: number): boolean {
  if (Math.abs(r - BANK_ORANGE_TARGET_R) > BANK_ORANGE_R_TOLERANCE) return false;
  if (Math.abs(g - BANK_ORANGE_TARGET_G) > BANK_ORANGE_G_TOLERANCE) return false;
  if (Math.abs(b - BANK_ORANGE_TARGET_B) > BANK_ORANGE_B_TOLERANCE) return false;
  return r >= 235 && g >= 90 && b <= 35;
}

function detectOrangeBoxesInScreenshot(bitmap: RobotBitmap): OrangeTargetBox[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isBankOrangePixel(r, g, b)) {
        mask[y * width + x] = 1;
      }
    }
  }

  const remaining = mask.slice();
  const out: OrangeTargetBox[] = [];

  for (let i = 0; i < remaining.length; i += 1) {
    if (!remaining[i]) continue;
    remaining[i] = 0;
    const stack = [i];

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const idx = stack.pop();
      if (idx === undefined) break;
      const x = idx % width;
      const y = Math.floor(idx / width);

      pixelCount += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (!remaining[n]) continue;
          remaining[n] = 0;
          stack.push(n);
        }
      }
    }

    if (pixelCount < BANK_ORANGE_MIN_COMPONENT_PIXELS) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w <= 0 || h <= 0) continue;

    out.push({
      x: minX,
      y: minY,
      width: w,
      height: h,
      centerX: Math.round((minX + maxX) / 2),
      centerY: Math.round((minY + maxY) / 2),
      pixelCount,
    });
  }

  out.sort((a, b) => b.pixelCount - a.pixelCount);
  return out;
}

function findNodeNearActiveScreen(
  boxes: MotherlodeMineBox[],
  activeScreen: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
): MotherlodeMineBox | null {
  const activeX = activeScreen.x - captureBounds.x;
  const activeY = activeScreen.y - captureBounds.y;

  let best: MotherlodeMineBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;
  let bestYellow: MotherlodeMineBox | null = null;
  let bestYellowDistance = Number.POSITIVE_INFINITY;
  let bestYellowCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(activeX, box.x, box.x + box.width - 1);
    const nearestY = clamp(activeY, box.y, box.y + box.height - 1);
    const dx = activeX - nearestX;
    const dy = activeY - nearestY;
    const distance = axisDistance(dx, dy);
    if (distance > ACTIVE_NODE_MATCH_RADIUS_PX) continue;

    const centerDx = box.centerX - activeX;
    const centerDy = box.centerY - activeY;
    const centerDistance = axisDistance(centerDx, centerDy);
    if (distance < bestDistance || (Math.abs(distance - bestDistance) < 0.001 && centerDistance < bestCenterDistance)) {
      bestDistance = distance;
      bestCenterDistance = centerDistance;
      best = box;
    }

    if (
      box.color === "yellow" &&
      (distance < bestYellowDistance ||
        (Math.abs(distance - bestYellowDistance) < 0.001 && centerDistance < bestYellowCenterDistance))
    ) {
      bestYellowDistance = distance;
      bestYellowCenterDistance = centerDistance;
      bestYellow = box;
    }
  }

  if (bestYellow && (!best || bestYellowDistance <= bestDistance + ACTIVE_NODE_YELLOW_PREFERENCE_MARGIN_PX)) {
    return bestYellow;
  }

  return best;
}

function isGreenNodePixelForTransition(r: number, g: number, b: number): boolean {
  return g >= 122 && g - r >= 26 && g - b >= 14 && r <= 210 && b <= 210;
}

function isYellowNodePixelForTransition(r: number, g: number, b: number): boolean {
  return r >= 145 && g >= 95 && b <= 110 && r + g >= 270 && r - b >= 60 && g - b >= 24;
}

function detectYellowTransitionNearActivePoint(
  bitmap: RobotBitmap,
  activeScreen: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
): { transitioned: boolean; yellowPixels: number; greenPixels: number; samplePixels: number } {
  const localX = Math.round(activeScreen.x - captureBounds.x);
  const localY = Math.round(activeScreen.y - captureBounds.y);
  const radius = 16;
  const x0 = clamp(localX - radius, 0, bitmap.width - 1);
  const x1 = clamp(localX + radius, 0, bitmap.width - 1);
  const y0 = clamp(localY - radius, 0, bitmap.height - 1);
  const y1 = clamp(localY + radius, 0, bitmap.height - 1);

  let yellowPixels = 0;
  let greenPixels = 0;
  let samplePixels = 0;

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      samplePixels += 1;

      if (isYellowNodePixelForTransition(r, g, b)) {
        yellowPixels += 1;
      }
      if (isGreenNodePixelForTransition(r, g, b)) {
        greenPixels += 1;
      }
    }
  }

  // Require a meaningful yellow presence and dominance over green so we
  // don't treat warm cave pixels as node transitions.
  const transitioned =
    yellowPixels >= 26 && (yellowPixels >= greenPixels + 10 || yellowPixels * 2 >= Math.max(1, samplePixels / 4));

  return {
    transitioned,
    yellowPixels,
    greenPixels,
    samplePixels,
  };
}

function getNodeUpperBiasedLocalY(node: MotherlodeMineBox): number {
  const upwardBiasPx = Math.max(3, Math.round(node.height * 0.32));
  return Math.max(node.y + 1, node.centerY - upwardBiasPx);
}

function toNodeInteractionScreenPoint(
  node: MotherlodeMineBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getInnerRange(node.x, node.width, BOX_CLICK_INNER_RATIO);
  const innerY = getInnerRange(node.y, node.height, BOX_CLICK_INNER_RATIO);

  const preferredY = clamp(getNodeUpperBiasedLocalY(node), innerY.min, innerY.max);
  const yBandHeight = Math.max(1, Math.floor((innerY.max - innerY.min + 1) * 0.45));
  const yMin = Math.max(innerY.min, preferredY - yBandHeight + 1);
  const yMax = Math.max(yMin, preferredY);

  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, yMin, yMax, captureBounds);
}

function toDepositInteractionScreenPoint(
  depositBox: MotherlodeDepositBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(depositBox.x, depositBox.y, depositBox.width, depositBox.height, captureBounds);
}

function toObstacleInteractionScreenPoint(
  obstacleBox: MotherlodeObstacleRedBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(
    obstacleBox.x,
    obstacleBox.y,
    obstacleBox.width,
    obstacleBox.height,
    captureBounds,
  );
}

function toOrangeInteractionScreenPoint(
  orangeBox: OrangeTargetBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(orangeBox.x, orangeBox.y, orangeBox.width, orangeBox.height, captureBounds);
}

function toOrangeTopInteractionScreenPoint(
  orangeBox: OrangeTargetBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getInnerRange(orangeBox.x, orangeBox.width, BOX_CLICK_INNER_RATIO);
  const innerY = getInnerRange(orangeBox.y, orangeBox.height, BOX_CLICK_INNER_RATIO);
  const topBandHeight = Math.max(1, Math.ceil((innerY.max - innerY.min + 1) * 0.2));
  const topBandMaxY = Math.min(innerY.max, innerY.min + topBandHeight - 1);

  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, topBandMaxY, captureBounds);
}

function toYellowInteractionScreenPoint(
  node: { x: number; y: number; width: number; height: number },
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(node.x, node.y, node.width, node.height, captureBounds);
}

function resolvePostClickMouseTarget(
  clickedScreenX: number,
  clickedScreenY: number,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } | null {
  const minX = captureBounds.x + POST_CLICK_CORNER_MARGIN_PX;
  const minY = captureBounds.y + POST_CLICK_CORNER_MARGIN_PX;
  const maxX = captureBounds.x + captureBounds.width - 1 - POST_CLICK_CORNER_MARGIN_PX;
  const maxY = captureBounds.y + captureBounds.height - 1 - POST_CLICK_CORNER_MARGIN_PX;

  if (minX > maxX || minY > maxY) return null;
  if (POST_CLICK_MOUSE_MOVE_MODE === "top-left") return { x: minX, y: minY };
  if (POST_CLICK_MOUSE_MOVE_MODE === "offset-200") {
    return {
      x: clamp(clickedScreenX - POST_CLICK_MOUSE_OFFSET_PX, minX, maxX),
      y: clamp(clickedScreenY - POST_CLICK_MOUSE_OFFSET_PX, minY, maxY),
    };
  }
  return null;
}

function moveMouseAwayFromClickedNode(
  clickedScreenX: number,
  clickedScreenY: number,
  captureBounds: ScreenCaptureBounds,
): void {
  return;
}

function clickScreenPoint(screenX: number, screenY: number): void {
  moveMouse(screenX, screenY);
  mouseClick("left", false);
  lastClickPoint = { x: screenX, y: screenY };
}

function toSouthMoveScreenPoint(
  captureBounds: ScreenCaptureBounds,
  playerAnchorInCapture: { x: number; y: number } | null,
  playerBoxInCapture: PlayerBox | null,
): BankSouthMovePlan {
  const anchorX = playerAnchorInCapture?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = playerAnchorInCapture?.y ?? Math.round(captureBounds.height / 2);
  const tilePx = estimateBankTilePxFromPlayerBox(playerBoxInCapture);

  const minLocalX = BANK_MOVE_MARGIN_PX;
  const minLocalY = BANK_MOVE_MARGIN_PX;
  const maxLocalX = captureBounds.width - 1 - BANK_MOVE_MARGIN_PX;
  const maxLocalY = captureBounds.height - 1 - BANK_MOVE_MARGIN_PX;

  const baseOffsetX = Math.round(tilePx * BANK_SOUTHWEST_CLICK_OFFSET_TILES_X);
  const baseOffsetY = Math.round(tilePx * BANK_SOUTHWEST_CLICK_OFFSET_TILES_Y);
  const baseLocalX = clamp(anchorX + baseOffsetX, minLocalX, maxLocalX);
  const baseLocalY = clamp(anchorY + baseOffsetY, minLocalY, maxLocalY);

  const randomRadiusPx = Math.max(
    BANK_SOUTH_CLICK_RANDOM_RADIUS_PX,
    Math.round(tilePx * BANK_SOUTHWEST_CLICK_RANDOM_TILE_RADIUS),
  );
  const randomMinX = clamp(baseLocalX - randomRadiusPx, minLocalX, maxLocalX);
  const randomMaxX = clamp(baseLocalX + randomRadiusPx, minLocalX, maxLocalX);
  const randomMinY = clamp(baseLocalY - randomRadiusPx, minLocalY, maxLocalY);
  const randomMaxY = clamp(baseLocalY + randomRadiusPx, minLocalY, maxLocalY);

  const point = pickDistinctScreenPointInLocalRange(randomMinX, randomMaxX, randomMinY, randomMaxY, captureBounds);
  const anchorScreenX = captureBounds.x + anchorX;
  const anchorScreenY = captureBounds.y + anchorY;
  const dxPx = point.x - anchorScreenX;
  const dyPx = point.y - anchorScreenY;
  const dxTiles = dxPx / tilePx;
  const dyTiles = dyPx / tilePx;
  const distanceTiles = Math.max(Math.abs(dxPx) / tilePx, Math.abs(dyPx) / tilePx);
  const etaTicks = clamp(
    Math.ceil(distanceTiles / BANK_PLAYER_SPEED_TILES_PER_TICK),
    BANK_SOUTH_CLICK_LOCK_TICKS,
    BANK_SOUTH_RECLICK_WAIT_MAX_TICKS,
  );

  return {
    point,
    tilePx,
    dxPx,
    dyPx,
    dxTiles,
    dyTiles,
    distanceTiles,
    etaTicks,
  };
}

function estimateBankTravelToScreenPoint(
  screenPoint: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
  playerAnchorInCapture: { x: number; y: number } | null,
  playerBoxInCapture: PlayerBox | null,
  extraTicks: number,
  maxWaitTicks: number,
): BankTargetTravelEstimate {
  const anchorX = captureBounds.x + (playerAnchorInCapture?.x ?? Math.round(captureBounds.width / 2));
  const anchorY = captureBounds.y + (playerAnchorInCapture?.y ?? Math.round(captureBounds.height / 2));
  const tilePx = estimateBankTilePxFromPlayerBox(playerBoxInCapture);
  const dxPx = screenPoint.x - anchorX;
  const dyPx = screenPoint.y - anchorY;
  const dxTiles = dxPx / tilePx;
  const dyTiles = dyPx / tilePx;
  const distanceTiles = Math.max(Math.abs(dxPx) / tilePx, Math.abs(dyPx) / tilePx);
  const etaTicks = clamp(Math.ceil(distanceTiles / BANK_PLAYER_SPEED_TILES_PER_TICK) + extraTicks, 1, maxWaitTicks);

  return {
    tilePx,
    dxPx,
    dyPx,
    dxTiles,
    dyTiles,
    distanceTiles,
    etaTicks,
  };
}

function estimateBankTilePxFromPlayerBox(playerBoxInCapture: PlayerBox | null): number {
  if (!playerBoxInCapture) {
    return BANK_TILE_PX_FALLBACK;
  }

  const estimatedTilePx = Math.round((playerBoxInCapture.width + playerBoxInCapture.height) / 2);
  return clamp(estimatedTilePx, BANK_TILE_PX_MIN, BANK_TILE_PX_MAX);
}

function isPlayerNearDepositBox(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: MotherlodeDepositBox | null,
  radiusPx: number,
): boolean {
  const distance = getPlayerDistanceToDepositBox(playerAnchorInCapture, depositBox);
  return distance !== null && distance <= radiusPx;
}

function getPlayerDistanceToDepositBox(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: MotherlodeDepositBox | null,
): number | null {
  if (!playerAnchorInCapture || !depositBox) return null;
  const nearestX = clamp(playerAnchorInCapture.x, depositBox.x, depositBox.x + depositBox.width - 1);
  const nearestY = clamp(playerAnchorInCapture.y, depositBox.y, depositBox.y + depositBox.height - 1);
  const dx = playerAnchorInCapture.x - nearestX;
  const dy = playerAnchorInCapture.y - nearestY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPointDistanceToBox(
  point: { x: number; y: number } | null,
  box: { x: number; y: number; width: number; height: number } | null,
): number | null {
  if (!point || !box) return null;
  const nearestX = clamp(point.x, box.x, box.x + box.width - 1);
  const nearestY = clamp(point.y, box.y, box.y + box.height - 1);
  const dx = point.x - nearestX;
  const dy = point.y - nearestY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getDistancePointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const segmentDx = end.x - start.x;
  const segmentDy = end.y - start.y;
  const segmentLengthSquared = segmentDx * segmentDx + segmentDy * segmentDy;

  if (segmentLengthSquared <= 0.0001) {
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const projection = ((point.x - start.x) * segmentDx + (point.y - start.y) * segmentDy) / segmentLengthSquared;
  const t = clamp(projection, 0, 1);
  const nearestX = start.x + segmentDx * t;
  const nearestY = start.y + segmentDy * t;
  const dx = point.x - nearestX;
  const dy = point.y - nearestY;
  return Math.sqrt(dx * dx + dy * dy);
}

function isObstacleRelevantToDepositPath(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: MotherlodeDepositBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): obstacleBox is MotherlodeObstacleRedBox {
  if (!playerAnchorInCapture || !depositBox || !obstacleBox) {
    return false;
  }

  const obstacleCenter = {
    x: obstacleBox.centerX,
    y: obstacleBox.centerY,
  };
  const depositTarget = {
    x: clamp(playerAnchorInCapture.x, depositBox.x, depositBox.x + depositBox.width - 1),
    y: clamp(playerAnchorInCapture.y, depositBox.y, depositBox.y + depositBox.height - 1),
  };

  const distanceToPlayer = Math.sqrt(
    (obstacleCenter.x - playerAnchorInCapture.x) * (obstacleCenter.x - playerAnchorInCapture.x) +
      (obstacleCenter.y - playerAnchorInCapture.y) * (obstacleCenter.y - playerAnchorInCapture.y),
  );
  const distanceToDeposit = getPointDistanceToBox(obstacleCenter, depositBox);
  const distanceToRoute = getDistancePointToSegment(obstacleCenter, playerAnchorInCapture, depositTarget);

  return (
    distanceToPlayer <= DEPOSIT_OBSTACLE_PATH_PLAYER_RADIUS_PX ||
    (distanceToDeposit !== null && distanceToDeposit <= DEPOSIT_OBSTACLE_PATH_DEPOSIT_RADIUS_PX) ||
    distanceToRoute <= DEPOSIT_OBSTACLE_PATH_ROUTE_PADDING_PX
  );
}

function shouldClearDepositObstacle(
  playerBoxInCapture: PlayerBox | null,
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: MotherlodeDepositBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
  depositInFlight: boolean,
  depositRetryTicks: number,
): { shouldClear: boolean; reason: "collision" | `stalled-${number}` | null } {
  if (shouldClearRedObstacle(playerBoxInCapture, obstacleBox)) {
    return { shouldClear: true, reason: "collision" };
  }

  if (
    depositInFlight &&
    depositRetryTicks >= 1 &&
    isObstacleRelevantToDepositPath(playerAnchorInCapture, depositBox, obstacleBox)
  ) {
    return { shouldClear: true, reason: `stalled-${depositRetryTicks}` };
  }

  return { shouldClear: false, reason: null };
}

function isPlayerCollidingWithObstacle(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): boolean {
  return isPlayerCollidingWithObstacleBox(playerBoxInCapture, obstacleBox, OBSTACLE_PLAYER_COLLISION_PADDING_PX);
}

function shouldClearRedObstacle(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): obstacleBox is MotherlodeObstacleRedBox {
  return ENABLE_OBSTACLE_RED_CLICK && isPlayerCollidingWithObstacle(playerBoxInCapture, obstacleBox);
}

function isBagAtDepositThreshold(state: MotherlodeBagFullState): boolean {
  return state === "green" || state === "red";
}

function resetToSearching(current: BotState): BotState {
  return {
    ...current,
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    actionLockUntilMs: 0,
    bankingStep: "find-orange",
    bankValidateStartTile: false,
    bankSouthClicks: 0,
    bankSouthWaitUntilMs: 0,
    bankYellowPreClickSackCount: null,
    bankYellowSackWaitTicks: 0,
    bankLadderRecheckCount: 0,
    bankOrbClickCount: 0,
    bankOrbCandidateCenter: null,
    bankOrbStableTicks: 0,
    bankOrbCachedRetryCount: 0,
    bankOrbLastClickUsedCache: false,
    bankOrbBagStatsFailTicks: 0,
  };
}

function resetToDepositing(current: BotState): BotState {
  return {
    ...current,
    phase: "depositing",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    actionLockUntilMs: 0,
    bankingStep: "find-orange",
    bankValidateStartTile: false,
    bankSouthClicks: 0,
    bankSouthWaitUntilMs: 0,
    bankYellowPreClickSackCount: null,
    bankYellowSackWaitTicks: 0,
    bankLadderRecheckCount: 0,
    bankOrbClickCount: 0,
    bankOrbCandidateCenter: null,
    bankOrbStableTicks: 0,
    bankOrbCachedRetryCount: 0,
    bankOrbLastClickUsedCache: false,
    bankOrbBagStatsFailTicks: 0,
  };
}

function resetToBanking(current: BotState): BotState {
  return {
    ...current,
    phase: "banking",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    actionLockUntilMs: 0,
    bankingStep: "move-south-until-yellow",
    bankValidateStartTile: true,
    bankSouthClicks: 0,
    bankSouthWaitUntilMs: 0,
    bankYellowPreClickSackCount: null,
    bankYellowSackWaitTicks: 0,
    bankLadderRecheckCount: 0,
    bankOrbClickCount: 0,
    bankOrbCandidateCenter: null,
    bankOrbStableTicks: 0,
    bankOrbCachedRetryCount: 0,
    bankOrbLastClickUsedCache: false,
    bankOrbBagStatsFailTicks: 0,
  };
}

function resetToDescendingToBank(current: BotState): BotState {
  return {
    ...current,
    phase: "descending-to-bank",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    actionLockUntilMs: 0,
    bankingStep: "find-orange",
    bankValidateStartTile: false,
    bankSouthClicks: 0,
    bankSouthWaitUntilMs: 0,
    bankYellowPreClickSackCount: null,
    bankYellowSackWaitTicks: 0,
    bankLadderRecheckCount: 0,
    bankOrbClickCount: 0,
    bankOrbCandidateCenter: null,
    bankOrbStableTicks: 0,
    bankOrbCachedRetryCount: 0,
    bankOrbLastClickUsedCache: false,
    bankOrbBagStatsFailTicks: 0,
  };
}

function isPlausibleBankOrbLocation(detection: BankDepositOrbDetection, bitmap: RobotBitmap): boolean {
  const minCenterY = Math.round(bitmap.height * BANK_ORB_MIN_CENTER_Y_RATIO);
  return detection.centerY >= minCenterY;
}

function isBankOrbLocalPointInBounds(localPoint: { x: number; y: number }, bitmap: RobotBitmap): boolean {
  return localPoint.x >= 0 && localPoint.y >= 0 && localPoint.x < bitmap.width && localPoint.y < bitmap.height;
}

function resolveBankOrbLocalSearchBounds(
  localPoint: { x: number; y: number },
  bitmap: RobotBitmap,
): { x: number; y: number; width: number; height: number } {
  const boxSize = Math.max(1, BANK_ORB_LOCAL_SEARCH_BOX_PX);
  const halfSize = Math.floor(boxSize / 2);
  const maxStartX = Math.max(0, bitmap.width - 1);
  const maxStartY = Math.max(0, bitmap.height - 1);
  const startX = clamp(Math.round(localPoint.x) - halfSize, 0, maxStartX);
  const startY = clamp(Math.round(localPoint.y) - halfSize, 0, maxStartY);

  return {
    x: startX,
    y: startY,
    width: Math.max(1, Math.min(boxSize, bitmap.width - startX)),
    height: Math.max(1, Math.min(boxSize, bitmap.height - startY)),
  };
}

function cropRobotBitmap(bitmap: RobotBitmap, x: number, y: number, width: number, height: number): RobotBitmap {
  const clampedX = clamp(Math.round(x), 0, Math.max(0, bitmap.width - 1));
  const clampedY = clamp(Math.round(y), 0, Math.max(0, bitmap.height - 1));
  const cropWidth = Math.max(1, Math.min(width, bitmap.width - clampedX));
  const cropHeight = Math.max(1, Math.min(height, bitmap.height - clampedY));
  const image = Buffer.alloc(cropWidth * cropHeight * bitmap.bytesPerPixel);

  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = (clampedY + row) * bitmap.byteWidth + clampedX * bitmap.bytesPerPixel;
    const sourceEnd = sourceStart + cropWidth * bitmap.bytesPerPixel;
    bitmap.image.copy(image, row * cropWidth * bitmap.bytesPerPixel, sourceStart, sourceEnd);
  }

  return {
    image,
    width: cropWidth,
    height: cropHeight,
    byteWidth: cropWidth * bitmap.bytesPerPixel,
    bytesPerPixel: bitmap.bytesPerPixel,
  };
}

function getNextBankOrbStableTicks(current: BotState, detection: BankDepositOrbDetection): number {
  if (!current.bankOrbCandidateCenter) {
    return 1;
  }

  const dx = detection.centerX - current.bankOrbCandidateCenter.x;
  const dy = detection.centerY - current.bankOrbCandidateCenter.y;
  return Math.hypot(dx, dy) <= BANK_ORB_STABLE_DISTANCE_PX ? current.bankOrbStableTicks + 1 : 1;
}

function findNearestOrangeBox(
  boxes: OrangeTargetBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): OrangeTargetBox | null {
  if (boxes.length === 0) return null;

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: OrangeTargetBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
    const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
    const edgeDx = anchorX - nearestX;
    const edgeDy = anchorY - nearestY;
    const edgeDistance = axisDistance(edgeDx, edgeDy);

    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (
      edgeDistance < bestEdgeDistance ||
      (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)
    ) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function findNearestYellowNode(
  boxes: MotherlodeMineBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MotherlodeMineBox | null {
  const yellowBoxes = boxes.filter((box) => box.color === "yellow");
  if (yellowBoxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MotherlodeMineBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of yellowBoxes) {
    const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
    const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
    const edgeDx = anchorX - nearestX;
    const edgeDy = anchorY - nearestY;
    const edgeDistance = axisDistance(edgeDx, edgeDy);

    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (
      edgeDistance < bestEdgeDistance ||
      (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)
    ) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function findNearestBankingYellowBox(
  boxes: MotherlodeBankingYellowBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MotherlodeBankingYellowBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MotherlodeBankingYellowBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
    const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
    const edgeDx = anchorX - nearestX;
    const edgeDy = anchorY - nearestY;
    const edgeDistance = axisDistance(edgeDx, edgeDy);

    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (
      edgeDistance < bestEdgeDistance ||
      (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)
    ) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function findNearestBankingGreenBox(
  boxes: MotherlodeBankingGreenBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MotherlodeBankingGreenBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MotherlodeBankingGreenBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
    const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
    const edgeDx = anchorX - nearestX;
    const edgeDy = anchorY - nearestY;
    const edgeDistance = axisDistance(edgeDx, edgeDy);

    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (
      edgeDistance < bestEdgeDistance ||
      (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)
    ) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function captureMineState(
  captureBounds: ScreenCaptureBounds,
  label: MineTickDebugCaptureLabel,
  activeTargetScreen?: { x: number; y: number } | null,
  readOverlayTile: boolean = false,
  includeBankingDetectors: boolean = false,
  includeBagStatsDetection: boolean = false,
): MineCaptureResult {
  const bitmap = captureScreenBitmap(captureBounds);
  const boxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
  const greenBoxes = boxes.filter((b) => b.color === "green");
  const orangeBoxes = detectOrangeBoxesInScreenshot(bitmap);
  const bankingYellowBoxes = includeBankingDetectors ? detectMotherlodeBankingYellowBoxesInScreenshot(bitmap) : [];
  const bankingGreenBoxes = includeBankingDetectors ? detectMotherlodeBankingGreenBoxesInScreenshot(bitmap) : [];
  const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
  const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
  const bagStats = includeBagStatsDetection ? detectMotherlodeBagStatsInScreenshot(bitmap) : null;
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  const overlayBox = readOverlayTile ? detectOverlayBoxInScreenshot(bitmap, currentWindowsScalePercent) : null;
  const playerTileFromOverlay = overlayBox ? parseTileCoord(overlayBox.matchedLine) : null;
  const activeTargetInCapture =
    activeTargetScreen !== undefined && activeTargetScreen !== null
      ? {
          x: activeTargetScreen.x - captureBounds.x,
          y: activeTargetScreen.y - captureBounds.y,
        }
      : null;
  saveTickDebugCapture(label, bitmap, boxes, activeTargetInCapture, playerBox);

  return {
    bitmap,
    boxes,
    greenBoxes,
    orangeBoxes,
    bankingYellowBoxes,
    bankingGreenBoxes,
    obstacleBox,
    playerBoxInCapture: playerBox,
    playerAnchorInCapture,
    playerTileFromOverlay,
    bagFullState: bagFullDetection.state,
    bagStats,
  };
}

function captureDepositState(captureBounds: ScreenCaptureBounds, label: "deposit"): DepositCaptureResult {
  const bitmap = captureScreenBitmap(captureBounds);
  const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
  const depositBox = detectBestMotherlodeDepositBoxInScreenshot(bitmap);
  const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  const activeTargetInCapture = depositBox ? { x: depositBox.centerX, y: depositBox.centerY } : null;
  saveTickDebugCapture(label, bitmap, [], activeTargetInCapture, playerBox);

  return {
    bitmap,
    depositBox,
    obstacleBox,
    playerBoxInCapture: playerBox,
    playerAnchorInCapture,
    bagFullState: bagFullDetection.state,
  };
}

async function hoverAndReadTile(
  screenX: number,
  screenY: number,
  captureBounds: ScreenCaptureBounds,
): Promise<HoverTileReadResult> {
  if (ENABLE_NODE_HOVER_BEFORE_TILE_READ) {
    moveMouse(screenX, screenY);
    await sleepWithAbort(TOOLTIP_SETTLE_MS);
  }

  if (!AppState.automateBotRunning) {
    return { tile: null, source: "none", rawLine: null };
  }

  const bitmap = captureScreenBitmap(captureBounds);
  let tileBox: ReturnType<typeof detectTileLocationBoxInScreenshot> = null;
  if (ENABLE_TILE_LOCATION_DETECTION) {
    tileBox = detectTileLocationBoxInScreenshot(bitmap);
    const tileFromPrimary = tileBox ? parseTileCoord(tileBox.matchedLine) : null;
    if (tileFromPrimary) {
      return {
        tile: tileFromPrimary,
        source: "tile-location",
        rawLine: tileBox?.matchedLine ?? null,
      };
    }
  }

  const overlayBox = detectOverlayBoxInScreenshot(bitmap, currentWindowsScalePercent);
  if (!overlayBox) {
    return {
      tile: null,
      source: "none",
      rawLine: tileBox?.matchedLine ?? null,
    };
  }

  const tileFromOverlay = parseTileCoord(overlayBox.matchedLine);
  return {
    tile: tileFromOverlay,
    source: tileFromOverlay ? "overlay" : "none",
    rawLine: tileFromOverlay ? overlayBox.matchedLine : (tileBox?.matchedLine ?? overlayBox.matchedLine),
  };
}

function updateBagState(current: BotState, nextState: MotherlodeBagFullState): BotState {
  const stable = isBagAtDepositThreshold(nextState) ? current.depositTriggerStableTicks + 1 : 0;
  return {
    ...current,
    bagFullState: nextState,
    depositTriggerStableTicks: stable,
  };
}

function shouldExitBankingToMiningSearch(bagStats: MotherlodeBagStats | null): boolean {
  return bagStats?.sackRow.sackCount === 0 && (bagStats.row3.value ?? 0) >= 28;
}

function getBagInventorySpaceValue(bagStats: MotherlodeBagStats | null): number | null {
  return bagStats?.row3.value ?? null;
}

function getBagSackCountValue(bagStats: MotherlodeBagStats | null): number | null {
  return bagStats?.sackRow.sackCount ?? null;
}

function formatBagDecisionState(state: BotState, bagStats: MotherlodeBagStats | null = null): string {
  const base = `bagFull=${state.bagFullState ?? "none"}, depositStableTicks=${state.depositTriggerStableTicks}`;
  if (!bagStats) {
    return base;
  }

  return `${base}, sack=${bagStats.sackRow.sackCount ?? "?"}, row3=${bagStats.row3.value ?? "?"}`;
}

async function runTick(state: BotState, captureBounds: ScreenCaptureBounds): Promise<BotState> {
  const nowMs = Date.now();
  setCurrentLogLoopIndex(state.loopIndex + 1);
  let current = { ...state, loopIndex: state.loopIndex + 1 };

  if (current.phase === "depositing") {
    const capture = captureDepositState(captureBounds, "deposit");
    current = updateBagState(current, capture.bagFullState);

    const depositDistancePx = getPlayerDistanceToDepositBox(capture.playerAnchorInCapture, capture.depositBox);
    const nearDeposit = isPlayerNearDepositBox(
      capture.playerAnchorInCapture,
      capture.depositBox,
      DEPOSIT_PLAYER_NEAR_RADIUS_PX,
    );
    const depositNearStableTicks = nearDeposit ? current.depositNearStableTicks + 1 : 0;
    let depositRetryTicks = current.depositRetryTicks;
    let depositLastDistancePx = current.depositLastDistancePx;

    if (nearDeposit) {
      depositRetryTicks = 0;
      depositLastDistancePx = depositDistancePx;
    } else if (!current.depositInFlight) {
      depositRetryTicks = 0;
      depositLastDistancePx = depositDistancePx;
    } else if (depositDistancePx === null) {
      depositRetryTicks += 1;
      depositLastDistancePx = null;
    } else if (
      depositLastDistancePx === null ||
      depositDistancePx < depositLastDistancePx - DEPOSIT_PROGRESS_EPSILON_PX
    ) {
      depositRetryTicks = 0;
      depositLastDistancePx = depositDistancePx;
    } else {
      depositRetryTicks += 1;
      depositLastDistancePx = depositDistancePx;
    }

    current = { ...current, depositNearStableTicks, depositRetryTicks, depositLastDistancePx };

    if (depositNearStableTicks >= DEPOSIT_NEAR_STABLE_TICKS) {
      if (current.bagFullState === "red") {
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit path stable but bag-full is still red. Switching to down-ladder phase (${formatBagDecisionState(current)}).`,
        );
        return resetToDescendingToBank(current);
      }

      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit path stable for ${depositNearStableTicks} ticks. Returning to search (${formatBagDecisionState(current)}).`,
      );
      return resetToSearching(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const depositObstacleDecision = shouldClearDepositObstacle(
      capture.playerBoxInCapture,
      capture.playerAnchorInCapture,
      capture.depositBox,
      capture.obstacleBox,
      current.depositInFlight,
      current.depositRetryTicks,
    );

    if (capture.obstacleBox && depositObstacleDecision.shouldClear && depositObstacleDecision.reason) {
      const obstaclePoint = toObstacleInteractionScreenPoint(capture.obstacleBox, captureBounds);
      const clearReason = depositObstacleDecision.reason;
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit red obstacle at (${obstaclePoint.x},${obstaclePoint.y}) detected (${clearReason}). Clearing immediately.`,
      );
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Collision detail (${current.phase}/${clearReason}): ${buildCollisionDebugSummary(capture.playerBoxInCapture, capture.obstacleBox, OBSTACLE_PLAYER_COLLISION_PADDING_PX)}.`,
      );
      saveCollisionDebugArtifacts(
        current.phase,
        current.loopIndex,
        clearReason,
        capture.bitmap,
        capture.playerBoxInCapture,
        capture.obstacleBox,
      );
      clickScreenPoint(obstaclePoint.x, obstaclePoint.y);
      moveMouseAwayFromClickedNode(obstaclePoint.x, obstaclePoint.y, captureBounds);
      return {
        ...current,
        depositInFlight: false,
        depositRetryTicks: 0,
        depositLastDistancePx: depositDistancePx,
        actionLockUntilMs: deadlineFromNowTicks(OBSTACLE_CLICK_LOCK_TICKS),
      };
    }

    if (!capture.depositBox) {
      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit phase active but cyan deposit not found.`);
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit diagnostic (missing-deposit): ${buildDepositDebugSummary(
          capture.playerAnchorInCapture,
          capture.playerBoxInCapture,
          capture.depositBox,
          capture.obstacleBox,
          depositDistancePx,
          current.depositInFlight,
          current.depositRetryTicks,
        )}.`,
      );
      saveDepositDebugArtifacts("missing-deposit", current.loopIndex, capture);
      return current;
    }

    if (!current.depositInFlight) {
      const point = toDepositInteractionScreenPoint(capture.depositBox, captureBounds);
      log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Clicking cyan deposit at (${point.x},${point.y}).`);
      clickScreenPoint(point.x, point.y);
      moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
      return {
        ...current,
        depositInFlight: true,
        depositRetryTicks: 0,
        depositLastDistancePx: depositDistancePx,
        actionLockUntilMs: deadlineFromNowTicks(DEPOSIT_CLICK_LOCK_TICKS),
      };
    }

    if (current.depositRetryTicks < DEPOSIT_STUCK_RETRY_TICKS) {
      return current;
    }

    const point = toDepositInteractionScreenPoint(capture.depositBox, captureBounds);
    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit travel stalled for ${current.depositRetryTicks} ticks. Retrying cyan deposit click at (${point.x},${point.y}). ${buildDepositDebugSummary(
        capture.playerAnchorInCapture,
        capture.playerBoxInCapture,
        capture.depositBox,
        capture.obstacleBox,
        depositDistancePx,
        current.depositInFlight,
        current.depositRetryTicks,
      )}.`,
    );
    saveDepositDebugArtifacts(`stalled-retry-${current.depositRetryTicks}`, current.loopIndex, capture);
    clickScreenPoint(point.x, point.y);
    moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
    return {
      ...current,
      depositRetryTicks: 0,
      depositLastDistancePx: depositDistancePx,
      actionLockUntilMs: deadlineFromNowTicks(DEPOSIT_CLICK_LOCK_TICKS),
    };
  }

  const captureLabel =
    current.phase === "mining"
      ? "mine"
      : current.phase === "banking"
        ? "bank"
        : current.phase === "descending-to-bank" || current.phase === "ascending-to-mine"
          ? "bank-ladder"
          : "search";
  // Overlay OCR is expensive; only read it on banking sub-steps that actually consume tile text.
  const shouldReadOverlayTile =
    (current.phase === "banking" || current.phase === "descending-to-bank" || current.phase === "ascending-to-mine") &&
    !isActionLocked(current, nowMs) &&
    (current.bankingStep === "wait-after-orange" ||
      (current.bankingStep === "move-south-until-yellow" && current.bankSouthClicks === 0));
  const capture = captureMineState(
    captureBounds,
    captureLabel,
    current.activeScreen,
    shouldReadOverlayTile,
    current.phase === "banking" || current.phase === "descending-to-bank" || current.phase === "ascending-to-mine",
    current.phase === "banking" || current.phase === "descending-to-bank" || current.phase === "ascending-to-mine",
  );
  current = updateBagState(current, capture.bagFullState);

  if (
    current.phase !== "banking" &&
    current.phase !== "descending-to-bank" &&
    current.phase !== "ascending-to-mine" &&
    current.depositTriggerStableTicks >= DEPOSIT_TRIGGER_STABLE_TICKS
  ) {
    if (current.phase !== "depositing") {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full threshold stable for ${current.depositTriggerStableTicks} ticks. Switching to deposit (${formatBagDecisionState(current)}).`,
      );
    }
    return resetToDepositing(current);
  }

  if (
    current.phase !== "banking" &&
    current.phase !== "descending-to-bank" &&
    current.phase !== "ascending-to-mine" &&
    !isActionLocked(current, nowMs) &&
    shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)
  ) {
    const point = toObstacleInteractionScreenPoint(capture.obstacleBox, captureBounds);
    log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Clearing red obstacle at (${point.x},${point.y}).`);
    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Collision detail (${current.phase}/collision): ${buildCollisionDebugSummary(capture.playerBoxInCapture, capture.obstacleBox, OBSTACLE_PLAYER_COLLISION_PADDING_PX)}.`,
    );
    saveCollisionDebugArtifacts(
      current.phase,
      current.loopIndex,
      "collision",
      capture.bitmap,
      capture.playerBoxInCapture,
      capture.obstacleBox,
    );
    clickScreenPoint(point.x, point.y);
    moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
    return {
      ...resetToSearching(current),
      bagFullState: current.bagFullState,
      depositTriggerStableTicks: current.depositTriggerStableTicks,
      actionLockUntilMs: deadlineFromNowTicks(OBSTACLE_CLICK_LOCK_TICKS),
    };
  }

  if (current.phase === "descending-to-bank" || current.phase === "banking" || current.phase === "ascending-to-mine") {
    if (!isActionLocked(current, nowMs) && shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)) {
      const point = toObstacleInteractionScreenPoint(capture.obstacleBox, captureBounds);
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking collision with red obstacle at (${point.x},${point.y}). Clearing.`,
      );
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Collision detail (${current.phase}/collision): ${buildCollisionDebugSummary(capture.playerBoxInCapture, capture.obstacleBox, OBSTACLE_PLAYER_COLLISION_PADDING_PX)}.`,
      );
      saveCollisionDebugArtifacts(
        current.phase,
        current.loopIndex,
        "collision",
        capture.bitmap,
        capture.playerBoxInCapture,
        capture.obstacleBox,
      );
      clickScreenPoint(point.x, point.y);
      moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
      return {
        ...current,
        actionLockUntilMs: deadlineFromNowTicks(OBSTACLE_CLICK_LOCK_TICKS),
      };
    }

    if (current.phase === "descending-to-bank" && current.bankingStep === "wait-after-orange") {
      if (isActionLocked(current, nowMs)) {
        return current;
      }
      const tileText = capture.playerTileFromOverlay
        ? `${capture.playerTileFromOverlay.x},${capture.playerTileFromOverlay.y},${capture.playerTileFromOverlay.z}`
        : "unavailable";
      if (!isAtBankLadderDownTile(capture.playerTileFromOverlay)) {
        const nextRecheckCount = current.bankLadderRecheckCount + 1;
        if (nextRecheckCount <= BANK_LADDER_RECHECK_MAX) {
          const waitTicks = randomIntInclusive(BANK_LADDER_RECHECK_WAIT_MIN_TICKS, BANK_LADDER_RECHECK_WAIT_MAX_TICKS);
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking ladder descent not confirmed (tile=${tileText}, expected=${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y},*). Waiting ${waitTicks} ticks before re-check (${nextRecheckCount}/${BANK_LADDER_RECHECK_MAX}).`,
          );
          return {
            ...current,
            bankLadderRecheckCount: nextRecheckCount,
            actionLockUntilMs: deadlineFromNowTicks(waitTicks),
          };
        }

        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking ladder descent still not confirmed after ${current.bankLadderRecheckCount} re-checks (tile=${tileText}). Retrying ladder click.`,
        );
        return {
          ...current,
          bankingStep: "find-orange",
          bankSouthClicks: 0,
          bankLadderRecheckCount: 0,
        };
      }
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking ladder descent confirmed at tile ${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y}. Switching to banking phase.`,
      );
      const preYellowSackCount = getBagSackCountValue(capture.bagStats);
      return {
        ...resetToBanking(current),
        bankYellowPreClickSackCount: preYellowSackCount,
      };
    }

    if (current.phase === "banking" && current.bankingStep === "wait-after-return-orange") {
      if (isActionLocked(current, nowMs)) {
        return current;
      }

      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking return-orange wait complete. Transitioning to ascending-to-mine phase.`,
      );
      return {
        ...current,
        phase: "ascending-to-mine",
        bankingStep: "wait-after-orange",
        bankLadderRecheckCount: 0,
        actionLockUntilMs: 0,
      };
    }

    if (current.phase === "ascending-to-mine" && current.bankingStep === "wait-after-orange") {
      if (isActionLocked(current, nowMs)) {
        return current;
      }
      const tileText = capture.playerTileFromOverlay
        ? `${capture.playerTileFromOverlay.x},${capture.playerTileFromOverlay.y},${capture.playerTileFromOverlay.z}`
        : "unavailable";
      if (!isAtLadderUpTile(capture.playerTileFromOverlay)) {
        const nextRecheckCount = current.bankLadderRecheckCount + 1;
        if (nextRecheckCount <= BANK_LADDER_UP_RECHECK_MAX) {
          const waitTicks = randomIntInclusive(
            BANK_LADDER_UP_RECHECK_WAIT_MIN_TICKS,
            BANK_LADDER_UP_RECHECK_WAIT_MAX_TICKS,
          );
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Ladder ascent not confirmed (tile=${tileText}, expected=${BANK_EXPECTED_LADDER_UP_X},${BANK_EXPECTED_LADDER_UP_Y},*). Waiting ${waitTicks} ticks before re-check (${nextRecheckCount}/${BANK_LADDER_UP_RECHECK_MAX}).`,
          );
          return {
            ...current,
            bankLadderRecheckCount: nextRecheckCount,
            actionLockUntilMs: deadlineFromNowTicks(waitTicks),
          };
        }

        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Ladder ascent still not confirmed after ${current.bankLadderRecheckCount} re-checks (tile=${tileText}). Retrying orange click.`,
        );
        return {
          ...current,
          bankingStep: "find-orange",
          bankLadderRecheckCount: 0,
        };
      }

      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Ladder ascent confirmed at tile ${BANK_EXPECTED_LADDER_UP_X},${BANK_EXPECTED_LADDER_UP_Y}. Returning to mining search.`,
      );
      return {
        ...resetToSearching(current),
        bagFullState: null,
        depositTriggerStableTicks: 0,
      };
    }

    if (current.phase === "ascending-to-mine" && current.bankingStep === "find-orange") {
      const nearestOrangeBox = findNearestOrangeBox(capture.orangeBoxes, captureBounds, capture.playerAnchorInCapture);
      if (nearestOrangeBox) {
        const point = toOrangeTopInteractionScreenPoint(nearestOrangeBox, captureBounds);
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Ascending-to-mine re-clicking orange box at (${point.x},${point.y}).`,
        );
        clickScreenPoint(point.x, point.y);
        moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
        return {
          ...current,
          bankingStep: "wait-after-orange",
          bankLadderRecheckCount: 0,
          actionLockUntilMs: deadlineFromNowTicks(Math.max(BANK_CLICK_LOCK_TICKS, BANK_POST_ORANGE_WAIT_TICKS)),
        };
      }

      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Ascending-to-mine phase active but orange box was not found.`,
      );
      return current;
    }

    if (current.phase === "banking" && current.bankingStep === "wait-after-orb-click") {
      if (isActionLocked(current, nowMs)) {
        return current;
      }

      if (!capture.bagStats) {
        const nextFailTicks = current.bankOrbBagStatsFailTicks + 1;
        if (nextFailTicks >= BANK_ORB_BAG_STATS_FAIL_MAX_TICKS) {
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Post-orb banking bag stats unreadable for ${nextFailTicks} consecutive ticks; falling back to orb re-detect (${formatBagDecisionState(current)}).`,
          );
          return {
            ...current,
            bankingStep: "wait-for-orb",
            bankOrbCandidateCenter: null,
            bankOrbStableTicks: 0,
            bankOrbCachedLocalPoint: null,
            bankOrbCachedRetryCount: 0,
            bankOrbLastClickUsedCache: false,
            bankOrbBagStatsFailTicks: 0,
          };
        }
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Post-orb banking check could not read bag stats yet. Waiting 1 tick before re-check (${nextFailTicks}/${BANK_ORB_BAG_STATS_FAIL_MAX_TICKS}, ${formatBagDecisionState(current)}).`,
        );
        return {
          ...current,
          bankOrbBagStatsFailTicks: nextFailTicks,
          actionLockUntilMs: deadlineFromNowTicks(1),
        };
      }

      const row3InventorySpace = capture.bagStats.row3.value;

      if (shouldExitBankingToMiningSearch(capture.bagStats)) {
        const nearestOrangeBox = findNearestOrangeBox(
          capture.orangeBoxes,
          captureBounds,
          capture.playerAnchorInCapture,
        );
        if (!nearestOrangeBox) {
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Post-orb banking exit condition met (sack=0, row3=28) but orange box was not found (${formatBagDecisionState(current, capture.bagStats)}).`,
          );
          return current;
        }

        const point = toOrangeTopInteractionScreenPoint(nearestOrangeBox, captureBounds);
        const returnTravel = estimateBankTravelToScreenPoint(
          point,
          captureBounds,
          capture.playerAnchorInCapture,
          capture.playerBoxInCapture,
          BANK_RETURN_TO_SEARCH_AFTER_ORANGE_TICKS,
          BANK_RETURN_TO_SEARCH_WAIT_MAX_TICKS,
        );
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Post-orb banking exit condition met (sack=0, row3=28). Clicking nearest orange box at top band (${point.x},${point.y}) and waiting ${returnTravel.etaTicks} tick(s) before returning to search (distance~${returnTravel.distanceTiles.toFixed(2)} tile(s), ${formatBagDecisionState(current, capture.bagStats)}).`,
        );
        clickScreenPoint(point.x, point.y);
        moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
        return {
          ...current,
          bankingStep: "wait-after-return-orange",
          actionLockUntilMs: deadlineFromNowTicks(returnTravel.etaTicks),
        };
      }

      if (row3InventorySpace === 28) {
        const preYellowSackCount = getBagSackCountValue(capture.bagStats);
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Post-orb banking click confirmed by row3=28. Restarting yellow->green->orb banking loop (${formatBagDecisionState(current, capture.bagStats)}).`,
        );
        return {
          ...current,
          bankingStep: "move-south-until-yellow",
          bankValidateStartTile: false,
          bankSouthClicks: 0,
          bankSouthWaitUntilMs: 0,
          bankYellowPreClickSackCount: preYellowSackCount,
          bankYellowSackWaitTicks: 0,
          bankOrbClickCount: 0,
          bankOrbCandidateCenter: null,
          bankOrbStableTicks: 0,
          bankOrbCachedRetryCount: 0,
          bankOrbLastClickUsedCache: false,
          actionLockUntilMs: deadlineFromNowTicks(1),
        };
      }

      const nextCachedRetryCount = current.bankOrbLastClickUsedCache ? current.bankOrbCachedRetryCount + 1 : 0;
      if (current.bankOrbLastClickUsedCache && nextCachedRetryCount < BANK_ORB_CACHED_RETRY_MAX) {
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Cached bank-orb click did not confirm bag update (row3=${row3InventorySpace ?? "?"}); retrying cached point (${nextCachedRetryCount}/${BANK_ORB_CACHED_RETRY_MAX}) before re-detecting icon.`,
        );
        return {
          ...current,
          bankingStep: "wait-for-orb",
          bankOrbCandidateCenter: null,
          bankOrbStableTicks: 0,
          bankOrbCachedRetryCount: nextCachedRetryCount,
        };
      }

      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Post-orb banking row3 is ${row3InventorySpace ?? "?"} (expected 28 to confirm orb click). ${current.bankOrbLastClickUsedCache ? `Cached point failed ${nextCachedRetryCount}/${BANK_ORB_CACHED_RETRY_MAX}; clearing cache and re-detecting orb icon.` : "Retrying orb click."} (${formatBagDecisionState(current, capture.bagStats)}).`,
      );
      return {
        ...current,
        bankingStep: "wait-for-orb",
        bankOrbCandidateCenter: null,
        bankOrbStableTicks: 0,
        bankOrbCachedLocalPoint: current.bankOrbLastClickUsedCache ? null : current.bankOrbCachedLocalPoint,
        bankOrbCachedRetryCount: 0,
        bankOrbLastClickUsedCache: false,
      };
    }

    if (current.bankingStep === "yellow-clicked") {
      if (isActionLocked(current, nowMs)) {
        return current;
      }

      if (isBankSouthWaitActive(current, nowMs)) {
        const remainingTicks = remainingDeadlineTicks(current.bankSouthWaitUntilMs, nowMs);
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking yellow travel in flight; waiting ${remainingTicks} more tick(s) before green click.`,
        );
        return current;
      }

      const preYellowSackCount = current.bankYellowPreClickSackCount;
      const currentSackCount = getBagSackCountValue(capture.bagStats);
      if (preYellowSackCount !== null) {
        if (currentSackCount === null) {
          const nextWaitTicks = current.bankYellowSackWaitTicks + 1;
          if (nextWaitTicks <= BANK_YELLOW_SACK_WAIT_MAX_TICKS) {
            const nearestRetryBankingYellow = findNearestBankingYellowBox(
              capture.bankingYellowBoxes,
              captureBounds,
              capture.playerAnchorInCapture,
            );
            const nearestRetryMineYellow = findNearestYellowNode(
              capture.boxes,
              captureBounds,
              capture.playerAnchorInCapture,
            );
            const retryYellowTarget = nearestRetryBankingYellow ?? nearestRetryMineYellow;
            if (retryYellowTarget) {
              const retryYellowPoint = toYellowInteractionScreenPoint(retryYellowTarget, captureBounds);
              const retryYellowSource = nearestRetryBankingYellow ? "banking-yellow" : "mine-yellow";
              const retryYellowTravel = estimateBankTravelToScreenPoint(
                retryYellowPoint,
                captureBounds,
                capture.playerAnchorInCapture,
                capture.playerBoxInCapture,
                BANK_YELLOW_POST_CLICK_EXTRA_TICKS,
                BANK_YELLOW_WALK_WAIT_MAX_TICKS,
              );
              log(
                `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking waiting for row1 sackCount OCR (left of '+') after yellow click (pre=${preYellowSackCount}, now=missing, wait=${nextWaitTicks}/${BANK_YELLOW_SACK_WAIT_MAX_TICKS}); re-clicking yellow (${retryYellowSource}) at (${retryYellowPoint.x},${retryYellowPoint.y}) (eta=${retryYellowTravel.etaTicks} tick(s), distance~${retryYellowTravel.distanceTiles.toFixed(2)} tile(s)) before green click.`,
              );
              clickScreenPoint(retryYellowPoint.x, retryYellowPoint.y);
              moveMouseAwayFromClickedNode(retryYellowPoint.x, retryYellowPoint.y, captureBounds);
              return {
                ...current,
                bankSouthWaitUntilMs: deadlineFromNowTicks(retryYellowTravel.etaTicks),
                bankYellowSackWaitTicks: nextWaitTicks,
                actionLockUntilMs: deadlineFromNowTicks(BANK_YELLOW_TILE_CLICK_LOCK_TICKS),
              };
            }

            log(
              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking waiting for row1 sackCount OCR (left of '+') after yellow click (pre=${preYellowSackCount}, now=missing, wait=${nextWaitTicks}/${BANK_YELLOW_SACK_WAIT_MAX_TICKS}); yellow tile not visible for re-click, waiting before green click.`,
            );
            return {
              ...current,
              bankYellowSackWaitTicks: nextWaitTicks,
            };
          }

          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking row1 sackCount OCR (left of '+') still missing after ${current.bankYellowSackWaitTicks} tick(s) post-yellow click (pre=${preYellowSackCount}); retrying yellow click flow.`,
          );
          return {
            ...current,
            bankingStep: "move-south-until-yellow",
            bankSouthWaitUntilMs: 0,
            bankYellowPreClickSackCount: null,
            bankYellowSackWaitTicks: 0,
            actionLockUntilMs: deadlineFromNowTicks(1),
          };
        } else if (currentSackCount >= preYellowSackCount) {
          const nextWaitTicks = current.bankYellowSackWaitTicks + 1;
          if (nextWaitTicks <= BANK_YELLOW_SACK_WAIT_MAX_TICKS) {
            const nearestRetryBankingYellow = findNearestBankingYellowBox(
              capture.bankingYellowBoxes,
              captureBounds,
              capture.playerAnchorInCapture,
            );
            const nearestRetryMineYellow = findNearestYellowNode(
              capture.boxes,
              captureBounds,
              capture.playerAnchorInCapture,
            );
            const retryYellowTarget = nearestRetryBankingYellow ?? nearestRetryMineYellow;
            if (retryYellowTarget) {
              const retryYellowPoint = toYellowInteractionScreenPoint(retryYellowTarget, captureBounds);
              const retryYellowSource = nearestRetryBankingYellow ? "banking-yellow" : "mine-yellow";
              const retryYellowTravel = estimateBankTravelToScreenPoint(
                retryYellowPoint,
                captureBounds,
                capture.playerAnchorInCapture,
                capture.playerBoxInCapture,
                BANK_YELLOW_POST_CLICK_EXTRA_TICKS,
                BANK_YELLOW_WALK_WAIT_MAX_TICKS,
              );
              log(
                `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking row1 sackCount (left of '+') has not dropped yet after yellow click (pre=${preYellowSackCount}, now=${currentSackCount}, wait=${nextWaitTicks}/${BANK_YELLOW_SACK_WAIT_MAX_TICKS}); re-clicking yellow (${retryYellowSource}) at (${retryYellowPoint.x},${retryYellowPoint.y}) (eta=${retryYellowTravel.etaTicks} tick(s), distance~${retryYellowTravel.distanceTiles.toFixed(2)} tile(s)) before green click.`,
              );
              clickScreenPoint(retryYellowPoint.x, retryYellowPoint.y);
              moveMouseAwayFromClickedNode(retryYellowPoint.x, retryYellowPoint.y, captureBounds);
              return {
                ...current,
                bankSouthWaitUntilMs: deadlineFromNowTicks(retryYellowTravel.etaTicks),
                bankYellowSackWaitTicks: nextWaitTicks,
                actionLockUntilMs: deadlineFromNowTicks(BANK_YELLOW_TILE_CLICK_LOCK_TICKS),
              };
            }

            log(
              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking row1 sackCount (left of '+') has not dropped yet after yellow click (pre=${preYellowSackCount}, now=${currentSackCount}, wait=${nextWaitTicks}/${BANK_YELLOW_SACK_WAIT_MAX_TICKS}); yellow tile not visible for re-click, waiting before green click.`,
            );
            return {
              ...current,
              bankYellowSackWaitTicks: nextWaitTicks,
            };
          }

          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking row1 sackCount (left of '+') did not drop after ${current.bankYellowSackWaitTicks} tick(s) post-yellow click (pre=${preYellowSackCount}, now=${currentSackCount}); retrying yellow click flow.`,
          );
          return {
            ...current,
            bankingStep: "move-south-until-yellow",
            bankSouthWaitUntilMs: 0,
            bankYellowPreClickSackCount: null,
            bankYellowSackWaitTicks: 0,
            actionLockUntilMs: deadlineFromNowTicks(1),
          };
        } else {
          log(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking row1 sackCount (left of '+') dropped after yellow click (${preYellowSackCount} -> ${currentSackCount}). Proceeding to green click.`,
          );
        }
      }

      const nearestBankingGreen = findNearestBankingGreenBox(
        capture.bankingGreenBoxes,
        captureBounds,
        capture.playerAnchorInCapture,
      );
      const nearestMineGreen = selectNearestGreenMotherlodeNode(
        capture.greenBoxes,
        captureBounds,
        capture.playerAnchorInCapture,
      );
      const greenTarget = nearestBankingGreen ?? nearestMineGreen;
      if (!greenTarget) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking yellow travel complete but green box not found; waiting to retry green detection.`,
        );
        return current;
      }

      const greenPoint = toYellowInteractionScreenPoint(greenTarget, captureBounds);
      const greenSource = nearestBankingGreen ? "banking-green" : "mine-green";
      const greenTravel = estimateBankTravelToScreenPoint(
        greenPoint,
        captureBounds,
        capture.playerAnchorInCapture,
        capture.playerBoxInCapture,
        BANK_GREEN_POST_CLICK_EXTRA_TICKS,
        BANK_GREEN_WALK_WAIT_MAX_TICKS,
      );
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking clicking green box (${greenSource}) at (${greenPoint.x},${greenPoint.y}); delaying orb detection for ${greenTravel.etaTicks} tick(s) (distance~${greenTravel.distanceTiles.toFixed(2)} tile(s)).`,
      );
      clickScreenPoint(greenPoint.x, greenPoint.y);
      moveMouseAwayFromClickedNode(greenPoint.x, greenPoint.y, captureBounds);
      return {
        ...current,
        bankingStep: "green-clicked",
        bankSouthWaitUntilMs: deadlineFromNowTicks(greenTravel.etaTicks),
        bankYellowPreClickSackCount: null,
        bankYellowSackWaitTicks: 0,
        bankOrbClickCount: 0,
        bankOrbCandidateCenter: null,
        bankOrbStableTicks: 0,
        actionLockUntilMs: deadlineFromNowTicks(BANK_GREEN_CLICK_LOCK_TICKS),
      };
    }

    if (current.bankingStep === "green-clicked") {
      if (isActionLocked(current, nowMs)) {
        return current;
      }

      if (isBankSouthWaitActive(current, nowMs)) {
        const remainingTicks = remainingDeadlineTicks(current.bankSouthWaitUntilMs, nowMs);
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking green travel in flight; waiting ${remainingTicks} more tick(s) before bank orb detection.`,
        );
        return current;
      }

      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking green travel settled. Starting bank orb detection.`,
      );
      current = {
        ...current,
        bankingStep: "wait-for-orb",
        bankOrbCandidateCenter: null,
        bankOrbStableTicks: 0,
      };
    }

    if (current.bankingStep === "wait-for-orb") {
      if (isActionLocked(current, nowMs)) {
        return current;
      }

      const orbReferenceBitmap = getBankDepositOrbReferenceBitmap();
      if (!orbReferenceBitmap) {
        return current;
      }

      if (current.bankOrbCachedLocalPoint) {
        if (!isBankOrbLocalPointInBounds(current.bankOrbCachedLocalPoint, capture.bitmap)) {
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Cached bank orb point (${current.bankOrbCachedLocalPoint.x},${current.bankOrbCachedLocalPoint.y}) is outside current capture bounds (${capture.bitmap.width}x${capture.bitmap.height}); clearing cache and re-detecting.`,
          );
          current = {
            ...current,
            bankOrbCachedLocalPoint: null,
            bankOrbCachedRetryCount: 0,
            bankOrbLastClickUsedCache: false,
            bankOrbCandidateCenter: null,
            bankOrbStableTicks: 0,
          };
        } else {
          const localSearch = resolveBankOrbLocalSearchBounds(current.bankOrbCachedLocalPoint, capture.bitmap);
          const localSearchBitmap = cropRobotBitmap(
            capture.bitmap,
            localSearch.x,
            localSearch.y,
            localSearch.width,
            localSearch.height,
          );
          const localOrbResult = detectBankDepositIconWithOrb(orbReferenceBitmap, localSearchBitmap);
          if (localOrbResult.detection) {
            const orbLocalPoint = {
              x: localSearch.x + localOrbResult.detection.centerX,
              y: localSearch.y + localOrbResult.detection.centerY,
            };
            const orbPoint = toScreenPointFromLocalPoint(orbLocalPoint.x, orbLocalPoint.y, captureBounds);
            const nextBankOrbClickCount = current.bankOrbClickCount + 1;
            const localOrbResultInScene = mapLocalOrbResultToScene(localOrbResult, {
              x: localSearch.x,
              y: localSearch.y,
            });
            saveBankDepositOrbDebugArtifacts(
              "click-cached-local",
              current.loopIndex,
              nextBankOrbClickCount,
              capture.bitmap,
              localOrbResultInScene,
            );
            log(
              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Cached bank-orb local scan (${localSearch.width}x${localSearch.height}) confirmed orb at (${orbLocalPoint.x},${orbLocalPoint.y}); clicking (${orbPoint.x},${orbPoint.y}) (${nextBankOrbClickCount}/${BANK_ORB_CONFIRM_CLICK_COUNT}).`,
            );
            clickScreenPoint(orbPoint.x, orbPoint.y);
            moveMouseAwayFromClickedNode(orbPoint.x, orbPoint.y, captureBounds);
            return {
              ...current,
              bankingStep: "wait-after-orb-click",
              bankOrbClickCount: nextBankOrbClickCount,
              bankOrbCandidateCenter: null,
              bankOrbStableTicks: 0,
              bankOrbCachedLocalPoint: orbLocalPoint,
              bankOrbLastClickUsedCache: true,
              bankOrbBagStatsFailTicks: 0,
              actionLockUntilMs: deadlineFromNowTicks(BANK_ORB_CLICK_LOCK_TICKS),
            };
          }

          if (current.loopIndex % 2 === 0) {
            log(
              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Cached bank-orb local scan (${localSearch.width}x${localSearch.height}) found no orb yet; clearing cache and falling back to full-scene detection.`,
            );
          }
          current = {
            ...current,
            bankOrbCachedLocalPoint: null,
            bankOrbCachedRetryCount: 0,
            bankOrbLastClickUsedCache: false,
            bankOrbCandidateCenter: null,
            bankOrbStableTicks: 0,
          };
        }
      }

      const orbResult = detectBankDepositIconWithOrb(orbReferenceBitmap, capture.bitmap);
      if (!orbResult.detection) {
        if (current.bankOrbCandidateCenter || current.bankOrbStableTicks > 0) {
          return {
            ...current,
            bankOrbCandidateCenter: null,
            bankOrbStableTicks: 0,
          };
        }
        if (current.loopIndex % 3 === 0) {
          log(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Waiting for bank deposit orb after green click (sceneKeypoints=${orbResult.sceneKeypointCount}, rawMatches=${orbResult.rawMatchCount}).`,
          );
        }
        return current;
      }

      if (!isPlausibleBankOrbLocation(orbResult.detection, capture.bitmap)) {
        if (current.loopIndex % 2 === 0) {
          const minCenterY = Math.round(capture.bitmap.height * BANK_ORB_MIN_CENTER_Y_RATIO);
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Ignoring bank orb candidate at (${orbResult.detection.centerX},${orbResult.detection.centerY}) because it is above the banking UI band (minY=${minCenterY}).`,
          );
          saveBankDepositOrbDebugArtifacts(
            "reject-upper-screen",
            current.loopIndex,
            current.bankOrbClickCount,
            capture.bitmap,
            orbResult,
          );
        }
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Re-attempting green click after rejecting upper-screen orb candidate.`,
        );
        return {
          ...current,
          bankingStep: "yellow-clicked",
          bankSouthWaitUntilMs: 0,
          bankYellowPreClickSackCount: null,
          bankYellowSackWaitTicks: 0,
          bankOrbCandidateCenter: null,
          bankOrbStableTicks: 0,
        };
      }

      const nextBankOrbStableTicks = getNextBankOrbStableTicks(current, orbResult.detection);
      if (nextBankOrbStableTicks < BANK_ORB_STABLE_TICKS) {
        if (current.loopIndex % 2 === 0) {
          log(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bank orb candidate at (${orbResult.detection.centerX},${orbResult.detection.centerY}) matched but is only stable ${nextBankOrbStableTicks}/${BANK_ORB_STABLE_TICKS} tick(s). Waiting for one more matching frame before clicking.`,
          );
        }
        return {
          ...current,
          bankOrbCandidateCenter: {
            x: orbResult.detection.centerX,
            y: orbResult.detection.centerY,
          },
          bankOrbStableTicks: nextBankOrbStableTicks,
        };
      }

      const orbPoint = toScreenPointFromLocalPoint(
        orbResult.detection.centerX,
        orbResult.detection.centerY,
        captureBounds,
      );
      const nextBankOrbClickCount = current.bankOrbClickCount + 1;
      saveBankDepositOrbDebugArtifacts("click", current.loopIndex, nextBankOrbClickCount, capture.bitmap, orbResult);
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bank deposit orb detected at (${orbResult.detection.centerX},${orbResult.detection.centerY}) box=${orbResult.detection.width}x${orbResult.detection.height} score=${orbResult.detection.score.toFixed(1)} inliers=${orbResult.detection.inlierCount}; clicking (${orbPoint.x},${orbPoint.y}) (${nextBankOrbClickCount}/${BANK_ORB_CONFIRM_CLICK_COUNT}).`,
      );
      clickScreenPoint(orbPoint.x, orbPoint.y);
      moveMouseAwayFromClickedNode(orbPoint.x, orbPoint.y, captureBounds);
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bank deposit orb click ${nextBankOrbClickCount}/${BANK_ORB_CONFIRM_CLICK_COUNT} complete. Waiting to verify bag/inventory state before deciding next action.`,
      );
      return {
        ...current,
        bankingStep: "wait-after-orb-click",
        bankOrbClickCount: nextBankOrbClickCount,
        bankOrbCandidateCenter: null,
        bankOrbStableTicks: 0,
        bankOrbCachedLocalPoint: {
          x: orbResult.detection.centerX,
          y: orbResult.detection.centerY,
        },
        bankOrbCachedRetryCount: 0,
        bankOrbLastClickUsedCache: false,
        bankOrbBagStatsFailTicks: 0,
        actionLockUntilMs: deadlineFromNowTicks(BANK_ORB_CLICK_LOCK_TICKS),
      };
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    if (current.phase === "descending-to-bank" && current.bankingStep === "find-orange") {
      const nearestOrangeBox = findNearestOrangeBox(capture.orangeBoxes, captureBounds, capture.playerAnchorInCapture);
      if (nearestOrangeBox) {
        const point = toOrangeInteractionScreenPoint(nearestOrangeBox, captureBounds);
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking phase clicking orange box at (${point.x},${point.y}) rgb˜(${BANK_ORANGE_TARGET_R},${BANK_ORANGE_TARGET_G},${BANK_ORANGE_TARGET_B}) pixels=${nearestOrangeBox.pixelCount}.`,
        );
        clickScreenPoint(point.x, point.y);
        moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
        return {
          ...current,
          bankingStep: "wait-after-orange",
          bankSouthClicks: 0,
          bankSouthWaitUntilMs: 0,
          bankLadderRecheckCount: 0,
          actionLockUntilMs: deadlineFromNowTicks(Math.max(BANK_CLICK_LOCK_TICKS, BANK_POST_ORANGE_WAIT_TICKS)),
        };
      }

      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Down-ladder phase active but orange box was not found.`);
      return current;
    }

    if (current.phase !== "banking") {
      return current;
    }

    if (current.bankSouthClicks === 0 && current.bankValidateStartTile) {
      if (capture.playerTileFromOverlay && !isAtBankLadderDownTile(capture.playerTileFromOverlay)) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking start tile mismatch before first south click (tile=${capture.playerTileFromOverlay.x},${capture.playerTileFromOverlay.y},${capture.playerTileFromOverlay.z}). Returning to ladder.`,
        );
        return resetToDescendingToBank(current);
      }

      if (capture.playerTileFromOverlay && isAtBankLadderDownTile(capture.playerTileFromOverlay)) {
        current = {
          ...current,
          bankValidateStartTile: false,
        };
      }
    }

    const nearestBankingYellow = findNearestBankingYellowBox(
      capture.bankingYellowBoxes,
      captureBounds,
      capture.playerAnchorInCapture,
    );
    const nearestMineYellow = findNearestYellowNode(capture.boxes, captureBounds, capture.playerAnchorInCapture);
    const yellowTarget = nearestBankingYellow ?? nearestMineYellow;
    if (yellowTarget) {
      const yellowPoint = toYellowInteractionScreenPoint(yellowTarget, captureBounds);
      const yellowSource = nearestBankingYellow ? "banking-yellow" : "mine-yellow";
      const immediateSackCount = getBagSackCountValue(capture.bagStats);
      const preYellowSackCount = current.bankYellowPreClickSackCount ?? immediateSackCount;
      const yellowTravel = estimateBankTravelToScreenPoint(
        yellowPoint,
        captureBounds,
        capture.playerAnchorInCapture,
        capture.playerBoxInCapture,
        BANK_YELLOW_POST_CLICK_EXTRA_TICKS,
        BANK_YELLOW_WALK_WAIT_MAX_TICKS,
      );
      if (preYellowSackCount === null) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking row1 sackCount OCR (left of '+') missing before yellow click; sack-drop confirmation gate is unavailable for this yellow attempt.`,
        );
      }
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking found yellow tile (${yellowSource}) after ${current.bankSouthClicks} south-west click(s) at (${yellowPoint.x},${yellowPoint.y}); clicking (tileDx~${yellowTravel.dxTiles.toFixed(2)}, tileDy~${yellowTravel.dyTiles.toFixed(2)}, eta=${yellowTravel.etaTicks} tick(s), distance~${yellowTravel.distanceTiles.toFixed(2)} tile(s)).`,
      );
      saveBankYellowDebugArtifacts("click", current.loopIndex, yellowSource, capture, captureBounds, yellowPoint);
      clickScreenPoint(yellowPoint.x, yellowPoint.y);
      moveMouseAwayFromClickedNode(yellowPoint.x, yellowPoint.y, captureBounds);
      return {
        ...current,
        bankingStep: "yellow-clicked",
        bankSouthWaitUntilMs: deadlineFromNowTicks(yellowTravel.etaTicks),
        bankYellowPreClickSackCount: preYellowSackCount,
        bankYellowSackWaitTicks: 0,
        actionLockUntilMs: deadlineFromNowTicks(BANK_YELLOW_TILE_CLICK_LOCK_TICKS),
      };
    }

    if (isBankSouthWaitActive(current, nowMs)) {
      const remainingTicks = remainingDeadlineTicks(current.bankSouthWaitUntilMs, nowMs);
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking south movement still in flight; waiting ${remainingTicks} more tick(s) before re-click.`,
      );
      return current;
    }

    const southMove = toSouthMoveScreenPoint(captureBounds, capture.playerAnchorInCapture, capture.playerBoxInCapture);
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking yellow tile not visible; clicking south-west at (${southMove.point.x},${southMove.point.y}) dx=${southMove.dxPx} dy=${southMove.dyPx} tileDx~${southMove.dxTiles.toFixed(2)} tileDy~${southMove.dyTiles.toFixed(2)} tilePx~${southMove.tilePx} eta=${southMove.etaTicks} tick(s) distance~${southMove.distanceTiles.toFixed(2)} tile(s).`,
    );
    clickScreenPoint(southMove.point.x, southMove.point.y);
    moveMouseAwayFromClickedNode(southMove.point.x, southMove.point.y, captureBounds);
    return {
      ...current,
      bankingStep: "move-south-until-yellow",
      bankSouthClicks: current.bankSouthClicks + 1,
      bankSouthWaitUntilMs: deadlineFromNowTicks(southMove.etaTicks + BANK_SOUTH_POST_CLICK_SETTLE_TICKS),
      actionLockUntilMs: deadlineFromNowTicks(BANK_SOUTH_CLICK_LOCK_TICKS),
    };
  }

  if (current.phase === "searching") {
    const greenNode = selectNearestGreenMotherlodeNode(
      capture.greenBoxes,
      captureBounds,
      capture.playerAnchorInCapture,
    );

    if (!greenNode) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} No green node found (boxes=${capture.boxes.length}, green=${capture.greenBoxes.length}).`,
      );
      return current;
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const interactionPoint = toNodeInteractionScreenPoint(greenNode, captureBounds);
    const tileRead = await hoverAndReadTile(interactionPoint.x, interactionPoint.y, captureBounds);
    if (!tileRead.tile) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Tile read failed for node (source=${tileRead.source}, raw='${tileRead.rawLine ?? ""}').`,
      );
      return current;
    }

    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Clicking node at tile (${tileRead.tile.x},${tileRead.tile.y},${tileRead.tile.z}) via ${tileRead.source}.`,
    );
    clickScreenPoint(interactionPoint.x, interactionPoint.y);
    moveMouseAwayFromClickedNode(interactionPoint.x, interactionPoint.y, captureBounds);
    return {
      ...current,
      phase: "mining",
      activeTile: tileRead.tile,
      // Track by the exact click location so active matching stays on the
      // interacted vein when adjacent node boxes are tightly clustered.
      activeScreen: { x: interactionPoint.x, y: interactionPoint.y },
      missingActiveTicks: 0,
      miningWaitTicks: 0,
      activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
      actionLockUntilMs: deadlineFromNowTicks(NODE_CLICK_LOCK_TICKS),
    };
  }

  if (!current.activeScreen) {
    warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Missing active tracking point; returning to search.`);
    return resetToSearching(current);
  }

  const nearbyAny = findNodeNearActiveScreen(capture.boxes, current.activeScreen, captureBounds);
  if (nearbyAny) {
    if (nearbyAny.color === "yellow") {
      log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node turned yellow. Searching next node.`);
      return resetToSearching(current);
    }

    const yellowTransitionFallback = detectYellowTransitionNearActivePoint(
      capture.bitmap,
      current.activeScreen,
      captureBounds,
    );
    if (yellowTransitionFallback.transitioned) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node yellow fallback triggered (yellow=${yellowTransitionFallback.yellowPixels}, green=${yellowTransitionFallback.greenPixels}, sample=${yellowTransitionFallback.samplePixels}). Searching next node.`,
      );
      return resetToSearching(current);
    }

    const miningWaitTicks = current.miningWaitTicks + 1;
    if (miningWaitTicks >= current.activeNodeMaxWaitTicks) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node still ${nearbyAny.color} after ${miningWaitTicks} ticks. Re-searching.`,
      );
      return resetToSearching(current);
    }

    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Waiting on active node (${nearbyAny.color}) tick=${miningWaitTicks}/${current.activeNodeMaxWaitTicks}.`,
    );
    return { ...current, miningWaitTicks, missingActiveTicks: 0 };
  }

  const missingActiveTicks = current.missingActiveTicks + 1;
  if (missingActiveTicks <= ACTIVE_NODE_MISSING_GRACE_TICKS) {
    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node not detected (${missingActiveTicks}/${ACTIVE_NODE_MISSING_GRACE_TICKS}).`,
    );
    return { ...current, missingActiveTicks };
  }

  log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Lost active node; returning to search.`);
  return resetToSearching(current);
}

async function runLoop(captureBounds: ScreenCaptureBounds): Promise<void> {
  if (isLoopRunning) {
    log(`Automate Bot (${BOT_NAME}): loop already running.`);
    return;
  }

  isLoopRunning = true;
  setAutomateBotCurrentStep(MINING_MOTHERLODE_MINE_V2_BOT_ID);

  let state: BotState = detectStartupBotState(captureBounds);

  try {
    while (AppState.automateBotRunning) {
      const tickStartedAt = Date.now();

      try {
        state = await runTick(state, captureBounds);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`#${state.loopIndex + 1} Automate Bot (${BOT_NAME}): tick error - ${message}`);
      }

      const tickElapsedMs = Date.now() - tickStartedAt;
      const remainingTickMs = BASE_TICK_MS - tickElapsedMs;
      // Always yield at least once so stop events are processed, even when a tick overruns.
      const sleepMs = remainingTickMs > 0 ? remainingTickMs : 1;
      await sleepWithAbort(sleepMs);
      if (!AppState.automateBotRunning) break;
    }
  } finally {
    isLoopRunning = false;
    startedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onMotherlodeMineBotV2Start(): void {
  setCurrentLogLoopIndex(0);

  if (!isLoopRunning) {
    startedAtMs = Date.now();
    debugCaptureIndex = 0;
    lastClickPoint = null;
    bankDepositOrbReferenceBitmap = null;
    bankDepositOrbReferencePath = null;
    bankDepositOrbReferenceLoadAttempted = false;
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Automate Bot (${BOT_NAME}) config: tick=${BASE_TICK_MS}ms, hover-before-read=${ENABLE_NODE_HOVER_BEFORE_TILE_READ ? "on" : "off"}, obstacle-red-click=${ENABLE_OBSTACLE_RED_CLICK ? "on" : "off"}, post-click-mouse=${POST_CLICK_MOUSE_MOVE_MODE}, tick-capture={search:${DEBUG_TICK_CAPTURE_ENABLED.search ? "on" : "off"}, mine:${DEBUG_TICK_CAPTURE_ENABLED.mine ? "on" : "off"}, deposit:${DEBUG_TICK_CAPTURE_ENABLED.deposit ? "on" : "off"}, bank:${DEBUG_TICK_CAPTURE_ENABLED.bank ? "on" : "off"}, bank-ladder:${DEBUG_TICK_CAPTURE_ENABLED["bank-ladder"] ? "on" : "off"}}.`,
  );

  const window = getRuneLite();
  if (!window) {
    const message = `${BOT_NAME} could not start because the RuneLite window was not found.`;
    warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();

  const windowBounds = window.getBounds();
  const logicalBounds: ScreenCaptureBounds = {
    x: Number(windowBounds.x),
    y: Number(windowBounds.y),
    width: Number(windowBounds.width),
    height: Number(windowBounds.height),
  };

  if (![logicalBounds.x, logicalBounds.y, logicalBounds.width, logicalBounds.height].every(Number.isFinite)) {
    const message = "Cannot start - invalid RuneLite window bounds.";
    warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
    const message = "Cannot start - RuneLite window has zero size.";
    warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  log(`Automate Bot (${BOT_NAME}): startup camera prep (scroll down + compass north).`);
  moveMouseToWindowCenter(logicalBounds);
  scrollCameraDownToMaximum();
  tapCompassNorth();

  const scaleFactor = getWindowsDisplayScaleFactor(logicalBounds);
  const captureBounds = toPhysicalBounds(logicalBounds, scaleFactor);
  currentWindowsScalePercent = Math.round(scaleFactor * 100);

  // Warm up the ORB reference once so bank-orb detection can run without first-use delay.
  if (!getBankDepositOrbReferenceBitmap()) {
    warn(
      `Automate Bot (${BOT_NAME}): bank deposit orb reference not loaded yet; banking orb click step will keep waiting (lastPath=${bankDepositOrbReferencePath ?? "n/a"}).`,
    );
  }

  void runLoop(captureBounds);
}
