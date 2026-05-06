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
import {
  detectGuardianOfTheRiftPortalOpenIconWithCache,
  getGuardianOfTheRiftPortalOpenIconCachePath,
} from "./guardian-of-the-rift-portal-open-icon-cache";
import {
  recordGuardianOfTheRiftDistanceTileCorrection,
  recordGuardianOfTheRiftDistanceTileStartupObservation,
} from "./guardian-of-the-rift-distance-tile-history";
import { createAsyncWorldMapper } from "./mapping/async-world-mapper";
import { readWorldMapObservationFromBitmap } from "./mapping/world-map-observation-reader";
import { readCoordinateOverlayLocation, saveCoordinateAutoScreenshot } from "./shared/coordinate-auto-screenshot";
import {
  detectGuardianOfTheRiftAltarMarkersInScreenshot,
  formatGuardianOfTheRiftAltarCandidates,
  pickNearestGuardianOfTheRiftAltarMarker,
  type GuardianOfTheRiftAltarDetection,
} from "./shared/guardian-of-the-rift-altar-detector";
import {
  detectGuardianOfTheRiftPortalMarkersInScreenshot,
  formatGuardianOfTheRiftPortalCandidates,
  GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX,
  loadGuardianOfTheRiftPortalOpenIconTemplate,
  pickNearestGuardianOfTheRiftPortalMarker,
  type GuardianOfTheRiftPortalOpenIconTemplate,
} from "./shared/guardian-of-the-rift-portal-detector";
import {
  detectGuardianOfTheRiftPouches,
  GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES,
  loadGuardianOfTheRiftPouchTemplatesFromDirectory,
  type GuardianOfTheRiftDetectablePouch,
  type GuardianOfTheRiftPouchMatch,
  type GuardianOfTheRiftPouchTemplate,
} from "./shared/guardian-of-the-rift-pouch-detector";
import {
  detectGuardianOfTheRiftActiveRunes,
  loadGuardianOfTheRiftRuneTemplatesFromDirectory,
  type GuardianOfTheRiftRuneMatch,
  type GuardianOfTheRiftRuneTemplate,
  type GuardianOfTheRiftSlot,
} from "./shared/guardian-of-the-rift-active-rune-detector";
import {
  detectGuardianOfTheRiftRewardPoints,
  detectGuardianOfTheRiftTimeSincePortal,
  type GuardianOfTheRiftRewardPointsDetection,
  type GuardianOfTheRiftTimeSincePortalDetection,
} from "./shared/guardian-of-the-rift-panel-detector";
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
  | "fill-pouches-after-workbench-full"
  | "travel-to-guardian"
  | "wait-after-guardian-click"
  | "wait-after-guardian-yellow-click"
  | "empty-pouches-at-altar"
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
  | "recover-final-portal-arrival"
  | "find-portal-mining-magenta"
  | "portal-mining"
  | "fill-pouches-after-portal-mining-full"
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
  | "fillPouchesAfterWorkbenchFull"
  | "travelToGuardian"
  | "waitAfterGuardianClick"
  | "waitAfterGuardianYellowClick"
  | "emptyPouchesAtAltar"
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
  | "recoverFinalPortalArrival"
  | "findPortalMiningMagenta"
  | "portalMining"
  | "fillPouchesAfterPortalMiningFull"
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

type ReturnPortalRecoveryTarget = "finalPortal" | "portalExit";
type PostPortalDepositResume = "greatGuardian" | "chargedCell";
type PostAltarInventoryStep = "altar-baseline" | "great-guardian" | "charged-cell-deposit" | "rune-deposit";

type PostAltarInventoryLedger = {
  altarBaselineFreeSlots: number | null;
  greatGuardianFreeSlots: number | null;
  chargedCellDepositFreeSlots: number | null;
  runeDepositFreeSlots: number | null;
};

type InventoryHistoryEntry = {
  step: PostAltarInventoryStep;
  loopIndex: number;
  phase: BotPhase;
  freeSlots: number;
  previousFreeSlots: number | null;
  expectedFreeSlots: number | null;
  valid: boolean;
  note: string;
};

type GuardianOfTheRiftPouchLocation = {
  pouch: GuardianOfTheRiftDetectablePouch;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  screenCenterX: number;
  screenCenterY: number;
  score: number;
};

type GuardianOfTheRiftPouchInventoryMemory = {
  checkedAtMs: number;
  pouches: Record<GuardianOfTheRiftDetectablePouch, GuardianOfTheRiftPouchLocation | null>;
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
  agilityCourseYellowClickReadyAtMs: number;
  agilityCourseYellowArrivalDeadlineMs: number;
  agilityCourseYellowClickDistancePx: number | null;
  agilityCourseTargetConfirmed: boolean;
  agilityMiningYellowClickReadyAtMs: number;
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
  pouchInventory: GuardianOfTheRiftPouchInventoryMemory;
  pouchClickQueue: GuardianOfTheRiftPouchLocation[];
  pouchClickIndex: number;
  craftingPouchesFilledThisCycle: boolean;
  portalMiningPouchesFilledThisCycle: boolean;
  altarPouchesEmptiedThisCycle: boolean;
  postAltarInventoryLedger: PostAltarInventoryLedger;
  inventoryHistory: InventoryHistoryEntry[];
  missingInventoryCountTicks: number;
  craftingInventoryChangeDeadlineMs: number;
  guardianArrivalDeadlineMs: number;
  guardianClickDistancePx: number | null;
  guardianCoordinateConfirmed: boolean;
  guardianAltarStartLocation: GuardianCoordinateLocation | null;
  guardianYellowArrivalDeadlineMs: number;
  guardianYellowTravelEstimate: TravelWaitEstimate | null;
  guardianYellowCorrectionRecordedDeadlineMs: number | null;
  guardianReturnArrivalDeadlineMs: number;
  guardianReturnClickDistancePx: number | null;
  unknownRewardNextGuardianSlot: GuardianOfTheRiftSlot;
  returnPortalRecoveryTarget: ReturnPortalRecoveryTarget | null;
  openPortalAfterCurrentPostReturnAction: boolean;
  postPortalDepositResume: PostPortalDepositResume | null;
  greatGuardianArrivalDeadlineMs: number;
  greatGuardianClickDistancePx: number | null;
  chargedCellDepositArrivalDeadlineMs: number;
  chargedCellDepositClickDistancePx: number | null;
  chargedCellDepositPlayerTileFallbackPending: boolean;
  runeDepositArrivalDeadlineMs: number;
  runeDepositClickDistancePx: number | null;
  runeDepositInventoryFreeSlotsBeforeClick: number | null;
  finalPortalClickReadyAtMs: number;
  finalPortalArrivalDeadlineMs: number;
  finalPortalTeleportGraceDeadlineMs: number;
  finalPortalClickDistancePx: number | null;
  portalMiningArrivalDeadlineMs: number;
  portalExitClickReadyAtMs: number;
  portalExitArrivalDeadlineMs: number;
  portalExitClickDistancePx: number | null;
  missingGuardianGreenTicks: number;
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

type GuardianTravelMarkerColor = "green" | "royal-blue";

type GuardianTravelTarget = {
  slot: GuardianOfTheRiftSlot;
  runeMatch: GuardianOfTheRiftRuneMatch;
  marker: ColoredMarkerDetection;
  clickPoint: { centerX: number; centerY: number };
  color: GuardianTravelMarkerColor;
  colorHex: string;
};

type GuardianTravelTargetSelection = {
  target: GuardianTravelTarget | null;
  elementalRune: GuardianOfTheRiftRuneMatch | null;
  catalyticRune: GuardianOfTheRiftRuneMatch | null;
  rewardPoints: GuardianOfTheRiftRewardPointsDetection;
  greenCandidates: ColoredMarkerDetection[];
  catalyticCandidates: ColoredMarkerDetection[];
  skippedReasons: string[];
  preferenceOrder: GuardianOfTheRiftSlot[];
};

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
const STEP_FILL_POUCHES_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-fill-pouches`;
const STEP_ALTAR_POUCHES_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-altar-pouches`;
const STEP_TRAVEL_GUARDIAN_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-travel-guardian`;
const STEP_GREAT_GUARDIAN_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-great-guardian`;
const STEP_CHARGED_CELL_DEPOSIT_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-charged-cell-deposit`;
const STEP_RUNE_DEPOSIT_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-rune-deposit`;
const STEP_FINAL_PORTAL_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-final-portal`;
const GAME_TICK_MS = 600;
const BOT_TICK_MS = 200;
const FAST_ACTION_RETRY_MS = 200;
const PRE_DECISION_CAPTURE_SETTLE_MS = 80;
const STARTUP_SETTLE_MS = 180;
const POUCH_CLICKS_PER_GAME_TICK = 1;
const POUCH_CLICK_LOCK_MS = GAME_TICK_MS;
const POUCH_POST_SEQUENCE_SETTLE_MS = GAME_TICK_MS;
const CLICK_SAFE_EDGE_MARGIN_PX = 3;
const PURE_RED_MIN_PIXEL_COUNT = 24;
const PURE_RED_MAX_COMPONENT_WIDTH_RATIO = 0.18;
const PURE_RED_MAX_COMPONENT_HEIGHT_RATIO = 0.18;
const RETURN_PORTAL_MARKER_COLOR_HEX = "FFFF0000";
const ELEMENTAL_GUARDIAN_MARKER_COLOR_HEX = "FF00FF00";
const CATALYTIC_GUARDIAN_MARKER_COLOR_HEX = "FF4169E1";
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
const AGILITY_COURSE_EXIT_TARGET_X = 3633;
const AGILITY_COURSE_EXIT_TARGET_Y = 9503;
const AGILITY_COURSE_MARKER_MIN_PIXELS = 50;
const PORTAL_MINING_MARKER_COLOR_HEX = "FFAD00FF";
const PORTAL_MINING_MAGENTA_MIN_PIXELS = 50;
const PORTAL_MINING_ZONE_CHUNK_IDS = [920739, 930740, 918691, 918692] as const;
const FINAL_PORTAL_MINING_TILE_X = 3592;
const FINAL_PORTAL_MINING_TILE_Y = 9503;
const FINAL_PORTAL_TELEPORT_CONFIRM_GRACE_TICKS = 3;
const SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS = 1;
const AGILITY_EAST_CLICK_RATIO_X = 0.68;
const AGILITY_EAST_CLICK_RATIO_Y = 0.5;
const AGILITY_EAST_CLICK_LOCK_TICKS = 3;
const AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS = 1;
const AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS = 2;
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
const DISTANCE_TILE_CORRECTION_MIN_TRAVEL_TICKS = 4;
const DISTANCE_TILE_CORRECTION_THRESHOLD = 2;
const RUNE_DEPOSIT_SOUTH_CLICK_MIN_RATIO_X = 0.42;
const RUNE_DEPOSIT_SOUTH_CLICK_MAX_RATIO_X = 0.56;
const RUNE_DEPOSIT_SOUTH_CLICK_RATIO_Y = 0.74;
const RUNE_DEPOSIT_SOUTH_MIN_DISTANCE_RATIO = 0.16;
const RUNE_DEPOSIT_CLICK_RATIO_Y = 0.72;
const RUNE_DEPOSIT_PRE_CLICK_RECAPTURE_SETTLE_MS = 200;
const CHARGED_CELL_DEPOSIT_CLICK_RATIO_X = 0.64;
const CHARGED_CELL_DEPOSIT_PLAYER_TILE_VERIFY_TICKS = 2;
const ORANGE_MIN_PIXELS = 40;
const WORKBENCH_MAGENTA_MIN_PIXELS = 40;
const WORKBENCH_MAGENTA_MIN_WIDTH_PX = 24;
const WORKBENCH_MAGENTA_MIN_HEIGHT_PX = 24;
const WORKBENCH_MAGENTA_MIN_FILL_RATIO = 0.18;
const GREEN_MIN_PIXELS = 240;
const CATALYTIC_GUARDIAN_BLUE_MIN_PIXELS = 180;
const GUARDIAN_BLACK_MAX_COMPONENT = 70;
const GUARDIAN_BLACK_MIN_EDGE_MARGIN_PX = 2;
const GREAT_GUARDIAN_BLUE_MIN_PIXELS = 120;
const CHARGED_CELL_DEPOSIT_PURPLE_MIN_PIXELS = 40;
const RUNE_DEPOSIT_PINK_MIN_PIXELS = 40;
const MINING_ORANGE_RECLICK_MIN_DELAY_MS = 0;
const MINING_ORANGE_RECLICK_MAX_DELAY_MS = 3_000;
const WORKBENCH_CRAFT_CLICK_LOCK_TICKS = 3;
const GUARDIAN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_RECLICK_GRACE_TICKS = 2;
const GUARDIAN_YELLOW_CLICK_LOCK_TICKS = 2;
const GUARDIAN_RETURN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_GREEN_CLICK_TARGET_Y_RATIO = 0.5;
const GUARDIAN_COLORED_CLICK_TARGET_X_RATIO = 0.5;
const GUARDIAN_COLORED_CLICK_TARGET_Y_RATIO = 0.5;
const GUARDIAN_CLICK_SAFE_EDGE_MARGIN_PX = 24;
const GREAT_GUARDIAN_CLICK_TARGET_X_RATIO = 0.5;
const GREAT_GUARDIAN_CLICK_TARGET_Y_RATIO = 0.62;
const GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS = 1;
const GUARDIAN_ALTAR_SEARCH_RETRY_TICKS = 8;
const GUARDIAN_ALTAR_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS = 8;
const GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_LOCK_TICKS = 1;
const GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_LOCK_TICKS = 1;
const CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_KEY = "a";
const CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_LOCK_TICKS = 1;
const POST_RETURN_CAMERA_NORTH_KEY = "n";
const CHARGED_CELL_TO_RUNE_CAMERA_KEY = "m";
const POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY = "n";
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
const MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS = 90;
const TIMER_PRESENCE_ROI = { x: 88, y: 116, width: 96, height: 34 };
const TIMER_PRESENCE_MIN_BRIGHT_PIXELS = 18;
const ENABLE_COORDINATE_AUTO_SCREENSHOTS = false;
const COORDINATE_AUTO_SCREENSHOT_INTERVAL_TICKS = 10;
const ENABLE_WORLD_MAPPER = false;
const WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS = 10;
const WORLD_MAPPER_LOG_INTERVAL_TICKS = 50;
const INVENTORY_HISTORY_MAX_ENTRIES = 12;
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
  FILL_POUCHES_AFTER_WORKBENCH_FULL: "Step 07.B/30 Fill pouches after workbench full",
  FIND_GUARDIAN: "Step 08/30 Find guardian",
  MOVE_TO_GUARDIAN: "Step 09/30 Move to guardian",
  TELEPORT_TO_ALTAR: "Step 10/30 Teleport to altar region",
  FIND_ALTAR: "Step 11/30 Find altar",
  MOVE_TO_ALTAR: "Step 12/30 Move to altar",
  EMPTY_POUCHES_AT_ALTAR: "Step 12.B/30 Empty pouches and click altar again",
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
  RECOVER_FINAL_PORTAL_ARRIVAL: "Step 24.B/30 Recover salmon portal arrival",
  CHECK_PORTAL_MINING_MAGENTA: "Step 25/30 Check if magenta is clickable",
  TRAVEL_TO_PORTAL_MINING: "Step 26/30 Travel to mining",
  PORTAL_MINE_UNTIL_FULL: "Step 27/30 Mining until inventory is full",
  FILL_POUCHES_AFTER_PORTAL_MINING_FULL: "Step 27.B/30 Fill pouches after portal mining full",
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

function detectPortalOpenIcon(bitmap: RobotBitmap, portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate) {
  return detectGuardianOfTheRiftPortalOpenIconWithCache(bitmap, portalOpenIconTemplate, {
    monitorTier: currentMonitorTier,
    windowsScalePercent: currentWindowsScalePercent,
  });
}

function toPouchLocation(match: GuardianOfTheRiftPouchMatch, captureBounds: ScreenCaptureBounds): GuardianOfTheRiftPouchLocation {
  return {
    pouch: match.pouch,
    x: match.x,
    y: match.y,
    width: match.width,
    height: match.height,
    centerX: match.centerX,
    centerY: match.centerY,
    screenCenterX: captureBounds.x + match.centerX,
    screenCenterY: captureBounds.y + match.centerY,
    score: match.score,
  };
}

function formatPouchLocation(location: GuardianOfTheRiftPouchLocation): string {
  return `local=(${location.x},${location.y})-${location.x + location.width - 1},${location.y + location.height - 1} center=(${location.centerX},${location.centerY}) screenCenter=(${location.screenCenterX},${location.screenCenterY}) score=${location.score.toFixed(3)}`;
}

function getRememberedPouchLocations(state: BotState): GuardianOfTheRiftPouchLocation[] {
  return GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES.flatMap((pouch) => {
    const location = state.pouchInventory.pouches[pouch];
    return location ? [location] : [];
  });
}

function shouldEmptyPouchesAtAltar(state: BotState): boolean {
  return (
    !state.altarPouchesEmptiedThisCycle &&
    (state.craftingPouchesFilledThisCycle || state.portalMiningPouchesFilledThisCycle) &&
    getRememberedPouchLocations(state).length > 0
  );
}

function formatPouchClickList(locations: GuardianOfTheRiftPouchLocation[]): string {
  return locations.length === 0
    ? "none"
    : locations.map((location) => `${location.pouch}@(${location.screenCenterX},${location.screenCenterY})`).join(", ");
}

function clickNextRememberedPouchBatch(
  state: BotState,
  captureBounds: ScreenCaptureBounds,
  nowMs: number,
  step: (typeof WORKFLOW_STEPS)[keyof typeof WORKFLOW_STEPS],
): BotState {
  const clickIndex = clamp(state.pouchClickIndex, 0, state.pouchClickQueue.length);
  const batch = state.pouchClickQueue.slice(clickIndex, clickIndex + POUCH_CLICKS_PER_GAME_TICK);
  for (const location of batch) {
    clickScreenPoint(location.screenCenterX, location.screenCenterY, captureBounds);
  }

  const nextClickIndex = clickIndex + batch.length;
  const totalBatches = Math.max(1, Math.ceil(state.pouchClickQueue.length / POUCH_CLICKS_PER_GAME_TICK));
  const batchNumber = Math.min(totalBatches, Math.floor(clickIndex / POUCH_CLICKS_PER_GAME_TICK) + 1);
  log(
    stepMessage(
      step,
      `Clicked pouch batch ${batchNumber}/${totalBatches}: ${formatPouchClickList(batch)} (${nextClickIndex}/${state.pouchClickQueue.length} pouch click(s) done).`,
    ),
  );

  return {
    ...state,
    pouchClickIndex: nextClickIndex,
    actionLockUntilMs: nowMs + POUCH_CLICK_LOCK_MS,
  };
}

function resetPouchClickQueue(): Pick<BotState, "pouchClickQueue" | "pouchClickIndex"> {
  return {
    pouchClickQueue: [],
    pouchClickIndex: 0,
  };
}

function detectStartupPouchInventory(
  bitmap: RobotBitmap,
  captureBounds: ScreenCaptureBounds,
  pouchTemplates: GuardianOfTheRiftPouchTemplate[],
  checkedAtMs: number,
): GuardianOfTheRiftPouchInventoryMemory {
  const detection = detectGuardianOfTheRiftPouches(bitmap, pouchTemplates);
  const memory = createEmptyPouchInventoryMemory(checkedAtMs);

  for (const pouch of GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES) {
    const match = detection.pouches[pouch];
    if (match) {
      const location = toPouchLocation(match, captureBounds);
      memory.pouches[pouch] = location;
      log(`Startup pouch check: found ${pouch} pouch in inventory at ${formatPouchLocation(location)}.`);
      continue;
    }

    const bestScore = detection.matches.find((candidate) => candidate.pouch === pouch)?.score;
    log(
      `Startup pouch check: ${pouch} pouch not found in inventory${
        bestScore === undefined ? "" : ` (bestScore=${bestScore.toFixed(3)})`
      }.`,
    );
  }

  const foundPouches = GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES.flatMap((pouch) => {
    const location = memory.pouches[pouch];
    return location ? [location] : [];
  });
  log(
    `Startup pouch check summary: found ${foundPouches.length}/${GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES.length} pouch(es)${
      foundPouches.length === 0 ? "" : ` (${foundPouches.map((location) => location.pouch).join(", ")})`
    }.`,
  );

  return memory;
}

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
    phase === "fill-pouches-after-workbench-full" ||
    phase === "travel-to-guardian" ||
    phase === "wait-after-guardian-click" ||
    phase === "wait-after-guardian-yellow-click" ||
    phase === "empty-pouches-at-altar" ||
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
    phase === "recover-final-portal-arrival" ||
    phase === "find-portal-mining-magenta" ||
    phase === "portal-mining" ||
    phase === "fill-pouches-after-portal-mining-full" ||
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

function createEmptyPostAltarInventoryLedger(): PostAltarInventoryLedger {
  return {
    altarBaselineFreeSlots: null,
    greatGuardianFreeSlots: null,
    chargedCellDepositFreeSlots: null,
    runeDepositFreeSlots: null,
  };
}

function createEmptyPouchInventoryMemory(checkedAtMs = 0): GuardianOfTheRiftPouchInventoryMemory {
  return {
    checkedAtMs,
    pouches: {
      small: null,
      medium: null,
      giant: null,
    },
  };
}

function appendInventoryHistory(
  state: BotState,
  entry: Omit<InventoryHistoryEntry, "loopIndex" | "phase">,
): InventoryHistoryEntry[] {
  return [
    ...state.inventoryHistory,
    {
      ...entry,
      loopIndex: state.loopIndex,
      phase: state.phase,
    },
  ].slice(-INVENTORY_HISTORY_MAX_ENTRIES);
}

function formatInventoryHistory(entries: InventoryHistoryEntry[]): string {
  if (entries.length === 0) {
    return "none";
  }

  return entries
    .slice(-5)
    .map((entry) => {
      const expected = entry.expectedFreeSlots === null ? "any" : entry.expectedFreeSlots;
      const previous = entry.previousFreeSlots === null ? "unknown" : entry.previousFreeSlots;
      return `${entry.step}@#${entry.loopIndex}:${previous}->${entry.freeSlots} expected=${expected} ${entry.valid ? "ok" : "bad"} (${entry.note})`;
    })
    .join("; ");
}

