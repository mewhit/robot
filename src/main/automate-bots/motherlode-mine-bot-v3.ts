import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { keyToggle, mouseClick, moveMouse, scrollMouse } from "robotjs";
import { screen as electronScreen } from "electron";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap } from "../windowsScreenCapture";
import { MINING_MOTHERLODE_MINE_V3_BOT_ID } from "./definitions";
import {
  MotherlodeBagFullState,
  detectMotherlodeBagFullBoxInScreenshot,
} from "./shared/motherlode-bag-full-box-detector";
import { MotherlodeBagStats, detectMotherlodeBagStatsInScreenshot } from "./shared/motherlode-bag-stats-detector";
import {
  MotherlodeDepositBox,
  detectMotherlodeDepositBoxesInScreenshot,
} from "./shared/motherlode-deposit-box-detector";
import { MotherlodeMineBox, detectMotherlodeMineBoxesInScreenshot } from "./shared/motherlode-mine-box-detector";
import {
  MotherlodeObstacleRedBox,
  detectMotherlodeObstacleRedBoxesInScreenshot,
  saveBitmapWithMotherlodeObstacleRedBoxes,
} from "./shared/motherlode-obstacle-red-detector";
import {
  MotherlodeBankingYellowBox,
  detectBestMotherlodeBankingYellowBoxInScreenshot,
} from "./shared/motherlode-banking-yellow-detector";
import {
  MotherlodeBankingGreenBox,
  detectBestMotherlodeBankingGreenBoxInScreenshot,
  saveBitmapWithMotherlodeBankingGreenBoxes,
} from "./shared/motherlode-banking-green-detector";
import { detectBankDepositIconWithOrb } from "./shared/bank-deposit-orb-detector";
import { PlayerBox, detectBestPlayerBoxInScreenshot, saveBitmapWithPlayerBoxes } from "./shared/player-box-detector";
import { detectOverlayBoxInScreenshot } from "./shared/coordinate-box-detector";
import { isPlayerCollidingWithObstacle as isPlayerCollidingWithObstacleBox } from "./shared/player-obstacle-collision";
import { createMineFunction, runBotEngine, sleepWithAbort } from "./engine/bot-engine";
import { RobotBitmap } from "./shared/ocr-engine";

const BOT_NAME = "Motherlode Mine V3";
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
const ENABLE_COLLISION_DEBUG_IMAGE = true;
const ENABLE_BANK_DEPOSIT_DEBUG_IMAGE = true;
const POST_CLICK_MOUSE_MOVE_MODE: PostClickMouseMoveMode = "off";
const POST_CLICK_MOUSE_OFFSET_PX = 200;
const POST_CLICK_CORNER_MARGIN_PX = 6;
const OBSTACLE_PLAYER_COLLISION_PADDING_PX = 4;
const DEPOSIT_TRIGGER_STABLE_TICKS = 2;
const NODE_CLICK_LOCK_TICKS = 3;
const OBSTACLE_CLICK_LOCK_TICKS = 2;
const DEPOSIT_CLICK_LOCK_TICKS = 1;
const ACTIVE_NODE_MISSING_GRACE_TICKS = 2;
const ACTIVE_NODE_MAX_WAIT_TICKS_MIN = 80;
const ACTIVE_NODE_MAX_WAIT_TICKS_MAX = 86;
const ACTIVE_NODE_MATCH_RADIUS_PX = 34;
const ACTIVE_NODE_YELLOW_PREFERENCE_MARGIN_PX = 6;
const BOX_CLICK_INNER_RATIO = 0.5;
const BOX_CLICK_PICK_MAX_ATTEMPTS = 12;
const BOX_CLICK_BORDER_EXCLUSION_PX = 1;
const MOVE_PLAYER_SPEED_TILES_PER_TICK = 2;
const MOVE_TILE_PX_FALLBACK = 64;
const MOVE_TILE_PX_MIN = 24;
const MOVE_TILE_PX_MAX = 96;
const MOVE_WAIT_MAX_TICKS = 10;
const MOVE_WAIT_EXTRA_TICKS = 1;
const MOVE_OBSTACLE_CHECK_MAX_REMAINING_TICKS = 2;
const MOVE_EARLY_COMPLETE_MAX_REMAINING_TICKS = 1;
const MOVE_EARLY_COMPLETE_RADIUS_TILES = 1.2;
const BANK_EXPECTED_LADDER_DOWN_X = 3755;
const BANK_EXPECTED_LADDER_DOWN_Y = 5672;
const BANK_EXPECTED_LADDER_UP_X = 3755;
const BANK_EXPECTED_LADDER_UP_Y = 5675;
const BANK_LADDER_RECHECK_MAX = 2;
const BANK_LADDER_RECHECK_WAIT_MIN_TICKS = 2;
const BANK_LADDER_RECHECK_WAIT_MAX_TICKS = 4;
const BANK_LADDER_UP_RECHECK_MAX = 2;
const BANK_LADDER_UP_RECHECK_WAIT_MIN_TICKS = 2;
const BANK_LADDER_UP_RECHECK_WAIT_MAX_TICKS = 4;
const BANK_LADDER_POST_CLICK_WAIT_TICKS = 3;
const BANK_YELLOW_TILE_CLICK_LOCK_TICKS = 2;
const BANK_YELLOW_SACK_WAIT_MAX_TICKS = 8;
const BANK_ORB_CLICK_LOCK_TICKS = 2;
const BANK_ORB_ESCAPE_WAIT_TICKS = 1;
const BANK_ORB_INVENTORY_EMPTY_VALUE = 28;
const BANK_SOUTH_CLICK_RANDOM_RADIUS_PX = 14;
const BANK_SOUTHWEST_CLICK_OFFSET_TILES_X = -1.15;
const BANK_SOUTHWEST_CLICK_OFFSET_TILES_Y = 2.25;
const BANK_SOUTHWEST_CLICK_RANDOM_TILE_RADIUS = 0.28;
const BANK_SOUTHWEST_CLICK_NORTH_SHIFT_TILES = 3.5;
const BANK_SOUTHWEST_CLICK_EXTRA_WEST_TILES = 0.6;
const BANK_MOVE_MARGIN_PX = 8;
const BANK_DEPOSIT_ORB_REFERENCE_ICON = "test-images/icon/bank-deposit/bank-deposit-icon.png";
const BANK_ORANGE_TARGET_R = 255;
const BANK_ORANGE_TARGET_G = 125;
const BANK_ORANGE_TARGET_B = 0;
const BANK_ORANGE_R_TOLERANCE = 10;
const BANK_ORANGE_G_TOLERANCE = 18;
const BANK_ORANGE_B_TOLERANCE = 20;
const BANK_ORANGE_MIN_COMPONENT_PIXELS = 40;

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
type BotPhase = "searching" | "mining" | "moving" | "depositing" | "banking";
type EngineFunctionKey =
  | "mine"
  | "searchOre"
  | "move"
  | "depositPayDirt"
  | "searchDepositPayDirt"
  | "searchLadder"
  | "useLadder"
  | "searchSack"
  | "fillInventory"
  | "searchBankDeposit"
  | "searchBankPayDirtDeposit"
  | "depositBankPayDirt"
  | "searchBankOrb"
  | "closeBankAfterOrb"
  | "checkInventoryEmpty"
  | "searchReturnLadder"
  | "useReturnLadder";
type BankingFunctionKey =
  | "searchSack"
  | "fillInventory"
  | "searchBankDeposit"
  | "searchBankPayDirtDeposit"
  | "depositBankPayDirt"
  | "searchBankOrb"
  | "closeBankAfterOrb"
  | "checkInventoryEmpty"
  | "searchReturnLadder"
  | "useReturnLadder";
type MineSearchColor = "green" | "yellow" | "cyan";
type MineTargetBox = MotherlodeMineBox;
type OrangeTargetBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
};
type MoveDestinationFunction = Exclude<EngineFunctionKey, "move">;
type EngineStateSnapshot = {
  phase: Exclude<BotPhase, "moving">;
  currentFunction: MoveDestinationFunction;
};
type MoveDestination = {
  phase: Exclude<BotPhase, "moving">;
  currentFunction: MoveDestinationFunction;
  actionLockTicks?: number;
  useTargetAsActiveScreen?: boolean;
};
type PendingMoveTarget = {
  targetScreen: { x: number; y: number };
  destination: MoveDestination;
  latestState: EngineStateSnapshot;
};

type HoverTileReadResult = {
  tile: TileCoord | null;
  source: HoverTileReadSource;
  rawLine: string | null;
};

type SharedBotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  latestPhase: BotPhase | null;
  actionLockUntilMs: number;
};

type BotState =
  | (SharedBotState & {
      phase: Exclude<BotPhase, "moving">;
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
      ladderRecheckCount: number;
      bankSouthClicks: number;
      bankYellowPreClickSackCount: number | null;
      bankYellowSackWaitTicks: number;
      bankOrbClickCount: number;
    })
  | MovingBotState;

type MovingBotState = SharedBotState & {
  phase: "moving";
  pendingMove: PendingMoveTarget;
};

type MineCaptureResult = {
  bitmap: RobotBitmap;
  boxes: MineTargetBox[];
  obstacleBox: MotherlodeObstacleRedBox | null;
  playerBoxInCapture: PlayerBox | null;
  playerAnchorInCapture: { x: number; y: number } | null;
  bagFullState: MotherlodeBagFullState;
};

type EngineTickCapture = {
  bitmap: RobotBitmap;
  captureBitmap: () => RobotBitmap;
};

let isLoopRunning = false;
let startedAtMs: number | null = null;
let lastClickPoint: { x: number; y: number } | null = null;
let currentWindowsScalePercent = 100;
let currentLogLoopIndex = 0;
let currentLogPhase: BotPhase | "startup" = "startup";
let bankDepositOrbReferenceBitmap: RobotBitmap | null = null;
let bankDepositOrbReferenceLoadAttempted = false;

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

