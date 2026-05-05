import { screen as electronScreen } from "electron";
import { keyTap, keyToggle, mouseClick, moveMouse } from "robotjs";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { getSavedGuardianOfTheRiftConfig } from "../csvOperator";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap, type ScreenCaptureBounds } from "../windowsScreenCapture";
import { RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID } from "./definitions";
import { runBotEngine, sleepWithAbort } from "./engine/bot-engine";
import { type GuardianOfTheRiftConfig } from "./guardian-of-the-rift-config";
import { readCoordinateOverlayLocation, saveCoordinateAutoScreenshot } from "./shared/coordinate-auto-screenshot";
import {
  detectGuardianOfTheRiftAltarMarkersInScreenshot,
  formatGuardianOfTheRiftAltarCandidates,
  pickNearestGuardianOfTheRiftAltarMarker,
} from "./shared/guardian-of-the-rift-altar-detector";
import {
  detectGuardianOfTheRiftPortalMarkersInScreenshot,
  detectGuardianOfTheRiftPortalOpenIcon,
  formatGuardianOfTheRiftPortalCandidates,
  GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX,
  loadGuardianOfTheRiftPortalOpenIconTemplate,
  pickNearestGuardianOfTheRiftPortalMarker,
  type GuardianOfTheRiftPortalOpenIconTemplate,
} from "./shared/guardian-of-the-rift-portal-detector";
import { detectGuardianOfTheRiftTimer } from "./shared/guardian-of-the-rift-timer-detector";
import { detectInventoryCount, saveBitmapWithInventoryCountDebug } from "./shared/inventory-count-detector";
import { detectMiningBoxStatusInScreenshot, type MiningBoxStatusDetection } from "./shared/mining-box-status-detector";
import type { RobotBitmap } from "./shared/ocr-engine";
import { detectBestPlayerBoxInScreenshot, type PlayerBox } from "./shared/player-box-detector";

type BotPhase =
  | "pick-uncharged-cell"
  | "wait-after-pickup"
  | "find-agility-course"
  | "wait-after-agility-course-yellow-click"
  | "find-orange"
  | "wait-for-mining-timer"
  | "mining"
  | "wait-after-agility-mining-yellow-click"
  | "workbench-find-yellow"
  | "crafting"
  | "travel-to-guardian"
  | "wait-after-guardian-click"
  | "wait-after-guardian-yellow-click"
  | "find-return-portal"
  | "wait-after-guardian-return-click"
  | "find-great-guardian"
  | "wait-after-great-guardian-click"
  | "find-charged-cell-deposit"
  | "wait-after-charged-cell-deposit-click"
  | "find-rune-deposit"
  | "wait-after-rune-deposit-click"
  | "wait-for-final-portal-open-icon"
  | "find-final-portal"
  | "wait-after-final-portal-click"
  | "find-portal-mining-magenta"
  | "portal-mining"
  | "find-portal-exit"
  | "wait-after-portal-exit-click"
  | "complete";
type EngineFunctionKey =
  | "pickUnchargedCell"
  | "waitAfterPickup"
  | "findAgilityCourse"
  | "waitAfterAgilityCourseYellowClick"
  | "findOrange"
  | "waitForMiningTimer"
  | "mine"
  | "waitAfterAgilityMiningYellowClick"
  | "workbenchFindYellow"
  | "craft"
  | "travelToGuardian"
  | "waitAfterGuardianClick"
  | "waitAfterGuardianYellowClick"
  | "findReturnPortal"
  | "waitAfterGuardianReturnClick"
  | "findGreatGuardian"
  | "waitAfterGreatGuardianClick"
  | "findChargedCellDeposit"
  | "waitAfterChargedCellDepositClick"
  | "findRuneDeposit"
  | "waitAfterRuneDepositClick"
  | "waitForFinalPortalOpenIcon"
  | "findFinalPortal"
  | "waitAfterFinalPortalClick"
  | "findPortalMiningMagenta"
  | "portalMining"
  | "findPortalExit"
  | "waitAfterPortalExitClick";

type GuardianCoordinateLocation = {
  matchedLine: string;
  x: number;
  y: number;
  z: number | null;
  chunkId: number;
  regionId: number;
};

type BotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  actionLockUntilMs: number;
  lastPickupClickScreen: { x: number; y: number } | null;
  pickupArrivalDeadlineMs: number;
  pickupDistancePx: number | null;
  missingTargetTicks: number;
  missingAgilityCourseTicks: number;
  agilityCourseYellowArrivalDeadlineMs: number;
  agilityCourseYellowClickDistancePx: number | null;
  agilityCourseTargetConfirmed: boolean;
  agilityMiningYellowArrivalDeadlineMs: number;
  agilityMiningYellowClickDistancePx: number | null;
  missingOrangeTicks: number;
  missingMiningTimerTicks: number;
  missingYellowTicks: number;
  eastMoveClickCount: number;
  westMoveClickCount: number;
  miningOrangeReclicked: boolean;
  lastTimerSecondsRemaining: number | null;
  lastTimerObservedAtMs: number | null;
  miningTimerReliableReadCount: number;
  miningTimerLocalStartSecondsRemaining: number | null;
  miningTimerLocalStartedAtMs: number | null;
  miningStatusGreenStartedAtMs: number | null;
  inventoryFreeSlots: number | null;
  missingInventoryCountTicks: number;
  craftingInventoryChangeDeadlineMs: number;
  guardianArrivalDeadlineMs: number;
  guardianClickDistancePx: number | null;
  guardianCoordinateConfirmed: boolean;
  guardianAltarStartLocation: GuardianCoordinateLocation | null;
  guardianYellowArrivalDeadlineMs: number;
  guardianReturnArrivalDeadlineMs: number;
  guardianReturnClickDistancePx: number | null;
  greatGuardianArrivalDeadlineMs: number;
  greatGuardianClickDistancePx: number | null;
  chargedCellDepositArrivalDeadlineMs: number;
  chargedCellDepositClickDistancePx: number | null;
  runeDepositArrivalDeadlineMs: number;
  runeDepositClickDistancePx: number | null;
  runeDepositInventoryFreeSlotsBeforeClick: number | null;
  finalPortalArrivalDeadlineMs: number;
  finalPortalClickDistancePx: number | null;
  portalMiningArrivalDeadlineMs: number;
  portalExitArrivalDeadlineMs: number;
  portalExitClickDistancePx: number | null;
  missingGuardianYellowTicks: number;
  missingGuardianReturnRedTicks: number;
  missingGreatGuardianTicks: number;
  missingChargedCellDepositTicks: number;
  missingRuneDepositTicks: number;
  missingFinalPortalOpenIconTicks: number;
  missingFinalPortalTicks: number;
  missingPortalMiningMagentaTicks: number;
  missingPortalExitTicks: number;
};

type TickCapture = {
  bitmap: RobotBitmap;
};

type RedPickupTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
  fillRatio: number;
  score: number;
};

type RedCandidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type OrangeObjectDetection = {
  centerX: number;
  centerY: number;
  pixelCount: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type WorkbenchMarkerDetection = OrangeObjectDetection;
type GreenObjectDetection = OrangeObjectDetection;
type ColoredMarkerDetection = OrangeObjectDetection;

type TimerRead = {
  secondsRemaining: number | null;
  source: "ocr" | "local" | "missing" | "rejected";
  rawText: string | null;
  ocrSecondsRemaining: number | null;
  rejectedReason: string | null;
};

type TravelWaitEstimate = {
  waitTicks: number;
  travelTicks: number;
  distancePx: number;
  distanceTiles: number;
  tilePx: number;
};

const BOT_NAME = "Runecrafting - Guardian of the Rift";
const STEP_PICK_UNCHARGED_CELL_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-pick-uncharged-cell`;
const STEP_WAIT_AFTER_PICKUP_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-wait-after-pickup`;
const STEP_AGILITY_COURSE_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-agility-course`;
const STEP_ORANGE_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-orange`;
const STEP_WAIT_MINING_TIMER_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-wait-mining-timer`;
const STEP_MINING_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-mining`;
const STEP_WORKBENCH_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-workbench`;
const STEP_CRAFTING_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-crafting`;
const STEP_TRAVEL_GUARDIAN_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-travel-guardian`;
const STEP_GREAT_GUARDIAN_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-great-guardian`;
const STEP_CHARGED_CELL_DEPOSIT_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-charged-cell-deposit`;
const STEP_RUNE_DEPOSIT_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-rune-deposit`;
const STEP_FINAL_PORTAL_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-final-portal`;
const GAME_TICK_MS = 600;
const STARTUP_SETTLE_MS = 180;
const CLICK_SAFE_EDGE_MARGIN_PX = 3;
const PURE_RED_MIN_PIXEL_COUNT = 24;
const PURE_RED_MAX_COMPONENT_WIDTH_RATIO = 0.18;
const PURE_RED_MAX_COMPONENT_HEIGHT_RATIO = 0.18;
const RETURN_PORTAL_MARKER_COLOR_HEX = "FFFF0000";
const RETURN_PORTAL_RED_MIN_PIXELS = 300;
const RETURN_PORTAL_MIN_SIZE_TO_SCREEN_HEIGHT_RATIO = 0.018;
const RETURN_PORTAL_MAX_SIZE_TO_SCREEN_HEIGHT_RATIO = 0.085;
const RETURN_PORTAL_MIN_FILL_RATIO = 0.45;
const RETURN_PORTAL_MAX_ASPECT_RATIO = 1.8;
const PLAYER_TRAVEL_SPEED_TILES_PER_TICK = 2;
const TRAVEL_MIN_TICKS = 1;
const TRAVEL_EXTRA_WAIT_TICKS = 1;
const AGILITY_COURSE_TARGET_X = 3637;
const AGILITY_COURSE_TARGET_Y = 9503;
const AGILITY_COURSE_MARKER_MIN_PIXELS = 50;
const PORTAL_MINING_MARKER_COLOR_HEX = "FFAD00FF";
const PORTAL_MINING_MAGENTA_MIN_PIXELS = 50;
const AGILITY_EAST_CLICK_RATIO_X = 0.68;
const AGILITY_EAST_CLICK_RATIO_Y = 0.5;
const AGILITY_EAST_CLICK_LOCK_TICKS = 3;
const WORKBENCH_WEST_CLICK_RATIO_X = 0.34;
const WORKBENCH_SOUTH_WEST_WEST_DISTANCE_RATIO_X = 0.3;
const WORKBENCH_SOUTH_WEST_WEST_DISTANCE_RATIO_Y = 0.2;
const WORKBENCH_SOUTH_WEST_WEST_MAX_SOUTH_OF_WEST_RATIO = 0.65;
const WORKBENCH_WEST_CLICK_LOCK_TICKS = 3;
const FREE_MOVE_MIN_DISTANCE_TILES = 10;
const FREE_MOVE_TILE_PX_FALLBACK = 48;
const FREE_MOVE_TILE_PX_MIN = 24;
const FREE_MOVE_TILE_PX_MAX = 96;
const STARTUP_RAW_TILE_PX_MIN_TRUSTED = 35;
const STARTUP_RAW_TILE_PX_MAX_TRUSTED = 70;
const RUNE_DEPOSIT_SOUTH_CLICK_MIN_RATIO_X = 0.42;
const RUNE_DEPOSIT_SOUTH_CLICK_MAX_RATIO_X = 0.56;
const RUNE_DEPOSIT_SOUTH_CLICK_RATIO_Y = 0.74;
const RUNE_DEPOSIT_SOUTH_MIN_DISTANCE_RATIO = 0.16;
const ORANGE_MIN_PIXELS = 40;
const WORKBENCH_MAGENTA_MIN_PIXELS = 40;
const GREEN_MIN_PIXELS = 240;
const GUARDIAN_BLACK_MAX_COMPONENT = 70;
const GUARDIAN_BLACK_MIN_EDGE_MARGIN_PX = 2;
const GREAT_GUARDIAN_BLUE_MIN_PIXELS = 120;
const CHARGED_CELL_DEPOSIT_PURPLE_MIN_PIXELS = 40;
const RUNE_DEPOSIT_PINK_MIN_PIXELS = 40;
const MINING_ORANGE_RECLICK_MIN_DELAY_MS = 0;
const MINING_ORANGE_RECLICK_MAX_DELAY_MS = 3_000;
const WORKBENCH_CRAFT_CLICK_LOCK_TICKS = 3;
const GUARDIAN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_YELLOW_CLICK_LOCK_TICKS = 2;
const GUARDIAN_RETURN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_GREEN_CLICK_TARGET_Y_RATIO = 0.22;
const GUARDIAN_ALTAR_SEARCH_RETRY_TICKS = 8;
const GUARDIAN_ALTAR_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS = 8;
const GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_LOCK_TICKS = 1;
const POST_RETURN_CAMERA_NORTH_KEY = "n";
const WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS = 2;
const PORTAL_MINING_INVENTORY_CHANGE_CHECK_TICKS = 5;
const GUARDIAN_CRAFTING_CHUNK_ID = 926881;
const GUARDIAN_CRAFTING_REGION_ID = 14484;
const MINING_TIMER_WORKBENCH_THRESHOLD_SECONDS = 31;
const MINING_TIMER_MAX_PLAUSIBLE_SECONDS = 120;
const MINING_TIMER_LOCAL_READS_REQUIRED = 3;
const MINING_TIMER_OCR_MAX_FORWARD_DRIFT_SECONDS = 1;
const MINING_TIMER_OCR_EXTRA_DROP_TOLERANCE_SECONDS = 0;
const MINING_STATUS_GREEN_MAX_DURATION_MS = 90_000;
const TIMER_PRESENCE_ROI = { x: 88, y: 116, width: 96, height: 34 };
const TIMER_PRESENCE_MIN_BRIGHT_PIXELS = 18;
const ENABLE_COORDINATE_AUTO_SCREENSHOTS = false;
const COORDINATE_AUTO_SCREENSHOT_INTERVAL_TICKS = 10;
const WORKFLOW_STEPS = {
  TAKE_UNCHARGED_CELL: "Step 01/30 Take uncharged cell",
  FIND_MINING_NODE: "Step 02/30 Find mining node",
  MOVE_TO_MINING_NODE: "Step 03/30 Move to mining node",
  FIND_AGILITY_COURSE: "Step 03.A/30 Find agility course yellow marker",
  MOVE_TO_AGILITY_COURSE: "Step 03.B/30 Travel to agility course yellow marker",
  CHECK_AGILITY_COURSE_COORDINATE: "Step 03.C/30 Check agility course coordinate",
  AGILITY_COURSE_MINE_ORANGE: "Step 03.D/30 Mine orange after agility course",
  AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER: "Step 03.E/30 Click yellow after timer",
  START_MINING: "Step 04/30 Mine 90s after mining status turns green",
  FIND_WORKBENCH: "Step 05/30 Find workbench",
  MOVE_TO_WORKBENCH: "Step 06/30 Move to workbench",
  CRAFT_UNTIL_FULL: "Step 07/30 Craft until inventory is full",
  FIND_GUARDIAN: "Step 08/30 Find guardian",
  MOVE_TO_GUARDIAN: "Step 09/30 Move to guardian",
  TELEPORT_TO_ALTAR: "Step 10/30 Teleport to altar region",
  FIND_ALTAR: "Step 11/30 Find altar",
  MOVE_TO_ALTAR: "Step 12/30 Move to altar",
  FIND_PORTAL: "Step 13/30 Find red portal",
  MOVE_TO_PORTAL: "Step 14/30 Move to red portal",
  TELEPORT_BACK: "Step 15/30 Teleport back to crafting region",
  FIND_GREAT_GUARDIAN: "Step 16/30 Find the great guardian",
  TRAVEL_TO_GREAT_GUARDIAN: "Step 17/30 Travel to great guardian",
  FIND_CHARGED_CELL_DEPOSIT: "Step 18/30 Find charged cell deposit",
  TRAVEL_TO_CHARGED_CELL_DEPOSIT: "Step 19/30 Travel to charged cell deposit",
  FIND_RUNE_DEPOSIT: "Step 20/30 Find rune deposit",
  TRAVEL_TO_RUNE_DEPOSIT: "Step 21/30 Travel to rune deposit",
  WAIT_FOR_FINAL_PORTAL_ICON: "Step 22/30 Check for open portal icon",
  FIND_FINAL_PORTAL: "Step 23/30 Check for salmon portal",
  MOVE_TO_FINAL_PORTAL: "Step 24/30 Move to portal",
  CHECK_PORTAL_MINING_MAGENTA: "Step 25/30 Check if magenta is clickable",
  TRAVEL_TO_PORTAL_MINING: "Step 26/30 Travel to mining",
  PORTAL_MINE_UNTIL_FULL: "Step 27/30 Mining until inventory is full",
  FIND_PORTAL_EXIT: "Step 28/30 Find and click salmon portal",
  TRAVEL_TO_PORTAL_EXIT: "Step 29/30 Travel to portal",
  REPEAT_GUARDIAN_CLICK: "Step 30/30 Repeat guardian click",
} as const;

let isLoopRunning = false;
let startedAtMs: number | null = null;
let currentLogLoopIndex = 0;
let currentLogPhase: BotPhase | "startup" = "startup";
let currentWindowsScalePercent = 100;
let currentMonitorTier = "2k";
let currentDistanceTilePx = FREE_MOVE_TILE_PX_FALLBACK;

function formatElapsedSinceStart(): string {
  if (startedAtMs === null) {
    return "+0ms";
  }

  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const ms = String(elapsedMs % 1000).padStart(3, "0");
  return `+${mm}:${ss}.${ms}`;
}

function setCurrentLogLoopIndex(loopIndex: number): void {
  currentLogLoopIndex = Number.isFinite(loopIndex) && loopIndex >= 0 ? Math.floor(loopIndex) : 0;
}

function setCurrentLogPhase(phase: BotPhase | "startup" | null | undefined): void {
  if (phase === "startup") {
    currentLogPhase = "startup";
    return;
  }

  currentLogPhase =
    phase === "pick-uncharged-cell" ||
    phase === "wait-after-pickup" ||
    phase === "find-agility-course" ||
    phase === "wait-after-agility-course-yellow-click" ||
    phase === "find-orange" ||
    phase === "wait-for-mining-timer" ||
    phase === "mining" ||
    phase === "wait-after-agility-mining-yellow-click" ||
    phase === "workbench-find-yellow" ||
    phase === "crafting" ||
    phase === "travel-to-guardian" ||
    phase === "wait-after-guardian-click" ||
    phase === "wait-after-guardian-yellow-click" ||
    phase === "find-return-portal" ||
    phase === "wait-after-guardian-return-click" ||
    phase === "find-great-guardian" ||
    phase === "wait-after-great-guardian-click" ||
    phase === "find-charged-cell-deposit" ||
    phase === "wait-after-charged-cell-deposit-click" ||
    phase === "find-rune-deposit" ||
    phase === "wait-after-rune-deposit-click" ||
    phase === "wait-for-final-portal-open-icon" ||
    phase === "find-final-portal" ||
    phase === "wait-after-final-portal-click" ||
    phase === "find-portal-mining-magenta" ||
    phase === "portal-mining" ||
    phase === "find-portal-exit" ||
    phase === "wait-after-portal-exit-click" ||
    phase === "complete"
      ? phase
      : "startup";
}

function formatLogLine(message: string): string {
  const stepMatch = /^(Step [^:]+): (.*)$/.exec(message);
  if (stepMatch) {
    const [, step, detail] = stepMatch;
    return `[${formatElapsedSinceStart()}] #${currentLogLoopIndex} [${step}] [${currentLogPhase}] ${detail}`;
  }

  return `[${formatElapsedSinceStart()}] #${currentLogLoopIndex} [${currentLogPhase}] ${message}`;
}