function withInventoryCheckpoint(
  state: BotState,
  step: PostAltarInventoryStep,
  freeSlots: number,
  previousFreeSlots: number | null,
  expectedFreeSlots: number | null,
  valid: boolean,
  note: string,
  ledger: PostAltarInventoryLedger = state.postAltarInventoryLedger,
): BotState {
  return {
    ...state,
    postAltarInventoryLedger: ledger,
    inventoryHistory: appendInventoryHistory(state, {
      step,
      freeSlots,
      previousFreeSlots,
      expectedFreeSlots,
      valid,
      note,
    }),
  };
}

function withPostAltarInventoryBaseline(state: BotState, freeSlots: number): BotState {
  return withInventoryCheckpoint(
    {
      ...state,
      postAltarInventoryLedger: {
        ...createEmptyPostAltarInventoryLedger(),
        altarBaselineFreeSlots: freeSlots,
      },
      inventoryHistory: [],
    },
    "altar-baseline",
    freeSlots,
    null,
    null,
    true,
    "altar-click-result",
    {
      ...createEmptyPostAltarInventoryLedger(),
      altarBaselineFreeSlots: freeSlots,
    },
  );
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
    agilityCourseYellowClickReadyAtMs: 0,
    agilityCourseYellowArrivalDeadlineMs: 0,
    agilityCourseYellowClickDistancePx: null,
    agilityCourseTargetConfirmed: false,
    agilityMiningYellowClickReadyAtMs: 0,
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
    pouchInventory: createEmptyPouchInventoryMemory(),
    pouchClickQueue: [],
    pouchClickIndex: 0,
    craftingPouchesFilledThisCycle: false,
    portalMiningPouchesFilledThisCycle: false,
    altarPouchesEmptiedThisCycle: false,
    postAltarInventoryLedger: createEmptyPostAltarInventoryLedger(),
    inventoryHistory: [],
    missingInventoryCountTicks: 0,
    craftingInventoryChangeDeadlineMs: 0,
    guardianArrivalDeadlineMs: 0,
    guardianClickDistancePx: null,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    guardianYellowArrivalDeadlineMs: 0,
    guardianYellowTravelEstimate: null,
    guardianYellowCorrectionRecordedDeadlineMs: null,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    unknownRewardNextGuardianSlot: "elemental",
    returnPortalRecoveryTarget: null,
    openPortalAfterCurrentPostReturnAction: false,
    postPortalDepositResume: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    chargedCellDepositPlayerTileFallbackPending: false,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    finalPortalClickReadyAtMs: 0,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: 0,
    portalExitClickReadyAtMs: 0,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingGuardianGreenTicks: 0,
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

function isCatalyticGuardianBluePixel(r: number, g: number, b: number): boolean {
  const royalBlue = Math.abs(r - 65) <= 24 && Math.abs(g - 105) <= 28 && Math.abs(b - 225) <= 30 && b - r >= 120;
  const capturedSaturatedBlue = b >= 175 && r <= 115 && g <= 150 && b - r >= 85 && b - g >= 70;

  return royalBlue || capturedSaturatedBlue;
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

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const fillRatio = pixelCount / Math.max(1, componentWidth * componentHeight);

      if (
        componentWidth < WORKBENCH_MAGENTA_MIN_WIDTH_PX ||
        componentHeight < WORKBENCH_MAGENTA_MIN_HEIGHT_PX ||
        fillRatio < WORKBENCH_MAGENTA_MIN_FILL_RATIO
      ) {
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

function detectAllCatalyticGuardianBlueObjects(bitmap: RobotBitmap): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(bitmap, isCatalyticGuardianBluePixel, CATALYTIC_GUARDIAN_BLUE_MIN_PIXELS);
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

function getBoundsCenterRightPoint(marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">): {
  centerX: number;
  centerY: number;
} {
  return {
    centerX: Math.round(marker.minX + (marker.maxX - marker.minX) * CHARGED_CELL_DEPOSIT_CLICK_RATIO_X),
    centerY: Math.round((marker.minY + marker.maxY) / 2),
  };
}

function getBoundsBottomCenterPoint(marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">): {
  centerX: number;
  centerY: number;
} {
  return {
    centerX: Math.round((marker.minX + marker.maxX) / 2),
    centerY: Math.round(marker.minY + (marker.maxY - marker.minY) * RUNE_DEPOSIT_CLICK_RATIO_Y),
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

function isAtAgilityCourseExitCoordinate(location: GuardianCoordinateLocation | null): boolean {
  return location !== null && location.x === AGILITY_COURSE_EXIT_TARGET_X && location.y === AGILITY_COURSE_EXIT_TARGET_Y;
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

function getGuardianTeleportRetryDeadlineMs(clickedAtMs: number, travel: TravelWaitEstimate): number {
  return clickedAtMs + (travel.waitTicks + GUARDIAN_RECLICK_GRACE_TICKS) * GAME_TICK_MS;
}

function formatGuardianTeleportWait(travel: TravelWaitEstimate): string {
  return `${formatTravelEstimate(travel)} retryGrace=${GUARDIAN_RECLICK_GRACE_TICKS} tick(s)`;
}

function recordAltarDistanceTileCorrectionIfNeeded(state: BotState, bitmap: RobotBitmap): BotState {
  const travel = state.guardianYellowTravelEstimate;
  if (travel === null || state.guardianYellowCorrectionRecordedDeadlineMs === state.guardianYellowArrivalDeadlineMs) {
    return state;
  }

  const correction = recordGuardianOfTheRiftDistanceTileCorrection({
    bitmap,
    context: {
      monitorTier: currentMonitorTier,
      windowsScalePercent: currentWindowsScalePercent,
    },
    phase: state.phase,
    reason: "altar-inventory-still-full-after-travel-deadline",
    travel,
    minTilePx: FREE_MOVE_TILE_PX_MIN,
    maxTilePx: FREE_MOVE_TILE_PX_MAX,
    travelSpeedTilesPerTick: PLAYER_TRAVEL_SPEED_TILES_PER_TICK,
    minTravelTicks: DISTANCE_TILE_CORRECTION_MIN_TRAVEL_TICKS,
    correctionThreshold: DISTANCE_TILE_CORRECTION_THRESHOLD,
  });

  if (correction.recorded) {
    if (correction.adjusted) {
      currentDistanceTilePx = correction.nextTilePx;
      warn(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_ALTAR,
          `Distance tile history lowered tilePx ${correction.previousTilePx}px -> ${correction.nextTilePx}px after ${correction.correctionThreshold} long altar correction(s); candidate=${correction.candidateTilePx}px, observations=${correction.correctionObservationCount}, history=${correction.path}.`,
        ),
      );
    } else {
      log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_ALTAR,
          `Distance tile correction recorded because altar inventory stayed full after travel deadline; currentTilePx=${correction.previousTilePx}px candidate=${correction.candidateTilePx}px debt=${correction.correctionDebt}/${correction.correctionThreshold}, observations=${correction.correctionObservationCount}.`,
        ),
      );
    }
  }

  return {
    ...state,
    guardianYellowCorrectionRecordedDeadlineMs: state.guardianYellowArrivalDeadlineMs,
  };
}

async function captureGuardianTick(
  state: BotState,
  nowMs: number,
  captureBounds: ScreenCaptureBounds,
): Promise<TickCapture> {
  if (nowMs >= state.actionLockUntilMs && PRE_DECISION_CAPTURE_SETTLE_MS > 0) {
    await sleepWithAbort(PRE_DECISION_CAPTURE_SETTLE_MS, () => AppState.automateBotRunning);
  }

  return {
    bitmap: captureScreenBitmap(captureBounds),
  };
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
      `Mining node clicked; waiting for mining status to turn green, then racing the local 90s timer against time-since-portal >= ${MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS}s before changing phase.`,
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

function formatActiveGuardianRuneMatch(match: GuardianOfTheRiftRuneMatch | null): string {
  if (!match) {
    return "none";
  }

  return `${match.rune} score=${match.score.toFixed(3)} local=(${match.centerX},${match.centerY})`;
}

function getOppositeGuardianSlot(slot: GuardianOfTheRiftSlot): GuardianOfTheRiftSlot {
  return slot === "elemental" ? "catalytic" : "elemental";
}

function isGuardianClickPointSafelyOnScreen(bitmap: RobotBitmap, point: { centerX: number; centerY: number }): boolean {
  return (
    point.centerX >= GUARDIAN_CLICK_SAFE_EDGE_MARGIN_PX &&
    point.centerY >= GUARDIAN_CLICK_SAFE_EDGE_MARGIN_PX &&
    point.centerX <= bitmap.width - 1 - GUARDIAN_CLICK_SAFE_EDGE_MARGIN_PX &&
    point.centerY <= bitmap.height - 1 - GUARDIAN_CLICK_SAFE_EDGE_MARGIN_PX
  );
}

function getGuardianSlotPreferenceOrder(
  rewardPoints: GuardianOfTheRiftRewardPointsDetection,
  unknownRewardNextGuardianSlot: GuardianOfTheRiftSlot,
): GuardianOfTheRiftSlot[] {
  if (rewardPoints.focus === "catalytic") {
    return ["catalytic", "elemental"];
  }

  if (rewardPoints.focus === null) {
    return [unknownRewardNextGuardianSlot, getOppositeGuardianSlot(unknownRewardNextGuardianSlot)];
  }

  return ["elemental", "catalytic"];
}

function selectGuardianTravelTarget(
  bitmap: RobotBitmap,
  config: GuardianOfTheRiftConfig,
  activeRuneTemplates: GuardianOfTheRiftRuneTemplate[],
  unknownRewardNextGuardianSlot: GuardianOfTheRiftSlot,
): GuardianTravelTargetSelection {
  const activeRunes = detectGuardianOfTheRiftActiveRunes(bitmap, activeRuneTemplates);
  const rewardPoints = detectGuardianOfTheRiftRewardPoints(bitmap);
  const greenCandidates = detectAllGreenObjects(bitmap, GREEN_MIN_PIXELS);
  const catalyticCandidates = detectAllCatalyticGuardianBlueObjects(bitmap);
  const greenMarker = pickLargestGreenObject(greenCandidates);
  const catalyticMarker = pickLargestColoredMarker(catalyticCandidates);
  const skippedReasons: string[] = [];
  const targets: GuardianTravelTarget[] = [];
  const preferenceOrder = getGuardianSlotPreferenceOrder(rewardPoints, unknownRewardNextGuardianSlot);

  const addTarget = (
    slot: GuardianOfTheRiftSlot,
    runeMatch: GuardianOfTheRiftRuneMatch | null,
    marker: ColoredMarkerDetection | null,
    color: GuardianTravelMarkerColor,
    colorHex: string,
  ): void => {
    if (!runeMatch) {
      skippedReasons.push(`${slot}: active rune was not detected`);
      return;
    }

    if (config.activeGuardianElements[runeMatch.rune] === false) {
      skippedReasons.push(`${slot}: ${runeMatch.rune} is disabled in config`);
      return;
    }

    if (!marker) {
      skippedReasons.push(`${slot}: ${colorHex} marker was not visible`);
      return;
    }

    targets.push({
      slot,
      runeMatch,
      marker,
      clickPoint:
        slot === "elemental"
          ? pickGuardianGreenClickPoint(bitmap, marker)
          : pickColoredOutlineClickPoint(
              bitmap,
              marker,
              isCatalyticGuardianBluePixel,
              GUARDIAN_COLORED_CLICK_TARGET_X_RATIO,
              GUARDIAN_COLORED_CLICK_TARGET_Y_RATIO,
            ),
      color,
      colorHex,
    });
  };

  for (const slot of preferenceOrder) {
    if (slot === "elemental") {
      addTarget(
        "elemental",
        activeRunes.elemental,
        greenMarker,
        "green",
        ELEMENTAL_GUARDIAN_MARKER_COLOR_HEX,
      );
      continue;
    }

    addTarget(
      "catalytic",
      activeRunes.catalytic,
      catalyticMarker,
      "royal-blue",
      CATALYTIC_GUARDIAN_MARKER_COLOR_HEX,
    );
  }

  return {
    target: targets[0] ?? null,
    elementalRune: activeRunes.elemental,
    catalyticRune: activeRunes.catalytic,
    rewardPoints,
    greenCandidates,
    catalyticCandidates,
    skippedReasons,
    preferenceOrder,
  };
}

function pickColoredOutlineClickPoint(
  bitmap: RobotBitmap,
  detection: ColoredMarkerDetection,
  isTargetPixel: (r: number, g: number, b: number) => boolean,
  targetXRatio = GREAT_GUARDIAN_CLICK_TARGET_X_RATIO,
  targetYRatio = GREAT_GUARDIAN_CLICK_TARGET_Y_RATIO,
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
  const preferredX = detection.minX + (width - 1) * targetXRatio;
  const preferredY = detection.minY + (height - 1) * targetYRatio;
  let bestX = Math.round(centroidX);
  let bestY = Math.round(centroidY);
  let bestPreferredDistance = Number.POSITIVE_INFINITY;
  let bestEdgeMargin = Number.NEGATIVE_INFINITY;

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

      const dx = x - preferredX;
      const dy = y - preferredY;
      const edgeMargin = Math.min(x - rowMin[localY], rowMax[localY] - x, y - colMin[localX], colMax[localX] - y);
      const preferredDistance = dx * dx + dy * dy;

      if (
        preferredDistance < bestPreferredDistance ||
        (preferredDistance === bestPreferredDistance && edgeMargin > bestEdgeMargin)
      ) {
        bestPreferredDistance = preferredDistance;
        bestEdgeMargin = edgeMargin;
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
    if (state.agilityCourseYellowClickReadyAtMs === 0) {
      const readyAtMs = nowMs + AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
      log(
        stepMessage(
          WORKFLOW_STEPS.FIND_AGILITY_COURSE,
          `FFCCFF00 yellow agility-course marker found at local=(${nearestAgilityCourseMarker.centerX},${nearestAgilityCourseMarker.centerY}); waiting ${AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS} game tick(s) before clicking.`,
        ),
      );

      return {
        ...state,
        agilityCourseYellowClickReadyAtMs: readyAtMs,
        actionLockUntilMs: readyAtMs,
        missingAgilityCourseTicks: 0,
      };
    }

    if (nowMs < state.agilityCourseYellowClickReadyAtMs) {
      return {
        ...state,
        actionLockUntilMs: state.agilityCourseYellowClickReadyAtMs,
      };
    }

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
        `Clicked FFCCFF00 yellow agility-course marker at (${clicked.x},${clicked.y}) local=(${nearestAgilityCourseMarker.centerX},${nearestAgilityCourseMarker.centerY}) pixels=${nearestAgilityCourseMarker.pixelCount}; waiting ${AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS} extra game tick(s) before checking coordinate ${AGILITY_COURSE_TARGET_X},${AGILITY_COURSE_TARGET_Y} (${formatTravelEstimate(travel)}).`,
      ),
    );
    return {
      ...state,
      currentFunction: "waitAfterAgilityCourseYellowClick",
      phase: "wait-after-agility-course-yellow-click",
      agilityCourseYellowClickReadyAtMs: 0,
      agilityCourseYellowArrivalDeadlineMs: clickedAtMs + (travel.waitTicks + AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS) * GAME_TICK_MS,
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
    agilityCourseYellowClickReadyAtMs: 0,
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
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
    craftingPouchesFilledThisCycle: false,
    finalPortalTeleportGraceDeadlineMs: 0,
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
      agilityMiningYellowClickReadyAtMs: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (state.agilityMiningYellowClickReadyAtMs === 0) {
    const readyAtMs = nowMs + AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
    log(
      stepMessage(
        WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
        `${reason}; nearby FFCCFF00 yellow marker found at local=(${nearestYellowMarker.centerX},${nearestYellowMarker.centerY}); waiting ${AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS} game tick(s) before clicking.`,
      ),
    );

    return {
      ...state,
      agilityMiningYellowClickReadyAtMs: readyAtMs,
      missingAgilityCourseTicks: 0,
      actionLockUntilMs: readyAtMs,
    };
  }

  if (nowMs < state.agilityMiningYellowClickReadyAtMs) {
    return {
      ...state,
      actionLockUntilMs: state.agilityMiningYellowClickReadyAtMs,
    };
  }

  const travel = estimateTravelWaitTicks(playerAnchor, nearestYellowMarker);
  const clicked = clickScreenPoint(captureBounds.x + nearestYellowMarker.centerX, captureBounds.y + nearestYellowMarker.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
      `${reason}; clicked nearby FFCCFF00 yellow marker at (${clicked.x},${clicked.y}) local=(${nearestYellowMarker.centerX},${nearestYellowMarker.centerY}) pixels=${nearestYellowMarker.pixelCount}; waiting ${AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS} extra game tick(s) before workbench search (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterAgilityMiningYellowClick",
    phase: "wait-after-agility-mining-yellow-click",
    agilityMiningYellowClickReadyAtMs: 0,
    agilityMiningYellowArrivalDeadlineMs: clickedAtMs + (travel.waitTicks + AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS) * GAME_TICK_MS,
    agilityMiningYellowClickDistancePx: travel.distancePx,
    missingAgilityCourseTicks: 0,
    actionLockUntilMs: clickedAtMs + AGILITY_EAST_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterAgilityMiningYellowClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.agilityMiningYellowArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const location = readGuardianCoordinateLocation(tickCapture.bitmap);
  if (!location) {
    const missingAgilityCourseTicks = state.missingAgilityCourseTicks + 1;
    if (missingAgilityCourseTicks === 1 || missingAgilityCourseTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
          `Agility exit not confirmed yet; coordinate overlay is unreadable. Waiting for coordinate ${AGILITY_COURSE_EXIT_TARGET_X},${AGILITY_COURSE_EXIT_TARGET_Y}.`,
        ),
      );
    }

    return {
      ...state,
      missingAgilityCourseTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (!isAtAgilityCourseExitCoordinate(location)) {
    const missingAgilityCourseTicks = state.missingAgilityCourseTicks + 1;
    warn(
      stepMessage(
        WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
        `Agility exit coordinate is not ${AGILITY_COURSE_EXIT_TARGET_X},${AGILITY_COURSE_EXIT_TARGET_Y} after yellow click: current=${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId} raw='${location.matchedLine}'. Re-clicking yellow marker before moving to magenta workbench.`,
      ),
    );

    return clickAgilityCourseYellowBeforeWorkbench(
      {
        ...state,
        agilityMiningYellowArrivalDeadlineMs: 0,
        agilityMiningYellowClickDistancePx: null,
        missingAgilityCourseTicks,
      },
      nowMs,
      tickCapture,
      captureBounds,
      `Agility exit coordinate is not ${AGILITY_COURSE_EXIT_TARGET_X},${AGILITY_COURSE_EXIT_TARGET_Y}`,
    );
  }

  return transitionToWorkbenchState(
    {
      ...state,
      agilityMiningYellowArrivalDeadlineMs: 0,
      agilityMiningYellowClickDistancePx: null,
      missingAgilityCourseTicks: 0,
    },
    `Agility yellow marker travel complete at exit coordinate ${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId} (distance=${state.agilityMiningYellowClickDistancePx === null ? "unknown" : `${Math.round(state.agilityMiningYellowClickDistancePx)}px`}); searching for the magenta workbench marker.`,
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

function formatTimeSincePortal(detection: GuardianOfTheRiftTimeSincePortalDetection): string {
  return `color=${detection.color ?? "unreadable"} seconds=${detection.secondsElapsed ?? "null"} raw=${detection.rawText ?? "null"} pixels=${detection.pixelCount} confidence=${detection.confidence.toFixed(2)}`;
}

function formatRewardPoints(detection: GuardianOfTheRiftRewardPointsDetection): string {
  return `elemental=${detection.elementalPoints ?? "null"} catalytic=${detection.catalyticPoints ?? "null"} raw=${detection.rawText ?? "null"} focus=${detection.focus ?? "unknown"}`;
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
  const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(tickCapture.bitmap);

  if (miningStatusJustTurnedGreen) {
    log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `Mining status turned green (${formatMiningStatus(miningStatus)}); starting local 90s mining timer and watching time-since-portal (${formatTimeSincePortal(timeSincePortal)}).`,
      ),
    );
  }

  if (
    timeSincePortal.secondsElapsed !== null &&
    timeSincePortal.secondsElapsed >= MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS
  ) {
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
        `Time since portal reached ${timeSincePortal.secondsElapsed}s (${formatTimeSincePortal(timeSincePortal)}) after ${elapsedSeconds}s of local mining; mining complete`,
      );
    }

    return transitionToWorkbenchState(
      {
        ...state,
        miningStatusGreenStartedAtMs,
        missingMiningTimerTicks: 0,
      },
      `Time since portal reached ${timeSincePortal.secondsElapsed}s (${formatTimeSincePortal(timeSincePortal)}) after ${elapsedSeconds}s of local mining; searching for the magenta workbench marker.`,
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
        `Mining status confirms mining (${formatMiningStatus(miningStatus)}); local green timer remaining=${miningStatusGreenRemainingSeconds}s; time-since-portal=${formatTimeSincePortal(timeSincePortal)}.`,
      ),
    );
  }

  return {
    ...state,
    miningStatusGreenStartedAtMs,
    missingMiningTimerTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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

function transitionToGuardianTravelState(
  state: BotState,
  reason = "Inventory free-space is 0; searching for the green guardian outline.",
): BotState {
  setAutomateBotCurrentStep(STEP_TRAVEL_GUARDIAN_ID);
  log(stepMessage(WORKFLOW_STEPS.FIND_GUARDIAN, reason));
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
    guardianYellowTravelEstimate: null,
    guardianYellowCorrectionRecordedDeadlineMs: null,
    altarPouchesEmptiedThisCycle: false,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    returnPortalRecoveryTarget: null,
    openPortalAfterCurrentPostReturnAction: false,
    postPortalDepositResume: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    missingGuardianGreenTicks: 0,
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
    guardianYellowTravelEstimate: null,
    guardianYellowCorrectionRecordedDeadlineMs: null,
    altarPouchesEmptiedThisCycle: false,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    returnPortalRecoveryTarget: null,
    openPortalAfterCurrentPostReturnAction: false,
    postPortalDepositResume: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    missingGuardianGreenTicks: 0,
    missingGuardianYellowTicks: 0,
    missingGuardianReturnRedTicks: 0,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
  };
}

function createStartupInitialState(bitmap: RobotBitmap, pouchInventory: GuardianOfTheRiftPouchInventoryMemory): BotState {
  const state = {
    ...createInitialState(),
    pouchInventory,
  };
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

function runCraftingTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventory.count === 0) {
    const rememberedPouches = getRememberedPouchLocations(state);
    if (!state.craftingPouchesFilledThisCycle && rememberedPouches.length > 0) {
      setAutomateBotCurrentStep(STEP_FILL_POUCHES_ID);
      log(
        stepMessage(
          WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
          `Inventory is full after workbench and ${rememberedPouches.length} remembered pouch(es) are available; filling pouches one per game tick before reclicking workbench.`,
        ),
      );

      return {
        ...state,
        currentFunction: "fillPouchesAfterWorkbenchFull",
        phase: "fill-pouches-after-workbench-full",
        pouchClickQueue: rememberedPouches,
        pouchClickIndex: 0,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: 0,
        craftingInventoryChangeDeadlineMs: 0,
        craftingPouchesFilledThisCycle: true,
        missingYellowTicks: 0,
        actionLockUntilMs: 0,
      };
    }

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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventory.count !== state.inventoryFreeSlots) {
    log(stepMessage(WORKFLOW_STEPS.CRAFT_UNTIL_FULL, `Inventory free-space changed: ${state.inventoryFreeSlots} -> ${inventory.count}.`));
    return {
      ...state,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: nowMs + WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function runFillPouchesAfterWorkbenchFullTick(
  state: BotState,
  nowMs: number,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  if (state.pouchClickIndex < state.pouchClickQueue.length) {
    const nextState = clickNextRememberedPouchBatch(state, captureBounds, nowMs, WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL);
    if (nextState.pouchClickIndex < nextState.pouchClickQueue.length) {
      return nextState;
    }

    const filledPouchCount = nextState.pouchClickQueue.length;
    setAutomateBotCurrentStep(STEP_WORKBENCH_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
        `Finished filling ${filledPouchCount} remembered pouch(es); waiting one game tick before returning to workbench marker search to reclick workbench.`,
      ),
    );

    return {
      ...nextState,
      ...resetPouchClickQueue(),
      currentFunction: "workbenchFindYellow",
      phase: "workbench-find-yellow",
      inventoryFreeSlots: null,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      missingYellowTicks: 0,
      actionLockUntilMs: nowMs + POUCH_POST_SEQUENCE_SETTLE_MS,
    };
  }

  setAutomateBotCurrentStep(STEP_WORKBENCH_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
      `Finished filling ${state.pouchClickQueue.length} remembered pouch(es); returning to workbench marker search to reclick workbench.`,
    ),
  );

  return {
    ...state,
    ...resetPouchClickQueue(),
    currentFunction: "workbenchFindYellow",
    phase: "workbench-find-yellow",
    inventoryFreeSlots: null,
    missingInventoryCountTicks: 0,
    craftingInventoryChangeDeadlineMs: 0,
    missingYellowTicks: 0,
    actionLockUntilMs: 0,
  };
}

function runTravelToGuardianTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
  activeRuneTemplates: GuardianOfTheRiftRuneTemplate[],
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const guardianTargetSelection = selectGuardianTravelTarget(
    tickCapture.bitmap,
    config,
    activeRuneTemplates,
    state.unknownRewardNextGuardianSlot,
  );
  if (!guardianTargetSelection.target) {
    const missingGuardianGreenTicks = state.missingGuardianGreenTicks + 1;
    const hasEnabledVisibleTarget =
      guardianTargetSelection.skippedReasons.some((reason) => reason.includes("marker was not visible")) &&
      guardianTargetSelection.skippedReasons.some((reason) => !reason.includes("is disabled in config"));
    const rotated = hasEnabledVisibleTarget ? tapKey(GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY) : false;
    if (missingGuardianGreenTicks === 1 || missingGuardianGreenTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_GUARDIAN,
          `No enabled active guardian target found; rewardPoints=${formatRewardPoints(guardianTargetSelection.rewardPoints)} preference=${guardianTargetSelection.preferenceOrder.join("->")}; active elemental=${formatActiveGuardianRuneMatch(guardianTargetSelection.elementalRune)}, catalytic=${formatActiveGuardianRuneMatch(guardianTargetSelection.catalyticRune)}; skipped=${guardianTargetSelection.skippedReasons.join("; ") || "none"}; greenCandidates=${formatColoredMarkerCandidates(guardianTargetSelection.greenCandidates)}, catalyticCandidates=${formatColoredMarkerCandidates(guardianTargetSelection.catalyticCandidates)}. ${rotated ? `Tapped '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}'` : "Waiting without guardian click"} before retry ${missingGuardianGreenTicks}.`,
        ),
      );
    }

    return {
      ...state,
      missingGuardianGreenTicks,
      actionLockUntilMs: nowMs + GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const target = guardianTargetSelection.target;
  if (!isGuardianClickPointSafelyOnScreen(tickCapture.bitmap, target.clickPoint)) {
    const missingGuardianGreenTicks = state.missingGuardianGreenTicks + 1;
    const rotated = tapKey(GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY);
    warn(
      stepMessage(
        WORKFLOW_STEPS.FIND_GUARDIAN,
        `Enabled ${target.slot} guardian (${target.runeMatch.rune}) click point local=(${target.clickPoint.centerX},${target.clickPoint.centerY}) is too close to the screen edge for a safe click; bounds=(${target.marker.minX},${target.marker.minY})-${target.marker.maxX},${target.marker.maxY}. ${rotated ? `Tapped '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}'` : "Waiting"} before retry ${missingGuardianGreenTicks}.`,
      ),
    );

    return {
      ...state,
      missingGuardianGreenTicks,
      actionLockUntilMs: nowMs + GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const travel = estimateTravelWaitTicks(playerAnchor, target.clickPoint);
  const clicked = clickScreenPoint(
    captureBounds.x + target.clickPoint.centerX,
    captureBounds.y + target.clickPoint.centerY,
    captureBounds,
  );
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_GUARDIAN,
      `Clicked ${target.slot} guardian (${target.runeMatch.rune}, marker=${target.colorHex}/${target.color}) at (${clicked.x},${clicked.y}) local=(${target.clickPoint.centerX},${target.clickPoint.centerY}) bounds=(${target.marker.minX},${target.marker.minY})-${target.marker.maxX},${target.marker.maxY} pixels=${target.marker.pixelCount}; rewardPoints=${formatRewardPoints(guardianTargetSelection.rewardPoints)} preference=${guardianTargetSelection.preferenceOrder.join("->")} nextUnknown=${getOppositeGuardianSlot(target.slot)}; active elemental=${formatActiveGuardianRuneMatch(guardianTargetSelection.elementalRune)}, catalytic=${formatActiveGuardianRuneMatch(guardianTargetSelection.catalyticRune)}; waiting for teleport out of region ${GUARDIAN_CRAFTING_REGION_ID} (${formatGuardianTeleportWait(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterGuardianClick",
    phase: "wait-after-guardian-click",
    guardianArrivalDeadlineMs: getGuardianTeleportRetryDeadlineMs(clickedAtMs, travel),
    guardianClickDistancePx: travel.distancePx,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    unknownRewardNextGuardianSlot: getOppositeGuardianSlot(target.slot),
    missingGuardianGreenTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

async function runWaitAfterGuardianClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
  activeRuneTemplates: GuardianOfTheRiftRuneTemplate[],
): Promise<BotState> {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  if (!state.guardianCoordinateConfirmed && nowMs < state.guardianArrivalDeadlineMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
  const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
  if (nearestYellow) {
    const confirmedState = state.guardianCoordinateConfirmed
      ? state
      : {
          ...state,
          guardianCoordinateConfirmed: true,
          missingGuardianYellowTicks: 0,
        };

    if (!state.guardianCoordinateConfirmed) {
      log(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
          `Altar marker visible before region confirmation completed; skipping coordinate wait. Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
        ),
      );
    } else if (state.missingGuardianYellowTicks > 0) {
      log(
        stepMessage(
          WORKFLOW_STEPS.FIND_ALTAR,
          `Altar marker found after ${state.missingGuardianYellowTicks} retry tick(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
        ),
      );
    }

    return clickGuardianAltarMarker(confirmedState, captureBounds, playerAnchor, nearestYellow);
  }

  const guardianLocation = hasLeftGuardianCraftingChunk(tickCapture.bitmap);

  if (!guardianLocation.left) {
    const guardianTargetSelection = selectGuardianTravelTarget(
      tickCapture.bitmap,
      config,
      activeRuneTemplates,
      state.unknownRewardNextGuardianSlot,
    );
    if (guardianTargetSelection.target) {
      const target = guardianTargetSelection.target;
      if (!isGuardianClickPointSafelyOnScreen(tickCapture.bitmap, target.clickPoint)) {
        const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
        const rotated = tapKey(GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY);
        warn(
          stepMessage(
            WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
            `Still in crafting region after guardian travel deadline, but ${target.slot} guardian (${target.runeMatch.rune}) click point local=(${target.clickPoint.centerX},${target.clickPoint.centerY}) is too close to the screen edge for a safe re-click; bounds=(${target.marker.minX},${target.marker.minY})-${target.marker.maxX},${target.marker.maxY}. ${rotated ? `Tapped '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}'` : "Waiting"} before retry ${missingGuardianYellowTicks}.`,
          ),
        );

        return {
          ...state,
          missingGuardianYellowTicks,
          actionLockUntilMs: nowMs + GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
        };
      }

      const travel = estimateTravelWaitTicks(playerAnchor, target.clickPoint);
      const clicked = clickScreenPoint(
        captureBounds.x + target.clickPoint.centerX,
        captureBounds.y + target.clickPoint.centerY,
        captureBounds,
      );
      const clickedAtMs = Date.now();
      log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_GUARDIAN,
          `Still in crafting region after guardian travel deadline: chunk=${guardianLocation.chunkId ?? "unknown"} region=${guardianLocation.regionId ?? "unknown"} matched='${guardianLocation.matchedLine ?? "null"}'; re-clicked ${target.slot} guardian (${target.runeMatch.rune}, marker=${target.colorHex}/${target.color}) at (${clicked.x},${clicked.y}) local=(${target.clickPoint.centerX},${target.clickPoint.centerY}) bounds=(${target.marker.minX},${target.marker.minY})-${target.marker.maxX},${target.marker.maxY} pixels=${target.marker.pixelCount}; rewardPoints=${formatRewardPoints(guardianTargetSelection.rewardPoints)} preference=${guardianTargetSelection.preferenceOrder.join("->")} nextUnknown=${getOppositeGuardianSlot(target.slot)}; ${formatGuardianTeleportWait(travel)}.`,
        ),
      );

      return {
        ...state,
        guardianArrivalDeadlineMs: getGuardianTeleportRetryDeadlineMs(clickedAtMs, travel),
        guardianClickDistancePx: travel.distancePx,
        guardianCoordinateConfirmed: false,
        guardianAltarStartLocation: null,
        unknownRewardNextGuardianSlot: getOppositeGuardianSlot(target.slot),
        actionLockUntilMs: clickedAtMs + GUARDIAN_CLICK_LOCK_TICKS * GAME_TICK_MS,
      };
    }

    const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
    if (missingGuardianYellowTicks === 1 || missingGuardianYellowTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
          `Teleport out of crafting region not confirmed yet; current chunk=${guardianLocation.chunkId ?? "unknown"} region=${guardianLocation.regionId ?? "unknown"} matched='${guardianLocation.matchedLine ?? "null"}'. No enabled guardian target is available for re-click; rewardPoints=${formatRewardPoints(guardianTargetSelection.rewardPoints)} preference=${guardianTargetSelection.preferenceOrder.join("->")}; active elemental=${formatActiveGuardianRuneMatch(guardianTargetSelection.elementalRune)}, catalytic=${formatActiveGuardianRuneMatch(guardianTargetSelection.catalyticRune)}; skipped=${guardianTargetSelection.skippedReasons.join("; ") || "none"}; greenCandidates=${formatColoredMarkerCandidates(guardianTargetSelection.greenCandidates)}, catalyticCandidates=${formatColoredMarkerCandidates(guardianTargetSelection.catalyticCandidates)}.`,
        ),
      );
    }

    return {
      ...state,
      missingGuardianYellowTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
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

  log(stepMessage(WORKFLOW_STEPS.FIND_ALTAR, "Searching for altar marker."));
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
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  return confirmedState;
}

function clickGuardianAltarMarker(
  state: BotState,
  captureBounds: ScreenCaptureBounds,
  playerAnchor: { centerX: number; centerY: number },
  nearestYellow: GuardianOfTheRiftAltarDetection,
): BotState {
  const altarStartLocation = state.guardianAltarStartLocation;
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
    ...state,
    currentFunction: "waitAfterGuardianYellowClick",
    phase: "wait-after-guardian-yellow-click",
    guardianCoordinateConfirmed: true,
    guardianYellowArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    guardianYellowTravelEstimate: travel,
    guardianYellowCorrectionRecordedDeadlineMs: null,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventory.count === 0) {
    const correctedState = recordAltarDistanceTileCorrectionIfNeeded(state, tickCapture.bitmap);
    const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
    const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
    if (!nearestYellow) {
      const missingGuardianYellowTicks = correctedState.missingGuardianYellowTicks + 1;
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
          ...correctedState,
          inventoryFreeSlots: inventory.count,
          missingGuardianYellowTicks,
          actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      const message = stepMessage(
        WORKFLOW_STEPS.MOVE_TO_ALTAR,
        `Inventory free-space is still 0, but no altar marker was found after ${missingGuardianYellowTicks} check(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}. Stopping bot.`,
      );
      warn(message);
      notifyUserAndStop(message);
      return {
        ...correctedState,
        inventoryFreeSlots: inventory.count,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (correctedState.missingGuardianYellowTicks > 0) {
      log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_ALTAR,
          `Altar marker found after ${correctedState.missingGuardianYellowTicks} retry tick(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
        ),
      );
    }

    const altarStartLocation = readGuardianCoordinateLocation(tickCapture.bitmap) ?? correctedState.guardianAltarStartLocation;
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
      ...correctedState,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      missingGuardianYellowTicks: 0,
      guardianYellowArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
      guardianYellowTravelEstimate: travel,
      guardianYellowCorrectionRecordedDeadlineMs: null,
      guardianAltarStartLocation: altarStartLocation,
      actionLockUntilMs: clickedAtMs + GUARDIAN_YELLOW_CLICK_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  if (shouldEmptyPouchesAtAltar(state)) {
    const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
    const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
    if (!nearestYellow) {
      const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
      if (missingGuardianYellowTicks <= GUARDIAN_ALTAR_SEARCH_RETRY_TICKS) {
        warn(
          stepMessage(
            WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
            `Inventory free-space changed to ${inventory.count} after first altar click and pouches were filled this cycle, but altar marker is not visible yet. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
          ),
        );

        return {
          ...state,
          inventoryFreeSlots: inventory.count,
          missingInventoryCountTicks: 0,
          missingGuardianYellowTicks,
          actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      const message = stepMessage(
        WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
        `Inventory free-space changed to ${inventory.count} after first altar click and pouches were filled this cycle, but no altar marker was found after ${missingGuardianYellowTicks} check(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}. Stopping bot.`,
      );
      warn(message);
      notifyUserAndStop(message);
      return {
        ...state,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: 0,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    const rememberedPouches = getRememberedPouchLocations(state);
    setAutomateBotCurrentStep(STEP_ALTAR_POUCHES_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
        `Inventory free-space changed to ${inventory.count} after first altar click and ${rememberedPouches.length} remembered pouch(es) were filled this cycle; emptying pouches one per game tick before clicking altar a second time.`,
      ),
    );

    return {
      ...state,
      currentFunction: "emptyPouchesAtAltar",
      phase: "empty-pouches-at-altar",
      pouchClickQueue: rememberedPouches,
      pouchClickIndex: 0,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      missingGuardianYellowTicks: 0,
      actionLockUntilMs: 0,
    };
  }

  const baselineState = withPostAltarInventoryBaseline(state, inventory.count);

  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_PORTAL,
      `Inventory free-space changed to ${inventory.count}; saved as altar baseline before switching to ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal search. Inventory history=${formatInventoryHistory(baselineState.inventoryHistory)}.`,
    ),
  );

  return {
    ...baselineState,
    currentFunction: "findReturnPortal",
    phase: "find-return-portal",
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: 0,
    missingGuardianReturnRedTicks: 0,
    guardianYellowTravelEstimate: null,
    guardianYellowCorrectionRecordedDeadlineMs: null,
    returnPortalRecoveryTarget: null,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function runEmptyPouchesAtAltarTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  if (state.pouchClickIndex < state.pouchClickQueue.length) {
    return clickNextRememberedPouchBatch(state, captureBounds, nowMs, WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR);
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
  const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
  if (!nearestYellow) {
    const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
    if (missingGuardianYellowTicks <= GUARDIAN_ALTAR_SEARCH_RETRY_TICKS) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
          `Finished pouch clicks, but altar marker is not visible for the second altar click. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}.`,
        ),
      );

      return {
        ...state,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    const message = stepMessage(
      WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
      `Finished pouch clicks, but no altar marker was found after ${missingGuardianYellowTicks} check(s). Candidates=${formatGuardianOfTheRiftAltarCandidates(altarCandidates)}. Stopping bot.`,
    );
    warn(message);
    notifyUserAndStop(message);
    return {
      ...state,
      missingGuardianYellowTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
      `Finished emptying ${state.pouchClickQueue.length} remembered pouch(es); clicking altar a second time before return-portal search.`,
    ),
  );

  return clickGuardianAltarMarker(
    {
      ...state,
      ...resetPouchClickQueue(),
      missingGuardianYellowTicks: 0,
      altarPouchesEmptiedThisCycle: true,
    },
    captureBounds,
    playerAnchor,
    nearestYellow,
  );
}

function transitionToReturnPortalRecoveryState(
  state: BotState,
  nowMs: number,
  target: ReturnPortalRecoveryTarget,
  reason: string,
): BotState {
  log(stepMessage(WORKFLOW_STEPS.FIND_PORTAL, reason));
  return {
    ...state,
    currentFunction: "findReturnPortal",
    phase: "find-return-portal",
    returnPortalRecoveryTarget: target,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingGuardianReturnRedTicks: 0,
    missingFinalPortalTicks: 0,
    missingPortalExitTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
    const returnReason = state.returnPortalRecoveryTarget ? "after salmon portal recovery" : "after inventory emptied";

    warn(
      stepMessage(
        WORKFLOW_STEPS.FIND_PORTAL,
        `No ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker was found ${returnReason}; ${rotated ? `tapped '${GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY}'` : `could not tap '${GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY}'`} to rotate camera before retry ${missingGuardianReturnRedTicks}. Candidates=${formatColoredMarkerCandidates(portalCandidates)}.`,
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
    returnPortalRecoveryTarget: null,
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

function transitionToPendingPostReturnDepositState(state: BotState, nowMs: number, reason: string): BotState {
  const baseState: BotState = {
    ...state,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: 0,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
    missingPortalMiningMagentaTicks: 0,
    missingPortalExitTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };

  if (state.postPortalDepositResume === "greatGuardian") {
    setAutomateBotCurrentStep(STEP_GREAT_GUARDIAN_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
        `${reason} Resuming the pending Great Guardian deposit instead of falling back to workbench.`,
      ),
    );
    return {
      ...baseState,
      currentFunction: "findGreatGuardian",
      phase: "find-great-guardian",
      greatGuardianArrivalDeadlineMs: 0,
      greatGuardianClickDistancePx: null,
      missingGreatGuardianTicks: 0,
      missingInventoryCountTicks: 0,
    };
  }

  if (state.postPortalDepositResume === "chargedCell") {
    setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
        `${reason} Resuming the pending charged cell deposit instead of falling back to workbench.`,
      ),
    );
    return {
      ...baseState,
      currentFunction: "findChargedCellDeposit",
      phase: "find-charged-cell-deposit",
      chargedCellDepositArrivalDeadlineMs: 0,
      chargedCellDepositClickDistancePx: null,
      chargedCellDepositPlayerTileFallbackPending: false,
      missingChargedCellDepositTicks: 0,
      missingInventoryCountTicks: 0,
    };
  }

  return transitionToWorkbenchState(
    {
      ...baseState,
      actionLockUntilMs: 0,
    },
    `${reason} Falling back to workbench loop.`,
  );
}

function transitionToPostPortalDepositResumeState(state: BotState, nowMs: number): BotState {
  const baseState: BotState = {
    ...state,
    inventoryFreeSlots: 0,
    portalMiningArrivalDeadlineMs: 0,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingPortalMiningMagentaTicks: 0,
    missingPortalExitTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };

  if (state.postPortalDepositResume === "greatGuardian") {
    setAutomateBotCurrentStep(STEP_GREAT_GUARDIAN_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
        "Portal mining finished before Great Guardian deposit was completed; depositing Great Guardian before green guardian teleport.",
      ),
    );
    return {
      ...baseState,
      currentFunction: "findGreatGuardian",
      phase: "find-great-guardian",
      greatGuardianArrivalDeadlineMs: 0,
      greatGuardianClickDistancePx: null,
      missingGreatGuardianTicks: 0,
      missingInventoryCountTicks: 0,
    };
  }

  if (state.postPortalDepositResume === "chargedCell") {
    setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
        "Portal mining finished before charged cell deposit was completed; depositing charged cell before green guardian teleport.",
      ),
    );
    return {
      ...baseState,
      currentFunction: "findChargedCellDeposit",
      phase: "find-charged-cell-deposit",
      chargedCellDepositArrivalDeadlineMs: 0,
      chargedCellDepositClickDistancePx: null,
      chargedCellDepositPlayerTileFallbackPending: false,
      missingChargedCellDepositTicks: 0,
      missingInventoryCountTicks: 0,
    };
  }

  return transitionToGuardianTravelState(
    baseState,
    "Portal return confirmed; searching for the green guardian outline.",
  );
}

async function runWaitAfterGuardianReturnClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const cameraReset = tapKey(POST_RETURN_CAMERA_NORTH_KEY);
  const returnedState: BotState = {
    ...state,
    returnPortalRecoveryTarget: null,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    missingGuardianReturnRedTicks: 0,
    actionLockUntilMs: 0,
  };

  if (state.returnPortalRecoveryTarget === "finalPortal") {
    log(
      stepMessage(
        WORKFLOW_STEPS.TELEPORT_BACK,
        `Return teleport confirmed after salmon recovery: region=${location.regionId} chunk=${location.chunkId} matched='${location.matchedLine}'. ${cameraReset ? "Camera reset to north" : "Camera north reset skipped"} before retrying salmon portal flow.`,
      ),
    );
    return transitionToFinalPortalWaitState(
      {
        ...returnedState,
        finalPortalArrivalDeadlineMs: 0,
        finalPortalTeleportGraceDeadlineMs: 0,
        finalPortalClickDistancePx: null,
        missingFinalPortalOpenIconTicks: 0,
        missingFinalPortalTicks: 0,
        missingPortalMiningMagentaTicks: 0,
      },
      `Returned to region ${GUARDIAN_CRAFTING_REGION_ID} after salmon portal recovery; waiting for salmon portal availability.`,
    );
  }

  if (state.returnPortalRecoveryTarget === "portalExit") {
    log(
      stepMessage(
        WORKFLOW_STEPS.TELEPORT_BACK,
        `Return teleport confirmed after salmon exit recovery: region=${location.regionId} chunk=${location.chunkId} matched='${location.matchedLine}'. ${cameraReset ? "Camera reset to north" : "Camera north reset skipped"} before repeating guardian click flow.`,
      ),
    );
    return transitionToPostPortalDepositResumeState({
      ...returnedState,
      inventoryFreeSlots: 0,
      portalMiningArrivalDeadlineMs: 0,
      portalExitArrivalDeadlineMs: 0,
      portalExitClickDistancePx: null,
      missingPortalMiningMagentaTicks: 0,
      missingPortalExitTicks: 0,
    }, nowMs);
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.TELEPORT_BACK,
      `Return teleport confirmed: region=${location.regionId} chunk=${location.chunkId} matched='${location.matchedLine}'. ${cameraReset ? "Camera reset to north" : "Camera north reset skipped"} before continuing to post-return deposits.`,
    ),
  );
  return transitionToGreatGuardianState(returnedState);
}

function runFindGreatGuardianTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
  if (portalOpenIcon.isOpen && state.postPortalDepositResume !== "greatGuardian") {
    return transitionToFinalPortalSearchState(
      {
        ...state,
        postPortalDepositResume: "greatGuardian",
        openPortalAfterCurrentPostReturnAction: false,
        missingGreatGuardianTicks: 0,
        missingFinalPortalOpenIconTicks: 0,
        missingFinalPortalTicks: 0,
      },
      nowMs,
      `Open portal icon detected before Great Guardian click at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); taking salmon portal now and saving Great Guardian plus charged-cell deposit for after portal mining.`,
    );
  }

  const currentState = state;
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllGreatGuardianBlueObjects(tickCapture.bitmap);
  const greatGuardian = pickLargestColoredMarker(candidates);
  if (!greatGuardian) {
    const missingGreatGuardianTicks = currentState.missingGreatGuardianTicks + 1;
    if (missingGreatGuardianTicks === 1 || missingGreatGuardianTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
          `No blue great guardian outline found yet. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingGreatGuardianTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const clickPoint = pickColoredOutlineClickPoint(tickCapture.bitmap, greatGuardian, isGreatGuardianBluePixel);
  const travel = estimateTravelWaitTicks(playerAnchor, clickPoint);
  const clicked = clickScreenPoint(captureBounds.x + clickPoint.centerX, captureBounds.y + clickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
      `Clicked interior of blue great guardian outline at (${clicked.x},${clicked.y}) local=(${clickPoint.centerX},${clickPoint.centerY}) bounds=(${greatGuardian.minX},${greatGuardian.minY})-${greatGuardian.maxX},${greatGuardian.maxY} pixels=${greatGuardian.pixelCount}; checking inventory until travel deadline (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...currentState,
    currentFunction: "waitAfterGreatGuardianClick",
    phase: "wait-after-great-guardian-click",
    greatGuardianArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    greatGuardianClickDistancePx: travel.distancePx,
    missingGreatGuardianTicks: 0,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: 0,
  };
}

function runWaitAfterGreatGuardianClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    state,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
    "the great guardian click",
  );
  const inventoryAfterClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryAfterClick.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.greatGuardianArrivalDeadlineMs) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
          `Great guardian inventory was unreadable before travel deadline expired. Re-clicking great guardian.`,
        ),
      );
      return {
        ...currentState,
        currentFunction: "findGreatGuardian",
        phase: "find-great-guardian",
        greatGuardianArrivalDeadlineMs: 0,
        greatGuardianClickDistancePx: null,
        missingInventoryCountTicks: 0,
        missingGreatGuardianTicks: 0,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-great-guardian-inventory-after-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventoryAfterClick, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
          `Inventory free-space unreadable after great guardian click; checking again before travel deadline. Saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (currentState.inventoryFreeSlots === null) {
    const message = stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
      `Great guardian inventory verification is missing the saved altar baseline; current free-space=${inventoryAfterClick.count}. Stopping bot.`,
    );
    warn(message);
    notifyUserAndStop(message);
    return {
      ...currentState,
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const expectedInventoryFreeSlots = currentState.inventoryFreeSlots + 1;
  if (expectedInventoryFreeSlots > 28) {
    const message = stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
      `Great guardian inventory verification expected an impossible free-space count (${currentState.inventoryFreeSlots} + 1). Stopping bot.`,
    );
    warn(message);
    notifyUserAndStop(message);
    return {
      ...currentState,
      missingInventoryCountTicks: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventoryAfterClick.count !== expectedInventoryFreeSlots) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.greatGuardianArrivalDeadlineMs) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
          `Great guardian inventory did not reach expected free-space ${expectedInventoryFreeSlots} before travel deadline expired; got ${inventoryAfterClick.count} from altar baseline ${currentState.inventoryFreeSlots}. Re-clicking great guardian. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
        ),
      );
      return {
        ...currentState,
        currentFunction: "findGreatGuardian",
        phase: "find-great-guardian",
        greatGuardianArrivalDeadlineMs: 0,
        greatGuardianClickDistancePx: null,
        missingInventoryCountTicks: 0,
        missingGreatGuardianTicks: 0,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
          `Great guardian inventory check is not ready yet: expected free-space ${expectedInventoryFreeSlots} from altar baseline ${currentState.inventoryFreeSlots}, got ${inventoryAfterClick.count}. Checking again before travel deadline. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const verifiedState = withInventoryCheckpoint(
    {
      ...currentState,
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      greatGuardianArrivalDeadlineMs: 0,
      greatGuardianClickDistancePx: null,
    },
    "great-guardian",
    inventoryAfterClick.count,
    currentState.inventoryFreeSlots,
    expectedInventoryFreeSlots,
    true,
    "expected +1 after Great Guardian",
    {
      ...currentState.postAltarInventoryLedger,
      greatGuardianFreeSlots: inventoryAfterClick.count,
    },
  );

  if (verifiedState.postPortalDepositResume === "greatGuardian") {
    setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
        `Post-portal Great Guardian deposit verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Depositing charged cell before green guardian teleport. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
      ),
    );
    return {
      ...verifiedState,
      currentFunction: "findChargedCellDeposit",
      phase: "find-charged-cell-deposit",
      postPortalDepositResume: "chargedCell",
      actionLockUntilMs: 0,
      chargedCellDepositPlayerTileFallbackPending: false,
      missingChargedCellDepositTicks: 0,
    };
  }

  if (verifiedState.openPortalAfterCurrentPostReturnAction) {
    return transitionToFinalPortalSearchState(
      {
        ...verifiedState,
        postPortalDepositResume: "chargedCell",
      },
      nowMs,
      `Great guardian inventory verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Open portal was already detected, going to salmon portal before charged cell deposit. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
    );
  }

  setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
      `Great guardian inventory verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Searching for charged cell deposit marker. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
    ),
  );
  return {
    ...verifiedState,
    currentFunction: "findChargedCellDeposit",
    phase: "find-charged-cell-deposit",
    actionLockUntilMs: 0,
    chargedCellDepositPlayerTileFallbackPending: false,
    missingChargedCellDepositTicks: 0,
  };
}

function runFindChargedCellDepositTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    state,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
    "the charged cell deposit",
  );
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllChargedCellDepositObjects(tickCapture.bitmap);
  const chargedCellDeposit = pickNearestColoredMarker(candidates, playerAnchor);
  if (!chargedCellDeposit) {
    if (currentState.chargedCellDepositPlayerTileFallbackPending) {
      const playerTile = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      if (playerTile) {
        const clicked = clickScreenPoint(captureBounds.x + playerTile.centerX, captureBounds.y + playerTile.centerY, captureBounds);
        const clickedAtMs = Date.now();
        log(
          stepMessage(
            WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
            `Charged-cell deposit retry could not find the purple marker after a failed deposit; clicked under the player cyan tile at (${clicked.x},${clicked.y}) local=(${playerTile.centerX},${playerTile.centerY}) bounds=(${playerTile.x},${playerTile.y})-(${playerTile.x + playerTile.width - 1},${playerTile.y + playerTile.height - 1}) pixels=${playerTile.pixelCount}. Checking inventory for ${CHARGED_CELL_DEPOSIT_PLAYER_TILE_VERIFY_TICKS} game tick(s).`,
          ),
        );

        return {
          ...currentState,
          currentFunction: "waitAfterChargedCellDepositClick",
          phase: "wait-after-charged-cell-deposit-click",
          chargedCellDepositArrivalDeadlineMs: clickedAtMs + CHARGED_CELL_DEPOSIT_PLAYER_TILE_VERIFY_TICKS * GAME_TICK_MS,
          chargedCellDepositClickDistancePx: 0,
          chargedCellDepositPlayerTileFallbackPending: false,
          missingChargedCellDepositTicks: 0,
          missingInventoryCountTicks: 0,
          actionLockUntilMs: 0,
        };
      }
    }

    const missingChargedCellDepositTicks = currentState.missingChargedCellDepositTicks + 1;
    const rotated = tapKey(CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_KEY);
    if (missingChargedCellDepositTicks === 1 || missingChargedCellDepositTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
          `No charged cell deposit marker found yet${currentState.chargedCellDepositPlayerTileFallbackPending ? ", and the player cyan tile fallback was unavailable" : ""}; ${rotated ? `tapped '${CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_KEY}'` : `could not tap '${CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_KEY}'`} to rotate camera before retry ${missingChargedCellDepositTicks}. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingChargedCellDepositTicks,
      actionLockUntilMs: nowMs + CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const chargedCellDepositClickPoint = getBoundsCenterRightPoint(chargedCellDeposit);
  const travel = estimateTravelWaitTicks(playerAnchor, chargedCellDepositClickPoint);
  const clicked = clickScreenPoint(
    captureBounds.x + chargedCellDepositClickPoint.centerX,
    captureBounds.y + chargedCellDepositClickPoint.centerY,
    captureBounds,
  );
  const clickedAtMs = Date.now();
  const cameraPrepared = tapKey(CHARGED_CELL_TO_RUNE_CAMERA_KEY);
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
      `Clicked center-right of charged cell deposit marker at (${clicked.x},${clicked.y}) local=(${chargedCellDepositClickPoint.centerX},${chargedCellDepositClickPoint.centerY}) bounds=(${chargedCellDeposit.minX},${chargedCellDeposit.minY})-(${chargedCellDeposit.maxX},${chargedCellDeposit.maxY}) pixels=${chargedCellDeposit.pixelCount}; ${cameraPrepared ? `tapped '${CHARGED_CELL_TO_RUNE_CAMERA_KEY}'` : `could not tap '${CHARGED_CELL_TO_RUNE_CAMERA_KEY}'`} to prepare rune deposit camera; checking inventory until travel deadline (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...currentState,
    currentFunction: "waitAfterChargedCellDepositClick",
    phase: "wait-after-charged-cell-deposit-click",
    chargedCellDepositArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    chargedCellDepositClickDistancePx: travel.distancePx,
    chargedCellDepositPlayerTileFallbackPending: false,
    missingChargedCellDepositTicks: 0,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: 0,
  };
}

function runWaitAfterChargedCellDepositClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    state,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
    "the charged cell deposit",
  );
  const inventoryAfterClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryAfterClick.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.chargedCellDepositArrivalDeadlineMs) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
          `Inventory free-space was unreadable before charged-cell deposit travel deadline expired. Re-clicking charged cell deposit; if the purple marker is hidden under the player, the retry will click the player cyan tile.`,
        ),
      );
      return {
        ...currentState,
        currentFunction: "findChargedCellDeposit",
        phase: "find-charged-cell-deposit",
        chargedCellDepositArrivalDeadlineMs: 0,
        chargedCellDepositClickDistancePx: null,
        chargedCellDepositPlayerTileFallbackPending: true,
        missingInventoryCountTicks: 0,
        missingChargedCellDepositTicks: 0,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-charged-cell-deposit-inventory-after-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventoryAfterClick, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
          `Inventory free-space unreadable after charged cell deposit click; checking again before travel deadline. Saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (currentState.inventoryFreeSlots === null) {
    const message = stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
      `Charged cell deposit inventory verification is missing the great guardian baseline; current free-space=${inventoryAfterClick.count}. Stopping bot.`,
    );
    warn(message);
    notifyUserAndStop(message);
    return {
      ...currentState,
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const expectedInventoryFreeSlots = currentState.inventoryFreeSlots + 1;
  if (expectedInventoryFreeSlots > 28) {
    const message = stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
      `Charged cell deposit inventory verification expected an impossible free-space count (${currentState.inventoryFreeSlots} + 1). Stopping bot.`,
    );
    warn(message);
    notifyUserAndStop(message);
    return {
      ...currentState,
      missingInventoryCountTicks: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventoryAfterClick.count !== expectedInventoryFreeSlots) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.chargedCellDepositArrivalDeadlineMs) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
          `Charged cell deposit inventory did not reach expected free-space ${expectedInventoryFreeSlots} before travel deadline expired; got ${inventoryAfterClick.count} from guardian baseline ${currentState.inventoryFreeSlots}. Re-clicking charged cell deposit; if the purple marker is hidden under the player, the retry will click the player cyan tile. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
        ),
      );
      return {
        ...currentState,
        currentFunction: "findChargedCellDeposit",
        phase: "find-charged-cell-deposit",
        chargedCellDepositArrivalDeadlineMs: 0,
        chargedCellDepositClickDistancePx: null,
        chargedCellDepositPlayerTileFallbackPending: true,
        missingInventoryCountTicks: 0,
        missingChargedCellDepositTicks: 0,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
          `Charged cell deposit inventory check is not ready yet: expected free-space ${expectedInventoryFreeSlots} from guardian baseline ${currentState.inventoryFreeSlots}, got ${inventoryAfterClick.count}. Checking again before travel deadline. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const verifiedState = withInventoryCheckpoint(
    {
      ...currentState,
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      chargedCellDepositArrivalDeadlineMs: 0,
      chargedCellDepositClickDistancePx: null,
      chargedCellDepositPlayerTileFallbackPending: false,
    },
    "charged-cell-deposit",
    inventoryAfterClick.count,
    currentState.inventoryFreeSlots,
    expectedInventoryFreeSlots,
    true,
    "expected +1 after charged-cell deposit",
    {
      ...currentState.postAltarInventoryLedger,
      chargedCellDepositFreeSlots: inventoryAfterClick.count,
    },
  );

  if (verifiedState.postPortalDepositResume === "chargedCell") {
    return transitionToGuardianTravelState(
      {
        ...verifiedState,
        postPortalDepositResume: null,
        openPortalAfterCurrentPostReturnAction: false,
      },
      `Post-portal charged cell deposit verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Searching for the green guardian outline. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
    );
  }

  if (verifiedState.openPortalAfterCurrentPostReturnAction) {
    return transitionToFinalPortalSearchState(
      verifiedState,
      nowMs,
      `Charged cell deposit inventory verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Open portal was already detected, going to salmon portal before rune deposit. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
    );
  }

  setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
      `Charged cell deposit inventory verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Searching for rune deposit marker. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
    ),
  );
  return {
    ...verifiedState,
    currentFunction: "findRuneDeposit",
    phase: "find-rune-deposit",
    actionLockUntilMs: 0,
    missingRuneDepositTicks: 0,
  };
}