function setCurrentLogPhase(phase: BotPhase | null | undefined): void {
  if (
    phase === "searching" ||
    phase === "mining" ||
    phase === "moving" ||
    phase === "depositing" ||
    phase === "banking"
  ) {
    currentLogPhase = phase;
    return;
  }

  currentLogPhase = "startup";
}

function stripAutomateBotPrefix(message: string): string {
  return message
    .replace(/^Automate Bot\s*\([^)]*\):\s*/, "")
    .replace(/^Automate Bot\s*/, "")
    .trim();
}

function stripLeadingSubPhaseTag(message: string): string {
  return message.replace(/^\[[^\]]+\]\s*/, "").trimStart();
}

function withLoopCountAtBeginning(message: string): string {
  const cleaned = stripAutomateBotPrefix(message);
  const prefixedLoop = cleaned.match(/^#(\d+)\s*(.*)$/);

  if (prefixedLoop) {
    const [, loop, rest] = prefixedLoop;
    const normalized = stripLeadingSubPhaseTag(rest);
    return `#${loop} [${currentLogPhase}] ${normalized}`.trimEnd();
  }

  const normalized = stripLeadingSubPhaseTag(cleaned);
  return `#${currentLogLoopIndex} [${currentLogPhase}] ${normalized}`.trimEnd();
}

function log(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] ${withLoopCountAtBeginning(message)}`);
}

function warn(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] ${withLoopCountAtBeginning(message)}`);
}

function sanitizeDebugToken(token: string): string {
  return (
    token
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "event"
  );
}

function saveCollisionDebugArtifacts(
  phase: BotPhase,
  loopIndex: number,
  bitmap: RobotBitmap,
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox,
): void {
  if (!ENABLE_COLLISION_DEBUG_IMAGE) {
    return;
  }

  const phaseToken = sanitizeDebugToken(phase);
  const base = path.join(DEBUG_DIR, `v3-collision-${phaseToken}-loop${loopIndex}`);
  const obstaclePath = `${base}-obstacle.png`;
  const playerPath = `${base}-player.png`;

  saveBitmapWithMotherlodeObstacleRedBoxes(bitmap, [obstacleBox], obstaclePath);
  void saveBitmapWithPlayerBoxes(bitmap, playerBoxInCapture ? [playerBoxInCapture] : [], playerPath).catch((error) => {
    warn(
      `Automate Bot (${BOT_NAME}): collision debug player screenshot failed for loop #${loopIndex}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  warn(`Automate Bot (${BOT_NAME}): collision debug screenshots saved obstacle=${obstaclePath}, player=${playerPath}.`);
}

function saveBankDepositDebugArtifact(
  loopIndex: number,
  bitmap: RobotBitmap,
  bankDepositBox: MotherlodeBankingGreenBox,
): void {
  if (!ENABLE_BANK_DEPOSIT_DEBUG_IMAGE) {
    return;
  }

  const filename = path.join(DEBUG_DIR, `v3-bank-deposit-loop${loopIndex}.png`);
  saveBitmapWithMotherlodeBankingGreenBoxes(bitmap, [bankDepositBox], filename);
  warn(`Automate Bot (${BOT_NAME}): bank-deposit debug screenshot saved ${filename}.`);
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
      `Automate Bot (${BOT_NAME}): bank deposit orb reference icon not found (${BANK_DEPOSIT_ORB_REFERENCE_ICON}). Banking orb step will wait until icon is available.`,
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
    log(
      `Automate Bot (${BOT_NAME}): bank deposit orb reference loaded (${bankDepositOrbReferenceBitmap.width}x${bankDepositOrbReferenceBitmap.height}) from ${referencePath}.`,
    );
    return bankDepositOrbReferenceBitmap;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Automate Bot (${BOT_NAME}): failed to load bank deposit orb reference icon at ${referencePath}: ${message}`);
    return null;
  }
}

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }

  stopAutomateBot("bot");
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

function tapEscapeAfterBankOrb(): void {
  if (typeof keyToggle !== "function") {
    warn(`Automate Bot (${BOT_NAME}): RobotJS keyToggle unavailable; skipping Escape after bank orb click.`);
    return;
  }

  keyToggle("escape", "down");
  keyToggle("escape", "up");
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

function isActionLocked(state: Pick<SharedBotState, "actionLockUntilMs">, nowMs: number): boolean {
  return isDeadlineActive(state.actionLockUntilMs, nowMs);
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

function getStrictInteriorRange(start: number, size: number, ratio: number): { min: number; max: number } {
  const boundedSize = Math.max(1, size);
  const fullMin = start;
  const fullMax = start + boundedSize - 1;
  const ratioRange = getInnerRange(start, size, ratio);

  const strictMin = fullMin + BOX_CLICK_BORDER_EXCLUSION_PX;
  const strictMax = fullMax - BOX_CLICK_BORDER_EXCLUSION_PX;
  if (strictMin > strictMax) {
    return {
      min: clamp(ratioRange.min, fullMin, fullMax),
      max: clamp(ratioRange.max, fullMin, fullMax),
    };
  }

  const min = clamp(ratioRange.min, strictMin, strictMax);
  const max = clamp(ratioRange.max, min, strictMax);
  return { min, max };
}

function randomCenterBiasedInt(min: number, max: number): number {
  if (max <= min) return min;
  const a = randomIntInclusive(min, max);
  const b = randomIntInclusive(min, max);
  return Math.round((a + b) / 2);
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
    const x = randomCenterBiasedInt(minX, maxX);
    const y = randomCenterBiasedInt(minY, maxY);
    candidate = { x, y };
    if (!lastClickPoint || x !== lastClickPoint.x || y !== lastClickPoint.y) {
      return candidate;
    }
  }

  const centerCandidate = {
    x: Math.round((minX + maxX) / 2),
    y: Math.round((minY + maxY) / 2),
  };
  if (!lastClickPoint || centerCandidate.x !== lastClickPoint.x || centerCandidate.y !== lastClickPoint.y) {
    return centerCandidate;
  }

  if (minX < maxX) {
    const nextX = centerCandidate.x > minX ? centerCandidate.x - 1 : centerCandidate.x + 1;
    return { x: nextX, y: centerCandidate.y };
  }

  if (minY < maxY) {
    const nextY = centerCandidate.y > minY ? centerCandidate.y - 1 : centerCandidate.y + 1;
    return { x: centerCandidate.x, y: nextY };
  }

  return centerCandidate;
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
  const target = resolvePostClickMouseTarget(clickedScreenX, clickedScreenY, captureBounds);
  if (!target) return;
  moveMouse(target.x, target.y);
}

function clickScreenPoint(screenX: number, screenY: number): void {
  moveMouse(screenX, screenY);
  mouseClick("left", false);
  lastClickPoint = { x: screenX, y: screenY };
}

function getNodeUpperBiasedLocalY(node: MineTargetBox): number {
  const upwardBiasPx = Math.max(3, Math.round(node.height * 0.32));
  return Math.max(node.y + 1, node.centerY - upwardBiasPx);
}

function toNodeInteractionScreenPoint(
  node: MineTargetBox,
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

function toObstacleInteractionScreenPoint(
  obstacleBox: MotherlodeObstacleRedBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getStrictInteriorRange(obstacleBox.x, obstacleBox.width, BOX_CLICK_INNER_RATIO);
  const innerY = getStrictInteriorRange(obstacleBox.y, obstacleBox.height, BOX_CLICK_INNER_RATIO);
  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, innerY.max, captureBounds);
}

function toDepositInteractionScreenPoint(
  depositBox: Pick<MotherlodeDepositBox, "x" | "y" | "width" | "height">,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getStrictInteriorRange(depositBox.x, depositBox.width, BOX_CLICK_INNER_RATIO);
  const innerY = getStrictInteriorRange(depositBox.y, depositBox.height, BOX_CLICK_INNER_RATIO);
  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, innerY.max, captureBounds);
}

function toTopInnerInteractionScreenPoint(
  box: Pick<OrangeTargetBox, "x" | "y" | "width" | "height">,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getStrictInteriorRange(box.x, box.width, BOX_CLICK_INNER_RATIO);
  const innerY = getStrictInteriorRange(box.y, box.height, BOX_CLICK_INNER_RATIO);
  const topBandHeight = Math.max(1, Math.ceil((innerY.max - innerY.min + 1) * 0.2));
  const topBandMaxY = Math.min(innerY.max, innerY.min + topBandHeight - 1);
  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, topBandMaxY, captureBounds);
}

function detectNearestCyanDepositBoxInScreenshot(
  bitmap: RobotBitmap,
  captureBounds: ScreenCaptureBounds,
): MotherlodeDepositBox | null {
  const boxes = detectMotherlodeDepositBoxesInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  return findNearestDepositBox(boxes, captureBounds, playerAnchor);
}

function detectSouthernBankingCyanDepositBoxInScreenshot(
  bitmap: RobotBitmap,
  captureBounds: ScreenCaptureBounds,
): MotherlodeDepositBox | null {
  const boxes = detectMotherlodeDepositBoxesInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  return findSouthernDepositBox(boxes, captureBounds, playerAnchor);
}

function detectBestBankingYellowBoxInScreenshot(bitmap: RobotBitmap): MotherlodeBankingYellowBox | null {
  return detectBestMotherlodeBankingYellowBoxInScreenshot(bitmap);
}

function detectBestBankingGreenBoxInScreenshot(bitmap: RobotBitmap): MotherlodeBankingGreenBox | null {
  return detectBestMotherlodeBankingGreenBoxInScreenshot(bitmap);
}

