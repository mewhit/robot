import { screen as electronScreen } from "electron";
import { keyTap, keyToggle, mouseClick, moveMouse } from "robotjs";
import {
  rotateAutomateBotLogSession,
  setAutomateBotLogFooterProvider,
  type AutomateBotLogFooterContext,
} from "../automateBotLogs";
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
import {
  isGuardianOfTheRiftMovementModelTrainingKind,
  recordGuardianOfTheRiftMovementObservation,
  selectGuardianOfTheRiftMovementModel,
  type GuardianOfTheRiftMovementModelSelection,
  type GuardianOfTheRiftMovementModelThresholds,
  type GuardianOfTheRiftMovementObservationOutcome,
} from "./guardian-of-the-rift-movement-model";
import { createAsyncWorldMapper } from "./mapping/async-world-mapper";
import { readWorldMapObservationFromBitmap } from "./mapping/world-map-observation-reader";
import { readCoordinateOverlayLocation, saveCoordinateAutoScreenshot } from "./shared/coordinate-auto-screenshot";
import {
  detectGuardianOfTheRiftAltarMarkersInScreenshot,
  formatGuardianOfTheRiftAltarCandidates,
  formatGuardianOfTheRiftAltarDetectionDiagnostics,
  pickNearestGuardianOfTheRiftAltarMarker,
  type GuardianOfTheRiftAltarDetection,
} from "./shared/guardian-of-the-rift-altar-detector";
import {
  detectGuardianOfTheRiftPortalMarkersInScreenshot,
  formatGuardianOfTheRiftPortalCandidates,
  GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX,
  loadGuardianOfTheRiftPortalOpenIconTemplate,
  pickNearestGuardianOfTheRiftPortalMarker,
  type GuardianOfTheRiftPortalMarkerDetection,
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
  type GuardianOfTheRiftActiveRuneDetection,
  type GuardianOfTheRiftRuneMatch,
  type GuardianOfTheRiftRuneTemplate,
  type GuardianOfTheRiftSlot,
} from "./shared/guardian-of-the-rift-active-rune-detector";
import {
  detectGuardianOfTheRiftPowerBar,
  detectGuardianOfTheRiftRewardPoints,
  detectGuardianOfTheRiftTimeSincePortal,
  type GuardianOfTheRiftRewardPointsDetection,
  type GuardianOfTheRiftTimeSincePortalDetection,
} from "./shared/guardian-of-the-rift-panel-detector";
import { getGuardianOfTheRiftOverlayMode } from "./shared/guardian-of-the-rift-overlay-mode";
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
  | "find-portal-mining"
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
  | "findPortalMining"
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

type GuardianOfTheRiftPouchEssenceMemory = Record<GuardianOfTheRiftDetectablePouch, number | null>;

type PouchClickIntent = "fill" | "empty";

type PendingPouchClick = {
  intent: PouchClickIntent;
  pouch: GuardianOfTheRiftDetectablePouch;
  beforeFreeSlots: number;
};

type CachedMarker<T> = {
  marker: T;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  loopIndex: number;
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
  activeGuardianRuneSignature: string | null;
  activeGuardianRuneTimerStartedAtMs: number | null;
  activeGuardianRuneDeadlineMs: number | null;
  activeGuardianRuneLastObservedAtMs: number | null;
  activeGuardianRuneOverdueWarned: boolean;
  activeGuardianRuneTimerStartedFromObservedChange: boolean;
  altarCraftedRunesPendingLowerBound: number;
  altarCraftedRunesPendingUpperBound: number;
  altarCraftedRunesPendingSlotsFreed: number;
  altarCraftedRunesPendingAltarClicks: number;
  miningStatusGreenStartedAtMs: number | null;
  miningCameraKReadyAtMs: number;
  miningCameraKPrepared: boolean;
  miningAgilityCourseMarkerCache: CachedMarker<ColoredMarkerDetection> | null;
  inventoryFreeSlots: number | null;
  pouchInventory: GuardianOfTheRiftPouchInventoryMemory;
  pouchEssence: GuardianOfTheRiftPouchEssenceMemory;
  pouchClickQueue: GuardianOfTheRiftPouchLocation[];
  pouchClickIndex: number;
  pouchClickIntent: PouchClickIntent | null;
  pouchClickPending: PendingPouchClick | null;
  pouchClickBatchMovedEssence: number;
  pouchFillAvailableEssenceSlots: number | null;
  cachedWorkbenchMarker: WorkbenchMarkerDetection | null;
  cachedPortalMiningMarker: ColoredMarkerDetection | null;
  craftingPouchesFilledThisCycle: boolean;
  portalMiningPouchesFilledThisCycle: boolean;
  altarPouchesEmptiedThisCycle: boolean;
  endOfRoundDepositMode: boolean;
  endOfRoundSignalTicks: number;
  postAltarInventoryLedger: PostAltarInventoryLedger;
  inventoryHistory: InventoryHistoryEntry[];
  missingInventoryCountTicks: number;
  craftingInventoryChangeDeadlineMs: number;
  workbenchInventoryNoChangeWarnings: number;
  workbenchLooseEssenceCount: number;
  workbenchCameraNorthReadyAtMs: number;
  workbenchCameraNorthPreparedThisClick: boolean;
  guardianArrivalDeadlineMs: number;
  guardianClickDistancePx: number | null;
  guardianCoordinateConfirmed: boolean;
  guardianAltarStartLocation: GuardianCoordinateLocation | null;
  guardianYellowArrivalDeadlineMs: number;
  guardianYellowTravelEstimate: TravelWaitEstimate | null;
  guardianYellowCorrectionRecordedDeadlineMs: number | null;
  guardianAltarLowFreeSlotRetryCount: number;
  guardianAltarCameraLeftRotations: number;
  guardianAltarCameraUnwindReadyAtMs: number;
  guardianReturnArrivalDeadlineMs: number;
  guardianReturnClickDistancePx: number | null;
  returnPortalCameraNorthReadyAtMs: number;
  returnPortalCameraNorthPreparedThisClick: boolean;
  returnPortalLastBadCoordinateKey: string | null;
  returnPortalRepeatedBadCoordinateReads: number;
  unknownRewardNextGuardianSlot: GuardianOfTheRiftSlot;
  returnPortalRecoveryTarget: ReturnPortalRecoveryTarget | null;
  openPortalAfterCurrentPostReturnAction: boolean;
  postPortalDepositResume: PostPortalDepositResume | null;
  greatGuardianArrivalDeadlineMs: number;
  greatGuardianClickDistancePx: number | null;
  chargedCellDepositArrivalDeadlineMs: number;
  chargedCellDepositClickDistancePx: number | null;
  chargedCellToRuneCameraReadyAtMs: number;
  chargedCellDepositPlayerTileFallbackPending: boolean;
  runeDepositArrivalDeadlineMs: number;
  runeDepositClickDistancePx: number | null;
  runeDepositInventoryFreeSlotsBeforeClick: number | null;
  runeDepositMarkerCache: CachedMarker<ColoredMarkerDetection> | null;
  runeDepositCameraNorthReadyAtMs: number;
  runeDepositCameraNorthPreparedThisClick: boolean;
  finalPortalClickReadyAtMs: number;
  finalPortalArrivalDeadlineMs: number;
  finalPortalTeleportGraceDeadlineMs: number;
  finalPortalClickDistancePx: number | null;
  portalMiningArrivalDeadlineMs: number;
  portalMiningExitPortalMarkerCache: CachedMarker<GuardianOfTheRiftPortalMarkerDetection> | null;
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
  missingPortalMiningOrangeTicks: number;
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
  preferenceOrder: Array<GuardianOfTheRiftSlot | "optimizer-green">;
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
  baseWaitTicks: number;
  travelTicks: number;
  distancePx: number;
  distanceTiles: number;
  tilePx: number;
  dxPx: number;
  dyPx: number;
  targetYRatio: number | null;
  axisDominanceRatio: number;
  movementModelVersion: number;
  movementExtraWaitTicks: number;
  movementReasons: string[];
};

type PendingMovementObservation = {
  kind: string;
  step: string;
  clickedAtMs: number;
  travel: TravelWaitEstimate;
};

type StablePlayerAnchor = {
  centerX: number;
  centerY: number;
  source: "startup-player-box" | "startup-fallback" | "runtime-fallback";
  bitmapWidth: number;
  bitmapHeight: number;
};

type RunStatsTravelTimer = {
  pendingStartedAtMs: number | null;
  totalMs: number;
  maxMs: number;
  completions: number;
};