function transitionAfterRuneDepositVerified(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
  beforeFreeSlots: number,
  afterFreeSlots: number,
  reasonPrefix: string = "Rune deposit verified",
): BotState {
  const postRuneDepositState = withInventoryCheckpoint(
    {
      ...state,
      currentFunction: "waitAfterRuneDepositClick",
      phase: "wait-after-rune-deposit-click",
      actionLockUntilMs: 0,
      missingInventoryCountTicks: 0,
      runeDepositArrivalDeadlineMs: 0,
      runeDepositClickDistancePx: null,
      runeDepositInventoryFreeSlotsBeforeClick: beforeFreeSlots,
      finalPortalArrivalDeadlineMs: 0,
      finalPortalTeleportGraceDeadlineMs: 0,
      finalPortalClickDistancePx: null,
      portalMiningArrivalDeadlineMs: 0,
      portalExitArrivalDeadlineMs: 0,
      portalExitClickDistancePx: null,
      inventoryFreeSlots: afterFreeSlots,
      missingFinalPortalOpenIconTicks: 0,
      missingFinalPortalTicks: 0,
      missingPortalMiningMagentaTicks: 0,
      missingPortalExitTicks: 0,
    },
    "rune-deposit",
    afterFreeSlots,
    beforeFreeSlots,
    null,
    afterFreeSlots > beforeFreeSlots,
    reasonPrefix === "Rune deposit verified" ? "expected positive rune-deposit delta" : "late/manual positive rune-deposit delta",
    {
      ...state.postAltarInventoryLedger,
      runeDepositFreeSlots: afterFreeSlots,
    },
  );

  const cameraReset = tapKey(POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY);
  const depositSummary =
    `${reasonPrefix}: inventory free-space increased ${beforeFreeSlots} -> ${afterFreeSlots}. ${cameraReset ? `Tapped '${POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY}'` : `Could not tap '${POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY}'`} to reset camera north. Inventory history=${formatInventoryHistory(postRuneDepositState.inventoryHistory)}.`;
  const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);

  if (postRuneDepositState.openPortalAfterCurrentPostReturnAction || portalOpenIcon.isOpen) {
    return transitionToFinalPortalSearchState(
      postRuneDepositState,
      nowMs,
      postRuneDepositState.openPortalAfterCurrentPostReturnAction
        ? `${depositSummary} Open portal was already detected, searching for salmon portal.`
        : `${depositSummary} Open portal icon detected at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); taking precedence over time-since-portal color and searching for salmon portal.`,
    );
  }

  const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(tickCapture.bitmap);

  if (timeSincePortal.color === "green") {
    return transitionToWorkbenchState(
      postRuneDepositState,
      `${depositSummary} Time since portal is green (${formatTimeSincePortal(timeSincePortal)}); going to workbench.`,
    );
  }

  if (timeSincePortal.color === "yellow") {
    return transitionToFinalPortalWaitState(
      postRuneDepositState,
      `${depositSummary} Time since portal is yellow (${formatTimeSincePortal(timeSincePortal)}); waiting for salmon portal.`,
    );
  }

  const missingFinalPortalOpenIconTicks = state.missingFinalPortalOpenIconTicks + 1;
  if (missingFinalPortalOpenIconTicks === 1 || missingFinalPortalOpenIconTicks % 5 === 0) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `${depositSummary} Time since portal is ${formatTimeSincePortal(timeSincePortal)}; waiting for yellow=salmon or green=workbench (counts=${JSON.stringify(timeSincePortal.counts)}).`,
      ),
    );
  }

  return {
    ...postRuneDepositState,
    missingFinalPortalOpenIconTicks,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

async function runFindRuneDepositTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): Promise<BotState> {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    state,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
    "the rune deposit",
  );
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllRuneDepositObjects(tickCapture.bitmap);
  const runeDeposit = pickNearestColoredMarker(candidates, playerAnchor);
  if (!runeDeposit) {
    const missingRuneDepositTicks = currentState.missingRuneDepositTicks + 1;
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
      ...currentState,
      missingRuneDepositTicks,
      actionLockUntilMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    };
  }

  if (RUNE_DEPOSIT_PRE_CLICK_RECAPTURE_SETTLE_MS > 0) {
    await sleepWithAbort(RUNE_DEPOSIT_PRE_CLICK_RECAPTURE_SETTLE_MS, () => AppState.automateBotRunning);
    if (!AppState.automateBotRunning) {
      return currentState;
    }
  }

  const freshBitmap = captureScreenBitmap(captureBounds);
  const freshPlayerAnchor = getPlayerAnchor(freshBitmap);
  const freshCandidates = detectAllRuneDepositObjects(freshBitmap);
  const freshRuneDeposit = pickNearestColoredMarker(freshCandidates, freshPlayerAnchor);
  if (!freshRuneDeposit) {
    const missingRuneDepositTicks = currentState.missingRuneDepositTicks + 1;
    warn(
      stepMessage(
        WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
        `Rune deposit marker was visible in tick capture, but not in the just-in-time recapture after ${RUNE_DEPOSIT_PRE_CLICK_RECAPTURE_SETTLE_MS}ms. Retrying with a fresh screenshot. Previous candidates=${formatColoredMarkerCandidates(candidates)}, freshCandidates=${formatColoredMarkerCandidates(freshCandidates)}.`,
      ),
    );

    return {
      ...currentState,
      missingRuneDepositTicks,
      actionLockUntilMs: Date.now() + FAST_ACTION_RETRY_MS,
    };
  }

  const inventoryBeforeClick = detectInventoryCount(freshBitmap);
  if (inventoryBeforeClick.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-rune-deposit-inventory-before-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(freshBitmap, inventoryBeforeClick, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
          `Rune deposit marker found in just-in-time recapture, but inventory free-space is unreadable before Step 21; saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (currentState.inventoryFreeSlots !== null && inventoryBeforeClick.count > currentState.inventoryFreeSlots) {
    return transitionAfterRuneDepositVerified(
      currentState,
      Date.now(),
      { bitmap: freshBitmap },
      portalOpenIconTemplate,
      currentState.inventoryFreeSlots,
      inventoryBeforeClick.count,
      "Rune deposit completed before the retry click",
    );
  }

  const runeDepositClickPoint = getBoundsBottomCenterPoint(freshRuneDeposit);
  const travel = estimateTravelWaitTicks(freshPlayerAnchor, runeDepositClickPoint);
  const clicked = clickScreenPoint(captureBounds.x + runeDepositClickPoint.centerX, captureBounds.y + runeDepositClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
      `Clicked bottom-center of rune deposit marker from just-in-time recapture at (${clicked.x},${clicked.y}) local=(${runeDepositClickPoint.centerX},${runeDepositClickPoint.centerY}) bounds=(${freshRuneDeposit.minX},${freshRuneDeposit.minY})-${freshRuneDeposit.maxX},${freshRuneDeposit.maxY} pixels=${freshRuneDeposit.pixelCount}; inventory free-space before deposit=${inventoryBeforeClick.count}; checking inventory until travel deadline (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...currentState,
    currentFunction: "waitAfterRuneDepositClick",
    phase: "wait-after-rune-deposit-click",
    runeDepositArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    runeDepositClickDistancePx: travel.distancePx,
    runeDepositInventoryFreeSlotsBeforeClick: inventoryBeforeClick.count,
    missingInventoryCountTicks: 0,
    missingRuneDepositTicks: 0,
    actionLockUntilMs: 0,
  };
}

function runWaitAfterRuneDepositClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    state,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
    "the rune deposit",
  );
  const inventoryAfterClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryAfterClick.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.runeDepositArrivalDeadlineMs) {
      setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
          `Inventory free-space was unreadable before rune deposit travel deadline expired. Returning to Step 20 to retry the rune deposit.`,
        ),
      );
      return {
        ...currentState,
        currentFunction: "findRuneDeposit",
        phase: "find-rune-deposit",
        missingInventoryCountTicks: 0,
        runeDepositArrivalDeadlineMs: 0,
        runeDepositClickDistancePx: null,
        runeDepositInventoryFreeSlotsBeforeClick: null,
        missingRuneDepositTicks: 0,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-rune-deposit-inventory-after-${state.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventoryAfterClick, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
          `Inventory free-space unreadable after rune deposit click; checking again before travel deadline. Saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (currentState.runeDepositInventoryFreeSlotsBeforeClick === null) {
    setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `Rune deposit inventory verification is missing the before snapshot; current free-space=${inventoryAfterClick.count}. Returning to Step 20.`,
      ),
    );
    return {
      ...currentState,
      currentFunction: "findRuneDeposit",
      phase: "find-rune-deposit",
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      runeDepositInventoryFreeSlotsBeforeClick: null,
      missingRuneDepositTicks: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventoryAfterClick.count <= currentState.runeDepositInventoryFreeSlotsBeforeClick) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs < currentState.runeDepositArrivalDeadlineMs) {
      if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 5 === 0) {
        warn(
          stepMessage(
            WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
            `Rune deposit inventory check is not ready yet: expected free-space above ${currentState.runeDepositInventoryFreeSlotsBeforeClick}, got ${inventoryAfterClick.count}. Checking again before travel deadline. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
          ),
        );
      }

      return {
        ...currentState,
        inventoryFreeSlots: inventoryAfterClick.count,
        missingInventoryCountTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `Rune deposit did not increase inventory free-space before travel deadline expired (${currentState.runeDepositInventoryFreeSlotsBeforeClick} -> ${inventoryAfterClick.count}). Returning to Step 20 to retry the rune deposit. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
      ),
    );
    return {
      ...currentState,
      currentFunction: "findRuneDeposit",
      phase: "find-rune-deposit",
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      runeDepositInventoryFreeSlotsBeforeClick: null,
      missingRuneDepositTicks: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  return transitionAfterRuneDepositVerified(
    currentState,
    nowMs,
    tickCapture,
    portalOpenIconTemplate,
    currentState.runeDepositInventoryFreeSlotsBeforeClick,
    inventoryAfterClick.count,
  );
}

function transitionToFinalPortalWaitState(state: BotState, reason: string): BotState {
  setAutomateBotCurrentStep(STEP_FINAL_PORTAL_ID);
  log(stepMessage(WORKFLOW_STEPS.WAIT_FOR_FINAL_PORTAL_ICON, reason));
  return {
    ...state,
    currentFunction: "waitForFinalPortalOpenIcon",
    phase: "wait-for-final-portal-open-icon",
    actionLockUntilMs: 0,
    openPortalAfterCurrentPostReturnAction: false,
    portalMiningPouchesFilledThisCycle: false,
    finalPortalClickReadyAtMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
  };
}

function transitionToFinalPortalSearchState(state: BotState, nowMs: number, reason: string): BotState {
  setAutomateBotCurrentStep(STEP_FINAL_PORTAL_ID);
  log(stepMessage(WORKFLOW_STEPS.WAIT_FOR_FINAL_PORTAL_ICON, reason));
  return {
    ...state,
    currentFunction: "findFinalPortal",
    phase: "find-final-portal",
    openPortalAfterCurrentPostReturnAction: false,
    portalMiningPouchesFilledThisCycle: false,
    missingFinalPortalOpenIconTicks: 0,
    finalPortalClickReadyAtMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    missingFinalPortalTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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

  const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
  if (!portalOpenIcon.isOpen) {
    const missingFinalPortalOpenIconTicks = state.missingFinalPortalOpenIconTicks + 1;
    if (missingFinalPortalOpenIconTicks === 1 || missingFinalPortalOpenIconTicks % 5 === 0) {
      const bestScore = portalOpenIcon.matches[0]?.score;
      warn(
        stepMessage(
          WORKFLOW_STEPS.WAIT_FOR_FINAL_PORTAL_ICON,
          `Open portal icon is not visible yet; waiting before portal search (attempt=${missingFinalPortalOpenIconTicks}, bestScore=${bestScore === undefined ? "none" : bestScore.toFixed(3)}, cache=${portalOpenIcon.cache.source}).`,
        ),
      );
    }

    return {
      ...state,
      missingFinalPortalOpenIconTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  return transitionToFinalPortalSearchState(
    state,
    nowMs,
    `Open portal icon detected at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); checking for ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker.`,
  );
}

function runFindFinalPortalTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
  const finalPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!finalPortal) {
    const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
    const location = readCoordinateOverlayLocation(tickCapture.bitmap, currentWindowsScalePercent);
    const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);

    if (!portalOpenIcon.isOpen && !isAtFinalPortalMiningTile(location) && miningStatus.status !== "mining") {
      return transitionToPendingPostReturnDepositState(
        state,
        nowMs,
        `Salmon portal marker not found and open-portal icon disappeared; not in mining zone (tile=${formatGuardianCoordinateLocation(location)}, ${formatMiningStatus(miningStatus)}).`,
      );
    }

    const missingFinalPortalTicks = state.missingFinalPortalTicks + 1;
    const rotated = tapKey(GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY);
    if (missingFinalPortalTicks === 1 || missingFinalPortalTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_FINAL_PORTAL,
          `No ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker found yet; ${rotated ? `tapped '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'` : `could not tap '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'`} to rotate camera before retry ${missingFinalPortalTicks}. Candidates=${formatGuardianOfTheRiftPortalCandidates(portalCandidates)}.`,
        ),
      );
    }

    return {
      ...state,
      missingFinalPortalTicks,
      finalPortalClickReadyAtMs: 0,
      actionLockUntilMs: nowMs + GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  if (state.finalPortalClickReadyAtMs === 0) {
    const readyAtMs = nowMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_FINAL_PORTAL,
        `${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} salmon portal marker found at local=(${finalPortal.centerX},${finalPortal.centerY}); waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before clicking.`,
      ),
    );

    return {
      ...state,
      finalPortalClickReadyAtMs: readyAtMs,
      missingFinalPortalTicks: 0,
      actionLockUntilMs: readyAtMs,
    };
  }

  if (nowMs < state.finalPortalClickReadyAtMs) {
    return {
      ...state,
      actionLockUntilMs: state.finalPortalClickReadyAtMs,
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
    finalPortalClickReadyAtMs: 0,
    finalPortalArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: travel.distancePx,
    missingFinalPortalTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function isAtFinalPortalMiningTile(location: GuardianCoordinateLocation | null): boolean {
  return location?.x === FINAL_PORTAL_MINING_TILE_X && location.y === FINAL_PORTAL_MINING_TILE_Y;
}

function isInPortalMiningZoneChunk(location: GuardianCoordinateLocation | null): boolean {
  return location !== null && PORTAL_MINING_ZONE_CHUNK_IDS.some((chunkId) => chunkId === location.chunkId);
}

function formatGuardianCoordinateLocation(location: GuardianCoordinateLocation | null): string {
  if (!location) {
    return "unreadable";
  }

  return `${location.x},${location.y},${location.z ?? "?"}`;
}

function markOpenPortalAfterCurrentPostReturnAction(
  state: BotState,
  tickCapture: TickCapture,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
  step: (typeof WORKFLOW_STEPS)[keyof typeof WORKFLOW_STEPS],
  actionDescription: string,
): BotState {
  if (state.openPortalAfterCurrentPostReturnAction) {
    return state;
  }

  const location = readGuardianCoordinateLocation(tickCapture.bitmap);
  if (!location || location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    return state;
  }

  const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
  if (!portalOpenIcon.isOpen) {
    return state;
  }

  log(
    stepMessage(
      step,
      `Open portal icon detected in region ${location.regionId} at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); finishing ${actionDescription}, then going to salmon portal.`,
    ),
  );

  return {
    ...state,
    openPortalAfterCurrentPostReturnAction: true,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
  };
}

function clickPortalMiningMarker(
  state: BotState,
  captureBounds: ScreenCaptureBounds,
  playerAnchor: { centerX: number; centerY: number },
  miningTarget: ColoredMarkerDetection,
  location: GuardianCoordinateLocation | null,
  reason: string,
): BotState {
  const travel = estimateTravelWaitTicks(playerAnchor, miningTarget);
  const clicked = clickScreenPoint(captureBounds.x + miningTarget.centerX, captureBounds.y + miningTarget.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_PORTAL_MINING,
      `${reason}; clicked ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker at (${clicked.x},${clicked.y}) local=(${miningTarget.centerX},${miningTarget.centerY}) bounds=(${miningTarget.minX},${miningTarget.minY})-(${miningTarget.maxX},${miningTarget.maxY}) pixels=${miningTarget.pixelCount}; tile=${formatGuardianCoordinateLocation(location)}; waiting before monitoring inventory (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "portalMining",
    phase: "portal-mining",
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    missingPortalMiningMagentaTicks: 0,
    missingInventoryCountTicks: 0,
    inventoryFreeSlots: null,
    craftingInventoryChangeDeadlineMs: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function transitionToFinalPortalArrivalRecoveryState(state: BotState, nowMs: number, reason: string): BotState {
  setAutomateBotCurrentStep(STEP_FINAL_PORTAL_ID);
  warn(stepMessage(WORKFLOW_STEPS.RECOVER_FINAL_PORTAL_ARRIVAL, reason));
  return {
    ...state,
    currentFunction: "recoverFinalPortalArrival",
    phase: "recover-final-portal-arrival",
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    missingPortalMiningMagentaTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function runWaitAfterFinalPortalClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.finalPortalArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const location = readCoordinateOverlayLocation(tickCapture.bitmap, currentWindowsScalePercent);
  if (location && location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    return transitionToFinalPortalArrivalRecoveryState(
      state,
      nowMs,
      `Salmon portal travel read outside region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} raw='${location.matchedLine}'. Entering salmon-arrival recovery instead of red-portal recovery; each rotation will check for tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} and the ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker.`,
    );
  }

  if (!isAtFinalPortalMiningTile(location)) {
    const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
    const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);
    const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
    const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
    const retryPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);

    if (retryPortal) {
      if (state.finalPortalClickReadyAtMs === 0) {
        const readyAtMs = nowMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
        log(
          stepMessage(
            WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
            `Salmon portal arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} is not confirmed yet; ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} retry portal marker is visible at local=(${retryPortal.centerX},${retryPortal.centerY}). Waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before re-clicking.`,
          ),
        );

        return {
          ...state,
          finalPortalClickReadyAtMs: readyAtMs,
          actionLockUntilMs: readyAtMs,
        };
      }

      if (nowMs < state.finalPortalClickReadyAtMs) {
        return {
          ...state,
          actionLockUntilMs: state.finalPortalClickReadyAtMs,
        };
      }

      const travel = estimateTravelWaitTicks(playerAnchor, retryPortal);
      const clicked = clickScreenPoint(captureBounds.x + retryPortal.centerX, captureBounds.y + retryPortal.centerY, captureBounds);
      const clickedAtMs = Date.now();
      log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
          `Salmon portal arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} is not confirmed yet (current tile=${formatGuardianCoordinateLocation(location)} raw='${location?.matchedLine ?? "unreadable"}'); re-clicked ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${retryPortal.centerX},${retryPortal.centerY}) bounds=(${retryPortal.minX},${retryPortal.minY})-${retryPortal.maxX},${retryPortal.maxY} pixels=${retryPortal.pixelCount}; waiting again before checking the magenta mining marker (${formatTravelEstimate(travel)}).`,
        ),
      );

      return {
        ...state,
        currentFunction: "waitAfterFinalPortalClick",
        phase: "wait-after-final-portal-click",
        finalPortalClickReadyAtMs: 0,
        finalPortalArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
        finalPortalTeleportGraceDeadlineMs: 0,
        finalPortalClickDistancePx: travel.distancePx,
        missingFinalPortalTicks: 0,
        missingPortalMiningMagentaTicks: 0,
        actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
      };
    }

    if (!portalOpenIcon.isOpen && miningStatus.status !== "mining") {
      const graceDeadlineMs =
        state.finalPortalTeleportGraceDeadlineMs > 0
          ? state.finalPortalTeleportGraceDeadlineMs
          : nowMs + FINAL_PORTAL_TELEPORT_CONFIRM_GRACE_TICKS * GAME_TICK_MS;
      const missingPortalMiningMagentaTicks = state.missingPortalMiningMagentaTicks + 1;

      if (nowMs < graceDeadlineMs) {
        if (state.finalPortalTeleportGraceDeadlineMs === 0 || missingPortalMiningMagentaTicks % 5 === 0) {
          warn(
            stepMessage(
              WORKFLOW_STEPS.CHECK_PORTAL_MINING_MAGENTA,
              `Open-portal icon disappeared before arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} was confirmed; waiting ${Math.ceil((graceDeadlineMs - nowMs) / GAME_TICK_MS)} more game tick(s) for teleport/coordinate update. Current tile=${formatGuardianCoordinateLocation(location)}, ${formatMiningStatus(miningStatus)}.`,
            ),
          );
        }

        return {
          ...state,
          finalPortalTeleportGraceDeadlineMs: graceDeadlineMs,
          missingPortalMiningMagentaTicks,
          actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      return transitionToPendingPostReturnDepositState(
        state,
        nowMs,
        `Salmon portal travel did not reach tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} and open-portal icon disappeared; current tile=${formatGuardianCoordinateLocation(location)}, ${formatMiningStatus(miningStatus)}.`,
      );
    }

    const missingPortalMiningMagentaTicks = state.missingPortalMiningMagentaTicks + 1;
    if (missingPortalMiningMagentaTicks === 1 || missingPortalMiningMagentaTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.CHECK_PORTAL_MINING_MAGENTA,
          `Waiting for salmon portal arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} before magenta search; current tile=${formatGuardianCoordinateLocation(location)} raw='${location?.matchedLine ?? "unreadable"}'.`,
        ),
      );
    }

    return {
      ...state,
      finalPortalTeleportGraceDeadlineMs: 0,
      missingPortalMiningMagentaTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const magentaObjects = detectAllPortalMiningMagentaObjects(tickCapture.bitmap, PORTAL_MINING_MAGENTA_MIN_PIXELS);
  const miningTarget = pickNearestColoredMarker(magentaObjects, playerAnchor);
  if (miningTarget) {
    return clickPortalMiningMarker(
      state,
      captureBounds,
      playerAnchor,
      miningTarget,
      location,
      `Portal arrival confirmed at tile ${formatGuardianCoordinateLocation(location)} and ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker is visible`,
    );
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.CHECK_PORTAL_MINING_MAGENTA,
      `Portal travel wait complete at tile ${formatGuardianCoordinateLocation(location)}, but no clickable ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker is visible yet. Candidates=${formatColoredMarkerCandidates(magentaObjects)}. Continuing marker search (distance=${state.finalPortalClickDistancePx === null ? "unknown" : `${Math.round(state.finalPortalClickDistancePx)}px`}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "findPortalMiningMagenta",
    phase: "find-portal-mining-magenta",
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    missingPortalMiningMagentaTicks: 0,
    actionLockUntilMs: 0,
  };
}

function runRecoverFinalPortalArrivalTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const location = readCoordinateOverlayLocation(tickCapture.bitmap, currentWindowsScalePercent);
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const magentaObjects = detectAllPortalMiningMagentaObjects(tickCapture.bitmap, PORTAL_MINING_MAGENTA_MIN_PIXELS);
  const miningTarget = pickNearestColoredMarker(magentaObjects, playerAnchor);
  if (isAtFinalPortalMiningTile(location) && miningTarget) {
    return clickPortalMiningMarker(
      state,
      captureBounds,
      playerAnchor,
      miningTarget,
      location,
      `Salmon-arrival recovery confirmed tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} and ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker`,
    );
  }

  const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);
  if (isAtFinalPortalMiningTile(location) && miningStatus.status === "mining") {
    log(
      stepMessage(
        WORKFLOW_STEPS.RECOVER_FINAL_PORTAL_ARRIVAL,
        `Salmon-arrival recovery confirmed tile ${formatGuardianCoordinateLocation(location)} and mining status is already green (${formatMiningStatus(miningStatus)}); monitoring portal mining inventory.`,
      ),
    );

    return {
      ...state,
      currentFunction: "portalMining",
      phase: "portal-mining",
      finalPortalArrivalDeadlineMs: 0,
      finalPortalTeleportGraceDeadlineMs: 0,
      finalPortalClickDistancePx: null,
      portalMiningArrivalDeadlineMs: 0,
      missingPortalMiningMagentaTicks: 0,
      missingInventoryCountTicks: 0,
      inventoryFreeSlots: null,
      craftingInventoryChangeDeadlineMs: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
  const retryPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!isAtFinalPortalMiningTile(location) && retryPortal) {
    if (state.finalPortalClickReadyAtMs === 0) {
      const readyAtMs = nowMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
      log(
        stepMessage(
          WORKFLOW_STEPS.RECOVER_FINAL_PORTAL_ARRIVAL,
          `Salmon-arrival recovery sees ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} retry portal marker at local=(${retryPortal.centerX},${retryPortal.centerY}); waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before re-clicking.`,
        ),
      );

      return {
        ...state,
        finalPortalClickReadyAtMs: readyAtMs,
        actionLockUntilMs: readyAtMs,
      };
    }

    if (nowMs < state.finalPortalClickReadyAtMs) {
      return {
        ...state,
        actionLockUntilMs: state.finalPortalClickReadyAtMs,
      };
    }

    const travel = estimateTravelWaitTicks(playerAnchor, retryPortal);
    const clicked = clickScreenPoint(captureBounds.x + retryPortal.centerX, captureBounds.y + retryPortal.centerY, captureBounds);
    const clickedAtMs = Date.now();
    log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
        `Salmon-arrival recovery did not confirm tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} yet (current tile=${formatGuardianCoordinateLocation(location)} raw='${location?.matchedLine ?? "unreadable"}'); re-clicked ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${retryPortal.centerX},${retryPortal.centerY}) bounds=(${retryPortal.minX},${retryPortal.minY})-${retryPortal.maxX},${retryPortal.maxY} pixels=${retryPortal.pixelCount}; waiting again before recovery checks (${formatTravelEstimate(travel)}).`,
      ),
    );

    return {
      ...state,
      currentFunction: "waitAfterFinalPortalClick",
      phase: "wait-after-final-portal-click",
      finalPortalClickReadyAtMs: 0,
      finalPortalArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
      finalPortalTeleportGraceDeadlineMs: 0,
      finalPortalClickDistancePx: travel.distancePx,
      missingFinalPortalTicks: 0,
      missingPortalMiningMagentaTicks: 0,
      actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const missingPortalMiningMagentaTicks = state.missingPortalMiningMagentaTicks + 1;
  const rotated = tapKey(GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY);
  if (missingPortalMiningMagentaTicks === 1 || missingPortalMiningMagentaTicks % 5 === 0) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.RECOVER_FINAL_PORTAL_ARRIVAL,
        `Salmon-arrival recovery did not confirm both tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} and ${PORTAL_MINING_MARKER_COLOR_HEX} mining marker yet; current tile=${formatGuardianCoordinateLocation(location)} region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} raw='${location?.matchedLine ?? "unreadable"}', miningCandidates=${formatColoredMarkerCandidates(magentaObjects)}, portalCandidates=${formatGuardianOfTheRiftPortalCandidates(portalCandidates)}, ${formatMiningStatus(miningStatus)}. ${rotated ? `Tapped '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'` : `Could not tap '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'`} before retry ${missingPortalMiningMagentaTicks}.`,
      ),
    );
  }

  return {
    ...state,
    missingPortalMiningMagentaTicks,
    actionLockUntilMs: nowMs + GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
  captureBounds: ScreenCaptureBounds,
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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventory.count === 0) {
    const rememberedPouches = getRememberedPouchLocations(state);
    if (!state.portalMiningPouchesFilledThisCycle && rememberedPouches.length > 0) {
      setAutomateBotCurrentStep(STEP_FILL_POUCHES_ID);
      log(
        stepMessage(
          WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
          `Inventory is full after portal mining and ${rememberedPouches.length} remembered pouch(es) are available; filling pouches one per game tick before reclicking the magenta mining marker.`,
        ),
      );

      return {
        ...state,
        currentFunction: "fillPouchesAfterPortalMiningFull",
        phase: "fill-pouches-after-portal-mining-full",
        pouchClickQueue: rememberedPouches,
        pouchClickIndex: 0,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: 0,
        missingPortalMiningMagentaTicks: 0,
        craftingInventoryChangeDeadlineMs: 0,
        portalMiningPouchesFilledThisCycle: true,
        actionLockUntilMs: 0,
      };
    }

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
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
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
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function runFillPouchesAfterPortalMiningFullTick(
  state: BotState,
  nowMs: number,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  if (state.pouchClickIndex < state.pouchClickQueue.length) {
    const nextState = clickNextRememberedPouchBatch(state, captureBounds, nowMs, WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL);
    if (nextState.pouchClickIndex < nextState.pouchClickQueue.length) {
      return nextState;
    }

    const filledPouchCount = nextState.pouchClickQueue.length;
    log(
      stepMessage(
        WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
        `Finished filling ${filledPouchCount} remembered pouch(es); waiting one game tick before returning to magenta mining marker search to reclick mining.`,
      ),
    );

    return {
      ...nextState,
      ...resetPouchClickQueue(),
      currentFunction: "findPortalMiningMagenta",
      phase: "find-portal-mining-magenta",
      inventoryFreeSlots: null,
      missingInventoryCountTicks: 0,
      missingPortalMiningMagentaTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      actionLockUntilMs: nowMs + POUCH_POST_SEQUENCE_SETTLE_MS,
    };
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
      `Finished filling ${state.pouchClickQueue.length} remembered pouch(es); returning to magenta mining marker search to reclick mining.`,
    ),
  );

  return {
    ...state,
    ...resetPouchClickQueue(),
    currentFunction: "findPortalMiningMagenta",
    phase: "find-portal-mining-magenta",
    inventoryFreeSlots: null,
    missingInventoryCountTicks: 0,
    missingPortalMiningMagentaTicks: 0,
    craftingInventoryChangeDeadlineMs: 0,
    actionLockUntilMs: 0,
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

  const location = readGuardianCoordinateLocation(tickCapture.bitmap);
  if (location && location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    return transitionToReturnPortalRecoveryState(
      state,
      nowMs,
      "portalExit",
      `While searching for the salmon exit portal, coordinate read outside region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} raw='${location.matchedLine}'. Finding ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal to return.`,
    );
  }

  if (location && !isInPortalMiningZoneChunk(location)) {
    log(
      stepMessage(
        WORKFLOW_STEPS.REPEAT_GUARDIAN_CLICK,
        `While searching for the salmon exit portal, coordinate already confirms we left portal mining: tile=${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId} raw='${location.matchedLine}'. Resuming post-portal flow.`,
      ),
    );
    return transitionToPostPortalDepositResumeState(state, nowMs);
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
  const exitPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!exitPortal) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.REPEAT_GUARDIAN_CLICK,
        `Salmon exit portal marker is no longer visible while searching exit; treating portal mining as exited. Last coordinate=${formatGuardianCoordinateLocation(location)} region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} raw='${location?.matchedLine ?? "unreadable"}'. Resuming post-portal flow.`,
      ),
    );
    return transitionToPostPortalDepositResumeState(state, nowMs);
  }

  if (state.portalExitClickReadyAtMs === 0) {
    const readyAtMs = nowMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_PORTAL_EXIT,
        `${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} salmon exit portal marker found at local=(${exitPortal.centerX},${exitPortal.centerY}); waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before clicking.`,
      ),
    );

    return {
      ...state,
      portalExitClickReadyAtMs: readyAtMs,
      missingPortalExitTicks: 0,
      actionLockUntilMs: readyAtMs,
    };
  }

  if (nowMs < state.portalExitClickReadyAtMs) {
    return {
      ...state,
      actionLockUntilMs: state.portalExitClickReadyAtMs,
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
    portalExitClickReadyAtMs: 0,
    portalExitArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    portalExitClickDistancePx: travel.distancePx,
    missingPortalExitTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runWaitAfterPortalExitClickTick(state: BotState, nowMs: number, tickCapture: TickCapture): BotState {
  if (nowMs < state.portalExitArrivalDeadlineMs) {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const location = readGuardianCoordinateLocation(tickCapture.bitmap);
  if (!location) {
    const missingPortalExitTicks = state.missingPortalExitTicks + 1;
    if (missingPortalExitTicks === 1 || missingPortalExitTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_PORTAL_EXIT,
          `Portal exit not confirmed yet; coordinate overlay is unreadable. Waiting for chunk to leave portal-mining zone (${PORTAL_MINING_ZONE_CHUNK_IDS.join(",")}).`,
        ),
      );
    }

    return {
      ...state,
      missingPortalExitTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    return transitionToReturnPortalRecoveryState(
      state,
      nowMs,
      "portalExit",
      `Salmon exit portal landed outside region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} raw='${location.matchedLine}'. Finding ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal to return.`,
    );
  }

  if (isInPortalMiningZoneChunk(location)) {
    const missingPortalExitTicks = state.missingPortalExitTicks + 1;
    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_PORTAL_EXIT,
        `Still in portal-mining zone after salmon portal click: tile=${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId} raw='${location.matchedLine}'. Searching for the salmon exit portal again.`,
      ),
    );

    return {
      ...state,
      currentFunction: "findPortalExit",
      phase: "find-portal-exit",
      portalExitArrivalDeadlineMs: 0,
      portalExitClickDistancePx: null,
      missingPortalExitTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.REPEAT_GUARDIAN_CLICK,
      `Portal return confirmed outside mining zone at tile=${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId}; repeating guardian click flow (distance=${state.portalExitClickDistancePx === null ? "unknown" : `${Math.round(state.portalExitClickDistancePx)}px`}).`,
    ),
  );

  return transitionToPostPortalDepositResumeState(state, nowMs);
}

async function runLoop(
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
  pouchTemplates: GuardianOfTheRiftPouchTemplate[],
  activeRuneTemplates: GuardianOfTheRiftRuneTemplate[],
): Promise<void> {
  if (isLoopRunning) {
    log("Loop already running.");
    return;
  }

  isLoopRunning = true;
  const worldMapper = ENABLE_WORLD_MAPPER
    ? createAsyncWorldMapper({
        botId: RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID,
        outputRootPath: AppState.outputFolderPath,
      })
    : null;

  if (worldMapper) {
    log(`World mapper enabled: observations=${worldMapper.observationFilePath}.`);
  }

  try {
    const startupBitmap = captureScreenBitmap(captureBounds);
    const pouchInventory = detectStartupPouchInventory(startupBitmap, captureBounds, pouchTemplates, Date.now());
    const startupRewardPoints = detectGuardianOfTheRiftRewardPoints(startupBitmap);
    log(`Startup reward points: ${formatRewardPoints(startupRewardPoints)}.`);
    const distanceCalibration = calibrateDistanceTilePx(startupBitmap);
    const distanceHistory = recordGuardianOfTheRiftDistanceTileStartupObservation({
      bitmap: startupBitmap,
      context: {
        monitorTier: currentMonitorTier,
        windowsScalePercent: currentWindowsScalePercent,
      },
      startupCalibration: distanceCalibration,
      minTilePx: FREE_MOVE_TILE_PX_MIN,
      maxTilePx: FREE_MOVE_TILE_PX_MAX,
    });
    currentDistanceTilePx = distanceHistory.tilePx;
    log(
      `Distance tile calibration: usedTilePx=${distanceHistory.tilePx}px source=${distanceHistory.source} startupTilePx=${distanceHistory.startupTilePx}px startupSource=${distanceCalibration.source} observedModeTilePx=${distanceHistory.observedModeTilePx ?? "unavailable"}px learnedTilePx=${distanceHistory.learnedTilePx ?? "unavailable"}px startupObservations=${distanceHistory.startupObservationCount} correctionObservations=${distanceHistory.correctionObservationCount} correctionDebt=${distanceHistory.correctionDebt}/${DISTANCE_TILE_CORRECTION_THRESHOLD} botRawTilePx=${distanceCalibration.botRawTilePx ?? "unavailable"}px managerRawTilePx=${distanceCalibration.managerRawTilePx ?? "unavailable"}px trustedRawRange=${STARTUP_RAW_TILE_PX_MIN_TRUSTED}-${STARTUP_RAW_TILE_PX_MAX_TRUSTED}px fallbackTilePx=${FREE_MOVE_TILE_PX_FALLBACK}px history=${distanceHistory.path}.`,
    );
    const initialState = createStartupInitialState(startupBitmap, pouchInventory);

    await runBotEngine<BotState, EngineFunctionKey, TickCapture>({
      tickMs: BOT_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: () => initialState,
      captureTick: ({ state, nowMs }) => captureGuardianTick(state, nowMs, captureBounds),
      observeTick: ({ state, nowMs, tickCapture }) => {
        if (!ENABLE_COORDINATE_AUTO_SCREENSHOTS || state.loopIndex % COORDINATE_AUTO_SCREENSHOT_INTERVAL_TICKS !== 0) {
          if (!worldMapper || state.loopIndex % WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS !== 0) {
            return;
          }
        }

        if (worldMapper && state.loopIndex % WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS === 0) {
          const observation = readWorldMapObservationFromBitmap({
            bitmap: tickCapture.bitmap,
            observedAtMs: nowMs,
            windowsScalePercent: currentWindowsScalePercent,
          });
          if (observation) {
            worldMapper.enqueueObservation(observation, {
              screenshotBitmap: tickCapture.bitmap,
            });

            if (state.loopIndex === WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS || state.loopIndex % WORLD_MAPPER_LOG_INTERVAL_TICKS === 0) {
              log(
                `World mapper observation: matched='${observation.matchedLine}' regionId=${observation.tile.regionId} chunkId=${observation.tile.chunkId} worldChunk=${observation.tile.worldChunkX},${observation.tile.worldChunkY}.`,
              );
            }
          } else if (state.loopIndex === WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS || state.loopIndex % WORLD_MAPPER_LOG_INTERVAL_TICKS === 0) {
            warn(`World mapper observation unreadable at loop #${state.loopIndex}.`);
          }
        }

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
        waitAfterAgilityMiningYellowClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-agility-mining-yellow-click"
            ? runWaitAfterAgilityMiningYellowClickTick(state, nowMs, tickCapture, captureBounds)
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
          return state.phase === "crafting" ? runCraftingTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        fillPouchesAfterWorkbenchFull: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "fill-pouches-after-workbench-full"
            ? runFillPouchesAfterWorkbenchFullTick(state, nowMs, captureBounds)
            : state;
        },
        travelToGuardian: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "travel-to-guardian"
            ? runTravelToGuardianTick(state, nowMs, tickCapture, captureBounds, config, activeRuneTemplates)
            : state;
        },
        waitAfterGuardianClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-guardian-click"
            ? runWaitAfterGuardianClickTick(state, nowMs, tickCapture, captureBounds, config, activeRuneTemplates)
            : state;
        },
        waitAfterGuardianYellowClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-guardian-yellow-click"
            ? runWaitAfterGuardianYellowClickTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        emptyPouchesAtAltar: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "empty-pouches-at-altar"
            ? runEmptyPouchesAtAltarTick(state, nowMs, tickCapture, captureBounds)
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
            ? runWaitAfterGuardianReturnClickTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
            : state;
        },
        findGreatGuardian: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-great-guardian"
            ? runFindGreatGuardianTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
            : state;
        },
        waitAfterGreatGuardianClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-great-guardian-click"
            ? runWaitAfterGreatGuardianClickTick(state, nowMs, tickCapture, portalOpenIconTemplate)
            : state;
        },
        findChargedCellDeposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-charged-cell-deposit"
            ? runFindChargedCellDepositTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
            : state;
        },
        waitAfterChargedCellDepositClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-charged-cell-deposit-click"
            ? runWaitAfterChargedCellDepositClickTick(state, nowMs, tickCapture, portalOpenIconTemplate)
            : state;
        },
        findRuneDeposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-rune-deposit"
            ? runFindRuneDepositTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
            : state;
        },
        waitAfterRuneDepositClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-rune-deposit-click"
            ? runWaitAfterRuneDepositClickTick(state, nowMs, tickCapture, portalOpenIconTemplate)
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
            ? runFindFinalPortalTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
            : state;
        },
        waitAfterFinalPortalClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-final-portal-click"
            ? runWaitAfterFinalPortalClickTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
            : state;
        },
        recoverFinalPortalArrival: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "recover-final-portal-arrival"
            ? runRecoverFinalPortalArrivalTick(state, nowMs, tickCapture, captureBounds)
            : state;
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
          return state.phase === "portal-mining" ? runPortalMiningTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        fillPouchesAfterPortalMiningFull: ({ state, nowMs }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "fill-pouches-after-portal-mining-full"
            ? runFillPouchesAfterPortalMiningFullTick(state, nowMs, captureBounds)
            : state;
        },
        findPortalExit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-portal-exit" ? runFindPortalExitTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        waitAfterPortalExitClick: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "wait-after-portal-exit-click"
            ? runWaitAfterPortalExitClickTick(state, nowMs, tickCapture)
            : state;
        },
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[${formatElapsedSinceStart()}] #${state.loopIndex} [${state.phase}] tick error - ${message}`);
      },
    });
  } finally {
    if (worldMapper) {
      try {
        await worldMapper.stop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`World mapper flush failed: ${message}`);
      }
    }
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
  const disabledGuardianElements = Object.entries(config.activeGuardianElements)
    .filter(([, enabled]) => !enabled)
    .map(([element]) => element);
  log(
    `Config: botTick=${BOT_TICK_MS}ms, gameTick=${GAME_TICK_MS}ms, fastRetry=${FAST_ACTION_RETRY_MS}ms, preDecisionCaptureSettle=${PRE_DECISION_CAPTURE_SETTLE_MS}ms, startup-phase-check=on, agility-course=${config.useAgilityCourse ? "on" : "off"}.`,
  );
  log(
    `Active guardian config: disabled=${disabledGuardianElements.length > 0 ? disabledGuardianElements.join(",") : "none"}.`,
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
    `Capture: ${captureBounds.width}x${captureBounds.height}, display=${currentMonitorTier}-${currentWindowsScalePercent}, coordinate-auto-screenshot=${ENABLE_COORDINATE_AUTO_SCREENSHOTS ? "on" : "off"}, world-mapper=${ENABLE_WORLD_MAPPER ? `on/${WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS} ticks` : "off"}.`,
  );
  log(`Portal-open icon cache: ${getGuardianOfTheRiftPortalOpenIconCachePath()}.`);

  void (async () => {
    try {
      await sleepWithAbort(STARTUP_SETTLE_MS, () => AppState.automateBotRunning);
      if (!AppState.automateBotRunning) {
        return;
      }

      const [portalOpenIconTemplate, pouchTemplates, activeRuneTemplates] = await Promise.all([
        loadGuardianOfTheRiftPortalOpenIconTemplate(),
        loadGuardianOfTheRiftPouchTemplatesFromDirectory(),
        loadGuardianOfTheRiftRuneTemplatesFromDirectory("test-images/icon/guardin-of-the-rift"),
      ]);
      log(
        `Portal-open icon reference loaded for Step 22 (${portalOpenIconTemplate.bitmap.width}x${portalOpenIconTemplate.bitmap.height}).`,
      );
      log(
        `Pouch references loaded for startup inventory check (${pouchTemplates.map((template) => `${template.pouch}=${template.bitmap.width}x${template.bitmap.height}`).join(", ")}).`,
      );
      log(
        `Active guardian rune references loaded (${activeRuneTemplates.map((template) => `${template.rune}=${template.bitmap.width}x${template.bitmap.height}`).join(", ")}).`,
      );
      await runLoop(captureBounds, config, portalOpenIconTemplate, pouchTemplates, activeRuneTemplates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Startup failed: ${message}`);
      notifyUserAndStop(message);
    }
  })();
}