function distanceFromPointToBoxAxis(
  pointX: number,
  pointY: number,
  box: Pick<MotherlodeObstacleRedBox, "x" | "y" | "width" | "height">,
): number {
  const nearestX = clamp(pointX, box.x, box.x + box.width - 1);
  const nearestY = clamp(pointY, box.y, box.y + box.height - 1);
  return axisDistance(pointX - nearestX, pointY - nearestY);
}

function detectBestRedObstacleBoxInScreenshot(
  bitmap: RobotBitmap,
  playerBoxInCapture: PlayerBox | null,
): MotherlodeObstacleRedBox | null {
  const boxes = detectMotherlodeObstacleRedBoxesInScreenshot(bitmap);
  if (boxes.length === 0) {
    return null;
  }

  if (!playerBoxInCapture) {
    return boxes[0] ?? null;
  }

  let best: MotherlodeObstacleRedBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    if (!isPlayerCollidingWithObstacle(playerBoxInCapture, box)) {
      continue;
    }

    const distance = distanceFromPointToBoxAxis(playerBoxInCapture.centerX, playerBoxInCapture.centerY, box);
    if (!best || distance < bestDistance || (distance === bestDistance && box.score > best.score)) {
      best = box;
      bestDistance = distance;
    }
  }

  return best;
}

function detectMineTargetBoxesInScreenshot(bitmap: RobotBitmap): MineTargetBox[] {
  return detectMotherlodeMineBoxesInScreenshot(bitmap).filter((box) => box.color === "green" || box.color === "yellow");
}