function log(message: string): void {
  logger.log(formatLogLine(message));
}

function warn(message: string): void {
  logger.warn(formatLogLine(message));
}

function stepMessage(step: (typeof WORKFLOW_STEPS)[keyof typeof WORKFLOW_STEPS], message: string): string {
  return `${step}: ${message}`;
}

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }

  stopAutomateBot("bot");
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

function getMonitorTier(bounds: ScreenCaptureBounds, scaleFactor: number): "2k" | "4k" {
  const display = electronScreen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });

  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const nativeWidth = Math.round(display.bounds.width * scale);
  const nativeHeight = Math.round(display.bounds.height * scale);

  return nativeWidth >= 3200 || nativeHeight >= 1800 ? "4k" : "2k";
}

function toPhysicalBounds(bounds: ScreenCaptureBounds, scaleFactor: number): ScreenCaptureBounds {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createInitialState(): BotState {
  return {
    loopIndex: 0,
    currentFunction: "pickUnchargedCell",
    phase: "pick-uncharged-cell",
    actionLockUntilMs: 0,
    lastPickupClickScreen: null,
    pickupArrivalDeadlineMs: 0,
    pickupDistancePx: null,
    missingTargetTicks: 0,
    missingAgilityCourseTicks: 0,
    agilityCourseYellowArrivalDeadlineMs: 0,
    agilityCourseYellowClickDistancePx: null,
    agilityCourseTargetConfirmed: false,
    agilityMiningYellowArrivalDeadlineMs: 0,
    agilityMiningYellowClickDistancePx: null,
    missingOrangeTicks: 0,
    missingMiningTimerTicks: 0,
    missingYellowTicks: 0,
    eastMoveClickCount: 0,
    westMoveClickCount: 0,
    miningOrangeReclicked: false,
    lastTimerSecondsRemaining: null,
    lastTimerObservedAtMs: null,
    miningTimerReliableReadCount: 0,
    miningTimerLocalStartSecondsRemaining: null,
    miningTimerLocalStartedAtMs: null,
    miningStatusGreenStartedAtMs: null,
    inventoryFreeSlots: null,
    missingInventoryCountTicks: 0,
    craftingInventoryChangeDeadlineMs: 0,
    guardianArrivalDeadlineMs: 0,
    guardianClickDistancePx: null,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    guardianYellowArrivalDeadlineMs: 0,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: 0,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingGuardianYellowTicks: 0,
    missingGuardianReturnRedTicks: 0,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
    missingPortalMiningMagentaTicks: 0,
    missingPortalExitTicks: 0,
  };
}

function isPureRuneLiteRedPixel(r: number, g: number, b: number): boolean {
  return r >= 245 && g <= 20 && b <= 20;
}

function isReturnPortalRedPixel(r: number, g: number, b: number): boolean {
  return r >= 245 && g <= 24 && b <= 24;
}

function isStrictOrangePixel(r: number, g: number, b: number): boolean {
  return Math.abs(r - 255) <= 10 && Math.abs(g - 115) <= 18 && b <= 24;
}

function isAgilityCourseMarkerPixel(r: number, g: number, b: number): boolean {
  return Math.abs(r - 204) <= 18 && g >= 235 && b <= 24 && g - r >= 35 && g - r <= 75;
}

function isWorkbenchMagentaPixel(r: number, g: number, b: number): boolean {
  return r >= 145 && r <= 205 && g <= 45 && b >= 225 && b - r >= 35;
}

function isPortalMiningMagentaPixel(r: number, g: number, b: number): boolean {
  return Math.abs(r - 173) <= 10 && g <= 24 && Math.abs(b - 255) <= 10;
}

function isGuardianGreenPixel(r: number, g: number, b: number): boolean {
  return g >= 190 && r <= 80 && b <= 80 && g - Math.max(r, b) >= 140;
}

function isGuardianBlackPixel(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) <= GUARDIAN_BLACK_MAX_COMPONENT && Math.max(r, g, b) - Math.min(r, g, b) <= 45;
}

function isGreatGuardianBluePixel(r: number, g: number, b: number): boolean {
  return r <= 55 && g <= 45 && b >= 210 && b - Math.max(r, g) >= 150;
}

function isChargedCellDepositPurplePixel(r: number, g: number, b: number): boolean {
  return r >= 95 && r <= 165 && g <= 45 && b >= 215 && b - r >= 70;
}

function isRuneDepositPinkPixel(r: number, g: number, b: number): boolean {
  return r >= 225 && g <= 65 && b >= 110 && b <= 190 && r - b >= 55;
}

function isBrightTimerTextPixel(r: number, g: number, b: number): boolean {
  return r >= 190 && g >= 190 && b >= 190 && Math.max(r, g, b) - Math.min(r, g, b) <= 80;
}

function resolveRedPickupSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.04), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.05), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.78), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.78), 0, bitmap.height - 1),
  };
}

function resolveGuardianPostReturnSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.04), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.05), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.78), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.86), 0, bitmap.height - 1),
  };
}

function resolveReturnPortalSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.04), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.05), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.96), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.9), 0, bitmap.height - 1),
  };
}

function resolvePortalMiningMagentaSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.02), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.04), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.96), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.9), 0, bitmap.height - 1),
  };
}

function resolveAgilityCourseMarkerSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.02), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.04), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.96), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.9), 0, bitmap.height - 1),
  };
}

function buildPureRedMask(bitmap: RobotBitmap, bounds: SearchBounds): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isPureRuneLiteRedPixel(r, g, b)) {
        mask[y * bitmap.width + x] = 1;
      }
    }
  }

  return mask;
}

function collectRedCandidates(mask: Uint8Array, bitmap: RobotBitmap): RedCandidate[] {
  const remaining = mask.slice();
  const candidates: RedCandidate[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    remaining[startIndex] = 0;

    let minX = bitmap.width;
    let minY = bitmap.height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) {
        break;
      }

      const x = index % bitmap.width;
      const y = Math.floor(index / bitmap.width);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixelCount += 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= bitmap.width || nextY >= bitmap.height) {
            continue;
          }

          const nextIndex = nextY * bitmap.width + nextX;
          if (!remaining[nextIndex]) {
            continue;
          }

          remaining[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    candidates.push({ minX, minY, maxX, maxY, pixelCount });
  }

  return candidates;
}

function toRedPickupTarget(candidate: RedCandidate, bitmap: RobotBitmap): RedPickupTarget | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const maxComponentWidth = Math.max(24, Math.round(bitmap.width * PURE_RED_MAX_COMPONENT_WIDTH_RATIO));
  const maxComponentHeight = Math.max(24, Math.round(bitmap.height * PURE_RED_MAX_COMPONENT_HEIGHT_RATIO));

  if (
    candidate.pixelCount < PURE_RED_MIN_PIXEL_COUNT ||
    width <= 0 ||
    height <= 0 ||
    width > maxComponentWidth ||
    height > maxComponentHeight
  ) {
    return null;
  }

  const fillRatio = candidate.pixelCount / (width * height);
  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);
  const centerDistanceX = Math.abs(centerX - bitmap.width * 0.42);
  const centerDistanceY = Math.abs(centerY - bitmap.height * 0.45);
  const normalizedDistance =
    Math.sqrt(centerDistanceX * centerDistanceX + centerDistanceY * centerDistanceY) /
    Math.sqrt(bitmap.width * bitmap.width + bitmap.height * bitmap.height);
  const score = candidate.pixelCount + width * height * 0.12 + fillRatio * 90 - normalizedDistance * 160;

  return {
    x: candidate.minX,
    y: candidate.minY,
    width,
    height,
    centerX,
    centerY,
    pixelCount: candidate.pixelCount,
    fillRatio,
    score,
  };
}

function detectBestRedPickupTarget(bitmap: RobotBitmap): RedPickupTarget | null {
  const bounds = resolveRedPickupSearchBounds(bitmap);
  const mask = buildPureRedMask(bitmap, bounds);
  const targets = collectRedCandidates(mask, bitmap)
    .map((candidate) => toRedPickupTarget(candidate, bitmap))
    .filter((target): target is RedPickupTarget => target !== null)
    .sort((a, b) => b.score - a.score);

  return targets[0] ?? null;
}