type GuardianRunStats = {
  startedAtMs: number;
  cleanComplete: boolean;
  stablePlayerAnchor: StablePlayerAnchor | null;
  activeGuardianRuneTimerSamples: number;
  activeGuardianRuneTimerTotalElapsedMs: number;
  activeGuardianRuneTimerMinElapsedMs: number | null;
  activeGuardianRuneTimerMaxElapsedMs: number;
  activeGuardianRuneTimerLateSamples: number;
  activeGuardianRuneTimerOverdueWarnings: number;
  altarRunesConfirmedCycles: number;
  altarRunesConfirmedLowerBound: number;
  altarRunesConfirmedUpperBound: number;
  altarRunesConfirmedMaxUpperBound: number;
  altarRunesPendingLowerBound: number;
  altarRunesPendingUpperBound: number;
  altarRunesPendingAltarClicks: number;
  greatGuardianClicks: number;
  greatGuardianVerified: number;
  greatGuardianLateReclicks: number;
  greatGuardianInventoryNotReady: number;
  workbenchClicks: number;
  workbenchFallbackCount: number;
  workbenchFallbackWaitMs: number;
  workbenchPouchReclickCycles: number;
  workbenchMaxDistancePx: number;
  workbenchDistanceOutliers: number;
  workbenchLastClickedAtMs: number | null;
  miningEndToWorkbench: RunStatsTravelTimer;
  redPortalSearchStartedAtMs: number | null;
  redPortalSearches: number;
  redPortalMisses: number;
  redPortalSearchTotalMs: number;
  redPortalSearchMaxMs: number;
  salmonPortalClicks: number;
  salmonRetrySignals: number;
  salmonValidation: RunStatsTravelTimer;
  chargedCellAttempts: number;
  chargedCellRetrySignals: number;
  chargedCellVerification: RunStatsTravelTimer;
  guardianNoTargetScans: number;
  guardianReclicks: number;
  guardianReclickNoTargetScans: number;
  movementLateByKind: Record<string, number>;
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
const ACTIVE_GUARDIAN_RUNE_TIMER_MS = 19_000;
const ACTIVE_GUARDIAN_RUNE_TIMER_LATE_TOLERANCE_MS = BOT_TICK_MS;
const ACTIVE_GUARDIAN_RUNE_TIMER_OVERDUE_GRACE_MS = BOT_TICK_MS;
const FAST_ACTION_RETRY_MS = 200;
const PRE_DECISION_CAPTURE_SETTLE_MS = 80;
const STARTUP_SETTLE_MS = 180;
const STARTUP_UI_PREP_SETTLE_MS = 200;
const STARTUP_CAMERA_NORTH_KEY = "n";
const STARTUP_INVENTORY_KEY = "escape";
const STARTUP_CAMERA_PITCH_UP_KEY = "w";
const STARTUP_CAMERA_PITCH_UP_HOLD_MS = 2_000;
const STARTUP_CAMERA_PITCH_SETTLE_MS = 120;
const STARTUP_COORDINATE_VALIDATION_DELAY_MS = BOT_TICK_MS;
const PLAYER_ANCHOR_FALLBACK_X_RATIO = 0.5;
const PLAYER_ANCHOR_FALLBACK_Y_RATIO = 0.52;
const STARTUP_PLAYER_ANCHOR_MIN_X_RATIO = 0.25;
const STARTUP_PLAYER_ANCHOR_MAX_X_RATIO = 0.75;
const STARTUP_PLAYER_ANCHOR_MIN_Y_RATIO = 0.35;
const STARTUP_PLAYER_ANCHOR_MAX_Y_RATIO = 0.7;
const POUCH_CAPACITY_BY_TYPE: Record<GuardianOfTheRiftDetectablePouch, number> = {
  small: 3,
  medium: 6,
  large: 9,
  giant: 12,
};
const POUCH_CLICK_LOCK_MS = BOT_TICK_MS;
const POUCH_POST_SEQUENCE_SETTLE_MS = GAME_TICK_MS;
const ALTAR_POUCH_EMPTY_FREE_SLOT_SLACK = 0;
const CLICK_SAFE_EDGE_MARGIN_PX = 3;
const PURE_RED_MIN_PIXEL_COUNT = 300;
const PURE_RED_MIN_COMPONENT_WIDTH_PX = 18;
const PURE_RED_MIN_COMPONENT_HEIGHT_PX = 18;
const PURE_RED_MAX_ASPECT_RATIO = 3;
const PURE_RED_MAX_COMPONENT_WIDTH_RATIO = 0.18;
const PURE_RED_MAX_COMPONENT_HEIGHT_RATIO = 0.18;
const RETURN_PORTAL_MARKER_COLOR_HEX = "FFFF0000";
const ELEMENTAL_GUARDIAN_MARKER_COLOR_HEX = "FF00FF00";
const CATALYTIC_GUARDIAN_MARKER_COLOR_HEX = "FF4169E1";
const GUARDIAN_OF_THE_RIFT_OVERLAY_MODE = getGuardianOfTheRiftOverlayMode();
const RETURN_PORTAL_RED_MIN_PIXELS = 300;
const RETURN_PORTAL_MIN_SIZE_TO_SCREEN_HEIGHT_RATIO = 0.018;
const RETURN_PORTAL_MAX_SIZE_TO_SCREEN_HEIGHT_RATIO = 0.085;
const RETURN_PORTAL_MIN_FILL_RATIO = 0.45;
const RETURN_PORTAL_MAX_ASPECT_RATIO = 1.8;
const PLAYER_TRAVEL_SPEED_TILES_PER_TICK = 2;
const TRAVEL_MIN_TICKS = 1;
const TRAVEL_EXTRA_WAIT_TICKS = 1;
const MOVEMENT_MODEL_VERSION = 1;
const MOVEMENT_MODEL_LONG_DISTANCE_TILES = 10;
const MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES = 16;
const MOVEMENT_MODEL_TOP_SCREEN_DISTANCE_TILES = 8;
const MOVEMENT_MODEL_TOP_SCREEN_Y_RATIO = 0.38;
const MOVEMENT_MODEL_AXIS_DOMINANCE_DISTANCE_TILES = 10;
const MOVEMENT_MODEL_AXIS_DOMINANCE_RATIO = 0.82;
const MOVEMENT_MODEL_MAX_EXTRA_WAIT_TICKS = 3;
const MOVEMENT_MODEL_THRESHOLDS: GuardianOfTheRiftMovementModelThresholds = {
  longDistanceTiles: MOVEMENT_MODEL_LONG_DISTANCE_TILES,
  veryLongDistanceTiles: MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES,
  topScreenDistanceTiles: MOVEMENT_MODEL_TOP_SCREEN_DISTANCE_TILES,
  topScreenYRatio: MOVEMENT_MODEL_TOP_SCREEN_Y_RATIO,
  axisDominanceDistanceTiles: MOVEMENT_MODEL_AXIS_DOMINANCE_DISTANCE_TILES,
  axisDominanceRatio: MOVEMENT_MODEL_AXIS_DOMINANCE_RATIO,
  maxExtraWaitTicks: MOVEMENT_MODEL_MAX_EXTRA_WAIT_TICKS,
};
const AGILITY_COURSE_TARGET_X = 3637;
const AGILITY_COURSE_TARGET_Y = 9503;
const AGILITY_COURSE_EXIT_TARGET_X = 3633;
const AGILITY_COURSE_EXIT_TARGET_Y = 9503;
const AGILITY_COURSE_MARKER_MIN_PIXELS = 50;
const AGILITY_CAMERA_NORTH_KEY = "n";
const PORTAL_MINING_MARKER_COLOR_HEX = "FFFF7300";
const PORTAL_MINING_ORANGE_MIN_PIXELS = 50;
const FINAL_PORTAL_MINING_TILE_X = 3592;
const FINAL_PORTAL_MINING_TILE_Y = 9503;
const PORTAL_MINING_ZONE_TILE_RADIUS_X = 8;
const PORTAL_MINING_ZONE_TILE_RADIUS_Y = 8;
const FINAL_PORTAL_TELEPORT_CONFIRM_GRACE_TICKS = 3;
const SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS = 1;
const SALMON_PORTAL_TO_MINING_VALIDATION_BUFFER_TICKS = 3;
const SALMON_PORTAL_STALLED_ARRIVAL_RECOVERY_TICKS = 10;
const SALMON_PORTAL_CLICK_RATIO_X = 0.5;
const AGILITY_EAST_CLICK_RATIO_X = 0.68;
const AGILITY_EAST_CLICK_RATIO_Y = 0.5;
const AGILITY_EAST_CLICK_LOCK_TICKS = 3;
const AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS = 1;
const AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS = 2;
const AGILITY_YELLOW_CLICK_EXTRA_BOT_TICKS = 6;
const WORKBENCH_WEST_CLICK_RATIO_X = 0.34;
const WORKBENCH_SOUTH_WEST_WEST_DISTANCE_RATIO_X = 0.3;
const WORKBENCH_SOUTH_WEST_WEST_DISTANCE_RATIO_Y = 0.2;
const WORKBENCH_SOUTH_WEST_WEST_MAX_SOUTH_OF_WEST_RATIO = 0.65;
const WORKBENCH_NORTH_WEST_DISTANCE_RATIO_X = 0.3;
const WORKBENCH_NORTH_WEST_DISTANCE_RATIO_Y = 0.18;
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
const RUNE_DEPOSIT_PRE_CLICK_RECAPTURE_SETTLE_MS = 200;
const RUNE_DEPOSIT_CLICK_RATIO_X = 0.65;
const RUNE_DEPOSIT_CLICK_RATIO_Y = 0.62;
const MARKER_CLICK_RANDOM_INSET_PX = 2;
const CENTER_MARKER_CLICK_RANDOM_SPAN_RATIO_X = 0.22;
const CENTER_MARKER_CLICK_RANDOM_SPAN_RATIO_Y = 0.22;
const SALMON_PORTAL_CLICK_RANDOM_SPAN_RATIO_X = 0.16;
const SALMON_PORTAL_CLICK_RANDOM_SPAN_RATIO_Y = 0.18;
const CHARGED_CELL_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_X = 0.18;
const CHARGED_CELL_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_Y = 0.24;
const RUNE_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_X = 0.18;
const RUNE_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_Y = 0.14;
const RUNE_DEPOSIT_MARKER_STABLE_DISTANCE_PX = 12;
const RUNE_DEPOSIT_MEDIUM_DISTANCE_TILES = 3;
const RUNE_DEPOSIT_LONG_DISTANCE_TILES = 7;
const CHARGED_CELL_DEPOSIT_CLICK_RATIO_X = 0.64;
const CHARGED_CELL_DEPOSIT_PLAYER_TILE_VERIFY_TICKS = 2;
const OBJECT_PRE_CLICK_MOUSE_SETTLE_MS = 50;
const DEPOSIT_PRE_CLICK_MOUSE_SETTLE_MS = OBJECT_PRE_CLICK_MOUSE_SETTLE_MS;
const ORANGE_MIN_PIXELS = 40;
const WORKBENCH_MAGENTA_MIN_PIXELS = 40;
const WORKBENCH_MAGENTA_MIN_WIDTH_PX = 24;
const WORKBENCH_MAGENTA_MIN_HEIGHT_PX = 24;
const WORKBENCH_MAGENTA_MIN_FILL_RATIO = 0.18;
const GREEN_MIN_PIXELS = 240;
const CATALYTIC_GUARDIAN_BLUE_MIN_PIXELS = 180;
const ACTIVE_GUARDIAN_MIN_WIDTH_PX = GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer" ? 65 : 80;
const ACTIVE_GUARDIAN_MIN_HEIGHT_PX = GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer" ? 70 : 80;
const ACTIVE_GUARDIAN_MIN_PIXELS = GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer" ? 1_500 : 2_500;
const ACTIVE_GUARDIAN_MIN_ASPECT_RATIO = 0.45;
const ACTIVE_GUARDIAN_MAX_ASPECT_RATIO = 2.8;
const GUARDIAN_BLACK_MAX_COMPONENT = 85;
const GUARDIAN_BLACK_MIN_EDGE_MARGIN_PX = 2;
const GREAT_GUARDIAN_BLUE_MIN_PIXELS = 120;
const CHARGED_CELL_DEPOSIT_PURPLE_MIN_PIXELS = 200;
const CHARGED_CELL_DEPOSIT_MIN_WIDTH_PX = 16;
const CHARGED_CELL_DEPOSIT_MIN_HEIGHT_PX = 16;
const CHARGED_CELL_DEPOSIT_MIN_FILL_RATIO = 0.2;
const CHARGED_CELL_DEPOSIT_MAX_ASPECT_RATIO = 3;
const RUNE_DEPOSIT_PINK_MIN_PIXELS = 40;
const MINING_ORANGE_RECLICK_MIN_DELAY_MS = 0;
const MINING_ORANGE_RECLICK_MAX_DELAY_MS = 3_000;
const OPTIMIZER_MINING_ORANGE_RECLICK_DELAY_MS = GAME_TICK_MS;
const WORKBENCH_CRAFT_CLICK_LOCK_TICKS = 3;
const GUARDIAN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_RECLICK_GRACE_TICKS = 2;
const GUARDIAN_TELEPORT_VALIDATION_EXTRA_BOT_TICKS = 2;
const GUARDIAN_YELLOW_CLICK_LOCK_TICKS = 2;
const GUARDIAN_RETURN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS = 2;
const GUARDIAN_GREEN_CLICK_TARGET_Y_RATIO = 0.5;
const GUARDIAN_COLORED_CLICK_TARGET_X_RATIO = 0.5;
const GUARDIAN_COLORED_CLICK_TARGET_Y_RATIO = 0.5;
const GUARDIAN_CLICK_SAFE_EDGE_MARGIN_PX = 24;
const UNCHARGED_CELL_CAMERA_ROTATE_KEY = "a";
const UNCHARGED_CELL_CAMERA_ROTATE_LOCK_TICKS = 1;
const GREAT_GUARDIAN_CLICK_TARGET_X_RATIO = 0.5;
const GREAT_GUARDIAN_CLICK_TARGET_Y_RATIO = 0.9;
const GREAT_GUARDIAN_CAMERA_ROTATE_KEY = "a";
const GREAT_GUARDIAN_CAMERA_ROTATE_LOCK_TICKS = 1;
const GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS = 1;
const GUARDIAN_ALTAR_SEARCH_RETRY_TICKS = 8;
const GUARDIAN_ALTAR_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_ALTAR_CAMERA_UNWIND_KEY = "d";
const GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS = 12;
const GUARDIAN_ALTAR_CAMERA_ROTATE_SETTLE_BOT_TICKS = 3;
const GUARDIAN_ALTAR_CAMERA_UNWIND_DELAY_TICKS = 1;
const GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_LOCK_TICKS = 1;
const RETURN_PORTAL_OCR_LOOP_GUARD_MIN_RETRIES = 3;
const RETURN_PORTAL_OCR_LOOP_GUARD_MIN_REPEATED_READS = 2;
const GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY = "a";
const GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_LOCK_TICKS = 1;
const CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_KEY = "a";
const CHARGED_CELL_DEPOSIT_CAMERA_ROTATE_LOCK_TICKS = 1;
const END_OF_ROUND_SIGNAL_CONFIRMATION_TICKS = 2;
const END_OF_ROUND_MISSING_DEPOSIT_SKIP_TICKS = 2;
const POST_RETURN_CAMERA_NORTH_KEY = "n";
const RETURN_PORTAL_CAMERA_NORTH_SETTLE_MS = 2 * BOT_TICK_MS;
const CHARGED_CELL_TO_RUNE_CAMERA_KEY = "m";
const CHARGED_CELL_TO_RUNE_CAMERA_SETTLE_MS = BOT_TICK_MS;
const POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY = "n";
const RUNE_DEPOSIT_CAMERA_NORTH_SETTLE_MS = BOT_TICK_MS;
const WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS = 2;
const WORKBENCH_INVENTORY_NO_CHANGE_MAX_WARNINGS = 3;
const WORKBENCH_FALLBACK_MIN_ESSENCE_FOR_GUARDIAN = 20;
const MINING_CAMERA_WORKBENCH_KEY = "k";
const MINING_CAMERA_WORKBENCH_DELAY_BOT_TICKS = 2;
const WORKBENCH_CAMERA_NORTH_KEY = "n";
const WORKBENCH_CAMERA_NORTH_DELAY_BOT_TICKS = 2;
const PORTAL_MINING_INVENTORY_CHANGE_CHECK_TICKS = 5;
const GUARDIAN_CRAFTING_CHUNK_ID = 926881;
const GUARDIAN_CRAFTING_REGION_ID = 14484;
const MINING_TIMER_WORKBENCH_THRESHOLD_SECONDS = 31;
const MINING_TIMER_MAX_PLAUSIBLE_SECONDS = 120;
const MINING_TIMER_LOCAL_READS_REQUIRED = 3;
const MINING_TIMER_OCR_MAX_FORWARD_DRIFT_SECONDS = 1;
const MINING_TIMER_OCR_EXTRA_DROP_TOLERANCE_SECONDS = 0;
const MINING_STATUS_GREEN_MAX_DURATION_MS = 86_000;
const MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS = 86;
const MINING_TARGET_CACHE_STABLE_DISTANCE_PX = 24;
const GUARDIAN_CRAFTING_AREA_MIN_X = 3560;
const GUARDIAN_CRAFTING_AREA_MAX_X = 3665;
const GUARDIAN_CRAFTING_AREA_MIN_Y = 9470;
const GUARDIAN_CRAFTING_AREA_MAX_Y = 9565;
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
  START_MINING: "Step 04/30 Mine until first-phase exit threshold",
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
  CHECK_PORTAL_MINING_ORANGE: "Step 25/30 Check if orange mining marker is clickable",
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
let currentCaptureWidth = 0;
let currentCaptureHeight = 0;
let currentMovementModel: GuardianOfTheRiftMovementModelSelection | null = null;
let pendingMovementObservation: PendingMovementObservation | null = null;
let stablePlayerAnchor: StablePlayerAnchor | null = null;
let currentRunStats: GuardianRunStats | null = null;
const syncSleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function createRunStatsTravelTimer(): RunStatsTravelTimer {
  return {
    pendingStartedAtMs: null,
    totalMs: 0,
    maxMs: 0,
    completions: 0,
  };
}

function createEmptyGuardianRunStats(startedAtMs: number): GuardianRunStats {
  return {
    startedAtMs,
    cleanComplete: false,
    stablePlayerAnchor,
    activeGuardianRuneTimerSamples: 0,
    activeGuardianRuneTimerTotalElapsedMs: 0,
    activeGuardianRuneTimerMinElapsedMs: null,
    activeGuardianRuneTimerMaxElapsedMs: 0,
    activeGuardianRuneTimerLateSamples: 0,
    activeGuardianRuneTimerOverdueWarnings: 0,
    altarRunesConfirmedCycles: 0,
    altarRunesConfirmedLowerBound: 0,
    altarRunesConfirmedUpperBound: 0,
    altarRunesConfirmedMaxUpperBound: 0,
    altarRunesPendingLowerBound: 0,
    altarRunesPendingUpperBound: 0,
    altarRunesPendingAltarClicks: 0,
    greatGuardianClicks: 0,
    greatGuardianVerified: 0,
    greatGuardianLateReclicks: 0,
    greatGuardianInventoryNotReady: 0,
    workbenchClicks: 0,
    workbenchFallbackCount: 0,
    workbenchFallbackWaitMs: 0,
    workbenchPouchReclickCycles: 0,
    workbenchMaxDistancePx: 0,
    workbenchDistanceOutliers: 0,
    workbenchLastClickedAtMs: null,
    miningEndToWorkbench: createRunStatsTravelTimer(),
    redPortalSearchStartedAtMs: null,
    redPortalSearches: 0,
    redPortalMisses: 0,
    redPortalSearchTotalMs: 0,
    redPortalSearchMaxMs: 0,
    salmonPortalClicks: 0,
    salmonRetrySignals: 0,
    salmonValidation: createRunStatsTravelTimer(),
    chargedCellAttempts: 0,
    chargedCellRetrySignals: 0,
    chargedCellVerification: createRunStatsTravelTimer(),
    guardianNoTargetScans: 0,
    guardianReclicks: 0,
    guardianReclickNoTargetScans: 0,
    movementLateByKind: {},
  };
}

function resetGuardianRunStats(nowMs = Date.now()): void {
  currentRunStats = createEmptyGuardianRunStats(nowMs);
}

function formatRunStatsDuration(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.round(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRunStatsSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function formatSignedRunStatsSeconds(ms: number): string {
  const sign = ms >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

function formatRunStatsAverage(totalMs: number, count: number): string {
  return count > 0 ? formatRunStatsSeconds(totalMs / count) : "0.0s";
}

function recordActiveGuardianRuneTimerSample(elapsedMs: number): void {
  const stats = currentRunStats;
  if (!stats) {
    return;
  }

  const safeElapsedMs = Math.max(0, elapsedMs);
  stats.activeGuardianRuneTimerSamples += 1;
  stats.activeGuardianRuneTimerTotalElapsedMs += safeElapsedMs;
  stats.activeGuardianRuneTimerMinElapsedMs =
    stats.activeGuardianRuneTimerMinElapsedMs === null
      ? safeElapsedMs
      : Math.min(stats.activeGuardianRuneTimerMinElapsedMs, safeElapsedMs);
  stats.activeGuardianRuneTimerMaxElapsedMs = Math.max(stats.activeGuardianRuneTimerMaxElapsedMs, safeElapsedMs);

  if (safeElapsedMs - ACTIVE_GUARDIAN_RUNE_TIMER_MS > ACTIVE_GUARDIAN_RUNE_TIMER_LATE_TOLERANCE_MS) {
    stats.activeGuardianRuneTimerLateSamples += 1;
  }
}

function recordActiveGuardianRuneTimerOverdueWarning(): void {
  if (!currentRunStats) {
    return;
  }

  currentRunStats.activeGuardianRuneTimerOverdueWarnings += 1;
}

function formatActiveGuardianRuneTimerStats(stats: GuardianRunStats): string {
  const samples = stats.activeGuardianRuneTimerSamples;
  const min = stats.activeGuardianRuneTimerMinElapsedMs === null ? "n/a" : formatRunStatsSeconds(stats.activeGuardianRuneTimerMinElapsedMs);
  const max = samples === 0 ? "n/a" : formatRunStatsSeconds(stats.activeGuardianRuneTimerMaxElapsedMs);
  return `target:${formatRunStatsSeconds(ACTIVE_GUARDIAN_RUNE_TIMER_MS)} samples:${samples} avg:${formatRunStatsAverage(stats.activeGuardianRuneTimerTotalElapsedMs, samples)} min:${min} max:${max} late>${formatRunStatsSeconds(ACTIVE_GUARDIAN_RUNE_TIMER_LATE_TOLERANCE_MS)}:${stats.activeGuardianRuneTimerLateSamples} overdue:${stats.activeGuardianRuneTimerOverdueWarnings}`;
}

function formatCurrentActiveGuardianRuneTimerStats(): string {
  return currentRunStats ? formatActiveGuardianRuneTimerStats(currentRunStats) : "unavailable";
}

function formatRuneEstimateRange(lowerBound: number, upperBound: number): string {
  const safeLower = Math.max(0, Math.round(lowerBound));
  const safeUpper = Math.max(safeLower, Math.round(upperBound));
  return safeLower === safeUpper ? `${safeLower}` : `${safeLower}-${safeUpper}`;
}

function syncRunStatsPendingAltarRunes(state: BotState): void {
  if (!currentRunStats) {
    return;
  }

  currentRunStats.altarRunesPendingLowerBound = state.altarCraftedRunesPendingLowerBound;
  currentRunStats.altarRunesPendingUpperBound = state.altarCraftedRunesPendingUpperBound;
  currentRunStats.altarRunesPendingAltarClicks = state.altarCraftedRunesPendingAltarClicks;
}

function recordRunStatsConfirmedAltarRunes(state: BotState): void {
  if (!currentRunStats || state.altarCraftedRunesPendingUpperBound <= 0) {
    return;
  }

  currentRunStats.altarRunesConfirmedCycles += 1;
  currentRunStats.altarRunesConfirmedLowerBound += state.altarCraftedRunesPendingLowerBound;
  currentRunStats.altarRunesConfirmedUpperBound += state.altarCraftedRunesPendingUpperBound;
  currentRunStats.altarRunesConfirmedMaxUpperBound = Math.max(
    currentRunStats.altarRunesConfirmedMaxUpperBound,
    state.altarCraftedRunesPendingUpperBound,
  );
}

function formatAltarRuneStats(stats: GuardianRunStats): string {
  const cycles = stats.altarRunesConfirmedCycles;
  const averageLower = cycles > 0 ? stats.altarRunesConfirmedLowerBound / cycles : 0;
  const averageUpper = cycles > 0 ? stats.altarRunesConfirmedUpperBound / cycles : 0;
  const average =
    cycles === 0
      ? "0.0"
      : averageLower === averageUpper
        ? averageLower.toFixed(1)
        : `${averageLower.toFixed(1)}-${averageUpper.toFixed(1)}`;

  return `confirmed:${formatRuneEstimateRange(stats.altarRunesConfirmedLowerBound, stats.altarRunesConfirmedUpperBound)} cycles:${cycles} avg:${average} max:${cycles === 0 ? 0 : stats.altarRunesConfirmedMaxUpperBound} pending:${formatRuneEstimateRange(stats.altarRunesPendingLowerBound, stats.altarRunesPendingUpperBound)} pendingClicks:${stats.altarRunesPendingAltarClicks}`;
}

function completeRunStatsTimer(timer: RunStatsTravelTimer, nowMs: number): void {
  if (timer.pendingStartedAtMs === null) {
    return;
  }

  const elapsedMs = Math.max(0, nowMs - timer.pendingStartedAtMs);
  timer.totalMs += elapsedMs;
  timer.maxMs = Math.max(timer.maxMs, elapsedMs);
  timer.completions += 1;
  timer.pendingStartedAtMs = null;
}

function startRunStatsMiningEndToWorkbench(nowMs: number): void {
  const stats = currentRunStats;
  if (!stats) {
    return;
  }

  const timer = stats.miningEndToWorkbench;
  if (timer.completions === 0 && timer.pendingStartedAtMs === null) {
    timer.pendingStartedAtMs = nowMs;
  }
}

function formatMiningEndToWorkbenchStats(stats: GuardianRunStats): string {
  const timer = stats.miningEndToWorkbench;
  if (timer.completions > 0) {
    return formatRunStatsSeconds(timer.totalMs);
  }

  return timer.pendingStartedAtMs === null ? "not-started" : "pending";
}

function recordRunStatsWorkbenchTravel(travel: TravelWaitEstimate, nowMs: number): void {
  if (!currentRunStats) {
    return;
  }

  currentRunStats.workbenchClicks += 1;
  currentRunStats.workbenchLastClickedAtMs = nowMs;
  if (
    currentRunStats.miningEndToWorkbench.completions === 0 &&
    currentRunStats.miningEndToWorkbench.pendingStartedAtMs !== null
  ) {
    completeRunStatsTimer(currentRunStats.miningEndToWorkbench, nowMs);
  }
  currentRunStats.workbenchMaxDistancePx = Math.max(currentRunStats.workbenchMaxDistancePx, travel.distancePx);
  if (travel.distancePx >= 700) {
    currentRunStats.workbenchDistanceOutliers += 1;
  }
}

function recordRunStatsMessage(message: string, nowMs: number): void {
  const stats = currentRunStats;
  if (!stats) {
    return;
  }

  const lowerMessage = message.toLowerCase();

  if (message.includes("End-of-round rune deposit complete")) {
    stats.cleanComplete = true;
  }

  if (message.includes("Clicked interior of blue great guardian outline")) {
    stats.greatGuardianClicks += 1;
  }

  if (
    message.includes("Great guardian inventory verified:") ||
    message.includes("Post-portal Great Guardian deposit verified:") ||
    message.includes("End-of-round Great Guardian deposit verified:")
  ) {
    stats.greatGuardianVerified += 1;
  }

  if (message.includes("Great guardian inventory did not") && message.includes("Re-clicking great guardian")) {
    stats.greatGuardianLateReclicks += 1;
  }

  if (message.includes("Great guardian inventory check is not ready yet")) {
    stats.greatGuardianInventoryNotReady += 1;
  }

  if (message.includes("Inventory free-space stayed at") && message.includes("through the crafting wait deadline")) {
    stats.workbenchFallbackCount += 1;
    if (stats.workbenchLastClickedAtMs !== null) {
      stats.workbenchFallbackWaitMs += Math.max(0, nowMs - stats.workbenchLastClickedAtMs);
    }
  }

  if (
    message.includes("Finished filling") &&
    message.includes("remembered pouch(es)") &&
    message.includes("returning to workbench marker search to reclick workbench")
  ) {
    stats.workbenchPouchReclickCycles += 1;
  }

  if (message.includes("saved as altar baseline before switching to FFFF0000 red portal search")) {
    stats.redPortalSearchStartedAtMs = nowMs;
  }

  if (message.includes("No FFFF0000 red portal marker was found")) {
    stats.redPortalMisses += 1;
  }

  if (lowerMessage.includes("clicked randomized pixel inside ffff0000 red portal marker")) {
    if (stats.redPortalSearchStartedAtMs !== null) {
      const elapsedMs = Math.max(0, nowMs - stats.redPortalSearchStartedAtMs);
      stats.redPortalSearchTotalMs += elapsedMs;
      stats.redPortalSearchMaxMs = Math.max(stats.redPortalSearchMaxMs, elapsedMs);
      stats.redPortalSearches += 1;
      stats.redPortalSearchStartedAtMs = null;
    }
  }

  if (
    lowerMessage.includes("ffff5e7e portal marker") &&
    (lowerMessage.includes("waiting before checking the orange mining marker") ||
      lowerMessage.includes("waiting again before checking the orange mining marker") ||
      lowerMessage.includes("waiting again before recovery checks"))
  ) {
    stats.salmonPortalClicks += 1;
    stats.salmonValidation.pendingStartedAtMs = nowMs;
  }

  if (
    message.includes("No FFFF5E7E portal marker found yet") ||
    message.includes("Still in portal-mining zone after salmon portal click") ||
    message.includes("Salmon portal arrival tile") ||
    message.includes("Salmon-arrival recovery did not confirm")
  ) {
    stats.salmonRetrySignals += 1;
  }

  if (message.includes("Portal arrival confirmed at tile") && message.includes("orange mining marker is visible")) {
    completeRunStatsTimer(stats.salmonValidation, nowMs);
  }

  if (lowerMessage.includes("clicked center-right of charged cell deposit marker")) {
    stats.chargedCellAttempts += 1;
    stats.chargedCellVerification.pendingStartedAtMs = nowMs;
  }

  if (
    message.includes("Charged cell deposit inventory verified:") ||
    message.includes("Post-portal charged cell deposit verified:") ||
    message.includes("End-of-round charged cell deposit verified:")
  ) {
    completeRunStatsTimer(stats.chargedCellVerification, nowMs);
  }

  if (
    message.includes("Charged cell deposit inventory did not reach expected") ||
    message.includes("No charged cell deposit marker found yet")
  ) {
    stats.chargedCellRetrySignals += 1;
  }

  if (message.includes("Guardian decision:") && message.includes("chosen=none")) {
    stats.guardianNoTargetScans += 1;
  }

  if (message.includes("Guardian re-click decision:")) {
    if (message.includes("chosen=none")) {
      stats.guardianReclickNoTargetScans += 1;
    } else {
      stats.guardianReclicks += 1;
    }
  }

  const lateMovementMatch = /Movement model recorded late travel: kind=([^\s]+)/.exec(message);
  if (lateMovementMatch) {
    const kind = lateMovementMatch[1];
    stats.movementLateByKind[kind] = (stats.movementLateByKind[kind] ?? 0) + 1;
  }
}

function formatMovementLateStats(stats: GuardianRunStats): string {
  const entries = Object.entries(stats.movementLateByKind);
  return entries.length === 0 ? "none" : entries.map(([kind, count]) => `${kind}:${count}`).join(",");
}

function formatStablePlayerAnchorStats(anchor: StablePlayerAnchor | null): string {
  if (!anchor) {
    return "uninitialized";
  }

  return `${anchor.source}@(${anchor.centerX},${anchor.centerY})/${anchor.bitmapWidth}x${anchor.bitmapHeight}`;
}

function buildGuardianRunStatsFooter(context: AutomateBotLogFooterContext): string[] | null {
  if (context.botId !== RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID) {
    return null;
  }

  const stats = currentRunStats;
  if (!stats) {
    return [
      "",
      "Run stats:",
      `status=unavailable stopSource=${context.stopSource} stopReason=${context.stopReason}`,
    ];
  }

  const startedAt = Date.parse(context.startedAtIso);
  const endedAt = Date.parse(context.endedAtIso);
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : Date.now() - stats.startedAtMs;
  const status = stats.cleanComplete ? "clean_complete" : `stopped_${context.stopSource}`;

  return [
    "",
    "Run stats:",
    `status=${status} stopSource=${context.stopSource} stopReason=${context.stopReason} duration=${formatRunStatsDuration(durationMs)}`,
    `greatGuardian=${stats.greatGuardianVerified}/${stats.greatGuardianClicks} lateReclick=${stats.greatGuardianLateReclicks} inventoryNotReady=${stats.greatGuardianInventoryNotReady}`,
    `altarRunes=${formatAltarRuneStats(stats)}`,
    `workbench=clicks:${stats.workbenchClicks} fallback:${stats.workbenchFallbackCount} fallbackWait:${formatRunStatsSeconds(stats.workbenchFallbackWaitMs)} pouchReclickCycles:${stats.workbenchPouchReclickCycles} maxDistancePx:${Math.round(stats.workbenchMaxDistancePx)} distanceOutliers700px:${stats.workbenchDistanceOutliers}`,
    `miningEnd=toWorkbench:${formatMiningEndToWorkbenchStats(stats)}`,
    `redPortal=searches:${stats.redPortalSearches} misses:${stats.redPortalMisses} total:${formatRunStatsSeconds(stats.redPortalSearchTotalMs)} avg:${formatRunStatsAverage(stats.redPortalSearchTotalMs, stats.redPortalSearches)} max:${formatRunStatsSeconds(stats.redPortalSearchMaxMs)}`,
    `salmon=portalClicks:${stats.salmonPortalClicks} confirmations:${stats.salmonValidation.completions} retrySignals:${stats.salmonRetrySignals} total:${formatRunStatsSeconds(stats.salmonValidation.totalMs)} avg:${formatRunStatsAverage(stats.salmonValidation.totalMs, stats.salmonValidation.completions)} max:${formatRunStatsSeconds(stats.salmonValidation.maxMs)}`,
    `chargedCell=attempts:${stats.chargedCellAttempts} verified:${stats.chargedCellVerification.completions} retrySignals:${stats.chargedCellRetrySignals} total:${formatRunStatsSeconds(stats.chargedCellVerification.totalMs)} avg:${formatRunStatsAverage(stats.chargedCellVerification.totalMs, stats.chargedCellVerification.completions)} max:${formatRunStatsSeconds(stats.chargedCellVerification.maxMs)}`,
    `activeRuneTimer=${formatActiveGuardianRuneTimerStats(stats)}`,
    `guardian=initialNoTarget:${stats.guardianNoTargetScans} reclicks:${stats.guardianReclicks} reclickNoTarget:${stats.guardianReclickNoTargetScans} movementLate:${formatMovementLateStats(stats)}`,
    `stablePlayerAnchor=${formatStablePlayerAnchorStats(stats.stablePlayerAnchor)}`,
  ];
}

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

function getPouchCapacity(pouch: GuardianOfTheRiftDetectablePouch): number {
  return POUCH_CAPACITY_BY_TYPE[pouch];
}

function getPouchStoredEssence(state: BotState, pouch: GuardianOfTheRiftDetectablePouch): number | null {
  return state.pouchEssence[pouch];
}

function formatPouchEssenceSummary(state: BotState): string {
  const rememberedPouches = getRememberedPouchLocations(state);
  if (rememberedPouches.length === 0) {
    return "none";
  }

  return rememberedPouches
    .map((location) => {
      const stored = getPouchStoredEssence(state, location.pouch);
      return `${location.pouch}:${stored === null ? "unknown" : stored}/${getPouchCapacity(location.pouch)}`;
    })
    .join(", ");
}

function getRememberedPouchEssenceCount(state: BotState): number {
  return getRememberedPouchLocations(state).reduce((sum, location) => {
    const stored = getPouchStoredEssence(state, location.pouch);
    return sum + (stored ?? 0);
  }, 0);
}

function getWorkbenchEssenceEstimate(state: BotState): { loose: number; pouch: number; total: number } {
  const loose = Math.max(0, state.workbenchLooseEssenceCount);
  const pouch = getRememberedPouchEssenceCount(state);
  return {
    loose,
    pouch,
    total: loose + pouch,
  };
}

function formatWorkbenchEssenceEstimate(state: BotState): string {
  const estimate = getWorkbenchEssenceEstimate(state);
  return `essence=${estimate.total}/${WORKBENCH_FALLBACK_MIN_ESSENCE_FOR_GUARDIAN} loose=${estimate.loose} pouch=${estimate.pouch} (${formatPouchEssenceSummary(state)})`;
}

function hasPouchesNeedingFill(state: BotState): boolean {
  return getRememberedPouchLocations(state).some((location) => {
    const stored = getPouchStoredEssence(state, location.pouch);
    return stored === null || stored < getPouchCapacity(location.pouch);
  });
}

function hasPouchesToEmpty(state: BotState): boolean {
  return getRememberedPouchLocations(state).some((location) => {
    const stored = getPouchStoredEssence(state, location.pouch);
    return stored === null || stored > 0;
  });
}

function sortPouchLocationsByCapacityAsc(locations: GuardianOfTheRiftPouchLocation[]): GuardianOfTheRiftPouchLocation[] {
  return [...locations].sort((a, b) => getPouchCapacity(a.pouch) - getPouchCapacity(b.pouch));
}

function getPouchMissingEssence(state: BotState, pouch: GuardianOfTheRiftDetectablePouch): number {
  return Math.max(0, getPouchCapacity(pouch) - (getPouchStoredEssence(state, pouch) ?? 0));
}

function selectPouchesNeedingFill(state: BotState): GuardianOfTheRiftPouchLocation[] {
  const candidates = sortPouchLocationsByCapacityAsc(getRememberedPouchLocations(state)).filter((location) => {
    const stored = getPouchStoredEssence(state, location.pouch);
    return stored === null || stored < getPouchCapacity(location.pouch);
  });

  if (state.pouchFillAvailableEssenceSlots === null) {
    return candidates;
  }

  const selected: GuardianOfTheRiftPouchLocation[] = [];
  let remainingEssence = state.pouchFillAvailableEssenceSlots;
  for (const location of candidates) {
    const missingEssence = getPouchMissingEssence(state, location.pouch);
    if (missingEssence <= 0) {
      continue;
    }

    if (missingEssence <= remainingEssence) {
      selected.push(location);
      remainingEssence -= missingEssence;
    }
  }

  return selected;
}

type AltarPouchBatchItem = {
  location: GuardianOfTheRiftPouchLocation;
  stored: number;
};

type AltarPouchBatchPlanScore = {
  batchCount: number;
  maxPouchClicksPerBatch: number;
};

type AltarPouchBatchSelectionScore = AltarPouchBatchPlanScore & {
  unusedSlots: number;
  clickSpanPx: number;
  currentPouchClicks: number;
};

function getAltarPouchBatchTotal(batch: AltarPouchBatchItem[]): number {
  return batch.reduce((sum, item) => sum + item.stored, 0);
}

function getAltarPouchBatchClickSpanPx(batch: AltarPouchBatchItem[]): number {
  if (batch.length <= 1) {
    return 0;
  }

  const centers = batch.map((item) => item.location.screenCenterX);
  return Math.max(...centers) - Math.min(...centers);
}

function getAltarPouchBatchSubsets(
  items: AltarPouchBatchItem[],
  maxBatchCapacity: number,
): AltarPouchBatchItem[][] {
  const subsets: AltarPouchBatchItem[][] = [];
  const subsetCount = 1 << items.length;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    const subset: AltarPouchBatchItem[] = [];
    let total = 0;
    for (let index = 0; index < items.length; index += 1) {
      if ((mask & (1 << index)) === 0) {
        continue;
      }

      const item = items[index];
      subset.push(item);
      total += item.stored;
    }

    if (total <= maxBatchCapacity) {
      subsets.push(subset);
    }
  }

  return subsets;
}

function getRemainingAltarPouchBatchItems(
  items: AltarPouchBatchItem[],
  selected: AltarPouchBatchItem[],
): AltarPouchBatchItem[] {
  const selectedItems = new Set(selected);
  return items.filter((item) => !selectedItems.has(item));
}

function isBetterAltarPouchPlanScore(
  candidate: AltarPouchBatchPlanScore,
  currentBest: AltarPouchBatchPlanScore | null,
): boolean {
  if (currentBest === null) {
    return true;
  }

  if (candidate.batchCount !== currentBest.batchCount) {
    return candidate.batchCount < currentBest.batchCount;
  }

  return candidate.maxPouchClicksPerBatch < currentBest.maxPouchClicksPerBatch;
}

function getBestAltarPouchBatchPlanScore(
  items: AltarPouchBatchItem[],
  maxBatchCapacity: number,
): AltarPouchBatchPlanScore | null {
  if (items.length === 0) {
    return {
      batchCount: 0,
      maxPouchClicksPerBatch: 0,
    };
  }

  let bestScore: AltarPouchBatchPlanScore | null = null;
  for (const batch of getAltarPouchBatchSubsets(items, maxBatchCapacity)) {
    const remainingScore = getBestAltarPouchBatchPlanScore(
      getRemainingAltarPouchBatchItems(items, batch),
      maxBatchCapacity,
    );
    if (remainingScore === null) {
      continue;
    }

    const score: AltarPouchBatchPlanScore = {
      batchCount: 1 + remainingScore.batchCount,
      maxPouchClicksPerBatch: Math.max(batch.length, remainingScore.maxPouchClicksPerBatch),
    };
    if (isBetterAltarPouchPlanScore(score, bestScore)) {
      bestScore = score;
    }
  }

  return bestScore;
}

function isBetterAltarPouchBatchSelectionScore(
  candidate: AltarPouchBatchSelectionScore,
  currentBest: AltarPouchBatchSelectionScore | null,
): boolean {
  if (currentBest === null) {
    return true;
  }

  if (candidate.batchCount !== currentBest.batchCount) {
    return candidate.batchCount < currentBest.batchCount;
  }

  if (candidate.maxPouchClicksPerBatch !== currentBest.maxPouchClicksPerBatch) {
    return candidate.maxPouchClicksPerBatch < currentBest.maxPouchClicksPerBatch;
  }

  if (candidate.unusedSlots !== currentBest.unusedSlots) {
    return candidate.unusedSlots < currentBest.unusedSlots;
  }

  if (candidate.clickSpanPx !== currentBest.clickSpanPx) {
    return candidate.clickSpanPx < currentBest.clickSpanPx;
  }

  return candidate.currentPouchClicks < currentBest.currentPouchClicks;
}

function selectBestAltarPouchEmptyBatch(
  items: AltarPouchBatchItem[],
  maxBatchCapacity: number,
): AltarPouchBatchItem[] {
  let bestBatch: AltarPouchBatchItem[] = [];
  let bestScore: AltarPouchBatchSelectionScore | null = null;
  for (const batch of getAltarPouchBatchSubsets(items, maxBatchCapacity)) {
    const remainingScore = getBestAltarPouchBatchPlanScore(
      getRemainingAltarPouchBatchItems(items, batch),
      maxBatchCapacity,
    );
    const batchCount = remainingScore === null ? Number.MAX_SAFE_INTEGER : 1 + remainingScore.batchCount;
    const maxPouchClicksPerBatch =
      remainingScore === null ? Number.MAX_SAFE_INTEGER : Math.max(batch.length, remainingScore.maxPouchClicksPerBatch);
    const score: AltarPouchBatchSelectionScore = {
      batchCount,
      maxPouchClicksPerBatch,
      unusedSlots: maxBatchCapacity - getAltarPouchBatchTotal(batch),
      clickSpanPx: getAltarPouchBatchClickSpanPx(batch),
      currentPouchClicks: batch.length,
    };

    if (isBetterAltarPouchBatchSelectionScore(score, bestScore)) {
      bestBatch = batch;
      bestScore = score;
    }
  }

  return bestBatch;
}

function selectOptimizedPouchesNeedingFillBatch(state: BotState): GuardianOfTheRiftPouchLocation[] {
  const maxBatchCapacity = state.pouchFillAvailableEssenceSlots;
  if (maxBatchCapacity === null) {
    return selectPouchesNeedingFill(state);
  }

  const candidates = sortPouchLocationsByCapacityAsc(getRememberedPouchLocations(state))
    .map((location): AltarPouchBatchItem => ({
      location,
      stored: getPouchMissingEssence(state, location.pouch),
    }))
    .filter((item) => item.stored > 0);

  return selectBestAltarPouchEmptyBatch(candidates, maxBatchCapacity).map((item) => item.location);
}

function selectAltarPouchEmptyBatch(state: BotState, freeSlots: number): GuardianOfTheRiftPouchLocation[] {
  if (freeSlots <= 0) {
    return [];
  }

  const maxBatchCapacity = freeSlots + ALTAR_POUCH_EMPTY_FREE_SLOT_SLACK;
  const candidates = sortPouchLocationsByCapacityAsc(getRememberedPouchLocations(state))
    .map((location): AltarPouchBatchItem => ({
      location,
      stored: getPouchStoredEssence(state, location.pouch) ?? getPouchCapacity(location.pouch),
    }))
    .filter((item) => item.stored > 0);

  return selectBestAltarPouchEmptyBatch(candidates, maxBatchCapacity).map((item) => item.location);
}

function shouldEmptyPouchesAtAltar(state: BotState): boolean {
  return !state.altarPouchesEmptiedThisCycle && hasPouchesToEmpty(state);
}

function formatPouchClickList(locations: GuardianOfTheRiftPouchLocation[]): string {
  return locations.length === 0
    ? "none"
    : locations.map((location) => `${location.pouch}@(${location.screenCenterX},${location.screenCenterY})`).join(", ");
}

function withRememberedPouchesAssumedFull(state: BotState): BotState {
  const pouchEssence = { ...state.pouchEssence };
  for (const location of getRememberedPouchLocations(state)) {
    pouchEssence[location.pouch] = getPouchCapacity(location.pouch);
  }

  return {
    ...state,
    pouchEssence,
  };
}

function updatePouchEssenceAfterInventoryDelta(
  state: BotState,
  pendingClick: PendingPouchClick,
  afterFreeSlots: number,
): { state: BotState; delta: number } {
  const rawDelta =
    pendingClick.intent === "fill"
      ? afterFreeSlots - pendingClick.beforeFreeSlots
      : pendingClick.beforeFreeSlots - afterFreeSlots;
  const delta = Math.max(0, rawDelta);
  const capacity = getPouchCapacity(pendingClick.pouch);
  const expectedMovedEssence =
    pendingClick.intent === "fill" ? getPouchMissingEssence(state, pendingClick.pouch) : 0;
  const nextStored = pendingClick.intent === "fill" ? capacity : 0;
  const workbenchLooseEssenceCount =
    pendingClick.intent === "fill"
      ? Math.max(0, state.workbenchLooseEssenceCount - expectedMovedEssence)
      : state.workbenchLooseEssenceCount;

  return {
    delta,
    state: {
      ...state,
      pouchEssence: {
        ...state.pouchEssence,
        [pendingClick.pouch]: nextStored,
      },
      pouchClickPending: null,
      pouchClickBatchMovedEssence: state.pouchClickBatchMovedEssence + delta,
      workbenchLooseEssenceCount,
      inventoryFreeSlots: afterFreeSlots,
      missingInventoryCountTicks: 0,
    },
  };
}

function getWorkbenchOpenPortalPouchDecision(state: BotState): {
  shouldUsePortal: boolean;
  rememberedPouchCount: number;
  reason: string;
} {
  const rememberedPouchCount = getRememberedPouchLocations(state).length;
  if (rememberedPouchCount === 0) {
    return {
      shouldUsePortal: false,
      rememberedPouchCount,
      reason: "no remembered pouches are available",
    };
  }

  if (!hasPouchesNeedingFill(state)) {
    return {
      shouldUsePortal: false,
      rememberedPouchCount,
      reason: `remembered pouches are already full (${formatPouchEssenceSummary(state)})`,
    };
  }

  if (state.craftingPouchesFilledThisCycle) {
    return {
      shouldUsePortal: false,
      rememberedPouchCount,
      reason: `remembered pouches were already filled this workbench cycle (${formatPouchEssenceSummary(state)})`,
    };
  }

  return {
    shouldUsePortal: true,
    rememberedPouchCount,
    reason: `remembered pouches need essence and have not been filled this workbench cycle (${formatPouchEssenceSummary(state)})`,
  };
}

function clickNextPouchForInventoryDelta(
  state: BotState,
  captureBounds: ScreenCaptureBounds,
  nowMs: number,
  step: (typeof WORKFLOW_STEPS)[keyof typeof WORKFLOW_STEPS],
  intent: PouchClickIntent,
): BotState {
  const clickIndex = clamp(state.pouchClickIndex, 0, state.pouchClickQueue.length);
  const location = state.pouchClickQueue[clickIndex];
  if (!location) {
    return state;
  }

  const beforeFreeSlots = state.inventoryFreeSlots;
  if (beforeFreeSlots === null) {
    warn(
      stepMessage(
        step,
        `Skipping ${intent} pouch click because inventory free-space is unknown. Pouch memory=${formatPouchEssenceSummary(state)}.`,
      ),
    );
    return {
      ...state,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const clicked = clickScreenPointImmediate(location.screenCenterX, location.screenCenterY, captureBounds);
  const nextClickIndex = clickIndex + 1;
  log(
    stepMessage(
      step,
      `Clicked ${intent} pouch ${location.pouch}@(${clicked.x},${clicked.y}) (${nextClickIndex}/${state.pouchClickQueue.length}); before free-space=${beforeFreeSlots}; pouch memory=${formatPouchEssenceSummary(state)}.`,
    ),
  );

  return {
    ...state,
    pouchClickIndex: nextClickIndex,
    pouchClickIntent: intent,
    pouchClickPending: {
      intent,
      pouch: location.pouch,
      beforeFreeSlots,
    },
    actionLockUntilMs: nowMs + POUCH_CLICK_LOCK_MS,
  };
}

function clickCachedWorkbenchAfterPouchFill(
  state: BotState,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState | null {
  const workbenchMarker = state.cachedWorkbenchMarker;
  if (!workbenchMarker) {
    return null;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const workbenchClickPoint = getBoundsCenterPoint(workbenchMarker);
  const clicked = clickScreenPoint(captureBounds.x + workbenchClickPoint.centerX, captureBounds.y + workbenchClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  const travel = estimateTravelWaitTicks(playerAnchor, workbenchClickPoint);
  setAutomateBotCurrentStep(STEP_WORKBENCH_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_WORKBENCH,
      `Moved mouse and waited ${OBJECT_PRE_CLICK_MOUSE_SETTLE_MS}ms, then clicked cached magenta workbench marker after final pouch fill validation at (${clicked.x},${clicked.y}) local=(${workbenchClickPoint.centerX},${workbenchClickPoint.centerY}) bounds=(${workbenchMarker.minX},${workbenchMarker.minY})-(${workbenchMarker.maxX},${workbenchMarker.maxY}) pixels=${workbenchMarker.pixelCount}; continuing crafting without re-scanning (${formatTravelEstimate(travel)}).`,
    ),
  );

  return transitionToCraftingState(
    {
      ...state,
      ...resetPouchClickQueue(),
      craftingPouchesFilledThisCycle: true,
      inventoryFreeSlots: null,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      workbenchInventoryNoChangeWarnings: 0,
      missingYellowTicks: 0,
    },
    clickedAtMs,
    travel,
    state.inventoryFreeSlots,
  );
}

function clickCachedPortalMiningAfterPouchFill(
  state: BotState,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState | null {
  const miningTarget = state.cachedPortalMiningMarker;
  if (!miningTarget) {
    return null;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const miningClickPoint = getBoundsCenterPoint(miningTarget);
  const clicked = clickScreenPoint(captureBounds.x + miningClickPoint.centerX, captureBounds.y + miningClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  const travel = estimateTravelWaitTicks(playerAnchor, miningClickPoint);
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_PORTAL_MINING,
      `Moved mouse and waited ${OBJECT_PRE_CLICK_MOUSE_SETTLE_MS}ms, then clicked cached ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker after final pouch fill validation at (${clicked.x},${clicked.y}) local=(${miningClickPoint.centerX},${miningClickPoint.centerY}) bounds=(${miningTarget.minX},${miningTarget.minY})-(${miningTarget.maxX},${miningTarget.maxY}) pixels=${miningTarget.pixelCount}; continuing portal mining without re-scanning (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    ...resetPouchClickQueue(),
    currentFunction: "portalMining",
    phase: "portal-mining",
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    missingPortalMiningOrangeTicks: 0,
    missingInventoryCountTicks: 0,
    inventoryFreeSlots: null,
    craftingInventoryChangeDeadlineMs: 0,
    portalMiningPouchesFilledThisCycle: true,
    actionLockUntilMs: clickedAtMs + GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function resetPouchClickQueue(): Pick<
  BotState,
  "pouchClickQueue" | "pouchClickIndex" | "pouchClickIntent" | "pouchClickPending" | "pouchClickBatchMovedEssence"
> {
  return {
    pouchClickQueue: [],
    pouchClickIndex: 0,
    pouchClickIntent: null,
    pouchClickPending: null,
    pouchClickBatchMovedEssence: 0,
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
    phase === "find-portal-mining" ||
    phase === "portal-mining" ||
    phase === "fill-pouches-after-portal-mining-full" ||
    phase === "find-portal-exit" ||
    phase === "wait-after-portal-exit-click" ||
    phase === "complete"
      ? phase
      : "startup";
}

function formatLogLine(message: string): string {
  const stepMatch = /^Step\s+([^\s:]+)[^:]*:\s*(.*)$/.exec(message);
  if (stepMatch) {
    const [, stepNumber, detail] = stepMatch;
    return `[${formatElapsedSinceStart()}] #${currentLogLoopIndex} [${stepNumber}] [${currentLogPhase}] ${detail}`;
  }

  return `[${formatElapsedSinceStart()}] #${currentLogLoopIndex} [${currentLogPhase}] ${message}`;
}

function log(message: string): void {
  recordRunStatsMessage(message, Date.now());
  logger.log(formatLogLine(message));
}

function warn(message: string): void {
  recordRunStatsMessage(message, Date.now());
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
      large: null,
      giant: null,
    },
  };
}

function createEmptyPouchEssenceMemory(defaultValue: number | null = null): GuardianOfTheRiftPouchEssenceMemory {
  return {
    small: defaultValue,
    medium: defaultValue,
    large: defaultValue,
    giant: defaultValue,
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

function withObservedAltarCraftedRunes(state: BotState, beforeFreeSlots: number | null, afterFreeSlots: number): BotState {
  if (beforeFreeSlots === null) {
    return state;
  }

  const slotsFreed = Math.max(0, afterFreeSlots - beforeFreeSlots);
  if (slotsFreed <= 0) {
    return state;
  }

  const isFirstAltarClickInCycle = state.altarCraftedRunesPendingAltarClicks === 0;
  const lowerBound = slotsFreed;
  const upperBound = slotsFreed + (isFirstAltarClickInCycle ? 1 : 0);
  const nextState = {
    ...state,
    altarCraftedRunesPendingLowerBound: state.altarCraftedRunesPendingLowerBound + lowerBound,
    altarCraftedRunesPendingUpperBound: state.altarCraftedRunesPendingUpperBound + upperBound,
    altarCraftedRunesPendingSlotsFreed: state.altarCraftedRunesPendingSlotsFreed + slotsFreed,
    altarCraftedRunesPendingAltarClicks: state.altarCraftedRunesPendingAltarClicks + 1,
  };
  syncRunStatsPendingAltarRunes(nextState);

  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_ALTAR,
      `Altar rune craft estimate observed: beforeFreeSlots=${beforeFreeSlots} afterFreeSlots=${afterFreeSlots} slotsFreed=${slotsFreed} estimate=${formatRuneEstimateRange(lowerBound, upperBound)} pending=${formatRuneEstimateRange(nextState.altarCraftedRunesPendingLowerBound, nextState.altarCraftedRunesPendingUpperBound)} altarClicks=${nextState.altarCraftedRunesPendingAltarClicks}${isFirstAltarClickInCycle ? "; first altar click may have consumed one inventory slot for a new rune stack" : "; exact pouch refill craft delta"}.`,
    ),
  );

  return nextState;
}

function resetPendingAltarCraftedRunes(state: BotState): BotState {
  const nextState = {
    ...state,
    altarCraftedRunesPendingLowerBound: 0,
    altarCraftedRunesPendingUpperBound: 0,
    altarCraftedRunesPendingSlotsFreed: 0,
    altarCraftedRunesPendingAltarClicks: 0,
  };
  syncRunStatsPendingAltarRunes(nextState);
  return nextState;
}

function withGreatGuardianConfirmedAltarRunes(
  state: BotState,
  beforeFreeSlots: number,
  afterFreeSlots: number,
): BotState {
  if (state.altarCraftedRunesPendingUpperBound <= 0) {
    return state;
  }

  recordRunStatsConfirmedAltarRunes(state);
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
      `Great Guardian confirmed altar rune craft estimate: crafted=${formatRuneEstimateRange(state.altarCraftedRunesPendingLowerBound, state.altarCraftedRunesPendingUpperBound)} altarClicks=${state.altarCraftedRunesPendingAltarClicks} slotsFreed=${state.altarCraftedRunesPendingSlotsFreed} inventoryFreeSpace=${beforeFreeSlots}->${afterFreeSlots}.`,
    ),
  );

  return resetPendingAltarCraftedRunes(state);
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
    activeGuardianRuneSignature: null,
    activeGuardianRuneTimerStartedAtMs: null,
    activeGuardianRuneDeadlineMs: null,
    activeGuardianRuneLastObservedAtMs: null,
    activeGuardianRuneOverdueWarned: false,
    activeGuardianRuneTimerStartedFromObservedChange: false,
    altarCraftedRunesPendingLowerBound: 0,
    altarCraftedRunesPendingUpperBound: 0,
    altarCraftedRunesPendingSlotsFreed: 0,
    altarCraftedRunesPendingAltarClicks: 0,
    miningStatusGreenStartedAtMs: null,
    miningCameraKReadyAtMs: 0,
    miningCameraKPrepared: false,
    miningAgilityCourseMarkerCache: null,
    inventoryFreeSlots: null,
    pouchInventory: createEmptyPouchInventoryMemory(),
    pouchEssence: createEmptyPouchEssenceMemory(),
    pouchClickQueue: [],
    pouchClickIndex: 0,
    pouchClickIntent: null,
    pouchClickPending: null,
    pouchClickBatchMovedEssence: 0,
    pouchFillAvailableEssenceSlots: null,
    cachedWorkbenchMarker: null,
    cachedPortalMiningMarker: null,
    craftingPouchesFilledThisCycle: false,
    portalMiningPouchesFilledThisCycle: false,
    altarPouchesEmptiedThisCycle: false,
    endOfRoundDepositMode: false,
    endOfRoundSignalTicks: 0,
    postAltarInventoryLedger: createEmptyPostAltarInventoryLedger(),
    inventoryHistory: [],
    missingInventoryCountTicks: 0,
    craftingInventoryChangeDeadlineMs: 0,
    workbenchInventoryNoChangeWarnings: 0,
    workbenchLooseEssenceCount: 0,
    workbenchCameraNorthReadyAtMs: 0,
    workbenchCameraNorthPreparedThisClick: false,
    guardianArrivalDeadlineMs: 0,
    guardianClickDistancePx: null,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    guardianYellowArrivalDeadlineMs: 0,
    guardianYellowTravelEstimate: null,
    guardianYellowCorrectionRecordedDeadlineMs: null,
    guardianAltarLowFreeSlotRetryCount: 0,
    guardianAltarCameraLeftRotations: 0,
    guardianAltarCameraUnwindReadyAtMs: 0,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    returnPortalCameraNorthReadyAtMs: 0,
    returnPortalCameraNorthPreparedThisClick: false,
    returnPortalLastBadCoordinateKey: null,
    returnPortalRepeatedBadCoordinateReads: 0,
    unknownRewardNextGuardianSlot: "elemental",
    returnPortalRecoveryTarget: null,
    openPortalAfterCurrentPostReturnAction: false,
    postPortalDepositResume: null,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    chargedCellToRuneCameraReadyAtMs: 0,
    chargedCellDepositPlayerTileFallbackPending: false,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    runeDepositMarkerCache: null,
    runeDepositCameraNorthReadyAtMs: 0,
    runeDepositCameraNorthPreparedThisClick: false,
    finalPortalClickReadyAtMs: 0,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: 0,
    portalMiningExitPortalMarkerCache: null,
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
    missingPortalMiningOrangeTicks: 0,
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
  if (isGreatGuardianBluePixel(r, g, b)) {
    return false;
  }

  const royalBlue = Math.abs(r - 65) <= 24 && Math.abs(g - 105) <= 28 && Math.abs(b - 225) <= 30 && b - r >= 120;
  const capturedSaturatedBlue = b >= 175 && r <= 115 && g >= 50 && g <= 150 && b - r >= 85 && b - g >= 70;
  const transparentDarkBlue = b >= 70 && b <= 140 && r <= 35 && g <= 50 && b - r >= 65 && b - g >= 50;

  return royalBlue || capturedSaturatedBlue || transparentDarkBlue;
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

function resolvePortalMiningOrangeSearchBounds(bitmap: RobotBitmap): SearchBounds {
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
  const aspectRatio = Math.max(width / height, height / width);

  if (
    candidate.pixelCount < PURE_RED_MIN_PIXEL_COUNT ||
    width <= 0 ||
    height <= 0 ||
    width < PURE_RED_MIN_COMPONENT_WIDTH_PX ||
    height < PURE_RED_MIN_COMPONENT_HEIGHT_PX ||
    aspectRatio > PURE_RED_MAX_ASPECT_RATIO ||
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

function detectAllPortalMiningOrangeObjects(
  bitmap: RobotBitmap,
  minPixels: number = PORTAL_MINING_ORANGE_MIN_PIXELS,
): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(
    bitmap,
    isStrictOrangePixel,
    minPixels,
    resolvePortalMiningOrangeSearchBounds(bitmap),
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

function isFullActiveGuardianMarker(detection: ColoredMarkerDetection): boolean {
  const aspectRatio = detection.width / Math.max(1, detection.height);
  return (
    detection.width >= ACTIVE_GUARDIAN_MIN_WIDTH_PX &&
    detection.height >= ACTIVE_GUARDIAN_MIN_HEIGHT_PX &&
    detection.pixelCount >= ACTIVE_GUARDIAN_MIN_PIXELS &&
    aspectRatio >= ACTIVE_GUARDIAN_MIN_ASPECT_RATIO &&
    aspectRatio <= ACTIVE_GUARDIAN_MAX_ASPECT_RATIO
  );
}

function filterFullActiveGuardianMarkers(detections: ColoredMarkerDetection[]): ColoredMarkerDetection[] {
  return detections.filter(isFullActiveGuardianMarker);
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

function isChargedCellDepositMarkerShape(detection: ColoredMarkerDetection): boolean {
  const fillRatio = detection.pixelCount / Math.max(1, detection.width * detection.height);
  const aspectRatio = Math.max(detection.width / detection.height, detection.height / detection.width);

  return (
    detection.width >= CHARGED_CELL_DEPOSIT_MIN_WIDTH_PX &&
    detection.height >= CHARGED_CELL_DEPOSIT_MIN_HEIGHT_PX &&
    fillRatio >= CHARGED_CELL_DEPOSIT_MIN_FILL_RATIO &&
    aspectRatio <= CHARGED_CELL_DEPOSIT_MAX_ASPECT_RATIO
  );
}

export function detectAllChargedCellDepositObjects(bitmap: RobotBitmap): ColoredMarkerDetection[] {
  return detectAllColoredMarkers(bitmap, isChargedCellDepositPurplePixel, CHARGED_CELL_DEPOSIT_PURPLE_MIN_PIXELS).filter(
    isChargedCellDepositMarkerShape,
  );
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

function getSafeScreenPoint(screenX: number, screenY: number, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
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

  return { x: safeX, y: safeY };
}

function sleepSyncMs(ms: number): void {
  if (ms <= 0) {
    return;
  }

  Atomics.wait(syncSleepBuffer, 0, 0, ms);
}

function clickScreenPointImmediate(screenX: number, screenY: number, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
  const safePoint = getSafeScreenPoint(screenX, screenY, captureBounds);
  moveMouse(safePoint.x, safePoint.y);
  mouseClick("left", false);
  return safePoint;
}

function clickScreenPoint(screenX: number, screenY: number, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
  const safePoint = getSafeScreenPoint(screenX, screenY, captureBounds);
  moveMouse(safePoint.x, safePoint.y);
  sleepSyncMs(OBJECT_PRE_CLICK_MOUSE_SETTLE_MS);
  mouseClick("left", false);
  return safePoint;
}

async function clickDepositScreenPoint(
  screenX: number,
  screenY: number,
  captureBounds: ScreenCaptureBounds,
): Promise<{ x: number; y: number } | null> {
  const safePoint = getSafeScreenPoint(screenX, screenY, captureBounds);
  moveMouse(safePoint.x, safePoint.y);
  if (DEPOSIT_PRE_CLICK_MOUSE_SETTLE_MS > 0) {
    await sleepWithAbort(DEPOSIT_PRE_CLICK_MOUSE_SETTLE_MS, () => AppState.automateBotRunning);
    if (!AppState.automateBotRunning) {
      return null;
    }
  }

  mouseClick("left", false);
  return safePoint;
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

async function holdKey(key: string, durationMs: number): Promise<boolean> {
  if (typeof keyToggle !== "function") {
    return tapKey(key);
  }

  let pressed = false;
  try {
    keyToggle(key, "down");
    pressed = true;
    await sleepWithAbort(durationMs, () => AppState.automateBotRunning);
    return AppState.automateBotRunning;
  } catch (error) {
    warn(`RobotJS keyToggle('${key}') hold failed: ${error instanceof Error ? error.message : String(error)}.`);
    return false;
  } finally {
    if (pressed) {
      try {
        keyToggle(key, "up");
      } catch (error) {
        warn(`RobotJS keyToggle('${key}') release failed: ${error instanceof Error ? error.message : String(error)}.`);
      }
    }
  }
}

async function prepareStartupCameraPitch(): Promise<void> {
  const heldUp = await holdKey(STARTUP_CAMERA_PITCH_UP_KEY, STARTUP_CAMERA_PITCH_UP_HOLD_MS);
  if (!AppState.automateBotRunning) {
    return;
  }

  log(
    `Startup camera pitch prep: ${heldUp ? `held '${STARTUP_CAMERA_PITCH_UP_KEY}' ${STARTUP_CAMERA_PITCH_UP_HOLD_MS}ms` : `could not hold '${STARTUP_CAMERA_PITCH_UP_KEY}'`} for calibrated height.`,
  );

  if (STARTUP_CAMERA_PITCH_SETTLE_MS > 0) {
    await sleepWithAbort(STARTUP_CAMERA_PITCH_SETTLE_MS, () => AppState.automateBotRunning);
  }
}

async function prepareStartupUiForPouchCheck(): Promise<void> {
  const cameraNorthTapped = tapKey(STARTUP_CAMERA_NORTH_KEY);
  const inventoryTapped = tapKey(STARTUP_INVENTORY_KEY);
  log(
    `Startup UI prep before pouch check: ${cameraNorthTapped ? `tapped '${STARTUP_CAMERA_NORTH_KEY}'` : `could not tap '${STARTUP_CAMERA_NORTH_KEY}'`}; ${inventoryTapped ? `tapped '${STARTUP_INVENTORY_KEY}'` : `could not tap '${STARTUP_INVENTORY_KEY}'`} to open inventory.`,
  );

  if (STARTUP_UI_PREP_SETTLE_MS <= 0) {
    return;
  }

  await sleepWithAbort(STARTUP_UI_PREP_SETTLE_MS, () => AppState.automateBotRunning);
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

function getFallbackPlayerAnchor(bitmap: RobotBitmap, source: StablePlayerAnchor["source"]): StablePlayerAnchor {
  return {
    centerX: Math.round(bitmap.width * PLAYER_ANCHOR_FALLBACK_X_RATIO),
    centerY: Math.round(bitmap.height * PLAYER_ANCHOR_FALLBACK_Y_RATIO),
    source,
    bitmapWidth: bitmap.width,
    bitmapHeight: bitmap.height,
  };
}

function isPlausibleStartupPlayerAnchor(bitmap: RobotBitmap, playerBox: PlayerBox): boolean {
  const ratioX = playerBox.centerX / Math.max(1, bitmap.width);
  const ratioY = playerBox.centerY / Math.max(1, bitmap.height);

  return (
    ratioX >= STARTUP_PLAYER_ANCHOR_MIN_X_RATIO &&
    ratioX <= STARTUP_PLAYER_ANCHOR_MAX_X_RATIO &&
    ratioY >= STARTUP_PLAYER_ANCHOR_MIN_Y_RATIO &&
    ratioY <= STARTUP_PLAYER_ANCHOR_MAX_Y_RATIO
  );
}

function initializeStablePlayerAnchor(startupBitmap: RobotBitmap): StablePlayerAnchor {
  const detected = detectBestPlayerBoxInScreenshot(startupBitmap);
  if (detected && isPlausibleStartupPlayerAnchor(startupBitmap, detected)) {
    const anchor: StablePlayerAnchor = {
      centerX: detected.centerX,
      centerY: detected.centerY,
      source: "startup-player-box",
      bitmapWidth: startupBitmap.width,
      bitmapHeight: startupBitmap.height,
    };
    stablePlayerAnchor = anchor;
    if (currentRunStats) {
      currentRunStats.stablePlayerAnchor = anchor;
    }
    log(
      `Stable player anchor initialized from startup player box: center=(${anchor.centerX},${anchor.centerY}) ratio=(${(anchor.centerX / startupBitmap.width).toFixed(2)},${(anchor.centerY / startupBitmap.height).toFixed(2)}) size=${detected.width}x${detected.height} pixels=${detected.pixelCount}.`,
    );
    return anchor;
  }

  const fallback = getFallbackPlayerAnchor(startupBitmap, "startup-fallback");
  stablePlayerAnchor = fallback;
  if (currentRunStats) {
    currentRunStats.stablePlayerAnchor = fallback;
  }
  log(
    `Stable player anchor initialized from fallback center: center=(${fallback.centerX},${fallback.centerY}) ratio=(${PLAYER_ANCHOR_FALLBACK_X_RATIO.toFixed(2)},${PLAYER_ANCHOR_FALLBACK_Y_RATIO.toFixed(2)})${detected ? `; rejected startup player box center=(${detected.centerX},${detected.centerY}) ratio=(${(detected.centerX / startupBitmap.width).toFixed(2)},${(detected.centerY / startupBitmap.height).toFixed(2)})` : "; no startup player box detected"}.`,
  );
  return fallback;
}

function getPlayerAnchor(bitmap: RobotBitmap): StablePlayerAnchor {
  if (!stablePlayerAnchor) {
    stablePlayerAnchor = getFallbackPlayerAnchor(bitmap, "runtime-fallback");
    if (currentRunStats) {
      currentRunStats.stablePlayerAnchor = stablePlayerAnchor;
    }
    return stablePlayerAnchor;
  }

  if (stablePlayerAnchor.bitmapWidth === bitmap.width && stablePlayerAnchor.bitmapHeight === bitmap.height) {
    return stablePlayerAnchor;
  }

  return {
    ...stablePlayerAnchor,
    centerX: Math.round((stablePlayerAnchor.centerX / Math.max(1, stablePlayerAnchor.bitmapWidth)) * bitmap.width),
    centerY: Math.round((stablePlayerAnchor.centerY / Math.max(1, stablePlayerAnchor.bitmapHeight)) * bitmap.height),
    bitmapWidth: bitmap.width,
    bitmapHeight: bitmap.height,
  };
}

function distanceBetween(a: { centerX: number; centerY: number }, b: { centerX: number; centerY: number }): number {
  const dx = a.centerX - b.centerX;
  const dy = a.centerY - b.centerY;
  return Math.sqrt(dx * dx + dy * dy);
}

function randomIntInclusive(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + Math.floor(Math.random() * (high - low + 1));
}

function getRandomPointInsideMarkerBox(
  marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">,
  targetXRatio: number,
  targetYRatio: number,
  xSpanRatio: number,
  ySpanRatio: number,
): { centerX: number; centerY: number } {
  const width = marker.maxX - marker.minX + 1;
  const height = marker.maxY - marker.minY + 1;
  const insetX = Math.min(MARKER_CLICK_RANDOM_INSET_PX, Math.floor((width - 1) / 2));
  const insetY = Math.min(MARKER_CLICK_RANDOM_INSET_PX, Math.floor((height - 1) / 2));
  const safeMinX = marker.minX + insetX;
  const safeMaxX = marker.maxX - insetX;
  const safeMinY = marker.minY + insetY;
  const safeMaxY = marker.maxY - insetY;
  const targetX = Math.round(marker.minX + (width - 1) * targetXRatio);
  const targetY = Math.round(marker.minY + (height - 1) * targetYRatio);
  const halfSpanX = Math.max(0, Math.round((width * xSpanRatio) / 2));
  const halfSpanY = Math.max(0, Math.round((height * ySpanRatio) / 2));
  const minX = Math.max(safeMinX, targetX - halfSpanX);
  const maxX = Math.min(safeMaxX, targetX + halfSpanX);
  const minY = Math.max(safeMinY, targetY - halfSpanY);
  const maxY = Math.min(safeMaxY, targetY + halfSpanY);

  return {
    centerX: minX <= maxX ? randomIntInclusive(minX, maxX) : clamp(targetX, safeMinX, safeMaxX),
    centerY: minY <= maxY ? randomIntInclusive(minY, maxY) : clamp(targetY, safeMinY, safeMaxY),
  };
}

function getBoundsCenterPoint(marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">): {
  centerX: number;
  centerY: number;
} {
  return getRandomPointInsideMarkerBox(
    marker,
    0.5,
    0.5,
    CENTER_MARKER_CLICK_RANDOM_SPAN_RATIO_X,
    CENTER_MARKER_CLICK_RANDOM_SPAN_RATIO_Y,
  );
}

function getSalmonPortalClickPoint(marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">): {
  centerX: number;
  centerY: number;
} {
  return getRandomPointInsideMarkerBox(
    marker,
    SALMON_PORTAL_CLICK_RATIO_X,
    0.5,
    SALMON_PORTAL_CLICK_RANDOM_SPAN_RATIO_X,
    SALMON_PORTAL_CLICK_RANDOM_SPAN_RATIO_Y,
  );
}

function getBoundsCenterRightPoint(marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">): {
  centerX: number;
  centerY: number;
} {
  return getRandomPointInsideMarkerBox(
    marker,
    CHARGED_CELL_DEPOSIT_CLICK_RATIO_X,
    0.5,
    CHARGED_CELL_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_X,
    CHARGED_CELL_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_Y,
  );
}

function getRuneDepositClickPoint(marker: Pick<OrangeObjectDetection, "minX" | "minY" | "maxX" | "maxY">): {
  centerX: number;
  centerY: number;
} {
  return getRandomPointInsideMarkerBox(
    marker,
    RUNE_DEPOSIT_CLICK_RATIO_X,
    RUNE_DEPOSIT_CLICK_RATIO_Y,
    RUNE_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_X,
    RUNE_DEPOSIT_CLICK_RANDOM_SPAN_RATIO_Y,
  );
}

function getRuneDepositMarkerSettleTicks(travel: TravelWaitEstimate): number {
  if (travel.distanceTiles >= RUNE_DEPOSIT_MEDIUM_DISTANCE_TILES) {
    return 2;
  }

  return 1;
}

function getMiningOrangeReclickDelayMs(): number {
  if (GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer") {
    return OPTIMIZER_MINING_ORANGE_RECLICK_DELAY_MS;
  }

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

function isNearGuardianCraftingAreaLocation(location: GuardianCoordinateLocation): boolean {
  return (
    location.x >= GUARDIAN_CRAFTING_AREA_MIN_X &&
    location.x <= GUARDIAN_CRAFTING_AREA_MAX_X &&
    location.y >= GUARDIAN_CRAFTING_AREA_MIN_Y &&
    location.y <= GUARDIAN_CRAFTING_AREA_MAX_Y
  );
}

function hasLeftGuardianCraftingAreaLocation(location: GuardianCoordinateLocation | null): location is GuardianCoordinateLocation {
  return (
    location !== null &&
    !isNearGuardianCraftingAreaLocation(location) &&
    location.chunkId !== GUARDIAN_CRAFTING_CHUNK_ID &&
    location.regionId !== GUARDIAN_CRAFTING_REGION_ID
  );
}

function formatGuardianCoordinateDebug(location: GuardianCoordinateLocation | null): string {
  if (!location) {
    return "unreadable";
  }

  return `tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} nearCraftingArea=${isNearGuardianCraftingAreaLocation(location)} raw='${location.matchedLine}'`;
}

function hasLeftGuardianCraftingChunk(bitmap: RobotBitmap): {
  left: boolean;
  matchedLine: string | null;
  chunkId: number | null;
  regionId: number | null;
  nearCraftingArea: boolean;
} {
  const location = readGuardianCoordinateLocation(bitmap);
  if (!location) {
    return {
      left: false,
      matchedLine: null,
      chunkId: null,
      regionId: null,
      nearCraftingArea: false,
    };
  }

  const nearCraftingArea = isNearGuardianCraftingAreaLocation(location);
  return {
    left: hasLeftGuardianCraftingAreaLocation(location),
    matchedLine: location.matchedLine,
    chunkId: location.chunkId,
    regionId: location.regionId,
    nearCraftingArea,
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
  const baseWaitTicks = travelTicks + TRAVEL_EXTRA_WAIT_TICKS;
  const targetYRatio = currentCaptureHeight > 0 ? target.centerY / currentCaptureHeight : null;
  const absDxPx = Math.abs(dxPx);
  const absDyPx = Math.abs(dyPx);
  const axisDominanceRatio = Math.max(absDxPx, absDyPx) / Math.max(1, absDxPx + absDyPx);
  const movementBuffer = estimateMovementModelBuffer(distanceTiles, targetYRatio, axisDominanceRatio);

  return {
    waitTicks: baseWaitTicks + movementBuffer.extraWaitTicks,
    baseWaitTicks,
    travelTicks,
    distancePx,
    distanceTiles,
    tilePx,
    dxPx,
    dyPx,
    targetYRatio,
    axisDominanceRatio,
    movementModelVersion: currentMovementModel?.version ?? MOVEMENT_MODEL_VERSION,
    movementExtraWaitTicks: movementBuffer.extraWaitTicks,
    movementReasons: movementBuffer.reasons,
  };
}

function estimateMovementModelBuffer(
  distanceTiles: number,
  targetYRatio: number | null,
  axisDominanceRatio: number,
): { extraWaitTicks: number; reasons: string[] } {
  const reasons: string[] = [];
  let extraWaitTicks = 0;

  if (distanceTiles >= MOVEMENT_MODEL_LONG_DISTANCE_TILES) {
    const extra = currentMovementModel?.version && currentMovementModel.version >= 2 ? currentMovementModel.longExtraWaitTicks : 1;
    extraWaitTicks += extra;
    reasons.push(`long>=${MOVEMENT_MODEL_LONG_DISTANCE_TILES}`);
  }

  if (distanceTiles >= MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES) {
    const extra =
      currentMovementModel?.version && currentMovementModel.version >= 2 ? currentMovementModel.veryLongExtraWaitTicks : 1;
    extraWaitTicks += extra;
    reasons.push(`veryLong>=${MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES}`);
  }

  if (targetYRatio !== null && distanceTiles >= MOVEMENT_MODEL_TOP_SCREEN_DISTANCE_TILES) {
    if ((currentMovementModel?.version ?? MOVEMENT_MODEL_VERSION) >= 3) {
      const yBandExtra =
        targetYRatio <= MOVEMENT_MODEL_TOP_SCREEN_Y_RATIO
          ? currentMovementModel?.yBandExtraWaitTicks.top ?? 1
          : targetYRatio <= 0.7
            ? currentMovementModel?.yBandExtraWaitTicks.middle ?? 0
            : currentMovementModel?.yBandExtraWaitTicks.bottom ?? 0;
      extraWaitTicks += yBandExtra;
      if (yBandExtra > 0) {
        reasons.push(`yBand=${targetYRatio.toFixed(2)}`);
      }
    } else if (targetYRatio <= MOVEMENT_MODEL_TOP_SCREEN_Y_RATIO) {
      const extra =
        currentMovementModel?.version && currentMovementModel.version >= 2 ? currentMovementModel.topScreenExtraWaitTicks : 1;
      extraWaitTicks += extra;
      reasons.push(`topY=${targetYRatio.toFixed(2)}`);
    }
  }

  if (
    distanceTiles >= MOVEMENT_MODEL_AXIS_DOMINANCE_DISTANCE_TILES &&
    axisDominanceRatio >= MOVEMENT_MODEL_AXIS_DOMINANCE_RATIO
  ) {
    const extra =
      currentMovementModel?.version && currentMovementModel.version >= 2
        ? currentMovementModel.axisDominanceExtraWaitTicks
        : 1;
    extraWaitTicks += extra;
    reasons.push(`axis=${axisDominanceRatio.toFixed(2)}`);
  }

  if (extraWaitTicks > MOVEMENT_MODEL_MAX_EXTRA_WAIT_TICKS) {
    reasons.push(`cap=${MOVEMENT_MODEL_MAX_EXTRA_WAIT_TICKS}`);
  }

  return {
    extraWaitTicks: Math.min(extraWaitTicks, MOVEMENT_MODEL_MAX_EXTRA_WAIT_TICKS),
    reasons,
  };
}

function formatTravelEstimate(travel: TravelWaitEstimate): string {
  const movementSuffix =
    travel.movementExtraWaitTicks > 0
      ? ` movement=v${travel.movementModelVersion}+${travel.movementExtraWaitTicks} baseWait=${travel.baseWaitTicks} y=${travel.targetYRatio === null ? "unknown" : travel.targetYRatio.toFixed(2)} axis=${travel.axisDominanceRatio.toFixed(2)} reason=${travel.movementReasons.join("+")}`
      : "";
  return `distance=${Math.round(travel.distancePx)}px dx=${Math.round(travel.dxPx)}px dy=${Math.round(travel.dyPx)}px tiles~${travel.distanceTiles.toFixed(1)} tilePx=${travel.tilePx}px travel=${travel.travelTicks} tick(s) wait=${travel.waitTicks} tick(s)${movementSuffix}`;
}

function getMovementModelSignature(model: GuardianOfTheRiftMovementModelSelection): string {
  return [
    `v=${model.version}`,
    `long=${model.longExtraWaitTicks}`,
    `veryLong=${model.veryLongExtraWaitTicks}`,
    `top=${model.topScreenExtraWaitTicks}`,
    `axis=${model.axisDominanceExtraWaitTicks}`,
    `yTop=${model.yBandExtraWaitTicks.top}`,
    `yMid=${model.yBandExtraWaitTicks.middle}`,
    `yBot=${model.yBandExtraWaitTicks.bottom}`,
  ].join("|");
}

function formatMovementModelSelection(model: GuardianOfTheRiftMovementModelSelection): string {
  return `v${model.version} observations=${model.observationCount} success=${model.successCount} late=${model.lateCount} extras(long=${model.longExtraWaitTicks}, veryLong=${model.veryLongExtraWaitTicks}, top=${model.topScreenExtraWaitTicks}, axis=${model.axisDominanceExtraWaitTicks}, yBand=${model.yBandExtraWaitTicks.top}/${model.yBandExtraWaitTicks.middle}/${model.yBandExtraWaitTicks.bottom}) history=${model.path}`;
}

function applyMovementModelSelection(model: GuardianOfTheRiftMovementModelSelection, reason: string): void {
  const previousSignature = currentMovementModel ? getMovementModelSignature(currentMovementModel) : null;
  currentMovementModel = model;
  const nextSignature = getMovementModelSignature(model);
  if (previousSignature !== null && previousSignature !== nextSignature) {
    log(`Movement model changed after ${reason}: ${formatMovementModelSelection(model)}.`);
  }
}

function rememberMovementObservation(kind: string, step: string, clickedAtMs: number, travel: TravelWaitEstimate): void {
  if (!isGuardianOfTheRiftMovementModelTrainingKind(kind)) {
    return;
  }

  pendingMovementObservation = {
    kind,
    step,
    clickedAtMs,
    travel,
  };
}

function discardPendingMovementObservation(kind: string): void {
  if (pendingMovementObservation?.kind === kind) {
    pendingMovementObservation = null;
  }
}

function resolvePendingMovementObservation(
  outcome: GuardianOfTheRiftMovementObservationOutcome,
  reason: string,
  nowMs: number,
  bitmap: RobotBitmap,
): void {
  const pending = pendingMovementObservation;
  if (!pending) {
    return;
  }

  pendingMovementObservation = null;
  const elapsedTicks = Math.max(0, Math.ceil((nowMs - pending.clickedAtMs) / GAME_TICK_MS));
  const result = recordGuardianOfTheRiftMovementObservation({
    bitmap,
    context: {
      monitorTier: currentMonitorTier,
      windowsScalePercent: currentWindowsScalePercent,
    },
    thresholds: MOVEMENT_MODEL_THRESHOLDS,
    kind: pending.kind,
    outcome,
    reason,
    elapsedTicks,
    travel: pending.travel,
  });
  applyMovementModelSelection(result.model, `${outcome} ${pending.kind}`);

  if (outcome === "late") {
    warn(
      `Movement model recorded late travel: kind=${pending.kind} step='${pending.step}' elapsed=${elapsedTicks} tick(s) reason=${reason}; ${formatTravelEstimate(pending.travel)}; model=${formatMovementModelSelection(result.model)}.`,
    );
  }
}

function getGuardianTeleportRetryDeadlineMs(clickedAtMs: number, travel: TravelWaitEstimate): number {
  return (
    clickedAtMs +
    (travel.waitTicks + GUARDIAN_RECLICK_GRACE_TICKS) * GAME_TICK_MS +
    GUARDIAN_TELEPORT_VALIDATION_EXTRA_BOT_TICKS * BOT_TICK_MS
  );
}

function formatGuardianTeleportWait(travel: TravelWaitEstimate): string {
  return `${formatTravelEstimate(travel)} retryGrace=${GUARDIAN_RECLICK_GRACE_TICKS} tick(s) validationBuffer=${GUARDIAN_TELEPORT_VALIDATION_EXTRA_BOT_TICKS} bot tick(s)`;
}

function formatAltarMarkerSearchDiagnostics(bitmap: RobotBitmap, detections: GuardianOfTheRiftAltarDetection[]): string {
  return `Candidates=${formatGuardianOfTheRiftAltarCandidates(detections)}. ${formatGuardianOfTheRiftAltarDetectionDiagnostics(bitmap)}`;
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
    const rotated = tapKey(UNCHARGED_CELL_CAMERA_ROTATE_KEY);
    if (missingTargetTicks === 1 || missingTargetTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TAKE_UNCHARGED_CELL,
          `No large red uncharged-cell pickup marker found in the scene; rejected thin/small red components below minPixels=${PURE_RED_MIN_PIXEL_COUNT}, minSize=${PURE_RED_MIN_COMPONENT_WIDTH_PX}x${PURE_RED_MIN_COMPONENT_HEIGHT_PX}, maxAspect=${PURE_RED_MAX_ASPECT_RATIO}. ${rotated ? `Tapped '${UNCHARGED_CELL_CAMERA_ROTATE_KEY}' to rotate camera` : `Could not tap '${UNCHARGED_CELL_CAMERA_ROTATE_KEY}' to rotate camera`} before retry ${missingTargetTicks}.`,
        ),
      );
    }

    return {
      ...state,
      missingTargetTicks,
      actionLockUntilMs: rotated
        ? nowMs + UNCHARGED_CELL_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS
        : nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const travel = estimateTravelWaitTicks(playerAnchor, target);
  const clicked = clickScreenPoint(captureBounds.x + target.centerX, captureBounds.y + target.centerY, captureBounds);
  log(
    stepMessage(
      WORKFLOW_STEPS.TAKE_UNCHARGED_CELL,
      `Clicked red uncharged-cell pickup marker at (${clicked.x},${clicked.y}) local=(${target.centerX},${target.centerY}) size=${target.width}x${target.height} pixels=${target.pixelCount} fill=${target.fillRatio.toFixed(2)} score=${target.score.toFixed(1)} ${formatTravelEstimate(travel)}.`,
    ),
  );

  return toWaitAfterPickupState(state, nowMs, clicked, travel, config);
}

function transitionToMiningState(state: BotState): BotState {
  setAutomateBotCurrentStep(STEP_MINING_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.START_MINING,
      GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer"
        ? `Mining node clicked; waiting for optimizer Last Portal timer to turn white before re-clicking/starting mining, then racing the local ${Math.round(MINING_STATUS_GREEN_MAX_DURATION_MS / 1000)}s timer against time-since-portal >= ${MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS}s before changing phase.`
        : `Mining node clicked; waiting for mining status to turn green, then racing the local ${Math.round(MINING_STATUS_GREEN_MAX_DURATION_MS / 1000)}s timer against time-since-portal >= ${MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS}s before changing phase.`,
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
    miningCameraKReadyAtMs: 0,
    miningCameraKPrepared: false,
    miningAgilityCourseMarkerCache: null,
    portalMiningExitPortalMarkerCache: null,
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
    miningCameraKReadyAtMs: 0,
    miningCameraKPrepared: false,
    miningAgilityCourseMarkerCache: null,
    portalMiningExitPortalMarkerCache: null,
  };
}

function runWaitAfterPickupTick(state: BotState, nowMs: number, config: GuardianOfTheRiftConfig): BotState {
  if (nowMs < state.pickupArrivalDeadlineMs) {
    return state;
  }

  if (config.useAgilityCourse) {
    setAutomateBotCurrentStep(STEP_AGILITY_COURSE_ID);
    const cameraNorthTapped = tapKey(AGILITY_CAMERA_NORTH_KEY);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_AGILITY_COURSE,
        `Agility course is enabled; ${cameraNorthTapped ? `tapped '${AGILITY_CAMERA_NORTH_KEY}'` : `could not tap '${AGILITY_CAMERA_NORTH_KEY}'`} before searching; moving east until the FFCCFF00 yellow marker is clickable, then checking for ${AGILITY_COURSE_TARGET_X},${AGILITY_COURSE_TARGET_Y}.`,
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

function pickNearestColoredMarkerToPoint(
  detections: ColoredMarkerDetection[],
  point: { centerX: number; centerY: number },
): ColoredMarkerDetection | null {
  let best: ColoredMarkerDetection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const detection of detections) {
    const distance = distanceBetween(point, detection);
    if (distance < bestDistance) {
      best = detection;
      bestDistance = distance;
    }
  }

  return best;
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

function updateCachedMarker<T extends { centerX: number; centerY: number }>(
  cache: CachedMarker<T> | null,
  marker: T,
  nowMs: number,
  loopIndex: number,
  stableDistancePx = MINING_TARGET_CACHE_STABLE_DISTANCE_PX,
): CachedMarker<T> {
  const isSameMarker =
    cache !== null && distanceBetween(cache.marker, marker) <= stableDistancePx;

  return {
    marker,
    firstSeenAtMs: isSameMarker ? cache.firstSeenAtMs : nowMs,
    lastSeenAtMs: nowMs,
    loopIndex,
  };
}

function isCachedMarkerSettled<T>(cache: CachedMarker<T>, nowMs: number, settleTicks: number): boolean {
  return nowMs >= cache.firstSeenAtMs + settleTicks * GAME_TICK_MS;
}

function rememberMiningAgilityCourseMarker(state: BotState, nowMs: number, bitmap: RobotBitmap): BotState {
  const playerAnchor = getPlayerAnchor(bitmap);
  const markers = detectAllAgilityCourseMarkers(bitmap);
  const marker = pickNearestColoredMarker(markers, playerAnchor);
  if (!marker) {
    return state;
  }

  const cache = updateCachedMarker(state.miningAgilityCourseMarkerCache, marker, nowMs, state.loopIndex);
  if (cache.firstSeenAtMs === nowMs) {
    log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `Cached FFCCFF00 agility yellow marker during mining at local=(${marker.centerX},${marker.centerY}) size=${marker.width}x${marker.height} px=${marker.pixelCount}; will use it when mining completes.`,
      ),
    );
  }

  return {
    ...state,
    miningAgilityCourseMarkerCache: cache,
  };
}

function rememberPortalMiningExitPortalMarker(state: BotState, nowMs: number, bitmap: RobotBitmap): BotState {
  const playerAnchor = getPlayerAnchor(bitmap);
  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(bitmap);
  const exitPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!exitPortal) {
    return state;
  }

  const cache = updateCachedMarker(state.portalMiningExitPortalMarkerCache, exitPortal, nowMs, state.loopIndex);
  if (cache.firstSeenAtMs === nowMs) {
    const exitPortalClickPoint = getSalmonPortalClickPoint(exitPortal);
    log(
      stepMessage(
        WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL,
        `Cached ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} salmon exit portal during portal mining at center=(${exitPortalClickPoint.centerX},${exitPortalClickPoint.centerY}) size=${exitPortal.width}x${exitPortal.height} px=${exitPortal.pixelCount}; will use it when inventory is full.`,
      ),
    );
  }

  return {
    ...state,
    portalMiningExitPortalMarkerCache: cache,
  };
}

function formatActiveGuardianRuneMatch(match: GuardianOfTheRiftRuneMatch | null): string {
  if (!match) {
    return "none";
  }

  return `${match.rune} score=${match.score.toFixed(3)} local=(${match.centerX},${match.centerY})`;
}

function getActiveGuardianRuneSignature(detection: GuardianOfTheRiftActiveRuneDetection): string | null {
  if (!detection.elemental || !detection.catalytic) {
    return null;
  }

  return `${detection.elemental.rune}/${detection.catalytic.rune}`;
}

function warnActiveGuardianRuneTimerOverdueIfNeeded(
  state: BotState,
  nowMs: number,
  activeRunes: GuardianOfTheRiftActiveRuneDetection,
  signature: string | null,
): BotState {
  if (
    state.activeGuardianRuneTimerStartedAtMs === null ||
    state.activeGuardianRuneDeadlineMs === null ||
    state.activeGuardianRuneOverdueWarned ||
    nowMs < state.activeGuardianRuneDeadlineMs + ACTIVE_GUARDIAN_RUNE_TIMER_OVERDUE_GRACE_MS
  ) {
    return state;
  }

  const elapsedMs = nowMs - state.activeGuardianRuneTimerStartedAtMs;
  const overdueMs = nowMs - state.activeGuardianRuneDeadlineMs;
  const lastObservedAgoMs =
    state.activeGuardianRuneLastObservedAtMs === null ? null : Math.max(0, nowMs - state.activeGuardianRuneLastObservedAtMs);
  recordActiveGuardianRuneTimerOverdueWarning();
  setCurrentLogLoopIndex(state.loopIndex);
  setCurrentLogPhase(state.phase);
  warn(
    `Active guardian rune timer overdue: current=${state.activeGuardianRuneSignature ?? "none"} latestRead=${signature ?? "incomplete"} source=${state.activeGuardianRuneTimerStartedFromObservedChange ? "observed-change" : "initial-read"} elapsed=${formatRunStatsSeconds(elapsedMs)} overdue=${formatSignedRunStatsSeconds(overdueMs)} target=${formatRunStatsSeconds(ACTIVE_GUARDIAN_RUNE_TIMER_MS)} grace=${formatRunStatsSeconds(ACTIVE_GUARDIAN_RUNE_TIMER_OVERDUE_GRACE_MS)} lastObservedAgo=${lastObservedAgoMs === null ? "never" : formatRunStatsSeconds(lastObservedAgoMs)} elemental=${formatActiveGuardianRuneMatch(activeRunes.elemental)} catalytic=${formatActiveGuardianRuneMatch(activeRunes.catalytic)} stats=${formatCurrentActiveGuardianRuneTimerStats()}.`,
  );

  return {
    ...state,
    activeGuardianRuneOverdueWarned: true,
  };
}

function trackActiveGuardianRuneTimer(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  activeRuneTemplates: GuardianOfTheRiftRuneTemplate[],
): BotState {
  if (activeRuneTemplates.length === 0) {
    return state;
  }

  const activeRunes = detectGuardianOfTheRiftActiveRunes(tickCapture.bitmap, activeRuneTemplates);
  const signature = getActiveGuardianRuneSignature(activeRunes);
  if (!signature) {
    return warnActiveGuardianRuneTimerOverdueIfNeeded(state, nowMs, activeRunes, null);
  }

  if (signature === state.activeGuardianRuneSignature) {
    const observedState = {
      ...state,
      activeGuardianRuneLastObservedAtMs: nowMs,
    };
    return warnActiveGuardianRuneTimerOverdueIfNeeded(observedState, nowMs, activeRunes, signature);
  }

  const previousSignature = state.activeGuardianRuneSignature ?? "none";
  const deadlineMs = nowMs + ACTIVE_GUARDIAN_RUNE_TIMER_MS;
  const elapsedMs = state.activeGuardianRuneTimerStartedAtMs === null ? null : nowMs - state.activeGuardianRuneTimerStartedAtMs;
  const canValidateElapsed = elapsedMs !== null && state.activeGuardianRuneTimerStartedFromObservedChange;
  const driftMs = canValidateElapsed ? elapsedMs - ACTIVE_GUARDIAN_RUNE_TIMER_MS : null;
  if (canValidateElapsed) {
    recordActiveGuardianRuneTimerSample(elapsedMs);
  }

  setCurrentLogLoopIndex(state.loopIndex);
  setCurrentLogPhase(state.phase);
  log(
    `Active guardian rune timer ${state.activeGuardianRuneSignature === null ? "initialized" : "changed"}: previous=${previousSignature} current=${signature}; validation=${canValidateElapsed ? "sample" : state.activeGuardianRuneTimerStartedAtMs === null ? "initialized" : "priming"} elapsed=${elapsedMs === null ? "n/a" : formatRunStatsSeconds(elapsedMs)} drift=${driftMs === null ? "n/a" : formatSignedRunStatsSeconds(driftMs)} target=${formatRunStatsSeconds(ACTIVE_GUARDIAN_RUNE_TIMER_MS)} deadlineIn=${formatRunStatsSeconds(deadlineMs - nowMs)} stats=${formatCurrentActiveGuardianRuneTimerStats()} elemental=${formatActiveGuardianRuneMatch(activeRunes.elemental)} catalytic=${formatActiveGuardianRuneMatch(activeRunes.catalytic)}.`,
  );

  return {
    ...state,
    activeGuardianRuneSignature: signature,
    activeGuardianRuneTimerStartedAtMs: nowMs,
    activeGuardianRuneDeadlineMs: deadlineMs,
    activeGuardianRuneLastObservedAtMs: nowMs,
    activeGuardianRuneOverdueWarned: false,
    activeGuardianRuneTimerStartedFromObservedChange: state.activeGuardianRuneSignature !== null,
  };
}

function formatGuardianDecision(selection: GuardianTravelTargetSelection): string {
  return [
    `rewardPoints=${formatRewardPoints(selection.rewardPoints)}`,
    `preference=${selection.preferenceOrder.join("->")}`,
    `chosen=${
      selection.target
        ? `${selection.target.slot}:${selection.target.runeMatch.rune}@${selection.target.colorHex} local=(${selection.target.clickPoint.centerX},${selection.target.clickPoint.centerY}) bounds=(${selection.target.marker.minX},${selection.target.marker.minY})-${selection.target.marker.maxX},${selection.target.marker.maxY} size=${selection.target.marker.width}x${selection.target.marker.height} px=${selection.target.marker.pixelCount}`
        : "none"
    }`,
    `active elemental=${formatActiveGuardianRuneMatch(selection.elementalRune)}`,
    `catalytic=${formatActiveGuardianRuneMatch(selection.catalyticRune)}`,
    `skipped=${selection.skippedReasons.join("; ") || "none"}`,
    `greenCandidates=${formatColoredMarkerCandidates(selection.greenCandidates)}`,
    `catalyticCandidates=${formatColoredMarkerCandidates(selection.catalyticCandidates)}`,
  ].join("; ");
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

function shouldRotateCameraForMissingGuardianTarget(
  selection: GuardianTravelTargetSelection,
  config: GuardianOfTheRiftConfig,
): boolean {
  if (selection.target) {
    return false;
  }

  if (GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer") {
    return true;
  }

  return selection.preferenceOrder.some((slot) => {
    if (slot === "optimizer-green") {
      return true;
    }

    const runeMatch = slot === "elemental" ? selection.elementalRune : selection.catalyticRune;
    return runeMatch !== null && config.activeGuardianElements[runeMatch.rune] !== false;
  });
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
  const fullGreenCandidates = filterFullActiveGuardianMarkers(greenCandidates);
  const fullCatalyticCandidates = filterFullActiveGuardianMarkers(catalyticCandidates);
  const greenMarker = pickLargestGreenObject(fullGreenCandidates);
  const catalyticMarker = pickLargestColoredMarker(fullCatalyticCandidates);
  const skippedReasons: string[] = [];
  const targets: GuardianTravelTarget[] = [];
  const preferenceOrder = getGuardianSlotPreferenceOrder(rewardPoints, unknownRewardNextGuardianSlot);

  if (GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer") {
    const optimizerPreferenceOrder: Array<GuardianOfTheRiftSlot | "optimizer-green"> = ["optimizer-green"];
    const runeMatch = activeRunes.elemental ?? activeRunes.catalytic;
    const slot: GuardianOfTheRiftSlot = activeRunes.elemental ? "elemental" : "catalytic";

    if (!greenMarker) {
      skippedReasons.push(
        `optimizer: ${ELEMENTAL_GUARDIAN_MARKER_COLOR_HEX} green outline was not visible (${fullGreenCandidates.length}/${greenCandidates.length} candidate(s) passed shape filter); blue outline ignored by optimizer mode`,
      );
    } else if (!runeMatch) {
      skippedReasons.push("optimizer: green outline was visible, but active rune was not detected");
    } else {
      skippedReasons.push("optimizer: always choosing the green outline; blue outline and reward points ignored");
      targets.push({
        slot,
        runeMatch,
        marker: greenMarker,
        clickPoint: pickGuardianGreenClickPoint(bitmap, greenMarker),
        color: "green",
        colorHex: ELEMENTAL_GUARDIAN_MARKER_COLOR_HEX,
      });
    }

    return {
      target: targets[0] ?? null,
      elementalRune: activeRunes.elemental,
      catalyticRune: activeRunes.catalytic,
      rewardPoints,
      greenCandidates,
      catalyticCandidates,
      skippedReasons,
      preferenceOrder: optimizerPreferenceOrder,
    };
  }

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
      const visibleCandidates = slot === "elemental" ? greenCandidates : catalyticCandidates;
      const fullCandidates = slot === "elemental" ? fullGreenCandidates : fullCatalyticCandidates;
      skippedReasons.push(
        `${slot}: ${colorHex} full-size marker was not visible (${fullCandidates.length}/${visibleCandidates.length} candidate(s) passed shape filter)`,
      );
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

function getNorthWestMovePoint(bitmap: RobotBitmap, playerAnchor: { centerX: number; centerY: number }): { x: number; y: number } {
  const tilePx = getFreeMoveTilePx(playerAnchor);
  const westDistancePx = Math.max(
    Math.round(tilePx * FREE_MOVE_MIN_DISTANCE_TILES),
    Math.round(bitmap.width * WORKBENCH_NORTH_WEST_DISTANCE_RATIO_X),
  );
  const northDistancePx = Math.max(
    Math.round(tilePx * 2),
    Math.round(bitmap.height * WORKBENCH_NORTH_WEST_DISTANCE_RATIO_Y),
  );

  return {
    x: clamp(
      Math.round(playerAnchor.centerX - westDistancePx),
      CLICK_SAFE_EDGE_MARGIN_PX,
      bitmap.width - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
    ),
    y: clamp(
      Math.round(playerAnchor.centerY - northDistancePx),
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

    const agilityCourseClickPoint = getBoundsCenterPoint(nearestAgilityCourseMarker);
    const travel = estimateTravelWaitTicks(playerAnchor, agilityCourseClickPoint);
    const clicked = clickScreenPoint(
      captureBounds.x + agilityCourseClickPoint.centerX,
      captureBounds.y + agilityCourseClickPoint.centerY,
      captureBounds,
    );
    const clickedAtMs = Date.now();
    log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_AGILITY_COURSE,
        `Clicked randomized pixel inside FFCCFF00 yellow agility-course marker at (${clicked.x},${clicked.y}) local=(${agilityCourseClickPoint.centerX},${agilityCourseClickPoint.centerY}) bounds=(${nearestAgilityCourseMarker.minX},${nearestAgilityCourseMarker.minY})-${nearestAgilityCourseMarker.maxX},${nearestAgilityCourseMarker.maxY} pixels=${nearestAgilityCourseMarker.pixelCount}; waiting ${AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS} extra game tick(s) plus ${AGILITY_YELLOW_CLICK_EXTRA_BOT_TICKS} bot tick(s) before checking coordinate ${AGILITY_COURSE_TARGET_X},${AGILITY_COURSE_TARGET_Y} (${formatTravelEstimate(travel)}).`,
      ),
    );
    return {
      ...state,
      currentFunction: "waitAfterAgilityCourseYellowClick",
      phase: "wait-after-agility-course-yellow-click",
      agilityCourseYellowClickReadyAtMs: 0,
      agilityCourseYellowArrivalDeadlineMs:
        clickedAtMs +
        (travel.waitTicks + AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS) * GAME_TICK_MS +
        AGILITY_YELLOW_CLICK_EXTRA_BOT_TICKS * BOT_TICK_MS,
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
  const cameraNorthTapped = tapKey(AGILITY_CAMERA_NORTH_KEY);
  if (missingAgilityCourseTicks === 1 || missingAgilityCourseTicks % 3 === 0) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.CHECK_AGILITY_COURSE_COORDINATE,
        `Agility course coordinate is not ${AGILITY_COURSE_TARGET_X},${AGILITY_COURSE_TARGET_Y} yet; current='${location?.matchedLine ?? "unreadable"}' after yellow click distance=${state.agilityCourseYellowClickDistancePx === null ? "unknown" : `${Math.round(state.agilityCourseYellowClickDistancePx)}px`}. ${cameraNorthTapped ? `Tapped '${AGILITY_CAMERA_NORTH_KEY}'` : `Could not tap '${AGILITY_CAMERA_NORTH_KEY}'`} before rechecking yellow marker.`,
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
      miningCameraKReadyAtMs: 0,
      miningCameraKPrepared: false,
      miningAgilityCourseMarkerCache: null,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const orangeClickPoint = getBoundsCenterPoint(nearestOrange);
  const clicked = clickScreenPoint(captureBounds.x + orangeClickPoint.centerX, captureBounds.y + orangeClickPoint.centerY, captureBounds);
  const reclickDelayMs = getMiningOrangeReclickDelayMs();
  const clickedAtMs = Date.now();
  log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_MINING_NODE,
      `Clicked randomized pixel inside orange mining node marker at (${clicked.x},${clicked.y}) local=(${orangeClickPoint.centerX},${orangeClickPoint.centerY}) bounds=(${nearestOrange.minX},${nearestOrange.minY})-${nearestOrange.maxX},${nearestOrange.maxY} pixels=${nearestOrange.pixelCount}; checking green status again after ${formatDelaySeconds(reclickDelayMs)}.`,
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

  const orangeClickPoint = getBoundsCenterPoint(nearestOrange);
  const clicked = clickScreenPoint(captureBounds.x + orangeClickPoint.centerX, captureBounds.y + orangeClickPoint.centerY, captureBounds);
  const reclickDelayMs = getMiningOrangeReclickDelayMs();
  const clickedAtMs = Date.now();
  log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
      `Timer appeared (${parsedStartingSeconds ?? "unreadable"}s); re-clicked randomized pixel inside orange mining node at (${clicked.x},${clicked.y}) local=(${orangeClickPoint.centerX},${orangeClickPoint.centerY}) before mining; checking green status again after ${formatDelaySeconds(reclickDelayMs)}.`,
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
    pouchFillAvailableEssenceSlots: null,
    workbenchInventoryNoChangeWarnings: 0,
    craftingPouchesFilledThisCycle: false,
    finalPortalTeleportGraceDeadlineMs: 0,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
    miningTimerReliableReadCount: 0,
    miningTimerLocalStartSecondsRemaining: null,
    miningTimerLocalStartedAtMs: null,
    miningStatusGreenStartedAtMs: null,
    miningCameraKReadyAtMs: 0,
    miningCameraKPrepared: false,
    miningAgilityCourseMarkerCache: null,
    workbenchCameraNorthReadyAtMs: 0,
    workbenchCameraNorthPreparedThisClick: false,
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
  const cachedMarker = state.miningAgilityCourseMarkerCache;
  let yellowMarkers: ColoredMarkerDetection[] | null = null;
  let nearestYellowMarker = cachedMarker?.marker ?? null;
  let markerSource = cachedMarker ? "cached during mining" : "fresh";

  if (!nearestYellowMarker) {
    yellowMarkers = detectAllAgilityCourseMarkers(tickCapture.bitmap);
    nearestYellowMarker = pickNearestColoredMarker(yellowMarkers, playerAnchor);
    markerSource = "fresh";
  }

  if (!nearestYellowMarker) {
    const missingAgilityCourseTicks = state.missingAgilityCourseTicks + 1;
    if (missingAgilityCourseTicks === 1 || missingAgilityCourseTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
          `${reason}; no nearby FFCCFF00 yellow marker is visible yet. Candidates=${formatColoredMarkerCandidates(yellowMarkers ?? detectAllAgilityCourseMarkers(tickCapture.bitmap))}.`,
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

  const markerCache =
    cachedMarker ?? updateCachedMarker(null, nearestYellowMarker, nowMs, state.loopIndex);
  const readyAtMs = markerCache.firstSeenAtMs + AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
  const isCachedReady = isCachedMarkerSettled(markerCache, nowMs, AGILITY_YELLOW_PRE_CLICK_SETTLE_TICKS);

  if (!isCachedReady && state.agilityMiningYellowClickReadyAtMs === 0) {
    log(
      stepMessage(
        WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
        `${reason}; nearby FFCCFF00 yellow marker found (${markerSource}) at local=(${nearestYellowMarker.centerX},${nearestYellowMarker.centerY}); waiting ${Math.max(1, Math.ceil((readyAtMs - nowMs) / GAME_TICK_MS))} game tick(s) before clicking.`,
      ),
    );

    return {
      ...state,
      miningAgilityCourseMarkerCache: markerCache,
      agilityMiningYellowClickReadyAtMs: readyAtMs,
      missingAgilityCourseTicks: 0,
      actionLockUntilMs: readyAtMs,
    };
  }

  if (!isCachedReady && nowMs < state.agilityMiningYellowClickReadyAtMs) {
    return {
      ...state,
      miningAgilityCourseMarkerCache: markerCache,
      actionLockUntilMs: state.agilityMiningYellowClickReadyAtMs,
    };
  }

  const yellowClickPoint = getBoundsCenterPoint(nearestYellowMarker);
  const travel = estimateTravelWaitTicks(playerAnchor, yellowClickPoint);
  const clicked = clickScreenPoint(captureBounds.x + yellowClickPoint.centerX, captureBounds.y + yellowClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
      stepMessage(
        WORKFLOW_STEPS.AGILITY_COURSE_CLICK_YELLOW_AFTER_TIMER,
        `${reason}; clicked randomized pixel inside ${markerSource} FFCCFF00 yellow marker at (${clicked.x},${clicked.y}) local=(${yellowClickPoint.centerX},${yellowClickPoint.centerY}) bounds=(${nearestYellowMarker.minX},${nearestYellowMarker.minY})-${nearestYellowMarker.maxX},${nearestYellowMarker.maxY} pixels=${nearestYellowMarker.pixelCount}; waiting ${AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS} extra game tick(s) plus ${AGILITY_YELLOW_CLICK_EXTRA_BOT_TICKS} bot tick(s) before workbench search (${formatTravelEstimate(travel)}).`,
      ),
    );

  return {
    ...state,
    currentFunction: "waitAfterAgilityMiningYellowClick",
    phase: "wait-after-agility-mining-yellow-click",
    miningAgilityCourseMarkerCache: null,
    agilityMiningYellowClickReadyAtMs: 0,
    agilityMiningYellowArrivalDeadlineMs:
      clickedAtMs +
      (travel.waitTicks + AGILITY_YELLOW_CLICK_EXTRA_SETTLE_TICKS) * GAME_TICK_MS +
      AGILITY_YELLOW_CLICK_EXTRA_BOT_TICKS * BOT_TICK_MS,
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
  recordRunStatsWorkbenchTravel(travel, nowMs);
  rememberMovementObservation("workbench-click", WORKFLOW_STEPS.MOVE_TO_WORKBENCH, nowMs, travel);
  const pouchFillAvailableEssenceSlots = state.pouchFillAvailableEssenceSlots ?? startingInventoryFreeSlots;
  log(
    stepMessage(
      WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
      `Workbench clicked; checking inventory movement after travel (start free-space=${startingInventoryFreeSlots ?? "unknown"}, fillBudget=${pouchFillAvailableEssenceSlots ?? "unknown"}, ${formatTravelEstimate(travel)}); tapping '${WORKBENCH_CAMERA_NORTH_KEY}' after ${WORKBENCH_CAMERA_NORTH_DELAY_BOT_TICKS} bot tick(s).`,
    ),
  );
  return {
    ...state,
    currentFunction: "craft",
    phase: "crafting",
    actionLockUntilMs: nowMs + travel.waitTicks * GAME_TICK_MS,
    inventoryFreeSlots: startingInventoryFreeSlots,
    pouchFillAvailableEssenceSlots,
    missingInventoryCountTicks: 0,
    craftingInventoryChangeDeadlineMs: nowMs + travel.waitTicks * GAME_TICK_MS,
    workbenchCameraNorthReadyAtMs: nowMs + WORKBENCH_CAMERA_NORTH_DELAY_BOT_TICKS * BOT_TICK_MS,
    workbenchCameraNorthPreparedThisClick: false,
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

function shouldWaitForPortalBeforeWorkbenchGuardianFallback(
  state: BotState,
  timeSincePortal: GuardianOfTheRiftTimeSincePortalDetection,
): { wait: boolean; essenceCount: number; reason: string } {
  const essence = getWorkbenchEssenceEstimate(state);
  const portalIsClose = timeSincePortal.color === "yellow" || timeSincePortal.color === "red";
  if (!portalIsClose) {
    return {
      wait: false,
      essenceCount: essence.total,
      reason: `Last Portal is not yellow/red and ${formatWorkbenchEssenceEstimate(state)} (${formatTimeSincePortal(timeSincePortal)})`,
    };
  }

  if (essence.total < WORKBENCH_FALLBACK_MIN_ESSENCE_FOR_GUARDIAN) {
    return {
      wait: true,
      essenceCount: essence.total,
      reason: `Last Portal is ${timeSincePortal.color} and ${formatWorkbenchEssenceEstimate(state)} (${formatTimeSincePortal(timeSincePortal)})`,
    };
  }

  return {
    wait: false,
    essenceCount: essence.total,
    reason: `Last Portal is ${timeSincePortal.color}, but ${formatWorkbenchEssenceEstimate(state)} (${formatTimeSincePortal(timeSincePortal)})`,
  };
}

function formatRewardPoints(detection: GuardianOfTheRiftRewardPointsDetection): string {
  return `elemental=${detection.elementalPoints ?? "null"} catalytic=${detection.catalyticPoints ?? "null"} raw=${detection.rawText ?? "null"} focus=${detection.focus ?? "unknown"}`;
}

function unwindAltarCamera(
  state: BotState,
  step: (typeof WORKFLOW_STEPS)[keyof typeof WORKFLOW_STEPS],
  timing = "before red portal search",
): BotState {
  if (state.guardianAltarCameraLeftRotations <= 0) {
    return state;
  }

  let successfulTaps = 0;
  for (let i = 0; i < state.guardianAltarCameraLeftRotations; i += 1) {
    if (tapKey(GUARDIAN_ALTAR_CAMERA_UNWIND_KEY)) {
      successfulTaps += 1;
    }
  }

  log(
    stepMessage(
      step,
      `Returned camera toward pre-altar angle with ${successfulTaps}/${state.guardianAltarCameraLeftRotations} '${GUARDIAN_ALTAR_CAMERA_UNWIND_KEY}' tap(s) ${timing}.`,
    ),
  );

  return {
    ...state,
    guardianAltarCameraLeftRotations: 0,
  };
}

function getEndOfRoundDepositSignal(bitmap: RobotBitmap): string | null {
  const powerBar = detectGuardianOfTheRiftPowerBar(bitmap);
  const summary = `powerBar=${powerBar.fillColor} blue=${powerBar.bluePixels} yellow=${powerBar.yellowPixels} empty=${powerBar.emptyPixels} visible=${powerBar.visiblePixels}`;

  if (powerBar.fillColor === "blue") {
    return `Guardian Power bar is blue (${summary}); entering end-of-round deposit fallback.`;
  }

  if (powerBar.fillColor === "empty") {
    return `Guardian Power bar is grey/empty (${summary}); entering end-of-round deposit fallback.`;
  }

  if (powerBar.fillColor === "missing") {
    return `Guardian Power bar is no longer visible (${summary}); entering end-of-round deposit fallback.`;
  }

  return null;
}

function markEndOfRoundDepositModeIfNeeded(
  state: BotState,
  tickCapture: TickCapture,
  step: (typeof WORKFLOW_STEPS)[keyof typeof WORKFLOW_STEPS],
): BotState {
  if (state.endOfRoundDepositMode) {
    return state;
  }

  const signal = getEndOfRoundDepositSignal(tickCapture.bitmap);
  if (!signal) {
    return state.endOfRoundSignalTicks === 0
      ? state
      : {
          ...state,
          endOfRoundSignalTicks: 0,
        };
  }

  const endOfRoundSignalTicks = state.endOfRoundSignalTicks + 1;
  if (endOfRoundSignalTicks < END_OF_ROUND_SIGNAL_CONFIRMATION_TICKS) {
    warn(
      stepMessage(
        step,
        `${signal} Validation ${endOfRoundSignalTicks}/${END_OF_ROUND_SIGNAL_CONFIRMATION_TICKS}; waiting for another screenshot before enabling end-of-round fallback.`,
      ),
    );
    return {
      ...state,
      endOfRoundSignalTicks,
    };
  }

  warn(
    stepMessage(
      step,
      `${signal} Confirmed after ${endOfRoundSignalTicks}/${END_OF_ROUND_SIGNAL_CONFIRMATION_TICKS} validation screenshots.`,
    ),
  );
  return {
    ...state,
    endOfRoundDepositMode: true,
    endOfRoundSignalTicks: 0,
    postPortalDepositResume: null,
    openPortalAfterCurrentPostReturnAction: false,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
  };
}

function transitionToEndOfRoundChargedCellDepositState(state: BotState, nowMs: number, reason: string): BotState {
  setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
  warn(stepMessage(WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT, `${reason} End-of-round fallback: trying charged cell deposit next.`));
  return {
    ...state,
    endOfRoundDepositMode: true,
    endOfRoundSignalTicks: 0,
    currentFunction: "findChargedCellDeposit",
    phase: "find-charged-cell-deposit",
    postPortalDepositResume: null,
    openPortalAfterCurrentPostReturnAction: false,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    chargedCellToRuneCameraReadyAtMs: 0,
    chargedCellDepositPlayerTileFallbackPending: false,
    missingInventoryCountTicks: 0,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function transitionToEndOfRoundRuneDepositState(state: BotState, nowMs: number, reason: string): BotState {
  setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
  warn(stepMessage(WORKFLOW_STEPS.FIND_RUNE_DEPOSIT, `${reason} End-of-round fallback: trying rune deposit next.`));
  return {
    ...state,
    endOfRoundDepositMode: true,
    endOfRoundSignalTicks: 0,
    currentFunction: "findRuneDeposit",
    phase: "find-rune-deposit",
    postPortalDepositResume: null,
    openPortalAfterCurrentPostReturnAction: false,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    chargedCellToRuneCameraReadyAtMs: 0,
    chargedCellDepositPlayerTileFallbackPending: false,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    runeDepositCameraNorthReadyAtMs: 0,
    runeDepositCameraNorthPreparedThisClick: false,
    missingInventoryCountTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function transitionToRoundRestartState(state: BotState, nowMs: number, reason: string): BotState {
  setAutomateBotCurrentStep(STEP_PICK_UNCHARGED_CELL_ID);
  const cameraReset = tapKey(POST_RETURN_CAMERA_NORTH_KEY);
  log(
    stepMessage(
      WORKFLOW_STEPS.TAKE_UNCHARGED_CELL,
      `${reason} ${cameraReset ? `Tapped '${POST_RETURN_CAMERA_NORTH_KEY}'` : `Could not tap '${POST_RETURN_CAMERA_NORTH_KEY}'`} to reset camera north before restarting the full loop from uncharged-cell pickup.`,
    ),
  );
  rotateAutomateBotLogSession("gotr-round-restart");
  resetGuardianRunStats(nowMs);

  return {
    ...createInitialState(),
    loopIndex: state.loopIndex,
    pouchInventory: state.pouchInventory,
    inventoryFreeSlots: state.inventoryFreeSlots,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
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
      miningCameraKReadyAtMs: 0,
      miningCameraKPrepared: false,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const orangeClickPoint = getBoundsCenterPoint(nearestOrange);
  const clicked = clickScreenPoint(captureBounds.x + orangeClickPoint.centerX, captureBounds.y + orangeClickPoint.centerY, captureBounds);
  const reclickDelayMs = getMiningOrangeReclickDelayMs();
  const clickedAtMs = Date.now();
  log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
      `Mining ${statusReason} (${formatMiningStatus(miningStatus)}); re-clicked randomized pixel inside orange mining node at (${clicked.x},${clicked.y}) local=(${orangeClickPoint.centerX},${orangeClickPoint.centerY}) bounds=(${nearestOrange.minX},${nearestOrange.minY})-${nearestOrange.maxX},${nearestOrange.maxY}; checking green status again after ${formatDelaySeconds(reclickDelayMs)}.`,
      ),
    );

  return {
    ...state,
    miningOrangeReclicked: true,
    missingOrangeTicks: 0,
    miningStatusGreenStartedAtMs: null,
    miningCameraKReadyAtMs: 0,
    miningCameraKPrepared: false,
    miningAgilityCourseMarkerCache: null,
    actionLockUntilMs: clickedAtMs + reclickDelayMs,
  };
}

function runMiningTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);
  const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(tickCapture.bitmap);
  if (
    GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer" &&
    state.miningStatusGreenStartedAtMs === null &&
    timeSincePortal.color !== "white"
  ) {
    const missingMiningTimerTicks = state.missingMiningTimerTicks + 1;
    if (missingMiningTimerTicks === 1 || missingMiningTimerTicks % 5 === 0) {
      log(
        stepMessage(
          WORKFLOW_STEPS.START_MINING,
          `Optimizer mining start gate: waiting for Last Portal timer to turn white before re-clicking/starting mining. ${formatMiningStatus(miningStatus)}; time-since-portal=${formatTimeSincePortal(timeSincePortal)}.`,
        ),
      );
    }

    return {
      ...state,
      missingMiningTimerTicks,
      miningStatusGreenStartedAtMs: null,
      miningCameraKReadyAtMs: 0,
      miningCameraKPrepared: false,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

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
  const miningCameraKReadyAtMs = miningStatusJustTurnedGreen
    ? nowMs + MINING_CAMERA_WORKBENCH_DELAY_BOT_TICKS * BOT_TICK_MS
    : state.miningCameraKReadyAtMs;
  let currentState: BotState = {
    ...state,
    miningStatusGreenStartedAtMs,
    miningCameraKReadyAtMs,
    miningCameraKPrepared: miningStatusJustTurnedGreen ? false : state.miningCameraKPrepared,
    missingMiningTimerTicks: 0,
  };

  if (config.useAgilityCourse) {
    currentState = rememberMiningAgilityCourseMarker(currentState, nowMs, tickCapture.bitmap);
  }

  if (miningStatusJustTurnedGreen) {
    log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `Mining status turned green (${formatMiningStatus(miningStatus)}); starting local ${Math.round(MINING_STATUS_GREEN_MAX_DURATION_MS / 1000)}s mining timer and watching time-since-portal (${formatTimeSincePortal(timeSincePortal)}).`,
      ),
    );
  }

  if (
    !currentState.miningCameraKPrepared &&
    currentState.miningCameraKReadyAtMs > 0 &&
    nowMs >= currentState.miningCameraKReadyAtMs
  ) {
    const tapped = tapKey(MINING_CAMERA_WORKBENCH_KEY);
    log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `${tapped ? `Tapped '${MINING_CAMERA_WORKBENCH_KEY}'` : `Could not tap '${MINING_CAMERA_WORKBENCH_KEY}'`} to angle camera toward the workbench after ${MINING_CAMERA_WORKBENCH_DELAY_BOT_TICKS} bot tick(s) of confirmed mining.`,
      ),
    );
    currentState = {
      ...currentState,
      miningCameraKPrepared: true,
    };
  }

  if (timeSincePortal.rawText === null) {
    const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
    if (portalOpenIcon.isOpen) {
      const elapsedSeconds = Math.round(miningStatusGreenElapsedMs / 1000);
      return transitionToFinalPortalSearchState(
        currentState,
        nowMs,
        `Last Portal timer digits are not readable (${formatTimeSincePortal(timeSincePortal)}) after ${elapsedSeconds}s of local mining, and open portal icon is visible at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); searching for salmon portal.`,
      );
    }

    const missingFinalPortalOpenIconTicks = currentState.missingFinalPortalOpenIconTicks + 1;
    currentState = {
      ...currentState,
      missingFinalPortalOpenIconTicks,
    };

    if (missingFinalPortalOpenIconTicks === 1 || missingFinalPortalOpenIconTicks % 5 === 0) {
      const bestScore = portalOpenIcon.matches[0]?.score;
      warn(
        stepMessage(
          WORKFLOW_STEPS.START_MINING,
          `Last Portal timer digits are not readable (${formatTimeSincePortal(timeSincePortal)}), but open portal icon is not visible yet; continuing mining (attempt=${missingFinalPortalOpenIconTicks}, bestScore=${bestScore === undefined ? "none" : bestScore.toFixed(3)}, cache=${portalOpenIcon.cache.source}).`,
        ),
      );
    }
  } else if (currentState.missingFinalPortalOpenIconTicks !== 0) {
    currentState = {
      ...currentState,
      missingFinalPortalOpenIconTicks: 0,
    };
  }

  if (
    timeSincePortal.secondsElapsed !== null &&
    timeSincePortal.color !== "red" &&
    timeSincePortal.secondsElapsed >= MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS
  ) {
    const elapsedSeconds = Math.round(miningStatusGreenElapsedMs / 1000);
    startRunStatsMiningEndToWorkbench(nowMs);
    if (config.useAgilityCourse) {
      return clickAgilityCourseYellowBeforeWorkbench(
        {
          ...currentState,
        },
        nowMs,
        tickCapture,
        captureBounds,
        `Time since portal reached ${timeSincePortal.secondsElapsed}s (${formatTimeSincePortal(timeSincePortal)}) after ${elapsedSeconds}s of local mining; mining complete`,
      );
    }

    return transitionToWorkbenchState(
      {
        ...currentState,
      },
      `Time since portal reached ${timeSincePortal.secondsElapsed}s (${formatTimeSincePortal(timeSincePortal)}) after ${elapsedSeconds}s of local mining; searching for the magenta workbench marker.`,
    );
  }

  if (miningStatusGreenElapsedMs >= MINING_STATUS_GREEN_MAX_DURATION_MS) {
    const elapsedSeconds = Math.round(miningStatusGreenElapsedMs / 1000);
    startRunStatsMiningEndToWorkbench(nowMs);
    if (config.useAgilityCourse) {
      return clickAgilityCourseYellowBeforeWorkbench(
        {
          ...currentState,
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
        ...currentState,
      },
      `Mining status stayed green for ${Math.round(MINING_STATUS_GREEN_MAX_DURATION_MS / 1000)}s; searching for the magenta workbench marker.`,
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

  if (
    timeSincePortal.secondsElapsed !== null &&
    timeSincePortal.color === "red" &&
    timeSincePortal.secondsElapsed >= MINING_TIME_SINCE_PORTAL_THRESHOLD_SECONDS &&
    (miningStatusJustTurnedGreen || state.loopIndex % 5 === 0)
  ) {
    log(
      stepMessage(
        WORKFLOW_STEPS.START_MINING,
        `Ignoring red Last Portal timer at ${timeSincePortal.secondsElapsed}s (${formatTimeSincePortal(timeSincePortal)}); continuing local mining timer instead of leaving mining early.`,
      ),
    );
  }

  return {
    ...currentState,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function runWorkbenchFindYellowTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  config: GuardianOfTheRiftConfig,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  void config;

  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const portalCheck = checkWorkbenchOpenPortal(
    state,
    nowMs,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.FIND_WORKBENCH,
  );
  if (portalCheck.transitioned) {
    discardPendingMovementObservation("workbench-click");
    return portalCheck.state;
  }
  const currentState = portalCheck.state;

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const nearestWorkbenchMarker = pickNearestWorkbenchMarker(
    detectAllWorkbenchMagentaObjects(tickCapture.bitmap, WORKBENCH_MAGENTA_MIN_PIXELS),
    playerAnchor,
  );
  if (!nearestWorkbenchMarker) {
    const missingYellowTicks = currentState.missingYellowTicks + 1;
    const moveDirection = "north-west";
    const movePoint = getNorthWestMovePoint(tickCapture.bitmap, playerAnchor);
    const clicked = clickScreenPoint(captureBounds.x + movePoint.x, captureBounds.y + movePoint.y, captureBounds);
    const nextWestMoveClickCount = currentState.westMoveClickCount + 1;
    if (nextWestMoveClickCount === 1 || nextWestMoveClickCount % 3 === 0) {
      log(
        stepMessage(
          WORKFLOW_STEPS.FIND_WORKBENCH,
          `No magenta workbench marker found; moving ${moveDirection} via (${clicked.x},${clicked.y}) attempt=${nextWestMoveClickCount}.`,
        ),
      );
    }

    return {
      ...currentState,
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
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_WORKBENCH,
      `Clicked middle of magenta workbench marker at (${clicked.x},${clicked.y}) local=(${workbenchClickPoint.centerX},${workbenchClickPoint.centerY}) bounds=(${nearestWorkbenchMarker.minX},${nearestWorkbenchMarker.minY})-(${nearestWorkbenchMarker.maxX},${nearestWorkbenchMarker.maxY}) pixels=${nearestWorkbenchMarker.pixelCount}; inventory free-space before click=${inventoryBeforeClick.count ?? "unknown"}.`,
    ),
  );

  const travel = estimateTravelWaitTicks(playerAnchor, workbenchClickPoint);
  return transitionToCraftingState(
    {
      ...currentState,
      cachedWorkbenchMarker: nearestWorkbenchMarker,
    },
    clickedAtMs,
    travel,
    inventoryBeforeClick.count,
  );
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
    workbenchInventoryNoChangeWarnings: 0,
    workbenchCameraNorthReadyAtMs: 0,
    workbenchCameraNorthPreparedThisClick: false,
    workbenchLooseEssenceCount: 0,
    guardianArrivalDeadlineMs: 0,
    guardianClickDistancePx: null,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    guardianYellowArrivalDeadlineMs: 0,
    guardianYellowTravelEstimate: null,
    guardianYellowCorrectionRecordedDeadlineMs: null,
    guardianAltarLowFreeSlotRetryCount: 0,
    guardianAltarCameraLeftRotations: 0,
    altarPouchesEmptiedThisCycle: false,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    returnPortalCameraNorthReadyAtMs: 0,
    returnPortalCameraNorthPreparedThisClick: false,
    returnPortalRecoveryTarget: null,
    openPortalAfterCurrentPostReturnAction: false,
    postPortalDepositResume: null,
    endOfRoundDepositMode: false,
    endOfRoundSignalTicks: 0,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    chargedCellToRuneCameraReadyAtMs: 0,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    runeDepositCameraNorthReadyAtMs: 0,
    runeDepositCameraNorthPreparedThisClick: false,
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
    guardianAltarLowFreeSlotRetryCount: 0,
    guardianAltarCameraLeftRotations: 0,
    altarPouchesEmptiedThisCycle: false,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    returnPortalCameraNorthReadyAtMs: 0,
    returnPortalCameraNorthPreparedThisClick: false,
    returnPortalRecoveryTarget: null,
    openPortalAfterCurrentPostReturnAction: false,
    postPortalDepositResume: null,
    endOfRoundDepositMode: false,
    endOfRoundSignalTicks: 0,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    chargedCellToRuneCameraReadyAtMs: 0,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    runeDepositCameraNorthReadyAtMs: 0,
    runeDepositCameraNorthPreparedThisClick: false,
    missingGuardianGreenTicks: 0,
    missingGuardianYellowTicks: 0,
    missingGuardianReturnRedTicks: 0,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
  };
}

function transitionToStartupMiningState(
  state: BotState,
  miningStatus: MiningBoxStatusDetection,
  inventoryFreeSlots: number | null,
): BotState {
  const startedAtMs = Date.now();
  setAutomateBotCurrentStep(STEP_MINING_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.START_MINING,
      `Startup mining check detected green mining status (${formatMiningStatus(miningStatus)}); starting first mining phase monitor without clicking uncharged cell or orange mining marker, then preparing the workbench camera after ${MINING_CAMERA_WORKBENCH_DELAY_BOT_TICKS} bot tick(s).`,
    ),
  );

  return {
    ...state,
    currentFunction: "mine",
    phase: "mining",
    actionLockUntilMs: 0,
    inventoryFreeSlots,
    missingInventoryCountTicks: inventoryFreeSlots === null ? 1 : 0,
    missingTargetTicks: 0,
    missingOrangeTicks: 0,
    missingMiningTimerTicks: 0,
    miningOrangeReclicked: true,
    lastTimerSecondsRemaining: null,
    lastTimerObservedAtMs: null,
    miningTimerReliableReadCount: 0,
    miningTimerLocalStartSecondsRemaining: null,
    miningTimerLocalStartedAtMs: null,
    miningStatusGreenStartedAtMs: startedAtMs,
    miningCameraKReadyAtMs: startedAtMs + MINING_CAMERA_WORKBENCH_DELAY_BOT_TICKS * BOT_TICK_MS,
    miningCameraKPrepared: false,
    miningAgilityCourseMarkerCache: null,
    portalMiningExitPortalMarkerCache: null,
  };
}

function createStartupInitialState(
  bitmap: RobotBitmap,
  pouchInventory: GuardianOfTheRiftPouchInventoryMemory,
  validationBitmap: RobotBitmap | null = null,
): BotState {
  const state = {
    ...createInitialState(),
    pouchInventory,
  };
  const primaryLocation = readGuardianCoordinateLocation(bitmap);
  const validationLocation = validationBitmap ? readGuardianCoordinateLocation(validationBitmap) : primaryLocation;
  const decisionBitmap = validationBitmap ?? bitmap;
  const inventory = detectInventoryCount(decisionBitmap);
  const miningStatus = detectMiningBoxStatusInScreenshot(decisionBitmap);
  const rememberedPouches = getRememberedPouchLocations(state);
  const startupState =
    inventory.count === 0 && rememberedPouches.length > 0
      ? withRememberedPouchesAssumedFull({
          ...state,
          craftingPouchesFilledThisCycle: true,
        })
      : state;
  log(
    `Startup phase check: inventoryFreeSlots=${inventory.count ?? "null"} inventoryRaw=${inventory.rawText ?? "null"} mining=${formatMiningStatus(miningStatus)} primary=${formatGuardianCoordinateDebug(primaryLocation)} validation=${formatGuardianCoordinateDebug(validationLocation)}.`,
  );
  if (startupState.craftingPouchesFilledThisCycle && !state.craftingPouchesFilledThisCycle) {
    log(
      stepMessage(
        WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
        `Startup detected full inventory and ${rememberedPouches.length} remembered pouch(es); assuming pouch(es) are already full for the next altar cycle (${formatPouchEssenceSummary(startupState)}).`,
      ),
    );
  }

  if (miningStatus.status === "mining") {
    return transitionToStartupMiningState(startupState, miningStatus, inventory.count);
  }

  if (hasLeftGuardianCraftingAreaLocation(primaryLocation) && hasLeftGuardianCraftingAreaLocation(validationLocation)) {
    return transitionToGuardianRunecraftingState(
      {
        ...startupState,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: inventory.count === null ? 1 : 0,
      },
      validationLocation,
    );
  }

  if (
    (primaryLocation && primaryLocation.regionId !== GUARDIAN_CRAFTING_REGION_ID) ||
    (validationLocation && validationLocation.regionId !== GUARDIAN_CRAFTING_REGION_ID)
  ) {
    warn(
      `Startup outside-region read was not confirmed as an altar/return state after two coordinate checks; continuing normal arena startup. primary=${formatGuardianCoordinateDebug(primaryLocation)} validation=${formatGuardianCoordinateDebug(validationLocation)}.`,
    );
  }

  if (inventory.count === 0) {
    return transitionToGuardianTravelState({
      ...startupState,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
    });
  }

  setAutomateBotCurrentStep(STEP_PICK_UNCHARGED_CELL_ID);
  log(stepMessage(WORKFLOW_STEPS.TAKE_UNCHARGED_CELL, "Startup phase check selected uncharged-cell pickup."));
  return {
    ...startupState,
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: inventory.count === null ? 1 : 0,
  };
}

function runCraftingTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): BotState {
  let currentState = state;
  if (
    !currentState.workbenchCameraNorthPreparedThisClick &&
    currentState.workbenchCameraNorthReadyAtMs > 0 &&
    nowMs >= currentState.workbenchCameraNorthReadyAtMs
  ) {
    const tapped = tapKey(WORKBENCH_CAMERA_NORTH_KEY);
    log(
      stepMessage(
        WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
        `${tapped ? `Tapped '${WORKBENCH_CAMERA_NORTH_KEY}'` : `Could not tap '${WORKBENCH_CAMERA_NORTH_KEY}'`} to prepare camera north after waiting ${WORKBENCH_CAMERA_NORTH_DELAY_BOT_TICKS} bot tick(s) from the workbench click.`,
      ),
    );
    currentState = {
      ...currentState,
      workbenchCameraNorthPreparedThisClick: true,
    };
  }

  if (nowMs < currentState.actionLockUntilMs) {
    return currentState;
  }

  const portalCheck = checkWorkbenchOpenPortal(
    currentState,
    nowMs,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
  );
  if (portalCheck.transitioned) {
    return portalCheck.state;
  }
  currentState = portalCheck.state;

  const inventory = detectInventoryCount(tickCapture.bitmap);
  log(
    stepMessage(
      WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
      `Inventory free-space read while crafting: count=${inventory.count ?? "null"} raw=${inventory.rawText ?? "null"}.`,
    ),
  );

  if (inventory.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-crafting-inventory-count-${currentState.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
      warn(stepMessage(WORKFLOW_STEPS.CRAFT_UNTIL_FULL, `Inventory free-space unreadable; saved debug image to ${debugPath}.`));
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const craftedEssenceDelta =
    currentState.inventoryFreeSlots === null ? 0 : Math.max(0, currentState.inventoryFreeSlots - inventory.count);
  if (craftedEssenceDelta > 0) {
    currentState = {
      ...currentState,
      workbenchLooseEssenceCount: currentState.workbenchLooseEssenceCount + craftedEssenceDelta,
    };
  }

  if (inventory.count === 0) {
    resolvePendingMovementObservation("success", "workbench inventory reached full", nowMs, tickCapture.bitmap);
    const pouchesToFill = selectPouchesNeedingFill(currentState);
    if (!currentState.craftingPouchesFilledThisCycle && pouchesToFill.length > 0) {
      const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
      const refreshedWorkbenchMarker = pickNearestWorkbenchMarker(
        detectAllWorkbenchMagentaObjects(tickCapture.bitmap, WORKBENCH_MAGENTA_MIN_PIXELS),
        playerAnchor,
      );
      const fillState = refreshedWorkbenchMarker
        ? {
            ...currentState,
            cachedWorkbenchMarker: refreshedWorkbenchMarker,
          }
        : currentState;
      setAutomateBotCurrentStep(STEP_FILL_POUCHES_ID);
      log(
        stepMessage(
          WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
          `Inventory is full after workbench and ${pouchesToFill.length} pouch(es) still need essence; filling pouch batch ${formatPouchClickList(pouchesToFill)} small-to-large before reclicking workbench. Fill budget=${fillState.pouchFillAvailableEssenceSlots ?? "unknown"} essence slot(s); ${formatWorkbenchEssenceEstimate(fillState)}. cachedWorkbench=${refreshedWorkbenchMarker ? `refreshed (${refreshedWorkbenchMarker.centerX},${refreshedWorkbenchMarker.centerY})` : fillState.cachedWorkbenchMarker ? "previous" : "none"}.`,
        ),
      );

      return {
        ...fillState,
        currentFunction: "fillPouchesAfterWorkbenchFull",
        phase: "fill-pouches-after-workbench-full",
        pouchClickQueue: pouchesToFill,
        pouchClickIndex: 0,
        pouchClickIntent: "fill",
        pouchClickPending: null,
        pouchClickBatchMovedEssence: 0,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: 0,
        craftingInventoryChangeDeadlineMs: 0,
        workbenchInventoryNoChangeWarnings: 0,
        missingYellowTicks: 0,
        actionLockUntilMs: 0,
      };
    }

    return transitionToGuardianTravelState({
      ...currentState,
      inventoryFreeSlots: inventory.count,
      pouchFillAvailableEssenceSlots: null,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      workbenchInventoryNoChangeWarnings: 0,
    });
  }

  if (currentState.inventoryFreeSlots === null) {
    return {
      ...currentState,
      inventoryFreeSlots: inventory.count,
      pouchFillAvailableEssenceSlots: currentState.pouchFillAvailableEssenceSlots ?? inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: nowMs + WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
      workbenchInventoryNoChangeWarnings: 0,
      craftingPouchesFilledThisCycle: hasPouchesNeedingFill(currentState) ? false : currentState.craftingPouchesFilledThisCycle,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventory.count !== currentState.inventoryFreeSlots) {
    resolvePendingMovementObservation("success", "workbench inventory changed after workbench click", nowMs, tickCapture.bitmap);
    log(
      stepMessage(
        WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
        `Inventory free-space changed: ${currentState.inventoryFreeSlots} -> ${inventory.count}; craftedEssenceDelta=${craftedEssenceDelta}; ${formatWorkbenchEssenceEstimate(currentState)}.`,
      ),
    );
    return {
      ...currentState,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: nowMs + WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
      workbenchInventoryNoChangeWarnings: 0,
      craftingPouchesFilledThisCycle: hasPouchesNeedingFill(currentState) ? false : currentState.craftingPouchesFilledThisCycle,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (currentState.craftingInventoryChangeDeadlineMs > 0 && nowMs >= currentState.craftingInventoryChangeDeadlineMs) {
    resolvePendingMovementObservation("late", "workbench inventory did not change by deadline", nowMs, tickCapture.bitmap);
    const workbenchInventoryNoChangeWarnings = currentState.workbenchInventoryNoChangeWarnings + 1;
    const noChangeMessage = `Inventory free-space stayed at ${inventory.count} through the crafting wait deadline (${workbenchInventoryNoChangeWarnings}/${WORKBENCH_INVENTORY_NO_CHANGE_MAX_WARNINGS}).`;
    if (workbenchInventoryNoChangeWarnings >= WORKBENCH_INVENTORY_NO_CHANGE_MAX_WARNINGS) {
      const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(tickCapture.bitmap);
      const endAwareState = markEndOfRoundDepositModeIfNeeded(currentState, tickCapture, WORKFLOW_STEPS.CRAFT_UNTIL_FULL);
      if (endAwareState.endOfRoundDepositMode) {
        return transitionToRoundRestartState(
          {
            ...endAwareState,
            inventoryFreeSlots: inventory.count,
            missingInventoryCountTicks: 0,
            craftingInventoryChangeDeadlineMs: 0,
            workbenchInventoryNoChangeWarnings,
          },
          nowMs,
          `${noChangeMessage} End-of-round was detected during workbench fallback; restarting instead of clicking guardian.`,
        );
      }

      if (endAwareState.endOfRoundSignalTicks !== currentState.endOfRoundSignalTicks) {
        return {
          ...endAwareState,
          inventoryFreeSlots: inventory.count,
          missingInventoryCountTicks: 0,
          craftingInventoryChangeDeadlineMs: nowMs + WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
          workbenchInventoryNoChangeWarnings,
          actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      const portalWaitDecision = shouldWaitForPortalBeforeWorkbenchGuardianFallback(endAwareState, timeSincePortal);
      if (portalWaitDecision.wait) {
        warn(
          stepMessage(
            WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
            `${noChangeMessage} ${portalWaitDecision.reason}; staying in workbench wait for salmon portal instead of clicking guardian.`,
          ),
        );
        return {
          ...endAwareState,
          inventoryFreeSlots: inventory.count,
          missingInventoryCountTicks: 0,
          craftingInventoryChangeDeadlineMs: nowMs + WORKBENCH_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
          workbenchInventoryNoChangeWarnings,
          actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      warn(
        stepMessage(
          WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
          `${noChangeMessage} ${portalWaitDecision.reason}; going to guardian finding instead of re-clicking workbench again.`,
        ),
      );
      return transitionToGuardianTravelState(
        {
          ...endAwareState,
          inventoryFreeSlots: inventory.count,
          missingInventoryCountTicks: 0,
          craftingInventoryChangeDeadlineMs: 0,
          workbenchInventoryNoChangeWarnings,
        },
        `${noChangeMessage} ${portalWaitDecision.reason}; searching for the active guardian outline.`,
      );
    }

    setAutomateBotCurrentStep(STEP_WORKBENCH_ID);
    warn(
      stepMessage(
        WORKFLOW_STEPS.CRAFT_UNTIL_FULL,
        `${noChangeMessage} Re-clicking workbench marker.`,
      ),
    );
    return {
      ...currentState,
      currentFunction: "workbenchFindYellow",
      phase: "workbench-find-yellow",
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      workbenchInventoryNoChangeWarnings,
      missingYellowTicks: 0,
      actionLockUntilMs: 0,
    };
  }

  return {
    ...currentState,
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function runFillPouchesAfterWorkbenchFullTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  let currentState = state;
  if (currentState.pouchClickPending) {
    const inventory = detectInventoryCount(tickCapture.bitmap);
    if (inventory.count === null) {
      const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
      if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
        const debugPath = `test-image-debug/guardian-fill-pouch-workbench-inventory-${currentState.loopIndex}.png`;
        saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
        warn(
          stepMessage(
            WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
            `Inventory free-space unreadable after ${currentState.pouchClickPending.pouch} pouch fill click; saved debug image to ${debugPath}.`,
          ),
        );
      }

      return {
        ...currentState,
        missingInventoryCountTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    const pendingClick = currentState.pouchClickPending;
    const result = updatePouchEssenceAfterInventoryDelta(currentState, pendingClick, inventory.count);
    currentState = result.state;
    log(
      stepMessage(
        WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
        `Pouch fill verification for ${pendingClick.pouch}: free-space ${pendingClick.beforeFreeSlots} -> ${inventory.count}, observedFreedSlots=${result.delta}; marked ${pendingClick.pouch} full deterministically; ${formatWorkbenchEssenceEstimate(currentState)}.`,
      ),
    );
  }

  if (currentState.pouchClickIndex < currentState.pouchClickQueue.length) {
    return clickNextPouchForInventoryDelta(
      currentState,
      captureBounds,
      nowMs,
      WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
      "fill",
    );
  }

  const filledPouchCount = currentState.pouchClickQueue.length;
  const movedEssence = currentState.pouchClickBatchMovedEssence;
  const allRememberedPouchesFull = !hasPouchesNeedingFill(currentState);
  setAutomateBotCurrentStep(STEP_WORKBENCH_ID);
  log(
    stepMessage(
      WORKFLOW_STEPS.FILL_POUCHES_AFTER_WORKBENCH_FULL,
      `Finished filling ${filledPouchCount} pouch click(s), moved=${movedEssence}; keeping phase fill budget=${currentState.pouchFillAvailableEssenceSlots ?? "unknown"}; ${allRememberedPouchesFull ? "all remembered pouches are now full" : "some pouches still need essence"}; ${formatWorkbenchEssenceEstimate(currentState)}. ${currentState.cachedWorkbenchMarker ? "Clicking cached workbench marker after final pouch validation." : "No cached workbench marker is available; waiting one game tick before returning to workbench marker search."}`,
    ),
  );

  const reclickedWorkbench = clickCachedWorkbenchAfterPouchFill(currentState, tickCapture, captureBounds);
  if (reclickedWorkbench) {
    return reclickedWorkbench;
  }

  return {
    ...currentState,
    ...resetPouchClickQueue(),
    currentFunction: "workbenchFindYellow",
    phase: "workbench-find-yellow",
    inventoryFreeSlots: null,
    pouchFillAvailableEssenceSlots: currentState.pouchFillAvailableEssenceSlots,
    missingInventoryCountTicks: 0,
    craftingInventoryChangeDeadlineMs: 0,
    workbenchInventoryNoChangeWarnings: 0,
    missingYellowTicks: 0,
    craftingPouchesFilledThisCycle: true,
    actionLockUntilMs: nowMs + POUCH_POST_SEQUENCE_SETTLE_MS,
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
    const shouldRotateCamera = shouldRotateCameraForMissingGuardianTarget(guardianTargetSelection, config);
    const rotated = shouldRotateCamera ? tapKey(GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY) : false;
    if (missingGuardianGreenTicks === 1 || missingGuardianGreenTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_GUARDIAN,
          `Guardian decision: ${formatGuardianDecision(guardianTargetSelection)}. No enabled active guardian target found; ${
            shouldRotateCamera
              ? rotated
                ? `tapped '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}' to rotate camera`
                : `could not tap '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}' to rotate camera`
              : "waiting without guardian click"
          } before retry ${missingGuardianGreenTicks}.`,
        ),
      );
    }

    return {
      ...state,
      missingGuardianGreenTicks,
      actionLockUntilMs:
        nowMs + (shouldRotateCamera ? GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS : FAST_ACTION_RETRY_MS),
    };
  }

  const target = guardianTargetSelection.target;
  if (!isGuardianClickPointSafelyOnScreen(tickCapture.bitmap, target.clickPoint)) {
    const missingGuardianGreenTicks = state.missingGuardianGreenTicks + 1;
    const rotated = tapKey(GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY);
    warn(
      stepMessage(
        WORKFLOW_STEPS.FIND_GUARDIAN,
        `Guardian decision: ${formatGuardianDecision(guardianTargetSelection)}. Enabled ${target.slot} guardian (${target.runeMatch.rune}) click point is too close to the screen edge for a safe click; ${rotated ? `tapped '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}'` : "waiting"} before retry ${missingGuardianGreenTicks}.`,
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
  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_GUARDIAN,
      `Guardian decision: ${formatGuardianDecision(guardianTargetSelection)}.`,
    ),
  );
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
  rememberMovementObservation("guardian-to-altar", WORKFLOW_STEPS.MOVE_TO_GUARDIAN, clickedAtMs, travel);

  return {
    ...state,
    currentFunction: "waitAfterGuardianClick",
    phase: "wait-after-guardian-click",
    guardianArrivalDeadlineMs: getGuardianTeleportRetryDeadlineMs(clickedAtMs, travel),
    guardianClickDistancePx: travel.distancePx,
    guardianCoordinateConfirmed: false,
    guardianAltarStartLocation: null,
    guardianAltarCameraLeftRotations: 0,
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
    resolvePendingMovementObservation("success", "altar marker visible after guardian click", nowMs, tickCapture.bitmap);
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
    resolvePendingMovementObservation("late", "still in crafting region after guardian travel deadline", nowMs, tickCapture.bitmap);
    const unconfirmedState = state.guardianCoordinateConfirmed
      ? {
          ...state,
          guardianCoordinateConfirmed: false,
          guardianAltarStartLocation: null,
        }
      : state;

    if (state.guardianCoordinateConfirmed) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
          `Altar search safety recheck no longer confirms altar region; current chunk=${guardianLocation.chunkId ?? "unknown"} region=${guardianLocation.regionId ?? "unknown"} matched='${guardianLocation.matchedLine ?? "null"}'${guardianLocation.nearCraftingArea ? " and coordinate is still near the GOTR arena" : ""}. Treating the previous teleport confirmation as a bad read and returning to guardian re-click checks.`,
        ),
      );
    }

    const guardianTargetSelection = selectGuardianTravelTarget(
      tickCapture.bitmap,
      config,
      activeRuneTemplates,
      unconfirmedState.unknownRewardNextGuardianSlot,
    );
    if (guardianTargetSelection.target) {
      const target = guardianTargetSelection.target;
      if (!isGuardianClickPointSafelyOnScreen(tickCapture.bitmap, target.clickPoint)) {
        const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
        const rotated = tapKey(GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY);
        warn(
          stepMessage(
            WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
            `Guardian re-click decision: ${formatGuardianDecision(guardianTargetSelection)}. Still in crafting region after guardian travel deadline, but ${target.slot} guardian (${target.runeMatch.rune}) click point is too close to the screen edge for a safe re-click; ${rotated ? `tapped '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}'` : "waiting"} before retry ${missingGuardianYellowTicks}.`,
          ),
        );

        return {
          ...unconfirmedState,
          missingGuardianYellowTicks,
          actionLockUntilMs: nowMs + GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
        };
      }

      const travel = estimateTravelWaitTicks(playerAnchor, target.clickPoint);
      log(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
          `Guardian re-click decision: ${formatGuardianDecision(guardianTargetSelection)}.`,
        ),
      );
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
      rememberMovementObservation("guardian-to-altar", WORKFLOW_STEPS.MOVE_TO_GUARDIAN, clickedAtMs, travel);

      return {
        ...unconfirmedState,
        guardianArrivalDeadlineMs: getGuardianTeleportRetryDeadlineMs(clickedAtMs, travel),
        guardianClickDistancePx: travel.distancePx,
        guardianCoordinateConfirmed: false,
        guardianAltarStartLocation: null,
        guardianAltarCameraLeftRotations: 0,
        unknownRewardNextGuardianSlot: getOppositeGuardianSlot(target.slot),
        actionLockUntilMs: clickedAtMs + GUARDIAN_CLICK_LOCK_TICKS * GAME_TICK_MS,
      };
    }

    const missingGuardianYellowTicks = state.missingGuardianYellowTicks + 1;
    const shouldRotateCamera = shouldRotateCameraForMissingGuardianTarget(guardianTargetSelection, config);
    const rotated = shouldRotateCamera ? tapKey(GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY) : false;
    if (missingGuardianYellowTicks === 1 || missingGuardianYellowTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_TO_ALTAR,
          `Guardian re-click decision: ${formatGuardianDecision(guardianTargetSelection)}. Teleport out of crafting region not confirmed yet; current chunk=${guardianLocation.chunkId ?? "unknown"} region=${guardianLocation.regionId ?? "unknown"} matched='${guardianLocation.matchedLine ?? "null"}'. No enabled guardian target is available for re-click; ${
            shouldRotateCamera
              ? rotated
                ? `tapped '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}' to rotate camera`
                : `could not tap '${GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_KEY}' to rotate camera`
              : "waiting without camera rotate"
          }.`,
        ),
      );
    }

    return {
      ...unconfirmedState,
      missingGuardianYellowTicks,
      actionLockUntilMs:
        nowMs + (shouldRotateCamera ? GUARDIAN_GREEN_OUTLINE_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS : FAST_ACTION_RETRY_MS),
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
    resolvePendingMovementObservation("success", "coordinate left crafting region after guardian click", nowMs, tickCapture.bitmap);
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
          `Altar marker not visible in region ${guardianLocation.regionId ?? "unknown"}; ${rotated ? `tapped '${GUARDIAN_ALTAR_CAMERA_ROTATE_KEY}' and waiting ${GUARDIAN_ALTAR_CAMERA_ROTATE_SETTLE_BOT_TICKS} bot tick(s) for the camera to settle` : `could not tap '${GUARDIAN_ALTAR_CAMERA_ROTATE_KEY}'`} before retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS}. ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}.`,
        ),
      );

      return {
        ...confirmedState,
        missingGuardianYellowTicks,
        guardianAltarCameraLeftRotations: confirmedState.guardianAltarCameraLeftRotations + (rotated ? 1 : 0),
        actionLockUntilMs: rotated
          ? nowMs + GUARDIAN_ALTAR_CAMERA_ROTATE_SETTLE_BOT_TICKS * BOT_TICK_MS
          : nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (missingGuardianYellowTicks <= GUARDIAN_ALTAR_SEARCH_RETRY_TICKS) {
      if (missingGuardianYellowTicks === 1 || missingGuardianYellowTicks % 3 === 0) {
        warn(
          stepMessage(
            WORKFLOW_STEPS.FIND_ALTAR,
            `Altar marker not visible yet after teleport; scene may still be loading. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}.`,
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
      `Teleport confirmed, but no altar marker was found after ${missingGuardianYellowTicks} check(s). ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}. Stopping bot.`,
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
  const altarClickPoint = getBoundsCenterPoint(nearestYellow);
  const travel = estimateTravelWaitTicks(playerAnchor, altarClickPoint);
  const clicked = clickScreenPoint(
    captureBounds.x + altarClickPoint.centerX,
    captureBounds.y + altarClickPoint.centerY,
    captureBounds,
  );
  const clickedAtMs = Date.now();
  log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_ALTAR,
      `Clicked randomized pixel inside ${nearestYellow.markerColor} altar marker at (${clicked.x},${clicked.y}) local=(${altarClickPoint.centerX},${altarClickPoint.centerY}) bounds=(${nearestYellow.minX},${nearestYellow.minY})-${nearestYellow.maxX},${nearestYellow.maxY} size=${nearestYellow.width}x${nearestYellow.height} pixels=${nearestYellow.pixelCount}; altar-start coordinate='${altarStartLocation?.matchedLine ?? "unknown"}'; waiting before checking inventory (${formatTravelEstimate(travel)}).`,
      ),
    );
  rememberMovementObservation("altar-click", WORKFLOW_STEPS.MOVE_TO_ALTAR, clickedAtMs, travel);

  const nextState: BotState = {
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

  return shouldEmptyPouchesAtAltar(state)
    ? nextState
    : unwindAltarCamera(nextState, WORKFLOW_STEPS.MOVE_TO_ALTAR, "during altar travel");
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
    resolvePendingMovementObservation("late", "inventory free-space still 0 after altar travel deadline", nowMs, tickCapture.bitmap);
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
              `Inventory free-space is still 0 and altar marker is not visible yet; scene may still be loading. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}.`,
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

      const cameraRotateRetryLimit = GUARDIAN_ALTAR_SEARCH_RETRY_TICKS + GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS;
      if (missingGuardianYellowTicks <= cameraRotateRetryLimit) {
        const rotationAttempt = missingGuardianYellowTicks - GUARDIAN_ALTAR_SEARCH_RETRY_TICKS;
        const rotated = tapKey(GUARDIAN_ALTAR_CAMERA_ROTATE_KEY);
        warn(
          stepMessage(
            WORKFLOW_STEPS.MOVE_TO_ALTAR,
            `Inventory free-space is still 0 and no altar marker was accepted after ${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS} retry tick(s); ${rotated ? `tapped '${GUARDIAN_ALTAR_CAMERA_ROTATE_KEY}' and waiting ${GUARDIAN_ALTAR_CAMERA_ROTATE_SETTLE_BOT_TICKS} bot tick(s) for the camera to settle` : `could not tap '${GUARDIAN_ALTAR_CAMERA_ROTATE_KEY}'`} before altar retry rotation ${rotationAttempt}/${GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS}. ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}.`,
          ),
        );

        return {
          ...correctedState,
          inventoryFreeSlots: inventory.count,
          missingGuardianYellowTicks,
          guardianAltarCameraLeftRotations: correctedState.guardianAltarCameraLeftRotations + (rotated ? 1 : 0),
          actionLockUntilMs: rotated
            ? nowMs + GUARDIAN_ALTAR_CAMERA_ROTATE_SETTLE_BOT_TICKS * BOT_TICK_MS
            : nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      const finalSearchRetryLimit = cameraRotateRetryLimit + GUARDIAN_ALTAR_SEARCH_RETRY_TICKS;
      if (missingGuardianYellowTicks <= finalSearchRetryLimit) {
        const finalRetry = missingGuardianYellowTicks - cameraRotateRetryLimit;
        if (finalRetry === 1 || finalRetry % 3 === 0) {
          warn(
            stepMessage(
              WORKFLOW_STEPS.MOVE_TO_ALTAR,
              `Inventory free-space is still 0 and altar marker is still not visible after camera rotations. Final retry ${finalRetry}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}.`,
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
        `Inventory free-space is still 0, but no altar marker was found after ${missingGuardianYellowTicks} check(s), including ${GUARDIAN_ALTAR_CAMERA_ROTATE_MAX_ATTEMPTS} camera rotation(s). ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}. Stopping bot.`,
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
    const altarClickPoint = getBoundsCenterPoint(nearestYellow);
    const travel = estimateTravelWaitTicks(playerAnchor, altarClickPoint);
    const clicked = clickScreenPoint(
      captureBounds.x + altarClickPoint.centerX,
      captureBounds.y + altarClickPoint.centerY,
      captureBounds,
    );
    const clickedAtMs = Date.now();
    log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_ALTAR,
        `Inventory free-space is still 0; clicked randomized pixel inside ${nearestYellow.markerColor} altar marker at (${clicked.x},${clicked.y}) local=(${altarClickPoint.centerX},${altarClickPoint.centerY}) bounds=(${nearestYellow.minX},${nearestYellow.minY})-${nearestYellow.maxX},${nearestYellow.maxY} size=${nearestYellow.width}x${nearestYellow.height} pixels=${nearestYellow.pixelCount}; altar-start coordinate='${altarStartLocation?.matchedLine ?? "unknown"}'; waiting before checking inventory again (${formatTravelEstimate(travel)}).`,
      ),
    );
    rememberMovementObservation("altar-click", WORKFLOW_STEPS.MOVE_TO_ALTAR, clickedAtMs, travel);

    const nextState: BotState = {
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

    return shouldEmptyPouchesAtAltar(correctedState)
      ? nextState
      : unwindAltarCamera(nextState, WORKFLOW_STEPS.MOVE_TO_ALTAR, "during altar travel");
  }

  resolvePendingMovementObservation("success", "inventory free-space changed after altar click", nowMs, tickCapture.bitmap);
  const altarCraftState = withObservedAltarCraftedRunes(state, state.inventoryFreeSlots, inventory.count);

  if (shouldEmptyPouchesAtAltar(altarCraftState)) {
    const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
    const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
    if (!nearestYellow) {
      const missingGuardianYellowTicks = altarCraftState.missingGuardianYellowTicks + 1;
      if (missingGuardianYellowTicks <= GUARDIAN_ALTAR_SEARCH_RETRY_TICKS) {
        warn(
          stepMessage(
            WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
            `Inventory free-space changed to ${inventory.count} after first altar click and pouches were filled this cycle, but altar marker is not visible yet. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}.`,
          ),
        );

        return {
          ...altarCraftState,
          inventoryFreeSlots: inventory.count,
          missingInventoryCountTicks: 0,
          missingGuardianYellowTicks,
          actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      const message = stepMessage(
        WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
        `Inventory free-space changed to ${inventory.count} after first altar click and pouches were filled this cycle, but no altar marker was found after ${missingGuardianYellowTicks} check(s). ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}. Stopping bot.`,
      );
      warn(message);
      notifyUserAndStop(message);
      return {
        ...altarCraftState,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: 0,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    const pouchBatch = selectAltarPouchEmptyBatch(altarCraftState, inventory.count);
    if (pouchBatch.length === 0) {
      const baselineState = unwindAltarCamera(
        withPostAltarInventoryBaseline(
          {
            ...altarCraftState,
            altarPouchesEmptiedThisCycle: true,
          },
          inventory.count,
        ),
        WORKFLOW_STEPS.FIND_PORTAL,
      );

      log(
        stepMessage(
          WORKFLOW_STEPS.FIND_PORTAL,
          `Inventory free-space changed to ${inventory.count}, but no pouch batch can be safely emptied. Saved altar baseline before return-portal search. Pending altar runes=${formatRuneEstimateRange(baselineState.altarCraftedRunesPendingLowerBound, baselineState.altarCraftedRunesPendingUpperBound)}. Pouch memory=${formatPouchEssenceSummary(baselineState)}.`,
        ),
      );

      return {
        ...baselineState,
        ...resetPouchClickQueue(),
        currentFunction: "findReturnPortal",
        phase: "find-return-portal",
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: 0,
        missingGuardianReturnRedTicks: 0,
        guardianYellowTravelEstimate: null,
        guardianYellowCorrectionRecordedDeadlineMs: null,
        guardianAltarLowFreeSlotRetryCount: 0,
        returnPortalRecoveryTarget: null,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    setAutomateBotCurrentStep(STEP_ALTAR_POUCHES_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
        `Inventory free-space changed to ${inventory.count} after altar click; emptying pouch batch ${formatPouchClickList(pouchBatch)} with capacity sum=${pouchBatch.reduce((sum, location) => sum + (getPouchStoredEssence(altarCraftState, location.pouch) ?? getPouchCapacity(location.pouch)), 0)} before clicking altar again. Pending altar runes=${formatRuneEstimateRange(altarCraftState.altarCraftedRunesPendingLowerBound, altarCraftState.altarCraftedRunesPendingUpperBound)}. Pouch memory=${formatPouchEssenceSummary(altarCraftState)}.`,
      ),
    );

    return {
      ...altarCraftState,
      currentFunction: "emptyPouchesAtAltar",
      phase: "empty-pouches-at-altar",
      pouchClickQueue: pouchBatch,
      pouchClickIndex: 0,
      pouchClickIntent: "empty",
      pouchClickPending: null,
      pouchClickBatchMovedEssence: 0,
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      missingGuardianYellowTicks: 0,
      guardianAltarLowFreeSlotRetryCount: 0,
      actionLockUntilMs: 0,
    };
  }

  const baselineState = unwindAltarCamera(
    withPostAltarInventoryBaseline(altarCraftState, inventory.count),
    WORKFLOW_STEPS.FIND_PORTAL,
  );

  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_PORTAL,
      `Inventory free-space changed to ${inventory.count}; saved as altar baseline before switching to ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal search. Pending altar runes=${formatRuneEstimateRange(baselineState.altarCraftedRunesPendingLowerBound, baselineState.altarCraftedRunesPendingUpperBound)}. Inventory history=${formatInventoryHistory(baselineState.inventoryHistory)}.`,
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
    guardianAltarLowFreeSlotRetryCount: 0,
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

  let currentState = state;
  if (currentState.pouchClickPending) {
    const inventory = detectInventoryCount(tickCapture.bitmap);
    if (inventory.count === null) {
      const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
      if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
        const debugPath = `test-image-debug/guardian-empty-pouch-altar-inventory-${currentState.loopIndex}.png`;
        saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
        warn(
          stepMessage(
            WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
            `Inventory free-space unreadable after ${currentState.pouchClickPending.pouch} pouch empty click; saved debug image to ${debugPath}.`,
          ),
        );
      }

      return {
        ...currentState,
        missingInventoryCountTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    const pendingClick = currentState.pouchClickPending;
    const result = updatePouchEssenceAfterInventoryDelta(currentState, pendingClick, inventory.count);
    currentState = result.state;
    log(
      stepMessage(
        WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
        `Pouch empty verification for ${pendingClick.pouch}: free-space ${pendingClick.beforeFreeSlots} -> ${inventory.count}, observedMoved=${result.delta}; marked ${pendingClick.pouch} empty deterministically; pouch memory=${formatPouchEssenceSummary(currentState)}.`,
      ),
    );
  }

  if (currentState.pouchClickIndex < currentState.pouchClickQueue.length) {
    return clickNextPouchForInventoryDelta(
      currentState,
      captureBounds,
      nowMs,
      WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
      "empty",
    );
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const altarCandidates = detectGuardianOfTheRiftAltarMarkersInScreenshot(tickCapture.bitmap);
  const nearestYellow = pickNearestGuardianOfTheRiftAltarMarker(altarCandidates, playerAnchor);
  if (!nearestYellow) {
    const missingGuardianYellowTicks = currentState.missingGuardianYellowTicks + 1;
    if (missingGuardianYellowTicks <= GUARDIAN_ALTAR_SEARCH_RETRY_TICKS) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
          `Finished pouch batch, but altar marker is not visible for the next altar click. Retry ${missingGuardianYellowTicks}/${GUARDIAN_ALTAR_SEARCH_RETRY_TICKS}. ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}.`,
        ),
      );

      return {
        ...currentState,
        missingGuardianYellowTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    const message = stepMessage(
      WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
      `Finished pouch batch, but no altar marker was found after ${missingGuardianYellowTicks} check(s). ${formatAltarMarkerSearchDiagnostics(tickCapture.bitmap, altarCandidates)}. Stopping bot.`,
    );
    warn(message);
    notifyUserAndStop(message);
    return {
      ...currentState,
      missingGuardianYellowTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const morePouchesAfterThisDeposit = hasPouchesToEmpty(currentState);
  log(
    stepMessage(
      WORKFLOW_STEPS.EMPTY_POUCHES_AT_ALTAR,
      `Finished pouch batch moved=${currentState.pouchClickBatchMovedEssence}; clicking altar again${morePouchesAfterThisDeposit ? " before the next pouch batch" : " before return-portal search"}. Pouch memory=${formatPouchEssenceSummary(currentState)}.`,
    ),
  );

  return clickGuardianAltarMarker(
    {
      ...currentState,
      ...resetPouchClickQueue(),
      missingGuardianYellowTicks: 0,
      altarPouchesEmptiedThisCycle: !morePouchesAfterThisDeposit,
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
    returnPortalCameraNorthReadyAtMs: 0,
    returnPortalCameraNorthPreparedThisClick: false,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingGuardianReturnRedTicks: 0,
    returnPortalLastBadCoordinateKey: null,
    returnPortalRepeatedBadCoordinateReads: 0,
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
    const location = readGuardianCoordinateLocation(tickCapture.bitmap);
    if (state.returnPortalRecoveryTarget === "finalPortal" && location?.regionId === GUARDIAN_CRAFTING_REGION_ID) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_PORTAL,
          `No ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker was found after salmon portal recovery, but coordinate now reads region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId} raw='${location.matchedLine}'. Treating the first outside-region read as stale/transition and retrying salmon portal flow instead of rotating for red portal.`,
        ),
      );
      return transitionToFinalPortalWaitState(
        {
          ...state,
          returnPortalRecoveryTarget: null,
          guardianReturnArrivalDeadlineMs: 0,
          guardianReturnClickDistancePx: null,
          returnPortalCameraNorthReadyAtMs: 0,
          returnPortalCameraNorthPreparedThisClick: false,
          missingGuardianReturnRedTicks: 0,
          missingFinalPortalOpenIconTicks: 0,
          missingFinalPortalTicks: 0,
          actionLockUntilMs: 0,
        },
        `Recovered from salmon portal outside-region read; coordinate is back in region ${GUARDIAN_CRAFTING_REGION_ID}, so waiting for salmon portal availability again.`,
      );
    }

    if (state.returnPortalRecoveryTarget === "portalExit" && location?.regionId === GUARDIAN_CRAFTING_REGION_ID) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_PORTAL,
          `No ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker was found after salmon exit recovery, but coordinate now reads region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId} raw='${location.matchedLine}'. Resuming post-portal flow instead of rotating for red portal.`,
        ),
      );
      return transitionToPostPortalDepositResumeState(
        {
          ...state,
          returnPortalRecoveryTarget: null,
          guardianReturnArrivalDeadlineMs: 0,
          guardianReturnClickDistancePx: null,
          returnPortalCameraNorthReadyAtMs: 0,
          returnPortalCameraNorthPreparedThisClick: false,
          missingGuardianReturnRedTicks: 0,
          actionLockUntilMs: 0,
        },
        nowMs,
      );
    }

    const rotated = tapKey(GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY);
    const returnReason = state.returnPortalRecoveryTarget ? "after salmon portal recovery" : "after inventory emptied";

    warn(
      stepMessage(
        WORKFLOW_STEPS.FIND_PORTAL,
        `No ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker was found ${returnReason}; coordinate=${formatGuardianCoordinateLocation(location)} region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} raw='${location?.matchedLine ?? "unreadable"}'; ${rotated ? `tapped '${GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY}'` : `could not tap '${GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_KEY}'`} to rotate camera before retry ${missingGuardianReturnRedTicks}. Candidates=${formatColoredMarkerCandidates(portalCandidates)}.`,
      ),
    );

    return {
      ...state,
      missingGuardianReturnRedTicks,
      actionLockUntilMs: nowMs + GUARDIAN_RETURN_PORTAL_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const returnPortalClickPoint = getBoundsCenterPoint(returnPortal);
  const travel = estimateTravelWaitTicks(playerAnchor, returnPortalClickPoint);
  const clicked = clickScreenPoint(captureBounds.x + returnPortalClickPoint.centerX, captureBounds.y + returnPortalClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  const cameraReadyAtMs = clickedAtMs + RETURN_PORTAL_CAMERA_NORTH_SETTLE_MS;
  if (state.returnPortalRecoveryTarget === null) {
    rememberMovementObservation("altar-return-portal", WORKFLOW_STEPS.MOVE_TO_PORTAL, clickedAtMs, travel);
  }
  log(
      stepMessage(
        WORKFLOW_STEPS.MOVE_TO_PORTAL,
      `Clicked randomized pixel inside ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker at (${clicked.x},${clicked.y}) local=(${returnPortalClickPoint.centerX},${returnPortalClickPoint.centerY}) bounds=(${returnPortal.minX},${returnPortal.minY})-${returnPortal.maxX},${returnPortal.maxY} pixels=${returnPortal.pixelCount}; waiting two bot ticks before tapping '${POST_RETURN_CAMERA_NORTH_KEY}' to prepare camera north during return travel; waiting to return to region ${GUARDIAN_CRAFTING_REGION_ID} (${formatTravelEstimate(travel)}).`,
      ),
    );

  return {
    ...state,
    currentFunction: "waitAfterGuardianReturnClick",
    phase: "wait-after-guardian-return-click",
    guardianReturnArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    guardianReturnClickDistancePx: travel.distancePx,
    returnPortalCameraNorthReadyAtMs: cameraReadyAtMs,
    returnPortalCameraNorthPreparedThisClick: false,
    missingGuardianReturnRedTicks: 0,
    actionLockUntilMs: cameraReadyAtMs,
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
    returnPortalLastBadCoordinateKey: null,
    returnPortalRepeatedBadCoordinateReads: 0,
    greatGuardianArrivalDeadlineMs: 0,
    greatGuardianClickDistancePx: null,
    chargedCellDepositArrivalDeadlineMs: 0,
    chargedCellDepositClickDistancePx: null,
    runeDepositArrivalDeadlineMs: 0,
    runeDepositClickDistancePx: null,
    runeDepositInventoryFreeSlotsBeforeClick: null,
    runeDepositCameraNorthReadyAtMs: 0,
    runeDepositCameraNorthPreparedThisClick: false,
    missingGreatGuardianTicks: 0,
    missingChargedCellDepositTicks: 0,
    missingRuneDepositTicks: 0,
  };
}

function transitionToPendingPostReturnDepositState(state: BotState, nowMs: number, reason: string): BotState {
  const pendingResume = state.postPortalDepositResume;
  const baseState: BotState = {
    ...state,
    postPortalDepositResume: null,
    openPortalAfterCurrentPostReturnAction: false,
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    portalMiningArrivalDeadlineMs: 0,
    portalMiningExitPortalMarkerCache: null,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingFinalPortalOpenIconTicks: 0,
    missingFinalPortalTicks: 0,
    missingPortalMiningOrangeTicks: 0,
    missingPortalExitTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };

  if (pendingResume === "greatGuardian") {
    setAutomateBotCurrentStep(STEP_GREAT_GUARDIAN_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
        `${reason} Portal mining was not reached, so resuming the original deposit loop at Great Guardian instead of using the post-portal resume path.`,
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

  if (pendingResume === "chargedCell") {
    setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
        `${reason} Portal mining was not reached, so resuming the original deposit loop at charged cell instead of using the post-portal resume path.`,
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
    portalMiningExitPortalMarkerCache: null,
    portalExitArrivalDeadlineMs: 0,
    portalExitClickDistancePx: null,
    missingPortalMiningOrangeTicks: 0,
    missingPortalExitTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };

  if (state.postPortalDepositResume === "greatGuardian") {
    setAutomateBotCurrentStep(STEP_GREAT_GUARDIAN_ID);
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
        "Portal mining finished before Great Guardian deposit was completed; depositing Great Guardian before active guardian travel.",
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
        "Portal mining finished before charged cell deposit was completed; depositing charged cell before active guardian travel.",
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
    "Portal return confirmed; searching for the active guardian outline.",
  );
}

function getReturnPortalBadCoordinateKey(location: GuardianCoordinateLocation | null): string {
  if (!location) {
    return "unreadable";
  }

  return `region=${location.regionId}|nearCraftingArea=${isNearGuardianCraftingAreaLocation(location)}`;
}

function detectReturnPortalCraftingRecoverySignals(
  bitmap: RobotBitmap,
  location: GuardianCoordinateLocation | null,
): { confirmed: boolean; summary: string } {
  const nearCraftingArea = location !== null && isNearGuardianCraftingAreaLocation(location);
  const playerAnchor = getPlayerAnchor(bitmap);
  const workbenchMarker = pickNearestWorkbenchMarker(
    detectAllWorkbenchMagentaObjects(bitmap, WORKBENCH_MAGENTA_MIN_PIXELS),
    playerAnchor,
  );
  const inventory = detectInventoryCount(bitmap);
  const miningStatus = detectMiningBoxStatusInScreenshot(bitmap);

  return {
    confirmed: nearCraftingArea || workbenchMarker !== null,
    summary:
      `coordinate=${formatGuardianCoordinateDebug(location)} ` +
      `workbench=${workbenchMarker ? `(${workbenchMarker.centerX},${workbenchMarker.centerY}) ${workbenchMarker.width}x${workbenchMarker.height} px=${workbenchMarker.pixelCount}` : "none"} ` +
      `inventory=${inventory.count ?? "null"} raw=${inventory.rawText ?? "null"} ` +
      `mining=${formatMiningStatus(miningStatus)}`,
  };
}

function transitionAfterReturnPortalOcrLoopGuard(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  reason: string,
): BotState {
  const recoveryTarget = state.returnPortalRecoveryTarget;
  const cameraReset = state.returnPortalCameraNorthPreparedThisClick ? null : tapKey(POST_RETURN_CAMERA_NORTH_KEY);
  const cameraSummary = state.returnPortalCameraNorthPreparedThisClick
    ? "Camera north already prepared after the red return portal click."
    : `${cameraReset ? "Camera reset to north." : "Camera north reset skipped."}`;
  const returnedState: BotState = {
    ...state,
    returnPortalRecoveryTarget: null,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    returnPortalCameraNorthReadyAtMs: 0,
    returnPortalCameraNorthPreparedThisClick: false,
    missingGuardianReturnRedTicks: 0,
    returnPortalLastBadCoordinateKey: null,
    returnPortalRepeatedBadCoordinateReads: 0,
    actionLockUntilMs: 0,
  };

  warn(stepMessage(WORKFLOW_STEPS.TELEPORT_BACK, `Return recovery OCR loop guard accepted crafting-area recovery. ${reason} ${cameraSummary}`));

  if (recoveryTarget === "finalPortal") {
    return transitionToFinalPortalWaitState(
      {
        ...returnedState,
        finalPortalArrivalDeadlineMs: 0,
        finalPortalTeleportGraceDeadlineMs: 0,
        finalPortalClickDistancePx: null,
        missingFinalPortalOpenIconTicks: 0,
        missingFinalPortalTicks: 0,
        missingPortalMiningOrangeTicks: 0,
      },
      `Return recovery OCR loop guard resumed salmon portal flow. ${reason}`,
    );
  }

  if (recoveryTarget === "portalExit") {
    return transitionToPostPortalDepositResumeState(
      {
        ...returnedState,
        inventoryFreeSlots: 0,
        portalMiningArrivalDeadlineMs: 0,
        portalExitArrivalDeadlineMs: 0,
        portalExitClickDistancePx: null,
        missingPortalMiningOrangeTicks: 0,
        missingPortalExitTicks: 0,
      },
      nowMs,
    );
  }

  resolvePendingMovementObservation("success", "return recovery OCR loop guard confirmed crafting area", nowMs, tickCapture.bitmap);
  return transitionToGreatGuardianState(returnedState);
}

async function runWaitAfterGuardianReturnClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): Promise<BotState> {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  let stateAfterCamera = state;
  if (stateAfterCamera.returnPortalCameraNorthReadyAtMs > 0) {
    if (nowMs < stateAfterCamera.returnPortalCameraNorthReadyAtMs) {
      return {
        ...stateAfterCamera,
        actionLockUntilMs: stateAfterCamera.returnPortalCameraNorthReadyAtMs,
      };
    }

    const cameraReset = tapKey(POST_RETURN_CAMERA_NORTH_KEY);
    log(
      stepMessage(
        WORKFLOW_STEPS.TELEPORT_BACK,
        `${cameraReset ? `Tapped '${POST_RETURN_CAMERA_NORTH_KEY}'` : `Could not tap '${POST_RETURN_CAMERA_NORTH_KEY}'`} to prepare camera north after waiting two bot ticks from the red return portal click.`,
      ),
    );
    stateAfterCamera = {
      ...stateAfterCamera,
      returnPortalCameraNorthReadyAtMs: 0,
      returnPortalCameraNorthPreparedThisClick: cameraReset,
      actionLockUntilMs: 0,
    };
  }

  if (nowMs < stateAfterCamera.guardianReturnArrivalDeadlineMs) {
    return stateAfterCamera;
  }

  const location = readGuardianCoordinateLocation(tickCapture.bitmap);
  if (!location || location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    const missingGuardianReturnRedTicks = stateAfterCamera.missingGuardianReturnRedTicks + 1;
    const badCoordinateKey = getReturnPortalBadCoordinateKey(location);
    const repeatedBadCoordinateReads =
      badCoordinateKey === stateAfterCamera.returnPortalLastBadCoordinateKey
        ? stateAfterCamera.returnPortalRepeatedBadCoordinateReads + 1
        : 1;
    const stateWithBadRead: BotState = {
      ...stateAfterCamera,
      missingGuardianReturnRedTicks,
      returnPortalLastBadCoordinateKey: badCoordinateKey,
      returnPortalRepeatedBadCoordinateReads: repeatedBadCoordinateReads,
    };
    discardPendingMovementObservation("altar-return-portal");

    const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
    const portalCandidates = detectAllReturnPortalRedMarkers(tickCapture.bitmap);
    const craftingRecoverySignals = detectReturnPortalCraftingRecoverySignals(tickCapture.bitmap, location);
    if (
      missingGuardianReturnRedTicks >= RETURN_PORTAL_OCR_LOOP_GUARD_MIN_RETRIES &&
      repeatedBadCoordinateReads >= RETURN_PORTAL_OCR_LOOP_GUARD_MIN_REPEATED_READS &&
      craftingRecoverySignals.confirmed
    ) {
      return transitionAfterReturnPortalOcrLoopGuard(
        stateWithBadRead,
        nowMs,
        tickCapture,
        `failedRegionRead=${badCoordinateKey} repeated=${repeatedBadCoordinateReads} retry=${missingGuardianReturnRedTicks}; signals=${craftingRecoverySignals.summary}.`,
      );
    }

    const returnPortal = pickNearestColoredMarker(portalCandidates, playerAnchor);
    if (returnPortal) {
      const returnPortalClickPoint = getBoundsCenterPoint(returnPortal);
      const travel = estimateTravelWaitTicks(playerAnchor, returnPortalClickPoint);
      const clicked = clickScreenPoint(captureBounds.x + returnPortalClickPoint.centerX, captureBounds.y + returnPortalClickPoint.centerY, captureBounds);
      const clickedAtMs = Date.now();
      const cameraReadyAtMs = clickedAtMs + RETURN_PORTAL_CAMERA_NORTH_SETTLE_MS;
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_BACK,
          `Return teleport not confirmed yet; current region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} matched='${location?.matchedLine ?? "null"}' badRead=${badCoordinateKey} repeated=${repeatedBadCoordinateReads}; signals=${craftingRecoverySignals.summary}. Re-clicked randomized pixel inside ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker at (${clicked.x},${clicked.y}) local=(${returnPortalClickPoint.centerX},${returnPortalClickPoint.centerY}) bounds=(${returnPortal.minX},${returnPortal.minY})-${returnPortal.maxX},${returnPortal.maxY} pixels=${returnPortal.pixelCount}; waiting two bot ticks before tapping '${POST_RETURN_CAMERA_NORTH_KEY}' to prepare camera north during return travel; waiting to return to region ${GUARDIAN_CRAFTING_REGION_ID} (retry=${missingGuardianReturnRedTicks}, ${formatTravelEstimate(travel)}).`,
        ),
      );

      return {
        ...stateWithBadRead,
        guardianReturnArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
        guardianReturnClickDistancePx: travel.distancePx,
        returnPortalCameraNorthReadyAtMs: cameraReadyAtMs,
        returnPortalCameraNorthPreparedThisClick: false,
        actionLockUntilMs: cameraReadyAtMs,
      };
    }

    if (missingGuardianReturnRedTicks === 1 || missingGuardianReturnRedTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.TELEPORT_BACK,
          `Return teleport not confirmed yet; current region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} matched='${location?.matchedLine ?? "null"}' badRead=${badCoordinateKey} repeated=${repeatedBadCoordinateReads}; signals=${craftingRecoverySignals.summary}. ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal marker not visible; waiting for region ${GUARDIAN_CRAFTING_REGION_ID}. Candidates=${formatColoredMarkerCandidates(portalCandidates)}.`,
        ),
      );
    }

    return {
      ...stateWithBadRead,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const cameraReset = stateAfterCamera.returnPortalCameraNorthPreparedThisClick ? null : tapKey(POST_RETURN_CAMERA_NORTH_KEY);
  const cameraSummary = stateAfterCamera.returnPortalCameraNorthPreparedThisClick
    ? "Camera north already prepared after the red return portal click"
    : cameraReset
      ? "Camera reset to north"
      : "Camera north reset skipped";
  const returnedState: BotState = {
    ...stateAfterCamera,
    returnPortalRecoveryTarget: null,
    guardianReturnArrivalDeadlineMs: 0,
    guardianReturnClickDistancePx: null,
    returnPortalCameraNorthReadyAtMs: 0,
    returnPortalCameraNorthPreparedThisClick: false,
    missingGuardianReturnRedTicks: 0,
    returnPortalLastBadCoordinateKey: null,
    returnPortalRepeatedBadCoordinateReads: 0,
    actionLockUntilMs: 0,
  };

  if (state.returnPortalRecoveryTarget === "finalPortal") {
    log(
      stepMessage(
        WORKFLOW_STEPS.TELEPORT_BACK,
        `Return teleport confirmed after salmon recovery: region=${location.regionId} chunk=${location.chunkId} matched='${location.matchedLine}'. ${cameraSummary} before retrying salmon portal flow.`,
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
        missingPortalMiningOrangeTicks: 0,
      },
      `Returned to region ${GUARDIAN_CRAFTING_REGION_ID} after salmon portal recovery; waiting for salmon portal availability.`,
    );
  }

  if (state.returnPortalRecoveryTarget === "portalExit") {
    log(
      stepMessage(
        WORKFLOW_STEPS.TELEPORT_BACK,
        `Return teleport confirmed after salmon exit recovery: region=${location.regionId} chunk=${location.chunkId} matched='${location.matchedLine}'. ${cameraSummary} before repeating guardian click flow.`,
      ),
    );
    return transitionToPostPortalDepositResumeState({
      ...returnedState,
      inventoryFreeSlots: 0,
      portalMiningArrivalDeadlineMs: 0,
      portalExitArrivalDeadlineMs: 0,
      portalExitClickDistancePx: null,
      missingPortalMiningOrangeTicks: 0,
      missingPortalExitTicks: 0,
    }, nowMs);
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.TELEPORT_BACK,
      `Return teleport confirmed: region=${location.regionId} chunk=${location.chunkId} matched='${location.matchedLine}'. ${cameraSummary} before continuing to post-return deposits.`,
    ),
  );
  resolvePendingMovementObservation("success", "return teleport confirmed after altar red portal", nowMs, tickCapture.bitmap);
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

  const currentState = markEndOfRoundDepositModeIfNeeded(
    state,
    tickCapture,
    WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
  );
  const portalOpenIcon = currentState.endOfRoundDepositMode ? null : detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
  if (portalOpenIcon?.isOpen && currentState.postPortalDepositResume !== "greatGuardian") {
    return transitionToFinalPortalSearchState(
      {
        ...currentState,
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

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllGreatGuardianBlueObjects(tickCapture.bitmap);
  const greatGuardian = pickLargestColoredMarker(candidates);
  if (!greatGuardian) {
    const missingGreatGuardianTicks = currentState.missingGreatGuardianTicks + 1;
    if (
      currentState.endOfRoundDepositMode &&
      missingGreatGuardianTicks >= END_OF_ROUND_MISSING_DEPOSIT_SKIP_TICKS
    ) {
      return transitionToEndOfRoundChargedCellDepositState(
        {
          ...currentState,
          missingGreatGuardianTicks,
        },
        nowMs,
        `No blue great guardian outline was found during end-of-round deposit flush. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
      );
    }

    const rotated = tapKey(GREAT_GUARDIAN_CAMERA_ROTATE_KEY);
    if (missingGreatGuardianTicks === 1 || missingGreatGuardianTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_GREAT_GUARDIAN,
          `No blue great guardian outline found yet; ${rotated ? `tapped '${GREAT_GUARDIAN_CAMERA_ROTATE_KEY}'` : `could not tap '${GREAT_GUARDIAN_CAMERA_ROTATE_KEY}'`} to rotate camera before retry ${missingGreatGuardianTicks}. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingGreatGuardianTicks,
      actionLockUntilMs: nowMs + GREAT_GUARDIAN_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
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
  rememberMovementObservation("great-guardian-deposit", WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN, clickedAtMs, travel);

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

async function runWaitAfterGreatGuardianClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): Promise<BotState> {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const endAwareState = markEndOfRoundDepositModeIfNeeded(
    state,
    tickCapture,
    WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
  );
  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    endAwareState,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
    "the great guardian click",
  );
  const inventoryAfterClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryAfterClick.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.greatGuardianArrivalDeadlineMs) {
      if (currentState.endOfRoundDepositMode) {
        return transitionToEndOfRoundChargedCellDepositState(
          currentState,
          nowMs,
          "Great guardian inventory was unreadable before the end-of-round travel deadline expired.",
        );
      }

      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
          `Great guardian inventory was unreadable before travel deadline expired. Re-clicking great guardian.`,
        ),
      );
      resolvePendingMovementObservation("late", "great guardian inventory unreadable after travel deadline", nowMs, tickCapture.bitmap);
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

  const greatGuardianDepositVerified =
    inventoryAfterClick.count === expectedInventoryFreeSlots ||
    (currentState.endOfRoundDepositMode && inventoryAfterClick.count > currentState.inventoryFreeSlots);

  if (!greatGuardianDepositVerified) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.greatGuardianArrivalDeadlineMs) {
      if (currentState.endOfRoundDepositMode) {
        return transitionToEndOfRoundChargedCellDepositState(
          {
            ...currentState,
            inventoryFreeSlots: inventoryAfterClick.count,
            missingInventoryCountTicks: 0,
          },
          nowMs,
          `Great guardian inventory did not show a positive deposit delta before the end-of-round travel deadline expired; got ${inventoryAfterClick.count} from baseline ${currentState.inventoryFreeSlots}.`,
        );
      }

      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_GREAT_GUARDIAN,
          `Great guardian inventory did not reach expected free-space ${expectedInventoryFreeSlots} before travel deadline expired; got ${inventoryAfterClick.count} from altar baseline ${currentState.inventoryFreeSlots}. Re-clicking great guardian. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
        ),
      );
      resolvePendingMovementObservation("late", "great guardian inventory did not change by deadline", nowMs, tickCapture.bitmap);
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

  resolvePendingMovementObservation("success", "great guardian inventory delta verified", nowMs, tickCapture.bitmap);

  const greatGuardianConfirmedState = withGreatGuardianConfirmedAltarRunes(
    {
      ...currentState,
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      greatGuardianArrivalDeadlineMs: 0,
      greatGuardianClickDistancePx: null,
    },
    currentState.inventoryFreeSlots,
    inventoryAfterClick.count,
  );

  const verifiedState = withInventoryCheckpoint(
    greatGuardianConfirmedState,
    "great-guardian",
    inventoryAfterClick.count,
    currentState.inventoryFreeSlots,
    greatGuardianDepositVerified && inventoryAfterClick.count !== expectedInventoryFreeSlots ? null : expectedInventoryFreeSlots,
    true,
    inventoryAfterClick.count === expectedInventoryFreeSlots
      ? "expected +1 after Great Guardian"
      : "end-of-round positive Great Guardian delta",
    {
      ...currentState.postAltarInventoryLedger,
      greatGuardianFreeSlots: inventoryAfterClick.count,
    },
  );

  if (verifiedState.endOfRoundDepositMode) {
    return transitionToEndOfRoundChargedCellDepositState(
      verifiedState,
      nowMs,
      `End-of-round Great Guardian deposit verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}.`,
    );
  }

  if (verifiedState.postPortalDepositResume === "greatGuardian") {
    setAutomateBotCurrentStep(STEP_CHARGED_CELL_DEPOSIT_ID);
    const chargedCellState: BotState = {
      ...verifiedState,
      currentFunction: "findChargedCellDeposit",
      phase: "find-charged-cell-deposit",
      postPortalDepositResume: "chargedCell",
      actionLockUntilMs: 0,
      chargedCellDepositPlayerTileFallbackPending: false,
      missingChargedCellDepositTicks: 0,
    };
    const chainedChargedCellState = await clickChargedCellDepositMarkerIfVisible(
      chargedCellState,
      tickCapture,
      captureBounds,
      `Post-portal Great Guardian deposit verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}.`,
    );
    if (chainedChargedCellState) {
      return chainedChargedCellState;
    }

    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
        `Post-portal Great Guardian deposit verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Depositing charged cell before active guardian travel. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
      ),
    );
    return chargedCellState;
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
  const chargedCellState: BotState = {
    ...verifiedState,
    currentFunction: "findChargedCellDeposit",
    phase: "find-charged-cell-deposit",
    actionLockUntilMs: 0,
    chargedCellDepositPlayerTileFallbackPending: false,
    missingChargedCellDepositTicks: 0,
  };
  const chainedChargedCellState = await clickChargedCellDepositMarkerIfVisible(
    chargedCellState,
    tickCapture,
    captureBounds,
    `Great guardian inventory verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}.`,
  );
  if (chainedChargedCellState) {
    return chainedChargedCellState;
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
      `Great guardian inventory verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Searching for charged cell deposit marker. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
    ),
  );
  return chargedCellState;
}

async function runFindChargedCellDepositTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): Promise<BotState> {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const endAwareState = markEndOfRoundDepositModeIfNeeded(
    state,
    tickCapture,
    WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
  );
  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    endAwareState,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
    "the charged cell deposit",
  );
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllChargedCellDepositObjects(tickCapture.bitmap);
  const chargedCellDeposit = pickNearestColoredMarker(candidates, playerAnchor);
  if (!chargedCellDeposit) {
    const missingChargedCellDepositTicks = currentState.missingChargedCellDepositTicks + 1;
    if (
      currentState.endOfRoundDepositMode &&
      missingChargedCellDepositTicks >= END_OF_ROUND_MISSING_DEPOSIT_SKIP_TICKS
    ) {
      return transitionToEndOfRoundRuneDepositState(
        {
          ...currentState,
          missingChargedCellDepositTicks,
        },
        nowMs,
        `No charged cell deposit marker was found during end-of-round deposit flush. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
      );
    }

    if (currentState.chargedCellDepositPlayerTileFallbackPending) {
      const playerTile = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      if (playerTile) {
        const clicked = await clickDepositScreenPoint(
          captureBounds.x + playerTile.centerX,
          captureBounds.y + playerTile.centerY,
          captureBounds,
        );
        if (!clicked) {
          return currentState;
        }
        const clickedAtMs = Date.now();
        log(
          stepMessage(
            WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
            `Charged-cell deposit retry could not find the purple marker after a failed deposit; moved mouse and waited ${DEPOSIT_PRE_CLICK_MOUSE_SETTLE_MS}ms, then clicked under the player cyan tile at (${clicked.x},${clicked.y}) local=(${playerTile.centerX},${playerTile.centerY}) bounds=(${playerTile.x},${playerTile.y})-(${playerTile.x + playerTile.width - 1},${playerTile.y + playerTile.height - 1}) pixels=${playerTile.pixelCount}. Waiting one bot tick before tapping '${CHARGED_CELL_TO_RUNE_CAMERA_KEY}' to turn the camera; checking inventory for ${CHARGED_CELL_DEPOSIT_PLAYER_TILE_VERIFY_TICKS} game tick(s).`,
          ),
        );

        const cameraReadyAtMs = clickedAtMs + CHARGED_CELL_TO_RUNE_CAMERA_SETTLE_MS;
        return {
          ...currentState,
          currentFunction: "waitAfterChargedCellDepositClick",
          phase: "wait-after-charged-cell-deposit-click",
          chargedCellDepositArrivalDeadlineMs: clickedAtMs + CHARGED_CELL_DEPOSIT_PLAYER_TILE_VERIFY_TICKS * GAME_TICK_MS,
          chargedCellDepositClickDistancePx: 0,
          chargedCellToRuneCameraReadyAtMs: cameraReadyAtMs,
          chargedCellDepositPlayerTileFallbackPending: false,
          missingChargedCellDepositTicks: 0,
          missingInventoryCountTicks: 0,
          actionLockUntilMs: cameraReadyAtMs,
        };
      }
    }

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

  return clickChargedCellDepositMarker(currentState, captureBounds, playerAnchor, chargedCellDeposit);
}

async function clickChargedCellDepositMarker(
  state: BotState,
  captureBounds: ScreenCaptureBounds,
  playerAnchor: { centerX: number; centerY: number },
  chargedCellDeposit: ColoredMarkerDetection,
): Promise<BotState> {
  const chargedCellDepositClickPoint = getBoundsCenterRightPoint(chargedCellDeposit);
  const travel = estimateTravelWaitTicks(playerAnchor, chargedCellDepositClickPoint);
  const clicked = await clickDepositScreenPoint(
    captureBounds.x + chargedCellDepositClickPoint.centerX,
    captureBounds.y + chargedCellDepositClickPoint.centerY,
    captureBounds,
  );
  if (!clicked) {
    return state;
  }
  const clickedAtMs = Date.now();
  const cameraReadyAtMs = clickedAtMs + CHARGED_CELL_TO_RUNE_CAMERA_SETTLE_MS;
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
      `Moved mouse and waited ${DEPOSIT_PRE_CLICK_MOUSE_SETTLE_MS}ms, then clicked center-right of charged cell deposit marker at (${clicked.x},${clicked.y}) local=(${chargedCellDepositClickPoint.centerX},${chargedCellDepositClickPoint.centerY}) bounds=(${chargedCellDeposit.minX},${chargedCellDeposit.minY})-(${chargedCellDeposit.maxX},${chargedCellDeposit.maxY}) pixels=${chargedCellDeposit.pixelCount}; waiting one bot tick before tapping '${CHARGED_CELL_TO_RUNE_CAMERA_KEY}' to turn the camera; checking inventory until travel deadline (${formatTravelEstimate(travel)}).`,
    ),
  );
  rememberMovementObservation("charged-cell-deposit", WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT, clickedAtMs, travel);

  return {
    ...state,
    currentFunction: "waitAfterChargedCellDepositClick",
    phase: "wait-after-charged-cell-deposit-click",
    chargedCellDepositArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    chargedCellDepositClickDistancePx: travel.distancePx,
    chargedCellToRuneCameraReadyAtMs: cameraReadyAtMs,
    chargedCellDepositPlayerTileFallbackPending: false,
    missingChargedCellDepositTicks: 0,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: cameraReadyAtMs,
  };
}

async function clickChargedCellDepositMarkerIfVisible(
  state: BotState,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  reasonPrefix: string,
): Promise<BotState | null> {
  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const candidates = detectAllChargedCellDepositObjects(tickCapture.bitmap);
  const chargedCellDeposit = pickNearestColoredMarker(candidates, playerAnchor);
  if (!chargedCellDeposit) {
    return null;
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_CHARGED_CELL_DEPOSIT,
      `${reasonPrefix} Charged cell deposit marker is already visible; clicking it without waiting for the next bot tick. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
    ),
  );
  return clickChargedCellDepositMarker(state, captureBounds, playerAnchor, chargedCellDeposit);
}

async function runWaitAfterChargedCellDepositClickTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
): Promise<BotState> {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  if (state.chargedCellToRuneCameraReadyAtMs > 0) {
    if (nowMs < state.chargedCellToRuneCameraReadyAtMs) {
      return {
        ...state,
        actionLockUntilMs: state.chargedCellToRuneCameraReadyAtMs,
      };
    }

    const cameraPrepared = tapKey(CHARGED_CELL_TO_RUNE_CAMERA_KEY);
    log(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
        `${cameraPrepared ? `Tapped '${CHARGED_CELL_TO_RUNE_CAMERA_KEY}'` : `Could not tap '${CHARGED_CELL_TO_RUNE_CAMERA_KEY}'`} to turn the camera after waiting one bot tick from the charged-cell deposit click.`,
      ),
    );

    return {
      ...state,
      chargedCellToRuneCameraReadyAtMs: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const endAwareState = markEndOfRoundDepositModeIfNeeded(
    state,
    tickCapture,
    WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
  );
  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    endAwareState,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
    "the charged cell deposit",
  );
  const inventoryAfterClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryAfterClick.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.chargedCellDepositArrivalDeadlineMs) {
      if (currentState.endOfRoundDepositMode) {
        return transitionToEndOfRoundRuneDepositState(
          currentState,
          nowMs,
          "Charged-cell deposit inventory was unreadable before the end-of-round travel deadline expired.",
        );
      }

      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
          `Inventory free-space was unreadable before charged-cell deposit travel deadline expired. Re-clicking charged cell deposit; if the purple marker is hidden under the player, the retry will click the player cyan tile.`,
        ),
      );
      resolvePendingMovementObservation("late", "charged-cell deposit inventory unreadable after travel deadline", nowMs, tickCapture.bitmap);
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

  const chargedCellDepositVerified =
    inventoryAfterClick.count === expectedInventoryFreeSlots ||
    (currentState.endOfRoundDepositMode && inventoryAfterClick.count > currentState.inventoryFreeSlots);

  if (!chargedCellDepositVerified) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.chargedCellDepositArrivalDeadlineMs) {
      if (currentState.endOfRoundDepositMode) {
        return transitionToEndOfRoundRuneDepositState(
          {
            ...currentState,
            inventoryFreeSlots: inventoryAfterClick.count,
            missingInventoryCountTicks: 0,
          },
          nowMs,
          `Charged-cell deposit inventory did not show a positive deposit delta before the end-of-round travel deadline expired; got ${inventoryAfterClick.count} from baseline ${currentState.inventoryFreeSlots}.`,
        );
      }

      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_CHARGED_CELL_DEPOSIT,
          `Charged cell deposit inventory did not reach expected free-space ${expectedInventoryFreeSlots} before travel deadline expired; got ${inventoryAfterClick.count} from guardian baseline ${currentState.inventoryFreeSlots}. Re-clicking charged cell deposit; if the purple marker is hidden under the player, the retry will click the player cyan tile. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
        ),
      );
      resolvePendingMovementObservation("late", "charged-cell deposit inventory did not change by deadline", nowMs, tickCapture.bitmap);
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

  resolvePendingMovementObservation("success", "charged-cell deposit inventory delta verified", nowMs, tickCapture.bitmap);

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
    chargedCellDepositVerified && inventoryAfterClick.count !== expectedInventoryFreeSlots ? null : expectedInventoryFreeSlots,
    true,
    inventoryAfterClick.count === expectedInventoryFreeSlots
      ? "expected +1 after charged-cell deposit"
      : "end-of-round positive charged-cell deposit delta",
    {
      ...currentState.postAltarInventoryLedger,
      chargedCellDepositFreeSlots: inventoryAfterClick.count,
    },
  );

  if (verifiedState.endOfRoundDepositMode) {
    return transitionToEndOfRoundRuneDepositState(
      verifiedState,
      nowMs,
      `End-of-round charged cell deposit verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}.`,
    );
  }

  if (verifiedState.postPortalDepositResume === "chargedCell") {
    return transitionToGuardianTravelState(
      {
        ...verifiedState,
        postPortalDepositResume: null,
        openPortalAfterCurrentPostReturnAction: false,
      },
      `Post-portal charged cell deposit verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Searching for the active guardian outline. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
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
      `Charged cell deposit inventory verified: free-space ${currentState.inventoryFreeSlots} -> ${inventoryAfterClick.count}. Searching for rune deposit marker immediately instead of waiting for the next bot tick. Inventory history=${formatInventoryHistory(verifiedState.inventoryHistory)}.`,
    ),
  );
  return runFindRuneDepositTick(
    {
      ...verifiedState,
      currentFunction: "findRuneDeposit",
      phase: "find-rune-deposit",
      actionLockUntilMs: 0,
      missingRuneDepositTicks: 0,
    },
    nowMs,
    tickCapture,
    captureBounds,
    portalOpenIconTemplate,
  );
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
      runeDepositMarkerCache: null,
      runeDepositCameraNorthReadyAtMs: 0,
      runeDepositCameraNorthPreparedThisClick: false,
      finalPortalArrivalDeadlineMs: 0,
      finalPortalTeleportGraceDeadlineMs: 0,
      finalPortalClickDistancePx: null,
      portalMiningArrivalDeadlineMs: 0,
      portalExitArrivalDeadlineMs: 0,
      portalExitClickDistancePx: null,
      inventoryFreeSlots: afterFreeSlots,
      missingFinalPortalOpenIconTicks: 0,
      missingFinalPortalTicks: 0,
      missingPortalMiningOrangeTicks: 0,
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

  const cameraReset = state.runeDepositCameraNorthPreparedThisClick ? null : tapKey(POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY);
  const cameraSummary = state.runeDepositCameraNorthPreparedThisClick
    ? "Camera north already prepared after the rune deposit click."
    : `${cameraReset ? `Tapped '${POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY}'` : `Could not tap '${POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY}'`} to reset camera north.`;
  const endAwarePostRuneDepositState = markEndOfRoundDepositModeIfNeeded(
    postRuneDepositState,
    tickCapture,
    WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
  );
  const depositSummary =
    `${reasonPrefix}: inventory free-space increased ${beforeFreeSlots} -> ${afterFreeSlots}. ${cameraSummary} Inventory history=${formatInventoryHistory(endAwarePostRuneDepositState.inventoryHistory)}.`;

  if (endAwarePostRuneDepositState.endOfRoundDepositMode) {
    return transitionToRoundRestartState(endAwarePostRuneDepositState, nowMs, `End-of-round rune deposit complete. ${depositSummary}`);
  }

  const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
  const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(tickCapture.bitmap);

  if (endAwarePostRuneDepositState.openPortalAfterCurrentPostReturnAction || portalOpenIcon.isOpen) {
    const pouchDecision = getWorkbenchOpenPortalPouchDecision({
      ...endAwarePostRuneDepositState,
      craftingPouchesFilledThisCycle: false,
    });
    const portalSource = endAwarePostRuneDepositState.openPortalAfterCurrentPostReturnAction
      ? "Open portal was already detected"
      : `Open portal icon detected at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"})`;

    if (!pouchDecision.shouldUsePortal) {
      return transitionToWorkbenchState(
        endAwarePostRuneDepositState,
        `${depositSummary} ${portalSource}, but continuing to workbench because ${pouchDecision.reason} (${pouchDecision.rememberedPouchCount} pouch(es)). Time since portal is ${formatTimeSincePortal(timeSincePortal)}.`,
      );
    }

    return transitionToFinalPortalSearchState(
      endAwarePostRuneDepositState,
      nowMs,
      `${depositSummary} ${portalSource}; taking salmon portal because ${pouchDecision.reason} (${pouchDecision.rememberedPouchCount} pouch(es)). Time since portal is ${formatTimeSincePortal(timeSincePortal)}.`,
    );
  }

  if (timeSincePortal.color === "green" || (GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer" && timeSincePortal.color === "white")) {
    return transitionToWorkbenchState(
      endAwarePostRuneDepositState,
      `${depositSummary} Time since portal is ${timeSincePortal.color} (${formatTimeSincePortal(timeSincePortal)}); going to workbench${timeSincePortal.color === "white" ? " because optimizer mode treats white as workbench" : ""}.`,
    );
  }

  if (timeSincePortal.color === "yellow") {
    return transitionToWorkbenchState(
      endAwarePostRuneDepositState,
      `${depositSummary} Time since portal is yellow (${formatTimeSincePortal(timeSincePortal)}); going to workbench while continuing to watch for an open portal icon.`,
    );
  }

  const missingFinalPortalOpenIconTicks = state.missingFinalPortalOpenIconTicks + 1;
  if (missingFinalPortalOpenIconTicks === 1 || missingFinalPortalOpenIconTicks % 5 === 0) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `${depositSummary} Time since portal is ${formatTimeSincePortal(timeSincePortal)}; waiting for yellow/green${GUARDIAN_OF_THE_RIFT_OVERLAY_MODE === "optimizer" ? "/white" : ""}=workbench or open portal with unfilled pouches (counts=${JSON.stringify(timeSincePortal.counts)}).`,
      ),
    );
  }

  return {
    ...endAwarePostRuneDepositState,
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

  const endAwareState = markEndOfRoundDepositModeIfNeeded(
    state,
    tickCapture,
    WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
  );
  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    endAwareState,
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
    if (currentState.endOfRoundDepositMode && missingRuneDepositTicks >= END_OF_ROUND_MISSING_DEPOSIT_SKIP_TICKS) {
      return transitionToRoundRestartState(
        {
          ...currentState,
          missingRuneDepositTicks,
        },
        nowMs,
        `No rune deposit marker was found during end-of-round deposit flush. Candidates=${formatColoredMarkerCandidates(candidates)}.`,
      );
    }

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
      runeDepositMarkerCache: null,
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
  const freshCaptureMs = Date.now();
  const freshPlayerAnchor = getPlayerAnchor(freshBitmap);
  const freshCandidates = detectAllRuneDepositObjects(freshBitmap);
  const freshRuneDeposit =
    currentState.runeDepositMarkerCache !== null
      ? pickNearestColoredMarkerToPoint(freshCandidates, currentState.runeDepositMarkerCache.marker) ??
        pickNearestColoredMarker(freshCandidates, freshPlayerAnchor)
      : pickNearestColoredMarker(freshCandidates, freshPlayerAnchor);
  if (!freshRuneDeposit) {
    const missingRuneDepositTicks = currentState.missingRuneDepositTicks + 1;
    if (currentState.endOfRoundDepositMode && missingRuneDepositTicks >= END_OF_ROUND_MISSING_DEPOSIT_SKIP_TICKS) {
      return transitionToRoundRestartState(
        {
          ...currentState,
          missingRuneDepositTicks,
        },
        Date.now(),
        `Rune deposit marker disappeared during the end-of-round just-in-time recapture. Previous candidates=${formatColoredMarkerCandidates(candidates)}, freshCandidates=${formatColoredMarkerCandidates(freshCandidates)}.`,
      );
    }

    if (missingRuneDepositTicks === 1 || missingRuneDepositTicks % 3 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
          `Rune deposit marker was visible in tick capture, but not in the just-in-time recapture after ${RUNE_DEPOSIT_PRE_CLICK_RECAPTURE_SETTLE_MS}ms. Retrying with a fresh screenshot (${missingRuneDepositTicks}/${currentState.endOfRoundDepositMode ? END_OF_ROUND_MISSING_DEPOSIT_SKIP_TICKS : "retry"}). Previous candidates=${formatColoredMarkerCandidates(candidates)}, freshCandidates=${formatColoredMarkerCandidates(freshCandidates)}.`,
        ),
      );
    }

    return {
      ...currentState,
      runeDepositMarkerCache: null,
      missingRuneDepositTicks,
      actionLockUntilMs: Date.now() + FAST_ACTION_RETRY_MS,
    };
  }

  const runeDepositClickPoint = getRuneDepositClickPoint(freshRuneDeposit);
  const travel = estimateTravelWaitTicks(freshPlayerAnchor, runeDepositClickPoint);
  const markerCache = updateCachedMarker(
    currentState.runeDepositMarkerCache,
    freshRuneDeposit,
    freshCaptureMs,
    currentState.loopIndex,
    RUNE_DEPOSIT_MARKER_STABLE_DISTANCE_PX,
  );
  const requiredSettleTicks = getRuneDepositMarkerSettleTicks(travel);
  if (!isCachedMarkerSettled(markerCache, freshCaptureMs, requiredSettleTicks)) {
    const readyAtMs = markerCache.firstSeenAtMs + requiredSettleTicks * GAME_TICK_MS;
    const waitTicks = Math.max(1, Math.ceil((readyAtMs - freshCaptureMs) / GAME_TICK_MS));
    if (markerCache.firstSeenAtMs === freshCaptureMs) {
      log(
        stepMessage(
          WORKFLOW_STEPS.FIND_RUNE_DEPOSIT,
          `Rune deposit marker waiting for visual stability before click: local=(${runeDepositClickPoint.centerX},${runeDepositClickPoint.centerY}) ratioX=${RUNE_DEPOSIT_CLICK_RATIO_X} ratioY=${RUNE_DEPOSIT_CLICK_RATIO_Y} bounds=(${freshRuneDeposit.minX},${freshRuneDeposit.minY})-(${freshRuneDeposit.maxX},${freshRuneDeposit.maxY}) pixels=${freshRuneDeposit.pixelCount}; requiredStable=${requiredSettleTicks} game tick(s), remaining~${waitTicks}, tolerance=${RUNE_DEPOSIT_MARKER_STABLE_DISTANCE_PX}px, ${formatTravelEstimate(travel)}.`,
        ),
      );
    }

    return {
      ...currentState,
      runeDepositMarkerCache: markerCache,
      missingRuneDepositTicks: 0,
      actionLockUntilMs: freshCaptureMs + GAME_TICK_MS,
    };
  }

  const inventoryBeforeClick = detectInventoryCount(freshBitmap);
  if (inventoryBeforeClick.count === null) {
    if (currentState.endOfRoundDepositMode) {
      return transitionToRoundRestartState(
        currentState,
        Date.now(),
        "Rune deposit marker was found during end-of-round flush, but inventory free-space was unreadable before click.",
      );
    }

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
      runeDepositMarkerCache: markerCache,
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

  const clicked = await clickDepositScreenPoint(
    captureBounds.x + runeDepositClickPoint.centerX,
    captureBounds.y + runeDepositClickPoint.centerY,
    captureBounds,
  );
  if (!clicked) {
    return currentState;
  }
  const clickedAtMs = Date.now();
  const cameraReadyAtMs = clickedAtMs + RUNE_DEPOSIT_CAMERA_NORTH_SETTLE_MS;
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
      `Moved mouse and waited ${DEPOSIT_PRE_CLICK_MOUSE_SETTLE_MS}ms, then clicked lower right-biased point of stable rune deposit marker from just-in-time recapture at (${clicked.x},${clicked.y}) local=(${runeDepositClickPoint.centerX},${runeDepositClickPoint.centerY}) ratioX=${RUNE_DEPOSIT_CLICK_RATIO_X} ratioY=${RUNE_DEPOSIT_CLICK_RATIO_Y} stableFor=${Math.round((freshCaptureMs - markerCache.firstSeenAtMs) / GAME_TICK_MS)} game tick(s) requiredStable=${requiredSettleTicks} bounds=(${freshRuneDeposit.minX},${freshRuneDeposit.minY})-${freshRuneDeposit.maxX},${freshRuneDeposit.maxY} pixels=${freshRuneDeposit.pixelCount}; inventory free-space before deposit=${inventoryBeforeClick.count}; waiting one bot tick before tapping '${POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY}' to prepare camera north; checking inventory until travel deadline (${formatTravelEstimate(travel)}).`,
    ),
  );
  rememberMovementObservation("rune-deposit", WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT, clickedAtMs, travel);

  return {
    ...currentState,
    currentFunction: "waitAfterRuneDepositClick",
    phase: "wait-after-rune-deposit-click",
    runeDepositArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    runeDepositClickDistancePx: travel.distancePx,
    runeDepositInventoryFreeSlotsBeforeClick: inventoryBeforeClick.count,
    runeDepositMarkerCache: null,
    runeDepositCameraNorthReadyAtMs: cameraReadyAtMs,
    runeDepositCameraNorthPreparedThisClick: false,
    missingInventoryCountTicks: 0,
    missingRuneDepositTicks: 0,
    actionLockUntilMs: cameraReadyAtMs,
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

  let stateAfterCamera = state;
  if (stateAfterCamera.runeDepositCameraNorthReadyAtMs > 0) {
    if (nowMs < stateAfterCamera.runeDepositCameraNorthReadyAtMs) {
      return {
        ...stateAfterCamera,
        actionLockUntilMs: stateAfterCamera.runeDepositCameraNorthReadyAtMs,
      };
    }

    const cameraReset = tapKey(POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY);
    log(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `${cameraReset ? `Tapped '${POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY}'` : `Could not tap '${POST_RUNE_DEPOSIT_CAMERA_NORTH_KEY}'`} to prepare camera north after waiting one bot tick from the rune deposit click.`,
      ),
    );
    stateAfterCamera = {
      ...stateAfterCamera,
      runeDepositCameraNorthReadyAtMs: 0,
      runeDepositCameraNorthPreparedThisClick: cameraReset,
      actionLockUntilMs: 0,
    };
  }

  const endAwareState = markEndOfRoundDepositModeIfNeeded(
    stateAfterCamera,
    tickCapture,
    WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
  );
  const currentState = markOpenPortalAfterCurrentPostReturnAction(
    endAwareState,
    tickCapture,
    portalOpenIconTemplate,
    WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
    "the rune deposit",
  );
  const inventoryAfterClick = detectInventoryCount(tickCapture.bitmap);
  if (inventoryAfterClick.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (nowMs >= currentState.runeDepositArrivalDeadlineMs) {
      if (currentState.endOfRoundDepositMode) {
        return transitionToRoundRestartState(
          currentState,
          nowMs,
          "Rune deposit inventory was unreadable before the end-of-round travel deadline expired.",
        );
      }

      setAutomateBotCurrentStep(STEP_RUNE_DEPOSIT_ID);
      warn(
        stepMessage(
          WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
          `Inventory free-space was unreadable before rune deposit travel deadline expired. Returning to Step 20 to retry the rune deposit.`,
        ),
      );
      resolvePendingMovementObservation("late", "rune deposit inventory unreadable after travel deadline", nowMs, tickCapture.bitmap);
      return {
        ...currentState,
        currentFunction: "findRuneDeposit",
        phase: "find-rune-deposit",
        missingInventoryCountTicks: 0,
        runeDepositArrivalDeadlineMs: 0,
        runeDepositClickDistancePx: null,
        runeDepositInventoryFreeSlotsBeforeClick: null,
        runeDepositCameraNorthReadyAtMs: 0,
        runeDepositCameraNorthPreparedThisClick: false,
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
    if (currentState.endOfRoundDepositMode) {
      return transitionToRoundRestartState(
        {
          ...currentState,
          inventoryFreeSlots: inventoryAfterClick.count,
        },
        nowMs,
        `Rune deposit inventory verification was missing the before snapshot during end-of-round flush; current free-space=${inventoryAfterClick.count}.`,
      );
    }

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
      runeDepositCameraNorthReadyAtMs: 0,
      runeDepositCameraNorthPreparedThisClick: false,
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
    if (currentState.endOfRoundDepositMode) {
      return transitionToRoundRestartState(
        {
          ...currentState,
          inventoryFreeSlots: inventoryAfterClick.count,
          missingInventoryCountTicks: 0,
          runeDepositInventoryFreeSlotsBeforeClick: null,
          runeDepositCameraNorthReadyAtMs: 0,
          runeDepositCameraNorthPreparedThisClick: false,
        },
        nowMs,
        `Rune deposit did not increase inventory free-space before the end-of-round travel deadline expired (${currentState.runeDepositInventoryFreeSlotsBeforeClick} -> ${inventoryAfterClick.count}).`,
      );
    }

    warn(
      stepMessage(
        WORKFLOW_STEPS.TRAVEL_TO_RUNE_DEPOSIT,
        `Rune deposit did not increase inventory free-space before travel deadline expired (${currentState.runeDepositInventoryFreeSlotsBeforeClick} -> ${inventoryAfterClick.count}). Returning to Step 20 to retry the rune deposit. Inventory history=${formatInventoryHistory(currentState.inventoryHistory)}.`,
      ),
    );
    resolvePendingMovementObservation("late", "rune deposit inventory did not increase by deadline", nowMs, tickCapture.bitmap);
    return {
      ...currentState,
      currentFunction: "findRuneDeposit",
      phase: "find-rune-deposit",
      inventoryFreeSlots: inventoryAfterClick.count,
      missingInventoryCountTicks: 0,
      runeDepositInventoryFreeSlotsBeforeClick: null,
      runeDepositCameraNorthReadyAtMs: 0,
      runeDepositCameraNorthPreparedThisClick: false,
      missingRuneDepositTicks: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  resolvePendingMovementObservation("success", "rune deposit inventory delta verified", nowMs, tickCapture.bitmap);

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
    portalMiningExitPortalMarkerCache: null,
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
    portalMiningExitPortalMarkerCache: null,
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

  const finalPortalClickPoint = getSalmonPortalClickPoint(finalPortal);
  if (state.finalPortalClickReadyAtMs === 0) {
    const readyAtMs = nowMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_FINAL_PORTAL,
        `${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} salmon portal marker found at center=(${finalPortalClickPoint.centerX},${finalPortalClickPoint.centerY}); waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before clicking.`,
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

  const travel = estimateTravelWaitTicks(playerAnchor, finalPortalClickPoint);
  const clicked = clickScreenPoint(captureBounds.x + finalPortalClickPoint.centerX, captureBounds.y + finalPortalClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
      `Clicked center of ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${finalPortalClickPoint.centerX},${finalPortalClickPoint.centerY}) bounds=(${finalPortal.minX},${finalPortal.minY})-${finalPortal.maxX},${finalPortal.maxY} pixels=${finalPortal.pixelCount}; waiting before checking the orange mining marker (${formatTravelEstimate(travel)}, salmonValidationBuffer=${SALMON_PORTAL_TO_MINING_VALIDATION_BUFFER_TICKS} tick(s)).`,
    ),
  );
  rememberMovementObservation("salmon-portal-to-mining", WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL, clickedAtMs, travel);

  return {
    ...state,
    currentFunction: "waitAfterFinalPortalClick",
    phase: "wait-after-final-portal-click",
    finalPortalClickReadyAtMs: 0,
    finalPortalArrivalDeadlineMs:
      clickedAtMs + (travel.waitTicks + SALMON_PORTAL_TO_MINING_VALIDATION_BUFFER_TICKS) * GAME_TICK_MS,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: travel.distancePx,
    missingFinalPortalTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
  };
}

function isAtFinalPortalMiningTile(location: GuardianCoordinateLocation | null): boolean {
  return location?.x === FINAL_PORTAL_MINING_TILE_X && location.y === FINAL_PORTAL_MINING_TILE_Y;
}

function isInPortalMiningZone(location: GuardianCoordinateLocation | null): boolean {
  if (location === null || location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    return false;
  }

  return (
    Math.abs(location.x - FINAL_PORTAL_MINING_TILE_X) <= PORTAL_MINING_ZONE_TILE_RADIUS_X &&
    Math.abs(location.y - FINAL_PORTAL_MINING_TILE_Y) <= PORTAL_MINING_ZONE_TILE_RADIUS_Y
  );
}

function formatPortalMiningZoneDescription(): string {
  return `${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} +/- ${PORTAL_MINING_ZONE_TILE_RADIUS_X}x${PORTAL_MINING_ZONE_TILE_RADIUS_Y} tiles`;
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
  if (state.openPortalAfterCurrentPostReturnAction || state.endOfRoundDepositMode) {
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

function checkWorkbenchOpenPortal(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  portalOpenIconTemplate: GuardianOfTheRiftPortalOpenIconTemplate,
  step: (typeof WORKFLOW_STEPS)[keyof typeof WORKFLOW_STEPS],
): { state: BotState; transitioned: boolean } {
  const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
  if (!portalOpenIcon.isOpen) {
    return {
      state:
        state.missingFinalPortalOpenIconTicks === 0
          ? state
          : {
              ...state,
              missingFinalPortalOpenIconTicks: 0,
            },
      transitioned: false,
    };
  }

  if (state.workbenchInventoryNoChangeWarnings >= WORKBENCH_INVENTORY_NO_CHANGE_MAX_WARNINGS) {
    const essence = getWorkbenchEssenceEstimate(state);
    if (essence.total >= WORKBENCH_FALLBACK_MIN_ESSENCE_FOR_GUARDIAN) {
      return {
        state,
        transitioned: false,
      };
    }

    return {
      state: transitionToFinalPortalSearchState(
        {
          ...state,
          missingFinalPortalOpenIconTicks: 0,
          missingFinalPortalTicks: 0,
        },
        nowMs,
        `Open portal icon detected during workbench low-essence wait at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); taking salmon portal because ${formatWorkbenchEssenceEstimate(state)}.`,
      ),
      transitioned: true,
    };
  }

  const pouchDecision = getWorkbenchOpenPortalPouchDecision(state);
  if (pouchDecision.shouldUsePortal) {
    return {
      state: transitionToFinalPortalSearchState(
        {
          ...state,
          missingFinalPortalOpenIconTicks: 0,
          missingFinalPortalTicks: 0,
        },
        nowMs,
        `Open portal icon detected during workbench loop at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}); taking salmon portal because ${pouchDecision.reason} (${pouchDecision.rememberedPouchCount} pouch(es)).`,
      ),
      transitioned: true,
    };
  }

  const missingFinalPortalOpenIconTicks = state.missingFinalPortalOpenIconTicks + 1;
  if (missingFinalPortalOpenIconTicks === 1 || missingFinalPortalOpenIconTicks % 10 === 0) {
    log(
      stepMessage(
        step,
        `Open portal icon detected during workbench loop at (${portalOpenIcon.match?.centerX ?? "unknown"},${portalOpenIcon.match?.centerY ?? "unknown"}), but continuing workbench because ${pouchDecision.reason} (${pouchDecision.rememberedPouchCount} pouch(es)).`,
      ),
    );
  }

  return {
    state: {
      ...state,
      missingFinalPortalOpenIconTicks,
    },
    transitioned: false,
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
  const miningClickPoint = getBoundsCenterPoint(miningTarget);
  const travel = estimateTravelWaitTicks(playerAnchor, miningClickPoint);
  const clicked = clickScreenPoint(captureBounds.x + miningClickPoint.centerX, captureBounds.y + miningClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_PORTAL_MINING,
      `${reason}; clicked randomized pixel inside ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker at (${clicked.x},${clicked.y}) local=(${miningClickPoint.centerX},${miningClickPoint.centerY}) bounds=(${miningTarget.minX},${miningTarget.minY})-(${miningTarget.maxX},${miningTarget.maxY}) pixels=${miningTarget.pixelCount}; tile=${formatGuardianCoordinateLocation(location)}; waiting before monitoring inventory (${formatTravelEstimate(travel)}).`,
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
    cachedPortalMiningMarker: miningTarget,
    portalMiningExitPortalMarkerCache: null,
    missingPortalMiningOrangeTicks: 0,
    missingInventoryCountTicks: 0,
    inventoryFreeSlots: null,
    pouchFillAvailableEssenceSlots: state.pouchFillAvailableEssenceSlots,
    craftingInventoryChangeDeadlineMs: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_POST_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
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
    discardPendingMovementObservation("salmon-portal-to-mining");
    return transitionToReturnPortalRecoveryState(
      state,
      nowMs,
      "finalPortal",
      `Salmon portal travel read outside region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} raw='${location.matchedLine}'. The salmon mining area is also region ${GUARDIAN_CRAFTING_REGION_ID}, so this likely clicked an altar guardian instead of the salmon portal. Finding ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal to return before retrying salmon portal flow.`,
    );
  }

  if (!isAtFinalPortalMiningTile(location)) {
    const portalOpenIcon = detectPortalOpenIcon(tickCapture.bitmap, portalOpenIconTemplate);
    const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);
    const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
    const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
    const retryPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);

    if (retryPortal) {
      const retryPortalClickPoint = getSalmonPortalClickPoint(retryPortal);
      if (state.finalPortalClickReadyAtMs === 0) {
        const readyAtMs = nowMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
        log(
          stepMessage(
            WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
            `Salmon portal arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} is not confirmed yet; ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} retry portal marker is visible at center=(${retryPortalClickPoint.centerX},${retryPortalClickPoint.centerY}). Waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before re-clicking.`,
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

      const travel = estimateTravelWaitTicks(playerAnchor, retryPortalClickPoint);
      const clicked = clickScreenPoint(captureBounds.x + retryPortalClickPoint.centerX, captureBounds.y + retryPortalClickPoint.centerY, captureBounds);
      const clickedAtMs = Date.now();
      log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
          `Salmon portal arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} is not confirmed yet (current tile=${formatGuardianCoordinateLocation(location)} raw='${location?.matchedLine ?? "unreadable"}'); re-clicked center of ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${retryPortalClickPoint.centerX},${retryPortalClickPoint.centerY}) bounds=(${retryPortal.minX},${retryPortal.minY})-${retryPortal.maxX},${retryPortal.maxY} pixels=${retryPortal.pixelCount}; waiting again before checking the orange mining marker (${formatTravelEstimate(travel)}, salmonValidationBuffer=${SALMON_PORTAL_TO_MINING_VALIDATION_BUFFER_TICKS} tick(s)).`,
        ),
      );
      rememberMovementObservation("salmon-portal-to-mining", WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL, clickedAtMs, travel);

      return {
        ...state,
        currentFunction: "waitAfterFinalPortalClick",
        phase: "wait-after-final-portal-click",
        finalPortalClickReadyAtMs: 0,
        finalPortalArrivalDeadlineMs:
          clickedAtMs + (travel.waitTicks + SALMON_PORTAL_TO_MINING_VALIDATION_BUFFER_TICKS) * GAME_TICK_MS,
        finalPortalTeleportGraceDeadlineMs: 0,
        finalPortalClickDistancePx: travel.distancePx,
        missingFinalPortalTicks: 0,
        missingPortalMiningOrangeTicks: 0,
        actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
      };
    }

    if (!portalOpenIcon.isOpen && miningStatus.status !== "mining") {
      const graceDeadlineMs =
        state.finalPortalTeleportGraceDeadlineMs > 0
          ? state.finalPortalTeleportGraceDeadlineMs
          : nowMs + FINAL_PORTAL_TELEPORT_CONFIRM_GRACE_TICKS * GAME_TICK_MS;
      const missingPortalMiningOrangeTicks = state.missingPortalMiningOrangeTicks + 1;

      if (nowMs < graceDeadlineMs) {
        if (state.finalPortalTeleportGraceDeadlineMs === 0 || missingPortalMiningOrangeTicks % 5 === 0) {
          warn(
            stepMessage(
              WORKFLOW_STEPS.CHECK_PORTAL_MINING_ORANGE,
              `Open-portal icon disappeared before arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} was confirmed; waiting ${Math.ceil((graceDeadlineMs - nowMs) / GAME_TICK_MS)} more game tick(s) for teleport/coordinate update. Current tile=${formatGuardianCoordinateLocation(location)}, ${formatMiningStatus(miningStatus)}.`,
            ),
          );
        }

        return {
          ...state,
          finalPortalTeleportGraceDeadlineMs: graceDeadlineMs,
          missingPortalMiningOrangeTicks,
          actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
        };
      }

      return transitionToPendingPostReturnDepositState(
        state,
        nowMs,
        `Salmon portal travel did not reach tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} and open-portal icon disappeared; current tile=${formatGuardianCoordinateLocation(location)}, ${formatMiningStatus(miningStatus)}.`,
      );
    }

    const missingPortalMiningOrangeTicks = state.missingPortalMiningOrangeTicks + 1;
    if (missingPortalMiningOrangeTicks >= SALMON_PORTAL_STALLED_ARRIVAL_RECOVERY_TICKS) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.RECOVER_FINAL_PORTAL_ARRIVAL,
          `Salmon portal arrival has not reached tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} after ${missingPortalMiningOrangeTicks} check(s), and no retry portal marker is visible. Current tile=${formatGuardianCoordinateLocation(location)} raw='${location?.matchedLine ?? "unreadable"}', openPortalIcon=${portalOpenIcon.isOpen ? "visible" : "not-visible"}, ${formatMiningStatus(miningStatus)}. Switching to salmon-arrival recovery.`,
        ),
      );

      return {
        ...state,
        currentFunction: "recoverFinalPortalArrival",
        phase: "recover-final-portal-arrival",
        finalPortalArrivalDeadlineMs: 0,
        finalPortalTeleportGraceDeadlineMs: 0,
        finalPortalClickReadyAtMs: 0,
        missingPortalMiningOrangeTicks: 0,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    if (missingPortalMiningOrangeTicks === 1 || missingPortalMiningOrangeTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.CHECK_PORTAL_MINING_ORANGE,
          `Waiting for salmon portal arrival tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} before orange mining marker search; current tile=${formatGuardianCoordinateLocation(location)} raw='${location?.matchedLine ?? "unreadable"}'.`,
        ),
      );
    }

    return {
      ...state,
      finalPortalTeleportGraceDeadlineMs: 0,
      missingPortalMiningOrangeTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  resolvePendingMovementObservation("success", "salmon portal mining tile confirmed", nowMs, tickCapture.bitmap);

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const orangeObjects = detectAllPortalMiningOrangeObjects(tickCapture.bitmap, PORTAL_MINING_ORANGE_MIN_PIXELS);
  const miningTarget = pickNearestColoredMarker(orangeObjects, playerAnchor);
  if (miningTarget) {
    return clickPortalMiningMarker(
      state,
      captureBounds,
      playerAnchor,
      miningTarget,
      location,
      `Portal arrival confirmed at tile ${formatGuardianCoordinateLocation(location)} and ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker is visible`,
    );
  }

  log(
    stepMessage(
      WORKFLOW_STEPS.CHECK_PORTAL_MINING_ORANGE,
      `Portal travel wait complete at tile ${formatGuardianCoordinateLocation(location)}, but no clickable ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker is visible yet. Candidates=${formatColoredMarkerCandidates(orangeObjects)}. Continuing marker search (distance=${state.finalPortalClickDistancePx === null ? "unknown" : `${Math.round(state.finalPortalClickDistancePx)}px`}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "findPortalMining",
    phase: "find-portal-mining",
    finalPortalArrivalDeadlineMs: 0,
    finalPortalTeleportGraceDeadlineMs: 0,
    finalPortalClickDistancePx: null,
    missingPortalMiningOrangeTicks: 0,
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
  if (location && location.regionId !== GUARDIAN_CRAFTING_REGION_ID) {
    return transitionToReturnPortalRecoveryState(
      state,
      nowMs,
      "finalPortal",
      `Salmon-arrival recovery read outside region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} raw='${location.matchedLine}'. The salmon mining area is also region ${GUARDIAN_CRAFTING_REGION_ID}, so finding ${RETURN_PORTAL_MARKER_COLOR_HEX} red portal to return before retrying salmon portal flow.`,
    );
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const orangeObjects = detectAllPortalMiningOrangeObjects(tickCapture.bitmap, PORTAL_MINING_ORANGE_MIN_PIXELS);
  const miningTarget = pickNearestColoredMarker(orangeObjects, playerAnchor);
  if (isAtFinalPortalMiningTile(location) && miningTarget) {
    return clickPortalMiningMarker(
      state,
      captureBounds,
      playerAnchor,
      miningTarget,
      location,
      `Salmon-arrival recovery confirmed tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} and ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker`,
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
      portalMiningExitPortalMarkerCache: null,
      missingPortalMiningOrangeTicks: 0,
      missingInventoryCountTicks: 0,
      inventoryFreeSlots: null,
      pouchFillAvailableEssenceSlots: state.pouchFillAvailableEssenceSlots,
      craftingInventoryChangeDeadlineMs: 0,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
  const retryPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!isAtFinalPortalMiningTile(location) && retryPortal) {
    const retryPortalClickPoint = getSalmonPortalClickPoint(retryPortal);
    if (state.finalPortalClickReadyAtMs === 0) {
      const readyAtMs = nowMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
      log(
        stepMessage(
          WORKFLOW_STEPS.RECOVER_FINAL_PORTAL_ARRIVAL,
          `Salmon-arrival recovery sees ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} retry portal marker at center=(${retryPortalClickPoint.centerX},${retryPortalClickPoint.centerY}); waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before re-clicking.`,
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

    const travel = estimateTravelWaitTicks(playerAnchor, retryPortalClickPoint);
    const clicked = clickScreenPoint(captureBounds.x + retryPortalClickPoint.centerX, captureBounds.y + retryPortalClickPoint.centerY, captureBounds);
    const clickedAtMs = Date.now();
    log(
        stepMessage(
          WORKFLOW_STEPS.MOVE_TO_FINAL_PORTAL,
        `Salmon-arrival recovery did not confirm tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} yet (current tile=${formatGuardianCoordinateLocation(location)} raw='${location?.matchedLine ?? "unreadable"}'); re-clicked center of ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${retryPortalClickPoint.centerX},${retryPortalClickPoint.centerY}) bounds=(${retryPortal.minX},${retryPortal.minY})-${retryPortal.maxX},${retryPortal.maxY} pixels=${retryPortal.pixelCount}; waiting again before recovery checks (${formatTravelEstimate(travel)}, salmonValidationBuffer=${SALMON_PORTAL_TO_MINING_VALIDATION_BUFFER_TICKS} tick(s)).`,
      ),
    );

    return {
      ...state,
      currentFunction: "waitAfterFinalPortalClick",
      phase: "wait-after-final-portal-click",
      finalPortalClickReadyAtMs: 0,
      finalPortalArrivalDeadlineMs:
        clickedAtMs + (travel.waitTicks + SALMON_PORTAL_TO_MINING_VALIDATION_BUFFER_TICKS) * GAME_TICK_MS,
      finalPortalTeleportGraceDeadlineMs: 0,
      finalPortalClickDistancePx: travel.distancePx,
      missingFinalPortalTicks: 0,
      missingPortalMiningOrangeTicks: 0,
      actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const missingPortalMiningOrangeTicks = state.missingPortalMiningOrangeTicks + 1;
  const rotated = tapKey(GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY);
  if (missingPortalMiningOrangeTicks === 1 || missingPortalMiningOrangeTicks % 5 === 0) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.RECOVER_FINAL_PORTAL_ARRIVAL,
        `Salmon-arrival recovery did not confirm both tile ${FINAL_PORTAL_MINING_TILE_X},${FINAL_PORTAL_MINING_TILE_Y} and ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker yet; current tile=${formatGuardianCoordinateLocation(location)} region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} raw='${location?.matchedLine ?? "unreadable"}', miningCandidates=${formatColoredMarkerCandidates(orangeObjects)}, portalCandidates=${formatGuardianOfTheRiftPortalCandidates(portalCandidates)}, ${formatMiningStatus(miningStatus)}. ${rotated ? `Tapped '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'` : `Could not tap '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'`} before retry ${missingPortalMiningOrangeTicks}.`,
      ),
    );
  }

  return {
    ...state,
    missingPortalMiningOrangeTicks,
    actionLockUntilMs: nowMs + GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
  };
}

function runFindPortalMiningTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const orangeObjects = detectAllPortalMiningOrangeObjects(tickCapture.bitmap, PORTAL_MINING_ORANGE_MIN_PIXELS);
  const miningTarget = pickNearestColoredMarker(orangeObjects, playerAnchor);
  if (!miningTarget) {
    const missingPortalMiningOrangeTicks = state.missingPortalMiningOrangeTicks + 1;
    if (missingPortalMiningOrangeTicks === 1 || missingPortalMiningOrangeTicks % 5 === 0) {
      warn(
        stepMessage(
          WORKFLOW_STEPS.CHECK_PORTAL_MINING_ORANGE,
          `No clickable ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker found yet. Candidates=${formatColoredMarkerCandidates(orangeObjects)}.`,
        ),
      );
    }

    return {
      ...state,
      missingPortalMiningOrangeTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  const miningClickPoint = getBoundsCenterPoint(miningTarget);
  const travel = estimateTravelWaitTicks(playerAnchor, miningClickPoint);
  const clicked = clickScreenPoint(captureBounds.x + miningClickPoint.centerX, captureBounds.y + miningClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.TRAVEL_TO_PORTAL_MINING,
      `Clicked randomized pixel inside ${PORTAL_MINING_MARKER_COLOR_HEX} orange mining marker at (${clicked.x},${clicked.y}) local=(${miningClickPoint.centerX},${miningClickPoint.centerY}) bounds=(${miningTarget.minX},${miningTarget.minY})-(${miningTarget.maxX},${miningTarget.maxY}) pixels=${miningTarget.pixelCount}; waiting before monitoring inventory (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "portalMining",
    phase: "portal-mining",
    portalMiningArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    cachedPortalMiningMarker: miningTarget,
    missingPortalMiningOrangeTicks: 0,
    missingInventoryCountTicks: 0,
    inventoryFreeSlots: null,
    pouchFillAvailableEssenceSlots: state.pouchFillAvailableEssenceSlots,
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

  const currentState = rememberPortalMiningExitPortalMarker(state, nowMs, tickCapture.bitmap);
  const inventory = detectInventoryCount(tickCapture.bitmap);
  if (inventory.count === null) {
    const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
      const debugPath = `test-image-debug/guardian-portal-mining-inventory-${currentState.loopIndex}.png`;
      saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
      warn(
        stepMessage(
          WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL,
          `Inventory free-space unreadable while portal mining; saved debug image to ${debugPath}.`,
        ),
      );
    }

    return {
      ...currentState,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (inventory.count === 0) {
    const pouchesToFill = selectOptimizedPouchesNeedingFillBatch(currentState);
    if (!currentState.portalMiningPouchesFilledThisCycle && pouchesToFill.length > 0) {
      const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
      const refreshedMiningMarker = pickNearestColoredMarker(
        detectAllPortalMiningOrangeObjects(tickCapture.bitmap, PORTAL_MINING_ORANGE_MIN_PIXELS),
        playerAnchor,
      );
      const fillState = refreshedMiningMarker
        ? {
            ...currentState,
            cachedPortalMiningMarker: refreshedMiningMarker,
          }
        : currentState;
      setAutomateBotCurrentStep(STEP_FILL_POUCHES_ID);
      log(
        stepMessage(
          WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
          `Inventory is full after portal mining and ${pouchesToFill.length} pouch(es) still need essence; filling optimized pouch batch ${formatPouchClickList(pouchesToFill)} before reclicking the orange mining marker. Fill budget=${fillState.pouchFillAvailableEssenceSlots ?? "unknown"} essence slot(s), batch missing sum=${pouchesToFill.reduce((sum, location) => sum + getPouchMissingEssence(fillState, location.pouch), 0)}. cachedMining=${refreshedMiningMarker ? `refreshed (${refreshedMiningMarker.centerX},${refreshedMiningMarker.centerY})` : fillState.cachedPortalMiningMarker ? "previous" : "none"}; Pouch memory=${formatPouchEssenceSummary(fillState)}.`,
        ),
      );

      return {
        ...fillState,
        currentFunction: "fillPouchesAfterPortalMiningFull",
        phase: "fill-pouches-after-portal-mining-full",
        pouchClickQueue: pouchesToFill,
        pouchClickIndex: 0,
        pouchClickIntent: "fill",
        pouchClickPending: null,
        pouchClickBatchMovedEssence: 0,
        inventoryFreeSlots: inventory.count,
        missingInventoryCountTicks: 0,
        missingPortalMiningOrangeTicks: 0,
        craftingInventoryChangeDeadlineMs: 0,
        actionLockUntilMs: 0,
      };
    }

    log(stepMessage(WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL, "Inventory is full after portal mining; finding exit portal."));
    return {
      ...currentState,
      currentFunction: "findPortalExit",
      phase: "find-portal-exit",
      inventoryFreeSlots: inventory.count,
      pouchFillAvailableEssenceSlots: null,
      missingInventoryCountTicks: 0,
      missingPortalExitTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      actionLockUntilMs: 0,
    };
  }

  if (currentState.inventoryFreeSlots === null || inventory.count !== currentState.inventoryFreeSlots) {
    log(
      stepMessage(
        WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL,
        `Portal mining inventory free-space ${currentState.inventoryFreeSlots === null ? "initialized" : "changed"}: ${currentState.inventoryFreeSlots ?? "unknown"} -> ${inventory.count}.`,
      ),
    );
    return {
      ...currentState,
      inventoryFreeSlots: inventory.count,
      pouchFillAvailableEssenceSlots:
        currentState.pouchFillAvailableEssenceSlots ?? (currentState.inventoryFreeSlots === null ? inventory.count : null),
      missingInventoryCountTicks: 0,
      craftingInventoryChangeDeadlineMs: nowMs + PORTAL_MINING_INVENTORY_CHANGE_CHECK_TICKS * GAME_TICK_MS,
      portalMiningPouchesFilledThisCycle: hasPouchesNeedingFill(currentState) ? false : currentState.portalMiningPouchesFilledThisCycle,
      actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
    };
  }

  if (currentState.craftingInventoryChangeDeadlineMs > 0 && nowMs >= currentState.craftingInventoryChangeDeadlineMs) {
    warn(
      stepMessage(
        WORKFLOW_STEPS.PORTAL_MINE_UNTIL_FULL,
        `Inventory free-space stayed at ${inventory.count} for ${PORTAL_MINING_INVENTORY_CHANGE_CHECK_TICKS} tick(s); checking orange mining marker again.`,
      ),
    );
    return {
      ...currentState,
      currentFunction: "findPortalMining",
      phase: "find-portal-mining",
      inventoryFreeSlots: inventory.count,
      missingInventoryCountTicks: 0,
      missingPortalMiningOrangeTicks: 0,
      craftingInventoryChangeDeadlineMs: 0,
      actionLockUntilMs: 0,
    };
  }

  return {
    ...currentState,
    inventoryFreeSlots: inventory.count,
    missingInventoryCountTicks: 0,
    actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
  };
}

function runFillPouchesAfterPortalMiningFullTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
): BotState {
  if (nowMs < state.actionLockUntilMs) {
    return state;
  }

  let currentState = state;
  if (currentState.pouchClickPending) {
    const inventory = detectInventoryCount(tickCapture.bitmap);
    if (inventory.count === null) {
      const missingInventoryCountTicks = currentState.missingInventoryCountTicks + 1;
      if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % 10 === 0) {
        const debugPath = `test-image-debug/guardian-fill-pouch-portal-mining-inventory-${currentState.loopIndex}.png`;
        saveBitmapWithInventoryCountDebug(tickCapture.bitmap, inventory, debugPath);
        warn(
          stepMessage(
            WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
            `Inventory free-space unreadable after ${currentState.pouchClickPending.pouch} pouch fill click; saved debug image to ${debugPath}.`,
          ),
        );
      }

      return {
        ...currentState,
        missingInventoryCountTicks,
        actionLockUntilMs: nowMs + FAST_ACTION_RETRY_MS,
      };
    }

    const pendingClick = currentState.pouchClickPending;
    const result = updatePouchEssenceAfterInventoryDelta(currentState, pendingClick, inventory.count);
    currentState = result.state;
    log(
      stepMessage(
        WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
        `Pouch fill verification for ${pendingClick.pouch}: free-space ${pendingClick.beforeFreeSlots} -> ${inventory.count}, observedFreedSlots=${result.delta}; marked ${pendingClick.pouch} full deterministically; pouch memory=${formatPouchEssenceSummary(currentState)}.`,
      ),
    );
  }

  if (currentState.pouchClickIndex < currentState.pouchClickQueue.length) {
    return clickNextPouchForInventoryDelta(
      currentState,
      captureBounds,
      nowMs,
      WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
      "fill",
    );
  }

  const filledPouchCount = currentState.pouchClickQueue.length;
  const movedEssence = currentState.pouchClickBatchMovedEssence;
  const allRememberedPouchesFull = !hasPouchesNeedingFill(currentState);
  log(
    stepMessage(
      WORKFLOW_STEPS.FILL_POUCHES_AFTER_PORTAL_MINING_FULL,
      `Finished filling ${filledPouchCount} pouch click(s), moved=${movedEssence}; keeping phase fill budget=${currentState.pouchFillAvailableEssenceSlots ?? "unknown"}; ${allRememberedPouchesFull ? "all remembered pouches are now full" : "some pouches still need essence"} (${formatPouchEssenceSummary(currentState)}). ${currentState.cachedPortalMiningMarker ? "Clicking cached orange mining marker after final pouch validation." : "No cached orange mining marker is available; waiting one game tick before returning to orange mining marker search."}`,
    ),
  );

  const reclickedMining = clickCachedPortalMiningAfterPouchFill(currentState, tickCapture, captureBounds);
  if (reclickedMining) {
    return reclickedMining;
  }

  return {
    ...currentState,
    ...resetPouchClickQueue(),
    currentFunction: "findPortalMining",
    phase: "find-portal-mining",
    inventoryFreeSlots: null,
    pouchFillAvailableEssenceSlots: currentState.pouchFillAvailableEssenceSlots,
    missingInventoryCountTicks: 0,
    missingPortalMiningOrangeTicks: 0,
    craftingInventoryChangeDeadlineMs: 0,
    portalMiningPouchesFilledThisCycle: true,
    actionLockUntilMs: nowMs + POUCH_POST_SEQUENCE_SETTLE_MS,
  };
}

function clickPortalExitMarker(
  state: BotState,
  nowMs: number,
  captureBounds: ScreenCaptureBounds,
  playerAnchor: { centerX: number; centerY: number },
  exitPortal: GuardianOfTheRiftPortalMarkerDetection,
  markerSource: string,
): BotState {
  const exitPortalClickPoint = getSalmonPortalClickPoint(exitPortal);
  const travel = estimateTravelWaitTicks(playerAnchor, exitPortalClickPoint);
  const clicked = clickScreenPoint(captureBounds.x + exitPortalClickPoint.centerX, captureBounds.y + exitPortalClickPoint.centerY, captureBounds);
  const clickedAtMs = Date.now();
  log(
    stepMessage(
      WORKFLOW_STEPS.FIND_PORTAL_EXIT,
      `Clicked center of ${markerSource} ${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} portal marker at (${clicked.x},${clicked.y}) local=(${exitPortalClickPoint.centerX},${exitPortalClickPoint.centerY}) bounds=(${exitPortal.minX},${exitPortal.minY})-${exitPortal.maxX},${exitPortal.maxY} pixels=${exitPortal.pixelCount}; waiting to return before repeating guardian click (${formatTravelEstimate(travel)}).`,
    ),
  );

  return {
    ...state,
    currentFunction: "waitAfterPortalExitClick",
    phase: "wait-after-portal-exit-click",
    portalMiningExitPortalMarkerCache: null,
    portalExitClickReadyAtMs: 0,
    portalExitArrivalDeadlineMs: clickedAtMs + travel.waitTicks * GAME_TICK_MS,
    portalExitClickDistancePx: travel.distancePx,
    missingPortalExitTicks: 0,
    actionLockUntilMs: clickedAtMs + GUARDIAN_RETURN_CLICK_LOCK_TICKS * GAME_TICK_MS,
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
    warn(
      stepMessage(
        WORKFLOW_STEPS.REPEAT_GUARDIAN_CLICK,
        `While searching for the salmon exit portal, coordinate read outside region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} raw='${location.matchedLine}'. Treating this as already out of portal mining and resuming post-portal flow instead of searching for the red return portal.`,
      ),
    );
    return transitionToPostPortalDepositResumeState(state, nowMs);
  }

  if (location && !isInPortalMiningZone(location)) {
    log(
      stepMessage(
        WORKFLOW_STEPS.REPEAT_GUARDIAN_CLICK,
        `While searching for the salmon exit portal, coordinate already confirms we left portal mining: tile=${formatGuardianCoordinateLocation(location)} chunk=${location.chunkId} raw='${location.matchedLine}'. Resuming post-portal flow.`,
      ),
    );
    return transitionToPostPortalDepositResumeState(state, nowMs);
  }

  const playerAnchor = getPlayerAnchor(tickCapture.bitmap);
  const cachedExitPortal = state.portalMiningExitPortalMarkerCache;
  if (cachedExitPortal) {
    const cachedExitPortalClickPoint = getSalmonPortalClickPoint(cachedExitPortal.marker);
    const readyAtMs = cachedExitPortal.firstSeenAtMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
    if (nowMs < readyAtMs) {
      if (state.portalExitClickReadyAtMs === 0) {
        log(
          stepMessage(
            WORKFLOW_STEPS.FIND_PORTAL_EXIT,
            `${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} cached salmon exit portal was seen during portal mining at center=(${cachedExitPortalClickPoint.centerX},${cachedExitPortalClickPoint.centerY}); waiting ${Math.max(1, Math.ceil((readyAtMs - nowMs) / GAME_TICK_MS))} game tick(s) before clicking.`,
          ),
        );
      }

      return {
        ...state,
        portalExitClickReadyAtMs: readyAtMs,
        actionLockUntilMs: readyAtMs,
      };
    }

    return clickPortalExitMarker(state, nowMs, captureBounds, playerAnchor, cachedExitPortal.marker, "cached");
  }

  const portalCandidates = detectGuardianOfTheRiftPortalMarkersInScreenshot(tickCapture.bitmap);
  const exitPortal = pickNearestGuardianOfTheRiftPortalMarker(portalCandidates, playerAnchor);
  if (!exitPortal) {
    const missingPortalExitTicks = state.missingPortalExitTicks + 1;
    const rotated = tapKey(GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY);
    warn(
      stepMessage(
        WORKFLOW_STEPS.FIND_PORTAL_EXIT,
        `Salmon exit portal marker is not visible and coordinate does not confirm we left portal-mining zone (${formatPortalMiningZoneDescription()}). Last coordinate=${formatGuardianCoordinateLocation(location)} region=${location?.regionId ?? "unknown"} chunk=${location?.chunkId ?? "unknown"} raw='${location?.matchedLine ?? "unreadable"}'. ${rotated ? `Tapped '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'` : `Could not tap '${GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_KEY}'`} before searching again.`,
      ),
    );
    return {
      ...state,
      missingPortalExitTicks,
      actionLockUntilMs: nowMs + GUARDIAN_SALMON_PORTAL_CAMERA_ROTATE_LOCK_TICKS * GAME_TICK_MS,
    };
  }

  const exitPortalClickPoint = getSalmonPortalClickPoint(exitPortal);
  const portalExitCache = updateCachedMarker(null, exitPortal, nowMs, state.loopIndex);
  if (state.portalExitClickReadyAtMs === 0) {
    const readyAtMs = portalExitCache.firstSeenAtMs + SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS * GAME_TICK_MS;
    log(
      stepMessage(
        WORKFLOW_STEPS.FIND_PORTAL_EXIT,
        `${GUARDIAN_OF_THE_RIFT_PORTAL_MARKER_COLOR_HEX} salmon exit portal marker found at center=(${exitPortalClickPoint.centerX},${exitPortalClickPoint.centerY}); waiting ${SALMON_PORTAL_PRE_CLICK_SETTLE_TICKS} game tick(s) before clicking.`,
      ),
    );

    return {
      ...state,
      portalMiningExitPortalMarkerCache: portalExitCache,
      portalExitClickReadyAtMs: readyAtMs,
      missingPortalExitTicks: 0,
      actionLockUntilMs: readyAtMs,
    };
  }

  if (nowMs < state.portalExitClickReadyAtMs) {
    return {
      ...state,
      portalMiningExitPortalMarkerCache: portalExitCache,
      actionLockUntilMs: state.portalExitClickReadyAtMs,
    };
  }

  return clickPortalExitMarker(
    {
      ...state,
      portalMiningExitPortalMarkerCache: portalExitCache,
    },
    nowMs,
    captureBounds,
    playerAnchor,
    exitPortal,
    "fresh",
  );
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
          `Portal exit not confirmed yet; coordinate overlay is unreadable. Waiting to move outside portal-mining zone (${formatPortalMiningZoneDescription()}).`,
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
    warn(
      stepMessage(
        WORKFLOW_STEPS.REPEAT_GUARDIAN_CLICK,
        `Salmon exit portal return read outside region ${GUARDIAN_CRAFTING_REGION_ID}: tile=${formatGuardianCoordinateLocation(location)} region=${location.regionId} chunk=${location.chunkId} raw='${location.matchedLine}'. Resuming post-portal flow instead of searching for the red return portal; red return recovery is only valid while entering salmon mining.`,
      ),
    );
    return transitionToPostPortalDepositResumeState(
      {
        ...state,
        portalExitArrivalDeadlineMs: 0,
        portalExitClickDistancePx: null,
        missingPortalExitTicks: 0,
      },
      nowMs,
    );
  }

  if (isInPortalMiningZone(location)) {
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
  currentCaptureWidth = captureBounds.width;
  currentCaptureHeight = captureBounds.height;
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
    initializeStablePlayerAnchor(startupBitmap);
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
    currentMovementModel = selectGuardianOfTheRiftMovementModel({
      bitmap: startupBitmap,
      context: {
        monitorTier: currentMonitorTier,
        windowsScalePercent: currentWindowsScalePercent,
      },
      thresholds: MOVEMENT_MODEL_THRESHOLDS,
    });
    log(
      `Movement model: ${formatMovementModelSelection(currentMovementModel)} profile=${currentMonitorTier}-${currentWindowsScalePercent}-${currentCaptureWidth}x${currentCaptureHeight} thresholds(long>=${MOVEMENT_MODEL_LONG_DISTANCE_TILES}, veryLong>=${MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES}, topY<=${MOVEMENT_MODEL_TOP_SCREEN_Y_RATIO}, axis>=${MOVEMENT_MODEL_AXIS_DOMINANCE_RATIO}, maxExtra=${MOVEMENT_MODEL_MAX_EXTRA_WAIT_TICKS}).`,
    );
    if (STARTUP_COORDINATE_VALIDATION_DELAY_MS > 0) {
      await sleepWithAbort(STARTUP_COORDINATE_VALIDATION_DELAY_MS, () => AppState.automateBotRunning);
      if (!AppState.automateBotRunning) {
        return;
      }
    }

    const startupValidationBitmap = captureScreenBitmap(captureBounds);
    const initialState = createStartupInitialState(startupBitmap, pouchInventory, startupValidationBitmap);

    await runBotEngine<BotState, EngineFunctionKey, TickCapture>({
      tickMs: BOT_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: () => initialState,
      captureTick: ({ state, nowMs }) => captureGuardianTick(state, nowMs, captureBounds),
      observeTick: ({ state, nowMs, tickCapture }) => {
        const observedState = trackActiveGuardianRuneTimer(state, nowMs, tickCapture, activeRuneTemplates);
        if (
          !ENABLE_COORDINATE_AUTO_SCREENSHOTS ||
          observedState.loopIndex % COORDINATE_AUTO_SCREENSHOT_INTERVAL_TICKS !== 0
        ) {
          if (!worldMapper || observedState.loopIndex % WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS !== 0) {
            return observedState;
          }
        }

        if (worldMapper && observedState.loopIndex % WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS === 0) {
          const observation = readWorldMapObservationFromBitmap({
            bitmap: tickCapture.bitmap,
            observedAtMs: nowMs,
            windowsScalePercent: currentWindowsScalePercent,
          });
          if (observation) {
            worldMapper.enqueueObservation(observation, {
              screenshotBitmap: tickCapture.bitmap,
            });

            if (
              observedState.loopIndex === WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS ||
              observedState.loopIndex % WORLD_MAPPER_LOG_INTERVAL_TICKS === 0
            ) {
              log(
                `World mapper observation: matched='${observation.matchedLine}' regionId=${observation.tile.regionId} chunkId=${observation.tile.chunkId} worldChunk=${observation.tile.worldChunkX},${observation.tile.worldChunkY}.`,
              );
            }
          } else if (
            observedState.loopIndex === WORLD_MAPPER_OBSERVATION_INTERVAL_TICKS ||
            observedState.loopIndex % WORLD_MAPPER_LOG_INTERVAL_TICKS === 0
          ) {
            warn(`World mapper observation unreadable at loop #${observedState.loopIndex}.`);
          }
        }

        if (
          !ENABLE_COORDINATE_AUTO_SCREENSHOTS ||
          observedState.loopIndex % COORDINATE_AUTO_SCREENSHOT_INTERVAL_TICKS !== 0
        ) {
          return observedState;
        }

        const result = saveCoordinateAutoScreenshot({
          bitmap: tickCapture.bitmap,
          monitorTier: currentMonitorTier,
          windowsScalePercent: currentWindowsScalePercent,
        });
        if (!result.saved) {
          return observedState;
        }

        setCurrentLogLoopIndex(observedState.loopIndex);
        setCurrentLogPhase(observedState.phase);
        log(`Coordinate auto screenshot saved: matched='${result.matchedLine}' path=${result.filePath}.`);
        return observedState;
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
          return state.phase === "mining"
            ? runMiningTick(state, nowMs, tickCapture, captureBounds, config, portalOpenIconTemplate)
            : state;
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
            ? runWorkbenchFindYellowTick(state, nowMs, tickCapture, captureBounds, config, portalOpenIconTemplate)
            : state;
        },
        craft: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "crafting"
            ? runCraftingTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
            : state;
        },
        fillPouchesAfterWorkbenchFull: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "fill-pouches-after-workbench-full"
            ? runFillPouchesAfterWorkbenchFullTick(state, nowMs, tickCapture, captureBounds)
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
            ? runWaitAfterGreatGuardianClickTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
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
            ? runWaitAfterChargedCellDepositClickTick(state, nowMs, tickCapture, captureBounds, portalOpenIconTemplate)
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
        findPortalMining: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "find-portal-mining"
            ? runFindPortalMiningTick(state, nowMs, tickCapture, captureBounds)
            : state;
        },
        portalMining: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "portal-mining" ? runPortalMiningTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        fillPouchesAfterPortalMiningFull: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "fill-pouches-after-portal-mining-full"
            ? runFillPouchesAfterPortalMiningFullTick(state, nowMs, tickCapture, captureBounds)
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
    currentCaptureWidth = 0;
    currentCaptureHeight = 0;
    currentMovementModel = null;
    pendingMovementObservation = null;
    stablePlayerAnchor = null;
    currentRunStats = null;
    setCurrentLogLoopIndex(0);
    setCurrentLogPhase(null);
    setAutomateBotCurrentStep(null);
  }
}

export function onRunecraftingGuardianOfTheRiftBotStart(): void {
  setCurrentLogLoopIndex(0);
  setCurrentLogPhase("startup");
  setAutomateBotLogFooterProvider(buildGuardianRunStatsFooter);
  resetGuardianRunStats(Date.now());

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

      await prepareStartupCameraPitch();
      if (!AppState.automateBotRunning) {
        return;
      }

      await prepareStartupUiForPouchCheck();
      if (!AppState.automateBotRunning) {
        return;
      }

      await runLoop(captureBounds, config, portalOpenIconTemplate, pouchTemplates, activeRuneTemplates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Startup failed: ${message}`);
      notifyUserAndStop(message);
    }
  })();
}
