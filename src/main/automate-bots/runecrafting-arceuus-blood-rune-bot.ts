import { keyTap, keyToggle } from "robotjs";

import { AppState } from "../global-state";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap, type ScreenCaptureBounds } from "../windowsScreenCapture";
import { getSavedArceuusBloodRuneConfig } from "../csvOperator";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID } from "./definitions";
import { runBotEngine, sleepWithAbort } from "./engine/bot-engine";
import {
  detectArceuusDenseRunestones,
  isPointInsideArceuusDenseRunestone,
  pickNearestActiveArceuusDenseRunestone,
  type ArceuusDenseRunestone,
} from "./shared/arceuus-dense-runestone-detector";
import {
  detectArceuusYellowMarkers,
  getArceuusYellowMarkerTierForAgilityLevel,
  pickArceuusYellowMarkerForAgilityLevel,
  type ArceuusYellowMarker,
} from "./shared/arceuus-yellow-marker-detector";
import {
  detectArceuusEssenceInventory,
  formatArceuusEssenceInventoryDetection,
  formatArceuusEssenceInventoryDetectionDetails,
  loadArceuusEssenceIconTemplates,
  type ArceuusEssenceIconMatch,
  type ArceuusEssenceIconTemplate,
  type ArceuusEssenceInventoryDetection,
} from "./shared/arceuus-essence-inventory-detector";
import {
  detectArceuusChiselInventory,
  formatArceuusChiselInventoryDetection,
  formatArceuusChiselInventoryDetectionDetails,
  loadArceuusChiselIconTemplate,
  type ArceuusChiselInventoryDetection,
  type ArceuusChiselInventoryMatch,
} from "./shared/arceuus-chisel-inventory-detector";
import {
  detectBlueOutlines,
  pickFarthestBlueOutlineFromAnchor,
  type BlueOutlineDetection,
} from "./shared/blue-outline-detector";
import { detectInventoryFreeSpace, saveBitmapWithInventoryFreeSpaceDebug } from "./shared/inventory-free-space";
import { detectLargestMagentaObject, type MagentaObjectDetection } from "./shared/magenta-object-detector";
import { detectMiningBoxStatusInScreenshot } from "./shared/mining-box-status-detector";
import type { RobotBitmap } from "./shared/ocr-engine";
import {
  clamp,
  estimateTravelTicks,
  pickBoxInteractionScreenPoint,
  ticksToMs,
  type LocalPoint,
  type TravelEstimate,
} from "./shared/osrs-helper";
import { detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";
import { clickScreenPoint, sleepSyncMs } from "./shared/robot-clicker";
import { readStartupPlayerTileCalibration } from "./shared/startup-calibration";
import { createStructuredBotLogger } from "./shared/structured-bot-logger";

type BotPhase =
  | "mining"
  | "select-yellow-marker"
  | "follow-blue-tiles"
  | "check-after-magenta"
  | "return-blue-tiles"
  | "return-yellow-shortcut"
  | "follow-another-blue"
  | "blood-altar-craft"
  | "return-to-mining";
type EngineFunctionKey =
  | "mine"
  | "selectYellowMarker"
  | "followBlueTiles"
  | "checkAfterMagenta"
  | "returnBlueTiles"
  | "returnYellowShortcut"
  | "followAnotherBlueTiles"
  | "bloodAltarCraft"
  | "returnToMining";

type RememberedRunestone = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  clickedLocalPoint: LocalPoint;
};

type Step12ColorTileStatus = "green" | "red";

type Step12ColorTile = {
  status: Step12ColorTileStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
};

type Step12TravelWaitEstimate = {
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
  movementExtraWaitTicks: number;
  movementReasons: string[];
};

type BotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  actionLockUntilMs: number;
  inventoryFreeSlots: number | null;
  agilityLevel: number;
  missingInventoryCountTicks: number;
  missingRunestoneTicks: number;
  missingYellowMarkerTicks: number;
  missingBlueOutlineTicks: number;
  missingMagentaTicks: number;
  missingReturnYellowMarkerTicks: number;
  blueTravelClicks: number;
  completedReturnTrips: number;
  miningCameraPrepared: boolean;
  pendingLowLevelBlueCameraTurnAtMs: number;
  pendingReturnBlueCameraTurnAtMs: number;
  pendingReturnBlueCameraTurnKey: string | null;
  pendingReturnBlueCameraTurnStage: "green" | "red" | null;
  lastReturnTravelChiselAtMs: number;
  returnBlueGreenCameraTurned: boolean;
  returnBlueRedCameraTurned: boolean;
  lastClickedRunestone: RememberedRunestone | null;
  lastDarkEssenceBlock: ArceuusEssenceIconMatch | null;
  rememberedChisel: ArceuusChiselInventoryMatch | null;
  bloodAltarCraftConfirmed: boolean;
  returnToMiningStage: "red" | "agility-73" | "green" | "blue-1" | "blue-2" | "agility";
};

type StartupOverride = {
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  completedReturnTrips: number;
  rememberedChisel: ArceuusChiselInventoryMatch | null;
};

type TickCapture = {
  bitmap: RobotBitmap;
};

type ArceuusLogicalInventoryCounts = {
  occupiedSlots: number | null;
  bloodRuneStackSlots: number;
  chiselSlots: number;
  fragmentStackSlots: number;
  estimatedEssenceBlockSlots: number | null;
};