function detectAllOrangeObjects(bitmap: RobotBitmap, minPixels: number = ORANGE_MIN_PIXELS): OrangeObjectDetection[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Uint8Array(width * height);
  const detections: OrangeObjectDetection[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isStrictOrangePixel(r, g, b)) {
        continue;
      }

      const stack = [{ x, y }];
      let pixelCount = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, current.x);
        maxY = Math.max(maxY, current.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = current.x + dx;
            const nextY = current.y + dy;
            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
              continue;
            }

            const nextIndex = nextY * width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (isStrictOrangePixel(nextR, nextG, nextB)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      detections.push({
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

function detectAllWorkbenchMagentaObjects(
  bitmap: RobotBitmap,
  minPixels: number = WORKBENCH_MAGENTA_MIN_PIXELS,
): WorkbenchMarkerDetection[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Uint8Array(width * height);
  const detections: WorkbenchMarkerDetection[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isWorkbenchMagentaPixel(r, g, b)) {
        continue;
      }

      const stack = [{ x, y }];
      let pixelCount = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, current.x);
        maxY = Math.max(maxY, current.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = current.x + dx;
            const nextY = current.y + dy;
            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
              continue;
            }

            const nextIndex = nextY * width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (isWorkbenchMagentaPixel(nextR, nextG, nextB)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      detections.push({
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

function detectAllPortalMiningMagentaObjects(
  bitmap: RobotBitmap,
  minPixels: number = PORTAL_MINING_MAGENTA_MIN_PIXELS,
): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(
    bitmap,
    isPortalMiningMagentaPixel,
    minPixels,
    resolvePortalMiningMagentaSearchBounds(bitmap),
  );
}

function detectAllColoredMarkers(
  bitmap: RobotBitmap,
  isTargetPixel: (r: number, g: number, b: number) => boolean,
  minPixels: number,
  bounds: SearchBounds = resolveGuardianPostReturnSearchBounds(bitmap),
): ColoredMarkerDetection[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Uint8Array(width * height);
  const detections: ColoredMarkerDetection[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isTargetPixel(r, g, b)) {
        continue;
      }

      const stack = [{ x, y }];
      let pixelCount = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, current.x);
        maxY = Math.max(maxY, current.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = current.x + dx;
            const nextY = current.y + dy;
            if (nextX < bounds.minX || nextY < bounds.minY || nextX > bounds.maxX || nextY > bounds.maxY) {
              continue;
            }

            const nextIndex = nextY * width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (isTargetPixel(nextR, nextG, nextB)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      if (componentWidth < 3 || componentHeight < 3) {
        continue;
      }

      detections.push({
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        width: componentWidth,
        height: componentHeight,
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

function detectAllGreatGuardianBlueObjects(bitmap: RobotBitmap): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(bitmap, isGreatGuardianBluePixel, GREAT_GUARDIAN_BLUE_MIN_PIXELS);
}

function detectAllAgilityCourseMarkers(bitmap: RobotBitmap): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(
    bitmap,
    isAgilityCourseMarkerPixel,
    AGILITY_COURSE_MARKER_MIN_PIXELS,
    resolveAgilityCourseMarkerSearchBounds(bitmap),
  );
}

function isReturnPortalMarkerShape(bitmap: RobotBitmap, detection: ColoredMarkerDetection): boolean {
  const minSize = bitmap.height * RETURN_PORTAL_MIN_SIZE_TO_SCREEN_HEIGHT_RATIO;
  const maxSize = bitmap.height * RETURN_PORTAL_MAX_SIZE_TO_SCREEN_HEIGHT_RATIO;
  const fillRatio = detection.pixelCount / Math.max(1, detection.width * detection.height);
  const aspectRatio = Math.max(detection.width / detection.height, detection.height / detection.width);

  return (
    detection.width >= minSize &&
    detection.height >= minSize &&
    detection.width <= maxSize &&
    detection.height <= maxSize &&
    fillRatio >= RETURN_PORTAL_MIN_FILL_RATIO &&
    aspectRatio <= RETURN_PORTAL_MAX_ASPECT_RATIO
  );
}

export function detectAllReturnPortalRedMarkers(bitmap: RobotBitmap): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(
    bitmap,
    isReturnPortalRedPixel,
    RETURN_PORTAL_RED_MIN_PIXELS,
    resolveReturnPortalSearchBounds(bitmap),
  ).filter((detection) => isReturnPortalMarkerShape(bitmap, detection));
}

function detectAllChargedCellDepositObjects(bitmap: RobotBitmap): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(bitmap, isChargedCellDepositPurplePixel, CHARGED_CELL_DEPOSIT_PURPLE_MIN_PIXELS);
}

function detectAllRuneDepositObjects(bitmap: RobotBitmap): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(bitmap, isRuneDepositPinkPixel, RUNE_DEPOSIT_PINK_MIN_PIXELS);
}

function detectAllGreenObjects(bitmap: RobotBitmap, minPixels: number = GREEN_MIN_PIXELS): GreenObjectDetection[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Uint8Array(width * height);
  const detections: GreenObjectDetection[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isGuardianGreenPixel(r, g, b)) {
        continue;
      }

      const stack = [{ x, y }];
      let pixelCount = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, current.x);
        maxY = Math.max(maxY, current.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = current.x + dx;
            const nextY = current.y + dy;
            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
              continue;
            }

            const nextIndex = nextY * width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (isGuardianGreenPixel(nextR, nextG, nextB)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      detections.push({
        centerX: Math.round((minX + maxX) / 2),
        centerY: Math.round((minY + maxY) / 2),
        pixelCount,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

function clickScreenPoint(screenX: number, screenY: number, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
  const requestedX = Math.round(screenX);
  const requestedY = Math.round(screenY);
  const safeX = clamp(
    requestedX,
    captureBounds.x + CLICK_SAFE_EDGE_MARGIN_PX,
    captureBounds.x + captureBounds.width - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
  );
  const safeY = clamp(
    requestedY,
    captureBounds.y + CLICK_SAFE_EDGE_MARGIN_PX,
    captureBounds.y + captureBounds.height - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
  );

  moveMouse(safeX, safeY);
  mouseClick("left", false);
  return { x: safeX, y: safeY };
}

function tapKey(key: string): boolean {
  if (typeof keyToggle === "function") {
    try {
      keyToggle(key, "down");
      keyToggle(key, "up");
      return true;
    } catch (error) {
      warn(`RobotJS keyToggle('${key}') failed: ${error instanceof Error ? error.message : String(error)}. Trying keyTap fallback.`);
    }
  }

  if (typeof keyTap !== "function") {
    return false;
  }

  try {
    keyTap(key);
  } catch (error) {
    warn(`RobotJS keyTap('${key}') failed: ${error instanceof Error ? error.message : String(error)}.`);
    return false;
  }

  return true;
}

function hasGuardianTimerTextPresence(bitmap: RobotBitmap): boolean {
  const minX = clamp(TIMER_PRESENCE_ROI.x, 0, bitmap.width - 1);
  const minY = clamp(TIMER_PRESENCE_ROI.y, 0, bitmap.height - 1);
  const maxX = clamp(TIMER_PRESENCE_ROI.x + TIMER_PRESENCE_ROI.width - 1, minX, bitmap.width - 1);
  const maxY = clamp(TIMER_PRESENCE_ROI.y + TIMER_PRESENCE_ROI.height - 1, minY, bitmap.height - 1);
  let brightPixels = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isBrightTimerTextPixel(r, g, b)) {
        brightPixels += 1;
        if (brightPixels >= TIMER_PRESENCE_MIN_BRIGHT_PIXELS) {
          return true;
        }
      }
    }
  }

  return false;
}

function getPlayerAnchor(bitmap: RobotBitmap): PlayerBox | { centerX: number; centerY: number } {
  return detectBestPlayerBoxInScreenshot(bitmap) ?? {
    centerX: Math.round(bitmap.width * 0.5),
    centerY: Math.round(bitmap.height * 0.52),
  };
}

function distanceBetween(a: { centerX: number; centerY: number }, b: { centerX: number; centerY: number }): number {
  const dx = a.centerX - b.centerX;
  const dy = a.centerY - b.centerY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getBoundsCenterPoint(marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">): {
  centerX: number;
  centerY: number;
} {
  return {
    centerX: Math.round((marker.minX + marker.maxX) / 2),
    centerY: Math.round((marker.minY + marker.maxY) / 2),
  };
}

function getMiningOrangeReclickDelayMs(): number {
  return (
    MINING_ORANGE_RECLICK_MIN_DELAY_MS +
    Math.floor(Math.random() * (MINING_ORANGE_RECLICK_MAX_DELAY_MS - MINING_ORANGE_RECLICK_MIN_DELAY_MS + 1))
  );
}

function formatDelaySeconds(delayMs: number): string {
  return `${(delayMs / 1000).toFixed(2)}s`;
}

function readGuardianCoordinateLocation(bitmap: RobotBitmap): GuardianCoordinateLocation | null {
  const location = readCoordinateOverlayLocation(bitmap, currentWindowsScalePercent);
  if (!location) {
    return null;
  }

  return {
    matchedLine: location.matchedLine,
    x: location.x,
    y: location.y,
    z: location.z,
    chunkId: location.chunkId,
    regionId: location.regionId,
  };
}

function isAtAgilityCourseMiningCoordinate(location: GuardianCoordinateLocation | null): boolean {
  return location !== null && location.x === AGILITY_COURSE_TARGET_X && location.y === AGILITY_COURSE_TARGET_Y;
}

function isGuardianCoordinateLocation(location: GuardianCoordinateLocation | null): location is GuardianCoordinateLocation {
  return location !== null;
}

function hasLeftGuardianCraftingChunk(bitmap: RobotBitmap): {
  left: boolean;
  matchedLine: string | null;
  chunkId: number | null;
  regionId: number | null;
} {
  const location = readGuardianCoordinateLocation(bitmap);
  if (!location) {
    return {
      left: false,
      matchedLine: null,
      chunkId: null,
      regionId: null,
    };
  }

  return {
    left: location.chunkId !== GUARDIAN_CRAFTING_CHUNK_ID && location.regionId !== GUARDIAN_CRAFTING_REGION_ID,
    matchedLine: location.matchedLine,
    chunkId: location.chunkId,
    regionId: location.regionId,
  };
}

function estimateTravelWaitTicks(
  playerAnchor: { centerX: number; centerY: number },
  target: { centerX: number; centerY: number },
): TravelWaitEstimate {
  const dxPx = target.centerX - playerAnchor.centerX;
  const dyPx = target.centerY - playerAnchor.centerY;
  const distancePx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
  const tilePx = getFreeMoveTilePx(playerAnchor);
  const distanceTiles = Math.max(Math.abs(dxPx), Math.abs(dyPx)) / Math.max(1, tilePx);
  const travelTicks = Math.max(TRAVEL_MIN_TICKS, Math.ceil(distanceTiles / PLAYER_TRAVEL_SPEED_TILES_PER_TICK));

  return {
    waitTicks: travelTicks + TRAVEL_EXTRA_WAIT_TICKS,
    travelTicks,
    distancePx,
    distanceTiles,
    tilePx,
  };
}

function formatTravelEstimate(travel: TravelWaitEstimate): string {
  return `distance=${Math.round(travel.distancePx)}px tiles~${travel.distanceTiles.toFixed(1)} tilePx=${travel.tilePx}px travel=${travel.travelTicks} tick(s) wait=${travel.waitTicks} tick(s)`;
}

function toWaitAfterPickupState(
  state: BotState,
  nowMs: number,
  clicked: { x: number; y: number },
  travel: TravelWaitEstimate,
  config: GuardianOfTheRiftConfig,
): BotState {
  setAutomateBotCurrentStep(STEP_WAIT_AFTER_PICKUP_ID);
  log(
    stepMessage(
      config.useAgilityCourse ? WORKFLOW_STEPS.MOVE_TO_AGILITY_COURSE : WORKFLOW_STEPS.MOVE_TO_MINING_NODE,
      `Waiting ${travel.waitTicks} game tick(s) after uncharged-cell pickup before ${config.useAgilityCourse ? "agility-course search" : "mining-node search"} (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterPickup",
    phase: "wait-after-pickup",
    lastPickupClickScreen: clicked,
    pickupArrivalDeadlineMs: nowMs + travel.waitTicks * GAME_TICK_MS,
    pickupDistancePx: travel.distancePx,
    missingTargetTicks: 0,
  };
}

function runPickUnchargedCellTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const target = detectBestRedPickupTarget(tickCapture.bitmap);
  if (!target) {
    const missingTargetTicks = state.missingTargetTicks + 1;
    if (missingTargetTicks === 1 || missingTargetTicks % 5 === 0) {
      warn(
        stepMessage(WORKFLOW_STEPS.TAKE_UNCHARGED_CELL, "No red uncharged-cell pickup marker found in the scene."),
      );
    }

    return {
      ...state,
      missingTargetTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const travel = estimateTravelWaitTicks(playerAnchor, target);
  const clicked = clickScreenPoint(captureBounds.x + target.centerX, captureBounds.y + target.centerY, captureBounds);
  log(
    stepMessage(
      WORKFLOW_STEPS.TAKE_UNCHARGED_CELL,
      `Clicked red uncharged-cell pickup marker at (${clicked.x},${clicked.y}) local=(${target.centerX},${target.centerY}) pixels=${target.pixelCount} ${formatTravelEstimate(travel)}.`,
    ),
  );

  return toWaitAfterPickupState(state, nowMs, clicked, travel, config);
}

function transitionToMiningState(state: BotState): BotState {
  setAutomateBotCurrentStep(STEP_MINING_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.START_MINING,
      "Mining node clicked; waiting for mining status to turn green, then counting 90s before changing phase.",
    ),
  );
  return {
    ...state,
    currentFunction: "mine",
    phase: "mining",
    miningOrangeReclicked: false,
    missingMiningTimerTicks: 0,
    lastTimerSecondsRemaining: null,
    lastTimerObservedAtMs: null,
    miningTimerReliableReadCount: 0,
    miningTimerLocalStartSecondsRemaining: null,
    miningTimerLocalStartedAtMs: null,
    miningStatusGreenStartedAtMs: null,
  };
}

function startMiningMonitorState(state: BotState, secondsRemaining: number | null, observedAtMs: number): BotState {
  setAutomateBotCurrentStep(STEP_MINING_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.START_MINING,
      `Mining started; reading real timer until ${MINING_TIMER_LOCAL_READS_REQUIRED} good read(s), then using local countdown until under ${MINING_TIMER_WORKBENCH_THRESHOLD_SECONDS}s (timer=${secondsRemaining ?? "unreadable"}).`,
    ),
  );
  return {
    ...state,
    currentFunction: "mine",
    phase: "mining",
    actionLockUntilMs: 0,
    lastTimerSecondsRemaining: secondsRemaining,
    lastTimerObservedAtMs: secondsRemaining === null ? null : observedAtMs,
    miningTimerReliableReadCount: secondsRemaining === null ? 0 : 1,
    miningTimerLocalStartSecondsRemaining: null,
    miningTimerLocalStartedAtMs: null,
    miningStatusGreenStartedAtMs: null,
  };
}

function runWaitAfterPickupTick(state: BotState, nowMs: number, config: GuardianOfTheRiftConfig): BotState {
  if (nowMs < state.pickupArrivalDeadlineMs) {
    return state;
  }

  if (config.useAgilityCourse) {
    setAutomateBotCurrentStep(STEP_AGILITY_COURSE_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_AGILITY_COURSE,
        `Agility course is enabled; moving east until the FFCCFF00 yellow marker is clickable, then checking for ${AGILITY_COURSE_TARGET_X},${AGILITY_COURSE_TARGET_Y}.`,
      ),
    );
    return {
      ...state,
      currentFunction: "findAgilityCourse",
      phase: "find-agility-course",
      actionLockUntilMs: 0,
    };
  }

  setAutomateBotCurrentStep(STEP_ORANGE_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_MINING_NODE, "Searching for the orange mining node marker."));
  return {
    ...state,
    currentFunction: "findOrange",
    phase: "find-orange",
    actionLockUntilMs: 0,
  };
}

function transitionToAgilityOrangeMiningState(state: BotState, location: GuardianCoordinateLocation): BotState {
  setAutomateBotCurrentStep(STEP_ORANGE_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.AGILITY_COURSE_MINE_ORANGE,
      `Agility course coordinate confirmed at ${location.x},${location.y}; searching for orange mining node marker.`,
    ),
  );

  return {
    ...state,
    currentFunction: "findOrange",
    phase: "find-orange",
    agilityCourseTargetConfirmed: true,
    agilityCourseYellowArrivalDeadlineMs: 0,
    agilityCourseYellowClickDistancePx: null,
    missingAgilityCourseTicks: 0,
    missingOrangeTicks: 0,
    actionLockUntilMs: 0,
  };
}

function pickNearestOrangeObject(
  detections: OrangeObjectDetection[],
  playerAnchor: { centerX: number; centerY: number },
): OrangeObjectDetection | null {
  let best: OrangeObjectDetection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const detection of detections) {
    const nearestX = clamp(playerAnchor.centerX, detection.minX, detection.maxX);
    const nearestY = clamp(playerAnchor.centerY, detection.minY, detection.maxY);
    const edgeDistance = Math.sqrt((playerAnchor.centerX - nearestX) ** 2 + (playerAnchor.centerY - nearestY) ** 2);
    const centerDistance = distanceBetween(playerAnchor, detection);
    const scoreDistance = edgeDistance + centerDistance * 0.001;

    if (scoreDistance < bestDistance) {
      best = detection;
      bestDistance = scoreDistance;
    }
  }

  return best;
}

function pickNearestWorkbenchMarker(
  detections: WorkbenchMarkerDetection[],
  playerAnchor: { centerX: number; centerY: number },
): WorkbenchMarkerDetection | null {
  return pickNearestOrangeObject(detections, playerAnchor);
}

function pickNearestColoredMarker(
  detections: ColoredMarkerDetection[],
  playerAnchor: { centerX: number; centerY: number },
): ColoredMarkerDetection | null {
  return pickNearestOrangeObject(detections, playerAnchor);
}

function pickLargestGreenObject(detections: GreenObjectDetection[]): GreenObjectDetection | null {
  return detections[0] ?? null;
}

function pickLargestColoredMarker(detections: ColoredMarkerDetection[]): ColoredMarkerDetection | null {
  return detections[0] ?? null;
}

function formatColoredMarkerCandidates(detections: ColoredMarkerDetection[], limit = 5): string {
  if (detections.length === 0) {
    return "none";
  }

  return detections
    .slice(0, limit)
    .map((detection) => `(${detection.centerX},${detection.centerY}) ${detection.width}x${detection.height} px=${detection.pixelCount}`)
    .join("; ");
}

function pickColoredOutlineClickPoint(
  bitmap: RobotBitmap,
  detection: ColoredMarkerDetection,
  isTargetPixel: (r: number, g: number, b: number) => boolean,
): { centerX: number; centerY: number } {
  const width = detection.maxX - detection.minX + 1;
  const height = detection.maxY - detection.minY + 1;
  const colorMask = new Uint8Array(width * height);
  const rowMin = new Array<number>(height).fill(Number.POSITIVE_INFINITY);
  const rowMax = new Array<number>(height).fill(Number.NEGATIVE_INFINITY);
  const colMin = new Array<number>(width).fill(Number.POSITIVE_INFINITY);
  const colMax = new Array<number>(width).fill(Number.NEGATIVE_INFINITY);
  let sumX = 0;
  let sumY = 0;
  let colorPixelCount = 0;

  for (let y = detection.minY; y <= detection.maxY; y += 1) {
    for (let x = detection.minX; x <= detection.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isTargetPixel(r, g, b)) {
        continue;
      }

      const localX = x - detection.minX;
      const localY = y - detection.minY;
      colorMask[localY * width + localX] = 1;
      rowMin[localY] = Math.min(rowMin[localY], x);
      rowMax[localY] = Math.max(rowMax[localY], x);
      colMin[localX] = Math.min(colMin[localX], y);
      colMax[localX] = Math.max(colMax[localX], y);
      sumX += x;
      sumY += y;
      colorPixelCount += 1;
    }
  }

  const centroidX = colorPixelCount > 0 ? sumX / colorPixelCount : detection.centerX;
  const centroidY = colorPixelCount > 0 ? sumY / colorPixelCount : detection.centerY;
  let bestX = Math.round(centroidX);
  let bestY = Math.round(centroidY);
  let bestEdgeMargin = Number.NEGATIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (let y = detection.minY; y <= detection.maxY; y += 1) {
    const localY = y - detection.minY;
    if (!Number.isFinite(rowMin[localY]) || rowMax[localY] - rowMin[localY] < 2) {
      continue;
    }

    for (let x = rowMin[localY] + 1; x <= rowMax[localY] - 1; x += 1) {
      const localX = x - detection.minX;
      if (localX < 0 || localX >= width || colorMask[localY * width + localX]) {
        continue;
      }

      if (!Number.isFinite(colMin[localX]) || y <= colMin[localX] || y >= colMax[localX]) {
        continue;
      }

      const dx = x - centroidX;
      const dy = y - centroidY;
      const edgeMargin = Math.min(x - rowMin[localY], rowMax[localY] - x, y - colMin[localX], colMax[localX] - y);
      const centerDistance = dx * dx + dy * dy;

      if (edgeMargin > bestEdgeMargin || (edgeMargin === bestEdgeMargin && centerDistance < bestCenterDistance)) {
        bestEdgeMargin = edgeMargin;
        bestCenterDistance = centerDistance;
        bestX = x;
        bestY = y;
      }
    }
  }

  return {
    centerX: bestX,
    centerY: bestY,
  };
}

function pickGuardianGreenClickPoint(
  bitmap: RobotBitmap,
  detection: GreenObjectDetection,
): { centerX: number; centerY: number } {
  const width = detection.maxX - detection.minX + 1;
  const height = detection.maxY - detection.minY + 1;
  const greenMask = new Uint8Array(width * height);
  const rowMin = new Array<number>(height).fill(Number.POSITIVE_INFINITY);
  const rowMax = new Array<number>(height).fill(Number.NEGATIVE_INFINITY);
  const colMin = new Array<number>(width).fill(Number.POSITIVE_INFINITY);
  const colMax = new Array<number>(width).fill(Number.NEGATIVE_INFINITY);
  let sumX = 0;
  let sumY = 0;
  let greenPixelCount = 0;

  for (let y = detection.minY; y <= detection.maxY; y += 1) {
    for (let x = detection.minX; x <= detection.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isGuardianGreenPixel(r, g, b)) {
        continue;
      }

      const localX = x - detection.minX;
      const localY = y - detection.minY;
      greenMask[localY * width + localX] = 1;
      rowMin[localY] = Math.min(rowMin[localY], x);
      rowMax[localY] = Math.max(rowMax[localY], x);
      colMin[localX] = Math.min(colMin[localX], y);
      colMax[localX] = Math.max(colMax[localX], y);
      sumX += x;
      sumY += y;
      greenPixelCount += 1;
    }
  }

  const centroidX = greenPixelCount > 0 ? sumX / greenPixelCount : detection.centerX;
  const centroidY = greenPixelCount > 0 ? sumY / greenPixelCount : detection.centerY;
  let bestBlackX = Math.round(centroidX);
  let bestBlackY = Math.round(centroidY);
  let bestBlackScore = Number.POSITIVE_INFINITY;
  let bestFallbackX = Math.round(centroidX);
  let bestFallbackY = Math.round(centroidY);
  let bestFallbackScore = Number.POSITIVE_INFINITY;
  const preferredY = detection.minY + Math.max(2, Math.round(height * GUARDIAN_GREEN_CLICK_TARGET_Y_RATIO));

  for (let y = detection.minY; y <= detection.maxY; y += 1) {
    const localY = y - detection.minY;
    if (!Number.isFinite(rowMin[localY]) || rowMax[localY] - rowMin[localY] < 2) {
      continue;
    }

    for (let x = rowMin[localY] + 1; x <= rowMax[localY] - 1; x += 1) {
      const localX = x - detection.minX;
      if (localX < 0 || localX >= width || greenMask[localY * width + localX]) {
        continue;
      }

      if (!Number.isFinite(colMin[localX]) || y <= colMin[localX] || y >= colMax[localX]) {
        continue;
      }

      const rowCenterX = (rowMin[localY] + rowMax[localY]) / 2;
      const dx = x - rowCenterX;
      const dy = y - preferredY;
      const edgeMargin = Math.min(x - rowMin[localY], rowMax[localY] - x, y - colMin[localX], colMax[localX] - y);
      const score =
        Math.abs(dy) * Math.max(width, height) * 2 +
        Math.abs(dx) +
        Math.abs(x - centroidX) * 0.15 -
        edgeMargin * 1.5;

      if (score < bestFallbackScore) {
        bestFallbackScore = score;
        bestFallbackX = x;
        bestFallbackY = y;
      }

      if (edgeMargin < GUARDIAN_BLACK_MIN_EDGE_MARGIN_PX) {
        continue;
      }

      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isGuardianBlackPixel(r, g, b)) {
        continue;
      }

      if (score < bestBlackScore) {
        bestBlackScore = score;
        bestBlackX = x;
        bestBlackY = y;
      }
    }
  }

  return {
    centerX: Number.isFinite(bestBlackScore) ? bestBlackX : bestFallbackX,
    centerY: Number.isFinite(bestBlackScore) ? bestBlackY : bestFallbackY,
  };
}

function isPlayerBoxAnchor(playerAnchor: { centerX: number; centerY: number }): playerAnchor is PlayerBox {
  return (
    "width" in playerAnchor &&
    "height" in playerAnchor &&
    "pixelCount" in playerAnchor &&
    "fillRatio" in playerAnchor
  );
}

function estimateRawTilePxFromPlayerBox(playerBox: PlayerBox | null): number | null {
  return playerBox ? Math.round((playerBox.width + playerBox.height) / 2) : null;
}

function normalizeTrustedStartupRawTilePx(rawTilePx: number | null): number | null {
  if (rawTilePx === null || !Number.isFinite(rawTilePx)) {
    return null;
  }

  const rounded = Math.round(rawTilePx);
  return rounded >= STARTUP_RAW_TILE_PX_MIN_TRUSTED && rounded <= STARTUP_RAW_TILE_PX_MAX_TRUSTED ? rounded : null;
}

function calibrateDistanceTilePx(startupBitmap: RobotBitmap): {
  tilePx: number;
  source: "bot-raw" | "manager-raw" | "fallback";
  botRawTilePx: number | null;
  managerRawTilePx: number | null;
} {
  const botRawTilePx = estimateRawTilePxFromPlayerBox(detectBestPlayerBoxInScreenshot(startupBitmap));
  const managerRawTilePx =
    AppState.automateBotStartupRawTilePx !== null &&
    Number.isFinite(AppState.automateBotStartupRawTilePx) &&
    AppState.automateBotStartupRawTilePx > 0
      ? Math.round(AppState.automateBotStartupRawTilePx)
      : null;
  const trustedBotRawTilePx = normalizeTrustedStartupRawTilePx(botRawTilePx);
  const trustedManagerRawTilePx = normalizeTrustedStartupRawTilePx(managerRawTilePx);

  if (trustedBotRawTilePx !== null) {
    return { tilePx: trustedBotRawTilePx, source: "bot-raw", botRawTilePx, managerRawTilePx };
  }

  if (trustedManagerRawTilePx !== null) {
    return { tilePx: trustedManagerRawTilePx, source: "manager-raw", botRawTilePx, managerRawTilePx };
  }

  return { tilePx: FREE_MOVE_TILE_PX_FALLBACK, source: "fallback", botRawTilePx, managerRawTilePx };
}

function getFreeMoveTilePx(_playerAnchor: { centerX: number; centerY: number }): number {
  return clamp(currentDistanceTilePx, FREE_MOVE_TILE_PX_MIN, FREE_MOVE_TILE_PX_MAX);
}

function enforceFreeMoveMinDistance(
  bitmap: RobotBitmap,
  playerAnchor: { centerX: number; centerY: number },
  point: { x: number; y: number },
): { x: number; y: number } {
  const minDistancePx = Math.round(getFreeMoveTilePx(playerAnchor) * FREE_MOVE_MIN_DISTANCE_TILES);
  const dx = point.x - playerAnchor.centerX;
  const dy = point.y - playerAnchor.centerY;
  const axisDistancePx = Math.max(Math.abs(dx), Math.abs(dy));
  const normalizedDx = axisDistancePx > 0 ? dx : 0;
  const normalizedDy = axisDistancePx > 0 ? dy : 1;
  const scale = axisDistancePx >= minDistancePx ? 1 : minDistancePx / Math.max(1, axisDistancePx);

  return {
    x: clamp(
      Math.round(playerAnchor.centerX + normalizedDx * scale),
      CLICK_SAFE_EDGE_MARGIN_PX,
      bitmap.width - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
    ),
    y: clamp(
      Math.round(playerAnchor.centerY + normalizedDy * scale),
      CLICK_SAFE_EDGE_MARGIN_PX,
      bitmap.height - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
    ),
  };
}

function getEastMovePoint(bitmap: RobotBitmap, playerAnchor: { centerX: number; centerY: number }): { x: number; y: number } {
  return enforceFreeMoveMinDistance(bitmap, playerAnchor, {
    x: Math.max(Math.round(bitmap.width * AGILITY_EAST_CLICK_RATIO_X), playerAnchor.centerX + Math.round(bitmap.width * 0.12)),
    y: Math.round(playerAnchor.centerY || bitmap.height * AGILITY_EAST_CLICK_RATIO_Y),
  });
}

function getWestMovePoint(bitmap: RobotBitmap, playerAnchor: { centerX: number; centerY: number }): { x: number; y: number } {
  return enforceFreeMoveMinDistance(bitmap, playerAnchor, {
    x: Math.min(Math.round(bitmap.width * WORKBENCH_WEST_CLICK_RATIO_X), playerAnchor.centerX - Math.round(bitmap.width * 0.12)),
    y: Math.round(playerAnchor.centerY || bitmap.height * 0.5),
  });
}

function getSouthWestWestMovePoint(bitmap: RobotBitmap, playerAnchor: { centerX: number; centerY: number }): { x: number; y: number } {
  const tilePx = getFreeMoveTilePx(playerAnchor);
  const westDistancePx = Math.max(
    Math.round(tilePx * FREE_MOVE_MIN_DISTANCE_TILES),
    Math.round(bitmap.width * WORKBENCH_SOUTH_WEST_WEST_DISTANCE_RATIO_X),
  );
  const desiredSouthDistancePx = Math.max(
    Math.round(tilePx * 2),
    Math.round(bitmap.height * WORKBENCH_SOUTH_WEST_WEST_DISTANCE_RATIO_Y),
  );
  const southDistancePx = Math.min(
    desiredSouthDistancePx,
    Math.round(westDistancePx * WORKBENCH_SOUTH_WEST_WEST_MAX_SOUTH_OF_WEST_RATIO),
  );

  return {
    x: clamp(
      Math.round(playerAnchor.centerX - westDistancePx),
      CLICK_SAFE_EDGE_MARGIN_PX,
      bitmap.width - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
    ),
    y: clamp(
      Math.round(playerAnchor.centerY + southDistancePx),
      CLICK_SAFE_EDGE_MARGIN_PX,
      bitmap.height - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
    ),
  };
}

function getSouthMovePoint(bitmap: RobotBitmap, playerAnchor: { centerX: number; centerY: number }): { x: number; y: number } {
  const minSceneX = clamp(Math.round(bitmap.width * RUNE_DEPOSIT_SOUTH_CLICK_MIN_RATIO_X), CLICK_SAFE_EDGE_MARGIN_PX, bitmap.width - 1);
  const maxSceneX = clamp(
    Math.round(bitmap.width * RUNE_DEPOSIT_SOUTH_CLICK_MAX_RATIO_X),
    minSceneX,
    bitmap.width - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
  );

  return enforceFreeMoveMinDistance(bitmap, playerAnchor, {
    x: clamp(Math.round(playerAnchor.centerX), minSceneX, maxSceneX),
    y: clamp(
      Math.max(
        Math.round(bitmap.height * RUNE_DEPOSIT_SOUTH_CLICK_RATIO_Y),
        playerAnchor.centerY + Math.round(bitmap.height * RUNE_DEPOSIT_SOUTH_MIN_DISTANCE_RATIO),
      ),
      CLICK_SAFE_EDGE_MARGIN_PX,
      bitmap.height - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
    ),
  });
}

function runFindAgilityCourseTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const agilityCourseMarkers = detectAllAgilityCourseMarkers(tickCapture.bitmap);
  const nearestAgilityCourseMarker = pickNearestColoredMarker(agilityCourseMarkers, playerAnchor);

  if (nearestAgilityCourseMarker) {
    const travel = estimateTravelWaitTicks(playerAnchor, nearestAgilityCourseMarker);
    const clicked = clickScreenPoint(
      captureBounds.x + nearestAgilityCourseMarker.centerX,
      captureBounds.y + nearestAgilityCourseMarker.centerY,
      captureBounds,
    );
    const clickedAtMs = Date.now();
    log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_AGILITY_COURSE,
        `Clicked FFCCFF00 yellow agility-course marker at (${clicked.x},${clicked.y}) local=(${nearestAgilityCourseMarker.centerX},${nearestAgilityCourseMarker.centerY}) pixels=${nearestAgilityCourseMarker.pixelCount}; waiting before checking coordinate ${AGILITY_COURSE_TARGET_X},${AGILITY_COURSE_TARGET_Y} (${formatTravelEstimate(travel)}).`,
      ),
    );
    return {
      ...state,
      currentFunction: "waitAfterAgilityCourseYellowClick",
      phase: "wait-after-agility-course-yellow-click",
      agilityCourseYellowArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
      agilityCourseYellowClickDistancePx: travel.distancePx,
      actionLockUntilMs: clickedAtMs + AGILITY_EAST_CLICK_LOCK_TICKS * GAME_TICK_MS,
      missingAgilityCourseTicks: 0,
    };
  }

  const eastPoint = getEastMovePoint(tickCapture.bitmap, playerAnchor);
  const clicked = clickScreenPoint(captureBounds.x + eastPoint.x, captureBounds.y + eastPoint.y, captureBounds);
  const nextClickCount = state.eastMoveClickCount + 1;
  if (nextClickCount === 1 || nextClickCount % 3 === 0) {
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_AGILITY_COURSE,
        `No FFCCFF00 agility-course marker found; moving east via (${clicked.x},${clicked.y}) attempt=${nextClickCount} candidates=${formatColoredMarkerCandidates(agilityCourseMarkers)}.`,
      ),
    );
  }

  return {
    ...state,
    missingAgilityCourseTicks: state.missingAgilityCourseTicks + 1,
    eastMoveClickCount: nextClickCount,
    actionLockUntilMs: nowMs + AGILITY_EAST_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterAgilityCourseYellowClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
): BotState {
  if (nowMs < state.agilityCourseYellowArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const location = readGuardianCoordinateLocation(tickCapture.bitmap);
  if (isGuardianCoordinateLocation(location) && isAtAgilityCourseMiningCoordinate(location)) {
    return transitionToAgilityOrangeMiningState(state, location);
  }

  const missingAgilityCourseTicks = state.missingAgilityCourseTicks + 1;
  if (missingAgilityCourseTicks === 1 || missingAgilityCourseTicks % 3 === 0) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.CHECK_AGILITY_COURSE_COORDINATE,
        `Agility course coordinate is not ${AGILITY_COURSE_TARGET_X},${AGILITY_COURSE_TARGET_Y} yet; current='${location?.matchedLine ?? "unreadable"}' after yellow click distance=${state.agilityCourseYellowClickDistancePx === null ? "unknown" : `${Math.round(state.agilityCourseYellowClickDistancePx)}px`}. Rechecking yellow marker.`,
      ),
    );
  }

  return {
    ...state,
    currentFunction: "findAgilityCourse",
    phase: "find-agility-course",
    missingAgilityCourseTicks,
    actionLockUntilMs: nowMs + GAME_TICK_MS,
  };
}

function runFindOrangeTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const orangeObjects = detectAllOrangeObjects(tickCapture.bitmap, ORANGE_MIN_PIXELS);
  const nearestOrange = pickNearestOrangeObject(orangeObjects, playerAnchor);

  if (!nearestOrange) {
    const missingOrangeTicks = state.missingOrangeTicks + 1;
    if (missingOrangeTicks === 1 || missingOrangeTicks % 5 === 0) {
      warn(stepMessage(WORKFLOW_STEPS.FIND_MINING_NODE, "No orange mining node marker found yet."));
    }

    return {
      ...state,
      missingOrangeTicks,
      miningStatusGreenStartedAtMs: null,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const clicked = clickScreenPoint(
    captureBounds.x + nearestOrange.centerX,
    captureBounds.y + nearestOrange.centerY,
    captureBounds,
  );
  const reclickDelayMs = getMiningOrangeReclickDelayMs();
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_MINING_NODE,
      `Clicked orange mining node marker at (${clicked.x},${clicked.y}) local=(${nearestOrange.centerX},${nearestOrange.centerY}) pixels=${nearestOrange.pixelCount}; checking green status again after ${formatDelaySeconds(reclickDelayMs)}.`,
    ),
  );

  return transitionToMiningState({
    ...state,
    missingOrangeTicks: 0,
    actionLockUntilMs: clickedAtMs + reclickDelayMs,
  });
}

function runWaitForMiningTimerTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  setAutomateBotCurrentStep(STEP_WAIT_MINING_TIMER_ID);

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const timer = detectGuardianOfTheRiftTimer(tickCapture.bitmap);
  const timerTextVisible = hasGuardianTimerTextPresence(tickCapture.bitmap);
  const parsedStartingSeconds =
    timer.secondsRemaining !== null &&
    timer.secondsRemaining >= 0 &&
    timer.secondsRemaining <= MINING_TIMER_MAX_PLAUSIBLE_SECONDS
      ? timer.secondsRemaining
      : null;
  const timerAppeared = timerTextVisible || parsedStartingSeconds !== null;

  if (!timerAppeared) {
    const missingMiningTimerTicks = state.missingMiningTimerTicks + 1;
    if (missingMiningTimerTicks === 1 || missingMiningTimerTicks % 5 === 0) {
      warn(stepMessage(WORKFLOW_STEPS.START_MINING, "Real Guardian timer is not visible yet; mining cannot start."));
    }

    return {
      ...state,
      missingMiningTimerTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.START_MINING,
      `Timer gate read: visible=${timerTextVisible ? "yes" : "no"} ocr=${timer.secondsRemaining ?? "null"} raw=${timer.rawText ?? "null"}.`,
    ),
  );

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const nearestOrange = pickNearestOrangeObject(detectAllOrangeObjects(tickCapture.bitmap, ORANGE_MIN_PIXELS), playerAnchor);
  if (!nearestOrange) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `Timer appeared (${parsedStartingSeconds ?? "unreadable"}s), but no orange mining node marker was found for the required re-click.`,
      ),
    );
    return {
      ...state,
      lastTimerSecondsRemaining: parsedStartingSeconds,
      lastTimerObservedAtMs: parsedStartingSeconds === null ? null : nowMs,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const clicked = clickScreenPoint(
    captureBounds.x + nearestOrange.centerX,
    captureBounds.y + nearestOrange.centerY,
    captureBounds,
  );
  const reclickDelayMs = getMiningOrangeReclickDelayMs();
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.START_MINING,
      `Timer appeared (${parsedStartingSeconds ?? "unreadable"}s); re-clicked orange mining node at (${clicked.x},${clicked.y}) before mining; checking green status again after ${formatDelaySeconds(reclickDelayMs)}.`,
    ),
  );

  return startMiningMonitorState(
    {
      ...state,
      miningOrangeReclicked: true,
      missingMiningTimerTicks: 0,
      lastTimerSecondsRemaining: parsedStartingSeconds,
      lastTimerObservedAtMs: parsedStartingSeconds === null ? null : nowMs,
      actionLockUntilMs: clickedAtMs + reclickDelayMs,
    },
    parsedStartingSeconds,
    nowMs,
  );
}

function transitionToWorkbenchState(
  state: BotState,
  reason = "Timer is under threshold; searching for the magenta workbench marker.",
): BotState {
  setAutomateBotCurrentStep(STEP_WORKBENCH_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_WORKBENCH, reason));
  return {
    ...state,
    currentFunction: "workbenchFindYellow",
    phase: "workbench-find-yellow",
    actionLockUntilMs: 0,
    craftingInventoryChangeDeadlineMs: 0,
    miningTimerReliableReadCount: 0,
    miningTimerLocalStartSecondsRemaining: null,
    miningTimerLocalStartedAtMs: null,
    miningStatusGreenStartedAtMs: null,
  };
}

function clickAgilityCourseYellowBeforeWorkbench(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  reason: string,
): BotState {
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const yellowMarkers = detectAllAgilityCourseMarkers(tickCapture.bitmap);
  const nearestYellowMarker = pickNearestColoredMarker(yellowMarkers, playerAnchor);
  if (!nearestYellowMarker) {
    const missingAgilityCourseTicks = state.missingAgilityCourseTicks + 1;
    if (missingAgilityCourseTicks === 1 || missingAgilityCourseTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
          `${reason}; no nearby FFCCFF00 yellow marker is visible yet. Candidates=${formatColoredMarkerCandidates(yellowMarkers)}.`,
        ),
      );
    }

    return {
      ...state,
      missingAgilityCourseTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const travel = estimateTravelWaitTicks(playerAnchor, nearestYellowMarker);
  const clicked = clickScreenPoint(captureBounds.x + nearestYellowMarker.centerX, captureBounds.y + nearestYellowMarker.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
      `${reason}; clicked nearby FFCCFF00 yellow marker at (${clicked.x},${clicked.y}) local=(${nearestYellowMarker.centerX},${nearestYellowMarker.centerY}) pixels=${nearestYellowMarker.pixelCount}; waiting before workbench search (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterAgilityMiningYellowClick",
    phase: "wait-after-agility-mining-yellow-click",
    agilityMiningYellowArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    agilityMiningYellowClickDistancePx: travel.distancePx,
    missingAgilityCourseTicks: 0,
    actionLockUntilMs: clickedAtMs + AGILITY_EAST_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterAgilityMiningYellowClickTick(state: BotState, nowMs: number): BotState {
  if (nowMs < state.agilityMiningYellowArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  return transitionToWorkbenchState(
    {
      ...state,
      agilityMiningYellowArrivalDeadlineMs: 0,
      agilityMiningYellowClickDistancePx: null,
    },
    `Agility yellow marker travel complete (distance=${state.agilityMiningYellowClickDistancePx === null ? "unknown" : `${Math.round(state.agilityMiningYellowClickDistancePx)}px`}); searching for the magenta workbench marker.`,
  );
}

function transitionToCraftingState(
  state: BotState,
  nowMs: number,
  travel: TravelWaitEstimate,
  startingInventoryFreeSlots: number | null,
): BotState {
  setAutomateBotCurrentStep(STEP_CRAFTING_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
      `Workbench clicked; checking inventory movement after travel (start free-space=${startingInventoryFreeSlots ?? "unknown"}, ${formatTravelEstimate(travel)}).`,
    ),
  );
  return {
    ...state,
    currentFunction: "craft",
    phase: "crafting",
    actionLockUntilMs: nowMs + travel.waitTicks * GAME_TICK_MS,
    inventoryFreeSlots: startingInventoryFreeSlots,
    missingInventoryCountTicks: 0,
    craftingInventoryChangeDeadlineMs: nowMs + travel.waitTicks * GAME_TICK_MS,
    missingYellowTicks: 0,
  };
}

function getLocalMiningTimerSecondsRemaining(state: BotState, nowMs: number): number | null {
  if (state.miningTimerLocalStartSecondsRemaining === null || state.miningTimerLocalStartedAtMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, (nowMs - state.miningTimerLocalStartedAtMs) / 1000);
  return clamp(
    Math.ceil(state.miningTimerLocalStartSecondsRemaining - elapsedSeconds),
    0,
    MINING_TIMER_MAX_PLAUSIBLE_SECONDS,
  );
}

function getMiningTimerOcrRejectionReason(state: BotState, nowMs: number, detectedSeconds: number): string | null {
  if (state.lastTimerSecondsRemaining === null || state.lastTimerObservedAtMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, (nowMs - state.lastTimerObservedAtMs) / 1000);
  const timerIncrease = detectedSeconds - state.lastTimerSecondsRemaining;
  if (timerIncrease > MINING_TIMER_OCR_MAX_FORWARD_DRIFT_SECONDS) {
    return `increased by ${timerIncrease}s from last accepted read ${state.lastTimerSecondsRemaining}s over ${elapsedSeconds.toFixed(1)}s`;
  }

  const timerDrop = state.lastTimerSecondsRemaining - detectedSeconds;
  const maxAllowedDrop = Math.max(
    1,
    Math.ceil(elapsedSeconds) + MINING_TIMER_OCR_EXTRA_DROP_TOLERANCE_SECONDS,
  );
  if (timerDrop > maxAllowedDrop) {
    return `dropped by ${timerDrop}s from last accepted read ${state.lastTimerSecondsRemaining}s over ${elapsedSeconds.toFixed(1)}s (max ${maxAllowedDrop}s)`;
  }

  return null;
}

function readMiningTimer(state: BotState, nowMs: number, bitmap: RobotBitmap): TimerRead {
  const localSecondsRemaining = getLocalMiningTimerSecondsRemaining(state, nowMs);
  if (localSecondsRemaining !== null) {
    return {
      secondsRemaining: localSecondsRemaining,
      source: "local",
      rawText: null,
      ocrSecondsRemaining: null,
      rejectedReason: null,
    };
  }

  const detection = detectGuardianOfTheRiftTimer(bitmap);
  const detectedSeconds = detection.secondsRemaining;

  if (
    detectedSeconds !== null &&
    detectedSeconds >= 0 &&
    detectedSeconds <= MINING_TIMER_MAX_PLAUSIBLE_SECONDS
  ) {
    const rejectedReason = getMiningTimerOcrRejectionReason(state, nowMs, detectedSeconds);
    if (rejectedReason !== null) {
      return {
        secondsRemaining: null,
        source: "rejected",
        rawText: detection.rawText,
        ocrSecondsRemaining: detectedSeconds,
        rejectedReason,
      };
    }

    return {
      secondsRemaining: detectedSeconds,
      source: "ocr",
      rawText: detection.rawText,
      ocrSecondsRemaining: detectedSeconds,
      rejectedReason: null,
    };
  }

  return {
    secondsRemaining: null,
    source: "missing",
    rawText: detection.rawText,
    ocrSecondsRemaining: detectedSeconds,
    rejectedReason: null,
  };
}

function formatTimerRead(timerRead: TimerRead): string {
  const rejected = timerRead.rejectedReason === null ? "" : ` rejected=${timerRead.rejectedReason}`;
  return `timer=${timerRead.secondsRemaining ?? "null"} source=${timerRead.source} ocr=${timerRead.ocrSecondsRemaining ?? "null"} raw=${timerRead.rawText ?? "null"}${rejected}`;
}

function formatMiningStatus(status: MiningBoxStatusDetection): string {
  return `status=${status.status} confidence=${status.confidence.toFixed(2)} red=${status.redPixelCount} green=${status.greenPixelCount}`;
}

function updateMiningTimerStateFromRead(
  state: BotState,
  nowMs: number,
  timerRead: TimerRead,
): { state: BotState; switchedToLocalTimer: boolean } {
  if (timerRead.source === "ocr" && timerRead.secondsRemaining !== null) {
    const miningTimerReliableReadCount = Math.min(
      MINING_TIMER_LOCAL_READS_REQUIRED,
      state.miningTimerReliableReadCount + 1,
    );
    const nextState: BotState = {
      ...state,
      miningTimerReliableReadCount,
      lastTimerSecondsRemaining: timerRead.secondsRemaining,
      lastTimerObservedAtMs: nowMs,
      missingMiningTimerTicks: 0,
    };

    if (miningTimerReliableReadCount >= MINING_TIMER_LOCAL_READS_REQUIRED) {
      return {
        state: {
          ...nextState,
          miningTimerLocalStartSecondsRemaining: timerRead.secondsRemaining,
          miningTimerLocalStartedAtMs: nowMs,
        },
        switchedToLocalTimer: true,
      };
    }

    return {
      state: nextState,
      switchedToLocalTimer: false,
    };
  }

  if (timerRead.source === "local" && timerRead.secondsRemaining !== null) {
    return {
      state: {
        ...state,
        lastTimerSecondsRemaining: timerRead.secondsRemaining,
        lastTimerObservedAtMs: nowMs,
        missingMiningTimerTicks: 0,
      },
      switchedToLocalTimer: false,
    };
  }

  if (timerRead.source === "rejected") {
    return {
      state,
      switchedToLocalTimer: false,
    };
  }

  if (state.miningTimerReliableReadCount > 0) {
    return {
      state: {
        ...state,
        miningTimerReliableReadCount: 0,
      },
      switchedToLocalTimer: false,
    };
  }

  return {
    state,
    switchedToLocalTimer: false,
  };
}

function reclickMiningNodeFromMiningStatus(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  miningStatus: MiningBoxStatusDetection,
): BotState {
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const nearestOrange = pickNearestOrangeObject(detectAllOrangeObjects(tickCapture.bitmap, ORANGE_MIN_PIXELS), playerAnchor);
  const statusReason =
    miningStatus.status === "unknown"
      ? "status panel is missing or unreadable"
      : "status panel says not-mining";

  if (!nearestOrange) {
    const missingOrangeTicks = state.missingOrangeTicks + 1;
    if (missingOrangeTicks === 1 || missingOrangeTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.START_MINING,
          `Mining ${statusReason} (${formatMiningStatus(miningStatus)}); treating as not mining, but no orange mining node marker is visible. Waiting for green status.`,
        ),
      );
    }

    return {
      ...state,
      missingOrangeTicks,
      miningStatusGreenStartedAtMs: null,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const clicked = clickScreenPoint(
    captureBounds.x + nearestOrange.centerX,
    captureBounds.y + nearestOrange.centerY,
    captureBounds,
  );
  const reclickDelayMs = getMiningOrangeReclickDelayMs();
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.START_MINING,
      `Mining ${statusReason} (${formatMiningStatus(miningStatus)}); re-clicked orange mining node at (${clicked.x},${clicked.y}) local=(${nearestOrange.centerX},${nearestOrange.centerY}); checking green status again after ${formatDelaySeconds(reclickDelayMs)}.`,
    ),
  );

  return {
    ...state,
    miningOrangeReclicked: true,
    missingOrangeTicks: 0,
    miningStatusGreenStartedAtMs: null,
    actionLockUntilMs: clickedAtMs + reclickDelayMs,
  };
}

function runMiningTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);
  if (miningStatus.status !== "mining") {
    return reclickMiningNodeFromMiningStatus(state, nowMs, tickCapture, captureBounds, miningStatus);
  }

  const miningStatusGreenStartedAtMs = state.miningStatusGreenStartedAtMs ?? nowMs;
  const miningStatusGreenElapsedMs = nowMs - miningStatusGreenStartedAtMs;
  const miningStatusGreenRemainingSeconds = Math.max(
    0,
    Math.ceil((MINING_STATUS_GREEN_MAX_DURATION_MS - miningStatusGreenElapsedMs) / 1000),
  );
  const miningStatusJustTurnedGreen = state.miningStatusGreenStartedAtMs === null;

  if (miningStatusJustTurnedGreen) {
    log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `Mining status turned green (${formatMiningStatus(miningStatus)}); starting local 90s mining timer.`,
      ),
    );
  }

  if (miningStatusGreenElapsedMs >= MINING_STATUS_GREEN_MAX_DURATION_MS) {
    const elapsedSeconds = Math.round(miningStatusGreenElapsedMs / 1000);
    if (config.useAgilityCourse) {
      return clickAgilityCourseYellowBeforeWorkbench(
        {
          ...state,
          miningStatusGreenStartedAtMs,
          missingMiningTimerTicks: 0,
        },
        nowMs,
        tickCapture,
        captureBounds,
        `Mining status stayed green for ${elapsedSeconds}s (${formatMiningStatus(miningStatus)}); mining complete`,
      );
    }

    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_WORKBENCH,
        `Mining status stayed green for ${elapsedSeconds}s (${formatMiningStatus(miningStatus)}); mining complete.`,
      ),
    );
    return transitionToWorkbenchState(
      {
        ...state,
        miningStatusGreenStartedAtMs,
        missingMiningTimerTicks: 0,
      },
      "Mining status stayed green for 90s; searching for the magenta workbench marker.",
    );
  }

  if (miningStatusJustTurnedGreen || state.loopIndex % 2 === 0) {
    log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `Mining status confirms mining (${formatMiningStatus(miningStatus)}); local green timer remaining=${miningStatusGreenRemainingSeconds}s.`,
      ),
    );
  }

  return {
    ...state,
    miningStatusGreenStartedAtMs,
    missingMiningTimerTicks: 0,
    actionLockUntilMs: nowMs + GAME_TICK_MS,
  };
}

function runWorkbenchFindYellowTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const nearestWorkbenchMarker = pickNearestWorkbenchMarker(
    detectAllWorkbenchMagentaObjects(tickCapture.bitmap, WORKBENCH_MAGENTA_MIN_PIXELS),
    playerAnchor,
  );
  if (!nearestWorkbenchMarker) {
    const missingYellowTicks = state.missingYellowTicks + 1;
    const moveDirection = config.useAgilityCourse ? "south-west-west" : "west";
    const movePoint =
      moveDirection === "south-west-west"
        ? getSouthWestWestMovePoint(tickCapture.bitmap, playerAnchor)
        : getWestMovePoint(tickCapture.bitmap, playerAnchor);
    const clicked = clickScreenPoint(captureBounds.x + movePoint.x, captureBounds.y + movePoint.y, captureBounds);
    const nextWestMoveClickCount = state.westMoveClickCount + 1;
    if (nextWestMoveClickCount === 1 || nextWestMoveClickCount % 3 === 0) {
      log(
        stepMessage(
          WORKFLOW_STEPS.FIND_WORKBENCH,
          `No magenta workbench marker found; moving ${moveDirection} via (${clicked.x},${clicked.y}) attempt=${nextWestMoveClickCount}.`,
        ),
      );
    }

    return {
      ...state,
      missingYellowTicks,
      westMoveClickCount: nextWestMoveClickCount,
      actionLockUntilMs: nowMs + WORKBENCH_WEST_CLICK_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const inventoryBeforeClick = detectInventoryCount(tickCapture.bitmap);
  const workbenchClickPoint = getBoundsCenterPoint(nearestWorkbenchMarker);
  const clicked = clickScreenPoint(
    captureBounds.x + workbenchClickPoint.centerX,
    captureBounds.y + workbenchClickPoint.centerY,
    captureBounds,
  );
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_WORKBENCH,
      `Clicked middle of magenta workbench marker at (${clicked.x},${clicked.y}) local=(${workbenchClickPoint.centerX},${workbenchClickPoint.centerY}) bounds=(${nearestWorkbenchMarker.minX},${nearestWorkbenchMarker.minY})-(${nearestWorkbenchMarker.maxX},${nearestWorkbenchMarker.maxY}) pixels=${nearestWorkbenchMarker.pixelCount}; inventory free-space before click=${inventoryBeforeClick.count ?? "unknown"}.`,
    ),
  );

  const travel = estimateTravelWaitTicks(playerAnchor, workbenchClickPoint);
  return transitionToCraftingState(state, nowMs, travel, inventoryBeforeClick.count);
}