function detectPlayerTileFromOverlay(bitmap: RobotBitmap): TileCoord | null {
  const overlayBox = detectOverlayBoxInScreenshot(bitmap, currentWindowsScalePercent);
  if (!overlayBox) {
    return null;
  }

  return parseTileCoord(overlayBox.matchedLine);
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

function shouldStartDepositCycle(current: BotState): boolean {
  if (current.phase !== "searching" && current.phase !== "mining") {
    return false;
  }

  if (current.depositTriggerStableTicks < DEPOSIT_TRIGGER_STABLE_TICKS) {
    return false;
  }

  return current.bagFullState !== null && isBagAtDepositThreshold(current.bagFullState);
}

function resolveSearchFunctionFromBagState(
  bagFullState: MotherlodeBagFullState | null,
  depositTriggerStableTicks: number,
): "searchOre" | "searchDepositPayDirt" {
  if (
    bagFullState !== null &&
    isBagAtDepositThreshold(bagFullState) &&
    depositTriggerStableTicks >= DEPOSIT_TRIGGER_STABLE_TICKS
  ) {
    return "searchDepositPayDirt";
  }

  return "searchOre";
}

function resolvePendingMoveTransition(requestedNextPhase: BotPhase, color: MineSearchColor): MoveDestination {
  const nextPhase: Exclude<BotPhase, "moving"> = requestedNextPhase === "moving" ? "mining" : requestedNextPhase;

  if (nextPhase === "mining") {
    return {
      phase: "mining",
      currentFunction: "mine",
      useTargetAsActiveScreen: true,
    };
  }

  if (color === "cyan") {
    return {
      phase: "depositing",
      currentFunction: "depositPayDirt",
      actionLockTicks: DEPOSIT_CLICK_LOCK_TICKS,
    };
  }

  return {
    phase: nextPhase,
    currentFunction: "searchOre",
  };
}

function queueMoveState(
  state: BotState,
  targetScreen: { x: number; y: number },
  destination: MoveDestination,
): BotState {
  const latestState = toEngineStateSnapshot(state);

  return {
    ...state,
    phase: "moving",
    latestPhase: state.phase,
    currentFunction: "move",
    pendingMove: {
      targetScreen,
      destination,
      latestState,
    },
    actionLockUntilMs: 0,
  };
}

function toEngineStateSnapshot(state: BotState): EngineStateSnapshot {
  if (state.phase === "moving") {
    return state.pendingMove.latestState;
  }

  const normalizedFunction = resolveCurrentFunctionForPhase(state);
  if (normalizedFunction === "move") {
    return {
      phase: "searching",
      currentFunction: "searchOre",
    };
  }

  return {
    phase: state.phase,
    currentFunction: normalizedFunction,
  };
}

function restoreFromLatestEngineState(
  state: MovingBotState,
  bagFullState: MotherlodeBagFullState,
  depositTriggerStableTicks: number,
): BotState {
  const latestState = state.pendingMove.latestState;
  const restored = {
    ...resetToSearching(state, "searchOre"),
    phase: latestState.phase,
    currentFunction: latestState.currentFunction,
    bagFullState,
    depositTriggerStableTicks,
    actionLockUntilMs: deadlineFromNowTicks(OBSTACLE_CLICK_LOCK_TICKS),
  } as BotState;

  return syncStateCurrentFunction(restored);
}

function buildStateAfterMove(state: MovingBotState): BotState {
  const pendingMove = state.pendingMove;
  const destination = pendingMove.destination;
  const bagFullState = ("bagFullState" in state ? state.bagFullState : null) as MotherlodeBagFullState | null;
  const depositTriggerStableTicks = (
    "depositTriggerStableTicks" in state ? state.depositTriggerStableTicks : 0
  ) as number;
  const bankSouthClicks = ("bankSouthClicks" in state ? state.bankSouthClicks : 0) as number;
  const bankYellowPreClickSackCount = (
    "bankYellowPreClickSackCount" in state ? state.bankYellowPreClickSackCount : null
  ) as number | null;
  const bankYellowSackWaitTicks = ("bankYellowSackWaitTicks" in state ? state.bankYellowSackWaitTicks : 0) as number;
  const bankOrbClickCount = ("bankOrbClickCount" in state ? state.bankOrbClickCount : 0) as number;

  return {
    loopIndex: state.loopIndex,
    phase: destination.phase,
    latestPhase: "moving",
    currentFunction: destination.currentFunction,
    actionLockUntilMs: destination.actionLockTicks ? deadlineFromNowTicks(destination.actionLockTicks) : 0,
    activeTile: null,
    activeScreen: destination.useTargetAsActiveScreen
      ? { x: pendingMove.targetScreen.x, y: pendingMove.targetScreen.y }
      : null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    bagFullState,
    depositTriggerStableTicks,
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    ladderRecheckCount: 0,
    bankSouthClicks,
    bankYellowPreClickSackCount,
    bankYellowSackWaitTicks,
    bankOrbClickCount,
  } as BotState;
}

function updateBagState(current: BotState, nextState: MotherlodeBagFullState): BotState {
  if (current.phase === "moving") {
    return current;
  }

  const stable = isBagAtDepositThreshold(nextState) ? current.depositTriggerStableTicks + 1 : 0;
  return {
    ...current,
    bagFullState: nextState,
    depositTriggerStableTicks: stable,
  };
}

function formatBagStatsForLog(bagStats: MotherlodeBagStats | null): string {
  if (!bagStats) {
    return "null";
  }

  return JSON.stringify({
    panel: {
      x: bagStats.x,
      y: bagStats.y,
      width: bagStats.width,
      height: bagStats.height,
    },
    rawRows: bagStats.rawRows,
    sackRow: {
      rawText: bagStats.sackRow.rawText,
      value: bagStats.sackRow.value,
      sackCount: bagStats.sackRow.sackCount,
      inventoryCount: bagStats.sackRow.inventoryCount,
      capacityCount: bagStats.sackRow.capacityCount,
    },
    row2: {
      rawText: bagStats.row2.rawText,
      value: bagStats.row2.value,
    },
    row3: {
      rawText: bagStats.row3.rawText,
      value: bagStats.row3.value,
    },
  });
}

function logBagStatsSnapshot(source: string, bagStats: MotherlodeBagStats | null): void {
  log(`Automate Bot (${BOT_NAME}): bag-stats ${source} ${formatBagStatsForLog(bagStats)}`);
}

function getBagSackCountValue(bagStats: MotherlodeBagStats | null): number | null {
  return bagStats?.sackRow.sackCount ?? null;
}

function getBagInventoryCountValue(bagStats: MotherlodeBagStats | null): number | null {
  return bagStats?.sackRow.inventoryCount ?? null;
}

function isInventoryEmptyByBagStats(bagStats: MotherlodeBagStats | null): boolean {
  if (!bagStats) {
    return false;
  }

  const sackRowInventoryCount = bagStats.sackRow.inventoryCount;
  if (typeof sackRowInventoryCount === "number") {
    return sackRowInventoryCount <= 0;
  }

  const row3InventorySpace = bagStats.row3.value;
  if (typeof row3InventorySpace === "number") {
    return row3InventorySpace >= BANK_ORB_INVENTORY_EMPTY_VALUE;
  }

  return false;
}

function isInventoryFullByBagStats(bagStats: MotherlodeBagStats | null): boolean {
  if (!bagStats) {
    return false;
  }

  const row3InventorySpace = bagStats.row3.value;
  if (typeof row3InventorySpace === "number") {
    return row3InventorySpace <= 0;
  }

  const inventoryCount = bagStats.sackRow.inventoryCount;
  if (typeof inventoryCount === "number") {
    return inventoryCount >= BANK_ORB_INVENTORY_EMPTY_VALUE;
  }

  return false;
}

function findNearestOrangeBox(
  boxes: OrangeTargetBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): OrangeTargetBox | null {
  if (boxes.length === 0) {
    return null;
  }

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

function findNearestDepositBox(
  boxes: MotherlodeDepositBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MotherlodeDepositBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MotherlodeDepositBox | null = null;
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

function findSouthernDepositBox(
  boxes: MotherlodeDepositBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MotherlodeDepositBox | null {
  if (boxes.length === 0) {
    return null;
  }

  if (boxes.length === 1) {
    return boxes[0] ?? null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MotherlodeDepositBox | null = null;
  let bestSouthY = Number.NEGATIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const southY = box.y + box.height - 1;
    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (southY > bestSouthY || (southY === bestSouthY && centerDistance < bestCenterDistance)) {
      best = box;
      bestSouthY = southY;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function createInitialBotState(): BotState {
  const initialState: BotState = {
    loopIndex: 0,
    currentFunction: "searchOre",
    phase: "searching",
    latestPhase: "searching",
    actionLockUntilMs: 0,
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
    ladderRecheckCount: 0,
    bankSouthClicks: 0,
    bankYellowPreClickSackCount: null,
    bankYellowSackWaitTicks: 0,
    bankOrbClickCount: 0,
  };

  if (!captureBoundsRef) {
    warn(`Automate Bot (${BOT_NAME}): startup capture bounds unavailable. Defaulting initial function to searchOre.`);
    return initialState;
  }

  try {
    const bitmap = captureScreenBitmap(captureBoundsRef);
    const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
    const bagStats = detectMotherlodeBagStatsInScreenshot(bitmap);
    logBagStatsSnapshot("startup", bagStats);
    const bagFullState = bagFullDetection.state;
    const startupTile = detectPlayerTileFromOverlay(bitmap);

    if (isAtBankLadderDownTile(startupTile)) {
      log(
        `Automate Bot (${BOT_NAME}): startup tile ${startupTile?.x},${startupTile?.y},${startupTile?.z} matches bank ladder bottom (${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y},*). Initial phase=banking/searchSack.`,
      );
      return {
        ...initialState,
        phase: "banking",
        latestPhase: "banking",
        currentFunction: "searchSack",
        bagFullState,
        depositTriggerStableTicks: isBagAtDepositThreshold(bagFullState) ? 1 : 0,
        bankYellowPreClickSackCount: getBagSackCountValue(bagStats),
      };
    }

    if (!bagStats) {
      log(
        `Automate Bot (${BOT_NAME}): startup bagStats unavailable; initial function=searchOre (bag=${bagFullState}).`,
      );
      return {
        ...initialState,
        bagFullState,
      };
    }

    const inventoryCount = bagStats.sackRow.inventoryCount;
    const sackCount = bagStats.sackRow.sackCount;
    const capacityCount = bagStats.sackRow.capacityCount;
    const needed =
      inventoryCount !== null && sackCount !== null && capacityCount !== null
        ? capacityCount - sackCount - inventoryCount
        : null;
    const isInventoryCleanByBagStats = isInventoryEmptyByBagStats(bagStats);
    const isSackOverCapacityByBagStats = typeof needed === "number" && needed < 0;

    const inferredFunction: "searchOre" | "searchDepositPayDirt" | "searchLadder" =
      isSackOverCapacityByBagStats || (bagFullState === "red" && isInventoryCleanByBagStats)
        ? "searchLadder"
        : !isInventoryCleanByBagStats
          ? "searchDepositPayDirt"
          : "searchOre";

    log(
      `Automate Bot (${BOT_NAME}): startup inferred function=${inferredFunction} (bag=${bagFullState}, inventory=${inventoryCount ?? "?"}, needed=${needed ?? "?"}).`,
    );

    return {
      ...initialState,
      currentFunction: inferredFunction,
      bagFullState,
      depositTriggerStableTicks: isBagAtDepositThreshold(bagFullState) ? 1 : 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(
      `Automate Bot (${BOT_NAME}): startup state inference failed (${message}). Defaulting initial function to searchOre.`,
    );
    return initialState;
  }
}

function resetToSearching(
  current: BotState,
  _function: "searchOre" | "searchDepositPayDirt" | "searchLadder",
): BotState {
  const bagFullState = "bagFullState" in current ? current.bagFullState : null;
  const depositTriggerStableTicks = "depositTriggerStableTicks" in current ? current.depositTriggerStableTicks : 0;

  return {
    loopIndex: current.loopIndex,
    currentFunction: _function,
    phase: "searching",
    latestPhase: current.phase,
    actionLockUntilMs: 0,
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    bagFullState,
    depositTriggerStableTicks,
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    ladderRecheckCount: 0,
    bankSouthClicks: 0,
    bankYellowPreClickSackCount: null,
    bankYellowSackWaitTicks: 0,
    bankOrbClickCount: 0,
  };
}

function resetToSearchingAndClearDepositTrigger(
  current: BotState,
  _function: "searchOre" | "searchDepositPayDirt" | "searchLadder",
): BotState {
  const next = resetToSearching(current, _function);
  if (next.phase === "moving") {
    return next;
  }

  return {
    ...next,
    bagFullState: null,
    depositTriggerStableTicks: 0,
  };
}

function resetToBanking(current: BotState, _function: BankingFunctionKey): BotState {
  const bagFullState = "bagFullState" in current ? current.bagFullState : null;
  const depositTriggerStableTicks = "depositTriggerStableTicks" in current ? current.depositTriggerStableTicks : 0;
  const bankSouthClicks = "bankSouthClicks" in current ? current.bankSouthClicks : 0;
  const bankYellowPreClickSackCount =
    "bankYellowPreClickSackCount" in current ? current.bankYellowPreClickSackCount : null;
  const bankYellowSackWaitTicks = "bankYellowSackWaitTicks" in current ? current.bankYellowSackWaitTicks : 0;
  const bankOrbClickCount = "bankOrbClickCount" in current ? current.bankOrbClickCount : 0;

  return {
    loopIndex: current.loopIndex,
    currentFunction: _function,
    phase: "banking",
    latestPhase: current.phase,
    actionLockUntilMs: 0,
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    bagFullState,
    depositTriggerStableTicks,
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    ladderRecheckCount: 0,
    bankSouthClicks,
    bankYellowPreClickSackCount,
    bankYellowSackWaitTicks,
    bankOrbClickCount,
  };
}

function captureMineState(bitmap: RobotBitmap): MineCaptureResult {
  const boxes = detectMineTargetBoxesInScreenshot(bitmap);
  const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const obstacleBox = detectBestRedObstacleBoxInScreenshot(bitmap, playerBox);
  const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;

  return {
    bitmap,
    boxes,
    obstacleBox,
    playerBoxInCapture: playerBox,
    playerAnchorInCapture,
    bagFullState: bagFullDetection.state,
  };
}

function findNodeNearActiveScreen(
  boxes: MineTargetBox[],
  activeScreen: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
): MineTargetBox | null {
  const activeX = activeScreen.x - captureBounds.x;
  const activeY = activeScreen.y - captureBounds.y;

  let best: MineTargetBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;
  let bestYellow: MineTargetBox | null = null;
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

function selectNearestMineNodeByAnchor(
  boxes: MineTargetBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MineTargetBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MineTargetBox | null = null;
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

function estimateMoveTilePxFromPlayerBox(playerBoxInCapture: PlayerBox | null): number {
  if (!playerBoxInCapture) {
    return MOVE_TILE_PX_FALLBACK;
  }

  const estimatedTilePx = Math.round((playerBoxInCapture.width + playerBoxInCapture.height) / 2);
  return clamp(estimatedTilePx, MOVE_TILE_PX_MIN, MOVE_TILE_PX_MAX);
}

function estimateMoveTravelTicks(
  screenPoint: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
  playerBoxInCapture: PlayerBox | null,
): number {
  const anchorScreenX = captureBounds.x + (playerBoxInCapture?.centerX ?? Math.round(captureBounds.width / 2));
  const anchorScreenY = captureBounds.y + (playerBoxInCapture?.centerY ?? Math.round(captureBounds.height / 2));
  const tilePx = estimateMoveTilePxFromPlayerBox(playerBoxInCapture);
  const dxPx = screenPoint.x - anchorScreenX;
  const dyPx = screenPoint.y - anchorScreenY;
  const distanceTiles = Math.max(Math.abs(dxPx) / tilePx, Math.abs(dyPx) / tilePx);

  return clamp(
    Math.ceil(distanceTiles / MOVE_PLAYER_SPEED_TILES_PER_TICK) + MOVE_WAIT_EXTRA_TICKS,
    NODE_CLICK_LOCK_TICKS,
    MOVE_WAIT_MAX_TICKS,
  );
}

function estimateMoveDistanceToTargetPx(
  screenPoint: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
  playerBoxInCapture: PlayerBox | null,
): { distancePx: number; tilePx: number } {
  const anchorScreenX = captureBounds.x + (playerBoxInCapture?.centerX ?? Math.round(captureBounds.width / 2));
  const anchorScreenY = captureBounds.y + (playerBoxInCapture?.centerY ?? Math.round(captureBounds.height / 2));
  const tilePx = estimateMoveTilePxFromPlayerBox(playerBoxInCapture);
  const dxPx = screenPoint.x - anchorScreenX;
  const dyPx = screenPoint.y - anchorScreenY;
  return {
    distancePx: axisDistance(dxPx, dyPx),
    tilePx,
  };
}

function toSouthWestMoveScreenPoint(
  captureBounds: ScreenCaptureBounds,
  playerBoxInCapture: PlayerBox | null,
): { x: number; y: number } {
  const anchorX = playerBoxInCapture?.centerX ?? Math.round(captureBounds.width / 2);
  const anchorY = playerBoxInCapture?.centerY ?? Math.round(captureBounds.height / 2);
  const tilePx = estimateMoveTilePxFromPlayerBox(playerBoxInCapture);

  const minLocalX = BANK_MOVE_MARGIN_PX;
  const minLocalY = BANK_MOVE_MARGIN_PX;
  const maxLocalX = captureBounds.width - 1 - BANK_MOVE_MARGIN_PX;
  const maxLocalY = captureBounds.height - 1 - BANK_MOVE_MARGIN_PX;

  const baseOffsetX = Math.round(tilePx * BANK_SOUTHWEST_CLICK_OFFSET_TILES_X);
  const baseOffsetY = Math.round(tilePx * BANK_SOUTHWEST_CLICK_OFFSET_TILES_Y);
  const baseLocalX = clamp(anchorX + baseOffsetX, minLocalX, maxLocalX);
  const requestedSouthLocalY = clamp(anchorY + baseOffsetY, minLocalY, maxLocalY);

  const randomRadiusPx = Math.max(
    BANK_SOUTH_CLICK_RANDOM_RADIUS_PX,
    Math.round(tilePx * BANK_SOUTHWEST_CLICK_RANDOM_TILE_RADIUS),
  );
  const westShiftPx = Math.round(tilePx * BANK_SOUTHWEST_CLICK_EXTRA_WEST_TILES);
  const shiftedBaseLocalX = clamp(baseLocalX - westShiftPx, minLocalX, maxLocalX);
  const randomMinX = clamp(shiftedBaseLocalX - randomRadiusPx, minLocalX, maxLocalX);
  const randomMaxX = clamp(shiftedBaseLocalX + randomRadiusPx, minLocalX, maxLocalX);
  const southShiftPx = Math.round(tilePx * BANK_SOUTHWEST_CLICK_NORTH_SHIFT_TILES);
  const southEdgeMaxY = clamp(maxLocalY - southShiftPx, minLocalY, maxLocalY);
  const blendedSouthLocalY = Math.round((requestedSouthLocalY + southEdgeMaxY) / 2);
  const randomMinY = clamp(blendedSouthLocalY - randomRadiusPx, minLocalY, southEdgeMaxY);
  const randomMaxY = clamp(blendedSouthLocalY + randomRadiusPx, randomMinY, southEdgeMaxY);

  return pickDistinctScreenPointInLocalRange(randomMinX, randomMaxX, randomMinY, randomMaxY, captureBounds);
}

type BotEngineContext<T = BotState> = {
  tickCapture: EngineTickCapture;
  state: T;
  nowMs: number;
  captureBounds: ScreenCaptureBounds;
};

const Osrs = {
  move: ({ captureBounds, state, nowMs, tickCapture }: BotEngineContext<MovingBotState>): BotState => {
    const stateWithLock = state;
    const pendingMove = stateWithLock.pendingMove;
    const currentLockUntilMs = stateWithLock.actionLockUntilMs;

    if (isDeadlineActive(currentLockUntilMs, nowMs)) {
      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const { distancePx, tilePx } = estimateMoveDistanceToTargetPx(
        { x: pendingMove.targetScreen.x, y: pendingMove.targetScreen.y },
        captureBounds,
        playerBox,
      );
      const remainingMs = Math.max(0, currentLockUntilMs - nowMs);
      const remainingTicks = Math.max(1, Math.ceil(remainingMs / GAME_TICK_MS));
      const nearTarget = distancePx <= Math.round(tilePx * MOVE_EARLY_COMPLETE_RADIUS_TILES);

      if (remainingTicks <= MOVE_EARLY_COMPLETE_MAX_REMAINING_TICKS && nearTarget) {
        const destination = pendingMove.destination;
        log(
          `Automate Bot (${BOT_NAME}): #${state.loopIndex} [move] Arrived near (${pendingMove.targetScreen.x},${pendingMove.targetScreen.y}) early (distance=${distancePx}px). Transitioning to ${destination.phase}/${destination.currentFunction}.`,
        );
        return buildStateAfterMove(stateWithLock);
      }

      if (remainingTicks <= MOVE_OBSTACLE_CHECK_MAX_REMAINING_TICKS) {
        const collisionState = Osrs.clearRedObstacle({
          tickCapture,
          state,
          nowMs,
          captureBounds,
        });
        if (collisionState !== state) {
          return collisionState;
        }
      }

      if (state.loopIndex % 2 === 0) {
        log(
          `Automate Bot (${BOT_NAME}): #${state.loopIndex} [move] Moving to (${pendingMove.targetScreen.x},${pendingMove.targetScreen.y}); waiting ${remainingTicks} more tick(s) (distance=${distancePx}px).`,
        );
      }

      return state;
    }

    if (currentLockUntilMs <= 0) {
      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const moveWaitTicks = estimateMoveTravelTicks(
        { x: pendingMove.targetScreen.x, y: pendingMove.targetScreen.y },
        captureBounds,
        playerBox,
      );

      clickScreenPoint(pendingMove.targetScreen.x, pendingMove.targetScreen.y);
      moveMouseAwayFromClickedNode(pendingMove.targetScreen.x, pendingMove.targetScreen.y, captureBounds);

      log(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} [move] Clicking move target (${pendingMove.targetScreen.x},${pendingMove.targetScreen.y}); eta ~${moveWaitTicks} tick(s).`,
      );

      return {
        ...stateWithLock,
        actionLockUntilMs: deadlineFromNowTicks(moveWaitTicks),
      } as BotState;
    }

    const destination = pendingMove.destination;

    log(
      `Automate Bot (${BOT_NAME}): #${state.loopIndex} [move] Movement complete; transitioning to ${destination.phase}/${destination.currentFunction}.`,
    );

    return buildStateAfterMove(stateWithLock);
  },
  depositPayDirt: ({ tickCapture, state, nowMs }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);

    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
    logBagStatsSnapshot("depositPayDirt", bagStats);
    const inventoryCount = bagStats?.sackRow.inventoryCount ?? null;
    const sackCount = bagStats?.sackRow.sackCount ?? null;
    const capacityCount = bagStats?.sackRow.capacityCount ?? null;
    const needed =
      inventoryCount !== null && sackCount !== null && capacityCount !== null
        ? capacityCount - sackCount - inventoryCount
        : null;
    const isInventoryCleanByBagStats = isInventoryEmptyByBagStats(bagStats);
    const isSackOverCapacityByBagStats = typeof needed === "number" && needed < 0;

    const shouldSwitchToLadder =
      isSackOverCapacityByBagStats || (current.bagFullState === "red" && isInventoryCleanByBagStats);
    if (shouldSwitchToLadder) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit] Deposit complete by bagStats ladder criteria (bag=${current.bagFullState ?? "none"}, inventory=${inventoryCount ?? "?"}, needed=${needed ?? "?"}). Switching to ladder search.`,
      );
      return resetToSearchingAndClearDepositTrigger(current, "searchLadder");
    }

    if (isInventoryCleanByBagStats) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit] Deposit complete by bagStats (inventory=${inventoryCount ?? "?"}, needed=${needed ?? "?"}). Returning to search.`,
      );
      return resetToSearchingAndClearDepositTrigger(current, "searchOre");
    }

    const bagAtDepositThreshold = current.bagFullState !== null && isBagAtDepositThreshold(current.bagFullState);
    if (!bagAtDepositThreshold) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit] Deposit complete fallback (bag=${current.bagFullState ?? "none"}, inventory=${inventoryCount ?? "?"}, needed=${needed ?? "?"}). Returning to search.`,
      );
      return resetToSearchingAndClearDepositTrigger(current, "searchOre");
    }

    if (current.bagFullState === "red") {
      if (current.loopIndex % 3 === 0) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit] Sack is red but inventory is not clean yet (inventory=${inventoryCount ?? "?"}, needed=${needed ?? "?"}). Continuing deposit search.`,
        );
      }
      return resetToSearching(current, "searchDepositPayDirt");
    }

    if (current.loopIndex % 3 === 0) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit] Deposit not confirmed yet (bag=${current.bagFullState}, inventory=${inventoryCount ?? "?"}, needed=${needed ?? "?"}). Re-searching cyan deposit.`,
      );
    }

    return resetToSearching(current, "searchDepositPayDirt");
  },
  searchLadder: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    const orangeBoxes = detectOrangeBoxesInScreenshot(tickCapture.bitmap);
    const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
    const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
    const targetLadder = findNearestOrangeBox(orangeBoxes, captureBounds, playerAnchor);

    if (!targetLadder) {
      if (state.loopIndex % 3 === 0) {
        warn(`Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-ladder] Orange ladder target was not found.`);
      }
      return state;
    }

    const interactionPoint = toDepositInteractionScreenPoint(targetLadder, captureBounds);
    const destination: MoveDestination = {
      phase: "depositing",
      currentFunction: "useLadder",
      actionLockTicks: BANK_LADDER_POST_CLICK_WAIT_TICKS,
    };
    log(
      `Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-ladder] Found ladder target at (${interactionPoint.x},${interactionPoint.y}); queueing move -> ${destination.phase}/${destination.currentFunction}.`,
    );

    return queueMoveState(state, { x: interactionPoint.x, y: interactionPoint.y }, destination);
  },
  useLadder: ({ tickCapture, state, nowMs }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);

    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const tile = detectPlayerTileFromOverlay(tickCapture.bitmap);
    if (isAtBankLadderDownTile(tile)) {
      const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
      logBagStatsSnapshot("useLadder", bagStats);
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [use-ladder] Ladder descent confirmed at ${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y}. Switching to banking/searchSack.`,
      );
      return {
        ...resetToBanking(current, "searchSack"),
        bankSouthClicks: 0,
        bankYellowPreClickSackCount: getBagSackCountValue(bagStats),
        bankYellowSackWaitTicks: 0,
        bankOrbClickCount: 0,
      } as BotState;
    }

    const tileText = tile ? `${tile.x},${tile.y},${tile.z}` : "unavailable";
    const nextRecheckCount = current.ladderRecheckCount + 1;
    if (nextRecheckCount <= BANK_LADDER_RECHECK_MAX) {
      const waitTicks = randomIntInclusive(BANK_LADDER_RECHECK_WAIT_MIN_TICKS, BANK_LADDER_RECHECK_WAIT_MAX_TICKS);
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [use-ladder] Descent not confirmed yet (tile=${tileText}, expected=${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y},*). Waiting ${waitTicks} tick(s) before re-check (${nextRecheckCount}/${BANK_LADDER_RECHECK_MAX}).`,
      );

      return {
        ...current,
        ladderRecheckCount: nextRecheckCount,
        actionLockUntilMs: deadlineFromNowTicks(waitTicks),
      } as BotState;
    }

    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [use-ladder] Descent still not confirmed after ${current.ladderRecheckCount} re-check(s) (tile=${tileText}). Re-searching ladder.`,
    );
    return resetToSearching(current, "searchLadder");
  },
  searchSack: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const yellowTarget = detectBestBankingYellowBoxInScreenshot(tickCapture.bitmap);
    if (!yellowTarget) {
      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const southWestPoint = toSouthWestMoveScreenPoint(captureBounds, playerBox);
      const destination: MoveDestination = {
        phase: "banking",
        currentFunction: "searchSack",
      };
      if (current.loopIndex % 2 === 0) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-sack] Yellow sack not found. Moving south-west to (${southWestPoint.x},${southWestPoint.y}) and retrying.`,
        );
      }
      return {
        ...queueMoveState(current, { x: southWestPoint.x, y: southWestPoint.y }, destination),
        bankSouthClicks: current.bankSouthClicks + 1,
      } as BotState;
    }

    const interactionPoint = toDepositInteractionScreenPoint(yellowTarget, captureBounds);
    const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
    logBagStatsSnapshot("searchSack", bagStats);
    const preSackCount = getBagSackCountValue(bagStats);
    const destination: MoveDestination = {
      phase: "banking",
      currentFunction: "fillInventory",
    };
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-sack] Found yellow sack at (${interactionPoint.x},${interactionPoint.y}); queueing move -> ${destination.phase}/${destination.currentFunction}.`,
    );
    return {
      ...queueMoveState(current, { x: interactionPoint.x, y: interactionPoint.y }, destination),
      bankYellowPreClickSackCount: preSackCount,
      bankYellowSackWaitTicks: 0,
      bankSouthClicks: 0,
    } as BotState;
  },
  fillInventory: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
    logBagStatsSnapshot("fillInventory", bagStats);
    const currentSackCount = getBagSackCountValue(bagStats);
    const preClickSackCount = current.bankYellowPreClickSackCount ?? currentSackCount;

    if (preClickSackCount !== null && currentSackCount !== null && currentSackCount < preClickSackCount) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [fill-inventory] Sack count dropped (${preClickSackCount} -> ${currentSackCount}). Switching to bank-deposit search.`,
      );
      return {
        ...resetToBanking(current, "searchBankDeposit"),
        bankYellowPreClickSackCount: null,
        bankYellowSackWaitTicks: 0,
      } as BotState;
    }

    if (isInventoryFullByBagStats(bagStats)) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [fill-inventory] Inventory full by bagStats (row3=${bagStats?.row3.value ?? "?"}, inventory=${bagStats?.sackRow.inventoryCount ?? "?"}). Switching to bank-deposit search.`,
      );
      return {
        ...resetToBanking(current, "searchBankDeposit"),
        bankYellowPreClickSackCount: null,
        bankYellowSackWaitTicks: 0,
      } as BotState;
    }

    if (current.bankYellowSackWaitTicks >= BANK_YELLOW_SACK_WAIT_MAX_TICKS) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [fill-inventory] Sack did not change after ${current.bankYellowSackWaitTicks} yellow attempts. Re-searching sack.`,
      );
      return {
        ...resetToBanking(current, "searchSack"),
        bankYellowPreClickSackCount: currentSackCount,
        bankYellowSackWaitTicks: 0,
        actionLockUntilMs: deadlineFromNowTicks(1),
      } as BotState;
    }

    const yellowTarget = detectBestBankingYellowBoxInScreenshot(tickCapture.bitmap);
    if (!yellowTarget) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [fill-inventory] Yellow sack target lost. Returning to searchSack.`,
      );
      return resetToBanking(current, "searchSack");
    }

    const point = toDepositInteractionScreenPoint(yellowTarget, captureBounds);
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [fill-inventory] Clicking yellow sack at (${point.x},${point.y}) to fill inventory.`,
    );
    clickScreenPoint(point.x, point.y);
    moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
    return {
      ...current,
      bankYellowPreClickSackCount: preClickSackCount,
      bankYellowSackWaitTicks: current.bankYellowSackWaitTicks + 1,
      actionLockUntilMs: deadlineFromNowTicks(BANK_YELLOW_TILE_CLICK_LOCK_TICKS),
    } as BotState;
  },
  searchBankDeposit: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const greenTarget = detectBestBankingGreenBoxInScreenshot(tickCapture.bitmap);
    if (!greenTarget) {
      if (current.loopIndex % 3 === 0) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-deposit] Green bank-deposit target not found.`,
        );
      }
      return current;
    }

    saveBankDepositDebugArtifact(current.loopIndex, tickCapture.bitmap, greenTarget);

    const interactionPoint = toDepositInteractionScreenPoint(greenTarget, captureBounds);
    const destination: MoveDestination = {
      phase: "banking",
      currentFunction: "searchBankOrb",
    };
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-deposit] Found green deposit target at (${interactionPoint.x},${interactionPoint.y}); queueing move -> ${destination.phase}/${destination.currentFunction}.`,
    );
    return queueMoveState(current, { x: interactionPoint.x, y: interactionPoint.y }, destination);
  },
  searchBankPayDirtDeposit: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
    logBagStatsSnapshot("searchBankPayDirtDeposit", bagStats);
    const payDirtInventoryCount = getBagInventoryCountValue(bagStats);
    if (payDirtInventoryCount !== null && payDirtInventoryCount <= 0) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-paydirt-deposit] +x is now ${payDirtInventoryCount}. Returning to yellow sack flow.`,
      );
      return resetToBanking(current, "searchSack");
    }

    if (payDirtInventoryCount === null) {
      if (current.loopIndex % 3 === 0) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-paydirt-deposit] Could not read +x inventory count yet; waiting before cyan deposit search.`,
        );
      }
      return {
        ...current,
        actionLockUntilMs: deadlineFromNowTicks(1),
      } as BotState;
    }

    const cyanTarget = detectSouthernBankingCyanDepositBoxInScreenshot(tickCapture.bitmap, captureBounds);
    if (!cyanTarget) {
      if (current.loopIndex % 3 === 0) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-paydirt-deposit] +x=${payDirtInventoryCount}, but southern cyan pay-dirt deposit target was not found.`,
        );
      }
      return current;
    }

    const interactionPoint = toDepositInteractionScreenPoint(cyanTarget, captureBounds);
    const destination: MoveDestination = {
      phase: "banking",
      currentFunction: "depositBankPayDirt",
      actionLockTicks: DEPOSIT_CLICK_LOCK_TICKS,
    };
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-paydirt-deposit] +x=${payDirtInventoryCount}; southern cyan deposit at (${interactionPoint.x},${interactionPoint.y}). Queueing move -> ${destination.phase}/${destination.currentFunction}.`,
    );
    return queueMoveState(current, { x: interactionPoint.x, y: interactionPoint.y }, destination);
  },
  depositBankPayDirt: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
    logBagStatsSnapshot("depositBankPayDirt", bagStats);
    const payDirtInventoryCount = getBagInventoryCountValue(bagStats);
    if (payDirtInventoryCount !== null && payDirtInventoryCount <= 0) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit-bank-paydirt] +x is now ${payDirtInventoryCount}. Returning to yellow sack flow.`,
      );
      return resetToBanking(current, "searchSack");
    }

    if (payDirtInventoryCount === null) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit-bank-paydirt] Could not read +x inventory count; re-searching southern cyan deposit target.`,
      );
      return {
        ...resetToBanking(current, "searchBankPayDirtDeposit"),
        actionLockUntilMs: deadlineFromNowTicks(1),
      } as BotState;
    }

    const cyanTarget = detectSouthernBankingCyanDepositBoxInScreenshot(tickCapture.bitmap, captureBounds);
    if (!cyanTarget) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit-bank-paydirt] +x=${payDirtInventoryCount}, but southern cyan deposit target was not found. Re-searching.`,
      );
      return {
        ...resetToBanking(current, "searchBankPayDirtDeposit"),
        actionLockUntilMs: deadlineFromNowTicks(1),
      } as BotState;
    }

    const point = toDepositInteractionScreenPoint(cyanTarget, captureBounds);
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit-bank-paydirt] Clicking southern cyan pay-dirt deposit at (${point.x},${point.y}) while +x=${payDirtInventoryCount}.`,
    );
    clickScreenPoint(point.x, point.y);
    moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
    return {
      ...current,
      actionLockUntilMs: deadlineFromNowTicks(DEPOSIT_CLICK_LOCK_TICKS),
    } as BotState;
  },
  searchBankOrb: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const orbReferenceBitmap = getBankDepositOrbReferenceBitmap();
    if (!orbReferenceBitmap) {
      return current;
    }

    const orbResult = detectBankDepositIconWithOrb(orbReferenceBitmap, tickCapture.bitmap);
    if (!orbResult.detection) {
      if (current.loopIndex % 3 === 0) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-orb] Orb not found. Re-positioning to green deposit.`,
        );
      }
      return resetToBanking(current, "searchBankDeposit");
    }

    const orbPoint = {
      x: captureBounds.x + orbResult.detection.centerX,
      y: captureBounds.y + orbResult.detection.centerY,
    };
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-bank-orb] Orb found at (${orbResult.detection.centerX},${orbResult.detection.centerY}). Clicking (${orbPoint.x},${orbPoint.y}) and waiting ${BANK_ORB_ESCAPE_WAIT_TICKS} tick before Escape.`,
    );
    clickScreenPoint(orbPoint.x, orbPoint.y);
    moveMouseAwayFromClickedNode(orbPoint.x, orbPoint.y, captureBounds);
    return {
      ...current,
      currentFunction: "closeBankAfterOrb",
      bankOrbClickCount: current.bankOrbClickCount + 1,
      actionLockUntilMs: deadlineFromNowTicks(BANK_ORB_ESCAPE_WAIT_TICKS),
    } as BotState;
  },
  closeBankAfterOrb: ({ tickCapture, state, nowMs }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    tapEscapeAfterBankOrb();
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [close-bank-after-orb] Pressed Escape; transitioning to inventory check.`,
    );

    return {
      ...current,
      currentFunction: "checkInventoryEmpty",
      actionLockUntilMs: deadlineFromNowTicks(1),
    } as BotState;
  },
  checkInventoryEmpty: ({ tickCapture, state, nowMs }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
    logBagStatsSnapshot("checkInventoryEmpty", bagStats);
    if (!bagStats) {
      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} [check-inventory-empty] Bag stats unavailable; waiting.`);
      return {
        ...current,
        actionLockUntilMs: deadlineFromNowTicks(1),
      } as BotState;
    }

    const sackCount = getBagSackCountValue(bagStats);
    const payDirtInventoryCount = getBagInventoryCountValue(bagStats);
    const inventoryEmpty = isInventoryEmptyByBagStats(bagStats);

    if (payDirtInventoryCount !== null && payDirtInventoryCount > 0) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [check-inventory-empty] +x still ${payDirtInventoryCount} after banking. Switching to southern cyan pay-dirt deposit flow.`,
      );
      return {
        ...resetToBanking(current, "searchBankPayDirtDeposit"),
        bankOrbClickCount: 0,
      } as BotState;
    }

    if (!inventoryEmpty) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [check-inventory-empty] Inventory not empty yet; retrying orb detection.`,
      );
      return resetToBanking(current, "searchBankOrb");
    }

    if (sackCount !== null && sackCount > 0) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [check-inventory-empty] Inventory empty and sack still has pay-dirt (${sackCount}). Restarting sack loop.`,
      );
      return {
        ...resetToBanking(current, "searchSack"),
        bankYellowPreClickSackCount: sackCount,
        bankYellowSackWaitTicks: 0,
        bankOrbClickCount: 0,
      } as BotState;
    }

    if (sackCount === 0) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [check-inventory-empty] Inventory empty and sack empty. Searching return ladder.`,
      );
      return {
        ...resetToBanking(current, "searchReturnLadder"),
        bankOrbClickCount: 0,
      } as BotState;
    }

    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [check-inventory-empty] Inventory empty but sack count is unknown. Re-checking sack loop.`,
    );
    return resetToBanking(current, "searchSack");
  },
  searchReturnLadder: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const orangeBoxes = detectOrangeBoxesInScreenshot(tickCapture.bitmap);
    const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
    const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
    const targetLadder = findNearestOrangeBox(orangeBoxes, captureBounds, playerAnchor);
    if (!targetLadder) {
      if (current.loopIndex % 3 === 0) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-return-ladder] Orange ladder target not found.`,
        );
      }
      return current;
    }

    const interactionPoint = toTopInnerInteractionScreenPoint(targetLadder, captureBounds);
    const destination: MoveDestination = {
      phase: "banking",
      currentFunction: "useReturnLadder",
      actionLockTicks: BANK_LADDER_POST_CLICK_WAIT_TICKS,
    };
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [search-return-ladder] Found return ladder target at (${interactionPoint.x},${interactionPoint.y}) using top-inner click band; queueing move -> ${destination.phase}/${destination.currentFunction}.`,
    );
    return queueMoveState(current, { x: interactionPoint.x, y: interactionPoint.y }, destination);
  },
  useReturnLadder: ({ tickCapture, state, nowMs }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);
    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;
    if (current.phase !== "banking") {
      return syncStateCurrentFunction(current);
    }

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const tile = detectPlayerTileFromOverlay(tickCapture.bitmap);
    if (isAtLadderUpTile(tile)) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [use-return-ladder] Ladder ascent confirmed at ${BANK_EXPECTED_LADDER_UP_X},${BANK_EXPECTED_LADDER_UP_Y}. Returning to ore search.`,
      );
      return {
        ...resetToSearching(current, "searchOre"),
        bagFullState: null,
        depositTriggerStableTicks: 0,
        bankSouthClicks: 0,
        bankYellowPreClickSackCount: null,
        bankYellowSackWaitTicks: 0,
        bankOrbClickCount: 0,
      } as BotState;
    }

    const tileText = tile ? `${tile.x},${tile.y},${tile.z}` : "unavailable";
    const nextRecheckCount = current.ladderRecheckCount + 1;
    if (nextRecheckCount <= BANK_LADDER_UP_RECHECK_MAX) {
      const waitTicks = randomIntInclusive(
        BANK_LADDER_UP_RECHECK_WAIT_MIN_TICKS,
        BANK_LADDER_UP_RECHECK_WAIT_MAX_TICKS,
      );
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [use-return-ladder] Ascent not confirmed yet (tile=${tileText}, expected=${BANK_EXPECTED_LADDER_UP_X},${BANK_EXPECTED_LADDER_UP_Y},*). Waiting ${waitTicks} tick(s) before re-check (${nextRecheckCount}/${BANK_LADDER_UP_RECHECK_MAX}).`,
      );

      return {
        ...current,
        ladderRecheckCount: nextRecheckCount,
        actionLockUntilMs: deadlineFromNowTicks(waitTicks),
      } as BotState;
    }

    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} [use-return-ladder] Ascent still not confirmed after ${current.ladderRecheckCount} re-check(s) (tile=${tileText}). Re-searching return ladder.`,
    );
    return {
      ...resetToBanking(current, "searchReturnLadder"),
      ladderRecheckCount: 0,
    } as BotState;
  },
  searchBorderedTile:
    (color: MineSearchColor, nextPhase: BotPhase) =>
    ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
      if (color !== "cyan") {
        return state;
      }

      const targetDepositBox = detectNearestCyanDepositBoxInScreenshot(tickCapture.bitmap, captureBounds);

      if (!targetDepositBox) {
        if (state.loopIndex % 3 === 0) {
          warn(
            `Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-bordered] Bag full but cyan deposit target was not found.`,
          );
        }
        return state;
      }

      const interactionPoint = toDepositInteractionScreenPoint(targetDepositBox, captureBounds);
      const transition = resolvePendingMoveTransition(nextPhase, color);

      log(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-bordered] Found cyan deposit at (${interactionPoint.x},${interactionPoint.y}); queueing move -> ${transition.phase}/${transition.currentFunction}.`,
      );

      return queueMoveState(state, { x: interactionPoint.x, y: interactionPoint.y }, transition);
    },
  clearRedObstacle: ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
    const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
    const obstacleBox = detectBestRedObstacleBoxInScreenshot(tickCapture.bitmap, playerBox);

    if (!shouldClearRedObstacle(playerBox, obstacleBox)) {
      return state;
    }

    const point = toObstacleInteractionScreenPoint(obstacleBox, captureBounds);
    saveCollisionDebugArtifacts(state.phase, state.loopIndex, tickCapture.bitmap, playerBox, obstacleBox);
    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const stateWithDeposit = state as BotState & { depositTriggerStableTicks?: number };
    const previousDepositTicks =
      typeof stateWithDeposit.depositTriggerStableTicks === "number" ? stateWithDeposit.depositTriggerStableTicks : 0;
    const depositTriggerStableTicks = isBagAtDepositThreshold(bagFullState)
      ? Math.min(DEPOSIT_TRIGGER_STABLE_TICKS, previousDepositTicks + 1)
      : 0;
    const searchFunction = resolveSearchFunctionFromBagState(bagFullState, depositTriggerStableTicks);

    warn(
      `Automate Bot (${BOT_NAME}): #${state.loopIndex} [obstacle] Clearing red obstacle at (${point.x},${point.y}).`,
    );
    clickScreenPoint(point.x, point.y);
    moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);

    if (state.phase === "moving") {
      if (state.pendingMove.destination.phase === "mining") {
        const latestState = state.pendingMove.latestState;

        warn(
          `Automate Bot (${BOT_NAME}): #${state.loopIndex} [obstacle] Move to mining target interrupted after obstacle clear. Restoring latest state ${latestState.phase}/${latestState.currentFunction}.`,
        );

        return restoreFromLatestEngineState(state, bagFullState, depositTriggerStableTicks);
      }

      return {
        ...state,
        actionLockUntilMs: deadlineFromNowTicks(OBSTACLE_CLICK_LOCK_TICKS),
      } as BotState;
    }

    return {
      loopIndex: state.loopIndex,
      currentFunction: searchFunction,
      phase: "searching",
      latestPhase: state.latestPhase ?? state.phase,
      actionLockUntilMs: 0,
      activeTile: null,
      activeScreen: null,
      missingActiveTicks: 0,
      miningWaitTicks: 0,
      activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
      bagFullState,
      depositTriggerStableTicks,
      depositNearStableTicks: 0,
      depositRetryTicks: 0,
      depositInFlight: false,
      depositLastDistancePx: null,
      ladderRecheckCount: 0,
      bankSouthClicks: 0,
      bankYellowPreClickSackCount: null,
      bankYellowSackWaitTicks: 0,
      bankOrbClickCount: 0,
    } as BotState;
  },
  searchColoredCircle:
    (color: MineSearchColor, nextPhase: BotPhase) =>
    ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
      if (color === "cyan") {
        return state;
      }

      const mineColor = color as MineTargetBox["color"];
      const allMineBoxes = detectMineTargetBoxesInScreenshot(tickCapture.bitmap);
      const colorBoxes = allMineBoxes.filter((box) => box.color === mineColor);
      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
      const targetNode = selectNearestMineNodeByAnchor(colorBoxes, captureBounds, playerAnchor);

      if (!targetNode) {
        if (state.loopIndex % 3 === 0) {
          warn(
            `Automate Bot (${BOT_NAME}): #${state.loopIndex} search(${mineColor} -> ${nextPhase}) found no target (boxes=${allMineBoxes.length}, color=${colorBoxes.length}).`,
          );
        }
        return state;
      }

      const interactionPoint = toNodeInteractionScreenPoint(targetNode, captureBounds);
      const transition = resolvePendingMoveTransition(nextPhase, mineColor);

      log(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-colored-circle] Found ${mineColor} node (boxes=${allMineBoxes.length}, color=${colorBoxes.length}) at (${interactionPoint.x},${interactionPoint.y}); queueing move -> ${transition.phase}/${transition.currentFunction}.`,
      );

      return queueMoveState(state, { x: interactionPoint.x, y: interactionPoint.y }, transition);
    },
};

const runMineFunction = createMineFunction<BotState, MineCaptureResult, EngineTickCapture>({
  capture: (state, _nowMs, tickCapture) => {
    setCurrentLogLoopIndex(state.loopIndex);
    setCurrentLogPhase(state.phase);
    const capture = captureMineState(tickCapture.bitmap);
    const current = updateBagState(state, capture.bagFullState);
    return { state: current, capture };
  },
  beforePhase: (current, capture, nowMs, tickCapture) => {
    const isCurrentLocked = current.phase === "moving" ? isActionLocked(current, nowMs) : false;

    if (
      current.phase !== "moving" &&
      !isCurrentLocked &&
      shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)
    ) {
      return Osrs.clearRedObstacle({
        tickCapture,
        state: current,
        nowMs,
        captureBounds: captureBoundsRef!,
      });
    }

    return null;
  },

  runMiningPhase: (current, capture, nowMs, tickCapture) => {
    if (current.phase === "searching") {
      return {
        ...current,
        currentFunction: "searchOre",
      } as BotState;
    }

    if (current.phase === "moving") {
      return {
        ...current,
        currentFunction: "move",
      } as BotState;
    }

    if (current.phase === "depositing") {
      return {
        ...current,
        currentFunction: "depositPayDirt",
      } as BotState;
    }

    if (current.phase === "banking") {
      return {
        ...current,
        currentFunction: "searchSack",
      } as BotState;
    }

    if (shouldStartDepositCycle(current)) {
      const bagStats = detectMotherlodeBagStatsInScreenshot(tickCapture.bitmap);
      if (isInventoryEmptyByBagStats(bagStats)) {
        if (current.loopIndex % 3 === 0) {
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Bag-full threshold stable (${current.bagFullState}) but bagStats shows empty inventory (inventory=${bagStats?.sackRow.inventoryCount ?? "?"}, row3=${bagStats?.row3.value ?? "?"}). Ignoring deposit switch.`,
          );
        }
        return {
          ...current,
          bagFullState: null,
          depositTriggerStableTicks: 0,
        } as BotState;
      }

      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Bag-full threshold stable (${current.bagFullState}); switching to searchDepositPayDirt.`,
      );
      return resetToSearching(current, "searchDepositPayDirt");
    }

    if (!current.activeScreen) {
      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Missing active tracking point; returning to search.`);
      return resetToSearching(current, "searchOre");
    }

    const nearbyAny = findNodeNearActiveScreen(capture.boxes, current.activeScreen, captureBoundsRef!);
    if (nearbyAny) {
      if (nearbyAny.color !== "green") {
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node is now ${nearbyAny.color}. Searching next node.`,
        );
        return resetToSearching(current, "searchOre");
      }

      const miningWaitTicks = current.miningWaitTicks + 1;
      if (miningWaitTicks >= current.activeNodeMaxWaitTicks) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node still ${nearbyAny.color} after ${miningWaitTicks} ticks. Re-searching.`,
        );
        return resetToSearching(current, "searchOre");
      }

      if (current.loopIndex % 2 === 0) {
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Waiting on active node (${nearbyAny.color}) tick=${miningWaitTicks}/${current.activeNodeMaxWaitTicks}.`,
        );
      }
      return { ...current, miningWaitTicks, missingActiveTicks: 0 };
    }

    const missingActiveTicks = current.missingActiveTicks + 1;
    if (missingActiveTicks <= ACTIVE_NODE_MISSING_GRACE_TICKS) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node not detected (${missingActiveTicks}/${ACTIVE_NODE_MISSING_GRACE_TICKS}).`,
      );
      return { ...current, missingActiveTicks };
    }

    log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Lost active node; returning to search.`);
    return resetToSearching(current, "searchOre");
  },
});

function resolveCurrentFunctionForPhase(state: BotState): EngineFunctionKey {
  if (state.phase === "moving") {
    return "move";
  }

  if (state.phase === "mining") {
    return "mine";
  }

  if (state.phase === "depositing") {
    if (state.currentFunction === "useLadder") {
      return "useLadder";
    }
    return "depositPayDirt";
  }

  if (state.phase === "banking") {
    switch (state.currentFunction) {
      case "searchSack":
      case "fillInventory":
      case "searchBankDeposit":
      case "searchBankPayDirtDeposit":
      case "depositBankPayDirt":
      case "searchBankOrb":
      case "closeBankAfterOrb":
      case "checkInventoryEmpty":
      case "searchReturnLadder":
      case "useReturnLadder":
        return state.currentFunction;
      default:
        return "searchSack";
    }
  }

  return "searchOre";
}

function syncStateCurrentFunction(state: BotState): BotState {
  const nextFunction = resolveCurrentFunctionForPhase(state);
  if (state.currentFunction === nextFunction) {
    return state;
  }

  return {
    ...state,
    currentFunction: nextFunction,
  } as BotState;
}

let captureBoundsRef: ScreenCaptureBounds | null = null;

async function runLoop(captureBounds: ScreenCaptureBounds): Promise<void> {
  if (isLoopRunning) {
    log(`Automate Bot (${BOT_NAME}): loop already running.`);
    return;
  }

  captureBoundsRef = captureBounds;
  isLoopRunning = true;
  setAutomateBotCurrentStep(MINING_MOTHERLODE_MINE_V3_BOT_ID);

  try {
    await runBotEngine<BotState, EngineFunctionKey, EngineTickCapture>({
      tickMs: BASE_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: createInitialBotState,
      captureTick: () => ({
        bitmap: captureScreenBitmap(captureBounds),
        captureBitmap: () => captureScreenBitmap(captureBounds),
      }),
      functions: {
        mine: ({ state, nowMs, tickCapture }) => runMineFunction(state, nowMs, tickCapture),
        depositPayDirt: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "depositing") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.depositPayDirt({ tickCapture, state, nowMs, captureBounds });
        },
        searchDepositPayDirt: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "searching") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchBorderedTile("cyan", "depositing")({ tickCapture, state, nowMs, captureBounds });
        },
        searchLadder: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "searching") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchLadder({ tickCapture, state, nowMs, captureBounds });
        },
        searchOre: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "searching") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchColoredCircle("green", "moving")({ tickCapture, state, nowMs, captureBounds });
        },
        useLadder: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "depositing") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.useLadder({ tickCapture, state, nowMs, captureBounds });
        },
        searchSack: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchSack({ tickCapture, state, nowMs, captureBounds });
        },
        fillInventory: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.fillInventory({ tickCapture, state, nowMs, captureBounds });
        },
        searchBankDeposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchBankDeposit({ tickCapture, state, nowMs, captureBounds });
        },
        searchBankPayDirtDeposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchBankPayDirtDeposit({ tickCapture, state, nowMs, captureBounds });
        },
        depositBankPayDirt: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.depositBankPayDirt({ tickCapture, state, nowMs, captureBounds });
        },
        searchBankOrb: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchBankOrb({ tickCapture, state, nowMs, captureBounds });
        },
        closeBankAfterOrb: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.closeBankAfterOrb({ tickCapture, state, nowMs, captureBounds });
        },
        checkInventoryEmpty: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.checkInventoryEmpty({ tickCapture, state, nowMs, captureBounds });
        },
        searchReturnLadder: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.searchReturnLadder({ tickCapture, state, nowMs, captureBounds });
        },
        useReturnLadder: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "banking") {
            return syncStateCurrentFunction(state);
          }

          return Osrs.useReturnLadder({ tickCapture, state, nowMs, captureBounds });
        },
        move: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "moving"
            ? Osrs.move({ state, nowMs, captureBounds, tickCapture })
            : syncStateCurrentFunction(state);
        },
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`#${state.loopIndex} [${state.phase}] tick error - ${message}`);
      },
    });
  } finally {
    captureBoundsRef = null;
    isLoopRunning = false;
    startedAtMs = null;
    setCurrentLogPhase(null);
    setAutomateBotCurrentStep(null);
  }
}

export function onMotherlodeMineBotV3Start(): void {
  setCurrentLogLoopIndex(0);
  setCurrentLogPhase("searching");

  if (!isLoopRunning) {
    startedAtMs = Date.now();
    lastClickPoint = null;
    bankDepositOrbReferenceBitmap = null;
    bankDepositOrbReferenceLoadAttempted = false;
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Automate Bot (${BOT_NAME}) config: engineTick=${BASE_TICK_MS}ms, engineFunctions={searchOre,searchDepositPayDirt,searchLadder,useLadder,searchSack,fillInventory,searchBankDeposit,searchBankPayDirtDeposit,depositBankPayDirt,searchBankOrb,closeBankAfterOrb,checkInventoryEmpty,searchReturnLadder,useReturnLadder,move,mine,depositPayDirt}, hover-before-read=${ENABLE_NODE_HOVER_BEFORE_TILE_READ ? "on" : "off"}, obstacle-red-click=${ENABLE_OBSTACLE_RED_CLICK ? "on" : "off"}.`,
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

  void runLoop(captureBounds);
}