const BOT_NAME = "Runecrafting Arceuus Blood Rune";
const STEP_MINE_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-01-mine`;
const STEP_SELECT_YELLOW_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-02-select-yellow-marker`;
const STEP_FOLLOW_BLUE_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-03-follow-blue-tiles`;
const STEP_CLICK_MAGENTA_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-04-click-magenta`;
const STEP_CHECK_MAGENTA_INVENTORY_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-05-check-magenta-inventory`;
const STEP_RETURN_BLUE_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-06-return-blue-tiles`;
const STEP_RETURN_YELLOW_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-07-return-yellow-shortcut`;
const STEP_SECOND_CLICK_MAGENTA_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-11-click-magenta`;
const STEP_SECOND_CHECK_MAGENTA_INVENTORY_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-11-check-magenta-inventory`;
const STEP_FOLLOW_ANOTHER_BLUE_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-12-follow-another-blue`;
const STEP_BLOOD_ALTAR_CRAFT_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-13-blood-altar-craft`;
const STEP_RETURN_TO_MINING_ID = `${RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}-step-14-return-to-mining`;
const BOT_TICK_MS = 200;
const GAME_TICK_MS = 600;
const STARTUP_SETTLE_MS = 180;
const STARTUP_INVENTORY_KEY = "escape";
const POST_CLICK_LOCK_MS = 1_200;
const FAST_RETRY_MS = 200;
const MISSING_LOG_INTERVAL_TICKS = 5;
const INVENTORY_DEBUG_INTERVAL_TICKS = 10;
const STARTUP_CAMERA_NORTH_KEY = "n";
const STARTUP_CAMERA_PITCH_UP_KEY = "w";
const STARTUP_CAMERA_PITCH_UP_HOLD_MS = 2_000;
const STARTUP_CAMERA_PITCH_SETTLE_MS = 120;
const CAMERA_ACTION_SETTLE_MS = GAME_TICK_MS;
const MIN_POST_CLICK_CAMERA_TURN_MS = GAME_TICK_MS;
const MINING_CAMERA_KEY = "k";
const AGILITY_ZONE_CAMERA_KEY = "n";
const YELLOW_MARKER_CAMERA_ROTATE_KEY = "a";
const YELLOW_MARKER_CAMERA_ROTATE_LOCK_MS = 400;
const PLAYER_TRAVEL_SPEED_TILES_PER_TICK = 2;
const TRAVEL_MIN_TICKS = 1;
const TRAVEL_EXTRA_WAIT_TICKS = 1;
const AGILITY_52_COURSE_EXTRA_WAIT_TICKS = 7;
const AGILITY_72_COURSE_EXTRA_WAIT_TICKS = 3;
const TRAVEL_TILE_PX_MIN = 24;
const TRAVEL_TILE_PX_MAX = 96;
const TRAVEL_ACTION_KEY = "k";
const STEP6_RETURN_BLUE_CAMERA_KEY = "j";
const STEP6_TOP_RIGHT_BLUE_CAMERA_KEY = "m";
const RETURN_BLUE_GREEN_CAMERA_KEY = "j";
const RETURN_BLUE_RED_CAMERA_KEY = "k";
const RETURN_TO_MINING_RED_CAMERA_KEY = "j";
const RETURN_TO_MINING_GREEN_CAMERA_KEY = "k";
const RETURN_TO_MINING_BLUE_CAMERA_KEY = "j";
const STEP12_GREEN_TILE_HEX = "FF00FF00";
const STEP12_RED_TILE_HEX = "FFFF0000";
const STEP12_COLOR_TILE_MIN_PIXELS = 30;
const STEP12_COLOR_TILE_MIN_SIZE_PX = 4;
const STEP12_COLOR_TILE_STATUS_OVERLAY_MAX_X_RATIO = 0.16;
const STEP12_COLOR_TILE_STATUS_OVERLAY_MIN_Y_RATIO = 0.03;
const STEP12_COLOR_TILE_STATUS_OVERLAY_MAX_Y_RATIO = 0.24;
const STEP12_MOVEMENT_LONG_DISTANCE_TILES = 10;
const STEP12_MOVEMENT_VERY_LONG_DISTANCE_TILES = 16;
const STEP12_MOVEMENT_TOP_SCREEN_DISTANCE_TILES = 8;
const STEP12_MOVEMENT_TOP_SCREEN_Y_RATIO = 0.38;
const STEP12_MOVEMENT_AXIS_DOMINANCE_DISTANCE_TILES = 10;
const STEP12_MOVEMENT_AXIS_DOMINANCE_RATIO = 0.82;
const STEP12_MOVEMENT_MAX_EXTRA_WAIT_TICKS = 3;
const RETURN_TRAVEL_CHISEL_INTERVAL_MS = GAME_TICK_MS;
const RETURN_TRAVEL_CHISEL_CLICK_DELAY_MS = 2 * BOT_TICK_MS;
const INVENTORY_SAME_SLOT_TOLERANCE_PX = 8;
const LOW_LEVEL_BLUE_CAMERA_TURN_DELAY_TICKS = 2;
const BIG_MAGENTA_MIN_PIXELS = 250;
const ARCEUUS_BLOOD_RUNE_STACK_SLOTS = 1;

let isLoopRunning = false;
const structuredLogger = createStructuredBotLogger(BOT_NAME, { includeBotPrefix: false, maxStep: 13 });

function phaseLabel(phase: BotPhase | "startup"): string {
  switch (phase) {
    case "startup":
      return "Step 0 startup";
    case "mining":
      return "Step 1 mining";
    case "select-yellow-marker":
      return "Step 2 agility-zone";
    case "follow-blue-tiles":
      return "Step 3 follow-blue";
    case "check-after-magenta":
      return "Step 4 check-magenta-inventory";
    case "return-blue-tiles":
      return "Step 6 return-blue";
    case "return-yellow-shortcut":
      return "Step 7 return-yellow-shortcut";
    case "follow-another-blue":
      return "Step 12 follow-another-blue";
    case "blood-altar-craft":
      return "Step 13 blood-altar-craft";
    case "return-to-mining":
      return "Step 14 return-to-mining";
  }
}

function phaseLog(phase: BotPhase | "startup", message: string): string {
  return structuredLogger.format(phaseLabel(phase), message);
}

function phaseLogText(label: string, message: string): string {
  return structuredLogger.format(label, message);
}

function miningPhaseLog(state: BotState, message: string): string {
  return phaseLogText(state.completedReturnTrips > 0 ? "Step 7 mining-again" : "Step 1 mining", message);
}

function agilityZonePhaseLog(state: BotState, message: string): string {
  return phaseLogText(state.completedReturnTrips > 0 ? "Step 9 agility-zone" : "Step 2 agility-zone", message);
}

function followBluePhaseLog(state: BotState, message: string): string {
  return phaseLogText(state.completedReturnTrips > 0 ? "Step 10 follow-blue" : "Step 3 follow-blue", message);
}

function magentaPhaseLog(state: BotState, message: string): string {
  return phaseLogText(state.completedReturnTrips > 0 ? "Step 11 magenta" : "Step 4 magenta", message);
}

function checkAfterMagentaStepId(state: Pick<BotState, "completedReturnTrips">): string {
  return state.completedReturnTrips > 0 ? STEP_SECOND_CHECK_MAGENTA_INVENTORY_ID : STEP_CHECK_MAGENTA_INVENTORY_ID;
}

function checkAfterMagentaPhaseLog(state: Pick<BotState, "completedReturnTrips">, message: string): string {
  return phaseLogText(state.completedReturnTrips > 0 ? "Step 11 check-magenta-inventory" : "Step 5 check-magenta-inventory", message);
}

function followAnotherBluePhaseLog(message: string): string {
  return phaseLogText("Step 12 follow-another-blue", message);
}

function returnBluePhaseLog(message: string): string {
  return phaseLogText("Step 6 return-blue", message);
}

function returnYellowShortcutPhaseLog(message: string): string {
  return phaseLogText("Step 7 return-yellow-shortcut", message);
}

function returnToMiningPhaseLog(message: string): string {
  return phaseLogText("Step 14 return-to-mining", message);
}

function statePhaseLabel(state: BotState): string {
  switch (state.phase) {
    case "mining":
      return state.completedReturnTrips > 0 ? "Step 7 mining-again" : "Step 1 mining";
    case "select-yellow-marker":
      return state.completedReturnTrips > 0 ? "Step 9 agility-zone" : "Step 2 agility-zone";
    case "follow-blue-tiles":
      return state.completedReturnTrips > 0 ? "Step 10 follow-blue" : "Step 3 follow-blue";
    case "check-after-magenta":
      return state.completedReturnTrips > 0 ? "Step 11 check-magenta-inventory" : "Step 5 check-magenta-inventory";
    case "return-blue-tiles":
      return "Step 6 return-blue";
    case "return-yellow-shortcut":
      return "Step 7 return-yellow-shortcut";
    case "follow-another-blue":
      return "Step 12 follow-another-blue";
    case "blood-altar-craft":
      return "Step 13 blood-altar-craft";
    case "return-to-mining":
      return "Step 14 return-to-mining";
  }
}

function setLogContextFromState(state: Pick<BotState, "loopIndex" | "phase" | "completedReturnTrips">): void {
  structuredLogger.setContext({
    loopIndex: state.loopIndex,
    label: statePhaseLabel(state as BotState),
  });
}

function log(message: string): void {
  structuredLogger.log(message);
}

function warn(message: string): void {
  structuredLogger.warn(message);
}

function logSimulatedKey(phase: BotPhase | "startup", key: string, ok: boolean, reason: string): void {
  log(phaseLog(phase, `SIM key '${key}' ${ok ? "sent" : "failed"}; reason=${reason}.`));
}

function logSimulatedClick(
  label: string,
  clicked: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
  reason: string,
): void {
  log(
    phaseLogText(
      label,
      `SIM click left screen=(${clicked.x},${clicked.y}) local=(${clicked.x - captureBounds.x},${clicked.y - captureBounds.y}); reason=${reason}.`,
    ),
  );
}

function logStateTransition(
  from: BotState,
  toFunction: EngineFunctionKey,
  toPhase: BotPhase,
  lockUntilMs: number,
  nowMs: number,
  reason: string,
): void {
  log(
    phaseLogText(
      phaseLabel(from.phase),
      `STATE ${from.currentFunction}/${from.phase} -> ${toFunction}/${toPhase}; lockMs=${Math.max(0, lockUntilMs - nowMs)}; reason=${reason}.`,
    ),
  );
}

function cameraActionLockUntil(nowMs: number): number {
  return nowMs + CAMERA_ACTION_SETTLE_MS;
}

function earliestCameraTurnAfterClick(clickedAtMs: number, requestedAtMs: number): number {
  return Math.max(requestedAtMs, clickedAtMs + MIN_POST_CLICK_CAMERA_TURN_MS);
}

function tapCameraKey(key: string, phase: BotPhase | "startup", reason: string): boolean {
  let result = false;

  if (typeof keyToggle === "function") {
    try {
      keyToggle(key, "down");
      keyToggle(key, "up");
      result = true;
      logSimulatedKey(phase, key, result, reason);
      return result;
    } catch (error) {
      warn(`RobotJS keyToggle('${key}') failed: ${error instanceof Error ? error.message : String(error)}. Trying keyTap fallback.`);
    }
  }

  if (typeof keyTap !== "function") {
    logSimulatedKey(phase, key, false, `${reason}; robotjs keyTap unavailable`);
    return false;
  }

  try {
    keyTap(key);
    result = true;
  } catch (error) {
    warn(`RobotJS keyTap('${key}') failed: ${error instanceof Error ? error.message : String(error)}.`);
    logSimulatedKey(phase, key, false, reason);
    return false;
  }

  logSimulatedKey(phase, key, result, reason);
  return result;
}

async function holdCameraKey(key: string, holdMs: number): Promise<boolean> {
  let keyDown = false;

  try {
    keyToggle(key, "down");
    keyDown = true;
    await sleepWithAbort(holdMs, () => AppState.automateBotRunning);
    return true;
  } catch (error) {
    warn(`Failed to hold camera key "${key}": ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    if (keyDown) {
      try {
        keyToggle(key, "up");
      } catch (error) {
        warn(`Failed to release camera key "${key}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function prepareStartupCamera(): Promise<void> {
  const turnedNorth = tapCameraKey(STARTUP_CAMERA_NORTH_KEY, "startup", "startup camera north");
  const pitchedTop = await holdCameraKey(STARTUP_CAMERA_PITCH_UP_KEY, STARTUP_CAMERA_PITCH_UP_HOLD_MS);

  if (AppState.automateBotRunning) {
    await sleepWithAbort(STARTUP_CAMERA_PITCH_SETTLE_MS, () => AppState.automateBotRunning);
  }

  log(phaseLog("startup", `Startup camera prepared. north=${turnedNorth ? "ok" : "failed"} pitchTop=${pitchedTop ? "ok" : "failed"}.`));
}

function createInitialState(
  agilityLevel: number,
  startupOverride: StartupOverride | null = null,
): BotState {
  return {
    loopIndex: 0,
    currentFunction: startupOverride?.currentFunction ?? "mine",
    phase: startupOverride?.phase ?? "mining",
    actionLockUntilMs: 0,
    inventoryFreeSlots: null,
    agilityLevel,
    missingInventoryCountTicks: 0,
    missingRunestoneTicks: 0,
    missingYellowMarkerTicks: 0,
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: 0,
    missingReturnYellowMarkerTicks: 0,
    blueTravelClicks: 0,
    completedReturnTrips: startupOverride?.completedReturnTrips ?? 0,
    miningCameraPrepared: false,
    pendingLowLevelBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnKey: null,
    pendingReturnBlueCameraTurnStage: null,
    lastReturnTravelChiselAtMs: 0,
    returnBlueGreenCameraTurned: false,
    returnBlueRedCameraTurned: false,
    lastClickedRunestone: null,
    lastDarkEssenceBlock: null,
    rememberedChisel: startupOverride?.rememberedChisel ?? null,
    bloodAltarCraftConfirmed: false,
    returnToMiningStage: "red",
  };
}

function rememberClickedRunestone(runestone: ArceuusDenseRunestone, clickedLocalPoint: LocalPoint): RememberedRunestone {
  return {
    x: runestone.x,
    y: runestone.y,
    width: runestone.width,
    height: runestone.height,
    centerX: runestone.centerX,
    centerY: runestone.centerY,
    clickedLocalPoint,
  };
}

function isLastClickedRunestoneDepleted(
  lastClickedRunestone: RememberedRunestone | null,
  runestones: readonly ArceuusDenseRunestone[],
): boolean {
  if (!lastClickedRunestone) {
    return false;
  }

  return runestones.some(
    (runestone) =>
      runestone.status === "depleted" &&
      (isPointInsideArceuusDenseRunestone(lastClickedRunestone.clickedLocalPoint, runestone) ||
        isPointInsideArceuusDenseRunestone({ x: lastClickedRunestone.centerX, y: lastClickedRunestone.centerY }, runestone)),
  );
}

function formatRunestone(runestone: ArceuusDenseRunestone): string {
  return `${runestone.status} center=(${runestone.centerX},${runestone.centerY}) size=${runestone.width}x${runestone.height} pixels=${runestone.pixelCount} fill=${runestone.fillRatio.toFixed(3)}`;
}

function isStep12ExactColorTilePixel(r: number, g: number, b: number, status: Step12ColorTileStatus): boolean {
  if (status === "green") {
    return r === 0 && g === 255 && b === 0;
  }

  return r === 255 && g === 0 && b === 0;
}

function isInsideStep12ColorTileOverlayExclusion(bitmap: RobotBitmap, x: number, y: number): boolean {
  return (
    x <= Math.max(220, Math.round(bitmap.width * STEP12_COLOR_TILE_STATUS_OVERLAY_MAX_X_RATIO)) &&
    y >= Math.round(bitmap.height * STEP12_COLOR_TILE_STATUS_OVERLAY_MIN_Y_RATIO) &&
    y <= Math.max(190, Math.round(bitmap.height * STEP12_COLOR_TILE_STATUS_OVERLAY_MAX_Y_RATIO))
  );
}

function detectStep12ExactColorTiles(bitmap: RobotBitmap, status: Step12ColorTileStatus): Step12ColorTile[] {
  const visited = new Uint8Array(bitmap.width * bitmap.height);
  const tiles: Step12ColorTile[] = [];
  const stack: LocalPoint[] = [];

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const startIndex = y * bitmap.width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      if (isInsideStep12ColorTileOverlayExclusion(bitmap, x, y)) {
        continue;
      }

      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isStep12ExactColorTilePixel(r, g, b, status)) {
        continue;
      }

      stack.length = 0;
      stack.push({ x, y });
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

        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
        ];

        for (const neighbor of neighbors) {
          if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= bitmap.width || neighbor.y >= bitmap.height) {
            continue;
          }

          const nextIndex = neighbor.y * bitmap.width + neighbor.x;
          if (visited[nextIndex]) {
            continue;
          }

          visited[nextIndex] = 1;
          if (isInsideStep12ColorTileOverlayExclusion(bitmap, neighbor.x, neighbor.y)) {
            continue;
          }

          const nextOffset = neighbor.y * bitmap.byteWidth + neighbor.x * bitmap.bytesPerPixel;
          const nextB = bitmap.image[nextOffset];
          const nextG = bitmap.image[nextOffset + 1];
          const nextR = bitmap.image[nextOffset + 2];
          if (isStep12ExactColorTilePixel(nextR, nextG, nextB, status)) {
            stack.push(neighbor);
          }
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      if (
        pixelCount < STEP12_COLOR_TILE_MIN_PIXELS ||
        width < STEP12_COLOR_TILE_MIN_SIZE_PX ||
        height < STEP12_COLOR_TILE_MIN_SIZE_PX
      ) {
        continue;
      }

      tiles.push({
        status,
        x: minX,
        y: minY,
        width,
        height,
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
      });
    }
  }

  return tiles.sort((a, b) => b.pixelCount - a.pixelCount);
}

function formatStep12ColorTile(tile: Step12ColorTile): string {
  const hex = tile.status === "green" ? STEP12_GREEN_TILE_HEX : STEP12_RED_TILE_HEX;
  return `${tile.status}/${hex} center=(${tile.centerX},${tile.centerY}) size=${tile.width}x${tile.height} pixels=${tile.pixelCount}`;
}

function pickBottomRightDarkEssenceBlock(matches: readonly ArceuusEssenceIconMatch[]): ArceuusEssenceIconMatch | null {
  let best: ArceuusEssenceIconMatch | null = null;
  let bestY = Number.NEGATIVE_INFINITY;
  let bestX = Number.NEGATIVE_INFINITY;

  for (const match of matches) {
    if (
      match.centerY > bestY ||
      (match.centerY === bestY && match.centerX > bestX)
    ) {
      best = match;
      bestY = match.centerY;
      bestX = match.centerX;
    }
  }

  return best;
}

function isSameInventorySlot(a: ArceuusEssenceIconMatch, b: ArceuusEssenceIconMatch): boolean {
  return (
    Math.abs(a.centerX - b.centerX) <= INVENTORY_SAME_SLOT_TOLERANCE_PX &&
    Math.abs(a.centerY - b.centerY) <= INVENTORY_SAME_SLOT_TOLERANCE_PX
  );
}

function pickChiselDarkEssenceBlock(
  matches: readonly ArceuusEssenceIconMatch[],
  lastDarkEssenceBlock: ArceuusEssenceIconMatch | null,
): { target: ArceuusEssenceIconMatch | null; source: "same-slot" | "bottom-right" | "none" } {
  if (lastDarkEssenceBlock) {
    const sameSlot = matches.find((match) => isSameInventorySlot(match, lastDarkEssenceBlock));
    if (sameSlot) {
      return { target: sameSlot, source: "same-slot" };
    }
  }

  const bottomRight = pickBottomRightDarkEssenceBlock(matches);
  return bottomRight ? { target: bottomRight, source: "bottom-right" } : { target: null, source: "none" };
}

function formatArceuusEssenceIconMatch(match: ArceuusEssenceIconMatch | null): string {
  if (!match) {
    return "none";
  }

  return `${match.kind} center=(${match.centerX},${match.centerY}) size=${match.width}x${match.height} score=${match.score.toFixed(3)}`;
}

function formatArceuusChiselMatch(match: ArceuusChiselInventoryMatch | null): string {
  if (!match) {
    return "none";
  }

  return `center=(${match.centerX},${match.centerY}) size=${match.width}x${match.height} score=${match.score.toFixed(3)}`;
}

function pickBottomRightChisel(matches: readonly ArceuusChiselInventoryMatch[]): ArceuusChiselInventoryMatch | null {
  let best: ArceuusChiselInventoryMatch | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestY = Number.NEGATIVE_INFINITY;
  let bestX = Number.NEGATIVE_INFINITY;

  for (const match of matches) {
    const score = match.centerX + match.centerY;
    if (
      score > bestScore ||
      (score === bestScore && match.centerY > bestY) ||
      (score === bestScore && match.centerY === bestY && match.centerX > bestX)
    ) {
      best = match;
      bestScore = score;
      bestY = match.centerY;
      bestX = match.centerX;
    }
  }

  return best;
}

function pickTopStep12ColorTile(colorTiles: readonly Step12ColorTile[], status: Step12ColorTileStatus): Step12ColorTile | null {
  let best: Step12ColorTile | null = null;
  let bestY = Number.POSITIVE_INFINITY;
  let bestPixelCount = Number.NEGATIVE_INFINITY;

  for (const tile of colorTiles) {
    if (tile.status !== status) {
      continue;
    }

    if (tile.centerY < bestY || (tile.centerY === bestY && tile.pixelCount > bestPixelCount)) {
      best = tile;
      bestY = tile.centerY;
      bestPixelCount = tile.pixelCount;
    }
  }

  return best;
}

function pickTopLeftStep12ColorTile(colorTiles: readonly Step12ColorTile[], status: Step12ColorTileStatus): Step12ColorTile | null {
  let best: Step12ColorTile | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestY = Number.POSITIVE_INFINITY;
  let bestX = Number.POSITIVE_INFINITY;
  let bestPixelCount = Number.NEGATIVE_INFINITY;

  for (const tile of colorTiles) {
    if (tile.status !== status) {
      continue;
    }

    const score = tile.centerX + tile.centerY;
    if (
      score < bestScore ||
      (score === bestScore && tile.centerY < bestY) ||
      (score === bestScore && tile.centerY === bestY && tile.centerX < bestX) ||
      (score === bestScore && tile.centerY === bestY && tile.centerX === bestX && tile.pixelCount > bestPixelCount)
    ) {
      best = tile;
      bestScore = score;
      bestY = tile.centerY;
      bestX = tile.centerX;
      bestPixelCount = tile.pixelCount;
    }
  }

  return best;
}

function updateInventoryState(state: BotState, freeSlots: number): BotState {
  if (state.inventoryFreeSlots !== freeSlots) {
    log(`Inventory free-space ${state.inventoryFreeSlots ?? "unknown"} -> ${freeSlots}.`);
  }

  return {
    ...state,
    inventoryFreeSlots: freeSlots,
    missingInventoryCountTicks: 0,
  };
}

function estimateArceuusLogicalInventoryCounts(
  freeSlots: number | null,
  essenceDetection: Pick<ArceuusEssenceInventoryDetection, "darkFragments">,
  chiselDetection: Pick<ArceuusChiselInventoryDetection, "hasChisel">,
): ArceuusLogicalInventoryCounts {
  const occupiedSlots = freeSlots === null ? null : clamp(28 - freeSlots, 0, 28);
  const bloodRuneStackSlots = ARCEUUS_BLOOD_RUNE_STACK_SLOTS;
  const chiselSlots = chiselDetection.hasChisel ? 1 : 0;
  const fragmentStackSlots = essenceDetection.darkFragments.length > 0 ? 1 : 0;
  const fixedSlots = bloodRuneStackSlots + chiselSlots + fragmentStackSlots;

  return {
    occupiedSlots,
    bloodRuneStackSlots,
    chiselSlots,
    fragmentStackSlots,
    estimatedEssenceBlockSlots: occupiedSlots === null ? null : Math.max(0, occupiedSlots - fixedSlots),
  };
}

function formatArceuusLogicalInventoryCounts(counts: ArceuusLogicalInventoryCounts): string {
  return `logicalSlots occupied=${counts.occupiedSlots ?? "unknown"}/28 bloodRune=${counts.bloodRuneStackSlots} chisel=${counts.chiselSlots} fragmentStack=${counts.fragmentStackSlots} estimatedEssenceBlocks=${counts.estimatedEssenceBlockSlots ?? "unknown"}`;
}

function transitionToYellowMarkerSelection(state: BotState, nowMs: number): BotState {
  setAutomateBotCurrentStep(STEP_SELECT_YELLOW_ID);
  const cameraNorth = tapCameraKey(AGILITY_ZONE_CAMERA_KEY, "select-yellow-marker", "inventory full; prepare camera north for agility zone search");
  log(
    agilityZonePhaseLog(
      state,
      `Inventory is full; selecting ${getArceuusYellowMarkerTierForAgilityLevel(state.agilityLevel)} yellow marker for agilityLevel=${state.agilityLevel}. camera${AGILITY_ZONE_CAMERA_KEY.toUpperCase()}=${cameraNorth ? "yes" : "no"}.`,
    ),
  );
  return {
    ...state,
    currentFunction: "selectYellowMarker",
    phase: "select-yellow-marker",
    missingYellowMarkerTicks: 0,
    miningCameraPrepared: false,
    actionLockUntilMs: cameraActionLockUntil(nowMs),
  };
}

function runMiningTick(state: BotState, nowMs: number, tickCapture: TickCapture, captureBounds: ScreenCaptureBounds): BotState {
  if (state.phase !== "mining" || nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(STEP_MINE_ID);
  if (!state.miningCameraPrepared) {
    const cameraPrepared = tapCameraKey(MINING_CAMERA_KEY, "mining", "enter mining phase; angle camera toward mining nodes");
    if (cameraPrepared) {
      return {
        ...state,
        miningCameraPrepared: true,
        actionLockUntilMs: cameraActionLockUntil(nowMs),
      };
    }
  }

  const inventory = detectInventoryFreeSpace(tickCapture.bitmap);
  if (inventory.freeSlots === null) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % INVENTORY_DEBUG_INTERVAL_TICKS === 0) {
      const debugPath = `test-image-debug/arceuus-blood-rune-inventory-${state.loopIndex}.png`;
      saveBitmapWithInventoryFreeSpaceDebug(tickCapture.bitmap, inventory, debugPath);
      warn(miningPhaseLog(state, `Inventory free-space unreadable while mining; saved debug image to ${debugPath}.`));
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const stateWithInventory = updateInventoryState(state, inventory.freeSlots);
  if (inventory.freeSlots <= 0) {
    return transitionToYellowMarkerSelection(stateWithInventory, nowMs);
  }

  const runestones = detectArceuusDenseRunestones(tickCapture.bitmap);
  const activeRunestones = runestones.filter((runestone) => runestone.status === "active");
  const depletedCurrentRunestone = isLastClickedRunestoneDepleted(stateWithInventory.lastClickedRunestone, runestones);
  const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);
  const shouldClick =
    !stateWithInventory.lastClickedRunestone || miningStatus.status === "not-mining" || depletedCurrentRunestone;

  if (!shouldClick) {
    return {
      ...stateWithInventory,
      missingRunestoneTicks: 0,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  if (activeRunestones.length === 0) {
    const missingRunestoneTicks = stateWithInventory.missingRunestoneTicks + 1;
    if (missingRunestoneTicks === 1 || missingRunestoneTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(miningPhaseLog(stateWithInventory, `No active green dense runestone found; depletedCurrent=${depletedCurrentRunestone} miningStatus=${miningStatus.status}. Detected=${runestones.map(formatRunestone).join("; ") || "none"}.`));
    }

    return {
      ...stateWithInventory,
      missingRunestoneTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  const target = pickNearestActiveArceuusDenseRunestone(activeRunestones, playerAnchor, tickCapture.bitmap);
  if (!target) {
    return {
      ...stateWithInventory,
      missingRunestoneTicks: stateWithInventory.missingRunestoneTicks + 1,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const clickPoint = pickBoxInteractionScreenPoint(target, captureBounds, {
    innerRatio: 0.5,
    preferredLocalY: target.centerY,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
  logSimulatedClick(
    stateWithInventory.completedReturnTrips > 0 ? "Step 7 mining-again" : "Step 1 mining",
    clicked,
    captureBounds,
    `dense runestone target ${target.status}`,
  );
  const clickedLocalPoint = {
    x: clicked.x - captureBounds.x,
    y: clicked.y - captureBounds.y,
  };

  log(
    miningPhaseLog(stateWithInventory, `${depletedCurrentRunestone ? "Current runestone is red; switched to" : "Clicked"} active dense runestone at (${clicked.x},${clicked.y}) local=(${clickedLocalPoint.x},${clickedLocalPoint.y}); target=${formatRunestone(target)} miningStatus=${miningStatus.status} freeSlots=${inventory.freeSlots}.`),
  );

  return {
    ...stateWithInventory,
    lastClickedRunestone: rememberClickedRunestone(target, clickedLocalPoint),
    missingRunestoneTicks: 0,
    actionLockUntilMs: Date.now() + POST_CLICK_LOCK_MS,
  };
}

function formatYellowMarker(marker: ArceuusYellowMarker): string {
  return `${marker.tier} center=(${marker.centerX},${marker.centerY}) size=${marker.width}x${marker.height} pixels=${marker.pixelCount} fill=${marker.fillRatio.toFixed(3)}`;
}

function formatBlueOutline(outline: BlueOutlineDetection): string {
  return `${outline.tier} center=(${outline.centerX},${outline.centerY}) size=${outline.width}x${outline.height} pixels=${outline.pixelCount} rgb=(${Math.round(outline.averageR)},${Math.round(outline.averageG)},${Math.round(outline.averageB)}) lum=${outline.luminance.toFixed(1)}`;
}

function isRightOrTopBlueOutline(outline: BlueOutlineDetection, bitmap: Pick<RobotBitmap, "width" | "height">): boolean {
  return outline.centerX >= Math.round(bitmap.width * 0.5) || outline.centerY <= Math.round(bitmap.height * 0.42);
}

function pickFarthestTopBlueOutlineFromAnchor(
  detections: readonly BlueOutlineDetection[],
  anchor: LocalPoint,
): BlueOutlineDetection | null {
  let best: BlueOutlineDetection | null = null;
  let bestDistance = Number.NEGATIVE_INFINITY;
  let bestTopY = Number.POSITIVE_INFINITY;
  let bestPixelCount = Number.NEGATIVE_INFINITY;
  const hasTopDetection = detections.some((detection) => detection.centerY <= anchor.y);

  for (const detection of detections) {
    if (hasTopDetection && detection.centerY > anchor.y) {
      continue;
    }

    const distance = Math.max(Math.abs(detection.centerX - anchor.x), Math.abs(detection.centerY - anchor.y));
    if (
      distance > bestDistance ||
      (distance === bestDistance && detection.centerY < bestTopY) ||
      (distance === bestDistance && detection.centerY === bestTopY && detection.pixelCount > bestPixelCount)
    ) {
      best = detection;
      bestDistance = distance;
      bestTopY = detection.centerY;
      bestPixelCount = detection.pixelCount;
    }
  }

  return best;
}

function pickTopRightBlueOutline(detections: readonly BlueOutlineDetection[]): BlueOutlineDetection | null {
  let best: BlueOutlineDetection | null = null;
  let bestY = Number.POSITIVE_INFINITY;
  let bestX = Number.NEGATIVE_INFINITY;
  let bestPixelCount = Number.NEGATIVE_INFINITY;

  for (const detection of detections) {
    if (
      detection.centerY < bestY ||
      (detection.centerY === bestY && detection.centerX > bestX) ||
      (detection.centerY === bestY && detection.centerX === bestX && detection.pixelCount > bestPixelCount)
    ) {
      best = detection;
      bestY = detection.centerY;
      bestX = detection.centerX;
      bestPixelCount = detection.pixelCount;
    }
  }

  return best;
}

function isStep6DarkBlueOutline(outline: BlueOutlineDetection): boolean {
  return outline.tier === "trail" && outline.averageR <= 35 && outline.averageG <= 35 && outline.averageB >= 220;
}

function isStep6TopOrRightBlueOutline(outline: BlueOutlineDetection, anchor: LocalPoint): boolean {
  return outline.centerY <= anchor.y || outline.centerX >= anchor.x;
}

function getStep6TopRightPriority(outline: BlueOutlineDetection, anchor: LocalPoint): number {
  const isTop = outline.centerY <= anchor.y;
  const isRight = outline.centerX >= anchor.x;
  if (isTop && isRight) {
    return 3;
  }

  return isTop ? 2 : isRight ? 1 : 0;
}

function pickStep6TopRightBlueOutline(
  detections: readonly BlueOutlineDetection[],
  anchor: LocalPoint,
): BlueOutlineDetection | null {
  let best: BlueOutlineDetection | null = null;
  let bestPriority = Number.NEGATIVE_INFINITY;
  let bestY = Number.POSITIVE_INFINITY;
  let bestX = Number.NEGATIVE_INFINITY;
  let bestLuminance = Number.POSITIVE_INFINITY;
  let bestPixelCount = Number.NEGATIVE_INFINITY;

  for (const detection of detections) {
    const priority = getStep6TopRightPriority(detection, anchor);
    if (
      priority > bestPriority ||
      (priority === bestPriority && detection.centerY < bestY) ||
      (priority === bestPriority && detection.centerY === bestY && detection.centerX > bestX) ||
      (priority === bestPriority && detection.centerY === bestY && detection.centerX === bestX && detection.luminance < bestLuminance) ||
      (priority === bestPriority &&
        detection.centerY === bestY &&
        detection.centerX === bestX &&
        detection.luminance === bestLuminance &&
        detection.pixelCount > bestPixelCount)
    ) {
      best = detection;
      bestPriority = priority;
      bestY = detection.centerY;
      bestX = detection.centerX;
      bestLuminance = detection.luminance;
      bestPixelCount = detection.pixelCount;
    }
  }

  return best;
}

function formatMagentaObject(magenta: MagentaObjectDetection): string {
  return `center=(${magenta.centerX},${magenta.centerY}) size=${magenta.width}x${magenta.height} pixels=${magenta.pixelCount}`;
}

function formatTravelEstimate(travel: TravelEstimate): string {
  return `distanceTiles~${travel.distanceTiles.toFixed(1)} dx=${Math.round(travel.dxPx)}px dy=${Math.round(travel.dyPx)}px tilePx=${travel.tilePx}px eta=${travel.etaTicks} tick(s) ${ticksToMs(travel.etaTicks, GAME_TICK_MS)}ms`;
}

function estimateStep12MovementBuffer(
  distanceTiles: number,
  targetYRatio: number | null,
  axisDominanceRatio: number,
): { extraWaitTicks: number; reasons: string[] } {
  const reasons: string[] = [];
  let extraWaitTicks = 0;

  if (distanceTiles >= STEP12_MOVEMENT_LONG_DISTANCE_TILES) {
    extraWaitTicks += 1;
    reasons.push(`long>=${STEP12_MOVEMENT_LONG_DISTANCE_TILES}`);
  }

  if (distanceTiles >= STEP12_MOVEMENT_VERY_LONG_DISTANCE_TILES) {
    extraWaitTicks += 1;
    reasons.push(`veryLong>=${STEP12_MOVEMENT_VERY_LONG_DISTANCE_TILES}`);
  }

  if (
    targetYRatio !== null &&
    distanceTiles >= STEP12_MOVEMENT_TOP_SCREEN_DISTANCE_TILES &&
    targetYRatio <= STEP12_MOVEMENT_TOP_SCREEN_Y_RATIO
  ) {
    extraWaitTicks += 1;
    reasons.push(`topY=${targetYRatio.toFixed(2)}`);
  }

  if (
    distanceTiles >= STEP12_MOVEMENT_AXIS_DOMINANCE_DISTANCE_TILES &&
    axisDominanceRatio >= STEP12_MOVEMENT_AXIS_DOMINANCE_RATIO
  ) {
    extraWaitTicks += 1;
    reasons.push(`axis=${axisDominanceRatio.toFixed(2)}`);
  }

  if (extraWaitTicks > STEP12_MOVEMENT_MAX_EXTRA_WAIT_TICKS) {
    reasons.push(`cap=${STEP12_MOVEMENT_MAX_EXTRA_WAIT_TICKS}`);
  }

  return {
    extraWaitTicks: Math.min(extraWaitTicks, STEP12_MOVEMENT_MAX_EXTRA_WAIT_TICKS),
    reasons,
  };
}

function estimateStep12TravelWaitTicks(
  playerAnchor: { centerX: number; centerY: number },
  target: { centerX: number; centerY: number },
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
): Step12TravelWaitEstimate {
  const dxPx = target.centerX - playerAnchor.centerX;
  const dyPx = target.centerY - playerAnchor.centerY;
  const distancePx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
  const tilePx = clamp(fallbackTilePx, TRAVEL_TILE_PX_MIN, TRAVEL_TILE_PX_MAX);
  const distanceTiles = Math.max(Math.abs(dxPx), Math.abs(dyPx)) / Math.max(1, tilePx);
  const travelTicks = Math.max(TRAVEL_MIN_TICKS, Math.ceil(distanceTiles / PLAYER_TRAVEL_SPEED_TILES_PER_TICK));
  const baseWaitTicks = travelTicks + TRAVEL_EXTRA_WAIT_TICKS;
  const targetYRatio = captureBounds.height > 0 ? target.centerY / captureBounds.height : null;
  const axisDominanceRatio = Math.max(Math.abs(dxPx), Math.abs(dyPx)) / Math.max(1, Math.abs(dxPx) + Math.abs(dyPx));
  const movementBuffer = estimateStep12MovementBuffer(distanceTiles, targetYRatio, axisDominanceRatio);

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
    movementExtraWaitTicks: movementBuffer.extraWaitTicks,
    movementReasons: movementBuffer.reasons,
  };
}

function formatStep12TravelWaitEstimate(travel: Step12TravelWaitEstimate): string {
  const movementSuffix =
    travel.movementExtraWaitTicks > 0
      ? ` movement=+${travel.movementExtraWaitTicks} baseWait=${travel.baseWaitTicks} y=${travel.targetYRatio === null ? "unknown" : travel.targetYRatio.toFixed(2)} axis=${travel.axisDominanceRatio.toFixed(2)} reason=${travel.movementReasons.join("+")}`
      : "";
  return `distance=${Math.round(travel.distancePx)}px dx=${Math.round(travel.dxPx)}px dy=${Math.round(travel.dyPx)}px tiles~${travel.distanceTiles.toFixed(1)} tilePx=${travel.tilePx}px travel=${travel.travelTicks} tick(s) wait=${travel.waitTicks} tick(s)${movementSuffix}`;
}

function shouldTapTravelActionKeyAfterAgilityCourse(agilityLevel: number): boolean {
  return agilityLevel >= 73;
}

function shouldTapTravelActionKeyAfterFirstBlueOutline(agilityLevel: number, blueTravelClicks: number): boolean {
  return agilityLevel >= 69 && agilityLevel < 73 && blueTravelClicks === 0;
}

function shouldDelayCameraTurnAfterFirstBlueOutline(agilityLevel: number, blueTravelClicks: number): boolean {
  return agilityLevel < 69 && blueTravelClicks === 0;
}

function getAgilityCourseExtraWaitTicks(agilityLevel: number): number {
  if (agilityLevel >= 69) {
    return AGILITY_72_COURSE_EXTRA_WAIT_TICKS;
  }

  return AGILITY_52_COURSE_EXTRA_WAIT_TICKS;
}

function transitionToBlueTileFollow(
  state: BotState,
  clickedAtMs: number,
  travel: TravelEstimate,
  tappedTravelKey: boolean,
): BotState {
  setAutomateBotCurrentStep(STEP_FOLLOW_BLUE_ID);
  log(followBluePhaseLog(state, `Waiting for agility-course travel before following blue outlined tiles. tapped${TRAVEL_ACTION_KEY.toUpperCase()}=${tappedTravelKey ? "yes" : "no"}; ${formatTravelEstimate(travel)}.`));

  return {
    ...state,
    currentFunction: "followBlueTiles",
    phase: "follow-blue-tiles",
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: 0,
    actionLockUntilMs: clickedAtMs + ticksToMs(travel.etaTicks, GAME_TICK_MS),
  };
}

function transitionToPostMagentaInventoryCheck(state: BotState, clickedAtMs: number, travel: TravelEstimate): BotState {
  setAutomateBotCurrentStep(checkAfterMagentaStepId(state));
  log(checkAfterMagentaPhaseLog(state, `Magenta object clicked; waiting before inventory check. ${formatTravelEstimate(travel)}.`));

  return {
    ...state,
    currentFunction: "checkAfterMagenta",
    phase: "check-after-magenta",
    missingInventoryCountTicks: 0,
    pendingReturnBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnKey: null,
    pendingReturnBlueCameraTurnStage: null,
    returnBlueGreenCameraTurned: false,
    returnBlueRedCameraTurned: false,
    lastDarkEssenceBlock: null,
    actionLockUntilMs: clickedAtMs + ticksToMs(travel.etaTicks, GAME_TICK_MS),
  };
}

function transitionToFollowAnotherBlueAfterSecondMagenta(
  state: BotState,
  nowMs: number,
  bottomRightDarkBlock: ArceuusEssenceIconMatch | null,
): BotState {
  setAutomateBotCurrentStep(STEP_FOLLOW_ANOTHER_BLUE_ID);
  log(
    checkAfterMagentaPhaseLog(
      state,
      `Fragments and dark essence blocks confirmed after second magenta; entering Step 12 follow-another-blue. savedBottomRight=${formatArceuusEssenceIconMatch(bottomRightDarkBlock)}.`,
    ),
  );

  return {
    ...state,
    currentFunction: "followAnotherBlueTiles",
    phase: "follow-another-blue",
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: 0,
    pendingReturnBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnKey: null,
    pendingReturnBlueCameraTurnStage: null,
    returnBlueGreenCameraTurned: false,
    returnBlueRedCameraTurned: false,
    lastDarkEssenceBlock: bottomRightDarkBlock,
    lastReturnTravelChiselAtMs: 0,
    actionLockUntilMs: nowMs + FAST_RETRY_MS,
  };
}

function runSelectYellowMarkerTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
): BotState {
  if (state.phase !== "select-yellow-marker" || nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(STEP_SELECT_YELLOW_ID);

  const markers = detectArceuusYellowMarkers(tickCapture.bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  const targetTier = getArceuusYellowMarkerTierForAgilityLevel(state.agilityLevel);

  if (!playerBox) {
    const missingYellowMarkerTicks = state.missingYellowMarkerTicks + 1;
    if (missingYellowMarkerTicks === 1 || missingYellowMarkerTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        agilityZonePhaseLog(state, `Cannot select nearest ${targetTier} yellow marker because the player marker was not detected. Detected=${markers.map(formatYellowMarker).join("; ") || "none"}.`),
      );
    }

    return {
      ...state,
      missingYellowMarkerTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };
  const target = pickArceuusYellowMarkerForAgilityLevel(markers, state.agilityLevel, playerAnchor, tickCapture.bitmap);

  if (!target) {
    const missingYellowMarkerTicks = state.missingYellowMarkerTicks + 1;
    const rotatedCamera = tapCameraKey(YELLOW_MARKER_CAMERA_ROTATE_KEY, "select-yellow-marker", `missing ${targetTier} yellow marker; rotate camera before retry`);

    if (missingYellowMarkerTicks === 1 || missingYellowMarkerTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        agilityZonePhaseLog(state, `No ${targetTier} yellow marker found for agilityLevel=${state.agilityLevel}. Rotated camera=${rotatedCamera ? "yes" : "no"}. Detected=${markers.map(formatYellowMarker).join("; ") || "none"}.`),
      );
    }

    return {
      ...state,
      missingYellowMarkerTicks,
      actionLockUntilMs: cameraActionLockUntil(nowMs),
    };
  }

  const clickPoint = pickBoxInteractionScreenPoint(target, captureBounds, {
    innerRatio: 0.55,
    preferredLocalY: target.centerY,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
  logSimulatedClick(
    state.completedReturnTrips > 0 ? "Step 9 agility-zone" : "Step 2 agility-zone",
    clicked,
    captureBounds,
    `agility shortcut tier=${target.tier}`,
  );
  const clickedAtMs = Date.now();
  const tappedTravelKey = shouldTapTravelActionKeyAfterAgilityCourse(state.agilityLevel)
    ? tapCameraKey(TRAVEL_ACTION_KEY, "select-yellow-marker", "true agility 73 shortcut clicked; immediate travel action key")
    : false;
  const travel = estimateTravelTicks({
    screenPoint: clicked,
    captureBounds,
    playerBox,
    fallbackTilePx,
    minTilePx: TRAVEL_TILE_PX_MIN,
    maxTilePx: TRAVEL_TILE_PX_MAX,
    playerSpeedTilesPerTick: PLAYER_TRAVEL_SPEED_TILES_PER_TICK,
    extraTicks: getAgilityCourseExtraWaitTicks(state.agilityLevel),
    minTicks: TRAVEL_MIN_TICKS,
  });

  log(
    agilityZonePhaseLog(state, `Clicked nearest ${target.tier} yellow marker for agilityLevel=${state.agilityLevel} at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); target=${formatYellowMarker(target)}; ${formatTravelEstimate(travel)}.`),
  );

  return transitionToBlueTileFollow({
    ...state,
    missingYellowMarkerTicks: 0,
  }, clickedAtMs, travel, tappedTravelKey);
}

function runFollowBlueTilesTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
): BotState {
  if (state.phase !== "follow-blue-tiles" || nowMs < state.actionLockUntilMs) {
    return state;
  }

  if (state.pendingLowLevelBlueCameraTurnAtMs > 0 && nowMs >= state.pendingLowLevelBlueCameraTurnAtMs) {
    const turned = tapCameraKey(
      TRAVEL_ACTION_KEY,
      "follow-blue-tiles",
      "first blue outline clicked; waited minimum post-click camera delay before camera turn",
    );

    return {
      ...state,
      pendingLowLevelBlueCameraTurnAtMs: 0,
      actionLockUntilMs: turned ? cameraActionLockUntil(nowMs) : nowMs + FAST_RETRY_MS,
    };
  }

  const magenta = detectLargestMagentaObject(tickCapture.bitmap, BIG_MAGENTA_MIN_PIXELS);
  if (magenta) {
    setAutomateBotCurrentStep(state.completedReturnTrips > 0 ? STEP_SECOND_CLICK_MAGENTA_ID : STEP_CLICK_MAGENTA_ID);
    const playerBoxForMagenta = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
    const clicked = clickScreenPoint(captureBounds.x + magenta.centerX, captureBounds.y + magenta.centerY, captureBounds);
    logSimulatedClick(state.completedReturnTrips > 0 ? "Step 11 magenta" : "Step 4 magenta", clicked, captureBounds, "big magenta object");
    const clickedAtMs = Date.now();
    const travel = estimateTravelTicks({
      screenPoint: clicked,
      captureBounds,
      playerBox: playerBoxForMagenta,
      fallbackTilePx,
      minTilePx: TRAVEL_TILE_PX_MIN,
      maxTilePx: TRAVEL_TILE_PX_MAX,
      playerSpeedTilesPerTick: PLAYER_TRAVEL_SPEED_TILES_PER_TICK,
      extraTicks: TRAVEL_EXTRA_WAIT_TICKS,
      minTicks: TRAVEL_MIN_TICKS,
    });

    log(magentaPhaseLog(state, `Clicked big magenta object at (${clicked.x},${clicked.y}); target=${formatMagentaObject(magenta)}; ${formatTravelEstimate(travel)}.`));

    return transitionToPostMagentaInventoryCheck({
      ...state,
      missingMagentaTicks: 0,
    }, clickedAtMs, travel);
  }

  setAutomateBotCurrentStep(STEP_FOLLOW_BLUE_ID);

  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  if (!playerBox) {
    const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
    if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(followBluePhaseLog(state, "Cannot click farthest blue outlined tile because the player marker was not detected."));
    }

    return {
      ...state,
      missingBlueOutlineTicks,
      missingMagentaTicks: state.missingMagentaTicks + 1,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const blueOutlines = detectBlueOutlines(tickCapture.bitmap);
  const trailBlueOutlines = blueOutlines.filter((outline) => outline.tier === "trail");
  const directionalBlueOutlines = trailBlueOutlines.filter((outline) => isRightOrTopBlueOutline(outline, tickCapture.bitmap));
  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };
  const target = pickFarthestBlueOutlineFromAnchor(directionalBlueOutlines, playerAnchor);
  if (!target) {
    const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
    if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(followBluePhaseLog(state, `No right/top trail blue outlined tile found yet while searching for big magenta object. Magenta missing ticks=${state.missingMagentaTicks + 1}. allBlue=${blueOutlines.map(formatBlueOutline).join("; ") || "none"}.`));
    }

    return {
      ...state,
      missingBlueOutlineTicks,
      missingMagentaTicks: state.missingMagentaTicks + 1,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const clickPoint = pickBoxInteractionScreenPoint(target, captureBounds, {
    innerRatio: 0.45,
    preferredLocalY: target.centerY,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
  logSimulatedClick(
    state.completedReturnTrips > 0 ? "Step 10 follow-blue" : "Step 3 follow-blue",
    clicked,
    captureBounds,
    `farthest right/top blue outline click #${state.blueTravelClicks + 1}`,
  );
  const clickedAtMs = Date.now();
  const travel = estimateTravelTicks({
    screenPoint: clicked,
    captureBounds,
    playerBox,
    fallbackTilePx,
    minTilePx: TRAVEL_TILE_PX_MIN,
    maxTilePx: TRAVEL_TILE_PX_MAX,
    playerSpeedTilesPerTick: PLAYER_TRAVEL_SPEED_TILES_PER_TICK,
    extraTicks: TRAVEL_EXTRA_WAIT_TICKS,
    minTicks: TRAVEL_MIN_TICKS,
  });
  const shouldTapTravelKey = shouldTapTravelActionKeyAfterFirstBlueOutline(state.agilityLevel, state.blueTravelClicks);
  const shouldDelayLowLevelCameraTurn = shouldDelayCameraTurnAfterFirstBlueOutline(state.agilityLevel, state.blueTravelClicks);
  const pendingLowLevelBlueCameraTurnAtMs =
    shouldTapTravelKey || shouldDelayLowLevelCameraTurn
      ? earliestCameraTurnAfterClick(
          clickedAtMs,
          clickedAtMs +
            ticksToMs(shouldDelayLowLevelCameraTurn ? LOW_LEVEL_BLUE_CAMERA_TURN_DELAY_TICKS : 1, GAME_TICK_MS),
        )
      : 0;

  const travelLockUntilMs = clickedAtMs + ticksToMs(travel.etaTicks, GAME_TICK_MS);
  const nextActionLockUntilMs =
    pendingLowLevelBlueCameraTurnAtMs > 0 ? Math.min(travelLockUntilMs, pendingLowLevelBlueCameraTurnAtMs) : travelLockUntilMs;

  log(
    followBluePhaseLog(state, `Clicked farthest right/top blue outlined tile #${state.blueTravelClicks + 1} at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); candidates=${directionalBlueOutlines.length}/${blueOutlines.length}; target=${formatBlueOutline(target)}; cameraTurnScheduled=${pendingLowLevelBlueCameraTurnAtMs > 0 ? `${Math.ceil((pendingLowLevelBlueCameraTurnAtMs - clickedAtMs) / GAME_TICK_MS)} tick(s)` : "no"}; ${formatTravelEstimate(travel)}.`),
  );

  return {
    ...state,
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: state.missingMagentaTicks + 1,
    blueTravelClicks: state.blueTravelClicks + 1,
    pendingLowLevelBlueCameraTurnAtMs,
    actionLockUntilMs: nextActionLockUntilMs,
  };
}

function runCheckAfterMagentaTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  essenceIconTemplates: readonly ArceuusEssenceIconTemplate[],
  chiselIconTemplate: RobotBitmap,
): BotState {
  if (state.phase !== "check-after-magenta" || nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(checkAfterMagentaStepId(state));

  const inventory = detectInventoryFreeSpace(tickCapture.bitmap);
  if (inventory.freeSlots === null) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % INVENTORY_DEBUG_INTERVAL_TICKS === 0) {
      warn(checkAfterMagentaPhaseLog(state, "Inventory free-space unreadable after magenta click; retrying before return path."));
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const stateWithInventory = updateInventoryState(state, inventory.freeSlots);
  const essenceDetection = detectArceuusEssenceInventory(tickCapture.bitmap, essenceIconTemplates, {
    blockClassificationMode: "dark",
  });
  const chiselDetection = detectArceuusChiselInventory(tickCapture.bitmap, chiselIconTemplate);
  const logicalCounts = estimateArceuusLogicalInventoryCounts(inventory.freeSlots, essenceDetection, chiselDetection);
  const bottomRightDarkBlock = pickBottomRightDarkEssenceBlock(essenceDetection.darkBlocks);
  log(
    checkAfterMagentaPhaseLog(
      state,
      `Essence inventory confirmation after magenta: ${formatArceuusEssenceInventoryDetection(essenceDetection)} ${formatArceuusChiselInventoryDetection(chiselDetection)} ${formatArceuusLogicalInventoryCounts(logicalCounts)} bottomRightDarkBlock=${formatArceuusEssenceIconMatch(bottomRightDarkBlock)} confirmed=${essenceDetection.isDarkEssenceConfirmed ? "yes" : "no"}.`,
    ),
  );

  if (!essenceDetection.isDarkEssenceConfirmed) {
    warn(
      checkAfterMagentaPhaseLog(
        state,
        `Magenta click not confirmed yet; dense essence must become dark essence block before returning. freeSlots=${inventory.freeSlots}.`,
      ),
    );
    return {
      ...stateWithInventory,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  if (
    state.completedReturnTrips > 0 &&
    essenceDetection.darkFragments.length > 0 &&
    essenceDetection.darkBlocks.length > 0 &&
    essenceDetection.denseBlocks.length === 0
  ) {
    return transitionToFollowAnotherBlueAfterSecondMagenta(stateWithInventory, nowMs, bottomRightDarkBlock);
  }

  log(
    checkAfterMagentaPhaseLog(
      state,
      `Dark essence block confirmed after magenta; savedBottomRight=${formatArceuusEssenceIconMatch(bottomRightDarkBlock)} freeSlots=${inventory.freeSlots}. Entering Step 6 blue return with chisel enabled during travel.`,
    ),
  );
  const cameraPrepared = tapCameraKey(
    STEP6_RETURN_BLUE_CAMERA_KEY,
    "return-blue-tiles",
    "enter Step 6 return-blue; rotate camera toward dark blue tiles",
  );

  return {
    ...stateWithInventory,
    currentFunction: "returnBlueTiles",
    phase: "return-blue-tiles",
    missingBlueOutlineTicks: 0,
    missingReturnYellowMarkerTicks: 0,
    lastDarkEssenceBlock: bottomRightDarkBlock,
    actionLockUntilMs: cameraPrepared ? cameraActionLockUntil(nowMs) : nowMs + FAST_RETRY_MS,
  };
}

function transitionBackToMiningAfterReturnShortcut(
  state: BotState,
  clickedAtMs: number,
  travel: TravelEstimate,
): BotState {
  setAutomateBotCurrentStep(STEP_MINE_ID);
  log(phaseLogText("Step 7 mining-again", `Return agility shortcut clicked; resuming dense runestone mining after travel. ${formatTravelEstimate(travel)}.`));

  return {
    ...state,
    currentFunction: "mine",
    phase: "mining",
    completedReturnTrips: state.completedReturnTrips + 1,
    missingRunestoneTicks: 0,
    missingYellowMarkerTicks: 0,
    missingBlueOutlineTicks: 0,
    missingReturnYellowMarkerTicks: 0,
    pendingReturnBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnKey: null,
    pendingReturnBlueCameraTurnStage: null,
    returnBlueGreenCameraTurned: false,
    returnBlueRedCameraTurned: false,
    lastClickedRunestone: null,
    lastDarkEssenceBlock: null,
    rememberedChisel: state.rememberedChisel,
    bloodAltarCraftConfirmed: false,
    miningCameraPrepared: false,
    actionLockUntilMs: clickedAtMs + ticksToMs(travel.etaTicks, GAME_TICK_MS),
  };
}

function transitionToReturnToMiningAfterBloodAltarCraft(
  state: BotState,
  nowMs: number,
  postCraftLockMs = FAST_RETRY_MS,
): BotState {
  setAutomateBotCurrentStep(STEP_RETURN_TO_MINING_ID);
  const cameraPrepared = tapCameraKey(
    RETURN_TO_MINING_RED_CAMERA_KEY,
    "return-to-mining",
    "blood altar craft confirmed; prepare camera for top red return tiles",
  );
  log(
    phaseLogText(
      "Step 13 blood-altar-craft",
      `Blood altar craft confirmed; entering Step 14 return-to-mining. camera${RETURN_TO_MINING_RED_CAMERA_KEY.toUpperCase()}=${cameraPrepared ? "yes" : "no"}.`,
    ),
  );

  return {
    ...state,
    currentFunction: "returnToMining",
    phase: "return-to-mining",
    missingRunestoneTicks: 0,
    missingYellowMarkerTicks: 0,
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: 0,
    missingReturnYellowMarkerTicks: 0,
    blueTravelClicks: 0,
    pendingReturnBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnKey: null,
    pendingReturnBlueCameraTurnStage: null,
    returnBlueGreenCameraTurned: false,
    returnBlueRedCameraTurned: false,
    lastDarkEssenceBlock: null,
    rememberedChisel: state.rememberedChisel,
    bloodAltarCraftConfirmed: false,
    returnToMiningStage: "red",
    miningCameraPrepared: false,
    pendingLowLevelBlueCameraTurnAtMs: 0,
    actionLockUntilMs: cameraPrepared
      ? Math.max(cameraActionLockUntil(nowMs), nowMs + postCraftLockMs)
      : nowMs + postCraftLockMs,
  };
}

function transitionToMiningAfterStep14Return(
  state: BotState,
  clickedAtMs: number,
  travel: TravelEstimate,
): BotState {
  setAutomateBotCurrentStep(STEP_MINE_ID);
  log(returnToMiningPhaseLog(`Step 14 return target clicked; restarting loop at Step 1 mining after travel. ${formatTravelEstimate(travel)}.`));

  return {
    ...state,
    currentFunction: "mine",
    phase: "mining",
    completedReturnTrips: 0,
    missingRunestoneTicks: 0,
    missingYellowMarkerTicks: 0,
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: 0,
    missingReturnYellowMarkerTicks: 0,
    blueTravelClicks: 0,
    pendingReturnBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnKey: null,
    pendingReturnBlueCameraTurnStage: null,
    lastReturnTravelChiselAtMs: 0,
    returnBlueGreenCameraTurned: false,
    returnBlueRedCameraTurned: false,
    lastClickedRunestone: null,
    lastDarkEssenceBlock: null,
    rememberedChisel: state.rememberedChisel,
    bloodAltarCraftConfirmed: false,
    returnToMiningStage: "red",
    miningCameraPrepared: false,
    pendingLowLevelBlueCameraTurnAtMs: 0,
    actionLockUntilMs: clickedAtMs + ticksToMs(travel.etaTicks, GAME_TICK_MS),
  };
}

function getReturnBlueCameraTurnReadyAtMs(clickedAtMs: number, travel: Step12TravelWaitEstimate): number {
  return clickedAtMs + ticksToMs(Math.max(1, travel.waitTicks), GAME_TICK_MS);
}

function transitionToBloodAltarCraftValidation(
  state: BotState,
  clickedAtMs: number,
  travel: Step12TravelWaitEstimate,
): BotState {
  setAutomateBotCurrentStep(STEP_BLOOD_ALTAR_CRAFT_ID);
  log(phaseLogText("Step 13 blood-altar-craft", `Blood altar magenta clicked; waiting for craft validation. ${formatStep12TravelWaitEstimate(travel)}.`));

  return {
    ...state,
    currentFunction: "bloodAltarCraft",
    phase: "blood-altar-craft",
    missingInventoryCountTicks: 0,
    missingMagentaTicks: 0,
    pendingReturnBlueCameraTurnAtMs: 0,
    pendingReturnBlueCameraTurnKey: null,
    pendingReturnBlueCameraTurnStage: null,
    lastReturnTravelChiselAtMs: 0,
    lastDarkEssenceBlock: null,
    rememberedChisel: state.rememberedChisel,
    bloodAltarCraftConfirmed: false,
    actionLockUntilMs: clickedAtMs + ticksToMs(travel.waitTicks, GAME_TICK_MS),
  };
}

function transitionToReturnYellowShortcut(state: BotState, nowMs: number): BotState {
  setAutomateBotCurrentStep(STEP_RETURN_YELLOW_ID);
  log(returnYellowShortcutPhaseLog("Step 6 blue return complete; entering Step 7 return yellow shortcut."));

  return {
    ...state,
    currentFunction: "returnYellowShortcut",
    phase: "return-yellow-shortcut",
    missingBlueOutlineTicks: 0,
    missingReturnYellowMarkerTicks: 0,
    actionLockUntilMs: nowMs + FAST_RETRY_MS,
  };
}

function runReturnTravelChiselTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  essenceIconTemplates: readonly ArceuusEssenceIconTemplate[],
  chiselIconTemplate: RobotBitmap,
): BotState {
  if (state.phase !== "return-blue-tiles" || nowMs >= state.actionLockUntilMs) {
    return state;
  }

  if (state.lastReturnTravelChiselAtMs > 0 && nowMs - state.lastReturnTravelChiselAtMs < RETURN_TRAVEL_CHISEL_INTERVAL_MS) {
    return state;
  }

  const essenceDetection = detectArceuusEssenceInventory(tickCapture.bitmap, essenceIconTemplates, {
    blockClassificationMode: "dark",
  });
  const darkBlockTarget = pickChiselDarkEssenceBlock(essenceDetection.darkBlocks, state.lastDarkEssenceBlock);
  if (!darkBlockTarget.target) {
    if (state.lastDarkEssenceBlock) {
      log(
        returnBluePhaseLog(
          `Step 6 travel chisel finished; no dark essence blocks remain. Last saved=${formatArceuusEssenceIconMatch(state.lastDarkEssenceBlock)}.`,
        ),
      );
    }

    return {
      ...state,
      lastDarkEssenceBlock: null,
    };
  }

  const chiselDetection = state.rememberedChisel
    ? null
    : detectArceuusChiselInventory(tickCapture.bitmap, chiselIconTemplate);
  const detectedChisel = chiselDetection ? pickBottomRightChisel(chiselDetection.chisels) : null;
  const chisel = state.rememberedChisel ?? detectedChisel;
  const chiselSource = state.rememberedChisel ? "startup" : detectedChisel ? "runtime" : "none";
  const chiselDetectionText = chiselDetection
    ? `${formatArceuusChiselInventoryDetection(chiselDetection)} ${formatArceuusChiselInventoryDetectionDetails(chiselDetection)}`
    : `chisel=startup-reference rememberedChisel=${formatArceuusChiselMatch(state.rememberedChisel)}`;
  if (!chisel) {
    warn(
      returnBluePhaseLog(
        `Step 6 travel chisel skipped; no startup chisel reference and chisel not detected. ${chiselDetectionText} rememberedChisel=${formatArceuusChiselMatch(state.rememberedChisel)} darkBlocks=${essenceDetection.darkBlocks.length} ${formatArceuusEssenceInventoryDetectionDetails(essenceDetection)} target=${formatArceuusEssenceIconMatch(darkBlockTarget.target)} source=${darkBlockTarget.source}.`,
      ),
    );

    return {
      ...state,
      lastDarkEssenceBlock: darkBlockTarget.target,
      lastReturnTravelChiselAtMs: nowMs,
    };
  }

  const clickedChisel = clickScreenPoint(captureBounds.x + chisel.centerX, captureBounds.y + chisel.centerY, captureBounds);
  sleepSyncMs(RETURN_TRAVEL_CHISEL_CLICK_DELAY_MS);
  const clickedDarkBlock = clickScreenPoint(
    captureBounds.x + darkBlockTarget.target.centerX,
    captureBounds.y + darkBlockTarget.target.centerY,
    captureBounds,
  );
  logSimulatedClick("Step 6 return-blue", clickedChisel, captureBounds, "travel chisel");
  logSimulatedClick(
    "Step 6 return-blue",
    clickedDarkBlock,
    captureBounds,
    `travel ${darkBlockTarget.source} dark essence block after ${RETURN_TRAVEL_CHISEL_CLICK_DELAY_MS}ms delay`,
  );
  log(
    returnBluePhaseLog(
      `Step 6 travel chisel action: clickedChisel=(${chisel.centerX},${chisel.centerY}) source=${chiselSource} score=${chisel.score.toFixed(3)} ${chiselDetectionText} rememberedChisel=${formatArceuusChiselMatch(state.rememberedChisel)} then waited ${RETURN_TRAVEL_CHISEL_CLICK_DELAY_MS}ms before darkBlock=${formatArceuusEssenceIconMatch(darkBlockTarget.target)} source=${darkBlockTarget.source} darkBlocks=${essenceDetection.darkBlocks.length} ${formatArceuusEssenceInventoryDetectionDetails(essenceDetection)}.`,
    ),
  );

  return {
    ...state,
    lastDarkEssenceBlock: darkBlockTarget.target,
    rememberedChisel: chisel,
    lastReturnTravelChiselAtMs: nowMs,
  };
}

function runReturnBlueTilesTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
  essenceIconTemplates: readonly ArceuusEssenceIconTemplate[],
  chiselIconTemplate: RobotBitmap,
): BotState {
  if (state.phase !== "return-blue-tiles" && state.phase !== "follow-another-blue") {
    return state;
  }

  if (nowMs < state.actionLockUntilMs) {
    return state.phase === "return-blue-tiles"
      ? runReturnTravelChiselTick(state, nowMs, tickCapture, captureBounds, essenceIconTemplates, chiselIconTemplate)
      : state;
  }

  setAutomateBotCurrentStep(state.phase === "return-blue-tiles" ? STEP_RETURN_BLUE_ID : STEP_FOLLOW_ANOTHER_BLUE_ID);

  if (
    state.pendingReturnBlueCameraTurnAtMs > 0 &&
    state.pendingReturnBlueCameraTurnKey &&
    state.pendingReturnBlueCameraTurnStage &&
    nowMs >= state.pendingReturnBlueCameraTurnAtMs
  ) {
    const key = state.pendingReturnBlueCameraTurnKey;
    const stage = state.pendingReturnBlueCameraTurnStage;
    const rotated = tapCameraKey(
      key,
      "return-blue-tiles",
      `arrived after Step 12 ${stage} blue-tile click; rotating camera with ${key}`,
    );

    return {
      ...state,
      pendingReturnBlueCameraTurnAtMs: 0,
      pendingReturnBlueCameraTurnKey: null,
      pendingReturnBlueCameraTurnStage: null,
      returnBlueGreenCameraTurned: stage === "green" && rotated ? true : state.returnBlueGreenCameraTurned,
      returnBlueRedCameraTurned: stage === "red" && rotated ? true : state.returnBlueRedCameraTurned,
      actionLockUntilMs: rotated ? cameraActionLockUntil(nowMs) : nowMs + FAST_RETRY_MS,
    };
  }

  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  if (!playerBox) {
    const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
    if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        state.phase === "return-blue-tiles"
          ? returnBluePhaseLog("Cannot return through blue outlined tiles because the player marker was not detected.")
          : followAnotherBluePhaseLog("Cannot return through blue outlined tiles because the player marker was not detected."),
      );
    }

    return {
      ...state,
      missingBlueOutlineTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };
  const step12PlayerAnchor = { centerX: playerBox.centerX, centerY: playerBox.centerY };
  const magenta = detectLargestMagentaObject(tickCapture.bitmap, BIG_MAGENTA_MIN_PIXELS);
  const blueOutlines = detectBlueOutlines(tickCapture.bitmap);

  if (state.phase === "return-blue-tiles") {
    const step6BlueOutlines = blueOutlines.filter(isStep6DarkBlueOutline);
    const step6TopRightBlueOutlines = step6BlueOutlines.filter((outline) => isStep6TopOrRightBlueOutline(outline, playerAnchor));
    const ignoredRoyalBlueOutlines = blueOutlines.filter((outline) => outline.tier === "step-12");
    const markers = detectArceuusYellowMarkers(tickCapture.bitmap);
    const returnYellowMarker = pickArceuusYellowMarkerForAgilityLevel(markers, state.agilityLevel, playerAnchor, tickCapture.bitmap);

    if (returnYellowMarker) {
      log(
        returnBluePhaseLog(
          `Return agility marker found during Step 6; blue return complete. target=${formatYellowMarker(returnYellowMarker)}.`,
        ),
      );
      return transitionToReturnYellowShortcut(state, nowMs);
    }

    const target = pickStep6TopRightBlueOutline(step6TopRightBlueOutlines, playerAnchor);
    if (!target) {
      const rotated = tapCameraKey(
        STEP6_TOP_RIGHT_BLUE_CAMERA_KEY,
        "return-blue-tiles",
        "Step 6 has no top/right dark pure-blue return tile; rotate camera before retry",
      );
      const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
      if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
        warn(
          returnBluePhaseLog(
            `No Step 6 top/right dark pure-blue tile (#0000FF) found and no return agility marker is visible. camera${STEP6_TOP_RIGHT_BLUE_CAMERA_KEY.toUpperCase()}=${rotated ? "yes" : "no"}; topRightPureBlue=${step6TopRightBlueOutlines.map(formatBlueOutline).join("; ") || "none"} pureBlue=${step6BlueOutlines.map(formatBlueOutline).join("; ") || "none"} royalBlueIgnored=${ignoredRoyalBlueOutlines.map(formatBlueOutline).join("; ") || "none"} allBlue=${blueOutlines.map(formatBlueOutline).join("; ") || "none"}. Yellow=${markers.map(formatYellowMarker).join("; ") || "none"}. MagentaIgnored=${magenta ? formatMagentaObject(magenta) : "none"}.`,
          ),
        );
      }

      return {
        ...state,
        missingBlueOutlineTicks,
        missingMagentaTicks: state.missingMagentaTicks + 1,
        actionLockUntilMs: rotated ? cameraActionLockUntil(nowMs) : nowMs + FAST_RETRY_MS,
      };
    }

    const clickPoint = pickBoxInteractionScreenPoint(target, captureBounds, {
      innerRatio: 0.45,
      preferredLocalY: target.centerY,
    });
    const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
    const clickedAtMs = Date.now();
    const travel = estimateStep12TravelWaitTicks(step12PlayerAnchor, target, captureBounds, fallbackTilePx);
    logSimulatedClick("Step 6 return-blue", clicked, captureBounds, "dark pure-blue tile #0000FF during return; chisel allowed during travel");
    log(
      returnBluePhaseLog(
        `Step 6 return-blue: clicked top/right dark pure-blue tile (#0000FF) at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); blueTarget=${formatBlueOutline(target)}; topRightPureBlueCandidates=${step6TopRightBlueOutlines.length}/${step6BlueOutlines.length}; royalBlueIgnored=${ignoredRoyalBlueOutlines.length}; magenta=none; chiselDuringTravel=yes; ${formatStep12TravelWaitEstimate(travel)}.`,
      ),
    );

    return {
      ...state,
      missingBlueOutlineTicks: 0,
      missingMagentaTicks: 0,
      actionLockUntilMs: clickedAtMs + ticksToMs(travel.waitTicks, GAME_TICK_MS),
    };
  }

  const step12ColorTiles = [
    ...detectStep12ExactColorTiles(tickCapture.bitmap, "green"),
    ...detectStep12ExactColorTiles(tickCapture.bitmap, "red"),
  ];
  const step12BlueOutlines = blueOutlines.filter((outline) => outline.tier === "step-12");
  if (!state.returnBlueGreenCameraTurned) {
    const greenTile = pickTopStep12ColorTile(step12ColorTiles, "green");
    const target = pickTopRightBlueOutline(step12BlueOutlines);
    if (!greenTile && !target) {
      const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
      if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
        warn(
          followAnotherBluePhaseLog(
            `No green tile or top-right blue tile found before the first Step 12 camera turn. Blue candidates=${blueOutlines.map(formatBlueOutline).join("; ") || "none"}. Tiles=${step12ColorTiles.map(formatStep12ColorTile).join("; ") || "none"}.`,
          ),
        );
      }

      return {
        ...state,
        missingBlueOutlineTicks,
        actionLockUntilMs: nowMs + FAST_RETRY_MS,
      };
    }
    const clickTarget = greenTile ?? target;
    if (!clickTarget) {
      return {
        ...state,
        actionLockUntilMs: nowMs + FAST_RETRY_MS,
      };
    }

    const clickPoint = pickBoxInteractionScreenPoint(clickTarget, captureBounds, {
      innerRatio: 0.45,
      preferredLocalY: clickTarget.centerY,
    });
    const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
    const clickedAtMs = Date.now();
    const travel = estimateStep12TravelWaitTicks(step12PlayerAnchor, clickTarget, captureBounds, fallbackTilePx);
    const pendingCameraTurnAtMs = greenTile ? getReturnBlueCameraTurnReadyAtMs(clickedAtMs, travel) : 0;

    logSimulatedClick(
      "Step 12 follow-another-blue",
      clicked,
      captureBounds,
      greenTile ? "green tile during green camera-turn stage; camera turn scheduled after arrival" : "top-right blue tile while searching for green tile",
    );
    log(
      followAnotherBluePhaseLog(
        `Step 12 before green turn: clicked ${greenTile ? "green tile" : "top-right blue outlined tile"} at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); blueTarget=${target ? formatBlueOutline(target) : "none"}; greenTile=${greenTile ? formatStep12ColorTile(greenTile) : "no"}; cameraTurn=${greenTile ? `scheduled ${RETURN_BLUE_GREEN_CAMERA_KEY} after arrival` : "no"}; ${formatStep12TravelWaitEstimate(travel)}.`,
      ),
    );

    return {
      ...state,
      missingBlueOutlineTicks: 0,
      missingMagentaTicks: 0,
      pendingReturnBlueCameraTurnAtMs: pendingCameraTurnAtMs,
      pendingReturnBlueCameraTurnKey: greenTile ? RETURN_BLUE_GREEN_CAMERA_KEY : null,
      pendingReturnBlueCameraTurnStage: greenTile ? "green" : null,
      actionLockUntilMs: pendingCameraTurnAtMs > 0 ? pendingCameraTurnAtMs : clickedAtMs + ticksToMs(travel.waitTicks, GAME_TICK_MS),
    };
  }

  if (!state.returnBlueRedCameraTurned) {
    const redTile = pickTopLeftStep12ColorTile(step12ColorTiles, "red");
    const greenTile = pickTopStep12ColorTile(step12ColorTiles, "green");
    if (!redTile && !greenTile) {
      const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
      if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
        warn(
          followAnotherBluePhaseLog(
            `No green tile or red tile found before the second Step 12 camera turn. Tiles=${step12ColorTiles.map(formatStep12ColorTile).join("; ") || "none"}.`,
          ),
        );
      }

      return {
        ...state,
        missingBlueOutlineTicks,
        actionLockUntilMs: nowMs + FAST_RETRY_MS,
      };
    }
    const clickTarget = redTile ?? greenTile;
    if (!clickTarget) {
      return {
        ...state,
        actionLockUntilMs: nowMs + FAST_RETRY_MS,
      };
    }

    const clickPoint = pickBoxInteractionScreenPoint(clickTarget, captureBounds, {
      innerRatio: 0.45,
      preferredLocalY: clickTarget.centerY,
    });
    const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
    const clickedAtMs = Date.now();
    const travel = estimateStep12TravelWaitTicks(step12PlayerAnchor, clickTarget, captureBounds, fallbackTilePx);
    const pendingCameraTurnAtMs = redTile ? getReturnBlueCameraTurnReadyAtMs(clickedAtMs, travel) : 0;

    logSimulatedClick(
      "Step 12 follow-another-blue",
      clicked,
      captureBounds,
      redTile ? "red tile during red camera-turn stage; camera turn scheduled after arrival" : "green tile while searching for red tile",
    );
    log(
      followAnotherBluePhaseLog(
        `Step 12 before red turn: clicked ${redTile ? "red tile" : "green tile"} at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); greenTile=${greenTile ? formatStep12ColorTile(greenTile) : "no"}; redTile=${redTile ? formatStep12ColorTile(redTile) : "no"}; cameraTurn=${redTile ? `scheduled ${RETURN_BLUE_RED_CAMERA_KEY} after arrival` : "no"}; ${formatStep12TravelWaitEstimate(travel)}.`,
      ),
    );

    return {
      ...state,
      missingBlueOutlineTicks: 0,
      missingMagentaTicks: 0,
      pendingReturnBlueCameraTurnAtMs: pendingCameraTurnAtMs,
      pendingReturnBlueCameraTurnKey: redTile ? RETURN_BLUE_RED_CAMERA_KEY : null,
      pendingReturnBlueCameraTurnStage: redTile ? "red" : null,
      actionLockUntilMs: pendingCameraTurnAtMs > 0 ? pendingCameraTurnAtMs : clickedAtMs + ticksToMs(travel.waitTicks, GAME_TICK_MS),
    };
  }

  if (magenta) {
    const clicked = clickScreenPoint(captureBounds.x + magenta.centerX, captureBounds.y + magenta.centerY, captureBounds);
    const clickedAtMs = Date.now();
    const travel = estimateStep12TravelWaitTicks(step12PlayerAnchor, magenta, captureBounds, fallbackTilePx);
    logSimulatedClick("Step 13 blood-altar-craft", clicked, captureBounds, "blood altar magenta");
    log(
      phaseLogText(
        "Step 13 blood-altar-craft",
        `Clicked blood altar magenta at (${clicked.x},${clicked.y}); target=${formatMagentaObject(magenta)}; ${formatStep12TravelWaitEstimate(travel)}.`,
      ),
    );

    return transitionToBloodAltarCraftValidation(state, clickedAtMs, travel);
  }

  const redTile = pickTopLeftStep12ColorTile(step12ColorTiles, "red");
  if (!redTile) {
    const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
    if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        followAnotherBluePhaseLog(
          `Waiting for red tile until blood altar magenta appears. Magenta=${magenta ? formatMagentaObject(magenta) : "none"}. Tiles=${step12ColorTiles.map(formatStep12ColorTile).join("; ") || "none"}.`,
        ),
      );
    }

    return {
      ...state,
      missingBlueOutlineTicks,
      missingMagentaTicks: state.missingMagentaTicks + 1,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const clickPoint = pickBoxInteractionScreenPoint(redTile, captureBounds, {
    innerRatio: 0.45,
    preferredLocalY: redTile.centerY,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
  const clickedAtMs = Date.now();
  const travel = estimateStep12TravelWaitTicks(step12PlayerAnchor, redTile, captureBounds, fallbackTilePx);
  logSimulatedClick("Step 12 follow-another-blue", clicked, captureBounds, "red tile during blood altar search");
  log(
    followAnotherBluePhaseLog(
      `Step 12 red phase: clicked red tile at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); redTile=${formatStep12ColorTile(redTile)}; magenta=none; ${formatStep12TravelWaitEstimate(travel)}.`,
    ),
  );

  return {
    ...state,
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: 0,
    actionLockUntilMs: clickedAtMs + ticksToMs(travel.waitTicks, GAME_TICK_MS),
  };
}

function runReturnYellowShortcutTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
): BotState {
  if (state.phase !== "return-yellow-shortcut" || nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(STEP_RETURN_YELLOW_ID);

  const markers = detectArceuusYellowMarkers(tickCapture.bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  const targetTier = getArceuusYellowMarkerTierForAgilityLevel(state.agilityLevel);

  if (!playerBox) {
    const missingReturnYellowMarkerTicks = state.missingReturnYellowMarkerTicks + 1;
    if (missingReturnYellowMarkerTicks === 1 || missingReturnYellowMarkerTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        returnYellowShortcutPhaseLog(
          `Cannot click return ${targetTier} yellow marker because the player marker was not detected. Detected=${markers.map(formatYellowMarker).join("; ") || "none"}.`,
        ),
      );
    }

    return {
      ...state,
      missingReturnYellowMarkerTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };
  const target = pickArceuusYellowMarkerForAgilityLevel(markers, state.agilityLevel, playerAnchor, tickCapture.bitmap);
  if (!target) {
    const missingReturnYellowMarkerTicks = state.missingReturnYellowMarkerTicks + 1;
    const rotatedCamera = tapCameraKey(YELLOW_MARKER_CAMERA_ROTATE_KEY, "return-yellow-shortcut", `missing return ${targetTier} yellow marker; rotate camera before retry`);
    if (missingReturnYellowMarkerTicks === 1 || missingReturnYellowMarkerTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        returnYellowShortcutPhaseLog(
          `No return ${targetTier} yellow marker found for agilityLevel=${state.agilityLevel}. Rotated camera=${rotatedCamera ? "yes" : "no"}. Detected=${markers.map(formatYellowMarker).join("; ") || "none"}.`,
        ),
      );
    }

    return {
      ...state,
      missingReturnYellowMarkerTicks,
      actionLockUntilMs: cameraActionLockUntil(nowMs),
    };
  }

  const clickPoint = pickBoxInteractionScreenPoint(target, captureBounds, {
    innerRatio: 0.55,
    preferredLocalY: target.centerY,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
  const clickedAtMs = Date.now();
  const travel = estimateTravelTicks({
    screenPoint: clicked,
    captureBounds,
    playerBox,
    fallbackTilePx,
    minTilePx: TRAVEL_TILE_PX_MIN,
    maxTilePx: TRAVEL_TILE_PX_MAX,
    playerSpeedTilesPerTick: PLAYER_TRAVEL_SPEED_TILES_PER_TICK,
    extraTicks: getAgilityCourseExtraWaitTicks(state.agilityLevel),
    minTicks: TRAVEL_MIN_TICKS,
  });

  logSimulatedClick("Step 7 return-yellow-shortcut", clicked, captureBounds, `return agility shortcut tier=${target.tier}`);
  log(
    returnYellowShortcutPhaseLog(
      `Clicked return ${target.tier} yellow marker at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); target=${formatYellowMarker(target)}; ${formatTravelEstimate(travel)}.`,
    ),
  );

  return transitionBackToMiningAfterReturnShortcut(
    {
      ...state,
      missingReturnYellowMarkerTicks: 0,
    },
    clickedAtMs,
    travel,
  );
}

function clickStep14YellowMarkerAndReturnToMining(
  state: BotState,
  target: ArceuusYellowMarker,
  playerBox: NonNullable<ReturnType<typeof detectBestPlayerBoxInScreenshot>>,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
): BotState {
  const clickPoint = pickBoxInteractionScreenPoint(target, captureBounds, {
    innerRatio: 0.55,
    preferredLocalY: target.centerY,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
  const clickedAtMs = Date.now();
  const travel = estimateTravelTicks({
    screenPoint: clicked,
    captureBounds,
    playerBox,
    fallbackTilePx,
    minTilePx: TRAVEL_TILE_PX_MIN,
    maxTilePx: TRAVEL_TILE_PX_MAX,
    playerSpeedTilesPerTick: PLAYER_TRAVEL_SPEED_TILES_PER_TICK,
    extraTicks: getAgilityCourseExtraWaitTicks(state.agilityLevel),
    minTicks: TRAVEL_MIN_TICKS,
  });

  logSimulatedClick("Step 14 return-to-mining", clicked, captureBounds, `return agility marker tier=${target.tier}`);
  log(
    returnToMiningPhaseLog(
      `Clicked return ${target.tier} yellow marker at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); target=${formatYellowMarker(target)}; ${formatTravelEstimate(travel)}.`,
    ),
  );

  return transitionToMiningAfterStep14Return(
    {
      ...state,
      missingReturnYellowMarkerTicks: 0,
      missingBlueOutlineTicks: 0,
    },
    clickedAtMs,
    travel,
  );
}

function clickStep14RouteTarget(
  state: BotState,
  target: Step12ColorTile | BlueOutlineDetection,
  playerBox: NonNullable<ReturnType<typeof detectBestPlayerBoxInScreenshot>>,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
  description: string,
  nextStage: BotState["returnToMiningStage"],
): BotState {
  const clickPoint = pickBoxInteractionScreenPoint(target, captureBounds, {
    innerRatio: 0.45,
    preferredLocalY: target.centerY,
  });
  const clicked = clickScreenPoint(clickPoint.x, clickPoint.y, captureBounds);
  const clickedAtMs = Date.now();
  const travel = estimateStep12TravelWaitTicks(
    { centerX: playerBox.centerX, centerY: playerBox.centerY },
    target,
    captureBounds,
    fallbackTilePx,
  );

  logSimulatedClick("Step 14 return-to-mining", clicked, captureBounds, description);
  log(
    returnToMiningPhaseLog(
      `Clicked ${description} at (${clicked.x},${clicked.y}); player=(${playerBox.centerX},${playerBox.centerY}); target=${
        "status" in target ? formatStep12ColorTile(target) : formatBlueOutline(target)
      }; nextStage=${nextStage}; ${formatStep12TravelWaitEstimate(travel)}.`,
    ),
  );

  return {
    ...state,
    returnToMiningStage: nextStage,
    missingBlueOutlineTicks: 0,
    missingMagentaTicks: 0,
    actionLockUntilMs: clickedAtMs + ticksToMs(travel.waitTicks, GAME_TICK_MS),
  };
}

function runReturnToMiningTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
): BotState {
  if (state.phase !== "return-to-mining" || nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(STEP_RETURN_TO_MINING_ID);

  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  if (!playerBox) {
    const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
    if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(returnToMiningPhaseLog(`Cannot continue Step 14 stage=${state.returnToMiningStage} because the player marker was not detected.`));
    }

    return {
      ...state,
      missingBlueOutlineTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const colorTiles = [
    ...detectStep12ExactColorTiles(tickCapture.bitmap, "red"),
    ...detectStep12ExactColorTiles(tickCapture.bitmap, "green"),
  ];
  const blueOutlines = detectBlueOutlines(tickCapture.bitmap);
  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };

  if (state.returnToMiningStage === "red") {
    const redTile = pickTopStep12ColorTile(colorTiles, "red");
    if (redTile) {
      return clickStep14RouteTarget(state, redTile, playerBox, captureBounds, fallbackTilePx, "top red return tile", "red");
    }

    if (state.agilityLevel >= 73) {
      log(
        returnToMiningPhaseLog(
          `No top red return tile found; agilityLevel=${state.agilityLevel} so checking for agility-73 yellow marker before green route. Tiles=${colorTiles.map(formatStep12ColorTile).join("; ") || "none"}.`,
        ),
      );
      return {
        ...state,
        returnToMiningStage: "agility-73",
        missingBlueOutlineTicks: 0,
        actionLockUntilMs: nowMs + FAST_RETRY_MS,
      };
    }

    const rotated = tapCameraKey(
      RETURN_TO_MINING_GREEN_CAMERA_KEY,
      "return-to-mining",
      "top red return tiles exhausted; rotate camera before top green route",
    );
    log(
      returnToMiningPhaseLog(
        `No top red return tile found; agilityLevel=${state.agilityLevel} uses green route. camera${RETURN_TO_MINING_GREEN_CAMERA_KEY.toUpperCase()}=${rotated ? "yes" : "no"}. Tiles=${colorTiles.map(formatStep12ColorTile).join("; ") || "none"}.`,
      ),
    );

    return {
      ...state,
      returnToMiningStage: "green",
      missingBlueOutlineTicks: 0,
      actionLockUntilMs: rotated ? cameraActionLockUntil(nowMs) : nowMs + FAST_RETRY_MS,
    };
  }

  if (state.returnToMiningStage === "agility-73") {
    const markers = detectArceuusYellowMarkers(tickCapture.bitmap);
    const target = pickArceuusYellowMarkerForAgilityLevel(markers, state.agilityLevel, playerAnchor, tickCapture.bitmap);
    if (target) {
      return clickStep14YellowMarkerAndReturnToMining(state, target, playerBox, captureBounds, fallbackTilePx);
    }

    const missingReturnYellowMarkerTicks = state.missingReturnYellowMarkerTicks + 1;
    if (missingReturnYellowMarkerTicks === 1 || missingReturnYellowMarkerTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        returnToMiningPhaseLog(
          `Waiting for agility-73 yellow marker after red route. Detected=${markers.map(formatYellowMarker).join("; ") || "none"}.`,
        ),
      );
    }

    return {
      ...state,
      missingReturnYellowMarkerTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  if (state.returnToMiningStage === "green") {
    const greenTile = pickTopStep12ColorTile(colorTiles, "green");
    if (greenTile) {
      return clickStep14RouteTarget(state, greenTile, playerBox, captureBounds, fallbackTilePx, "top green return tile", "green");
    }

    const rotated = tapCameraKey(
      RETURN_TO_MINING_BLUE_CAMERA_KEY,
      "return-to-mining",
      "top green return tiles exhausted; rotate camera before blue route",
    );
    log(
      returnToMiningPhaseLog(
        `No top green return tile found; entering blue route. camera${RETURN_TO_MINING_BLUE_CAMERA_KEY.toUpperCase()}=${rotated ? "yes" : "no"}. Tiles=${colorTiles.map(formatStep12ColorTile).join("; ") || "none"}.`,
      ),
    );

    return {
      ...state,
      returnToMiningStage: "blue-1",
      missingBlueOutlineTicks: 0,
      actionLockUntilMs: rotated ? cameraActionLockUntil(nowMs) : nowMs + FAST_RETRY_MS,
    };
  }

  const markers = detectArceuusYellowMarkers(tickCapture.bitmap);
  const targetYellow = pickArceuusYellowMarkerForAgilityLevel(markers, state.agilityLevel, playerAnchor, tickCapture.bitmap);
  if (targetYellow) {
    return clickStep14YellowMarkerAndReturnToMining(state, targetYellow, playerBox, captureBounds, fallbackTilePx);
  }

  if (state.returnToMiningStage === "agility") {
    const missingReturnYellowMarkerTicks = state.missingReturnYellowMarkerTicks + 1;
    const rotated = tapCameraKey(
      RETURN_TO_MINING_BLUE_CAMERA_KEY,
      "return-to-mining",
      "return agility marker not visible after blue route; rotate camera before retry",
    );
    if (missingReturnYellowMarkerTicks === 1 || missingReturnYellowMarkerTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        returnToMiningPhaseLog(
          `No return ${getArceuusYellowMarkerTierForAgilityLevel(state.agilityLevel)} yellow marker found after blue route. Rotated camera=${rotated ? "yes" : "no"}. Detected=${markers.map(formatYellowMarker).join("; ") || "none"}.`,
        ),
      );
    }

    return {
      ...state,
      missingReturnYellowMarkerTicks,
      actionLockUntilMs: rotated ? cameraActionLockUntil(nowMs) : nowMs + FAST_RETRY_MS,
    };
  }

  const routeBlueOutlines = blueOutlines.filter((outline) => outline.tier === "step-12");
  const fallbackBlueOutlines = routeBlueOutlines.length > 0 ? routeBlueOutlines : blueOutlines;
  const targetBlue = pickFarthestTopBlueOutlineFromAnchor(fallbackBlueOutlines, playerAnchor);
  if (!targetBlue) {
    const missingBlueOutlineTicks = state.missingBlueOutlineTicks + 1;
    if (missingBlueOutlineTicks === 1 || missingBlueOutlineTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        returnToMiningPhaseLog(
          `No blue return tile or return ${getArceuusYellowMarkerTierForAgilityLevel(state.agilityLevel)} yellow marker found. Blue=${blueOutlines.map(formatBlueOutline).join("; ") || "none"} yellow=${markers.map(formatYellowMarker).join("; ") || "none"}.`,
        ),
      );
    }

    return {
      ...state,
      returnToMiningStage: "agility",
      missingBlueOutlineTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  return clickStep14RouteTarget(
    state,
    targetBlue,
    playerBox,
    captureBounds,
    fallbackTilePx,
    "blue return tile while searching for agility marker",
    state.returnToMiningStage === "blue-1" ? "blue-2" : "blue-2",
  );
}

function runBloodAltarCraftTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  fallbackTilePx: number,
  essenceIconTemplates: readonly ArceuusEssenceIconTemplate[],
  chiselIconTemplate: RobotBitmap,
): BotState {
  if (state.phase !== "blood-altar-craft" || nowMs < state.actionLockUntilMs) {
    return state;
  }

  setAutomateBotCurrentStep(STEP_BLOOD_ALTAR_CRAFT_ID);

  const essenceDetection = detectArceuusEssenceInventory(tickCapture.bitmap, essenceIconTemplates, {
    blockClassificationMode: "dark",
  });
  const chiselDetection = state.rememberedChisel
    ? null
    : detectArceuusChiselInventory(tickCapture.bitmap, chiselIconTemplate);
  const chiselDetectionText = chiselDetection
    ? `${formatArceuusChiselInventoryDetection(chiselDetection)} ${formatArceuusChiselInventoryDetectionDetails(chiselDetection)}`
    : `chisel=startup-reference rememberedChisel=${formatArceuusChiselMatch(state.rememberedChisel)}`;
  const inventory = detectInventoryFreeSpace(tickCapture.bitmap);
  log(
    phaseLog(
      "blood-altar-craft",
      `Blood altar craft inventory validation: ${formatArceuusEssenceInventoryDetection(essenceDetection)} ${formatArceuusEssenceInventoryDetectionDetails(essenceDetection)} ${chiselDetectionText} freeSlots=${inventory.freeSlots ?? "unknown"}.`,
    ),
  );

  if (!state.bloodAltarCraftConfirmed && essenceDetection.darkFragments.length > 0) {
    const missingInventoryCountTicks = state.missingInventoryCountTicks + 1;
    if (missingInventoryCountTicks === 1 || missingInventoryCountTicks % INVENTORY_DEBUG_INTERVAL_TICKS === 0) {
      warn(
        phaseLog(
          "blood-altar-craft",
          `Fragments still visible after blood altar click; waiting before mining. fragments=${essenceDetection.darkFragments.length}.`,
        ),
      );
    }

    return {
      ...state,
      missingInventoryCountTicks,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const confirmedState = state.bloodAltarCraftConfirmed
    ? state
    : {
        ...state,
        bloodAltarCraftConfirmed: true,
        missingInventoryCountTicks: 0,
      };
  if (!state.bloodAltarCraftConfirmed) {
    log(
      phaseLog(
        "blood-altar-craft",
        `Initial blood altar craft confirmed; fragments are gone. Starting post-craft chisel until no dark essence blocks remain.`,
      ),
    );
  }

  const stateWithInventory =
    inventory.freeSlots === null ? confirmedState : updateInventoryState(confirmedState, inventory.freeSlots);
  const darkBlockTarget = pickChiselDarkEssenceBlock(essenceDetection.darkBlocks, state.lastDarkEssenceBlock);
  if (darkBlockTarget.target) {
    const detectedChisel = chiselDetection ? pickBottomRightChisel(chiselDetection.chisels) : null;
    const chisel = stateWithInventory.rememberedChisel ?? detectedChisel;
    const chiselSource = stateWithInventory.rememberedChisel ? "startup" : detectedChisel ? "runtime" : "none";
    if (!chisel) {
      warn(
        phaseLog(
          "blood-altar-craft",
          `Step 13 chisel blocked; no startup chisel reference and chisel not detected while dark essence remains. target=${formatArceuusEssenceIconMatch(darkBlockTarget.target)} source=${darkBlockTarget.source} rememberedChisel=${formatArceuusChiselMatch(stateWithInventory.rememberedChisel)} ${chiselDetectionText} darkBlocks=${essenceDetection.darkBlocks.length}.`,
        ),
      );

      return {
        ...stateWithInventory,
        missingInventoryCountTicks: 0,
        lastDarkEssenceBlock: darkBlockTarget.target,
        actionLockUntilMs: nowMs + FAST_RETRY_MS,
      };
    }

    const clickedChisel = clickScreenPoint(captureBounds.x + chisel.centerX, captureBounds.y + chisel.centerY, captureBounds);
    sleepSyncMs(RETURN_TRAVEL_CHISEL_CLICK_DELAY_MS);
    const clickedDarkBlock = clickScreenPoint(
      captureBounds.x + darkBlockTarget.target.centerX,
      captureBounds.y + darkBlockTarget.target.centerY,
      captureBounds,
    );
    const clickedAtMs = Date.now();
    logSimulatedClick("Step 13 blood-altar-craft", clickedChisel, captureBounds, "post-craft chisel");
    logSimulatedClick(
      "Step 13 blood-altar-craft",
      clickedDarkBlock,
      captureBounds,
      `post-craft ${darkBlockTarget.source} dark essence block after ${RETURN_TRAVEL_CHISEL_CLICK_DELAY_MS}ms delay`,
    );
    log(
      phaseLog(
        "blood-altar-craft",
        `Step 13 post-craft chisel action: clickedChisel=(${chisel.centerX},${chisel.centerY}) source=${chiselSource} score=${chisel.score.toFixed(3)} rememberedChisel=${formatArceuusChiselMatch(stateWithInventory.rememberedChisel)} ${chiselDetectionText} then darkBlock=${formatArceuusEssenceIconMatch(darkBlockTarget.target)} source=${darkBlockTarget.source} darkBlocks=${essenceDetection.darkBlocks.length}.`,
      ),
    );

    return {
      ...stateWithInventory,
      missingInventoryCountTicks: 0,
      lastDarkEssenceBlock: darkBlockTarget.target,
      rememberedChisel: chisel,
      lastReturnTravelChiselAtMs: clickedAtMs,
      actionLockUntilMs: clickedAtMs + RETURN_TRAVEL_CHISEL_INTERVAL_MS,
    };
  }

  const magenta = detectLargestMagentaObject(tickCapture.bitmap, BIG_MAGENTA_MIN_PIXELS);
  if (!magenta) {
    const missingMagentaTicks = state.missingMagentaTicks + 1;
    if (missingMagentaTicks === 1 || missingMagentaTicks % MISSING_LOG_INTERVAL_TICKS === 0) {
      warn(
        phaseLog(
          "blood-altar-craft",
          `Step 13 chisel complete; no dark essence blocks remain, but blood altar magenta is not visible yet. darkBlocks=${essenceDetection.darkBlocks.length}.`,
        ),
      );
    }

    return {
      ...stateWithInventory,
      missingInventoryCountTicks: 0,
      missingMagentaTicks,
      lastDarkEssenceBlock: null,
      actionLockUntilMs: nowMs + FAST_RETRY_MS,
    };
  }

  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  const clicked = clickScreenPoint(captureBounds.x + magenta.centerX, captureBounds.y + magenta.centerY, captureBounds);
  const clickedAtMs = Date.now();
  const travel = playerBox
    ? estimateStep12TravelWaitTicks({ centerX: playerBox.centerX, centerY: playerBox.centerY }, magenta, captureBounds, fallbackTilePx)
    : null;
  logSimulatedClick("Step 13 blood-altar-craft", clicked, captureBounds, "blood altar magenta after post-craft chisel");
  log(
    phaseLog(
      "blood-altar-craft",
      `Step 13 chisel complete; clicked blood altar magenta again at (${clicked.x},${clicked.y}); target=${formatMagentaObject(magenta)}; ${travel ? formatStep12TravelWaitEstimate(travel) : "travelEstimate=unavailable"}. Entering Step 14 after final altar click.`,
    ),
  );

  return transitionToReturnToMiningAfterBloodAltarCraft(
    {
      ...stateWithInventory,
      missingInventoryCountTicks: 0,
      missingMagentaTicks: 0,
      lastDarkEssenceBlock: null,
      bloodAltarCraftConfirmed: false,
    },
    clickedAtMs,
    travel ? ticksToMs(travel.waitTicks, GAME_TICK_MS) : POST_CLICK_LOCK_MS,
  );
}

async function runLoop(
  captureBounds: ScreenCaptureBounds,
  agilityLevel: number,
  fallbackTilePx: number,
  essenceIconTemplates: readonly ArceuusEssenceIconTemplate[],
  chiselIconTemplate: RobotBitmap,
  startupOverride: StartupOverride | null,
): Promise<void> {
  if (isLoopRunning) {
    return;
  }

  isLoopRunning = true;
  try {
    await runBotEngine<BotState, EngineFunctionKey, TickCapture>({
      tickMs: BOT_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: () => createInitialState(agilityLevel, startupOverride),
      captureTick: () => ({
        bitmap: captureScreenBitmap(captureBounds),
      }),
      observeTick: ({ state }) => {
        setLogContextFromState(state);
      },
      functions: {
        mine: ({ state, nowMs, tickCapture }) => runMiningTick(state, nowMs, tickCapture, captureBounds),
        selectYellowMarker: ({ state, nowMs, tickCapture }) =>
          runSelectYellowMarkerTick(state, nowMs, tickCapture, captureBounds, fallbackTilePx),
        followBlueTiles: ({ state, nowMs, tickCapture }) =>
          runFollowBlueTilesTick(state, nowMs, tickCapture, captureBounds, fallbackTilePx),
        checkAfterMagenta: ({ state, nowMs, tickCapture }) =>
          runCheckAfterMagentaTick(state, nowMs, tickCapture, essenceIconTemplates, chiselIconTemplate),
        returnBlueTiles: ({ state, nowMs, tickCapture }) =>
          runReturnBlueTilesTick(state, nowMs, tickCapture, captureBounds, fallbackTilePx, essenceIconTemplates, chiselIconTemplate),
        returnYellowShortcut: ({ state, nowMs, tickCapture }) =>
          runReturnYellowShortcutTick(state, nowMs, tickCapture, captureBounds, fallbackTilePx),
        followAnotherBlueTiles: ({ state, nowMs, tickCapture }) =>
          runReturnBlueTilesTick(state, nowMs, tickCapture, captureBounds, fallbackTilePx, essenceIconTemplates, chiselIconTemplate),
        bloodAltarCraft: ({ state, nowMs, tickCapture }) =>
          runBloodAltarCraftTick(state, nowMs, tickCapture, captureBounds, fallbackTilePx, essenceIconTemplates, chiselIconTemplate),
        returnToMining: ({ state, nowMs, tickCapture }) =>
          runReturnToMiningTick(state, nowMs, tickCapture, captureBounds, fallbackTilePx),
      },
      onTickError: (error, state) => {
        setLogContextFromState(state);
        const message = error instanceof Error ? error.message : String(error);
        warn(phaseLog(state.phase, `tick error - ${message}`));
      },
    });
  } finally {
    isLoopRunning = false;
    setAutomateBotCurrentStep(null);
  }
}

export function onRunecraftingArceuusBloodRuneBotStart(): void {
  structuredLogger.setContext({ loopIndex: 0, label: "Step 0 startup" });
  log(phaseLog("startup", `STARTED (${BOT_NAME}).`));

  const window = getRuneLite();
  if (!window) {
    const message = `${BOT_NAME} could not start because the RuneLite window was not found.`;
    warn(message);
    stopAutomateBot("bot");
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();

  const calibration = readStartupPlayerTileCalibration(window);
  if (!calibration) {
    warn("Cannot start - invalid RuneLite window bounds.");
    stopAutomateBot("bot");
    return;
  }

  const config = getSavedArceuusBloodRuneConfig();
  log(
    phaseLog("startup", `Config: botTick=${BOT_TICK_MS}ms, clickSettle=50ms, postClickLock=${POST_CLICK_LOCK_MS}ms, agilityLevel=${config.agilityLevel}, yellowTier=${getArceuusYellowMarkerTierForAgilityLevel(config.agilityLevel)}, capture=${calibration.captureBounds.width}x${calibration.captureBounds.height}, scale=${calibration.windowsScalePercent}%.`),
  );

  void (async () => {
    await sleepWithAbort(STARTUP_SETTLE_MS, () => AppState.automateBotRunning);
    if (!AppState.automateBotRunning) {
      return;
    }

    const inventoryOpened = tapCameraKey(STARTUP_INVENTORY_KEY, "startup", "startup open inventory before first inventory read");
    log(phaseLog("startup", `Startup inventory key '${STARTUP_INVENTORY_KEY}' ${inventoryOpened ? "sent" : "failed"}.`));
    await sleepWithAbort(STARTUP_SETTLE_MS, () => AppState.automateBotRunning);
    if (!AppState.automateBotRunning) {
      return;
    }

    const [essenceIconTemplates, chiselIconTemplate] = await Promise.all([
      loadArceuusEssenceIconTemplates(),
      loadArceuusChiselIconTemplate(),
    ]);
    if (!AppState.automateBotRunning) {
      return;
    }

    log(
      phaseLog(
        "startup",
        `Loaded Arceuus inventory templates (${essenceIconTemplates.map((template) => `${template.kind}=${template.bitmap.width}x${template.bitmap.height}`).join(", ")}, chisel=${chiselIconTemplate.width}x${chiselIconTemplate.height}).`,
      ),
    );

    const startupBitmap = captureScreenBitmap(calibration.captureBounds);
    const startupEssenceDetection = detectArceuusEssenceInventory(startupBitmap, essenceIconTemplates, {
      blockClassificationMode: "dark",
    });
    const startupChiselDetection = detectArceuusChiselInventory(startupBitmap, chiselIconTemplate);
    const startupChisel = pickBottomRightChisel(startupChiselDetection.chisels);
    const startupInventory = detectInventoryFreeSpace(startupBitmap);
    const startupLogicalCounts = estimateArceuusLogicalInventoryCounts(
      startupInventory.freeSlots,
      startupEssenceDetection,
      startupChiselDetection,
    );
    const startAtStep12FollowAnother =
      startupEssenceDetection.darkFragments.length > 0 &&
      startupEssenceDetection.darkBlocks.length > 0 &&
      startupEssenceDetection.denseBlocks.length === 0;
    const startAtStep6ReturnBlue =
      startupEssenceDetection.denseBlocks.length === 0 &&
      startupEssenceDetection.darkBlocks.length > 0 &&
      startupEssenceDetection.darkFragments.length === 0;
    const startAtMiningAgain =
      startupEssenceDetection.denseBlocks.length === 0 &&
      startupEssenceDetection.darkBlocks.length === 0 &&
      startupEssenceDetection.darkFragments.length > 0;
    const startupOverride = startAtStep12FollowAnother
      ? {
          currentFunction: "followAnotherBlueTiles" as const,
          phase: "follow-another-blue" as const,
          completedReturnTrips: 1,
          rememberedChisel: startupChisel,
        }
      : startAtStep6ReturnBlue
        ? {
            currentFunction: "returnBlueTiles" as const,
            phase: "return-blue-tiles" as const,
            completedReturnTrips: 1,
            rememberedChisel: startupChisel,
          }
      : startAtMiningAgain
        ? {
            currentFunction: "mine" as const,
            phase: "mining" as const,
            completedReturnTrips: 1,
            rememberedChisel: startupChisel,
          }
        : {
            currentFunction: "mine" as const,
            phase: "mining" as const,
            completedReturnTrips: 0,
            rememberedChisel: startupChisel,
          };
    log(
      phaseLog(
        "startup",
        `Startup inventory check: ${formatArceuusEssenceInventoryDetection(startupEssenceDetection)} ${formatArceuusEssenceInventoryDetectionDetails(startupEssenceDetection)} ${formatArceuusChiselInventoryDetection(startupChiselDetection)} ${formatArceuusChiselInventoryDetectionDetails(startupChiselDetection)} rememberedChisel=${formatArceuusChiselMatch(startupChisel)} freeSlots=${startupInventory.freeSlots ?? "unknown"} ${formatArceuusLogicalInventoryCounts(startupLogicalCounts)} bottomRightDense=${formatArceuusEssenceIconMatch(pickBottomRightDarkEssenceBlock(startupEssenceDetection.denseBlocks))} bottomRightDark=${formatArceuusEssenceIconMatch(pickBottomRightDarkEssenceBlock(startupEssenceDetection.darkBlocks))} startStep=${startAtStep12FollowAnother ? "Step 12 follow-another-blue" : startAtStep6ReturnBlue ? "Step 6 return-blue" : startAtMiningAgain ? "Step 8 mining-again" : "Step 1 mining"}.`,
      ),
    );
    if (startAtStep6ReturnBlue) {
      const cameraPrepared = tapCameraKey(
        STEP6_RETURN_BLUE_CAMERA_KEY,
        "startup",
        "startup detected Step 6 return-blue; rotate camera toward dark blue tiles",
      );
      log(phaseLog("startup", `Step 6 startup camera${STEP6_RETURN_BLUE_CAMERA_KEY.toUpperCase()}=${cameraPrepared ? "yes" : "no"}.`));
      if (cameraPrepared) {
        await sleepWithAbort(CAMERA_ACTION_SETTLE_MS, () => AppState.automateBotRunning);
      }
      if (!AppState.automateBotRunning) {
        return;
      }
    }

    await runLoop(
      calibration.captureBounds,
      config.agilityLevel,
      calibration.tilePx,
      essenceIconTemplates,
      chiselIconTemplate,
      startupOverride,
    );
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Startup failed: ${message}`);
    stopAutomateBot("bot");
  });
}