function transitionToGuardianTravelState(state: BotState): BotState {
  setAutomateBotCurrentStep(STEP_TRAVEL_GUARDIAN_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_GUARDIAN, "Inventory free-space is 0; searching for the green guardian outline."));
  return {
    ...state,
    currentFunction: "travelToGuardian",
    phase: "travel-to-guardian",
    actionLockUntilMs: 0,
    craftingInventoryChangeDeadlineMs: 0,
    guardianArrivalDeadlineMs: 0,
    guardianClickDistancePx: null,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    guardianYellowArrivalDeadlineMs: 0,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    missingGuardianYellowTicks: 0,
    missingGuardianReturnRedTicks: 0,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
  };
}

function transitionToGuardianRunecraftingState(state: BotState, location: GuardianCoordinateLocation | null = null): BotState {
  setAutomateBotCurrentStep(STEP_TRAVEL_GUARDIAN_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_ALTAR, "Coordinate is outside crafting region; entering altar and portal return phase."));
  return {
    ...state,
    currentFunction: "waitAfterGuardianClick",
    phase: "wait-after-guardian-click",
    actionLockUntilMs: 0,
    guardianArrivalDeadlineMs: 0,
    guardianClickDistancePx: null,
    guardianCoordinateConfirmed: true,
    guardianAltarStartLocation: location,
    guardianYellowArrivalDeadlineMs: 0,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    missingGuardianYellowTicks: 0,
    missingGuardianReturnRedTicks: 0,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
  };
}

function createStartupInitialState(bitmap: RobotBitmap): BotState {
  const state = createInitialState();
  const location = readGuardianCoordinateLocation(bitmap);
  const inventory = detectInventoryCount(bitmap);
  log(
    `Startup phase check: inventoryFreeSlots=${inventory.count ?? "null"} inventoryRaw=${inventory.rawText ?? "null"} region=${location?.regionId ?? "null"} chunk=${location?.chunkId ?? "null"} matched='${location?.matchedLine ?? "null"}'.`,
  );

  if (location && location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    return transitionToGuardianRunecraftingState(
      {
        ...state,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: inventory.count === null ? 1 : 0,
      },
      location,
    );
  }

  if (inventory.count === 0) {
    return transitionToGuardianTravelState({
      ...state,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
    });
  }

  setAutomateBotCurrentStep(STEP_PICK_UNCHARGED_CELL_ID);
  log(stepMessage(WORKFLOW_STEPS.TAKE_UNCHARGED_CELL, "Startup phase check selected uncharged-cell pickup."));
  return {
    ...state,
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: inventory.count === null ? 1 : 0,
  };
}

function runCraftingTick(state: BotState, nowMs: number, tickCapture: TickCapture): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const inventory = detectInventoryCount(tickCapture.bitmap);
  log(
    stepMessage(
      WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
      `Inventory free-space read while crafting: count=${inventory.count ?? "null"} raw=${inventory.rawText ?? "null"}.`,
    ),
  );

  if (inventory.count === null) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-crafting-inventory-count-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
      warn(stepMessage(WORKFLOW_STEPS.CRAFT_UNTIL_FULL, `Inventory free-space unreadable; saved debug image to ${debugPath}.`));
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (inventory.count === 0) {
    return transitionToGuardianTravelState({
      ...state,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
    });
  }

  if (state.inventoryFreeSlots === null) {
    return {
      ...state,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: nowMs + WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (inventory.count !== state.inventoryFreeSlots) {
    log(stepMessage(WORKFLOW_STEPS.CRAFT_UNTIL_FULL, `Inventory free-space changed: ${state.inventoryFreeSlots} -> ${inventory.count}.`));
    return {
      ...state,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: nowMs + WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (state.craftingInventoryChangeDeadlineMs > 0 && nowMs >= state.craftingInventoryChangeDeadlineMs) {
    setAutomateBotCurrentStep(STEP_WORKBENCH_ID);
    warn(
      stepMessage(
        WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
        `Inventory free-space stayed at ${inventory.count} through the crafting wait deadline; re-clicking workbench marker.`,
      ),
    );
    return {
      ...state,
      currentFunction: "workbenchFindYellow",
      phase: "workbench-find-yellow",
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      missingYellowTicks: 0,
      actionLockUntilMs: 0,
    };
  }

  return {
    ...state,
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: nowMs + GAME_TICK_MS,
  };
}

function runTravelToGuardianTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const greenTarget = pickLargestGreenObject(detectAllGreenObjects(tickCapture.bitmap, GREEN_MIN_PIXELS));
  if (!greenTarget) {
    warn(stepMessage(WORKFLOW_STEPS.FIND_GUARDIAN, "No green guardian outline found yet."));
    return {
      ...state,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const greenClickPoint = pickGuardianGreenClickPoint(tickCapture.bitmap, greenTarget);
  const travel = estimateTravelWaitTicks(playerAnchor, greenClickPoint);
  const clicked = clickScreenPoint(
    captureBounds.x + greenClickPoint.centerX,
    captureBounds.y + greenClickPoint.centerY,
    captureBounds,
  );
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_GUARDIAN,
      `Clicked black guardian interior inside green outline at (${clicked.x},${clicked.y}) local=(${greenClickPoint.centerX},${greenClickPoint.centerY}) bounds=(${greenTarget.minX},${greenTarget.minY})-${greenTarget.maxX},${greenTarget.maxY} pixels=${greenTarget.pixelCount}; waiting for teleport out of region ${GUARDIAN_CRAFTING_REGION_ID} (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterGuardianClick",
    phase: "wait-after-guardian-click",
    guardianArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    guardianClickDistancePx: travel.distancePx,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    actionLockUntilMs: clickedAtMs + GUARDIAN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

async function runWaitAfterGuardianClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): Promise<BotState> {
  const guardianLocation = hasLeftGuardianCraftingChunk(tickCapture.bitmap);

  if (!guardianLocation.left) {
    if (nowMs < state.guardianArrivalDeadlineMs) {
      return state;
    }

    if (nowMs < state.actionLockUntilMs) {
      return state;
    }

    const greenTarget = pickLargestGreenObject(detectAllGreenObjects(tickCapture.bitmap, GREEN_MIN_PIXELS));
    if (greenTarget) {
      const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
      const greenClickPoint = pickGuardianGreenClickPoint(tickCapture.bitmap, greenTarget);
      const travel = estimateTravelWaitTicks(playerAnchor, greenClickPoint);
      const clicked = clickScreenPoint(
        captureBounds.x + greenClickPoint.centerX,
        captureBounds.y + greenClickPoint.centerY,
        captureBounds,
      );
      const clickedAtMs = Date.now();
      log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_GUARDIAN,
          `Still in crafting region: chunk=${guardianLocation.chunkId ?? "unknown"} region=${guardianLocation.regionId ?? "unknown"} matched='${guardianLocation.matchedLine ?? "null"}'; re-clicked black guardian interior inside green outline at (${clicked.x},${clicked.y}) local=(${greenClickPoint.centerX},${greenClickPoint.centerY}) bounds=(${greenTarget.minX},${greenTarget.minY})-${greenTarget.maxX},${greenTarget.maxY} pixels=${greenTarget.pixelCount}; ${formatTravelEstimate(travel)}.`,
        ),
      );

      return {
        ...state,
        guardianArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
        guardianClickDistancePx: travel.distancePx,
        guardianCoordinateConfirmed: false,
        guardianAltarStartLocation: null,
        actionLockUntilMs: clickedAtMs + GUARDIAN_CLICK_LOCK_TICKS * GAME_TICK_MS,
      };
    }

    const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
    if (missingGuardianYellowTicks === 1 || missingGuardianYellowTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
          `Teleport out of crafting region not confirmed yet; current chunk=${guardianLocation.chunkId ?? "unknown"} region=${guardianLocation.regionId ?? "unknown"} matched='${guardianLocation.matchedLine ?? "null"}'.`,
        ),
      );
    }

    return {
      ...state,
      missingGuardianYellowTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const confirmedState = state.guardianCoordinateConfirmed
    ? state
    : {
        ...state,
        guardianCoordinateConfirmed: true,
        guardianAltarStartLocation: readGuardianCoordinateLocation(tickCapture.bitmap),
        missingGuardianYellowTicks: 0,
      };

  if (!state.guardianCoordinateConfirmed) {
    log(
      stepMessage(
        WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
        `Teleport confirmed: region changed from ${GUARDIAN_CRAFTING_REGION_ID} to ${guardianLocation.regionId}, chunk=${guardianLocation.chunkId}, matched='${guardianLocation.matchedLine}'.`,
      ),
    );
  }

  if (nowMs < confirmedState.guardianArrivalDeadlineMs) {
    return confirmedState;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  log(stepMessage(WORKFLOW_STEPS.FIND_ALTAR, "Searching for altar marker."));
  const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
  const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
  if (!nearestYellow) {
    const missingGuardianYellowTicks = confirmedState.missingGuardianYellowTicks + 1;
    const shouldRotateCamera = missingGuardianYellowTicks <= GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS;

    if (shouldRotateCamera) {
      const rotated = tapKey(GUARDIAN_ALTAR_CAMERA_ROTATE_KEY);
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_ALTAR,
          `Altar marker not visible in region ${guardianLocation.regionId ?? "unknown"}; ${rotated ? `tapped '${GUARDIAN_ALTAR_CAMERA_ROTATE_KEY}'` : `could not tap '${GUARDIAN_ALTAR_CAMERA_ROTATE_KEY}'`} to rotate camera before retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS}. Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
        ),
      );

      return {
        ...confirmedState,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + GAME_TICK_MS,
      };
    }

    if (missingGuardianYellowTicks <= GUARDIAN_ALTAR_SEARCH_RETRY_TICKS) {
      if (missingGuardianYellowTicks === 1 || missingGuardianYellowTicks % 3 === 0) {
        warn(
          stepMessage(
            WORKFLOW_STEPS.FIND_ALTAR,
            `Altar marker not visible yet after teleport; scene may still be loading. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
          ),
        );
      }

      return {
        ...confirmedState,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + GAME_TICK_MS,
      };
    }

    const message = stepMessage(
      WORKFLOW_STEPS.FIND_ALTAR,
      `Teleport confirmed, but no altar marker was found after ${missingGuardianYellowTicks} check(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}. Stopping bot.`,
    );
    warn(message);
    notifyUserAndStop(message);
    return {
      ...confirmedState,
      missingGuardianYellowTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (confirmedState.missingGuardianYellowTicks > 0) {
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_ALTAR,
        `Altar marker found after ${confirmedState.missingGuardianYellowTicks} retry tick(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
      ),
    );
  }

  const altarStartLocation = readGuardianCoordinateLocation(tickCapture.bitmap) ?? confirmedState.guardianAltarStartLocation;
  const travel = estimateTravelWaitTicks(playerAnchor, nearestYellow);
  const clicked = clickScreenPoint(
    captureBounds.x + nearestYellow.centerX,
    captureBounds.y + nearestYellow.centerY,
    captureBounds,
  );
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_ALTAR,
      `Clicked ${nearestYellow.markerColor} altar marker at (${clicked.x},${clicked.y}) local=(${nearestYellow.centerX},${nearestYellow.centerY}) bounds=(${nearestYellow.minX},${nearestYellow.minY})-${nearestYellow.maxX},${nearestYellow.maxY} size=${nearestYellow.width}x${nearestYellow.height} pixels=${nearestYellow.pixelCount}; altar-start coordinate='${altarStartLocation?.matchedLine ?? "unknown"}'; waiting before checking inventory (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...confirmedState,
    currentFunction: "waitAfterGuardianYellowClick",
    phase: "wait-after-guardian-yellow-click",
    guardianYellowArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    guardianAltarStartLocation: altarStartLocation,
    missingGuardianYellowTicks: 0,
    missingGuardianReturnRedTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_YELLOW_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterGuardianYellowClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.guardianYellowArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const inventory = detectInventoryCount(tickCapture.bitmap);
  if (inventory.count === null) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-runecrafting-inventory-count-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
      warn(stepMessage(WORKFLOW_STEPS.MOVE_TO_ALTAR, `Inventory free-space unreadable after altar click; saved debug image to ${debugPath}.`));
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (inventory.count === 0) {
    const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
    const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
    if (!nearestYellow) {
      const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
      if (missingGuardianYellowTicks <= GUARDIAN_ALTAR_SEARCH_RETRY_TICKS) {
        if (missingGuardianYellowTicks === 1 || missingGuardianYellowTicks % 3 === 0) {
          warn(
            stepMessage(
              WORKFLOW_STEPS.MOVE_TO_ALTAR,
              `Inventory free-space is still 0 and altar marker is not visible yet; scene may still be loading. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
            ),
          );
        }

        return {
          ...state,
          inventoryFreeSlots: inventory.count,
          missingGuardianYellowTicks,
          actionLockUntilMs: nowMs + GAME_TICK_MS,
        };
      }

      const message = stepMessage(
        WORKFLOW_STEPS.MOVE_TO_ALTAR,
        `Inventory free-space is still 0, but no altar marker was found after ${missingGuardianYellowTicks} check(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}. Stopping bot.`,
      );
      warn(message);
      notifyUserAndStop(message);
      return {
        ...state,
        inventoryFreeSlots: inventory.count,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + GAME_TICK_MS,
      };
    }

    if (state.missingGuardianYellowTicks > 0) {
      log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_ALTAR,
          `Altar marker found after ${state.missingGuardianYellowTicks} retry tick(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
        ),
      );
    }

    const altarStartLocation = readGuardianCoordinateLocation(tickCapture.bitmap) ?? state.guardianAltarStartLocation;
    const travel = estimateTravelWaitTicks(playerAnchor, nearestYellow);
    const clicked = clickScreenPoint(
      captureBounds.x + nearestYellow.centerX,
      captureBounds.y + nearestYellow.centerY,
      captureBounds,
    );
    const clickedAtMs = Date.now();
    log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_ALTAR,
        `Inventory free-space is still 0; clicked ${nearestYellow.markerColor} altar marker at (${clicked.x},${clicked.y}) local=(${nearestYellow.centerX},${nearestYellow.centerY}) bounds=(${nearestYellow.minX},${nearestYellow.minY})-${nearestYellow.maxX},${nearestYellow.maxY} size=${nearestYellow.width}x${nearestYellow.height} pixels=${nearestYellow.pixelCount}; altar-start coordinate='${altarStartLocation?.matchedLine ?? "unknown"}'; waiting before checking inventory again (${formatTravelEstimate(travel)}).`,
      ),
    );

    return {
      ...state,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      missingGuardianYellowTicks: 0,
      guardianYellowArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
      guardianAltarStartLocation: altarStartLocation,
      actionLockUntilMs: clickedAtMs + GUARDIAN_YELLOW_CLICK_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_PORTAL,
      `Inventory free-space changed to ${inventory.count}; switching to ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal search.`,
    ),
  );

  return {
    ...state,
    currentFunction: "findReturnPortal",
    phase: "find-return-portal",
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: 0,
    missingGuardianReturnRedTicks: 0,
    actionLockUntilMs: nowMs + GAME_TICK_MS,
  };
}

function runFindReturnPortalTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const portalCandidates = detectAllReturnPortalRedMarkers(tickCapture.bitmap);
  const returnPortal = pickNearestColoredMarker(portalCandidates, playerAnchor);
  if (!returnPortal) {
    const missingGuardianReturnRedTicks = state.missingGuardianReturnRedTicks + 1;
    const rotated = tapKey(GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY);

    warn(
      stepMessage(
        WORKFLOW_STEPS.FIND_PORTAL,
        `No ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker was found after inventory emptied; ${rotated ? `tapped '${GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY}'` : `could not tap '${GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY}'`} to rotate camera before retry ${missingGuardianReturnRedTicks}. Candidates=${formatColoredMarkerCandidates(portalCandidates)}.`,
      ),
    );

    return {
      ...state,
      missingGuardianReturnRedTicks,
      actionLockUntilMs: nowMs + GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const travel = estimateTravelWaitTicks(playerAnchor, returnPortal);
  const clicked = clickScreenPoint(captureBounds.x + returnPortal.centerX, captureBounds.y + returnPortal.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_PORTAL,
      `Clicked ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker at (${clicked.x},${clicked.y}) local=(${returnPortal.centerX},${returnPortal.centerY}) bounds=(${returnPortal.minX},${returnPortal.minY})-${returnPortal.maxX},${returnPortal.maxY} pixels=${returnPortal.pixelCount}; waiting to return to region ${GUARDIAN_CRAFTING_REGION_ID} (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterGuardianReturnClick",
    phase: "wait-after-guardian-return-click",
    guardianReturnArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    guardianReturnClickDistancePx: travel.distancePx,
    missingGuardianReturnRedTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function transitionToGreatGuardianState(state: BotState): BotState {
  setAutomateBotCurrentStep(STEP_GREAT_GUARDIAN_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_GREAT_GUARDIAN, "Searching for the blue great guardian outline."));
  return {
    ...state,
    currentFunction: "findGreatGuardian",
    phase: "find-great-guardian",
    actionLockUntilMs: 0,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
  };
}

async function runWaitAfterGuardianReturnClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): Promise<BotState> {
  if (nowMs < state.guardianReturnArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const location = readGuardianCoordinateLocation(tickCapture.bitmap);
  if (!location || location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    const missingGuardianReturnRedTicks = state.missingGuardianReturnRedTicks + 1;

    const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
    const portalCandidates = detectAllReturnPortalRedMarkers(tickCapture.bitmap);
    const returnPortal = pickNearestColoredMarker(portalCandidates, playerAnchor);
    if (returnPortal) {
      const travel = estimateTravelWaitTicks(playerAnchor, returnPortal);
      const clicked = clickScreenPoint(captureBounds.x + returnPortal.centerX, captureBounds.y + returnPortal.centerY, captureBounds);
      const clickedAtMs = Date.now();
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_BACK,
          `Return teleport not confirmed yet; current region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} matched='${location?.matchedLine ?? "null"}'. Re-clicked ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker at (${clicked.x},${clicked.y}) local=(${returnPortal.centerX},${returnPortal.centerY}) pixels=${returnPortal.pixelCount}; waiting to return to region ${GUARDIAN_CRAFTING_REGION_ID} (retry=${missingGuardianReturnRedTicks}, ${formatTravelEstimate(travel)}).`,
        ),
      );

      return {
        ...state,
        missingGuardianReturnRedTicks,
        guardianReturnArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
        guardianReturnClickDistancePx: travel.distancePx,
        actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
      };
    }

    if (missingGuardianReturnRedTicks === 1 || missingGuardianReturnRedTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_BACK,
          `Return teleport not confirmed yet; current region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} matched='${location?.matchedLine ?? "null"}'. ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker not visible; waiting for region ${GUARDIAN_CRAFTING_REGION_ID}. Candidates=${formatColoredMarkerCandidates(portalCandidates)}.`,
        ),
      );
    }

    return {
      ...state,
      missingGuardianReturnRedTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const cameraReset = tapKey(POST_RETURN_CAMERA_NORTH_KEY);
  log(
    stepMessage(
      WORKFLOW_STEPS.TELEPORT_BACK,
      `Return teleport confirmed: region=${location.regionId} chunk=${location.chunkId} matched='${location.matchedLine}'. ${cameraReset ? "Camera reset to north" : "Camera north reset skipped"} before continuing to post-return deposits.`,
    ),
  );
  return transitionToGreatGuardianState(state);
}

function runFindGreatGuardianTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllGreatGuardianBlueObjects(tickCapture.bitmap);
  const greatGuardian = pickLargestColoredMarker(candidates);
  if (!greatGuardian) {
    const missingGreatGuardianTicks = state.missingGreatGuardianTicks + 1;
    if (missingGreatGuardianTicks === 1 || missingGreatGuardianTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
          `No blue great guardian outline found yet. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
        ),
      );
    }

    return {
      ...state,
      missingGreatGuardianTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const clickPoint = pickColoredOutlineClickPoint(tickCapture.bitmap, greatGuardian, isGreatGuardianBluePixel);
  const travel = estimateTravelWaitTicks(playerAnchor, clickPoint);
  const clicked = clickScreenPoint(captureBounds.x + clickPoint.centerX, captureBounds.y + clickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
      `Clicked interior of blue great guardian outline at (${clicked.x},${clicked.y}) local=(${clickPoint.centerX},${clickPoint.centerY}) bounds=(${greatGuardian.minX},${greatGuardian.minY})-${greatGuardian.maxX},${greatGuardian.maxY} pixels=${greatGuardian.pixelCount}; ${formatTravelEstimate(travel)}.`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterGreatGuardianClick",
    phase: "wait-after-great-guardian-click",
    greatGuardianArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    greatGuardianClickDistancePx: travel.distancePx,
    missingGreatGuardianTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterGreatGuardianClickTick(state: BotState, nowMs: number): BotState {
  if (nowMs < state.greatGuardianArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT, "Searching for charged cell deposit marker."));
  return {
    ...state,
    currentFunction: "findChargedCellDeposit",
    phase: "find-charged-cell-deposit",
    actionLockUntilMs: 0,
    missingChargedCellDepositTicks: 0,
  };
}

function runFindChargedCellDepositTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllChargedCellDepositObjects(tickCapture.bitmap);
  const chargedCellDeposit = pickNearestColoredMarker(candidates, playerAnchor);
  if (!chargedCellDeposit) {
    const missingChargedCellDepositTicks = state.missingChargedCellDepositTicks + 1;
    if (missingChargedCellDepositTicks === 1 || missingChargedCellDepositTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
          `No charged cell deposit marker found yet. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
        ),
      );
    }

    return {
      ...state,
      missingChargedCellDepositTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const chargedCellDepositClickPoint = getBoundsCenterPoint(chargedCellDeposit);
  const travel = estimateTravelWaitTicks(playerAnchor, chargedCellDepositClickPoint);
  const clicked = clickScreenPoint(
    captureBounds.x + chargedCellDepositClickPoint.centerX,
    captureBounds.y + chargedCellDepositClickPoint.centerY,
    captureBounds,
  );
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
      `Clicked middle of charged cell deposit marker at (${clicked.x},${clicked.y}) local=(${chargedCellDepositClickPoint.centerX},${chargedCellDepositClickPoint.centerY}) bounds=(${chargedCellDeposit.minX},${chargedCellDeposit.minY})-(${chargedCellDeposit.maxX},${chargedCellDeposit.maxY}) pixels=${chargedCellDeposit.pixelCount}; ${formatTravelEstimate(travel)}.`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterChargedCellDepositClick",
    phase: "wait-after-charged-cell-deposit-click",
    chargedCellDepositArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    chargedCellDepositClickDistancePx: travel.distancePx,
    missingChargedCellDepositTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterChargedCellDepositClickTick(state: BotState, nowMs: number): BotState {
  if (nowMs < state.chargedCellDepositArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_RUNE_DEPOSIT, "Searching for rune deposit marker."));
  return {
    ...state,
    currentFunction: "findRuneDeposit",
    phase: "find-rune-deposit",
    actionLockUntilMs: 0,
    missingRuneDepositTicks: 0,
  };
}

function runFindRuneDepositTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllRuneDepositObjects(tickCapture.bitmap);
  const runeDeposit = pickNearestColoredMarker(candidates, playerAnchor);
  if (!runeDeposit) {
    const missingRuneDepositTicks = state.missingRuneDepositTicks + 1;
    const southPoint = getSouthMovePoint(tickCapture.bitmap, playerAnchor);
    const travel = estimateTravelWaitTicks(playerAnchor, { centerX: southPoint.x, centerY: southPoint.y });
    const clicked = clickScreenPoint(captureBounds.x + southPoint.x, captureBounds.y + southPoint.y, captureBounds);
    const clickedAtMs = Date.now();
    if (missingRuneDepositTicks === 1 || missingRuneDepositTicks % 3 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
          `No rune deposit marker found yet. Moving south via (${clicked.x},${clicked.y}) local=(${southPoint.x},${southPoint.y}); waiting before scanning again (${formatTravelEstimate(travel)}, attempt=${missingRuneDepositTicks}, candidates=${formatColoredMarkerCandidates(candidates)}).`,
        ),
      );
    }

    return {
      ...state,
      missingRuneDepositTicks,
      actionLockUntilMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    };
  }

  const inventoryBeforeClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryBeforeClick.count === null) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-rune-deposit-inventory-before-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventoryBeforeClick, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
          `Rune deposit marker found, but inventory free-space is unreadable before Step 21; saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const travel = estimateTravelWaitTicks(playerAnchor, runeDeposit);
  const clicked = clickScreenPoint(captureBounds.x + runeDeposit.centerX, captureBounds.y + runeDeposit.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
      `Clicked rune deposit marker at (${clicked.x},${clicked.y}) local=(${runeDeposit.centerX},${runeDeposit.centerY}) bounds=(${runeDeposit.minX},${runeDeposit.minY})-${runeDeposit.maxX},${runeDeposit.maxY} pixels=${runeDeposit.pixelCount}; inventory free-space before deposit=${inventoryBeforeClick.count}; waiting before verifying deposit (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterRuneDepositClick",
    phase: "wait-after-rune-deposit-click",
    runeDepositArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    runeDepositClickDistancePx: travel.distancePx,
    runeDepositInventoryFreeSlotsBeforeClick: inventoryBeforeClick.count,
    missingInventoryCountTicks: 0,
    missingRuneDepositTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterRuneDepositClickTick(state: BotState, nowMs: number, tickCapture: TickCapture): BotState {
  if (nowMs < state.runeDepositArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const inventoryAfterClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryAfterClick.count === null) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-rune-deposit-inventory-after-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventoryAfterClick, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
          `Inventory free-space unreadable after rune deposit click; saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (state.runeDepositInventoryFreeSlotsBeforeClick === null) {
    setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `Rune deposit inventory verification is missing the before snapshot; current free-space=${inventoryAfterClick.count}. Returning to Step 20.`,
      ),
    );
    return {
      ...state,
      currentFunction: "findRuneDeposit",
      phase: "find-rune-deposit",
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      runeDepositInventoryFreeSlotsBeforeClick: null,
      missingRuneDepositTicks: 0,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (inventoryAfterClick.count <= state.runeDepositInventoryFreeSlotsBeforeClick) {
    setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `Rune deposit did not increase inventory free-space (${state.runeDepositInventoryFreeSlotsBeforeClick} -> ${inventoryAfterClick.count}). Returning to Step 20 to retry the rune deposit.`,
      ),
    );
    return {
      ...state,
      currentFunction: "findRuneDeposit",
      phase: "find-rune-deposit",
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      runeDepositInventoryFreeSlotsBeforeClick: null,
      missingRuneDepositTicks: 0,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  setAutomateBotCurrentStep(STEP_FINAL_PORTAL_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
      `Rune deposit verified: inventory free-space increased ${state.runeDepositInventoryFreeSlotsBeforeClick} -> ${inventoryAfterClick.count}. Continuing to final portal check.`,
    ),
  );
  return {
    ...state,
    currentFunction: "waitForFinalPortalOpenIcon",
    phase: "wait-for-final-portal-open-icon",
    actionLockUntilMs: 0,
    missingInventoryCountTicks: 0,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: 0,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    inventoryFreeSlots: inventoryAfterClick.count,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
    missingPortalMiningMagentaTicks: 0,
    missingPortalExitTicks: 0,
  };
}

function runWaitForFinalPortalOpenIconTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const portalOpenIcon = detectGuardianOfTheRiftPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
  if (!portalOpenIcon.isOpen) {
    const missingFinalPortalOpenIconTicks = state.missingFinalPortalOpenIconTicks + 1;
    if (missingFinalPortalOpenIconTicks === 1 || missingFinalPortalOpenIconTicks % 5 === 0) {
      const bestScore = portalOpenIcon.matches[0]?.score;
      warn(
        stepMessage(
          WORKFLOW_STEPS.WAIT_FOR_FINAL_PORTAL_ICON,
          `Open portal icon is not visible yet; waiting before portal search (attempt=${missingFinalPortalOpenIconTicks}, bestScore=${bestScore === undefined ? "none" : bestScore.toFixed(3)}).`,
        ),
      );
    }

    return {
      ...state,
      missingFinalPortalOpenIconTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.WAIT_FOR_FINAL_PORTAL_ICON,
      `Open portal icon detected at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); checking for ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker.`,
    ),
  );

  return {
    ...state,
    currentFunction: "findFinalPortal",
    phase: "find-final-portal",
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
    actionLockUntilMs: nowMs + GAME_TICK_MS,
  };
}

function runFindFinalPortalTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
  const finalPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!finalPortal) {
    const missingFinalPortalTicks = state.missingFinalPortalTicks + 1;
    if (missingFinalPortalTicks === 1 || missingFinalPortalTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_FINAL_PORTAL,
          `No ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker found yet. Candidates=${formatGuardianOfTheRiftPortalCandidates(portalCandidates)}.`,
        ),
      );
    }

    return {
      ...state,
      missingFinalPortalTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const travel = estimateTravelWaitTicks(playerAnchor, finalPortal);
  const clicked = clickScreenPoint(captureBounds.x + finalPortal.centerX, captureBounds.y + finalPortal.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
      `Clicked ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${finalPortal.centerX},${finalPortal.centerY}) bounds=(${finalPortal.minX},${finalPortal.minY})-${finalPortal.maxX},${finalPortal.maxY} pixels=${finalPortal.pixelCount}; waiting before checking the magenta mining marker (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterFinalPortalClick",
    phase: "wait-after-final-portal-click",
    finalPortalArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    finalPortalClickDistancePx: travel.distancePx,
    missingFinalPortalTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterFinalPortalClickTick(state: BotState, nowMs: number): BotState {
  if (nowMs < state.finalPortalArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.CHECK_PORTAL_MINING_MAGENTA,
      `Portal travel wait complete; checking for a clickable ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker (distance=${state.finalPortalClickDistancePx === null ? "unknown" : `${Math.round(state.finalPortalClickDistancePx)}px`}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "findPortalMiningMagenta",
    phase: "find-portal-mining-magenta",
    finalPortalArrivalDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    missingPortalMiningMagentaTicks: 0,
    actionLockUntilMs: 0,
  };
}

function runFindPortalMiningMagentaTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const magentaObjects = detectAllPortalMiningMagentaObjects(tickCapture.bitmap, PORTAL_MINING_MAGENTA_MIN_PIXELS);
  const miningTarget = pickNearestColoredMarker(magentaObjects, playerAnchor);
  if (!miningTarget) {
    const missingPortalMiningMagentaTicks = state.missingPortalMiningMagentaTicks + 1;
    if (missingPortalMiningMagentaTicks === 1 || missingPortalMiningMagentaTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.CHECK_PORTAL_MINING_MAGENTA,
          `No clickable ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker found yet. Candidates=${formatColoredMarkerCandidates(magentaObjects)}.`,
        ),
      );
    }

    return {
      ...state,
      missingPortalMiningMagentaTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const travel = estimateTravelWaitTicks(playerAnchor, miningTarget);
  const clicked = clickScreenPoint(captureBounds.x + miningTarget.centerX, captureBounds.y + miningTarget.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_PORTAL_MINING,
      `Clicked ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker at (${clicked.x},${clicked.y}) local=(${miningTarget.centerX},${miningTarget.centerY}) bounds=(${miningTarget.minX},${miningTarget.minY})-(${miningTarget.maxX},${miningTarget.maxY}) pixels=${miningTarget.pixelCount}; waiting before monitoring inventory (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "portalMining",
    phase: "portal-mining",
    portalMiningArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    missingPortalMiningMagentaTicks: 0,
    missingInventoryCountTicks: 0,
    inventoryFreeSlots: null,
    craftingInventoryChangeDeadlineMs: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runPortalMiningTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
): BotState {
  if (nowMs < state.portalMiningArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const inventory = detectInventoryCount(tickCapture.bitmap);
  if (inventory.count === null) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-portal-mining-inventory-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL,
          `Inventory free-space unreadable while portal mining; saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (inventory.count === 0) {
    log(stepMessage(WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL, "Inventory is full after portal mining; finding exit portal."));
    return {
      ...state,
      currentFunction: "findPortalExit",
      phase: "find-portal-exit",
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      missingPortalExitTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      actionLockUntilMs: 0,
    };
  }

  if (state.inventoryFreeSlots === null || inventory.count !== state.inventoryFreeSlots) {
    log(
      stepMessage(
        WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL,
        `Portal mining inventory free-space ${state.inventoryFreeSlots === null ? "initialized" : "changed"}: ${state.inventoryFreeSlots ?? "unknown"} -> ${inventory.count}.`,
      ),
    );
    return {
      ...state,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: nowMs + PORTAL_MINING_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  if (state.craftingInventoryChangeDeadlineMs > 0 && nowMs >= state.craftingInventoryChangeDeadlineMs) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL,
        `Inventory free-space stayed at ${inventory.count} for ${PORTAL_MINING_INVENTORY_CHANGE_CHECK_TICKS} tick(s); checking magenta mining marker again.`,
      ),
    );
    return {
      ...state,
      currentFunction: "findPortalMiningMagenta",
      phase: "find-portal-mining-magenta",
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      missingPortalMiningMagentaTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      actionLockUntilMs: 0,
    };
  }

  return {
    ...state,
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: nowMs + GAME_TICK_MS,
  };
}

function runFindPortalExitTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
  const exitPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!exitPortal) {
    const missingPortalExitTicks = state.missingPortalExitTicks + 1;
    if (missingPortalExitTicks === 1 || missingPortalExitTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_PORTAL_EXIT,
          `No ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker found yet. Candidates=${formatGuardianOfTheRiftPortalCandidates(portalCandidates)}.`,
        ),
      );
    }

    return {
      ...state,
      missingPortalExitTicks,
      actionLockUntilMs: nowMs + GAME_TICK_MS,
    };
  }

  const travel = estimateTravelWaitTicks(playerAnchor, exitPortal);
  const clicked = clickScreenPoint(captureBounds.x + exitPortal.centerX, captureBounds.y + exitPortal.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_PORTAL_EXIT,
      `Clicked ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${exitPortal.centerX},${exitPortal.centerY}) bounds=(${exitPortal.minX},${exitPortal.minY})-${exitPortal.maxX},${exitPortal.maxY} pixels=${exitPortal.pixelCount}; waiting to return before repeating guardian click (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterPortalExitClick",
    phase: "wait-after-portal-exit-click",
    portalExitArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    portalExitClickDistancePx: travel.distancePx,
    missingPortalExitTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterPortalExitClickTick(state: BotState, nowMs: number): BotState {
  if (nowMs < state.portalExitArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.REPEAT_GUARDIAN_CLICK,
      `Portal return travel wait complete; repeating guardian click flow (distance=${state.portalExitClickDistancePx === null ? "unknown" : `${Math.round(state.portalExitClickDistancePx)}px`}).`,
    ),
  );

  return transitionToGuardianTravelState({
    ...state,
    inventoryFreeSlots: 0,
    portalMiningArrivalDeadlineMs: 0,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingPortalMiningMagentaTicks: 0,
    missingPortalExitTicks: 0,
  });
}

async function runLoop(
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): Promise<void> {
  if (isLoopRunning) {
    log("Loop already running.");
    return;
  }

  isLoopRunning = true;

  try {
    const startupBitmap = captureScreenBitmap(captureBounds);
    const distanceCalibration = calibrateDistanceTilePx(startupBitmap);
    currentDistanceTilePx = distanceCalibration.tilePx;
    log(
      `Distance tile calibration: usedTilePx=${distanceCalibration.tilePx}px source=${distanceCalibration.source} botRawTilePx=${distanceCalibration.botRawTilePx ?? "unavailable"}px managerRawTilePx=${distanceCalibration.managerRawTilePx ?? "unavailable"}px trustedRawRange=${STARTUP_RAW_TILE_PX_MIN_TRUSTED}-${STARTUP_RAW_TILE_PX_MAX_TRUSTED}px fallbackTilePx=${FREE_MOVE_TILE_PX_FALLBACK}px.`,
    );
    const initialState = createStartupInitialState(startupBitmap);

    await runBotEngine<BotState, EngineFunctionKey, TickCapture>({
      tickMs: GAME_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: () => initialState,
      captureTick: () => ({
        bitmap: captureScreenBitmap(captureBounds),
      }),
      observeTick: ({ state, tickCapture }) => {
        if (!ENABLE_COORDINATE_AUTO_SCREENSHOTS || state.loopIndex % COORDINATE_AUTO_SCREENSHOT_INTERVAL_TICKS !== 0) {
          return;
        }

        const result = saveCoordinateAutoScreenshot({
          bitmap: tickCapture.bitmap,
          monitorTier: currentMonitorTier,
          windowsScalePercent: currentWindowsScalePercent,
        });
        if (!result.saved) {
          return;
        }

        setCurrentLogLoopIndex(state.loopIndex);
        setCurrentLogPhase(state.phase);
        log(`Coordinate auto screenshot saved: matched='${result.matchedLine}' path=${result.filePath}.`);
      },
      functions: {
        pickUnchargedCell: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "pick-uncharged-cell"
            ? runPickUnchargedCellTick(state, nowMs, tickCapture, captureBounds, config)
            : state;
        },
        waitAfterPickup: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-pickup" ? runWaitAfterPickupTick(state, nowMs, config) : state;
        },
        findAgilityCourse: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-agility-course"
            ? runFindAgilityCourseTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterAgilityCourseYellowClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-agility-course-yellow-click"
            ? runWaitAfterAgilityCourseYellowClickTick(state, nowMs, tickCapture)
            : state;
        },
        findOrange: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-orange" ? runFindOrangeTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        waitForMiningTimer: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-for-mining-timer"
            ? runWaitForMiningTimerTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        mine: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "mining" ? runMiningTick(state, nowMs, tickCapture, captureBounds, config) : state;
        },
        waitAfterAgilityMiningYellowClick: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-agility-mining-yellow-click"
            ? runWaitAfterAgilityMiningYellowClickTick(state, nowMs)
            : state;
        },
        workbenchFindYellow: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "workbench-find-yellow"
            ? runWorkbenchFindYellowTick(state, nowMs, tickCapture, captureBounds, config)
            : state;
        },
        craft: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "crafting" ? runCraftingTick(state, nowMs, tickCapture) : state;
        },
        travelToGuardian: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "travel-to-guardian"
            ? runTravelToGuardianTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterGuardianClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-guardian-click"
            ? runWaitAfterGuardianClickTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterGuardianYellowClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-guardian-yellow-click"
            ? runWaitAfterGuardianYellowClickTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        findReturnPortal: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-return-portal"
            ? runFindReturnPortalTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterGuardianReturnClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-guardian-return-click"
            ? runWaitAfterGuardianReturnClickTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        findGreatGuardian: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-great-guardian"
            ? runFindGreatGuardianTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterGreatGuardianClick: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-great-guardian-click"
            ? runWaitAfterGreatGuardianClickTick(state, nowMs)
            : state;
        },
        findChargedCellDeposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-charged-cell-deposit"
            ? runFindChargedCellDepositTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterChargedCellDepositClick: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-charged-cell-deposit-click"
            ? runWaitAfterChargedCellDepositClickTick(state, nowMs)
            : state;
        },
        findRuneDeposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-rune-deposit"
            ? runFindRuneDepositTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterRuneDepositClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-rune-deposit-click"
            ? runWaitAfterRuneDepositClickTick(state, nowMs, tickCapture)
            : state;
        },
        waitForFinalPortalOpenIcon: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-for-final-portal-open-icon"
            ? runWaitForFinalPortalOpenIconTick(state, nowMs, tickCapture, portalOpenIconTemplate)
            : state;
        },
        findFinalPortal: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-final-portal"
            ? runFindFinalPortalTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        waitAfterFinalPortalClick: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-final-portal-click" ? runWaitAfterFinalPortalClickTick(state, nowMs) : state;
        },
        findPortalMiningMagenta: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-portal-mining-magenta"
            ? runFindPortalMiningMagentaTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        portalMining: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "portal-mining" ? runPortalMiningTick(state, nowMs, tickCapture) : state;
        },
        findPortalExit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-portal-exit" ? runFindPortalExitTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        waitAfterPortalExitClick: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-portal-exit-click" ? runWaitAfterPortalExitClickTick(state, nowMs) : state;
        },
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[${formatElapsedSinceStart()}] #${state.loopIndex} [${state.phase}] tick error - ${message}`);
      },
    });
  } finally {
    isLoopRunning = false;
    startedAtMs = null;
    currentDistanceTilePx = FREE_MOVE_TILE_PX_FALLBACK;
    setCurrentLogLoopIndex(0);
    setCurrentLogPhase(null);
    setAutomateBotCurrentStep(null);
  }
}

export function onRunecraftingGuardianOfTheRiftBotStart(): void {
  setCurrentLogLoopIndex(0);
  setCurrentLogPhase("startup");

  if (!isLoopRunning) {
    startedAtMs = Date.now();
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  const config = getSavedGuardianOfTheRiftConfig();
  log(
    `Config: engineTick=${GAME_TICK_MS}ms, startup-phase-check=on, agility-course=${config.useAgilityCourse ? "on" : "off"}.`,
  );

  const window = getRuneLite();
  if (!window) {
    const message = `${BOT_NAME} could not start because the RuneLite window was not found.`;
    warn(message);
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
    warn(message);
    notifyUserAndStop(message);
    return;
  }

  if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
    const message = "Cannot start - RuneLite window has zero size.";
    warn(message);
    notifyUserAndStop(message);
    return;
  }

  const scaleFactor = getWindowsDisplayScaleFactor(logicalBounds);
  currentWindowsScalePercent = Math.round(scaleFactor * 100);
  currentMonitorTier = getMonitorTier(logicalBounds, scaleFactor);
  const captureBounds = toPhysicalBounds(logicalBounds, scaleFactor);
  log(
    `Capture: ${captureBounds.width}x${captureBounds.height}, display=${currentMonitorTier}-${currentWindowsScalePercent}, coordinate-auto-screenshot=${ENABLE_COORDINATE_AUTO_SCREENSHOTS ? "on" : "off"}.`,
  );

  void (async () => {
    try {
      await sleepWithAbort(STARTUP_SETTLE_MS, () => AppState.automateBotRunning);
      if (!AppState.automateBotRunning) {
        return;
      }

      const portalOpenIconTemplate = await loadGuardianOfTheRiftPortalOpenIconTemplate();
      log(
        `Portal-open icon reference loaded for Step 22 (${portalOpenIconTemplate.bitmap.width}x${portalOpenIconTemplate.bitmap.height}).`,
      );
      await runLoop(captureBounds, config, portalOpenIconTemplate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Startup failed: ${message}`);
      notifyUserAndStop(message);
    }
  })();
}
