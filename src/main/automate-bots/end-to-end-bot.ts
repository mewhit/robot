import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { pushAutomateBotLog } from "../automateBotLogs";
import { findRuneLiteWindow, getRuneLite, focusRuneLiteWindowForAutomation, type RuneLiteWindowInfo } from "../runeLiteWindow";
import { AppState } from "../global-state";
import { getMousePos, getScreenSize } from "robotjs";
import { screen as electronScreen } from "electron";
import {
  captureScreenBitmap,
  resolveScreenCaptureBounds,
  type ScreenBitmap,
  type ScreenCaptureBounds,
} from "../windowsScreenCapture";
import path from "path";
import { END_TO_END_BOT_ID } from "./definitions";
import { readOsrsCacheMapRegionView } from "./cache/cache-map-view";
import { ensureProjectOsrsCacheSnapshot } from "./cache/cache-store";
import { sleepWithAbort } from "./engine/bot-engine";
import { fetchOsrsHiscoresLite, formatOsrsHiscoresSkillSummary } from "./hiscores/osrs-hiscores";
import {
  fetchRuneLiteLocalApiSnapshot,
  formatRuneLiteLocalApiProbe,
  formatRuneLiteLocalApiSnapshot,
  type RuneLiteLocalApiItem,
  type RuneLiteLocalApiSnapshot,
} from "./runelite-local-api/runelite-local-api";
import {
  fetchOsrsWikiSyncLocalSnapshot,
  fetchOsrsWikiSyncSnapshot,
  formatOsrsWikiSyncLocalSummary,
  formatOsrsWikiSyncSummary,
  type OsrsWikiSyncLocalSnapshot,
  type OsrsWikiSyncQuest,
  type OsrsWikiSyncQuestStatus,
  type OsrsWikiSyncSnapshot,
} from "./wikisync/osrs-wikisync";
import {
  fetchEndToEndSectionOneChecklist,
  formatEndToEndGuideChecklistExecutionOrder,
} from "./end-to-end/guide-checklist";
import {
  estimateEndToEndGuideQuestProgress,
  formatEndToEndGuideQuestProgressEstimate,
} from "./end-to-end/guide-progress";
import {
  SECTION_ONE_STEP_ONE_BOT_STEP_ID,
  type EndToEndSectionOneStepOneItem,
  type EndToEndSectionOneStepOneState,
  evaluateEndToEndSectionOneStepOne,
  formatEndToEndSectionOneStepOneState,
  loadOsrsItemNamesByIdFromCache,
} from "./end-to-end/section-one-step-one";
import {
  formatEndToEndGeneralStoreRoutePath,
  formatEndToEndGeneralStoreRoutePlan,
  planEndToEndGeneralStoreRoute,
  planEndToEndXMarksTheSpotDigTileRoute,
  planEndToEndXMarksTheSpotStartRoute,
  type EndToEndGeneralStoreRoutePlan,
} from "./end-to-end/section-one-navigation";
import {
  saveLatestEndToEndRoutePathSnapshot,
  type EndToEndPathTile,
  type EndToEndRoutePathSnapshot,
} from "./end-to-end/route-path-snapshot";
import { clickScreenPoint, getSafeScreenPoint, moveMouseHumanLike } from "./shared/robot-clicker";
import {
  executeMinimapWorldClickPlan,
  projectWorldTileToMinimapClick,
  type MinimapWorldClickCalibrationSource,
  type MinimapWorldClickGeometry,
  type MinimapWorldProjectionSource,
} from "./shared/minimap-world-clicker";
import {
  fitSceneMouseCalibrationSamples as fitSharedSceneMouseCalibrationSamples,
  formatSceneMouseCalibrationFit as formatSharedSceneMouseCalibrationFit,
  getCompatibleSavedSceneMouseCalibration,
  isSceneMouseCalibrationFitAcceptable as isSharedSceneMouseCalibrationFitAcceptable,
  projectSceneMouseCalibrationLocalPoint as projectSharedSceneMouseCalibrationLocalPoint,
  saveSharedSceneMouseCalibration,
} from "./shared/scene-mouse-calibration";
import { detectOverlayBoxInScreenshot } from "./shared/coordinate-box-detector";
import { parseWorldTileFromMatchedLine } from "./mapping/world-coordinate";
import { cropBitmap, saveBitmapAsync } from "./shared/save-bitmap";
import {
  clamp,
  randomIntInclusive,
  ticksToMs,
  type ScreenPoint,
} from "./shared/osrs-helper";
import { readStartupPlayerTileCalibration, type StartupPlayerTileCalibration } from "./shared/startup-calibration";
import {
  clearFocusedTextWithCtrlA,
  holdRobotKey,
  isRobotKeyboardInputAvailable,
  typeRobotTextDelayed,
} from "./shared/robot-keyboard";
import {
  detectInventoryPanelInScreenshot,
  formatInventoryPanelDetection,
  getInventoryPanelSlot,
  saveBitmapWithInventoryPanelDebug,
  type InventoryPanelSlot,
  type InventoryPanelTargetSlot,
} from "./shared/inventory-panel-detector";
import {
  detectContextMenuTextBands,
  findContextMenuLabelMatch,
  formatContextMenuWordMatch,
  type ContextMenuLabel,
  type ContextMenuTextBand,
  type ContextMenuWordMatch,
} from "./shared/context-menu-examine-detector";
import {
  detectCyanBoxesInScreenshot,
  saveBitmapWithCyanBoxes,
  type CyanBox,
} from "./shared/cyan-box-detector";
import {
  detectItemIconTemplate,
  formatItemIconTemplateDetection,
  loadItemIconTemplate,
  saveBitmapWithItemIconTemplateDebug,
  type ItemIconMatch,
  type ItemIconSearchRoi,
  type ItemIconTemplateDetection,
} from "./shared/item-icon-template-detector";
import {
  detectRuneLiteSidePanelOrangeIndicator,
  formatRuneLiteSidePanelOrangeDetection,
  saveBitmapWithRuneLiteSidePanelOrangeDebug,
  type RuneLiteSidePanelOrangeIndicator,
} from "./shared/runelite-side-panel-detector";
import { getSavedEndToEndConfig, setSavedEndToEndConfig } from "../csvOperator";
import {
  setEndToEndConfigActivePlayerName,
  setEndToEndGuideStepCompletion,
  type EndToEndSceneMouseCalibration,
  type EndToEndSceneMouseCalibrationFit,
  type EndToEndSceneMouseCalibrationSample,
} from "./end-to-end-config";

const BOT_NAME = "End To End";
const STEP_START_ID = `${END_TO_END_BOT_ID}:start`;
const STEP_RUNELITE_LOCAL_API_ID = `${END_TO_END_BOT_ID}:runelite-local-api`;
const STEP_SECTION_ONE_STEP_ONE_ID = `${END_TO_END_BOT_ID}:${SECTION_ONE_STEP_ONE_BOT_STEP_ID}`;
const STEP_SECTION_ONE_WALK_GENERAL_STORE_ID = `${END_TO_END_BOT_ID}:section-1-step-1-walk-general-store`;
const STEP_SECTION_ONE_STEP_TWO_ID = `${END_TO_END_BOT_ID}:section-1-step-2-start-x-marks-the-spot`;
const STEP_SECTION_ONE_STEP_TWO_QUEST_HELPER_ID = `${END_TO_END_BOT_ID}:section-1-step-2-quest-helper`;
const STEP_SECTION_ONE_WALK_X_MARKS_THE_SPOT_ID = `${END_TO_END_BOT_ID}:section-1-step-2-walk-x-marks-the-spot-start`;
const STEP_SECTION_ONE_STEP_TWO_DIALOGUE_ID = `${END_TO_END_BOT_ID}:section-1-step-2-veos-dialogue`;
const STEP_SECTION_ONE_STEP_TWO_MINIMAP_ARROW_ID = `${END_TO_END_BOT_ID}:section-1-step-2-follow-minimap-arrow`;
const STEP_SECTION_ONE_STEP_TWO_DIG_ID = `${END_TO_END_BOT_ID}:section-1-step-2-dig`;
const STEP_HISCORES_ID = `${END_TO_END_BOT_ID}:hiscores`;
const STEP_WIKISYNC_LOCAL_ID = `${END_TO_END_BOT_ID}:wikisync-local`;
const STEP_WIKISYNC_ID = `${END_TO_END_BOT_ID}:wikisync`;
const STEP_CACHE_MAP_ID = `${END_TO_END_BOT_ID}:cache-map`;
const STEP_DONE_ID = `${END_TO_END_BOT_ID}:done`;
const GAME_TICK_MS = 600;
const GENERAL_STORE_MAX_WALK_CLICKS = 10;
const GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX = 24;
const GENERAL_STORE_MOVE_TILE_PX_FALLBACK = 48;
const GENERAL_STORE_MOVE_TILE_PX_MIN = 24;
const GENERAL_STORE_MOVE_TILE_PX_MAX = 96;
const GENERAL_STORE_PLAYER_SPEED_TILES_PER_TICK = 2;
const GENERAL_STORE_BASE_EXTRA_WAIT_TICKS = 1;
const GENERAL_STORE_MIN_WAIT_TICKS = 2;
const GENERAL_STORE_MAX_WAIT_TICKS = 14;
const GENERAL_STORE_DIRECT_FALLBACK_MAX_TILE_DELTA = 8;
const GENERAL_STORE_MINIMAP_PLAYER_CENTER_RIGHT_OFFSET_LOGICAL = 122;
const GENERAL_STORE_MINIMAP_PLAYER_CENTER_Y_LOGICAL = 84;
const GENERAL_STORE_MINIMAP_PLAYER_CENTER_FROM_COMPASS_X_LOGICAL = 88;
const GENERAL_STORE_MINIMAP_PLAYER_CENTER_FROM_COMPASS_Y_LOGICAL = 35;
const GENERAL_STORE_MINIMAP_RADIUS_LOGICAL = 73;
const GENERAL_STORE_MINIMAP_TILE_PX_LOGICAL = 4;
const GENERAL_STORE_MINIMAP_MAX_CLICK_RADIUS_RATIO = 0.58;
const RUNELITE_OPEN_SIDE_PANEL_WIDTH_LOGICAL = 252;
const RUNELITE_INVENTORY_TAB_CENTER_X_LOGICAL = 134;
const RUNELITE_INVENTORY_TAB_CENTER_Y_LOGICAL = 21;
const GENERAL_STORE_SCENE_REFERENCE_SCALE_PERCENT = 125;
const GENERAL_STORE_SCENE_RIGHT_PANEL_WIDTH_LOGICAL = 245;
const GENERAL_STORE_SCENE_BOTTOM_UI_HEIGHT_LOGICAL = 170;
const GENERAL_STORE_SCENE_TOP_TILE_PX_AT_125 = 26;
const GENERAL_STORE_SCENE_BOTTOM_TILE_PX_AT_125 = 70;
const GENERAL_STORE_SCENE_ANCHOR_Y_RATIO = 0.56;
const GENERAL_STORE_SCENE_TOP_MODEL_Y_RATIO = 0.16;
const GENERAL_STORE_SCENE_BOTTOM_MODEL_Y_RATIO = 0.92;
const GENERAL_STORE_SCENE_MAX_HOVER_ATTEMPTS = 9;
const GENERAL_STORE_SCENE_ACCEPT_TILE_ERROR = 0;
const GENERAL_STORE_SCENE_FALLBACK_TILE_ERROR = 0;
const GENERAL_STORE_SCENE_LOCAL_FIT_MAX_TILE_ERROR = 6;
const GENERAL_STORE_SCENE_CORRECTION_JITTER_PX = 1;
const GENERAL_STORE_SCENE_TARGET_EDGE_MARGIN_PX_AT_125 = 90;
const GENERAL_STORE_MOUSE_COORDINATE_CROP_LEFT_AT_125_PX = 28;
const GENERAL_STORE_MOUSE_COORDINATE_CROP_TOP_AT_125_PX = 28;
const GENERAL_STORE_MOUSE_COORDINATE_CROP_WIDTH_AT_125_PX = 360;
const GENERAL_STORE_MOUSE_COORDINATE_CROP_HEIGHT_AT_125_PX = 240;
const GENERAL_STORE_MOUSE_HOVER_SETTLE_MIN_MS = 70;
const GENERAL_STORE_MOUSE_HOVER_SETTLE_MAX_MS = 145;
const GENERAL_STORE_MOUSE_MOVE_MIN_MS = 105;
const GENERAL_STORE_MOUSE_MOVE_MAX_MS = 520;
const GENERAL_STORE_MOUSE_MOVE_JITTER_PX = 1.4;
const GENERAL_STORE_MOUSE_MOVE_OVERSHOOT_CHANCE = 0.22;
const GENERAL_STORE_MOUSE_OCR_DEBUG_DIR = "test-image-debug";
const GENERAL_STORE_VISIBLE_PATH_CANDIDATE_COUNT = 5;
const GENERAL_STORE_VISIBLE_PATH_GROUP_MAX_COUNT = 4;
const GENERAL_STORE_WALK_TARGETING_MODE = `random-visible-top${GENERAL_STORE_VISIBLE_PATH_CANDIDATE_COUNT}`;
const GENERAL_STORE_SCENE_CALIBRATION_MIN_SAMPLES = 3;
const GENERAL_STORE_SCENE_CALIBRATION_GOOD_SAMPLES = 5;
const GENERAL_STORE_SCENE_CALIBRATION_MAX_SAMPLES = 64;
const GENERAL_STORE_SCENE_CALIBRATION_MAX_MEAN_ERROR_PX = 22;
const GENERAL_STORE_SCENE_CALIBRATION_MAX_ERROR_PX = 55;
const GENERAL_STORE_SCENE_CALIBRATION_MAX_CAPTURE_DELTA_PX = 24;
const GENERAL_STORE_SCENE_CALIBRATION_MAX_EXPECTED_TILE_ERROR = 10;
const GENERAL_STORE_SCENE_CALIBRATION_PROBE_COUNT = 5;
const GENERAL_STORE_SCENE_CALIBRATION_MAX_PROBES_PER_TILE = 7;
const GENERAL_STORE_SCENE_CALIBRATION_MICRO_OFFSET_PX_AT_125 = 7;
const GENERAL_STORE_NORTH_KEY_HOLD_MS = 220;
const GENERAL_STORE_CAMERA_SETTLE_MS = 180;
const GENERAL_STORE_MAX_COORDINATE_JUMP_TILES = 48;
const SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MIN_MS = 1100;
const SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MAX_MS = 2400;
const SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MIN_MS = 180;
const SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MAX_MS = 420;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MIN_MS = 170;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MAX_MS = 330;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPTION_ROW_HEIGHT_LOGICAL = 15;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_MIN_WIDTH_PX = 70;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_MIN_HEIGHT_PX = 45;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_MIN_CHANGED_PIXELS = 700;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_DIFF_THRESHOLD = 30;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_LEFT_PX = 300;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_RIGHT_PX = 180;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_TOP_PX = 300;
const SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_BOTTOM_PX = 190;
const SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MIN_MS = 420;
const SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MAX_MS = 1100;
const SECTION_ONE_STEP_ONE_EXAMINE_AFTER_WAIT_MIN_MS = 380;
const SECTION_ONE_STEP_ONE_EXAMINE_AFTER_WAIT_MAX_MS = 850;
const SECTION_ONE_STEP_ONE_NPC_TRADE_MOVE_MIN_MS = 650;
const SECTION_ONE_STEP_ONE_NPC_TRADE_MOVE_MAX_MS = 1500;
const SECTION_ONE_STEP_ONE_TRADE_AFTER_WAIT_MIN_MS = 700;
const SECTION_ONE_STEP_ONE_TRADE_AFTER_WAIT_MAX_MS = 1300;
const SECTION_ONE_STEP_ONE_SELL_AFTER_WAIT_MIN_MS = 320;
const SECTION_ONE_STEP_ONE_SELL_AFTER_WAIT_MAX_MS = 760;
const SECTION_ONE_STEP_ONE_CYAN_NPC_MIN_PIXELS = 120;
const SECTION_ONE_STEP_ONE_CYAN_NPC_MIN_WIDTH = 28;
const SECTION_ONE_STEP_ONE_CYAN_NPC_MIN_HEIGHT = 36;
const SECTION_ONE_STEP_ONE_CYAN_NPC_MAX_FILL_RATIO = 0.54;
const SECTION_ONE_STEP_ONE_NPC_TRADE_MAX_ATTEMPTS = 10;
const SECTION_ONE_STEP_ONE_SPADE_ICON_PATHS = ["test-images/icon/spade-shop.png", "test-images/icon/spade.png"];
const SECTION_ONE_STEP_ONE_SHOP_SPADE_MIN_SCORE = 0.94;
const SECTION_ONE_STEP_ONE_SHOP_SPADE_COARSE_STEP_PX = 2;
const SECTION_ONE_STEP_ONE_SHOP_SPADE_REFINE_RADIUS_PX = 2;
const SECTION_ONE_STEP_ONE_SHOP_SPADE_MAX_MATCHES = 5;
const SECTION_ONE_STEP_ONE_SHOP_SPADE_MOVE_MIN_MS = 650;
const SECTION_ONE_STEP_ONE_SHOP_SPADE_MOVE_MAX_MS = 1500;
const SECTION_ONE_STEP_ONE_SHOP_SPADE_AFTER_RIGHT_CLICK_MIN_MS = 190;
const SECTION_ONE_STEP_ONE_SHOP_SPADE_AFTER_RIGHT_CLICK_MAX_MS = 360;
const SECTION_ONE_STEP_ONE_SHOP_BUY_OPTION_MOVE_MIN_MS = 420;
const SECTION_ONE_STEP_ONE_SHOP_BUY_OPTION_MOVE_MAX_MS = 1100;
const SECTION_ONE_STEP_ONE_SHOP_BUY_AFTER_WAIT_MIN_MS = 450;
const SECTION_ONE_STEP_ONE_SHOP_BUY_AFTER_WAIT_MAX_MS = 900;
const SECTION_ONE_STEP_ONE_SHOP_SEARCH_LEFT_RATIO = 0.05;
const SECTION_ONE_STEP_ONE_SHOP_SEARCH_TOP_RATIO = 0.24;
const SECTION_ONE_STEP_ONE_SHOP_SEARCH_RIGHT_RATIO = 0.78;
const SECTION_ONE_STEP_ONE_SHOP_SEARCH_BOTTOM_RATIO = 0.68;
const SECTION_ONE_STEP_TWO_VEOS_TILE = { x: 3228, y: 3242, z: 0 } as const;
const SECTION_ONE_STEP_TWO_PUB_WEST_DOOR_TILE = { x: 3225, y: 3240, z: 0 } as const;
const SECTION_ONE_STEP_TWO_PUB_SOUTH_DOOR_TILE = { x: 3230, y: 3235, z: 0 } as const;
const SECTION_ONE_STEP_TWO_PUB_DOOR_OPEN_DISTANCE_TILES = 5;
const SECTION_ONE_STEP_TWO_PUB_INTERIOR_BOUNDS = { minX: 3226, maxX: 3233, minY: 3236, maxY: 3242, z: 0 } as const;
const SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_MOVE_MIN_MS = 420;
const SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_MOVE_MAX_MS = 980;
const SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_AFTER_CLICK_MIN_MS = 520;
const SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_AFTER_CLICK_MAX_MS = 980;
const SECTION_ONE_STEP_TWO_VEOS_HOVER_SETTLE_MIN_MS = 220;
const SECTION_ONE_STEP_TWO_VEOS_HOVER_SETTLE_MAX_MS = 420;
const SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MIN_MS = 360;
const SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MAX_MS = 920;
const SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MIN_MS = 650;
const SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MAX_MS = 1250;
const SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_ATTEMPTS = 5;
const SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_DELAY_MIN_MS = 90;
const SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_DELAY_MAX_MS = 170;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_TEXT_CLICKS = 100;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_MISSING_ATTEMPTS = 5;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_CLICK_MOVE_MIN_MS = 320;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_CLICK_MOVE_MAX_MS = 820;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_AFTER_CLICK_MIN_MS = 420;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_AFTER_CLICK_MAX_MS = 820;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MIN_PIXELS = 16;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MIN_WIDTH_PX = 10;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_PREFERRED_MIN_WIDTH_PX = 60;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_PREFERRED_MIN_PIXELS = 80;
const SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MAX_HEIGHT_PX = 26;
const SECTION_ONE_STEP_TWO_CHATBOX_BEIGE_MIN_BAND_HEIGHT_PX = 55;
const SECTION_ONE_STEP_TWO_CHATBOX_BEIGE_MIN_ROW_RATIO = 0.13;
const SECTION_ONE_STEP_TWO_CHATBOX_TEXT_TOP_RATIO = 0.32;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME = "X Marks the Spot";
const SECTION_ONE_STEP_TWO_QUEST_HELPER_ICON_TEMPLATE_PATH = "test-images/icon/Quest-helper-plugin.png";
const SECTION_ONE_STEP_TWO_QUEST_HELPER_MAGNIFYING_GLASS_TEMPLATE_PATH = "test-images/icon/runelite-magnifying-glass.png";
const SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_TEMPLATE_PATH = "test-images/icon/runelite-confirm-quest-chevron.png";
const SECTION_ONE_STEP_TWO_QUEST_ICON_TEMPLATE_PATH = "test-images/icon/quest-icon.png";
const SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_OPEN_TEMPLATE_PATH = "test-images/icon/runtelite-chevron-open.png";
const SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_CLOSE_TEMPLATE_PATH = "test-images/icon/runtelite-chevron-close.png";
const SECTION_ONE_STEP_TWO_QUEST_HELPER_ICON_MIN_SCORE = 0.9;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_MAGNIFYING_GLASS_MIN_SCORE = 0.9;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_MIN_SCORE = 0.9;
const SECTION_ONE_STEP_TWO_QUEST_ICON_MIN_SCORE = 0.9;
const SECTION_ONE_STEP_TWO_QUEST_ICON_CYAN_MAX_DISTANCE_PX = 42;
const SECTION_ONE_STEP_TWO_QUEST_ICON_NEAR_DISTANCE_TILES = 6;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_SEARCH_CLICK_RIGHT_OFFSET_PX = 18;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_TOP_GAP_PX = 8;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_MIN_ROI_HEIGHT_PX = 120;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_ROI_HEIGHT_RATIO = 0.12;
const SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_MIN_SCORE = 0.92;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_RIGHT_CONTOUR_WIDTH_PX = 120;
const SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_TOP_STRIP_HEIGHT_PX = 72;
const SECTION_ONE_STEP_TWO_RUNELITE_SIDE_PANEL_ORANGE_SEARCH_RIGHT_WIDTH_PX = 260;
const SECTION_ONE_STEP_TWO_RUNELITE_SIDE_PANEL_ORANGE_ICON_Y_MARGIN_PX = 22;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_MOVE_MIN_MS = 360;
const SECTION_ONE_STEP_TWO_QUEST_HELPER_MOVE_MAX_MS = 920;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_CLICKS = 8;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CAPTURE_ATTEMPTS = 16;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CAPTURE_DELAY_MIN_MS = 45;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CAPTURE_DELAY_MAX_MS = 90;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MIN_PIXELS = 8;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MIN_SIZE_PX = 3;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_SIZE_PX = 42;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CLUSTER_DISTANCE_PX = 18;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_STATIC_MAX_FRAME_RATIO = 0.88;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_SEARCH_RADIUS_RATIO = 1.55;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_ACCEPT_RADIUS_RATIO = 1.45;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MOVE_MIN_MS = 520;
const SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MOVE_MAX_MS = 1250;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_PIXELS = 18;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_SIZE_PX = 8;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MAX_SIZE_PX = 96;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_FILL_RATIO = 0.025;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MAX_FILL_RATIO = 0.7;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_ASPECT_RATIO = 0.45;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MAX_ASPECT_RATIO = 2.8;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MOVE_MIN_MS = 520;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_MOVE_MAX_MS = 1250;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_TILE_READ_ATTEMPTS = 7;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_TILE_READ_SETTLE_MIN_MS = 70;
const SECTION_ONE_STEP_TWO_SCENE_MARKER_TILE_READ_SETTLE_MAX_MS = 145;
const SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_ATTEMPTS = 10;
const SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_MIN_MS = 220;
const SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_MAX_MS = 480;
const SECTION_ONE_STEP_TWO_SPADE_ITEM_ID = 952;
const SECTION_ONE_STEP_TWO_DIG_INVENTORY_TAB_MOVE_MIN_MS = 420;
const SECTION_ONE_STEP_TWO_DIG_INVENTORY_TAB_MOVE_MAX_MS = 980;
const SECTION_ONE_STEP_TWO_DIG_AFTER_INVENTORY_TAB_MIN_MS = 180;
const SECTION_ONE_STEP_TWO_DIG_AFTER_INVENTORY_TAB_MAX_MS = 360;
const SECTION_ONE_STEP_TWO_DIG_AFTER_SPADE_CLICK_MIN_MS = 850;
const SECTION_ONE_STEP_TWO_DIG_AFTER_SPADE_CLICK_MAX_MS = 1600;
const SECTION_ONE_STEP_TWO_START_X_MARKS_CHECKLIST_STEP_ID = "ironman-guide-1.1-step-8-start-x-marks-the-spot";
const SECTION_ONE_STEP_TWO_WIKISYNC_POLL_ATTEMPTS = 8;
const SECTION_ONE_STEP_TWO_WIKISYNC_POLL_DELAY_MS = 2500;
const MOVEMENT_MODEL_LONG_DISTANCE_TILES = 10;
const MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES = 16;
const MOVEMENT_MODEL_TOP_SCREEN_DISTANCE_TILES = 8;
const MOVEMENT_MODEL_TOP_SCREEN_Y_RATIO = 0.38;
const MOVEMENT_MODEL_AXIS_DOMINANCE_DISTANCE_TILES = 10;
const MOVEMENT_MODEL_AXIS_DOMINANCE_RATIO = 0.82;
const MOVEMENT_MODEL_MAX_EXTRA_WAIT_TICKS = 3;

let runToken = 0;

function log(message: string): void {
  pushAutomateBotLog("info", `Automate Bot (${BOT_NAME}): ${message}`);
}

function warn(message: string): void {
  pushAutomateBotLog("warn", `Automate Bot (${BOT_NAME}): ${message}`);
}

function getConfiguredPlayerName(): string | undefined {
  const playerName = getSavedEndToEndConfig().playerName || process.env.OSRS_PLAYER_NAME?.trim();
  if (!playerName) {
    return undefined;
  }
  return playerName;
}

function activateEndToEndPlayerName(playerName: string, source: string): string | undefined {
  const config = getSavedEndToEndConfig();
  const next = setEndToEndConfigActivePlayerName(config, playerName);
  if (!next.playerName) {
    return undefined;
  }

  if (next.playerName !== config.playerName) {
    setSavedEndToEndConfig(next);
    log(`Checklist profile switched: player='${next.playerName}' source=${source}.`);
  } else if (next.completedGuideStepIds.length !== config.completedGuideStepIds.length) {
    setSavedEndToEndConfig(next);
  }

  return next.playerName;
}

function markEndToEndGuideStepComplete(stepId: string, reason: string, playerName: string | undefined): void {
  if (!playerName) {
    warn(`Checklist auto-complete skipped: step=${stepId} reason='${reason}' player=unknown.`);
    return;
  }

  const activePlayerName = activateEndToEndPlayerName(playerName, "auto-complete") ?? playerName;
  const config = getSavedEndToEndConfig();
  const next = setEndToEndGuideStepCompletion(config, stepId, true);
  if (next.completedGuideStepIds.includes(stepId) && config.completedGuideStepIds.includes(stepId)) {
    return;
  }

  setSavedEndToEndConfig(next);
  log(`Checklist auto-complete: player='${activePlayerName}' step=${stepId} reason=${reason}.`);
}

async function logHiscoresSnapshot(playerName: string): Promise<void> {
  const snapshot = await fetchOsrsHiscoresLite(playerName);
  log(`Hiscores loaded for '${snapshot.playerName}': ${formatOsrsHiscoresSkillSummary(snapshot)}.`);
}

async function logWikiSyncSnapshot(playerName: string): Promise<void> {
  const snapshot = await fetchOsrsWikiSyncSnapshot(playerName);
  log(`WikiSync loaded for '${snapshot.playerName}': ${formatOsrsWikiSyncSummary(snapshot)}.`);

  const earlyGameQuestNames = ["Cook's Assistant", "The Restless Ghost", "Rune Mysteries", "Doric's Quest"];
  const questsByName = new Map(snapshot.quests.map((quest) => [quest.name, quest]));
  const earlyGameSummary = earlyGameQuestNames
    .map((name) => `${name}=${questsByName.get(name)?.status ?? "missing"}`)
    .join("; ");
  log(`Early-game quest check: ${earlyGameSummary}.`);

  const checklist = await fetchEndToEndSectionOneChecklist();
  const progressEstimate = estimateEndToEndGuideQuestProgress(checklist, snapshot.quests);
  log(`Section 1.1 quest/checklist estimate: ${formatEndToEndGuideQuestProgressEstimate(progressEstimate)}.`);
  log("Section 1.1 estimate is quest-only; non-quest checklist steps still need manual or OCR/plugin validation.");
}

function getXMarksWikiSyncQuest(snapshot: OsrsWikiSyncSnapshot): OsrsWikiSyncQuest | null {
  return (
    snapshot.quests.find((quest) => quest.name.toLowerCase() === SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME.toLowerCase()) ??
    null
  );
}

function isXMarksWikiSyncQuestStartedOrCompleted(status: XMarksWikiSyncQuestState["status"] | null | undefined): boolean {
  return status === "started" || status === "completed";
}

function formatXMarksWikiSyncQuestState(state: XMarksWikiSyncQuestState): string {
  return `label='${state.label}' player='${state.snapshot.playerName}' quest='${SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME}' status=${state.status} code=${state.quest?.statusCode ?? "missing"} endpoint=${state.snapshot.endpoint}`;
}

async function readXMarksWikiSyncQuestState(playerName: string, label: string): Promise<XMarksWikiSyncQuestState> {
  const snapshot = await fetchOsrsWikiSyncSnapshot(playerName);
  const quest = getXMarksWikiSyncQuest(snapshot);
  return {
    snapshot,
    quest,
    status: quest?.status ?? "missing",
    label,
  };
}

async function logXMarksWikiSyncQuestState(
  playerName: string | undefined,
  label: string,
): Promise<XMarksWikiSyncQuestState | null> {
  if (!playerName) {
    log(`Section 1.1 Step 2 WikiSync quest state '${label}' skipped: player name unknown.`);
    return null;
  }

  const state = await readXMarksWikiSyncQuestState(playerName, label);
  log(`Section 1.1 Step 2 WikiSync quest state: ${formatXMarksWikiSyncQuestState(state)}.`);
  return state;
}

function markXMarksStartChecklistCompleteFromWikiSync(
  state: XMarksWikiSyncQuestState,
  playerName: string | undefined,
): void {
  if (!isXMarksWikiSyncQuestStartedOrCompleted(state.status)) {
    return;
  }

  markEndToEndGuideStepComplete(
    SECTION_ONE_STEP_TWO_START_X_MARKS_CHECKLIST_STEP_ID,
    `WikiSync ${SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME}=${state.status}`,
    playerName,
  );
}

async function pollXMarksWikiSyncQuestStarted(
  playerName: string | undefined,
  token: number,
  label: string,
): Promise<XMarksWikiSyncQuestState | null> {
  if (!playerName) {
    log(`Section 1.1 Step 2 WikiSync quest poll '${label}' skipped: player name unknown.`);
    return null;
  }

  let lastState: XMarksWikiSyncQuestState | null = null;
  for (
    let attempt = 1;
    attempt <= SECTION_ONE_STEP_TWO_WIKISYNC_POLL_ATTEMPTS && isCurrentRunActive(token);
    attempt += 1
  ) {
    try {
      const state = await readXMarksWikiSyncQuestState(playerName, `${label} attempt ${attempt}`);
      lastState = state;
      log(
        `Section 1.1 Step 2 WikiSync quest poll ${attempt}/${SECTION_ONE_STEP_TWO_WIKISYNC_POLL_ATTEMPTS}: ${formatXMarksWikiSyncQuestState(state)}.`,
      );
      if (isXMarksWikiSyncQuestStartedOrCompleted(state.status)) {
        markXMarksStartChecklistCompleteFromWikiSync(state, playerName);
        return state;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(
        `Section 1.1 Step 2 WikiSync quest poll ${attempt}/${SECTION_ONE_STEP_TWO_WIKISYNC_POLL_ATTEMPTS} failed: ${message}.`,
      );
    }

    if (attempt < SECTION_ONE_STEP_TWO_WIKISYNC_POLL_ATTEMPTS) {
      await sleepWithAbort(SECTION_ONE_STEP_TWO_WIKISYNC_POLL_DELAY_MS, () => isCurrentRunActive(token));
    }
  }

  if (lastState) {
    warn(
      `Section 1.1 Step 2 WikiSync did not confirm quest started after ${SECTION_ONE_STEP_TWO_WIKISYNC_POLL_ATTEMPTS} attempt(s): ${formatXMarksWikiSyncQuestState(lastState)}.`,
    );
  }
  return lastState;
}

async function logSectionOneChecklistExecutionPlan(): Promise<void> {
  const checklist = await fetchEndToEndSectionOneChecklist();
  const executionOrder = formatEndToEndGuideChecklistExecutionOrder(checklist.steps);
  const preview = executionOrder.length > 700 ? `${executionOrder.slice(0, 700)}... total=${checklist.steps.length}` : executionOrder;
  log(`Section 1.1 checklist execution order: ${preview}.`);
  log("Section 1.1 implemented executors: src4 is wired now; src8/src5/src6/src7/src9 are planned next and are not executed yet.");
}

function getPlayerNameFromWikiSyncLocalSnapshot(snapshot: OsrsWikiSyncLocalSnapshot): string | undefined {
  const name = snapshot.loadouts.find((loadout) => loadout.name?.trim())?.name?.trim();
  return name || undefined;
}

async function logWikiSyncLocalSnapshotAndActivatePlayer(currentPlayerName: string | undefined): Promise<string | undefined> {
  const wikiSyncLocalSnapshot = await fetchOsrsWikiSyncLocalSnapshot();
  log(`WikiSync local WebSocket loaded: ${formatOsrsWikiSyncLocalSummary(wikiSyncLocalSnapshot)}.`);

  const detectedPlayerName = getPlayerNameFromWikiSyncLocalSnapshot(wikiSyncLocalSnapshot);
  if (!detectedPlayerName) {
    return currentPlayerName;
  }

  const activePlayerName = activateEndToEndPlayerName(detectedPlayerName, "WikiSync local WebSocket");
  if (activePlayerName && activePlayerName !== currentPlayerName) {
    log(`Detected player name from WikiSync local WebSocket: '${activePlayerName}'.`);
  }

  return activePlayerName ?? currentPlayerName;
}

async function logRuneLiteLocalApiProbe(): Promise<RuneLiteLocalApiSnapshot> {
  const snapshot = await fetchRuneLiteLocalApiSnapshot();
  log(`RuneLite local HTTP API loaded: ${formatRuneLiteLocalApiSnapshot(snapshot)}.`);
  log(`RuneLite local HTTP API endpoints: ${formatRuneLiteLocalApiProbe(snapshot.probe)}.`);
  return snapshot;
}

type GeneralStoreClickPlan = {
  screenPoint: ScreenPoint;
  projectedScreenPoint: ScreenPoint;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  pathTiles: number;
  minimapCenter: ScreenPoint;
  minimapRadiusPx: number;
  minimapTilePx: number;
  effectiveMinimapTilePx: number;
  minimapTilePxScale: number;
  minimapRadiusRatio: number;
  projectionOffsetLocalX: number;
  projectionOffsetLocalY: number;
  minimapCalibrationSource: MinimapWorldClickCalibrationSource;
  maxClickDistancePx: number;
  wasVectorClamped: boolean;
  minimapSource: "inferred-from-compass" | "inferred-from-capture" | "inferred-from-runelite-side-panel";
  projectionSource: MinimapWorldProjectionSource;
  source: "path" | "direct-destination-anchor";
};

type GeneralStoreTile = {
  x: number;
  y: number;
  z: number;
};

type GeneralStoreSceneProjection = {
  sceneLeft: number;
  sceneTop: number;
  sceneRight: number;
  sceneBottom: number;
  anchorLocalX: number;
  anchorLocalY: number;
  topModelY: number;
  bottomModelY: number;
  topTilePx: number;
  bottomTilePx: number;
};

type GeneralStoreSceneTileProjection = {
  screenPoint: ScreenPoint;
  tilePx: number;
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  unclampedLocalX: number;
  unclampedLocalY: number;
  localX: number;
  localY: number;
  wasClamped: boolean;
  source: "rough-model" | "saved-3d-calibration";
  calibrationSampleCount: number | null;
  calibrationMeanErrorPx: number | null;
};

type GeneralStoreMouseCoordinateRead = {
  tile: GeneralStoreTile;
  line: string;
  cropBounds: { x: number; y: number; width: number; height: number };
  boxScreen: { x: number; y: number; width: number; height: number };
};

type GeneralStoreMouseCoordinateProbe = {
  read: GeneralStoreMouseCoordinateRead | null;
  cropBounds: { x: number; y: number; width: number; height: number };
  debugPath: string;
};

type GeneralStoreSceneHoverAttempt = {
  point: ScreenPoint;
  read: GeneralStoreMouseCoordinateRead | null;
  errorTiles: number | null;
  debugPath: string;
  cropBounds: { x: number; y: number; width: number; height: number };
};

type GeneralStoreSceneHoverObservation = {
  point: ScreenPoint;
  read: GeneralStoreMouseCoordinateRead;
  errorTiles: number;
};

type GeneralStoreSceneMouseCalibrationRememberResult = {
  saved: boolean;
  fit: EndToEndSceneMouseCalibrationFit | null;
  sampleCount: number;
  reason: string;
};

type GeneralStoreSceneClickPlan = {
  screenPoint: ScreenPoint;
  initialScreenPoint: ScreenPoint;
  anchorScreenPoint: ScreenPoint;
  requestedTargetTile: GeneralStoreTile;
  targetTile: GeneralStoreTile;
  hoveredTile: GeneralStoreTile;
  hoveredLine: string;
  hoverBoxScreen: { x: number; y: number; width: number; height: number };
  dxTiles: number;
  dyTiles: number;
  distanceTiles: number;
  pathTiles: number;
  tilePx: number;
  source: GeneralStoreClickPlan["source"];
  attempts: GeneralStoreSceneHoverAttempt[];
  finalErrorTiles: number;
  projection: GeneralStoreSceneProjection;
  projectionSource: GeneralStoreSceneTileProjection["source"];
  calibrationSampleCount: number | null;
  calibrationMeanErrorPx: number | null;
  clickReason: "requested-target" | "eligible-visible-path";
};

type QuestHelperClickSpace = {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  logicalBounds: RuneLiteWindowInfo | null;
  source: "runelite-window" | "screen-fallback";
};

type QuestHelperTemplateSet = {
  questHelperIcon: Awaited<ReturnType<typeof loadItemIconTemplate>>;
  magnifyingGlass: Awaited<ReturnType<typeof loadItemIconTemplate>>;
  confirmQuestChevron: Awaited<ReturnType<typeof loadItemIconTemplate>>;
  chevronOpen: Awaited<ReturnType<typeof loadItemIconTemplate>>;
  chevronClose: Awaited<ReturnType<typeof loadItemIconTemplate>>;
};

type QuestHelperCapture = {
  bitmap: ScreenBitmap;
  captureBounds: ScreenCaptureBounds;
  clickSpace: QuestHelperClickSpace;
  runeLiteBounds: RuneLiteWindowInfo | null;
};

type GeneralStoreWaypointSelection = {
  tile: GeneralStoreTile;
  pathTiles: number;
  source: GeneralStoreClickPlan["source"];
  reason: string;
  eligibleClickTiles: GeneralStoreTile[];
  groupIndex: number;
  groupCount: number;
};

type GeneralStoreTravelEstimate = {
  waitTicks: number;
  baseWaitTicks: number;
  travelTicks: number;
  distanceTiles: number;
  tilePx: number;
  dxPx: number;
  dyPx: number;
  movementExtraWaitTicks: number;
  movementReasons: string[];
};

type QuestHelperMinimapGeometry = ReturnType<typeof inferGeneralStoreMinimap>;

type QuestHelperMinimapArrowDetection = {
  selected: CyanBox | null;
  candidates: CyanBox[];
  all: CyanBox[];
  minimap: QuestHelperMinimapGeometry;
  roi: { x: number; y: number; width: number; height: number };
  debugPath: string;
  captureAttempt: number;
  source: "single-frame" | "temporal-burst";
  sampledFrames: number;
  selectedFrameCount: number;
};

type QuestHelperSceneMarkerDetection = {
  selected: CyanBox | null;
  candidates: CyanBox[];
  all: CyanBox[];
  roi: { x: number; y: number; width: number; height: number };
  debugPath: string;
};

type QuestHelperSearchQuestStatus = "started" | "not-started" | "completed" | "unknown";

type QuestHelperSearchQuestColorDetection = {
  status: QuestHelperSearchQuestStatus;
  roi: ItemIconSearchRoi;
  yellowPixels: number;
  beigePixels: number;
  whitePixels: number;
  greenPixels: number;
  redPixels: number;
  debugPath: string;
};

type XMarksWikiSyncQuestState = {
  snapshot: OsrsWikiSyncSnapshot;
  quest: OsrsWikiSyncQuest | null;
  status: OsrsWikiSyncQuestStatus | "missing";
  label: string;
};

let latestQuestHelperXMarksSearchStatus: QuestHelperSearchQuestStatus = "unknown";

function isCurrentRunActive(token: number): boolean {
  return token === runToken && AppState.automateBotRunning;
}

async function pressKeyForMs(key: string, holdMs: number, token: number): Promise<void> {
  const result = await holdRobotKey(key, holdMs, {
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!result.ok && result.error) {
    warn(`Robot keyboard hold failed: key=${key} error=${result.error}.`);
  }
}

function getFullScreenClickBounds(): { x: number; y: number; width: number; height: number } {
  const screenSize = typeof getScreenSize === "function" ? getScreenSize() : { width: 1920, height: 1080 };
  return {
    x: 0,
    y: 0,
    width: Math.max(1, Math.round(screenSize.width)),
    height: Math.max(1, Math.round(screenSize.height)),
  };
}

function normalizeRuneLiteBounds(
  bounds: { x?: number; y?: number; width?: number; height?: number } | null | undefined,
): RuneLiteWindowInfo | null {
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  if (
    !bounds ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function getRuneLiteWindowBoundsSnapshot(): RuneLiteWindowInfo | null {
  try {
    return normalizeRuneLiteBounds(findRuneLiteWindow()?.getBounds());
  } catch {
    return null;
  }
}

function formatScreenBounds(bounds: { width: number; height: number }): string {
  return `${bounds.width}x${bounds.height}`;
}

function formatRuneLiteBounds(bounds: RuneLiteWindowInfo | null): string {
  return bounds ? `${bounds.width}x${bounds.height}@${bounds.x},${bounds.y}` : "none";
}

let questHelperTemplatesPromise: Promise<QuestHelperTemplateSet> | null = null;
let xMarksQuestIconTemplatePromise: Promise<Awaited<ReturnType<typeof loadItemIconTemplate>>> | null = null;

function getRuneLiteDisplayScaleFactor(runeLiteBounds: RuneLiteWindowInfo): number {
  try {
    const display = electronScreen.getDisplayMatching({
      x: runeLiteBounds.x,
      y: runeLiteBounds.y,
      width: Math.max(1, runeLiteBounds.width),
      height: Math.max(1, runeLiteBounds.height),
    });
    const scaleFactor = Number(display.scaleFactor);
    return Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  } catch {
    return 1;
  }
}

function getQuestHelperClickSpace(
  runeLiteBounds: RuneLiteWindowInfo | null,
  screenBounds: { width: number; height: number },
): QuestHelperClickSpace {
  if (runeLiteBounds) {
    const scaleFactor = getRuneLiteDisplayScaleFactor(runeLiteBounds);
    return {
      x: Math.round(runeLiteBounds.x * scaleFactor),
      y: Math.round(runeLiteBounds.y * scaleFactor),
      width: Math.max(1, Math.round(runeLiteBounds.width * scaleFactor)),
      height: Math.max(1, Math.round(runeLiteBounds.height * scaleFactor)),
      scaleFactor,
      logicalBounds: runeLiteBounds,
      source: "runelite-window",
    };
  }

  return {
    x: 0,
    y: 0,
    width: screenBounds.width,
    height: screenBounds.height,
    scaleFactor: 1,
    logicalBounds: null,
    source: "screen-fallback",
  };
}

function toAbsoluteQuestHelperPoint(localPoint: ScreenPoint, clickSpace: Pick<QuestHelperClickSpace, "x" | "y">): ScreenPoint {
  return {
    x: clickSpace.x + localPoint.x,
    y: clickSpace.y + localPoint.y,
  };
}

function formatQuestHelperClickSpace(clickSpace: QuestHelperClickSpace): string {
  const logical = clickSpace.logicalBounds ? ` logical=${formatRuneLiteBounds(clickSpace.logicalBounds)}` : "";
  return `${clickSpace.source}:physical=${clickSpace.width}x${clickSpace.height}@${clickSpace.x},${clickSpace.y} scale=${clickSpace.scaleFactor}${logical}`;
}

function formatScreenPoint(point: ScreenPoint): string {
  return `${point.x},${point.y}`;
}

function loadQuestHelperTemplates(): Promise<QuestHelperTemplateSet> {
  questHelperTemplatesPromise ??= Promise.all([
    loadItemIconTemplate("quest-helper-plugin", SECTION_ONE_STEP_TWO_QUEST_HELPER_ICON_TEMPLATE_PATH),
    loadItemIconTemplate("quest-helper-magnifying-glass", SECTION_ONE_STEP_TWO_QUEST_HELPER_MAGNIFYING_GLASS_TEMPLATE_PATH),
    loadItemIconTemplate("quest-helper-confirm-chevron", SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_TEMPLATE_PATH),
    loadItemIconTemplate("runelite-chevron-open", SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_OPEN_TEMPLATE_PATH),
    loadItemIconTemplate("runelite-chevron-close", SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_CLOSE_TEMPLATE_PATH),
  ]).then(([questHelperIcon, magnifyingGlass, confirmQuestChevron, chevronOpen, chevronClose]) => ({
    questHelperIcon,
    magnifyingGlass,
    confirmQuestChevron,
    chevronOpen,
    chevronClose,
  }));

  return questHelperTemplatesPromise;
}

function loadXMarksQuestIconTemplate(): Promise<Awaited<ReturnType<typeof loadItemIconTemplate>>> {
  xMarksQuestIconTemplatePromise ??= loadItemIconTemplate("x-marks-quest-icon", SECTION_ONE_STEP_TWO_QUEST_ICON_TEMPLATE_PATH);
  return xMarksQuestIconTemplatePromise;
}

function captureQuestHelperRuneLite(clickSpace: QuestHelperClickSpace, runeLiteBounds: RuneLiteWindowInfo | null): QuestHelperCapture {
  const requestedBounds: ScreenCaptureBounds = {
    x: clickSpace.x,
    y: clickSpace.y,
    width: clickSpace.width,
    height: clickSpace.height,
  };
  const captureBounds = resolveScreenCaptureBounds(requestedBounds);
  return {
    bitmap: captureScreenBitmap(captureBounds),
    captureBounds,
    clickSpace,
    runeLiteBounds,
  };
}

function makeQuestHelperRightContourRoi(bitmap: ScreenBitmap): ItemIconSearchRoi {
  const width = Math.min(SECTION_ONE_STEP_TWO_QUEST_HELPER_RIGHT_CONTOUR_WIDTH_PX, bitmap.width);
  return {
    x: Math.max(0, bitmap.width - width),
    y: 0,
    width,
    height: bitmap.height,
  };
}

function makeRuneLiteChevronTopStripRoi(bitmap: ScreenBitmap): ItemIconSearchRoi {
  return {
    x: 0,
    y: 0,
    width: bitmap.width,
    height: Math.min(SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_TOP_STRIP_HEIGHT_PX, bitmap.height),
  };
}

function makeQuestHelperSearchIconRoi(bitmap: ScreenBitmap): ItemIconSearchRoi {
  const left = Math.floor(bitmap.width * 0.5);
  const bottom = Math.max(1, Math.floor(bitmap.height * 0.45));
  return {
    x: left,
    y: 0,
    width: Math.max(1, bitmap.width - left),
    height: bottom,
  };
}

function makeQuestHelperConfirmChevronRoi(bitmap: ScreenBitmap, searchMatch: ItemIconMatch | null): ItemIconSearchRoi {
  const fallbackLeft = Math.floor(bitmap.width * 0.5);
  const fallbackTop = Math.floor(bitmap.height * 0.18);
  const left = searchMatch ? clamp(searchMatch.centerX, 0, bitmap.width - 1) : fallbackLeft;
  const top = searchMatch
    ? clamp(searchMatch.y + searchMatch.height + SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_TOP_GAP_PX, 0, bitmap.height - 1)
    : fallbackTop;
  const height = Math.max(
    SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_MIN_ROI_HEIGHT_PX,
    Math.round(bitmap.height * SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_ROI_HEIGHT_RATIO),
  );
  const bottom = clamp(top + height - 1, top, bitmap.height - 1);

  return {
    x: left,
    y: top,
    width: Math.max(1, bitmap.width - left),
    height: bottom - top + 1,
  };
}

function makeQuestHelperSearchQuestTitleColorRoi(
  bitmap: ScreenBitmap,
  searchMatch: ItemIconMatch | null,
  confirmMatch: ItemIconMatch | null,
): ItemIconSearchRoi {
  const anchorY = confirmMatch?.centerY ?? (searchMatch ? searchMatch.centerY + Math.round(bitmap.height * 0.035) : Math.round(bitmap.height * 0.21));
  const top = clamp(anchorY - 18, 0, bitmap.height - 1);
  const bottom = clamp(anchorY + 18, top, bitmap.height - 1);
  const left = clamp(
    searchMatch ? searchMatch.x - 28 : confirmMatch ? confirmMatch.x - 310 : Math.round(bitmap.width * 0.78),
    0,
    bitmap.width - 1,
  );
  const right = clamp(confirmMatch ? confirmMatch.x - 10 : bitmap.width - 70, left, bitmap.width - 1);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left + 1),
    height: bottom - top + 1,
  };
}

function getScreenPointForCaptureMatch(match: ItemIconMatch, captureBounds: ScreenCaptureBounds): ScreenPoint {
  return {
    x: captureBounds.x + match.centerX,
    y: captureBounds.y + match.centerY,
  };
}

function getQuestHelperSearchClickPointFromMagnifyingGlass(
  match: ItemIconMatch,
  captureBounds: ScreenCaptureBounds,
): ScreenPoint {
  return {
    x: clamp(
      captureBounds.x + match.x + match.width + SECTION_ONE_STEP_TWO_QUEST_HELPER_SEARCH_CLICK_RIGHT_OFFSET_PX,
      captureBounds.x,
      captureBounds.x + captureBounds.width - 1,
    ),
    y: clamp(captureBounds.y + match.centerY, captureBounds.y, captureBounds.y + captureBounds.height - 1),
  };
}

function getQuestHelperLocalPointFromScreenPoint(point: ScreenPoint, clickSpace: Pick<QuestHelperClickSpace, "x" | "y">): ScreenPoint {
  return {
    x: point.x - clickSpace.x,
    y: point.y - clickSpace.y,
  };
}

async function saveQuestHelperTemplateDebug(
  capture: QuestHelperCapture,
  detection: ReturnType<typeof detectItemIconTemplate>,
  label: string,
  clickPoint?: ScreenPoint,
): Promise<string> {
  const debugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-quest-helper-${label}`);
  const localClickPoint = clickPoint
    ? {
        x: clickPoint.x - capture.captureBounds.x,
        y: clickPoint.y - capture.captureBounds.y,
      }
    : undefined;
  await saveBitmapWithItemIconTemplateDebug(capture.bitmap, detection, debugPath, {
    clickPoint: localClickPoint,
  });
  return debugPath;
}

async function findQuestHelperIconByTemplate(
  capture: QuestHelperCapture,
  templates: QuestHelperTemplateSet,
  label: string,
): Promise<{ match: ItemIconMatch | null; screenPoint: ScreenPoint | null; debugPath: string }> {
  const detection = detectItemIconTemplate(capture.bitmap, templates.questHelperIcon, {
    searchRoi: makeQuestHelperRightContourRoi(capture.bitmap),
    minScore: SECTION_ONE_STEP_TWO_QUEST_HELPER_ICON_MIN_SCORE,
    coarseStepPx: 1,
    refineRadiusPx: 1,
    maxMatches: 4,
  });
  const screenPoint = detection.bestMatch ? getScreenPointForCaptureMatch(detection.bestMatch, capture.captureBounds) : null;
  const debugPath = await saveQuestHelperTemplateDebug(capture, detection, `icon-${label}`, screenPoint ?? undefined);
  log(
    `Section 1.1 Step 2 Quest Helper icon template ${label}: ${formatItemIconTemplateDetection(detection)} screen=${screenPoint ? formatScreenPoint(screenPoint) : "none"} local=${screenPoint ? formatScreenPoint(getQuestHelperLocalPointFromScreenPoint(screenPoint, capture.clickSpace)) : "none"} clickSpace=${formatQuestHelperClickSpace(capture.clickSpace)} capture=${capture.captureBounds.width}x${capture.captureBounds.height}@${capture.captureBounds.x},${capture.captureBounds.y} debug=${debugPath}.`,
  );
  return { match: detection.bestMatch, screenPoint, debugPath };
}

function isRuneLiteSidePanelIndicatorAlignedWithIcon(
  indicator: RuneLiteSidePanelOrangeIndicator | null,
  iconMatch: ItemIconMatch | null,
): boolean {
  if (!indicator || !iconMatch) {
    return false;
  }

  const margin = SECTION_ONE_STEP_TWO_RUNELITE_SIDE_PANEL_ORANGE_ICON_Y_MARGIN_PX;
  const iconTop = iconMatch.y - margin;
  const iconBottom = iconMatch.y + iconMatch.height - 1 + margin;
  return indicator.centerY >= iconTop && indicator.centerY <= iconBottom;
}

async function detectRuneLiteQuestHelperSidePanelState(
  capture: QuestHelperCapture,
  label: string,
  iconMatch: ItemIconMatch | null,
): Promise<{
  fullPanelOpen: boolean;
  questHelperPanelOpen: boolean;
  indicator: RuneLiteSidePanelOrangeIndicator | null;
  debugPath: string;
}> {
  const detection = detectRuneLiteSidePanelOrangeIndicator(capture.bitmap, {
    rightSearchWidthPx: SECTION_ONE_STEP_TWO_RUNELITE_SIDE_PANEL_ORANGE_SEARCH_RIGHT_WIDTH_PX,
  });
  const questHelperPanelOpen = isRuneLiteSidePanelIndicatorAlignedWithIcon(detection.bestIndicator, iconMatch);
  const debugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-runelite-side-panel-orange-${label}`);
  await saveBitmapWithRuneLiteSidePanelOrangeDebug(capture.bitmap, detection, debugPath, {
    referenceBox: iconMatch,
  });

  log(
    `Section 1.1 Step 2 RuneLite side panel orange ${label}: fullOpen=${detection.bestIndicator ? "yes" : "no"} questHelperOpen=${questHelperPanelOpen ? "yes" : "no"} icon=${iconMatch ? `${iconMatch.centerX},${iconMatch.centerY} ${iconMatch.width}x${iconMatch.height}` : "none"} ${formatRuneLiteSidePanelOrangeDetection(detection)} debug=${debugPath}.`,
  );

  return {
    fullPanelOpen: Boolean(detection.bestIndicator),
    questHelperPanelOpen,
    indicator: detection.bestIndicator,
    debugPath,
  };
}

async function findRuneLiteTopChevronByTemplate(
  capture: QuestHelperCapture,
  templates: QuestHelperTemplateSet,
  label: string,
): Promise<{ kind: "open" | "close" | null; match: ItemIconMatch | null; screenPoint: ScreenPoint | null; debugPaths: string[] }> {
  const searchRoi = makeRuneLiteChevronTopStripRoi(capture.bitmap);
  const openDetection = detectItemIconTemplate(capture.bitmap, templates.chevronOpen, {
    searchRoi,
    minScore: SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_MIN_SCORE,
    coarseStepPx: 1,
    refineRadiusPx: 1,
    maxMatches: 2,
  });
  const closeDetection = detectItemIconTemplate(capture.bitmap, templates.chevronClose, {
    searchRoi,
    minScore: SECTION_ONE_STEP_TWO_RUNELITE_CHEVRON_MIN_SCORE,
    coarseStepPx: 1,
    refineRadiusPx: 1,
    maxMatches: 2,
  });
  const openScore = openDetection.bestMatch?.score ?? 0;
  const closeScore = closeDetection.bestMatch?.score ?? 0;
  const kind = openScore >= closeScore && openDetection.bestMatch ? "open" : closeDetection.bestMatch ? "close" : null;
  const match = kind === "open" ? openDetection.bestMatch : kind === "close" ? closeDetection.bestMatch : null;
  const screenPoint = match ? getScreenPointForCaptureMatch(match, capture.captureBounds) : null;
  const openDebugPath = await saveQuestHelperTemplateDebug(
    capture,
    openDetection,
    `chevron-open-${label}`,
    kind === "open" && screenPoint ? screenPoint : undefined,
  );
  const closeDebugPath = await saveQuestHelperTemplateDebug(
    capture,
    closeDetection,
    `chevron-close-${label}`,
    kind === "close" && screenPoint ? screenPoint : undefined,
  );
  log(
    `Section 1.1 Step 2 RuneLite chevron template ${label}: picked=${kind ?? "none"} pickedScreen=${screenPoint ? formatScreenPoint(screenPoint) : "none"} pickedLocal=${screenPoint ? formatScreenPoint(getQuestHelperLocalPointFromScreenPoint(screenPoint, capture.clickSpace)) : "none"} open=${formatItemIconTemplateDetection(openDetection)} close=${formatItemIconTemplateDetection(closeDetection)} clickSpace=${formatQuestHelperClickSpace(capture.clickSpace)} debug=${openDebugPath}|${closeDebugPath}.`,
  );

  return { kind, match, screenPoint, debugPaths: [openDebugPath, closeDebugPath] };
}

async function findQuestHelperSearchPointByMagnifyingGlass(
  capture: QuestHelperCapture,
  templates: QuestHelperTemplateSet,
  label: string,
): Promise<{ match: ItemIconMatch | null; screenPoint: ScreenPoint | null; debugPath: string }> {
  const detection = detectItemIconTemplate(capture.bitmap, templates.magnifyingGlass, {
    searchRoi: makeQuestHelperSearchIconRoi(capture.bitmap),
    minScore: SECTION_ONE_STEP_TWO_QUEST_HELPER_MAGNIFYING_GLASS_MIN_SCORE,
    coarseStepPx: 1,
    refineRadiusPx: 1,
    maxMatches: 4,
  });
  const screenPoint = detection.bestMatch
    ? getQuestHelperSearchClickPointFromMagnifyingGlass(detection.bestMatch, capture.captureBounds)
    : null;
  const debugPath = await saveQuestHelperTemplateDebug(capture, detection, `magnifying-glass-${label}`, screenPoint ?? undefined);
  log(
    `Section 1.1 Step 2 Quest Helper search magnifying glass ${label}: ${formatItemIconTemplateDetection(detection)} clickScreen=${screenPoint ? formatScreenPoint(screenPoint) : "none"} clickLocal=${screenPoint ? formatScreenPoint(getQuestHelperLocalPointFromScreenPoint(screenPoint, capture.clickSpace)) : "none"} rightOffset=${SECTION_ONE_STEP_TWO_QUEST_HELPER_SEARCH_CLICK_RIGHT_OFFSET_PX}px clickSpace=${formatQuestHelperClickSpace(capture.clickSpace)} debug=${debugPath}.`,
  );
  return { match: detection.bestMatch, screenPoint, debugPath };
}

async function findQuestHelperConfirmChevronByTemplate(
  capture: QuestHelperCapture,
  templates: QuestHelperTemplateSet,
  label: string,
  searchMatch: ItemIconMatch | null,
): Promise<{ match: ItemIconMatch | null; screenPoint: ScreenPoint | null; debugPath: string }> {
  const detection = detectItemIconTemplate(capture.bitmap, templates.confirmQuestChevron, {
    searchRoi: makeQuestHelperConfirmChevronRoi(capture.bitmap, searchMatch),
    minScore: SECTION_ONE_STEP_TWO_QUEST_HELPER_CONFIRM_CHEVRON_MIN_SCORE,
    coarseStepPx: 1,
    refineRadiusPx: 1,
    maxMatches: 8,
  });
  const selectedMatch =
    detection.matches
      .slice()
      .sort((left, right) => left.centerY - right.centerY || right.score - left.score || right.centerX - left.centerX)[0] ??
    null;
  const selectedDetection = { ...detection, bestMatch: selectedMatch };
  const screenPoint = selectedMatch ? getScreenPointForCaptureMatch(selectedMatch, capture.captureBounds) : null;
  const debugPath = await saveQuestHelperTemplateDebug(
    capture,
    selectedDetection,
    `confirm-chevron-${label}`,
    screenPoint ?? undefined,
  );
  log(
    `Section 1.1 Step 2 Quest Helper confirm chevron ${label}: ${formatItemIconTemplateDetection(selectedDetection)} clickScreen=${screenPoint ? formatScreenPoint(screenPoint) : "none"} clickLocal=${screenPoint ? formatScreenPoint(getQuestHelperLocalPointFromScreenPoint(screenPoint, capture.clickSpace)) : "none"} searchRef=${searchMatch ? `${searchMatch.centerX},${searchMatch.centerY}` : "none"} clickSpace=${formatQuestHelperClickSpace(capture.clickSpace)} debug=${debugPath}.`,
  );
  return { match: selectedMatch, screenPoint, debugPath };
}

function isQuestHelperStartedQuestTextPixel(r: number, g: number, b: number): boolean {
  const brightYellow = r >= 205 && g >= 150 && b <= 105 && r >= g && g >= b + 45;
  const beigeYellow = r >= 125 && g >= 95 && b >= 50 && r >= g + 8 && g >= b + 18 && r >= b + 45;
  return brightYellow || beigeYellow;
}

function isQuestHelperWhiteQuestTextPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r >= 165 && g >= 165 && b >= 165 && max - min <= 55;
}

function isQuestHelperGreenQuestTextPixel(r: number, g: number, b: number): boolean {
  return g >= 150 && g >= r + 45 && g >= b + 35;
}

function isQuestHelperRedQuestTextPixel(r: number, g: number, b: number): boolean {
  return r >= 150 && r >= g + 45 && r >= b + 45;
}

function classifyQuestHelperSearchQuestColor(
  yellowPixels: number,
  beigePixels: number,
  whitePixels: number,
  greenPixels: number,
  redPixels: number,
): QuestHelperSearchQuestStatus {
  const startedPixels = yellowPixels + beigePixels;
  if (greenPixels >= 18 && greenPixels >= startedPixels && greenPixels >= whitePixels) {
    return "completed";
  }
  if (startedPixels >= 18 && startedPixels >= whitePixels * 1.35) {
    return "started";
  }
  if (whitePixels >= 18 && whitePixels >= startedPixels * 1.15) {
    return "not-started";
  }
  if (redPixels >= 18 && startedPixels < 12 && whitePixels < 12) {
    return "not-started";
  }
  return "unknown";
}

async function detectQuestHelperSearchQuestColorStatus(
  capture: QuestHelperCapture,
  searchMatch: ItemIconMatch | null,
  confirmMatch: ItemIconMatch | null,
  label: string,
): Promise<QuestHelperSearchQuestColorDetection> {
  const roi = makeQuestHelperSearchQuestTitleColorRoi(capture.bitmap, searchMatch, confirmMatch);
  let yellowPixels = 0;
  let beigePixels = 0;
  let whitePixels = 0;
  let greenPixels = 0;
  let redPixels = 0;

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = y * capture.bitmap.byteWidth + x * capture.bitmap.bytesPerPixel;
      const b = capture.bitmap.image[offset];
      const g = capture.bitmap.image[offset + 1];
      const r = capture.bitmap.image[offset + 2];

      const isBrightYellow = r >= 205 && g >= 150 && b <= 105 && r >= g && g >= b + 45;
      if (isBrightYellow) {
        yellowPixels += 1;
      } else if (isQuestHelperStartedQuestTextPixel(r, g, b)) {
        beigePixels += 1;
      }
      if (isQuestHelperWhiteQuestTextPixel(r, g, b)) {
        whitePixels += 1;
      }
      if (isQuestHelperGreenQuestTextPixel(r, g, b)) {
        greenPixels += 1;
      }
      if (isQuestHelperRedQuestTextPixel(r, g, b)) {
        redPixels += 1;
      }
    }
  }

  const status = classifyQuestHelperSearchQuestColor(yellowPixels, beigePixels, whitePixels, greenPixels, redPixels);
  const debugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-quest-helper-quest-title-color-${label}`);
  const debugDetection: ItemIconTemplateDetection = {
    template: "quest-helper-quest-title-color",
    searchRoi: roi,
    minScore: 0,
    bestMatch: null,
    matches: [],
  };
  await saveBitmapWithItemIconTemplateDebug(capture.bitmap, debugDetection, debugPath, {
    menuBoxes: [roi],
  });

  log(
    `Section 1.1 Step 2 Quest Helper quest title color ${label}: status=${status} yellow=${yellowPixels} beige=${beigePixels} white=${whitePixels} green=${greenPixels} red=${redPixels} roi=${roi.x},${roi.y},${roi.width}x${roi.height} searchRef=${searchMatch ? `${searchMatch.centerX},${searchMatch.centerY}` : "none"} confirmRef=${confirmMatch ? `${confirmMatch.centerX},${confirmMatch.centerY}` : "none"} file=${debugPath}.`,
  );

  return {
    status,
    roi,
    yellowPixels,
    beigePixels,
    whitePixels,
    greenPixels,
    redPixels,
    debugPath,
  };
}

function isQuestHelperSearchQuestStartedOrCompleted(status: QuestHelperSearchQuestStatus): boolean {
  return status === "started" || status === "completed";
}

function hasRuneLiteBoundsChanged(a: RuneLiteWindowInfo | null, b: RuneLiteWindowInfo | null): boolean {
  if (!a || !b) {
    return a !== b;
  }

  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
}

function logQuestHelperResizeCheck(
  label: string,
  previousBounds: RuneLiteWindowInfo | null,
  options: { expected?: boolean } = {},
): RuneLiteWindowInfo | null {
  const currentBounds = getRuneLiteWindowBoundsSnapshot();
  if (hasRuneLiteBoundsChanged(previousBounds, currentBounds)) {
    const message = `Section 1.1 Step 2 Quest Helper RuneLite resize ${options.expected ? "observed" : "detected"} during ${label}: previous=${formatRuneLiteBounds(previousBounds)} current=${formatRuneLiteBounds(currentBounds)}.`;
    if (options.expected) {
      log(message);
    } else {
      warn(message);
    }
  } else {
    log(`Section 1.1 Step 2 Quest Helper RuneLite resize check ${label}: bounds=${formatRuneLiteBounds(currentBounds)}.`);
  }
  return currentBounds;
}

async function clickAbsoluteScreenPointHumanLike(
  point: ScreenPoint,
  label: string,
  token: number,
  options: { minDurationMs?: number; maxDurationMs?: number; afterClickMinMs?: number; afterClickMaxMs?: number } = {},
): Promise<ScreenPoint | null> {
  if (!isCurrentRunActive(token)) {
    return null;
  }

  const bounds = getFullScreenClickBounds();
  if (point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height) {
    warn(
      `Section 1.1 Step 2 Quest Helper click '${label}' skipped: point=${point.x},${point.y} is outside screen ${bounds.width}x${bounds.height}.`,
    );
    return null;
  }

  const movedPoint = await moveMouseHumanLike(point.x, point.y, bounds, {
    safeEdgeMarginPx: 0,
    minDurationMs: options.minDurationMs ?? SECTION_ONE_STEP_TWO_QUEST_HELPER_MOVE_MIN_MS,
    maxDurationMs: options.maxDurationMs ?? SECTION_ONE_STEP_TWO_QUEST_HELPER_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 34,
    jitterPx: 1.5,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return null;
  }

  const clickedPoint = clickScreenPoint(point.x, point.y, bounds, {
    settleMs: randomIntInclusive(105, 260),
    safeEdgeMarginPx: 0,
  });
  log(
    `Section 1.1 Step 2 Quest Helper click '${label}': target=${point.x},${point.y} moved=${movedPoint.x},${movedPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} screen=${bounds.width}x${bounds.height}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(options.afterClickMinMs ?? 220, options.afterClickMaxMs ?? 520),
    () => isCurrentRunActive(token),
  );
  return clickedPoint;
}

async function clearQuestHelperSearchField(token: number): Promise<boolean> {
  const result = await clearFocusedTextWithCtrlA({
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (result.ok) {
    log("Section 1.1 Step 2 Quest Helper search field cleared with Ctrl+A then Backspace.");
    return true;
  }

  warn(`Section 1.1 Step 2 Quest Helper search clear failed: ${result.error ?? "bot stopped"}.`);
  return false;
}

async function turnCameraNorth(token: number): Promise<void> {
  log(`Section 1.1 Step 1 camera prep: hold N for ${GENERAL_STORE_NORTH_KEY_HOLD_MS}ms.`);
  await pressKeyForMs("n", GENERAL_STORE_NORTH_KEY_HOLD_MS, token);
  await sleepWithAbort(GENERAL_STORE_CAMERA_SETTLE_MS + randomIntInclusive(0, 120), () => isCurrentRunActive(token));
}

async function activateQuestHelperForXMarksTheSpot(token: number): Promise<boolean> {
  latestQuestHelperXMarksSearchStatus = "unknown";
  if (!isCurrentRunActive(token)) {
    return false;
  }

  focusRuneLiteWindowForAutomation();
  const templates = await loadQuestHelperTemplates();
  const screenBounds = getFullScreenClickBounds();
  const initialRuneLiteBounds = getRuneLiteWindowBoundsSnapshot();
  let clickSpace = getQuestHelperClickSpace(initialRuneLiteBounds, screenBounds);
  let capture = captureQuestHelperRuneLite(clickSpace, initialRuneLiteBounds);
  log(
    `Section 1.1 Step 2 Quest Helper activation: quest='${SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME}' RuneLite=${formatRuneLiteBounds(initialRuneLiteBounds)} clickSpace=${formatQuestHelperClickSpace(clickSpace)}.`,
  );

  let currentBounds: RuneLiteWindowInfo | null = initialRuneLiteBounds;
  let iconProbe = await findQuestHelperIconByTemplate(capture, templates, "initial");
  if (!iconProbe.screenPoint) {
    const chevronProbe = await findRuneLiteTopChevronByTemplate(capture, templates, "initial-no-icon");
    if (!chevronProbe.screenPoint || !chevronProbe.kind) {
      warn("Section 1.1 Step 2 Quest Helper activation stopped: Quest Helper icon and RuneLite sidebar chevron were not found by template matching.");
      return false;
    }

    const chevronClicked = await clickAbsoluteScreenPointHumanLike(
      chevronProbe.screenPoint,
      `runelite-chevron-${chevronProbe.kind}`,
      token,
      {
        afterClickMinMs: 520,
        afterClickMaxMs: 980,
      },
    );
    if (!chevronClicked) {
      return false;
    }

    currentBounds = logQuestHelperResizeCheck(`after chevron ${chevronProbe.kind} click`, initialRuneLiteBounds, {
      expected: true,
    });
    clickSpace = getQuestHelperClickSpace(currentBounds ?? initialRuneLiteBounds, screenBounds);
    capture = captureQuestHelperRuneLite(clickSpace, currentBounds ?? initialRuneLiteBounds);
    iconProbe = await findQuestHelperIconByTemplate(capture, templates, `after-chevron-${chevronProbe.kind}`);
    if (!iconProbe.screenPoint) {
      warn(
        `Section 1.1 Step 2 Quest Helper activation stopped: Quest Helper icon still not found after clicking ${chevronProbe.kind} chevron.`,
      );
      return false;
    }
  }

  let panelState = await detectRuneLiteQuestHelperSidePanelState(capture, "initial", iconProbe.match);
  if (panelState.questHelperPanelOpen) {
    log("Section 1.1 Step 2 Quest Helper activation: orange active-tab indicator is already aligned with Quest Helper; skipping Quest Helper icon click.");
  } else {
    const iconClicked = await clickAbsoluteScreenPointHumanLike(iconProbe.screenPoint, "quest-helper-icon-template", token, {
      afterClickMinMs: 520,
      afterClickMaxMs: 980,
    });
    if (!iconClicked) {
      return false;
    }

    currentBounds = logQuestHelperResizeCheck("after icon click", capture.runeLiteBounds ?? currentBounds, {
      expected: true,
    });
    clickSpace = getQuestHelperClickSpace(currentBounds ?? initialRuneLiteBounds, screenBounds);
    capture = captureQuestHelperRuneLite(clickSpace, currentBounds ?? initialRuneLiteBounds);
    iconProbe = await findQuestHelperIconByTemplate(capture, templates, "after-icon-click");
    panelState = await detectRuneLiteQuestHelperSidePanelState(capture, "after-icon-click", iconProbe.match);
  }

  if (!panelState.questHelperPanelOpen && panelState.fullPanelOpen && iconProbe.screenPoint) {
    log(
      `Section 1.1 Step 2 Quest Helper activation: orange side panel is open but not aligned with Quest Helper icon; retrying Quest Helper icon selection once.`,
    );
    const retryIconClicked = await clickAbsoluteScreenPointHumanLike(iconProbe.screenPoint, "quest-helper-icon-template-retry", token, {
      afterClickMinMs: 520,
      afterClickMaxMs: 980,
    });
    if (!retryIconClicked) {
      return false;
    }

    currentBounds = logQuestHelperResizeCheck("after icon retry click", capture.runeLiteBounds ?? currentBounds);
    clickSpace = getQuestHelperClickSpace(currentBounds ?? initialRuneLiteBounds, screenBounds);
    capture = captureQuestHelperRuneLite(clickSpace, currentBounds ?? initialRuneLiteBounds);
    iconProbe = await findQuestHelperIconByTemplate(capture, templates, "after-icon-retry");
    panelState = await detectRuneLiteQuestHelperSidePanelState(capture, "after-icon-retry", iconProbe.match);
  }

  if (!panelState.questHelperPanelOpen && !panelState.fullPanelOpen) {
    const chevronProbe = await findRuneLiteTopChevronByTemplate(capture, templates, "after-icon-no-orange");
    if (!chevronProbe.screenPoint || !chevronProbe.kind) {
      warn("Section 1.1 Step 2 Quest Helper activation stopped: side panel orange indicator was not found and RuneLite sidebar chevron was not found.");
      return false;
    }

    const chevronClicked = await clickAbsoluteScreenPointHumanLike(
      chevronProbe.screenPoint,
      `runelite-side-panel-chevron-${chevronProbe.kind}`,
      token,
      {
        afterClickMinMs: 520,
        afterClickMaxMs: 980,
      },
    );
    if (!chevronClicked) {
      return false;
    }

    currentBounds = logQuestHelperResizeCheck(`after side panel chevron ${chevronProbe.kind} click`, currentBounds, {
      expected: true,
    });
    clickSpace = getQuestHelperClickSpace(currentBounds ?? initialRuneLiteBounds, screenBounds);
    capture = captureQuestHelperRuneLite(clickSpace, currentBounds ?? initialRuneLiteBounds);
    iconProbe = await findQuestHelperIconByTemplate(capture, templates, `after-side-panel-chevron-${chevronProbe.kind}`);
    panelState = await detectRuneLiteQuestHelperSidePanelState(capture, `after-side-panel-chevron-${chevronProbe.kind}`, iconProbe.match);
  }

  if (!panelState.questHelperPanelOpen || !iconProbe.screenPoint) {
    warn(
      `Section 1.1 Step 2 Quest Helper activation stopped: Quest Helper side panel was not confirmed by orange indicator. fullOpen=${panelState.fullPanelOpen ? "yes" : "no"} indicator=${panelState.indicator ? `${panelState.indicator.centerX},${panelState.indicator.centerY}` : "none"} icon=${iconProbe.match ? `${iconProbe.match.centerX},${iconProbe.match.centerY}` : "none"} debug=${panelState.debugPath}.`,
    );
    return false;
  }

  const iconLocalPoint = getQuestHelperLocalPointFromScreenPoint(iconProbe.screenPoint, clickSpace);
  log(
    `Section 1.1 Step 2 Quest Helper side panel confirmed: indicator=${panelState.indicator ? `${panelState.indicator.centerX},${panelState.indicator.centerY}` : "none"} iconLocal=${formatScreenPoint(iconLocalPoint)}.`,
  );

  const boundsAfterPanelReady = currentBounds ?? initialRuneLiteBounds;
  const searchProbe = await findQuestHelperSearchPointByMagnifyingGlass(capture, templates, "side-panel-confirmed");
  if (!searchProbe.screenPoint) {
    warn("Section 1.1 Step 2 Quest Helper activation stopped: search magnifying glass was not found by template matching.");
    return false;
  }

  const searchScreenPoint = searchProbe.screenPoint;
  const searchLocalPoint = getQuestHelperLocalPointFromScreenPoint(searchScreenPoint, clickSpace);
  const searchClicked = await clickAbsoluteScreenPointHumanLike(searchScreenPoint, "quest-helper-search-magnifying-glass-offset", token, {
    afterClickMinMs: 180,
    afterClickMaxMs: 360,
  });
  if (!searchClicked) {
    return false;
  }
  const boundsAfterSearch = logQuestHelperResizeCheck("after search click", boundsAfterPanelReady);
  clickSpace = getQuestHelperClickSpace(boundsAfterSearch ?? boundsAfterPanelReady, screenBounds);

  if (!isRobotKeyboardInputAvailable()) {
    warn("Section 1.1 Step 2 Quest Helper activation stopped: RobotJS keyboard input is unavailable.");
    return false;
  }

  if (!(await clearQuestHelperSearchField(token))) {
    warn("Section 1.1 Step 2 Quest Helper activation stopped: search field could not be cleared.");
    return false;
  }

  const typingCpm = randomIntInclusive(430, 620);
  const typingResult = typeRobotTextDelayed(SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME, typingCpm);
  if (!typingResult.ok) {
    warn(`Section 1.1 Step 2 Quest Helper activation stopped: typing quest search failed: ${typingResult.error}.`);
    return false;
  }
  log(
    `Section 1.1 Step 2 Quest Helper activation: typed quest search '${SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME}' cpm=${typingCpm}.`,
  );
  await sleepWithAbort(randomIntInclusive(420, 760), () => isCurrentRunActive(token));
  if (!isCurrentRunActive(token)) {
    return false;
  }
  const boundsAfterTyping = logQuestHelperResizeCheck("after quest search typing", boundsAfterSearch ?? boundsAfterPanelReady);
  clickSpace = getQuestHelperClickSpace(boundsAfterTyping ?? boundsAfterSearch ?? boundsAfterPanelReady, screenBounds);
  capture = captureQuestHelperRuneLite(clickSpace, boundsAfterTyping ?? boundsAfterSearch ?? boundsAfterPanelReady);

  const typedSearchProbe = await findQuestHelperSearchPointByMagnifyingGlass(capture, templates, "after-search-typing-reference");
  const confirmChevronProbe = await findQuestHelperConfirmChevronByTemplate(
    capture,
    templates,
    "after-search-typing",
    typedSearchProbe.match ?? searchProbe.match,
  );
  if (!confirmChevronProbe.screenPoint) {
    warn("Section 1.1 Step 2 Quest Helper activation stopped: confirm quest chevron was not found by template matching after typing the quest search.");
    return false;
  }
  const questColorDetection = await detectQuestHelperSearchQuestColorStatus(
    capture,
    typedSearchProbe.match ?? searchProbe.match,
    confirmChevronProbe.match,
    "after-search-typing",
  );
  latestQuestHelperXMarksSearchStatus = questColorDetection.status;

  const activateScreenPoint = confirmChevronProbe.screenPoint;
  const activateLocalPoint = getQuestHelperLocalPointFromScreenPoint(activateScreenPoint, clickSpace);
  log(
    `Section 1.1 Step 2 Quest Helper activate target: confirmChevronLocal=${formatScreenPoint(activateLocalPoint)} screen=${formatScreenPoint(activateScreenPoint)} clickSpace=${formatQuestHelperClickSpace(clickSpace)}.`,
  );

  const activateClicked = await clickAbsoluteScreenPointHumanLike(activateScreenPoint, "quest-helper-confirm-chevron", token, {
    afterClickMinMs: 520,
    afterClickMaxMs: 960,
  });
  if (!activateClicked) {
    return false;
  }
  logQuestHelperResizeCheck("after activate click", boundsAfterTyping ?? boundsAfterSearch ?? boundsAfterPanelReady);
  log(
    `Section 1.1 Step 2 Quest Helper activation complete: quest='${SECTION_ONE_STEP_TWO_QUEST_HELPER_QUEST_NAME}' iconLocal=${formatScreenPoint(iconLocalPoint)} iconScreen=${formatScreenPoint(iconProbe.screenPoint)} searchLocal=${formatScreenPoint(searchLocalPoint)} searchScreen=${formatScreenPoint(searchScreenPoint)} confirmChevronLocal=${formatScreenPoint(activateLocalPoint)} activateScreen=${formatScreenPoint(activateScreenPoint)}.`,
  );
  return true;
}

function limitGeneralStoreFallbackWaypoint(playerTile: GeneralStoreTile, targetTile: GeneralStoreTile): GeneralStoreTile {
  const dx = targetTile.x - playerTile.x;
  const dy = targetTile.y - playerTile.y;
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  if (distance <= GENERAL_STORE_DIRECT_FALLBACK_MAX_TILE_DELTA) {
    return targetTile;
  }

  const scale = GENERAL_STORE_DIRECT_FALLBACK_MAX_TILE_DELTA / Math.max(1, distance);
  let stepX = Math.round(dx * scale);
  let stepY = Math.round(dy * scale);
  if (stepX === 0 && dx !== 0) {
    stepX = dx > 0 ? 1 : -1;
  }
  if (stepY === 0 && dy !== 0) {
    stepY = dy > 0 ? 1 : -1;
  }

  return {
    x: playerTile.x + stepX,
    y: playerTile.y + stepY,
    z: playerTile.z,
  };
}

function getScaleFromCalibration(calibration: StartupPlayerTileCalibration): number {
  const scale = calibration.windowsScalePercent / 100;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getCurrentScaleRelativeTo125(calibration: StartupPlayerTileCalibration): number {
  const scale = calibration.windowsScalePercent / GENERAL_STORE_SCENE_REFERENCE_SCALE_PERCENT;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getGeneralStoreSceneTargetEdgeMarginPx(calibration: StartupPlayerTileCalibration): number {
  return Math.max(
    GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    Math.round(GENERAL_STORE_SCENE_TARGET_EDGE_MARGIN_PX_AT_125 * getCurrentScaleRelativeTo125(calibration)),
  );
}

function tileDistance(a: Pick<GeneralStoreTile, "x" | "y">, b: Pick<GeneralStoreTile, "x" | "y">): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function formatGeneralStoreTile(tile: Pick<GeneralStoreTile, "x" | "y" | "z">): string {
  return `${tile.x},${tile.y},${tile.z}`;
}

function isTileInsideLumbridgePub(tile: Pick<GeneralStoreTile, "x" | "y" | "z"> | null | undefined): boolean {
  if (!tile || tile.z !== SECTION_ONE_STEP_TWO_PUB_INTERIOR_BOUNDS.z) {
    return false;
  }

  return (
    tile.x >= SECTION_ONE_STEP_TWO_PUB_INTERIOR_BOUNDS.minX &&
    tile.x <= SECTION_ONE_STEP_TWO_PUB_INTERIOR_BOUNDS.maxX &&
    tile.y >= SECTION_ONE_STEP_TWO_PUB_INTERIOR_BOUNDS.minY &&
    tile.y <= SECTION_ONE_STEP_TWO_PUB_INTERIOR_BOUNDS.maxY
  );
}

function isLumbridgePubWestDoorTile(tile: Pick<GeneralStoreTile, "x" | "y" | "z">): boolean {
  return (
    tile.x === SECTION_ONE_STEP_TWO_PUB_WEST_DOOR_TILE.x &&
    tile.y === SECTION_ONE_STEP_TWO_PUB_WEST_DOOR_TILE.y &&
    tile.z === SECTION_ONE_STEP_TWO_PUB_WEST_DOOR_TILE.z
  );
}

function isLumbridgePubSouthDoorTile(tile: Pick<GeneralStoreTile, "x" | "y" | "z">): boolean {
  return (
    tile.x === SECTION_ONE_STEP_TWO_PUB_SOUTH_DOOR_TILE.x &&
    tile.y === SECTION_ONE_STEP_TWO_PUB_SOUTH_DOOR_TILE.y &&
    tile.z === SECTION_ONE_STEP_TWO_PUB_SOUTH_DOOR_TILE.z
  );
}

function isLumbridgePubDoorTile(tile: Pick<GeneralStoreTile, "x" | "y" | "z">): boolean {
  return isLumbridgePubWestDoorTile(tile) || isLumbridgePubSouthDoorTile(tile);
}

function formatLumbridgePubDoorName(tile: Pick<GeneralStoreTile, "x" | "y" | "z">): string {
  return isLumbridgePubSouthDoorTile(tile) ? "south" : "west";
}

type LumbridgePubDoorInteractionCandidate = {
  tile: GeneralStoreTile;
  source: string;
};

function addLumbridgePubDoorCandidate(
  candidates: LumbridgePubDoorInteractionCandidate[],
  tile: Pick<GeneralStoreTile, "x" | "y" | "z"> | null | undefined,
  source: string,
): void {
  if (!tile || candidates.some((candidate) => isSameGeneralStoreTile(candidate.tile, tile))) {
    return;
  }

  candidates.push({
    tile: { x: tile.x, y: tile.y, z: tile.z },
    source,
  });
}

function getLumbridgePubDoorEdgeAdjacentTile(doorTile: GeneralStoreTile): GeneralStoreTile | null {
  if (isLumbridgePubWestDoorTile(doorTile)) {
    // Cache object: Door id=1535 type=0 orientation=2, edge between 3225,3240 and 3226,3240.
    return { x: doorTile.x + 1, y: doorTile.y, z: doorTile.z };
  }

  if (isLumbridgePubSouthDoorTile(doorTile)) {
    // Cache object: Door id=56376 type=0 orientation=1, edge between 3230,3235 and 3230,3236.
    return { x: doorTile.x, y: doorTile.y + 1, z: doorTile.z };
  }

  return null;
}

function getLumbridgePubDoorInteractionCandidates(
  doorTile: GeneralStoreTile,
  route: EndToEndGeneralStoreRoutePlan,
): LumbridgePubDoorInteractionCandidate[] {
  const candidates: LumbridgePubDoorInteractionCandidate[] = [];
  addLumbridgePubDoorCandidate(candidates, getLumbridgePubDoorEdgeAdjacentTile(doorTile), "cache-edge-adjacent");
  addLumbridgePubDoorCandidate(candidates, doorTile, "cache-object-anchor");

  const routeDoorIndex = route.pathTiles.findIndex((tile) => isSameGeneralStoreTile(tile, doorTile));
  if (routeDoorIndex >= 0) {
    addLumbridgePubDoorCandidate(candidates, route.pathTiles[routeDoorIndex - 1], "route-before-door");
    addLumbridgePubDoorCandidate(candidates, route.pathTiles[routeDoorIndex + 1], "route-after-door");
  }

  return candidates.filter((candidate) => tileDistance(candidate.tile, doorTile) <= 1);
}

type KnownMovementEnvironmentStatus = "ready" | "changed" | "unavailable";

function toGeneralStoreTile(tile: Pick<GeneralStoreTile, "x" | "y" | "z">): GeneralStoreTile {
  return { x: tile.x, y: tile.y, z: tile.z };
}

function buildLumbridgePubDoorEnvironmentRoute(
  playerTile: GeneralStoreTile,
  doorTile: GeneralStoreTile,
): EndToEndGeneralStoreRoutePlan {
  const pathTiles: GeneralStoreTile[] = [playerTile];
  const edgeAdjacent = getLumbridgePubDoorEdgeAdjacentTile(doorTile);
  if (edgeAdjacent && !isSameGeneralStoreTile(edgeAdjacent, playerTile)) {
    pathTiles.push(edgeAdjacent);
  }
  if (!pathTiles.some((tile) => isSameGeneralStoreTile(tile, doorTile))) {
    pathTiles.push(doorTile);
  }

  const distanceToDoor = tileDistance(playerTile, doorTile);
  const pathLength = Math.max(0, pathTiles.length - 1);
  return {
    status: "ready",
    playerTile,
    destinationLabel: `Lumbridge pub ${formatLumbridgePubDoorName(doorTile)} door`,
    destinationTile: doorTile,
    storeTile: doorTile,
    targetTile: doorTile,
    nextWaypoint: doorTile,
    targetMode: "x-marks-the-spot-start",
    pathTiles,
    directDistanceToStoreTiles: distanceToDoor,
    directDistanceToTargetTiles: distanceToDoor,
    nextWaypointPathLength: pathLength,
    pathLength,
  };
}

function getLumbridgePubDoorChecksForMovement(
  playerTile: GeneralStoreTile,
  route: EndToEndGeneralStoreRoutePlan | null,
  assumeLeavingLumbridgePub: boolean,
): Array<{ doorTile: GeneralStoreTile; route: EndToEndGeneralStoreRoutePlan; reason: string }> {
  const insidePub = isTileInsideLumbridgePub(playerTile);
  const pathDoor = route?.pathTiles.find(isLumbridgePubDoorTile) ?? null;
  if (pathDoor) {
    const doorTile = toGeneralStoreTile(pathDoor);
    if (insidePub || tileDistance(playerTile, doorTile) <= SECTION_ONE_STEP_TWO_PUB_DOOR_OPEN_DISTANCE_TILES) {
      return [
        {
          doorTile,
          route: route ?? buildLumbridgePubDoorEnvironmentRoute(playerTile, doorTile),
          reason: insidePub ? "route-leaves-known-interior" : "route-crosses-near-door",
        },
      ];
    }
  }

  if (!insidePub || !assumeLeavingLumbridgePub) {
    return [];
  }

  return [SECTION_ONE_STEP_TWO_PUB_WEST_DOOR_TILE, SECTION_ONE_STEP_TWO_PUB_SOUTH_DOOR_TILE]
    .map((doorTile) => toGeneralStoreTile(doorTile))
    .sort((a, b) => tileDistance(playerTile, a) - tileDistance(playerTile, b))
    .map((doorTile) => ({
      doorTile,
      route: buildLumbridgePubDoorEnvironmentRoute(playerTile, doorTile),
      reason: "inside-known-interior-before-indirect-navigation",
    }));
}

async function prepareKnownEnvironmentForMovement(
  calibration: StartupPlayerTileCalibration,
  route: EndToEndGeneralStoreRoutePlan | null,
  token: number,
  contextLabel: string,
  options: { assumeLeavingLumbridgePub?: boolean } = {},
): Promise<KnownMovementEnvironmentStatus> {
  if (!calibration.playerTile) {
    warn(`${contextLabel} environment check unavailable: player tile was not detected.`);
    return "unavailable";
  }

  const playerTile = toGeneralStoreTile(calibration.playerTile);
  const insidePub = isTileInsideLumbridgePub(playerTile);
  const assumeLeavingLumbridgePub = options.assumeLeavingLumbridgePub ?? false;
  const pathDoor = route?.pathTiles.find(isLumbridgePubDoorTile) ?? null;
  const checks = getLumbridgePubDoorChecksForMovement(playerTile, route, assumeLeavingLumbridgePub);

  if (insidePub || pathDoor || assumeLeavingLumbridgePub) {
    log(
      `${contextLabel} environment check: player=${formatGeneralStoreTile(playerTile)} insideLumbridgePub=${insidePub ? "yes" : "no"} pathDoor=${pathDoor ? `${formatLumbridgePubDoorName(pathDoor)}:${formatGeneralStoreTile(pathDoor)}` : "none"} assumeLeavingPub=${assumeLeavingLumbridgePub ? "yes" : "no"} checks=${checks.map((check) => `${formatLumbridgePubDoorName(check.doorTile)}:${formatGeneralStoreTile(check.doorTile)}/${check.reason}`).join("|") || "none"}.`,
    );
  }

  if (checks.length === 0) {
    return "ready";
  }

  for (const check of checks) {
    await ensureGeneralStoreSceneMouseCalibration(calibration, check.route, token);
    if (!isCurrentRunActive(token)) {
      return "unavailable";
    }

    const doorStatus = await ensureLumbridgePubDoorOpen(calibration, check.route, check.doorTile, token);
    if (!isCurrentRunActive(token)) {
      return "unavailable";
    }

    if (doorStatus === "opened") {
      log(
        `${contextLabel} environment changed: opened ${formatLumbridgePubDoorName(check.doorTile)} Lumbridge pub door before movement. player=${formatGeneralStoreTile(playerTile)} door=${formatGeneralStoreTile(check.doorTile)} reason=${check.reason}.`,
      );
      return "changed";
    }

    if (doorStatus === "already-open") {
      log(
        `${contextLabel} environment ready: ${formatLumbridgePubDoorName(check.doorTile)} Lumbridge pub door is already passable. player=${formatGeneralStoreTile(playerTile)} door=${formatGeneralStoreTile(check.doorTile)} reason=${check.reason}.`,
      );
      return "ready";
    }
  }

  warn(
    `${contextLabel} environment check failed: none of the known Lumbridge pub door candidates could be confirmed passable/opened. player=${formatGeneralStoreTile(playerTile)} checks=${checks.map((check) => `${formatLumbridgePubDoorName(check.doorTile)}:${formatGeneralStoreTile(check.doorTile)}/${check.reason}`).join("|")}.`,
  );
  return "unavailable";
}

function inferGeneralStoreSceneProjection(calibration: StartupPlayerTileCalibration): GeneralStoreSceneProjection {
  const scale = getScaleFromCalibration(calibration);
  const sceneRightPanelWidth = Math.round(GENERAL_STORE_SCENE_RIGHT_PANEL_WIDTH_LOGICAL * scale);
  const sceneBottomUiHeight = Math.round(GENERAL_STORE_SCENE_BOTTOM_UI_HEIGHT_LOGICAL * scale);
  const sceneLeft = 0;
  const sceneTop = 0;
  const sceneRight = Math.max(
    Math.round(calibration.captureBounds.width * 0.58),
    calibration.captureBounds.width - sceneRightPanelWidth,
  );
  const sceneBottom = Math.max(
    Math.round(calibration.captureBounds.height * 0.58),
    calibration.captureBounds.height - sceneBottomUiHeight,
  );
  const sceneWidth = Math.max(1, sceneRight - sceneLeft);
  const sceneHeight = Math.max(1, sceneBottom - sceneTop);

  return {
    sceneLeft,
    sceneTop,
    sceneRight,
    sceneBottom,
    anchorLocalX: sceneLeft + Math.round(sceneWidth * 0.5),
    anchorLocalY: sceneTop + Math.round(sceneHeight * GENERAL_STORE_SCENE_ANCHOR_Y_RATIO),
    topModelY: sceneTop + Math.round(sceneHeight * GENERAL_STORE_SCENE_TOP_MODEL_Y_RATIO),
    bottomModelY: sceneTop + Math.round(sceneHeight * GENERAL_STORE_SCENE_BOTTOM_MODEL_Y_RATIO),
    topTilePx: Math.round(GENERAL_STORE_SCENE_TOP_TILE_PX_AT_125 * getCurrentScaleRelativeTo125(calibration)),
    bottomTilePx: Math.round(GENERAL_STORE_SCENE_BOTTOM_TILE_PX_AT_125 * getCurrentScaleRelativeTo125(calibration)),
  };
}

function getGeneralStoreSceneTilePxAtY(projection: GeneralStoreSceneProjection, localY: number): number {
  const modelHeight = Math.max(1, projection.bottomModelY - projection.topModelY);
  const ratio = clamp((localY - projection.topModelY) / modelHeight, 0, 1);
  return projection.topTilePx + (projection.bottomTilePx - projection.topTilePx) * ratio;
}

function projectGeneralStoreSceneTilePoint(
  calibration: StartupPlayerTileCalibration,
  projection: GeneralStoreSceneProjection,
  tile: GeneralStoreTile,
  safeEdgeMarginPx: number = GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
): GeneralStoreSceneTileProjection | null {
  const playerTile = calibration.playerTile;
  if (!playerTile) {
    return null;
  }

  const dxTiles = tile.x - playerTile.x;
  const dyTiles = tile.y - playerTile.y;
  const distanceTiles = tileDistance(playerTile, tile);
  let localY = projection.anchorLocalY;
  const yDirection = dyTiles >= 0 ? -1 : 1;
  for (let step = 0; step < Math.abs(dyTiles); step += 1) {
    localY += yDirection * getGeneralStoreSceneTilePxAtY(projection, localY);
  }

  const xTilePx = getGeneralStoreSceneTilePxAtY(projection, (projection.anchorLocalY + localY) / 2);
  const localX = projection.anchorLocalX + dxTiles * xTilePx;
  const roundedLocalX = Math.round(localX);
  const roundedLocalY = Math.round(localY);
  const safeLocalX = clamp(
    roundedLocalX,
    projection.sceneLeft + safeEdgeMarginPx,
    projection.sceneRight - safeEdgeMarginPx,
  );
  const safeLocalY = clamp(
    roundedLocalY,
    projection.sceneTop + safeEdgeMarginPx,
    projection.sceneBottom - safeEdgeMarginPx,
  );

  return {
    screenPoint: {
      x: calibration.captureBounds.x + safeLocalX,
      y: calibration.captureBounds.y + safeLocalY,
    },
    tilePx: getGeneralStoreSceneTilePxAtY(projection, safeLocalY),
    dxTiles,
    dyTiles,
    distanceTiles,
    unclampedLocalX: roundedLocalX,
    unclampedLocalY: roundedLocalY,
    localX: safeLocalX,
    localY: safeLocalY,
    wasClamped: safeLocalX !== roundedLocalX || safeLocalY !== roundedLocalY,
    source: "rough-model",
    calibrationSampleCount: null,
    calibrationMeanErrorPx: null,
  };
}

function fitSceneMouseCalibrationSamples(
  samples: EndToEndSceneMouseCalibrationSample[],
): EndToEndSceneMouseCalibrationFit | null {
  return fitSharedSceneMouseCalibrationSamples(samples);
}

function isSceneMouseCalibrationWindowCompatible(
  calibration: StartupPlayerTileCalibration,
  sceneCalibration: EndToEndSceneMouseCalibration | null,
): sceneCalibration is EndToEndSceneMouseCalibration {
  return (
    !!sceneCalibration &&
    sceneCalibration.windowsScalePercent === calibration.windowsScalePercent &&
    Math.abs(sceneCalibration.captureWidth - calibration.captureBounds.width) <=
      GENERAL_STORE_SCENE_CALIBRATION_MAX_CAPTURE_DELTA_PX &&
    Math.abs(sceneCalibration.captureHeight - calibration.captureBounds.height) <=
      GENERAL_STORE_SCENE_CALIBRATION_MAX_CAPTURE_DELTA_PX
  );
}

function isSceneMouseCalibrationFitAcceptable(fit: EndToEndSceneMouseCalibrationFit | null): fit is EndToEndSceneMouseCalibrationFit {
  return isSharedSceneMouseCalibrationFitAcceptable(fit);
}

function getCompatibleSceneMouseCalibration(
  calibration: StartupPlayerTileCalibration,
): EndToEndSceneMouseCalibration | null {
  return getCompatibleSavedSceneMouseCalibration(calibration);
}

function projectGeneralStoreSceneTilePointWithCalibration(
  calibration: StartupPlayerTileCalibration,
  projection: GeneralStoreSceneProjection,
  tile: GeneralStoreTile,
  safeEdgeMarginPx: number = GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
): GeneralStoreSceneTileProjection | null {
  const playerTile = calibration.playerTile;
  const sceneCalibration = getCompatibleSceneMouseCalibration(calibration);
  if (!playerTile || !sceneCalibration?.fit) {
    return projectGeneralStoreSceneTilePoint(calibration, projection, tile, safeEdgeMarginPx);
  }

  const dxTiles = tile.x - playerTile.x;
  const dyTiles = tile.y - playerTile.y;
  const fit = sceneCalibration.fit;
  const projected = projectSharedSceneMouseCalibrationLocalPoint(fit, dxTiles, dyTiles);
  if (!projected || !Number.isFinite(projected.localX) || !Number.isFinite(projected.localY)) {
    return projectGeneralStoreSceneTilePoint(calibration, projection, tile, safeEdgeMarginPx);
  }

  const roundedLocalX = Math.round(projected.localX);
  const roundedLocalY = Math.round(projected.localY);
  const safeLocalX = clamp(
    roundedLocalX,
    projection.sceneLeft + safeEdgeMarginPx,
    projection.sceneRight - safeEdgeMarginPx,
  );
  const safeLocalY = clamp(
    roundedLocalY,
    projection.sceneTop + safeEdgeMarginPx,
    projection.sceneBottom - safeEdgeMarginPx,
  );

  return {
    screenPoint: {
      x: calibration.captureBounds.x + safeLocalX,
      y: calibration.captureBounds.y + safeLocalY,
    },
    tilePx: getGeneralStoreSceneTilePxAtY(projection, safeLocalY),
    dxTiles,
    dyTiles,
    distanceTiles: tileDistance(playerTile, tile),
    unclampedLocalX: roundedLocalX,
    unclampedLocalY: roundedLocalY,
    localX: safeLocalX,
    localY: safeLocalY,
    wasClamped: safeLocalX !== roundedLocalX || safeLocalY !== roundedLocalY,
    source: "saved-3d-calibration",
    calibrationSampleCount: projected.sampleCount,
    calibrationMeanErrorPx: projected.meanErrorPx,
  };
}

function projectGeneralStoreScenePointFromFit(
  calibration: StartupPlayerTileCalibration,
  projection: GeneralStoreSceneProjection,
  tile: GeneralStoreTile,
  fit: EndToEndSceneMouseCalibrationFit,
  safeEdgeMarginPx: number = GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
): ScreenPoint | null {
  const playerTile = calibration.playerTile;
  if (!playerTile) {
    return null;
  }

  const dxTiles = tile.x - playerTile.x;
  const dyTiles = tile.y - playerTile.y;
  const projected = projectSharedSceneMouseCalibrationLocalPoint(fit, dxTiles, dyTiles);
  if (!projected || !Number.isFinite(projected.localX) || !Number.isFinite(projected.localY)) {
    return null;
  }
  const localX = Math.round(projected.localX);
  const localY = Math.round(projected.localY);

  if (
    localX < projection.sceneLeft + safeEdgeMarginPx ||
    localX > projection.sceneRight - safeEdgeMarginPx ||
    localY < projection.sceneTop + safeEdgeMarginPx ||
    localY > projection.sceneBottom - safeEdgeMarginPx
  ) {
    return null;
  }

  return {
    x: calibration.captureBounds.x + localX,
    y: calibration.captureBounds.y + localY,
  };
}

function rememberGeneralStoreSceneMouseCalibrationSample(
  calibration: StartupPlayerTileCalibration,
  point: ScreenPoint,
  read: GeneralStoreMouseCoordinateRead,
  expectedTile: GeneralStoreTile,
  source: string,
): GeneralStoreSceneMouseCalibrationRememberResult {
  const playerTile = calibration.playerTile;
  if (!playerTile || read.tile.z !== playerTile.z) {
    return { saved: false, fit: null, sampleCount: 0, reason: "plane-mismatch" };
  }

  const expectedError = tileDistance(read.tile, expectedTile);
  if (expectedError > GENERAL_STORE_SCENE_CALIBRATION_MAX_EXPECTED_TILE_ERROR) {
    return { saved: false, fit: null, sampleCount: 0, reason: `too-far:${expectedError}` };
  }

  const projection = inferGeneralStoreSceneProjection(calibration);
  const localX = Math.round(point.x - calibration.captureBounds.x);
  const localY = Math.round(point.y - calibration.captureBounds.y);
  if (
    localX < projection.sceneLeft + GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX ||
    localX > projection.sceneRight - GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX ||
    localY < projection.sceneTop + GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX ||
    localY > projection.sceneBottom - GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX
  ) {
    return { saved: false, fit: null, sampleCount: 0, reason: "outside-scene" };
  }

  const sample: EndToEndSceneMouseCalibrationSample = {
    localX,
    localY,
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

  const config = getSavedEndToEndConfig();
  const existingCalibration =
    isSceneMouseCalibrationWindowCompatible(calibration, config.sceneMouseCalibration) &&
    (!config.sceneMouseCalibration.fit || isSceneMouseCalibrationFitAcceptable(config.sceneMouseCalibration.fit))
      ? config.sceneMouseCalibration
      : null;
  const samples = [...(existingCalibration?.samples ?? []), sample].slice(-GENERAL_STORE_SCENE_CALIBRATION_MAX_SAMPLES);
  const fit = fitSceneMouseCalibrationSamples(samples);
  saveSharedSceneMouseCalibration(calibration, samples, fit);

  return {
    saved: true,
    fit,
    sampleCount: samples.length,
    reason: fit ? "fit-ready" : `need-${Math.max(0, GENERAL_STORE_SCENE_CALIBRATION_MIN_SAMPLES - samples.length)}-more-sample(s)`,
  };
}

function selectGeneralStoreWaypointAttempts(
  calibration: StartupPlayerTileCalibration,
  route: EndToEndGeneralStoreRoutePlan,
): GeneralStoreWaypointSelection[] {
  if (route.status === "ready" && route.pathTiles.length > 1) {
    const projection = inferGeneralStoreSceneProjection(calibration);
    const visibleCandidates: Array<{ index: number; tile: GeneralStoreTile; projected: GeneralStoreSceneTileProjection }> = [];
    const targetEdgeMarginPx = getGeneralStoreSceneTargetEdgeMarginPx(calibration);
    for (let index = route.pathTiles.length - 1; index >= 1; index -= 1) {
      const tile = route.pathTiles[index];
      const projected = projectGeneralStoreSceneTilePointWithCalibration(calibration, projection, tile, targetEdgeMarginPx);
      if (!projected || projected.wasClamped) {
        continue;
      }

      visibleCandidates.push({ index, tile, projected });
      if (visibleCandidates.length >= GENERAL_STORE_VISIBLE_PATH_CANDIDATE_COUNT * GENERAL_STORE_VISIBLE_PATH_GROUP_MAX_COUNT) {
        break;
      }
    }

    const attempts: GeneralStoreWaypointSelection[] = [];
    for (
      let groupStart = 0;
      groupStart < visibleCandidates.length && attempts.length < GENERAL_STORE_VISIBLE_PATH_GROUP_MAX_COUNT;
      groupStart += GENERAL_STORE_VISIBLE_PATH_CANDIDATE_COUNT
    ) {
      const group = visibleCandidates.slice(groupStart, groupStart + GENERAL_STORE_VISIBLE_PATH_CANDIDATE_COUNT);
      if (group.length === 0) {
        continue;
      }

      const selectedRank = randomIntInclusive(0, group.length - 1);
      const selected = group[selectedRank];
      const topCandidates = group
        .map((candidate) => `#${candidate.index}:${candidate.tile.x},${candidate.tile.y},${candidate.tile.z}`)
        .join("|");
      attempts.push({
        tile: selected.tile,
        pathTiles: selected.index,
        source: "path",
        reason: `random-visible-group${attempts.length + 1} size=${group.length} rank=${selectedRank + 1}/${group.length} projection=${selected.projected.source} fitSamples=${selected.projected.calibrationSampleCount ?? 0} fitMeanPx=${selected.projected.calibrationMeanErrorPx?.toFixed(1) ?? "n/a"} edgeMargin=${targetEdgeMarginPx}px step=${selected.index}/${route.pathTiles.length - 1} candidates=${topCandidates}`,
        eligibleClickTiles: group.map((candidate) => candidate.tile),
        groupIndex: attempts.length,
        groupCount: Math.ceil(visibleCandidates.length / GENERAL_STORE_VISIBLE_PATH_CANDIDATE_COUNT),
      });
    }

    if (attempts.length > 0) {
      return attempts;
    }

    const fallbackIndex = Math.min(route.pathTiles.length - 1, Math.max(1, route.nextWaypointPathLength));
    return [{
      tile: route.pathTiles[fallbackIndex],
      pathTiles: fallbackIndex,
      source: "path",
      reason: `no-visible-scene-path-tile fallback-step=${fallbackIndex}`,
      eligibleClickTiles: [route.pathTiles[fallbackIndex]],
      groupIndex: 0,
      groupCount: 1,
    }];
  }

  if (route.storeTile && calibration.playerTile) {
    const tile = limitGeneralStoreFallbackWaypoint(calibration.playerTile, route.storeTile);
    return [{
      tile,
      pathTiles: Math.max(
        Math.abs(route.storeTile.x - calibration.playerTile.x),
        Math.abs(route.storeTile.y - calibration.playerTile.y),
      ),
      source: "direct-destination-anchor",
      reason: "direct-destination-anchor-fallback",
      eligibleClickTiles: [tile],
      groupIndex: 0,
      groupCount: 1,
    }];
  }

  return [];
}

function selectGeneralStoreWaypoint(
  calibration: StartupPlayerTileCalibration,
  route: EndToEndGeneralStoreRoutePlan,
): GeneralStoreWaypointSelection | null {
  return selectGeneralStoreWaypointAttempts(calibration, route)[0] ?? null;
}

function getMouseCoordinateCropBounds(
  point: ScreenPoint,
  calibration: StartupPlayerTileCalibration,
): { x: number; y: number; width: number; height: number } {
  const scale = getCurrentScaleRelativeTo125(calibration);
  const capture = calibration.captureBounds;
  const width = Math.min(capture.width, Math.max(120, Math.round(GENERAL_STORE_MOUSE_COORDINATE_CROP_WIDTH_AT_125_PX * scale)));
  const height = Math.min(
    capture.height,
    Math.max(90, Math.round(GENERAL_STORE_MOUSE_COORDINATE_CROP_HEIGHT_AT_125_PX * scale)),
  );
  const leftOffset = Math.round(GENERAL_STORE_MOUSE_COORDINATE_CROP_LEFT_AT_125_PX * scale);
  const topOffset = Math.round(GENERAL_STORE_MOUSE_COORDINATE_CROP_TOP_AT_125_PX * scale);
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

function buildMouseCoordinateDebugPath(
  point: ScreenPoint,
  cropBounds: { x: number; y: number; width: number; height: number },
  targetTile: GeneralStoreTile,
  attemptIndex: number,
): string {
  return buildEndToEndDebugPath(
    `end-to-end-mouse-ocr-try-${attemptIndex + 1}-target-${targetTile.x}-${targetTile.y}-${targetTile.z}-mouse-${point.x}-${point.y}-crop-${cropBounds.x}-${cropBounds.y}-${cropBounds.width}x${cropBounds.height}`,
  );
}

async function readGeneralStoreMouseCoordinateAtPoint(
  point: ScreenPoint,
  calibration: StartupPlayerTileCalibration,
  targetTile: GeneralStoreTile,
  attemptIndex: number,
): Promise<GeneralStoreMouseCoordinateProbe> {
  const cropBounds = getMouseCoordinateCropBounds(point, calibration);
  const bitmap = captureScreenBitmap(cropBounds);
  const debugPath = buildMouseCoordinateDebugPath(point, cropBounds, targetTile, attemptIndex);
  try {
    await saveBitmapAsync(bitmap, debugPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Section 1.1 Step 1 mouse OCR debug save failed: path=${debugPath} error=${message}.`);
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

function formatSceneHoverAttempts(attempts: GeneralStoreSceneHoverAttempt[]): string {
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

function toSceneMouseCalibrationSampleFromObservation(
  calibration: StartupPlayerTileCalibration,
  observation: GeneralStoreSceneHoverObservation,
  source: string,
): EndToEndSceneMouseCalibrationSample | null {
  const playerTile = calibration.playerTile;
  if (!playerTile || observation.read.tile.z !== playerTile.z) {
    return null;
  }

  const localX = Math.round(observation.point.x - calibration.captureBounds.x);
  const localY = Math.round(observation.point.y - calibration.captureBounds.y);
  return {
    localX,
    localY,
    dxTiles: observation.read.tile.x - playerTile.x,
    dyTiles: observation.read.tile.y - playerTile.y,
    tileX: observation.read.tile.x,
    tileY: observation.read.tile.y,
    z: observation.read.tile.z,
    source,
    createdAt: new Date().toISOString(),
  };
}

function fitLocalSceneMouseHoverObservations(
  calibration: StartupPlayerTileCalibration,
  observations: GeneralStoreSceneHoverObservation[],
): EndToEndSceneMouseCalibrationFit | null {
  const samples = observations
    .filter((observation) => observation.errorTiles <= GENERAL_STORE_SCENE_LOCAL_FIT_MAX_TILE_ERROR)
    .map((observation) => toSceneMouseCalibrationSampleFromObservation(calibration, observation, "local-click-fit"))
    .filter((sample): sample is EndToEndSceneMouseCalibrationSample => sample !== null);
  return fitSceneMouseCalibrationSamples(samples);
}

function interpolateGeneralStoreTargetPointFromHoverObservations(
  waypoint: GeneralStoreTile,
  observations: GeneralStoreSceneHoverObservation[],
): ScreenPoint | null {
  const candidates: ScreenPoint[] = [];
  for (let i = 0; i < observations.length; i += 1) {
    for (let j = i + 1; j < observations.length; j += 1) {
      const a = observations[i];
      const b = observations[j];
      if (a.read.tile.z !== waypoint.z || b.read.tile.z !== waypoint.z) {
        continue;
      }

      const ax = a.read.tile.x;
      const ay = a.read.tile.y;
      const bx = b.read.tile.x;
      const by = b.read.tile.y;
      const sameYBracketsX =
        ay === waypoint.y &&
        by === waypoint.y &&
        ax !== bx &&
        waypoint.x >= Math.min(ax, bx) &&
        waypoint.x <= Math.max(ax, bx);
      const sameXBracketsY =
        ax === waypoint.x &&
        bx === waypoint.x &&
        ay !== by &&
        waypoint.y >= Math.min(ay, by) &&
        waypoint.y <= Math.max(ay, by);

      if (sameYBracketsX) {
        const ratio = (waypoint.x - ax) / (bx - ax);
        candidates.push({
          x: Math.round(a.point.x + ratio * (b.point.x - a.point.x)),
          y: Math.round(a.point.y + ratio * (b.point.y - a.point.y)),
        });
        continue;
      }

      if (sameXBracketsY) {
        const ratio = (waypoint.y - ay) / (by - ay);
        candidates.push({
          x: Math.round(a.point.x + ratio * (b.point.x - a.point.x)),
          y: Math.round(a.point.y + ratio * (b.point.y - a.point.y)),
        });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const average = candidates.reduce(
    (acc, candidate) => ({
      x: acc.x + candidate.x,
      y: acc.y + candidate.y,
    }),
    { x: 0, y: 0 },
  );
  return {
    x: Math.round(average.x / candidates.length),
    y: Math.round(average.y / candidates.length),
  };
}

function getNextGeneralStoreSceneCorrectionPoint(
  calibration: StartupPlayerTileCalibration,
  projection: GeneralStoreSceneProjection,
  waypoint: GeneralStoreTile,
  observations: GeneralStoreSceneHoverObservation[],
  latestFit: EndToEndSceneMouseCalibrationFit | null,
  lastObservation: GeneralStoreSceneHoverObservation,
): ScreenPoint {
  const interpolated = interpolateGeneralStoreTargetPointFromHoverObservations(waypoint, observations);
  if (interpolated) {
    return {
      x: interpolated.x + randomIntInclusive(-GENERAL_STORE_SCENE_CORRECTION_JITTER_PX, GENERAL_STORE_SCENE_CORRECTION_JITTER_PX),
      y: interpolated.y + randomIntInclusive(-GENERAL_STORE_SCENE_CORRECTION_JITTER_PX, GENERAL_STORE_SCENE_CORRECTION_JITTER_PX),
    };
  }

  const candidateFit = latestFit ?? fitLocalSceneMouseHoverObservations(calibration, observations);
  const localFit = isSceneMouseCalibrationFitAcceptable(candidateFit) ? candidateFit : null;
  if (localFit) {
    const fittedPoint = projectGeneralStoreScenePointFromFit(
      calibration,
      projection,
      waypoint,
      localFit,
      getGeneralStoreSceneTargetEdgeMarginPx(calibration),
    );
    if (fittedPoint) {
      return {
        x: fittedPoint.x + randomIntInclusive(-GENERAL_STORE_SCENE_CORRECTION_JITTER_PX, GENERAL_STORE_SCENE_CORRECTION_JITTER_PX),
        y: fittedPoint.y + randomIntInclusive(-GENERAL_STORE_SCENE_CORRECTION_JITTER_PX, GENERAL_STORE_SCENE_CORRECTION_JITTER_PX),
      };
    }
  }

  const tilePx = getGeneralStoreSceneTilePxAtY(projection, lastObservation.point.y - calibration.captureBounds.y);
  const sameTileRepeats = observations.filter(
    (observation) =>
      observation.read.tile.x === lastObservation.read.tile.x &&
      observation.read.tile.y === lastObservation.read.tile.y &&
      observation.read.tile.z === lastObservation.read.tile.z,
  ).length;
  const repeatMultiplier = sameTileRepeats >= 2 ? Math.min(1.35, 0.55 + sameTileRepeats * 0.18) : 0.55;
  const dampedTilePx = Math.max(10, Math.round(tilePx * repeatMultiplier));
  const errorX = waypoint.x - lastObservation.read.tile.x;
  const errorY = waypoint.y - lastObservation.read.tile.y;
  return {
    x: lastObservation.point.x + Math.round(errorX * dampedTilePx),
    y: lastObservation.point.y - Math.round(errorY * dampedTilePx),
  };
}

function selectGeneralStoreSceneCalibrationProbeTiles(
  calibration: StartupPlayerTileCalibration,
  route: EndToEndGeneralStoreRoutePlan,
): Array<{ index: number; tile: GeneralStoreTile; point: ScreenPoint }> {
  if (route.status !== "ready" || route.pathTiles.length <= 1) {
    return [];
  }

  const projection = inferGeneralStoreSceneProjection(calibration);
  const candidates: Array<{ index: number; tile: GeneralStoreTile; point: ScreenPoint }> = [];
  const targetEdgeMarginPx = getGeneralStoreSceneTargetEdgeMarginPx(calibration);
  for (let index = route.pathTiles.length - 1; index >= 1; index -= 1) {
    const tile = route.pathTiles[index];
    const projected = projectGeneralStoreSceneTilePoint(calibration, projection, tile, targetEdgeMarginPx);
    if (!projected || projected.wasClamped) {
      continue;
    }

    const hasNearbyIndex = candidates.some((candidate) => Math.abs(candidate.index - index) < 4);
    if (hasNearbyIndex) {
      continue;
    }

    candidates.push({ index, tile, point: projected.screenPoint });
    if (candidates.length >= GENERAL_STORE_SCENE_CALIBRATION_PROBE_COUNT) {
      break;
    }
  }

  return candidates;
}

function formatSceneMouseCalibrationFit(fit: EndToEndSceneMouseCalibrationFit | null): string {
  return formatSharedSceneMouseCalibrationFit(fit);
}

function getGeneralStoreSceneCalibrationMicroOffsets(calibration: StartupPlayerTileCalibration): Array<{ x: number; y: number }> {
  const scale = getCurrentScaleRelativeTo125(calibration);
  const step = Math.max(3, Math.round(GENERAL_STORE_SCENE_CALIBRATION_MICRO_OFFSET_PX_AT_125 * scale));
  return [
    { x: 0, y: 0 },
    { x: 0, y: -step },
    { x: 0, y: -step * 2 },
    { x: step, y: -step },
    { x: -step, y: -step },
    { x: 0, y: step },
    { x: step, y: 0 },
  ].slice(0, GENERAL_STORE_SCENE_CALIBRATION_MAX_PROBES_PER_TILE);
}

function isSameGeneralStoreTile(a: Pick<GeneralStoreTile, "x" | "y" | "z">, b: Pick<GeneralStoreTile, "x" | "y" | "z">): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function findGeneralStorePathTileIndex(
  routePathTiles: Array<Pick<GeneralStoreTile, "x" | "y" | "z">>,
  tile: Pick<GeneralStoreTile, "x" | "y" | "z">,
): number | null {
  const index = routePathTiles.findIndex((pathTile) => isSameGeneralStoreTile(pathTile, tile));
  return index >= 0 ? index : null;
}

function formatEligibleGeneralStoreClickTiles(tiles: GeneralStoreTile[]): string {
  return tiles.map((tile) => `${tile.x},${tile.y},${tile.z}`).join("|") || "none";
}

async function ensureGeneralStoreSceneMouseCalibration(
  calibration: StartupPlayerTileCalibration,
  route: EndToEndGeneralStoreRoutePlan,
  token: number,
): Promise<void> {
  const existingCalibration = getCompatibleSceneMouseCalibration(calibration);
  if (
    existingCalibration?.fit &&
    existingCalibration.fit.sampleCount >= GENERAL_STORE_SCENE_CALIBRATION_GOOD_SAMPLES
  ) {
    log(`Section 1.1 Step 1 scene mouse calibration loaded: ${formatSceneMouseCalibrationFit(existingCalibration.fit)}.`);
    return;
  }

  const probeTiles = selectGeneralStoreSceneCalibrationProbeTiles(calibration, route);
  if (probeTiles.length === 0) {
    log("Section 1.1 Step 1 scene mouse calibration skipped: no rough-visible path tile probes available.");
    return;
  }

  const savedFit = getSavedEndToEndConfig().sceneMouseCalibration?.fit ?? null;
  const initialFit = existingCalibration?.fit ?? (isSharedSceneMouseCalibrationFitAcceptable(savedFit) ? savedFit : null);
  const probeSummaries: string[] = [];
  let latestFit: EndToEndSceneMouseCalibrationFit | null = initialFit;
  log(
    `Section 1.1 Step 1 scene mouse calibration probing: existing=${formatSceneMouseCalibrationFit(initialFit)} probes=${probeTiles
      .map((probe) => `#${probe.index}:${probe.tile.x},${probe.tile.y},${probe.tile.z}`)
      .join("|")}.`,
  );

  const microOffsets = getGeneralStoreSceneCalibrationMicroOffsets(calibration);
  for (let index = 0; index < probeTiles.length && isCurrentRunActive(token); index += 1) {
    const probeTile = probeTiles[index];
    let exactRead = false;
    const tileSummaries: string[] = [];
    for (let offsetIndex = 0; offsetIndex < microOffsets.length && isCurrentRunActive(token); offsetIndex += 1) {
      const offset = microOffsets[offsetIndex];
      const point = getSafeScreenPoint(
        probeTile.point.x + offset.x,
        probeTile.point.y + offset.y,
        calibration.captureBounds,
        GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      );
      await moveMouseHumanLike(point.x, point.y, calibration.captureBounds, {
        safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
        minDurationMs: GENERAL_STORE_MOUSE_MOVE_MIN_MS,
        maxDurationMs: GENERAL_STORE_MOUSE_MOVE_MAX_MS,
        jitterPx: GENERAL_STORE_MOUSE_MOVE_JITTER_PX,
        overshootChance: GENERAL_STORE_MOUSE_MOVE_OVERSHOOT_CHANCE,
        shouldContinue: () => isCurrentRunActive(token),
      });
      if (!isCurrentRunActive(token)) {
        return;
      }

      await sleepWithAbort(70 + randomIntInclusive(0, 55), () => isCurrentRunActive(token));
      const probe = await readGeneralStoreMouseCoordinateAtPoint(
        point,
        calibration,
        probeTile.tile,
        100 + index * GENERAL_STORE_SCENE_CALIBRATION_MAX_PROBES_PER_TILE + offsetIndex,
      );
      if (!probe.read) {
        tileSummaries.push(`off=${offset.x},${offset.y}:no-read`);
        continue;
      }

      const errorTiles = tileDistance(probe.read.tile, probeTile.tile);
      const memory = rememberGeneralStoreSceneMouseCalibrationSample(
        calibration,
        point,
        probe.read,
        probeTile.tile,
        "calibration-probe",
      );
      latestFit = memory.fit ?? latestFit;
      tileSummaries.push(
        `off=${offset.x},${offset.y}:hover=${probe.read.tile.x},${probe.read.tile.y},${probe.read.tile.z}/err=${errorTiles}/saved=${memory.saved ? "yes" : "no"}/samples=${memory.sampleCount}/fit=${memory.fit ? "yes" : "no"}/reason=${memory.reason}`,
      );

      if (errorTiles === 0) {
        exactRead = true;
        break;
      }
    }

    probeSummaries.push(
      `#${probeTile.index}:target=${probeTile.tile.x},${probeTile.tile.y},${probeTile.tile.z} exact=${exactRead ? "yes" : "no"} probes=[${tileSummaries.join("|") || "none"}]`,
    );
  }

  log(
    `Section 1.1 Step 1 scene mouse calibration result: ${formatSceneMouseCalibrationFit(latestFit)} probes=${probeSummaries.join("; ") || "none"}.`,
  );
}

async function projectGeneralStoreSceneClick(
  calibration: StartupPlayerTileCalibration,
  waypoint: GeneralStoreTile,
  pathTiles: number,
  source: GeneralStoreClickPlan["source"],
  eligibleClickTiles: GeneralStoreTile[],
  routePathTiles: Array<Pick<GeneralStoreTile, "x" | "y" | "z">>,
  token: number,
  warnOnFailure: boolean = true,
): Promise<GeneralStoreSceneClickPlan | null> {
  const projection = inferGeneralStoreSceneProjection(calibration);
  const targetEdgeMarginPx = getGeneralStoreSceneTargetEdgeMarginPx(calibration);
  const projected = projectGeneralStoreSceneTilePointWithCalibration(calibration, projection, waypoint, targetEdgeMarginPx);
  if (!projected) {
    return null;
  }

  const attempts: GeneralStoreSceneHoverAttempt[] = [];
  const observations: GeneralStoreSceneHoverObservation[] = [];
  const initialScreenPoint = projected.screenPoint;
  let nextPoint = initialScreenPoint;
  let latestCorrectionFit: EndToEndSceneMouseCalibrationFit | null = null;
  let best:
    | {
      point: ScreenPoint;
      read: GeneralStoreMouseCoordinateRead;
      errorTiles: number;
      tilePx: number;
      clickTile: GeneralStoreTile;
      clickPathTiles: number;
      clickReason: GeneralStoreSceneClickPlan["clickReason"];
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

  for (let attempt = 0; attempt < GENERAL_STORE_SCENE_MAX_HOVER_ATTEMPTS && isCurrentRunActive(token); attempt += 1) {
    const offset = noReadOffsets[Math.min(attempt, noReadOffsets.length - 1)];
    const candidate =
      attempt === 0 || attempts[attempts.length - 1]?.read
        ? nextPoint
        : {
            x: initialScreenPoint.x + offset.x,
            y: initialScreenPoint.y + offset.y,
          };
    const point = getSafeScreenPoint(candidate.x, candidate.y, calibration.captureBounds, GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX);
    await moveMouseHumanLike(point.x, point.y, calibration.captureBounds, {
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      minDurationMs: GENERAL_STORE_MOUSE_MOVE_MIN_MS,
      maxDurationMs: GENERAL_STORE_MOUSE_MOVE_MAX_MS,
      jitterPx: GENERAL_STORE_MOUSE_MOVE_JITTER_PX,
      overshootChance: GENERAL_STORE_MOUSE_MOVE_OVERSHOOT_CHANCE,
      shouldContinue: () => isCurrentRunActive(token),
    });
    if (!isCurrentRunActive(token)) {
      return null;
    }

    await sleepWithAbort(randomIntInclusive(GENERAL_STORE_MOUSE_HOVER_SETTLE_MIN_MS, GENERAL_STORE_MOUSE_HOVER_SETTLE_MAX_MS), () =>
      isCurrentRunActive(token),
    );

    const probe = await readGeneralStoreMouseCoordinateAtPoint(point, calibration, waypoint, attempt);
    const read = probe.read;
    const errorTiles = read ? tileDistance(read.tile, waypoint) : null;
    attempts.push({ point, read, errorTiles, debugPath: probe.debugPath, cropBounds: probe.cropBounds });

    if (read && read.tile.z === waypoint.z) {
      const observation = { point, read, errorTiles: errorTiles! };
      observations.push(observation);
      const memory = rememberGeneralStoreSceneMouseCalibrationSample(calibration, point, read, waypoint, "click-hover");
      latestCorrectionFit = memory.fit ?? latestCorrectionFit;
      const tilePx = getGeneralStoreSceneTilePxAtY(projection, point.y - calibration.captureBounds.y);
      if (!best || errorTiles! < best.errorTiles) {
        best = {
          point,
          read,
          errorTiles: errorTiles!,
          tilePx,
          clickTile: waypoint,
          clickPathTiles: pathTiles,
          clickReason: "requested-target",
        };
      }

      if (errorTiles! <= GENERAL_STORE_SCENE_ACCEPT_TILE_ERROR) {
        break;
      }

      const eligiblePathTile =
        eligibleClickTiles.some((eligibleTile) => isSameGeneralStoreTile(eligibleTile, read.tile)) &&
        findGeneralStorePathTileIndex(routePathTiles, read.tile);
      if (eligiblePathTile !== false && eligiblePathTile !== null) {
        best = {
          point,
          read,
          errorTiles: 0,
          tilePx,
          clickTile: { x: read.tile.x, y: read.tile.y, z: read.tile.z },
          clickPathTiles: Math.max(1, eligiblePathTile),
          clickReason: "eligible-visible-path",
        };
        break;
      }

      nextPoint = getNextGeneralStoreSceneCorrectionPoint(
        calibration,
        projection,
        waypoint,
        observations,
        latestCorrectionFit,
        observation,
      );
    }
  }

  if (!best) {
    if (warnOnFailure) {
      warn(
        `Section 1.1 Step 1 scene click refused: target=${waypoint.x},${waypoint.y},${waypoint.z} eligible=${formatEligibleGeneralStoreClickTiles(eligibleClickTiles)} no mouse-coordinate read matched. attempts=${formatSceneHoverAttempts(attempts)}.`,
      );
    }
    return null;
  }

  if (best.errorTiles > GENERAL_STORE_SCENE_FALLBACK_TILE_ERROR) {
    if (warnOnFailure) {
      warn(
        `Section 1.1 Step 1 scene click refused: target=${waypoint.x},${waypoint.y},${waypoint.z} eligible=${formatEligibleGeneralStoreClickTiles(eligibleClickTiles)} closestHover='${best.read.line}' error=${best.errorTiles} tile(s). attempts=${formatSceneHoverAttempts(attempts)}.`,
      );
    }
    return null;
  }

  return {
    screenPoint: best.point,
    initialScreenPoint,
    anchorScreenPoint: {
      x: calibration.captureBounds.x + projection.anchorLocalX,
      y: calibration.captureBounds.y + projection.anchorLocalY,
    },
    requestedTargetTile: waypoint,
    targetTile: best.clickTile,
    hoveredTile: best.read.tile,
    hoveredLine: best.read.line,
    hoverBoxScreen: best.read.boxScreen,
    dxTiles: projected.dxTiles,
    dyTiles: projected.dyTiles,
    distanceTiles: projected.distanceTiles,
    pathTiles: Math.max(1, best.clickPathTiles),
    tilePx: Math.round(best.tilePx),
    source,
    attempts,
    finalErrorTiles: best.errorTiles,
    projection,
    projectionSource: projected.source,
    calibrationSampleCount: projected.calibrationSampleCount,
    calibrationMeanErrorPx: projected.calibrationMeanErrorPx,
    clickReason: best.clickReason,
  };
}

function inferGeneralStoreMinimap(calibration: StartupPlayerTileCalibration): {
  centerLocalX: number;
  centerLocalY: number;
  radiusPx: number;
  tilePx: number;
  source: GeneralStoreClickPlan["minimapSource"];
} {
  const scale = getScaleFromCalibration(calibration);
  const radiusPx = clamp(Math.round(GENERAL_STORE_MINIMAP_RADIUS_LOGICAL * scale), 55, 96);
  const tilePx = clamp(Math.round(GENERAL_STORE_MINIMAP_TILE_PX_LOGICAL * scale), 3, 7);

  if (calibration.compassNorth) {
    return {
      centerLocalX:
        calibration.compassNorth.centerX +
        Math.round(GENERAL_STORE_MINIMAP_PLAYER_CENTER_FROM_COMPASS_X_LOGICAL * scale),
      centerLocalY:
        calibration.compassNorth.centerY +
        Math.round(GENERAL_STORE_MINIMAP_PLAYER_CENTER_FROM_COMPASS_Y_LOGICAL * scale),
      radiusPx,
      tilePx,
      source: "inferred-from-compass",
    };
  }

  return {
    centerLocalX:
      calibration.captureBounds.width -
      Math.round(GENERAL_STORE_MINIMAP_PLAYER_CENTER_RIGHT_OFFSET_LOGICAL * scale),
    centerLocalY: Math.round(GENERAL_STORE_MINIMAP_PLAYER_CENTER_Y_LOGICAL * scale),
    radiusPx,
    tilePx,
    source: "inferred-from-capture",
  };
}

function inferQuestHelperOpenPanelMinimap(calibration: StartupPlayerTileCalibration): ReturnType<typeof inferGeneralStoreMinimap> {
  const scale = getScaleFromCalibration(calibration);
  const base = inferGeneralStoreMinimap(calibration);
  if (base.source === "inferred-from-compass") {
    return base;
  }

  return {
    ...base,
    centerLocalX:
      calibration.captureBounds.width -
      Math.round((GENERAL_STORE_MINIMAP_PLAYER_CENTER_RIGHT_OFFSET_LOGICAL + RUNELITE_OPEN_SIDE_PANEL_WIDTH_LOGICAL) * scale),
    centerLocalY: Math.round(GENERAL_STORE_MINIMAP_PLAYER_CENTER_Y_LOGICAL * scale),
    source: "inferred-from-runelite-side-panel",
  };
}

type QuestHelperMinimapCyanComponent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

function isQuestHelperMinimapCyanPixel(r: number, g: number, b: number): boolean {
  return r <= 95 && g >= 135 && b >= 135 && g - r >= 55 && b - r >= 55 && Math.abs(g - b) <= 110;
}

function makeQuestHelperMinimapSearchRoi(
  bitmap: ScreenBitmap,
  minimap: QuestHelperMinimapGeometry,
): { x: number; y: number; width: number; height: number } {
  const margin = Math.round(minimap.radiusPx * SECTION_ONE_STEP_TWO_MINIMAP_ARROW_SEARCH_RADIUS_RATIO);
  const left = clamp(minimap.centerLocalX - margin, 0, bitmap.width - 1);
  const top = clamp(minimap.centerLocalY - margin, 0, bitmap.height - 1);
  const right = clamp(minimap.centerLocalX + margin, left, bitmap.width - 1);
  const bottom = clamp(minimap.centerLocalY + margin, top, bitmap.height - 1);
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function collectQuestHelperMinimapCyanComponents(
  bitmap: ScreenBitmap,
  roi: { x: number; y: number; width: number; height: number },
): QuestHelperMinimapCyanComponent[] {
  const mask = new Uint8Array(roi.width * roi.height);

  for (let y = 0; y < roi.height; y += 1) {
    for (let x = 0; x < roi.width; x += 1) {
      const bitmapX = roi.x + x;
      const bitmapY = roi.y + y;
      const offset = bitmapY * bitmap.byteWidth + bitmapX * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isQuestHelperMinimapCyanPixel(r, g, b)) {
        mask[y * roi.width + x] = 1;
      }
    }
  }

  const components: QuestHelperMinimapCyanComponent[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) {
      continue;
    }

    const stack = [index];
    mask[index] = 0;
    let minX = roi.width;
    let minY = roi.height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        break;
      }

      const x = current % roi.width;
      const y = Math.floor(current / roi.width);
      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= roi.width || nextY >= roi.height) {
            continue;
          }

          const nextIndex = nextY * roi.width + nextX;
          if (!mask[nextIndex]) {
            continue;
          }

          mask[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    if (pixelCount >= 3) {
      components.push({
        minX: roi.x + minX,
        minY: roi.y + minY,
        maxX: roi.x + maxX,
        maxY: roi.y + maxY,
        pixelCount,
      });
    }
  }

  return components;
}

function mergeQuestHelperMinimapCyanComponents(
  components: QuestHelperMinimapCyanComponent[],
): QuestHelperMinimapCyanComponent[] {
  const pending = components.slice();
  const merged: QuestHelperMinimapCyanComponent[] = [];
  const gapPx = 4;

  while (pending.length > 0) {
    let current = pending.pop();
    if (!current) {
      break;
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const next = pending[index];
        const separated =
          current.maxX + gapPx < next.minX ||
          next.maxX + gapPx < current.minX ||
          current.maxY + gapPx < next.minY ||
          next.maxY + gapPx < current.minY;
        if (separated) {
          continue;
        }

        pending.splice(index, 1);
        current = {
          minX: Math.min(current.minX, next.minX),
          minY: Math.min(current.minY, next.minY),
          maxX: Math.max(current.maxX, next.maxX),
          maxY: Math.max(current.maxY, next.maxY),
          pixelCount: current.pixelCount + next.pixelCount,
        };
        changed = true;
      }
    }

    merged.push(current);
  }

  return merged;
}

function toQuestHelperMinimapCyanBox(
  component: QuestHelperMinimapCyanComponent,
  minimap: QuestHelperMinimapGeometry,
): CyanBox | null {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  if (component.pixelCount < SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MIN_PIXELS) {
    return null;
  }
  if (width < SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MIN_SIZE_PX || height < SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MIN_SIZE_PX) {
    return null;
  }
  if (width > SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_SIZE_PX || height > SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_SIZE_PX) {
    return null;
  }

  const centerX = Math.round(component.minX + width / 2);
  const centerY = Math.round(component.minY + height / 2);
  const dx = centerX - minimap.centerLocalX;
  const dy = centerY - minimap.centerLocalY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > minimap.radiusPx * SECTION_ONE_STEP_TWO_MINIMAP_ARROW_ACCEPT_RADIUS_RATIO || distance < minimap.radiusPx * 0.12) {
    return null;
  }

  const fillRatio = component.pixelCount / Math.max(1, width * height);
  if (fillRatio < 0.12 || fillRatio > 0.92) {
    return null;
  }

  const aspectRatio = height / Math.max(1, width);
  const distanceRatio = distance / Math.max(1, minimap.radiusPx);
  const score =
    component.pixelCount * 4 +
    Math.max(width, height) * 6 +
    distanceRatio * 80 -
    Math.abs(aspectRatio - 1) * 10;

  return {
    x: component.minX,
    y: component.minY,
    width,
    height,
    centerX,
    centerY,
    pixelCount: component.pixelCount,
    fillRatio,
    aspectRatio,
    score,
  };
}

function detectQuestHelperMinimapCyanArrow(
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
  captureAttempt: number,
  debugPath: string,
): QuestHelperMinimapArrowDetection {
  const minimap = inferQuestHelperOpenPanelMinimap(calibration);
  const roi = makeQuestHelperMinimapSearchRoi(bitmap, minimap);
  const all = mergeQuestHelperMinimapCyanComponents(collectQuestHelperMinimapCyanComponents(bitmap, roi))
    .map((component) => toQuestHelperMinimapCyanBox(component, minimap))
    .filter((box): box is CyanBox => box !== null)
    .sort((a, b) => b.score - a.score);
  const candidates = all.filter((box) => {
    const distance = Math.hypot(box.centerX - minimap.centerLocalX, box.centerY - minimap.centerLocalY);
    return distance >= minimap.radiusPx * 0.28;
  });
  const selected = candidates[0] ?? all[0] ?? null;

  return {
    selected,
    candidates,
    all,
    minimap,
    roi,
    debugPath,
    captureAttempt,
    source: "single-frame",
    sampledFrames: 1,
    selectedFrameCount: selected ? 1 : 0,
  };
}

type QuestHelperMinimapArrowCluster = {
  boxes: CyanBox[];
  frameAttempts: Set<number>;
  centerX: number;
  centerY: number;
  score: number;
};

function addQuestHelperMinimapArrowClusterBox(
  clusters: QuestHelperMinimapArrowCluster[],
  box: CyanBox,
  captureAttempt: number,
): void {
  let bestCluster: QuestHelperMinimapArrowCluster | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const cluster of clusters) {
    const distance = Math.hypot(box.centerX - cluster.centerX, box.centerY - cluster.centerY);
    if (distance <= SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CLUSTER_DISTANCE_PX && distance < bestDistance) {
      bestCluster = cluster;
      bestDistance = distance;
    }
  }

  if (!bestCluster) {
    clusters.push({
      boxes: [box],
      frameAttempts: new Set([captureAttempt]),
      centerX: box.centerX,
      centerY: box.centerY,
      score: box.score,
    });
    return;
  }

  bestCluster.boxes.push(box);
  bestCluster.frameAttempts.add(captureAttempt);
  bestCluster.centerX = Math.round(
    bestCluster.boxes.reduce((sum, candidate) => sum + candidate.centerX, 0) / bestCluster.boxes.length,
  );
  bestCluster.centerY = Math.round(
    bestCluster.boxes.reduce((sum, candidate) => sum + candidate.centerY, 0) / bestCluster.boxes.length,
  );
  bestCluster.score += box.score;
}

function toQuestHelperMinimapArrowClusterBox(cluster: QuestHelperMinimapArrowCluster): CyanBox {
  const minX = Math.min(...cluster.boxes.map((box) => box.x));
  const minY = Math.min(...cluster.boxes.map((box) => box.y));
  const maxX = Math.max(...cluster.boxes.map((box) => box.x + box.width - 1));
  const maxY = Math.max(...cluster.boxes.map((box) => box.y + box.height - 1));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const pixelCount = Math.max(...cluster.boxes.map((box) => box.pixelCount));
  const fillRatio = pixelCount / Math.max(1, width * height);
  const aspectRatio = height / Math.max(1, width);

  return {
    x: minX,
    y: minY,
    width,
    height,
    centerX: cluster.centerX,
    centerY: cluster.centerY,
    pixelCount,
    fillRatio,
    aspectRatio,
    score: cluster.score + cluster.frameAttempts.size * 120,
  };
}

function aggregateQuestHelperMinimapArrowDetections(
  detections: QuestHelperMinimapArrowDetection[],
  debugPath: string,
): QuestHelperMinimapArrowDetection | null {
  const base = detections[detections.length - 1];
  if (!base) {
    return null;
  }

  const clusters: QuestHelperMinimapArrowCluster[] = [];
  for (const detection of detections) {
    const boxes = detection.candidates.length > 0 ? detection.candidates : detection.all;
    for (const box of boxes) {
      addQuestHelperMinimapArrowClusterBox(clusters, box, detection.captureAttempt);
    }
  }

  const staticFrameCutoff = Math.max(
    2,
    Math.ceil(detections.length * SECTION_ONE_STEP_TWO_MINIMAP_ARROW_STATIC_MAX_FRAME_RATIO),
  );
  const clusterBoxes = clusters
    .filter((cluster) => cluster.frameAttempts.size < staticFrameCutoff)
    .map((cluster) => ({
      cluster,
      box: toQuestHelperMinimapArrowClusterBox(cluster),
    }))
    .sort((a, b) => b.box.score - a.box.score);
  const fallbackBoxes = detections
    .map((detection) => detection.selected)
    .filter((box): box is CyanBox => Boolean(box))
    .sort((a, b) => b.score - a.score);
  const selectedCluster = clusterBoxes[0] ?? null;
  const selected = selectedCluster?.box ?? fallbackBoxes[0] ?? null;

  return {
    selected,
    candidates: clusterBoxes.map((entry) => entry.box),
    all: [
      ...clusterBoxes.map((entry) => entry.box),
      ...fallbackBoxes.filter((box) => !selected || Math.hypot(box.centerX - selected.centerX, box.centerY - selected.centerY) > 2),
    ],
    minimap: base.minimap,
    roi: base.roi,
    debugPath,
    captureAttempt: detections.length,
    source: selectedCluster ? "temporal-burst" : "single-frame",
    sampledFrames: detections.length,
    selectedFrameCount: selectedCluster?.cluster.frameAttempts.size ?? (selected ? 1 : 0),
  };
}

function formatQuestHelperMinimapArrowDetection(detection: QuestHelperMinimapArrowDetection): string {
  const selected = detection.selected ? formatCyanBoxForLog(detection.selected) : "none";
  const center = `${detection.minimap.centerLocalX},${detection.minimap.centerLocalY}`;
  const roi = `${detection.roi.x},${detection.roi.y},${detection.roi.width}x${detection.roi.height}`;
  const candidates = detection.candidates.map(formatCyanBoxForLog).join("|") || "none";
  const all = detection.all.map(formatCyanBoxForLog).join("|") || "none";
  return `attempt=${detection.captureAttempt}/${SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CAPTURE_ATTEMPTS} source=${detection.source} frames=${detection.selectedFrameCount}/${detection.sampledFrames} selected=${selected} candidates=${candidates} all=${all} minimap=${center}/r=${detection.minimap.radiusPx}/source=${detection.minimap.source} roi=${roi}`;
}

async function findQuestHelperMinimapCyanArrow(
  calibration: StartupPlayerTileCalibration,
  token: number,
  label: string,
): Promise<QuestHelperMinimapArrowDetection | null> {
  const detections: QuestHelperMinimapArrowDetection[] = [];
  let lastBitmap: ScreenBitmap | null = null;

  for (
    let attempt = 1;
    attempt <= SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CAPTURE_ATTEMPTS && isCurrentRunActive(token);
    attempt += 1
  ) {
    const bitmap = captureScreenBitmap(calibration.captureBounds);
    const timestamp = buildEndToEndDebugTimestamp();
    const debugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-minimap-cyan-arrow-${label}-capture-${attempt}`, timestamp);
    const detection = detectQuestHelperMinimapCyanArrow(bitmap, calibration, attempt, debugPath);
    saveBitmapWithCyanBoxes(bitmap, detection.all, debugPath);
    detections.push(detection);
    lastBitmap = bitmap;

    await sleepWithAbort(
      randomIntInclusive(
        SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CAPTURE_DELAY_MIN_MS,
        SECTION_ONE_STEP_TWO_MINIMAP_ARROW_CAPTURE_DELAY_MAX_MS,
      ),
      () => isCurrentRunActive(token),
    );
  }

  const aggregateDebugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-minimap-cyan-arrow-${label}-temporal`);
  const aggregate = aggregateQuestHelperMinimapArrowDetections(detections, aggregateDebugPath);
  if (aggregate && lastBitmap) {
    saveBitmapWithCyanBoxes(lastBitmap, aggregate.all, aggregateDebugPath);
  }

  if (aggregate?.selected) {
    log(
      `Section 1.1 Step 2 minimap cyan arrow detected from temporal burst: ${formatQuestHelperMinimapArrowDetection(aggregate)} file=${aggregateDebugPath}.`,
    );
    return aggregate;
  }

  if (aggregate) {
    log(
      `Section 1.1 Step 2 minimap cyan arrow not detected after temporal burst: ${formatQuestHelperMinimapArrowDetection(aggregate)} file=${aggregateDebugPath}.`,
    );
  }
  return null;
}

function getRandomQuestHelperMinimapArrowClickPoint(
  box: CyanBox,
  bitmap: ScreenBitmap,
  minimap: QuestHelperMinimapGeometry,
): ScreenPoint {
  const jitterX = Math.max(1, Math.min(5, Math.round(box.width * 0.22)));
  const jitterY = Math.max(1, Math.min(5, Math.round(box.height * 0.22)));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const point = {
      x: clamp(box.centerX + randomIntInclusive(-jitterX, jitterX), 0, bitmap.width - 1),
      y: clamp(box.centerY + randomIntInclusive(-jitterY, jitterY), 0, bitmap.height - 1),
    };
    const distance = Math.hypot(point.x - minimap.centerLocalX, point.y - minimap.centerLocalY);
    if (distance <= minimap.radiusPx * 1.02) {
      return point;
    }
  }

  return {
    x: clamp(box.centerX, 0, bitmap.width - 1),
    y: clamp(box.centerY, 0, bitmap.height - 1),
  };
}

function makeQuestHelperSceneMarkerSearchRoi(
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
): { x: number; y: number; width: number; height: number } {
  const scale = getScaleFromCalibration(calibration);
  const sidePanelLeft = clamp(
    bitmap.width - Math.round(RUNELITE_OPEN_SIDE_PANEL_WIDTH_LOGICAL * scale) - 18,
    Math.round(bitmap.width * 0.62),
    bitmap.width - 1,
  );
  const chatboxTop = clamp(
    bitmap.height - Math.round((GENERAL_STORE_SCENE_BOTTOM_UI_HEIGHT_LOGICAL + 8) * scale),
    Math.round(bitmap.height * 0.62),
    bitmap.height - 1,
  );
  return {
    x: 0,
    y: 0,
    width: sidePanelLeft,
    height: chatboxTop,
  };
}

function isQuestHelperSceneMarkerInExcludedUi(
  box: CyanBox,
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
): boolean {
  const scale = getScaleFromCalibration(calibration);
  const minimap = inferQuestHelperOpenPanelMinimap(calibration);
  const distanceToMinimap = Math.hypot(box.centerX - minimap.centerLocalX, box.centerY - minimap.centerLocalY);
  if (distanceToMinimap <= minimap.radiusPx * 1.75) {
    return true;
  }

  const sidePanelLeft = bitmap.width - Math.round(RUNELITE_OPEN_SIDE_PANEL_WIDTH_LOGICAL * scale) - 18;
  if (box.centerX >= sidePanelLeft) {
    return true;
  }

  const gameRightPanelLeft =
    bitmap.width -
    Math.round((GENERAL_STORE_SCENE_RIGHT_PANEL_WIDTH_LOGICAL + RUNELITE_OPEN_SIDE_PANEL_WIDTH_LOGICAL) * scale) -
    24;
  const bottomUiTop = bitmap.height - Math.round(360 * scale);
  if (box.centerX >= gameRightPanelLeft && box.centerY >= bottomUiTop) {
    return true;
  }

  const chatboxTop = bitmap.height - Math.round((GENERAL_STORE_SCENE_BOTTOM_UI_HEIGHT_LOGICAL + 8) * scale);
  return box.centerY >= chatboxTop;
}

function toQuestHelperSceneMarkerCyanBox(component: QuestHelperMinimapCyanComponent): CyanBox | null {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  if (component.pixelCount < SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_PIXELS) {
    return null;
  }
  if (width < SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_SIZE_PX || height < SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_SIZE_PX) {
    return null;
  }
  if (width > SECTION_ONE_STEP_TWO_SCENE_MARKER_MAX_SIZE_PX || height > SECTION_ONE_STEP_TWO_SCENE_MARKER_MAX_SIZE_PX) {
    return null;
  }

  const fillRatio = component.pixelCount / Math.max(1, width * height);
  if (
    fillRatio < SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_FILL_RATIO ||
    fillRatio > SECTION_ONE_STEP_TWO_SCENE_MARKER_MAX_FILL_RATIO
  ) {
    return null;
  }

  const aspectRatio = height / Math.max(1, width);
  if (
    aspectRatio < SECTION_ONE_STEP_TWO_SCENE_MARKER_MIN_ASPECT_RATIO ||
    aspectRatio > SECTION_ONE_STEP_TWO_SCENE_MARKER_MAX_ASPECT_RATIO
  ) {
    return null;
  }

  const centerX = Math.round(component.minX + width / 2);
  const centerY = Math.round(component.minY + height / 2);
  const score =
    component.pixelCount * 3 +
    Math.max(width, height) * 5 +
    Math.min(width, height) * 2 +
    fillRatio * 180 -
    Math.abs(aspectRatio - 0.85) * 18;

  return {
    x: component.minX,
    y: component.minY,
    width,
    height,
    centerX,
    centerY,
    pixelCount: component.pixelCount,
    fillRatio,
    aspectRatio,
    score,
  };
}

function detectQuestHelperSceneCyanMarker(
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
  debugPath: string,
): QuestHelperSceneMarkerDetection {
  const roi = makeQuestHelperSceneMarkerSearchRoi(bitmap, calibration);
  const all = mergeQuestHelperMinimapCyanComponents(collectQuestHelperMinimapCyanComponents(bitmap, roi))
    .map(toQuestHelperSceneMarkerCyanBox)
    .filter((box): box is CyanBox => box !== null)
    .filter((box) => !isQuestHelperSceneMarkerInExcludedUi(box, bitmap, calibration))
    .sort((a, b) => b.score - a.score);
  const candidates = all.filter((box) => box.width >= 24 && box.height >= 20 && box.pixelCount >= 80);
  const selected = candidates[0] ?? all[0] ?? null;
  return {
    selected,
    candidates,
    all,
    roi,
    debugPath,
  };
}

function formatQuestHelperSceneMarkerDetection(detection: QuestHelperSceneMarkerDetection): string {
  const selected = detection.selected ? formatCyanBoxForLog(detection.selected) : "none";
  const candidates = detection.candidates.map(formatCyanBoxForLog).join("|") || "none";
  const all = detection.all.map(formatCyanBoxForLog).join("|") || "none";
  return `selected=${selected} candidates=${candidates} all=${all} roi=${detection.roi.x},${detection.roi.y},${detection.roi.width}x${detection.roi.height}`;
}

async function findQuestHelperSceneCyanMarker(
  calibration: StartupPlayerTileCalibration,
  label: string,
): Promise<QuestHelperSceneMarkerDetection> {
  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const debugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-scene-cyan-marker-${label}`);
  const detection = detectQuestHelperSceneCyanMarker(bitmap, calibration, debugPath);
  saveBitmapWithCyanBoxes(bitmap, detection.all, debugPath);
  if (detection.selected) {
    log(
      `Section 1.1 Step 2 scene cyan marker detected: ${formatQuestHelperSceneMarkerDetection(detection)} file=${debugPath}.`,
    );
  } else {
    log(
      `Section 1.1 Step 2 scene cyan marker not detected: ${formatQuestHelperSceneMarkerDetection(detection)} file=${debugPath}.`,
    );
  }
  return detection;
}

function getRandomQuestHelperSceneMarkerClickPoint(box: CyanBox, bitmap: ScreenBitmap): ScreenPoint {
  const jitterX = Math.max(2, Math.min(7, Math.round(box.width * 0.18)));
  const jitterY = Math.max(2, Math.min(6, Math.round(box.height * 0.16)));
  const baseY = box.centerY + Math.round(box.height * 0.18);
  return {
    x: clamp(box.centerX + randomIntInclusive(-jitterX, jitterX), 0, bitmap.width - 1),
    y: clamp(baseY + randomIntInclusive(-jitterY, jitterY), 0, bitmap.height - 1),
  };
}

function estimateQuestHelperSceneMarkerWaitTicks(box: CyanBox, bitmap: ScreenBitmap): number {
  const centerDistanceRatio =
    Math.hypot(box.centerX - bitmap.width / 2, box.centerY - bitmap.height / 2) /
    Math.max(1, Math.hypot(bitmap.width / 2, bitmap.height / 2));
  return clamp(Math.round(3 + centerDistanceRatio * 6) + randomIntInclusive(0, 1), 3, GENERAL_STORE_MAX_WAIT_TICKS);
}

function getQuestHelperSceneMarkerTileReadPoints(box: CyanBox, bitmap: ScreenBitmap): ScreenPoint[] {
  const center = { x: box.centerX, y: box.centerY };
  const points = [
    center,
    { x: box.centerX, y: box.centerY + Math.round(box.height * 0.18) },
    { x: box.centerX, y: box.centerY - Math.round(box.height * 0.18) },
    { x: box.centerX - Math.round(box.width * 0.18), y: box.centerY },
    { x: box.centerX + Math.round(box.width * 0.18), y: box.centerY },
    { x: box.centerX, y: box.y + Math.round(box.height * 0.28) },
    { x: box.centerX, y: box.y + Math.round(box.height * 0.72) },
  ];
  const seen = new Set<string>();
  return points
    .map((point) => ({
      x: clamp(Math.round(point.x), 0, bitmap.width - 1),
      y: clamp(Math.round(point.y), 0, bitmap.height - 1),
    }))
    .filter((point) => {
      const key = `${point.x},${point.y}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, SECTION_ONE_STEP_TWO_SCENE_MARKER_TILE_READ_ATTEMPTS);
}

function pickQuestHelperSceneMarkerTileRead(
  reads: Array<{
    tile: GeneralStoreTile;
    localPoint: ScreenPoint;
    screenPoint: ScreenPoint;
    probe: GeneralStoreMouseCoordinateProbe;
  }>,
  marker: CyanBox,
): {
  tile: GeneralStoreTile;
  localPoint: ScreenPoint;
  screenPoint: ScreenPoint;
  probe: GeneralStoreMouseCoordinateProbe;
} | null {
  if (reads.length === 0) {
    return null;
  }

  const grouped = new Map<
    string,
    {
      count: number;
      bestDistance: number;
      read: (typeof reads)[number];
    }
  >();
  for (const read of reads) {
    const key = formatGeneralStoreTile(read.tile);
    const distance = Math.hypot(read.localPoint.x - marker.centerX, read.localPoint.y - marker.centerY);
    const existing = grouped.get(key);
    if (!existing || distance < existing.bestDistance) {
      grouped.set(key, { count: (existing?.count ?? 0) + 1, bestDistance: distance, read });
    } else {
      existing.count += 1;
    }
  }

  return (
    Array.from(grouped.values())
      .sort((left, right) => right.count - left.count || left.bestDistance - right.bestDistance)[0]?.read ?? null
  );
}

async function readQuestHelperSceneMarkerTile(
  calibration: StartupPlayerTileCalibration,
  marker: CyanBox,
  token: number,
  label: string,
): Promise<{
  tile: GeneralStoreTile;
  localPoint: ScreenPoint;
  screenPoint: ScreenPoint;
  probe: GeneralStoreMouseCoordinateProbe;
  attempts: string[];
} | null> {
  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const localPoints = getQuestHelperSceneMarkerTileReadPoints(marker, bitmap);
  const debugTarget = calibration.playerTile ?? { x: 0, y: 0, z: 0 };
  const reads: Array<{
    tile: GeneralStoreTile;
    localPoint: ScreenPoint;
    screenPoint: ScreenPoint;
    probe: GeneralStoreMouseCoordinateProbe;
  }> = [];
  const attempts: string[] = [];

  for (let index = 0; index < localPoints.length && isCurrentRunActive(token); index += 1) {
    const localPoint = localPoints[index];
    const screenPoint = getSafeScreenPoint(
      calibration.captureBounds.x + localPoint.x,
      calibration.captureBounds.y + localPoint.y,
      calibration.captureBounds,
      GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    );
    const movedPoint = await moveMouseHumanLike(screenPoint.x, screenPoint.y, calibration.captureBounds, {
      minDurationMs: GENERAL_STORE_MOUSE_MOVE_MIN_MS,
      maxDurationMs: GENERAL_STORE_MOUSE_MOVE_MAX_MS,
      minStepMs: 14,
      maxStepMs: 34,
      jitterPx: GENERAL_STORE_MOUSE_MOVE_JITTER_PX,
      overshootChance: GENERAL_STORE_MOUSE_MOVE_OVERSHOOT_CHANCE,
      maxOvershootPx: 7,
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      shouldContinue: () => isCurrentRunActive(token),
    });
    if (!isCurrentRunActive(token)) {
      return null;
    }

    await sleepWithAbort(
      randomIntInclusive(
        SECTION_ONE_STEP_TWO_SCENE_MARKER_TILE_READ_SETTLE_MIN_MS,
        SECTION_ONE_STEP_TWO_SCENE_MARKER_TILE_READ_SETTLE_MAX_MS,
      ),
      () => isCurrentRunActive(token),
    );
    const probe = await readGeneralStoreMouseCoordinateAtPoint(
      screenPoint,
      calibration,
      { x: debugTarget.x, y: debugTarget.y, z: debugTarget.z },
      700 + index,
    );
    const read = probe.read;
    if (!read) {
      attempts.push(`#${index + 1}@${localPoint.x},${localPoint.y}:no-read moved=${movedPoint.x},${movedPoint.y} img=${path.basename(probe.debugPath)}`);
      continue;
    }

    attempts.push(
      `#${index + 1}@${localPoint.x},${localPoint.y}:${formatGeneralStoreTile(read.tile)} line='${read.line}' moved=${movedPoint.x},${movedPoint.y} img=${path.basename(probe.debugPath)}`,
    );
    reads.push({
      tile: read.tile,
      localPoint,
      screenPoint,
      probe,
    });
  }

  const selected = pickQuestHelperSceneMarkerTileRead(reads, marker);
  if (!selected) {
    warn(
      `Section 1.1 Step 2 dig marker tile read failed: marker=${formatCyanBoxForLog(marker)} label=${label} attempts=${attempts.join("; ") || "none"}.`,
    );
    return null;
  }

  log(
    `Section 1.1 Step 2 dig marker tile read: tile=${formatGeneralStoreTile(selected.tile)} marker=${formatCyanBoxForLog(marker)} local=${selected.localPoint.x},${selected.localPoint.y} screen=${selected.screenPoint.x},${selected.screenPoint.y} line='${selected.probe.read?.line ?? "none"}' attempts=${attempts.join("; ") || "none"}.`,
  );
  return {
    ...selected,
    attempts,
  };
}

function estimateVisibleDigTileDirectWaitTicks(
  playerTile: GeneralStoreTile,
  digTile: GeneralStoreTile,
  clickLocalPoint: ScreenPoint,
  calibration: StartupPlayerTileCalibration,
): number {
  const distanceTiles = tileDistance(playerTile, digTile);
  const travelTicks = Math.max(1, Math.ceil(distanceTiles / GENERAL_STORE_PLAYER_SPEED_TILES_PER_TICK));
  const targetYRatio = clickLocalPoint.y / Math.max(1, calibration.captureBounds.height);
  const axisTotal = Math.abs(digTile.x - playerTile.x) + Math.abs(digTile.y - playerTile.y);
  const axisDominanceRatio =
    Math.max(Math.abs(digTile.x - playerTile.x), Math.abs(digTile.y - playerTile.y)) / Math.max(1, axisTotal);
  const movementBuffer = estimateMovementModelBuffer(distanceTiles, targetYRatio, axisDominanceRatio);
  return clamp(
    travelTicks + GENERAL_STORE_BASE_EXTRA_WAIT_TICKS + movementBuffer.extraWaitTicks + randomIntInclusive(0, 1),
    GENERAL_STORE_MIN_WAIT_TICKS,
    GENERAL_STORE_MAX_WAIT_TICKS,
  );
}

async function clickVisibleDigTileMarkerAndWait(
  calibration: StartupPlayerTileCalibration,
  markerTile: NonNullable<Awaited<ReturnType<typeof readQuestHelperSceneMarkerTile>>>,
  token: number,
): Promise<boolean> {
  if (!calibration.playerTile) {
    return false;
  }

  if (isSameGeneralStoreTile(calibration.playerTile, markerTile.tile)) {
    log(
      `Section 1.1 Step 2 dig direct marker click skipped: player is already on dig tile ${formatGeneralStoreTile(markerTile.tile)}.`,
    );
    return true;
  }

  const movedPoint = await moveMouseHumanLike(markerTile.screenPoint.x, markerTile.screenPoint.y, calibration.captureBounds, {
    minDurationMs: SECTION_ONE_STEP_TWO_SCENE_MARKER_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_TWO_SCENE_MARKER_MOVE_MAX_MS,
    minStepMs: 15,
    maxStepMs: 36,
    jitterPx: 1.8,
    overshootChance: 0.13,
    maxOvershootPx: 8,
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const clickedPoint = clickScreenPoint(markerTile.screenPoint.x, markerTile.screenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(65, 155),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  const waitTicks = estimateVisibleDigTileDirectWaitTicks(
    calibration.playerTile,
    markerTile.tile,
    markerTile.localPoint,
    calibration,
  );
  log(
    `Section 1.1 Step 2 dig direct marker click: player=${formatGeneralStoreTile(calibration.playerTile)} digTile=${formatGeneralStoreTile(markerTile.tile)} distance=${tileDistance(calibration.playerTile, markerTile.tile)} tile(s) markerLocal=${markerTile.localPoint.x},${markerTile.localPoint.y} markerScreen=${markerTile.screenPoint.x},${markerTile.screenPoint.y} moved=${movedPoint.x},${movedPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} waitTicks=${waitTicks}.`,
  );

  await sleepWithAbort(ticksToMs(waitTicks, GAME_TICK_MS) + randomIntInclusive(120, 360), () => isCurrentRunActive(token));
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 2 dig direct arrival check stopped: RuneLite window not found.");
    return false;
  }

  let trustedCoordinateBox: StartupPlayerTileCalibration["coordinateBox"] = calibration.coordinateBox ?? null;
  let lastPlayerTile: StartupPlayerTileCalibration["playerTile"] = calibration.playerTile;
  for (
    let attempt = 1;
    attempt <= SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_ATTEMPTS && isCurrentRunActive(token);
    attempt += 1
  ) {
    const nextCalibration = readStartupPlayerTileCalibration(runeLiteWindow, {
      requireRuneLiteCoordinatePattern: true,
      preferredCoordinateBox: trustedCoordinateBox,
      lockToPreferredCoordinateBox: trustedCoordinateBox !== null,
      expectedTile: lastPlayerTile,
      maxTileJump: GENERAL_STORE_MAX_COORDINATE_JUMP_TILES,
    });
    if (!nextCalibration) {
      warn(`Section 1.1 Step 2 dig direct arrival check ${attempt}: RuneLite screenshot calibration failed.`);
      return false;
    }

    trustedCoordinateBox = nextCalibration.coordinateBox ?? trustedCoordinateBox;
    lastPlayerTile = nextCalibration.playerTile ?? lastPlayerTile;
    if (nextCalibration.playerTile && isSameGeneralStoreTile(nextCalibration.playerTile, markerTile.tile)) {
      log(
        `Section 1.1 Step 2 dig direct arrival confirmed: player=${formatGeneralStoreTile(nextCalibration.playerTile)} digTile=${formatGeneralStoreTile(markerTile.tile)} attempt=${attempt}/${SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_ATTEMPTS}.`,
      );
      return true;
    }

    log(
      `Section 1.1 Step 2 dig direct arrival pending: attempt=${attempt}/${SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_ATTEMPTS} player=${nextCalibration.playerTile ? formatGeneralStoreTile(nextCalibration.playerTile) : "unknown"} digTile=${formatGeneralStoreTile(markerTile.tile)} raw='${nextCalibration.coordinateLine ?? "unavailable"}' box=${formatCoordinateBoxForLog(nextCalibration)} debug=${nextCalibration.coordinateDebugPath ?? "none"}.`,
    );
    await sleepWithAbort(
      randomIntInclusive(SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_MIN_MS, SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_MAX_MS),
      () => isCurrentRunActive(token),
    );
  }

  if (isCurrentRunActive(token)) {
    warn(
      `Section 1.1 Step 2 dig direct arrival stopped: player did not reach ${formatGeneralStoreTile(markerTile.tile)} after ${SECTION_ONE_STEP_TWO_DIG_DIRECT_ARRIVAL_POLL_ATTEMPTS} check(s). lastPlayer=${lastPlayerTile ? formatGeneralStoreTile(lastPlayerTile) : "unknown"}.`,
    );
  }
  return false;
}

function estimateQuestHelperMinimapArrowWaitTicks(detection: QuestHelperMinimapArrowDetection): number {
  const selected = detection.selected;
  if (!selected) {
    return GENERAL_STORE_MIN_WAIT_TICKS;
  }

  const distanceRatio =
    Math.hypot(selected.centerX - detection.minimap.centerLocalX, selected.centerY - detection.minimap.centerLocalY) /
    Math.max(1, detection.minimap.radiusPx);
  return clamp(Math.round(3 + distanceRatio * 7) + randomIntInclusive(0, 1), 3, GENERAL_STORE_MAX_WAIT_TICKS);
}

function projectGeneralStoreTileClick(
  calibration: StartupPlayerTileCalibration,
  waypoint: GeneralStoreTile,
  pathTiles: number,
  source: GeneralStoreClickPlan["source"],
): GeneralStoreClickPlan | null {
  const playerTile = calibration.playerTile;
  if (!playerTile) {
    return null;
  }

  const minimap = inferGeneralStoreMinimap(calibration);
  const geometry: MinimapWorldClickGeometry = {
    centerLocalX: minimap.centerLocalX,
    centerLocalY: minimap.centerLocalY,
    radiusPx: minimap.radiusPx,
    tilePx: minimap.tilePx,
    source: minimap.source,
    detectionScore: null,
    detectionSummary: `end-to-end-${minimap.source}`,
    candidates: [],
    expectedCenterLocalX: minimap.centerLocalX,
    expectedCenterLocalY: minimap.centerLocalY,
    expectedRadiusPx: minimap.radiusPx,
  };
  const plan = projectWorldTileToMinimapClick(calibration, null, playerTile, waypoint, {
    geometry,
    maxClickRadiusRatio: GENERAL_STORE_MINIMAP_MAX_CLICK_RADIUS_RATIO,
    jitterPx: Math.max(1, Math.round(minimap.tilePx * 0.6)),
  });
  if (!plan) {
    return null;
  }

  return {
    screenPoint: plan.screenPoint,
    projectedScreenPoint: plan.projectedScreenPoint,
    minimapCenter: plan.minimapCenter,
    dxTiles: plan.dxTiles,
    dyTiles: plan.dyTiles,
    distanceTiles: plan.distanceTiles,
    pathTiles: Math.max(1, pathTiles),
    minimapRadiusPx: plan.minimapRadiusPx,
    minimapTilePx: plan.minimapTilePx,
    effectiveMinimapTilePx: plan.effectiveMinimapTilePx,
    minimapTilePxScale: plan.minimapTilePxScale,
    minimapRadiusRatio: plan.minimapRadiusRatio,
    projectionOffsetLocalX: plan.projectionOffsetLocalX,
    projectionOffsetLocalY: plan.projectionOffsetLocalY,
    minimapCalibrationSource: plan.minimapCalibrationSource,
    maxClickDistancePx: plan.maxClickDistancePx,
    wasVectorClamped: plan.wasVectorClamped,
    minimapSource: minimap.source,
    projectionSource: plan.projectionSource,
    source,
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
    extraWaitTicks += 1;
    reasons.push(`long>=${MOVEMENT_MODEL_LONG_DISTANCE_TILES}`);
  }

  if (distanceTiles >= MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES) {
    extraWaitTicks += 1;
    reasons.push(`veryLong>=${MOVEMENT_MODEL_VERY_LONG_DISTANCE_TILES}`);
  }

  if (targetYRatio !== null && distanceTiles >= MOVEMENT_MODEL_TOP_SCREEN_DISTANCE_TILES && targetYRatio <= MOVEMENT_MODEL_TOP_SCREEN_Y_RATIO) {
    extraWaitTicks += 1;
    reasons.push(`topY=${targetYRatio.toFixed(2)}`);
  }

  if (
    distanceTiles >= MOVEMENT_MODEL_AXIS_DOMINANCE_DISTANCE_TILES &&
    axisDominanceRatio >= MOVEMENT_MODEL_AXIS_DOMINANCE_RATIO
  ) {
    extraWaitTicks += 1;
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

function estimateGeneralStoreTravelWait(clickPlan: GeneralStoreClickPlan): GeneralStoreTravelEstimate {
  const travelTicks = Math.max(1, Math.ceil(clickPlan.pathTiles / GENERAL_STORE_PLAYER_SPEED_TILES_PER_TICK));
  const baseWaitTicks = clamp(
    travelTicks + GENERAL_STORE_BASE_EXTRA_WAIT_TICKS,
    GENERAL_STORE_MIN_WAIT_TICKS,
    GENERAL_STORE_MAX_WAIT_TICKS,
  );
  const dxPx = clickPlan.screenPoint.x - clickPlan.minimapCenter.x;
  const dyPx = clickPlan.screenPoint.y - clickPlan.minimapCenter.y;
  const targetYRatio = null;
  const absDxPx = Math.abs(dxPx);
  const absDyPx = Math.abs(dyPx);
  const axisDominanceRatio = Math.max(absDxPx, absDyPx) / Math.max(1, absDxPx + absDyPx);
  const movementBuffer = estimateMovementModelBuffer(clickPlan.pathTiles, targetYRatio, axisDominanceRatio);
  const waitTicks = clamp(
    baseWaitTicks + movementBuffer.extraWaitTicks + randomIntInclusive(0, 1),
    GENERAL_STORE_MIN_WAIT_TICKS,
    GENERAL_STORE_MAX_WAIT_TICKS,
  );

  return {
    waitTicks,
    baseWaitTicks,
    travelTicks,
    distanceTiles: clickPlan.pathTiles,
    tilePx: clickPlan.minimapTilePx,
    dxPx,
    dyPx,
    movementExtraWaitTicks: movementBuffer.extraWaitTicks,
    movementReasons: movementBuffer.reasons,
  };
}

function estimateGeneralStoreSceneTravelWait(clickPlan: GeneralStoreSceneClickPlan): GeneralStoreTravelEstimate {
  const travelTicks = Math.max(1, Math.ceil(clickPlan.pathTiles / GENERAL_STORE_PLAYER_SPEED_TILES_PER_TICK));
  const baseWaitTicks = clamp(
    travelTicks + GENERAL_STORE_BASE_EXTRA_WAIT_TICKS,
    GENERAL_STORE_MIN_WAIT_TICKS,
    GENERAL_STORE_MAX_WAIT_TICKS,
  );
  const dxPx = clickPlan.screenPoint.x - clickPlan.anchorScreenPoint.x;
  const dyPx = clickPlan.screenPoint.y - clickPlan.anchorScreenPoint.y;
  const targetYRatio =
    (clickPlan.screenPoint.y - (clickPlan.anchorScreenPoint.y - clickPlan.projection.anchorLocalY)) /
    Math.max(1, clickPlan.projection.sceneBottom - clickPlan.projection.sceneTop);
  const absDxTiles = Math.abs(clickPlan.dxTiles);
  const absDyTiles = Math.abs(clickPlan.dyTiles);
  const axisDominanceRatio = Math.max(absDxTiles, absDyTiles) / Math.max(1, absDxTiles + absDyTiles);
  const movementBuffer = estimateMovementModelBuffer(clickPlan.pathTiles, targetYRatio, axisDominanceRatio);
  const waitTicks = clamp(
    baseWaitTicks + movementBuffer.extraWaitTicks + randomIntInclusive(0, 1),
    GENERAL_STORE_MIN_WAIT_TICKS,
    GENERAL_STORE_MAX_WAIT_TICKS,
  );

  return {
    waitTicks,
    baseWaitTicks,
    travelTicks,
    distanceTiles: clickPlan.pathTiles,
    tilePx: clickPlan.tilePx,
    dxPx,
    dyPx,
    movementExtraWaitTicks: movementBuffer.extraWaitTicks,
    movementReasons: movementBuffer.reasons,
  };
}

function formatGeneralStoreTravelEstimate(travel: GeneralStoreTravelEstimate): string {
  const movement =
    travel.movementExtraWaitTicks > 0
      ? ` movement=+${travel.movementExtraWaitTicks} reason=${travel.movementReasons.join("+")}`
      : "";
  return `dx=${Math.round(travel.dxPx)}px dy=${Math.round(travel.dyPx)}px tiles~${travel.distanceTiles.toFixed(1)} tilePx=${travel.tilePx}px travel=${travel.travelTicks} tick(s) baseWait=${travel.baseWaitTicks} wait=${travel.waitTicks} tick(s)${movement}`;
}

function formatCoordinateBoxForLog(calibration: StartupPlayerTileCalibration): string {
  const box = calibration.coordinateBox;
  if (!box) {
    return "unavailable";
  }

  return `local=${box.x},${box.y},${box.width}x${box.height} screen=${calibration.captureBounds.x + box.x},${calibration.captureBounds.y + box.y},${box.width}x${box.height}`;
}

function formatCoordinateReadAttemptsForLog(
  calibration: StartupPlayerTileCalibration,
  maxAttempts: number = 6,
): string {
  const attempts = calibration.coordinateReadAttempts;
  if (attempts.length === 0) {
    return "none";
  }

  const shown = attempts.slice(0, maxAttempts).join(" | ");
  return attempts.length > maxAttempts ? `${shown} | ... +${attempts.length - maxAttempts}` : shown;
}

function toEndToEndPathTile(tile: Pick<GeneralStoreTile, "x" | "y" | "z"> | undefined): EndToEndPathTile | null {
  if (!tile) {
    return null;
  }

  return {
    x: tile.x,
    y: tile.y,
    z: tile.z,
  };
}

function saveGeneralStoreRoutePathSnapshot(
  calibration: StartupPlayerTileCalibration,
  route: EndToEndGeneralStoreRoutePlan,
  waypoint: GeneralStoreWaypointSelection | null,
  options: {
    idPrefix: string;
    label: string;
    sourceStep: string;
  },
): string | null {
  if (!calibration.playerTile || route.pathTiles.length === 0) {
    return null;
  }

  const snapshot: EndToEndRoutePathSnapshot = {
    schemaVersion: 1,
    id: `${options.idPrefix}-${Date.now()}`,
    botId: "end-to-end",
    label: options.label,
    sourceStep: options.sourceStep,
    destinationLabel: route.destinationLabel,
    createdAt: new Date().toISOString(),
    routeStatus: route.status,
    regionX: calibration.playerTile.regionX,
    regionY: calibration.playerTile.regionY,
    plane: calibration.playerTile.z,
    playerTile: toEndToEndPathTile(calibration.playerTile)!,
    destinationTile: toEndToEndPathTile(route.destinationTile ?? route.storeTile),
    storeTile: toEndToEndPathTile(route.storeTile),
    targetTile: toEndToEndPathTile(route.targetTile),
    clickTile: toEndToEndPathTile(waypoint?.tile),
    pathTiles: route.pathTiles.map((tile) => toEndToEndPathTile(tile)!),
    pathLength: route.pathLength,
    nextWaypointPathLength: route.nextWaypointPathLength,
    selectionReason: waypoint?.reason ?? null,
  };

  return saveLatestEndToEndRoutePathSnapshot(snapshot).filePath;
}

function buildEndToEndDebugTimestamp(): string {
  const now = new Date();
  const pad2 = (value: number): string => String(value).padStart(2, "0");
  const pad3 = (value: number): string => String(value).padStart(3, "0");
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(
    now.getMinutes(),
  )}${pad2(now.getSeconds())}-${pad3(now.getMilliseconds())}`;
}

function sanitizeEndToEndDebugSlug(slug: string): string {
  return slug.replace(/\.png$/i, "").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "debug";
}

function buildEndToEndDebugFileName(slug: string, timestamp = buildEndToEndDebugTimestamp()): string {
  return `${timestamp}-${sanitizeEndToEndDebugSlug(slug)}.png`;
}

function buildEndToEndDebugPath(slug: string, timestamp?: string): string {
  return path.join(GENERAL_STORE_MOUSE_OCR_DEBUG_DIR, buildEndToEndDebugFileName(slug, timestamp));
}

function buildEndToEndQuestDebugPath(slug: string, timestamp?: string): string {
  return path.join("test-images", "quest", buildEndToEndDebugFileName(slug, timestamp));
}

type EndToEndChatboxTextCandidate = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type EndToEndChatboxTextClickPoint = {
  point: ScreenPoint;
  source: "current-hover" | "random-text";
};

type EndToEndChatboxDetection = {
  searchRoi: ItemIconSearchRoi;
  chatboxBox: { x: number; y: number; width: number; height: number } | null;
  textRoi: ItemIconSearchRoi;
  source: "dialogue-parchment" | "fallback";
  beigePixelCount: number;
};

type EndToEndChatboxBlueTextDetection = {
  searchRoi: ItemIconSearchRoi;
  chatbox: EndToEndChatboxDetection;
  blueCandidates: EndToEndChatboxTextCandidate[];
  whiteCandidates: EndToEndChatboxTextCandidate[];
  target: EndToEndChatboxTextCandidate | null;
  targetColor: "blue" | "white" | null;
};

type EndToEndChatboxTextRow = {
  pixelCount: number;
  minX: number;
  maxX: number;
  sumX: number;
  sumY: number;
};

type EndToEndChatboxTextBandAccumulator = {
  startY: number;
  endY: number;
  pixelCount: number;
  minX: number;
  maxX: number;
  sumX: number;
  sumY: number;
};

type EndToEndChatboxBeigeBand = {
  startY: number;
  endY: number;
  pixelCount: number;
  minX: number;
  maxX: number;
};

function resolveEndToEndChatboxFallbackSearchRoi(bitmap: ScreenBitmap): ItemIconSearchRoi {
  const left = clamp(Math.round(bitmap.width * 0.015), 0, bitmap.width - 1);
  const top = clamp(Math.round(bitmap.height * 0.82), 0, bitmap.height - 1);
  const right = clamp(Math.round(bitmap.width * 0.52), left, bitmap.width - 1);
  const bottom = clamp(Math.round(bitmap.height * 0.97), top, bitmap.height - 1);
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function resolveEndToEndChatboxBeigeSearchRoi(bitmap: ScreenBitmap): ItemIconSearchRoi {
  const left = clamp(Math.round(bitmap.width * 0.005), 0, bitmap.width - 1);
  const top = clamp(Math.round(bitmap.height * 0.76), 0, bitmap.height - 1);
  const right = clamp(Math.round(bitmap.width * 0.54), left, bitmap.width - 1);
  const bottom = clamp(Math.round(bitmap.height * 0.985), top, bitmap.height - 1);
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function isEndToEndChatboxParchmentPixel(r: number, g: number, b: number): boolean {
  const tan = r >= 115 && r <= 245 && g >= 95 && g <= 230 && b >= 55 && b <= 200;
  const warm = r >= g - 8 && r - b >= 22 && g - b >= 8;
  const notOrangeMarker = !(r >= 230 && g >= 130 && g <= 190 && b <= 40);
  return tan && warm && notOrangeMarker;
}

function detectEndToEndChatbox(bitmap: ScreenBitmap): EndToEndChatboxDetection {
  const searchRoi = resolveEndToEndChatboxBeigeSearchRoi(bitmap);
  const rowThreshold = Math.max(28, Math.round(searchRoi.width * SECTION_ONE_STEP_TWO_CHATBOX_BEIGE_MIN_ROW_RATIO));
  const rowBands: EndToEndChatboxBeigeBand[] = [];
  let active: EndToEndChatboxBeigeBand | null = null;
  let activeGapRows = 0;
  const maxGapRows = 3;
  const searchMaxX = searchRoi.x + searchRoi.width - 1;
  const searchMaxY = searchRoi.y + searchRoi.height - 1;

  const pushActive = (): void => {
    if (!active) {
      return;
    }
    if (active.endY - active.startY + 1 >= SECTION_ONE_STEP_TWO_CHATBOX_BEIGE_MIN_BAND_HEIGHT_PX) {
      rowBands.push(active);
    }
    active = null;
    activeGapRows = 0;
  };

  for (let y = searchRoi.y; y <= searchMaxY; y += 1) {
    let rowPixelCount = 0;
    let rowMinX = Number.POSITIVE_INFINITY;
    let rowMaxX = Number.NEGATIVE_INFINITY;

    for (let x = searchRoi.x; x <= searchMaxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isEndToEndChatboxParchmentPixel(r, g, b)) {
        continue;
      }

      rowPixelCount += 1;
      rowMinX = Math.min(rowMinX, x);
      rowMaxX = Math.max(rowMaxX, x);
    }

    if (rowPixelCount >= rowThreshold) {
      if (!active) {
        active = {
          startY: y,
          endY: y,
          pixelCount: 0,
          minX: rowMinX,
          maxX: rowMaxX,
        };
      }
      active.endY = y;
      active.pixelCount += rowPixelCount;
      active.minX = Math.min(active.minX, rowMinX);
      active.maxX = Math.max(active.maxX, rowMaxX);
      activeGapRows = 0;
      continue;
    }

    if (active) {
      activeGapRows += 1;
      if (activeGapRows > maxGapRows) {
        pushActive();
      }
    }
  }
  pushActive();

  const selected =
    rowBands
      .filter((band) => band.maxX - band.minX + 1 >= Math.round(bitmap.width * 0.2))
      .sort((a, b) => b.endY - a.endY || b.pixelCount - a.pixelCount)[0] ?? null;
  if (!selected) {
    const fallback = resolveEndToEndChatboxFallbackSearchRoi(bitmap);
    return {
      searchRoi,
      chatboxBox: null,
      textRoi: fallback,
      source: "fallback",
      beigePixelCount: 0,
    };
  }

  const paddingX = 10;
  const paddingBottom = 8;
  const x = clamp(selected.minX - paddingX, 0, bitmap.width - 1);
  const y = clamp(selected.startY - 4, 0, bitmap.height - 1);
  const right = clamp(selected.maxX + paddingX, x, bitmap.width - 1);
  const bottom = clamp(selected.endY + paddingBottom, y, bitmap.height - 1);
  const chatboxBox = {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
  };
  const textTop = clamp(
    chatboxBox.y + Math.round(chatboxBox.height * SECTION_ONE_STEP_TWO_CHATBOX_TEXT_TOP_RATIO),
    chatboxBox.y,
    chatboxBox.y + chatboxBox.height - 1,
  );
  const textRoi = {
    x: clamp(chatboxBox.x + 6, 0, bitmap.width - 1),
    y: textTop,
    width: Math.max(1, Math.min(bitmap.width - (chatboxBox.x + 6), chatboxBox.width - 12)),
    height: Math.max(1, chatboxBox.y + chatboxBox.height - textTop - 4),
  };

  return {
    searchRoi,
    chatboxBox,
    textRoi,
    source: "dialogue-parchment",
    beigePixelCount: selected.pixelCount,
  };
}

function isEndToEndChatboxBlueTextPixel(r: number, g: number, b: number): boolean {
  const saturatedBlue = b >= 150 && r <= 110 && g <= 165 && b - r >= 70 && b - g >= 35;
  const lightBlue = b >= 170 && r <= 130 && g >= 45 && g <= 180 && b - r >= 60 && b - g >= 25;
  return saturatedBlue || lightBlue;
}

function isEndToEndChatboxWhiteTextPixel(r: number, g: number, b: number): boolean {
  return r >= 225 && g >= 225 && b >= 225 && Math.max(r, g, b) - Math.min(r, g, b) <= 35;
}

function detectEndToEndChatboxTextCandidates(
  bitmap: ScreenBitmap,
  searchRoi: ItemIconSearchRoi,
  isTextPixel: (r: number, g: number, b: number) => boolean,
  minPixels: number,
): EndToEndChatboxTextCandidate[] {
  const rows = new Map<number, EndToEndChatboxTextRow>();
  const maxX = searchRoi.x + searchRoi.width - 1;
  const maxY = searchRoi.y + searchRoi.height - 1;

  for (let y = searchRoi.y; y <= maxY; y += 1) {
    let row: EndToEndChatboxTextRow | null = null;
    for (let x = searchRoi.x; x <= maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isTextPixel(r, g, b)) {
        continue;
      }

      if (!row) {
        row = {
          pixelCount: 0,
          minX: x,
          maxX: x,
          sumX: 0,
          sumY: 0,
        };
        rows.set(y, row);
      }
      row.pixelCount += 1;
      row.minX = Math.min(row.minX, x);
      row.maxX = Math.max(row.maxX, x);
      row.sumX += x;
      row.sumY += y;
    }
  }

  const candidates: EndToEndChatboxTextCandidate[] = [];
  let active: EndToEndChatboxTextBandAccumulator | null = null;
  let gapRows = 0;
  const maxGapRows = 2;
  const minRowPixels = 2;

  const pushActive = (): void => {
    if (!active) {
      return;
    }
    const width = active.maxX - active.minX + 1;
    const height = active.endY - active.startY + 1;
    if (
      active.pixelCount >= minPixels &&
      width >= SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MIN_WIDTH_PX &&
      height >= 3 &&
      height <= SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MAX_HEIGHT_PX
    ) {
      candidates.push({
        x: active.minX,
        y: active.startY,
        width,
        height,
        centerX: Math.round(active.sumX / active.pixelCount),
        centerY: Math.round(active.sumY / active.pixelCount),
        pixelCount: active.pixelCount,
        minX: active.minX,
        minY: active.startY,
        maxX: active.maxX,
        maxY: active.endY,
      });
    }
    active = null;
    gapRows = 0;
  };

  for (let y = searchRoi.y; y <= maxY; y += 1) {
    const row = rows.get(y);
    if (row && row.pixelCount >= minRowPixels) {
      if (!active) {
        active = {
          startY: y,
          endY: y,
          pixelCount: 0,
          minX: row.minX,
          maxX: row.maxX,
          sumX: 0,
          sumY: 0,
        };
      }
      active.endY = y;
      active.pixelCount += row.pixelCount;
      active.minX = Math.min(active.minX, row.minX);
      active.maxX = Math.max(active.maxX, row.maxX);
      active.sumX += row.sumX;
      active.sumY += row.sumY;
      gapRows = 0;
      continue;
    }

    if (active) {
      gapRows += 1;
      if (gapRows > maxGapRows) {
        pushActive();
      }
    }
  }
  pushActive();

  return candidates.sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX || b.pixelCount - a.pixelCount);
}

function pickEndToEndChatboxTextTarget(candidates: readonly EndToEndChatboxTextCandidate[]): EndToEndChatboxTextCandidate | null {
  const preferredCandidates = candidates.filter(
    (candidate) =>
      candidate.width >= SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_PREFERRED_MIN_WIDTH_PX &&
      candidate.pixelCount >= SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_PREFERRED_MIN_PIXELS,
  );
  const fallbackCandidates = candidates.filter(
    (candidate) => candidate.width >= SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MIN_WIDTH_PX,
  );
  return (
    (preferredCandidates.length > 0 ? preferredCandidates : fallbackCandidates)
      .slice()
      .sort((a, b) => a.centerY - b.centerY || b.pixelCount - a.pixelCount)[0] ?? null
  );
}

function detectEndToEndChatboxBlueText(bitmap: ScreenBitmap): EndToEndChatboxBlueTextDetection {
  const chatbox = detectEndToEndChatbox(bitmap);
  const searchRoi = chatbox.textRoi;
  const blueCandidates = detectEndToEndChatboxTextCandidates(
    bitmap,
    searchRoi,
    isEndToEndChatboxBlueTextPixel,
    SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MIN_PIXELS,
  );
  const whiteCandidates = detectEndToEndChatboxTextCandidates(
    bitmap,
    searchRoi,
    isEndToEndChatboxWhiteTextPixel,
    SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_BLUE_MIN_PIXELS * 2,
  );
  const blueTarget = pickEndToEndChatboxTextTarget(blueCandidates);
  const whiteTarget = blueTarget ? null : pickEndToEndChatboxTextTarget(whiteCandidates);
  const target = blueTarget ?? whiteTarget;
  return {
    searchRoi,
    chatbox,
    blueCandidates,
    whiteCandidates,
    target,
    targetColor: blueTarget ? "blue" : whiteTarget ? "white" : null,
  };
}

function formatEndToEndChatboxTextCandidate(candidate: EndToEndChatboxTextCandidate): string {
  return `${candidate.centerX},${candidate.centerY} ${candidate.width}x${candidate.height} px=${candidate.pixelCount} bounds=${candidate.minX},${candidate.minY}-${candidate.maxX},${candidate.maxY}`;
}

function formatEndToEndChatboxBlueTextDetection(detection: EndToEndChatboxBlueTextDetection): string {
  return [
    `roi=${detection.searchRoi.x},${detection.searchRoi.y},${detection.searchRoi.width}x${detection.searchRoi.height}`,
    `chatbox=${detection.chatbox.source}:${detection.chatbox.chatboxBox ? `${detection.chatbox.chatboxBox.x},${detection.chatbox.chatboxBox.y},${detection.chatbox.chatboxBox.width}x${detection.chatbox.chatboxBox.height}` : "none"}/beige=${detection.chatbox.beigePixelCount}`,
    `target=${detection.targetColor ?? "none"}:${detection.target ? formatEndToEndChatboxTextCandidate(detection.target) : "none"}`,
    `blue=${detection.blueCandidates.map(formatEndToEndChatboxTextCandidate).join("|") || "none"}`,
    `white=${detection.whiteCandidates.slice(0, 6).map(formatEndToEndChatboxTextCandidate).join("|") || "none"}`,
  ].join(" ");
}

function isPointInsideEndToEndChatboxTextCandidate(
  point: ScreenPoint,
  candidate: EndToEndChatboxTextCandidate,
  paddingPx: number,
): boolean {
  return (
    point.x >= candidate.minX - paddingPx &&
    point.x <= candidate.maxX + paddingPx &&
    point.y >= candidate.minY - paddingPx &&
    point.y <= candidate.maxY + paddingPx
  );
}

function getCurrentMouseLocalPoint(calibration: StartupPlayerTileCalibration, bitmap: ScreenBitmap): ScreenPoint | null {
  const mouse = getMousePos();
  const local = {
    x: mouse.x - calibration.captureBounds.x,
    y: mouse.y - calibration.captureBounds.y,
  };
  if (local.x < 0 || local.y < 0 || local.x >= bitmap.width || local.y >= bitmap.height) {
    return null;
  }
  return local;
}

function getEndToEndChatboxTextClickPoint(
  candidate: EndToEndChatboxTextCandidate,
  bitmap: ScreenBitmap,
  targetColor: "blue" | "white" | null,
  currentMouseLocalPoint: ScreenPoint | null,
): EndToEndChatboxTextClickPoint {
  if (
    targetColor === "white" &&
    currentMouseLocalPoint &&
    isPointInsideEndToEndChatboxTextCandidate(currentMouseLocalPoint, candidate, 8)
  ) {
    return {
      point: currentMouseLocalPoint,
      source: "current-hover",
    };
  }

  const insetX = Math.min(8, Math.max(1, Math.round(candidate.width * 0.08)));
  const insetY = Math.min(3, Math.max(0, Math.round(candidate.height * 0.12)));
  const minX = clamp(candidate.minX + insetX, 0, bitmap.width - 1);
  const maxX = clamp(candidate.maxX - insetX, minX, bitmap.width - 1);
  const minY = clamp(candidate.minY + insetY, 0, bitmap.height - 1);
  const maxY = clamp(candidate.maxY - insetY, minY, bitmap.height - 1);
  return {
    point: {
      x: randomIntInclusive(minX, maxX),
      y: randomIntInclusive(minY, maxY),
    },
    source: "random-text",
  };
}

async function saveEndToEndChatboxBlueTextDebug(
  bitmap: ScreenBitmap,
  detection: EndToEndChatboxBlueTextDetection,
  outputPath: string,
  clickPoint?: ScreenPoint,
): Promise<void> {
  const debugDetection: ItemIconTemplateDetection = {
    template: "chatbox-blue-text",
    searchRoi: detection.searchRoi,
    minScore: 0,
    matches: [],
    bestMatch: null,
  };
  await saveBitmapWithItemIconTemplateDebug(bitmap, debugDetection, outputPath, {
    clickPoint,
    debugBoxes: detection.blueCandidates.slice(0, 12),
    menuBoxes: [
      ...(detection.chatbox.chatboxBox ? [detection.chatbox.chatboxBox] : []),
      ...detection.whiteCandidates.slice(0, 6),
    ],
  });
}

function formatInventoryDebugTargetSlots(targetSlots: readonly InventoryPanelTargetSlot[]): string {
  if (targetSlots.length === 0) {
    return "none";
  }

  return targetSlots.map((target) => `slot=${target.slot}${target.label ? `:${target.label}` : ""}`).join(", ");
}

function formatInventorySlotSnapshot(snapshot: RuneLiteLocalApiSnapshot): string {
  if (snapshot.inventory.length === 0) {
    return "empty";
  }

  return snapshot.inventory
    .slice(0, 28)
    .map((item, index) => `${item.slot ?? index}:${item.id}x${item.quantity}`)
    .join(" ");
}

function getRandomInventorySlotClickPoint(slot: InventoryPanelSlot): {
  localPoint: ScreenPoint;
  offsetFromCenter: ScreenPoint;
  insetPx: number;
} {
  const insetPx = clamp(Math.round(Math.min(slot.width, slot.height) * 0.34), 10, 16);
  const minX = slot.x + insetPx;
  const maxX = slot.x + slot.width - 1 - insetPx;
  const minY = slot.y + insetPx;
  const maxY = slot.y + slot.height - 1 - insetPx;
  const minCenterOffsetPx = Math.max(3, Math.round(Math.min(slot.width, slot.height) * 0.09));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const x = randomIntInclusive(minX, maxX);
    const y = randomIntInclusive(minY, maxY);
    const offsetFromCenter = {
      x: x - slot.centerX,
      y: y - slot.centerY,
    };
    if (Math.max(Math.abs(offsetFromCenter.x), Math.abs(offsetFromCenter.y)) >= minCenterOffsetPx) {
      return {
        localPoint: { x, y },
        offsetFromCenter,
        insetPx,
      };
    }
  }

  const x = clamp(slot.centerX + randomIntInclusive(minCenterOffsetPx, minCenterOffsetPx + 3), minX, maxX);
  const y = clamp(slot.centerY + randomIntInclusive(-minCenterOffsetPx - 2, minCenterOffsetPx + 2), minY, maxY);
  return {
    localPoint: { x, y },
    offsetFromCenter: {
      x: x - slot.centerX,
      y: y - slot.centerY,
    },
    insetPx,
  };
}

function normalizeEndToEndItemName(name: string): string {
  return name.toLowerCase().replace(/['\u2019]/g, "").replace(/\s+/g, " ").trim();
}

function findInventorySpade(
  snapshot: RuneLiteLocalApiSnapshot,
  itemNamesById: ReadonlyMap<number, string>,
): (RuneLiteLocalApiItem & { name: string; slot: number }) | null {
  for (const item of snapshot.inventory) {
    const slot = item.slot;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot > 27 || item.quantity <= 0) {
      continue;
    }

    const name = itemNamesById.get(item.id) ?? (item.id === SECTION_ONE_STEP_TWO_SPADE_ITEM_ID ? "Spade" : "");
    if (item.id === SECTION_ONE_STEP_TWO_SPADE_ITEM_ID || normalizeEndToEndItemName(name) === "spade") {
      return {
        ...item,
        name: name || "Spade",
        slot,
      };
    }
  }

  return null;
}

function detectInventoryPanelForRuneLiteLayout(
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
): {
  detection: ReturnType<typeof detectInventoryPanelInScreenshot>;
  rightReservedWidthLogical: number;
  sidePanelOpen: boolean;
  sidePanelIndicator: RuneLiteSidePanelOrangeIndicator | null;
} {
  const sidePanelDetection = detectRuneLiteSidePanelOrangeIndicator(bitmap, {
    rightSearchWidthPx: SECTION_ONE_STEP_TWO_RUNELITE_SIDE_PANEL_ORANGE_SEARCH_RIGHT_WIDTH_PX,
  });
  const sidePanelOpen = Boolean(sidePanelDetection.bestIndicator);
  const rightReservedWidthLogical = sidePanelOpen ? RUNELITE_OPEN_SIDE_PANEL_WIDTH_LOGICAL : 0;
  return {
    detection: detectInventoryPanelInScreenshot(bitmap, {
      scalePercentHint: calibration.windowsScalePercent,
      rightReservedWidthLogical,
    }),
    rightReservedWidthLogical,
    sidePanelOpen,
    sidePanelIndicator: sidePanelDetection.bestIndicator,
  };
}

function getInventoryTabClickPoint(
  detection: ReturnType<typeof detectInventoryPanelInScreenshot>,
  bitmap: ScreenBitmap,
): {
  localPoint: ScreenPoint;
  offsetFromCenter: ScreenPoint;
} {
  const scale = detection.scalePercent / 100;
  const centerX = detection.panelBox.x + Math.round(RUNELITE_INVENTORY_TAB_CENTER_X_LOGICAL * scale);
  const centerY = detection.panelBox.y + Math.round(RUNELITE_INVENTORY_TAB_CENTER_Y_LOGICAL * scale);
  const offsetFromCenter = {
    x: randomIntInclusive(-5, 5),
    y: randomIntInclusive(-3, 3),
  };
  return {
    localPoint: {
      x: clamp(centerX + offsetFromCenter.x, 0, bitmap.width - 1),
      y: clamp(centerY + offsetFromCenter.y, 0, bitmap.height - 1),
    },
    offsetFromCenter,
  };
}

async function clickInventoryTabForDig(
  calibration: StartupPlayerTileCalibration,
  layout: ReturnType<typeof detectInventoryPanelForRuneLiteLayout>,
  bitmap: ScreenBitmap,
  token: number,
): Promise<{ clickedPoint: ScreenPoint; clickLocal: ScreenPoint; offsetFromCenter: ScreenPoint } | null> {
  const tabClick = getInventoryTabClickPoint(layout.detection, bitmap);
  const screenPoint = {
    x: calibration.captureBounds.x + tabClick.localPoint.x,
    y: calibration.captureBounds.y + tabClick.localPoint.y,
  };
  const movedPoint = await moveMouseHumanLike(screenPoint.x, screenPoint.y, calibration.captureBounds, {
    minDurationMs: SECTION_ONE_STEP_TWO_DIG_INVENTORY_TAB_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_TWO_DIG_INVENTORY_TAB_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 34,
    jitterPx: 1.5,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return null;
  }

  const clickedPoint = clickScreenPoint(screenPoint.x, screenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(95, 230),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  log(
    `Section 1.1 Step 2 dig inventory tab: moved=${movedPoint.x},${movedPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} local=${tabClick.localPoint.x},${tabClick.localPoint.y} offset=${tabClick.offsetFromCenter.x},${tabClick.offsetFromCenter.y} sidePanelOpen=${layout.sidePanelOpen ? "yes" : "no"} panel=${formatInventoryPanelDetection(layout.detection)}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_TWO_DIG_AFTER_INVENTORY_TAB_MIN_MS, SECTION_ONE_STEP_TWO_DIG_AFTER_INVENTORY_TAB_MAX_MS),
    () => isCurrentRunActive(token),
  );
  return { clickedPoint, clickLocal: tabClick.localPoint, offsetFromCenter: tabClick.offsetFromCenter };
}

async function clickInventorySpadeForXMarksDig(
  token: number,
  digTile: GeneralStoreTile,
): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return false;
  }

  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 2 dig skipped: RuneLite window not found.");
    return false;
  }

  let snapshot: RuneLiteLocalApiSnapshot;
  try {
    snapshot = await fetchRuneLiteLocalApiSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Section 1.1 Step 2 dig skipped: RuneLite local inventory unavailable before clicking spade: ${message}.`);
    return false;
  }

  const spade = findInventorySpade(snapshot, loadOsrsItemNamesByIdFromCache());
  if (!spade) {
    warn(`Section 1.1 Step 2 dig skipped: Spade is not in a known inventory slot. inventory=${formatInventorySlotSnapshot(snapshot)}.`);
    return false;
  }

  const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
    requireRuneLiteCoordinatePattern: true,
  });
  if (!calibration) {
    warn("Section 1.1 Step 2 dig skipped: RuneLite screenshot calibration failed before clicking spade.");
    return false;
  }

  if (!calibration.playerTile) {
    warn(
      `Section 1.1 Step 2 dig skipped: player tile was not detected before clicking spade. raw='${calibration.coordinateLine ?? "unavailable"}' box=${formatCoordinateBoxForLog(calibration)} debug=${calibration.coordinateDebugPath ?? "none"}.`,
    );
    return false;
  }

  const distanceToDigTile = tileDistance(calibration.playerTile, digTile);
  if (distanceToDigTile > 0 || calibration.playerTile.z !== digTile.z) {
    warn(
      `Section 1.1 Step 2 dig skipped: player is not on dig tile yet. player=${formatGeneralStoreTile(calibration.playerTile)} digTile=${formatGeneralStoreTile(digTile)} distance=${distanceToDigTile} tile(s).`,
    );
    return false;
  }

  const beforeTabBitmap = captureScreenBitmap(calibration.captureBounds);
  const beforeTabLayout = detectInventoryPanelForRuneLiteLayout(beforeTabBitmap, calibration);
  const tabClick = await clickInventoryTabForDig(calibration, beforeTabLayout, beforeTabBitmap, token);
  if (!tabClick || !isCurrentRunActive(token)) {
    return false;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const layout = detectInventoryPanelForRuneLiteLayout(bitmap, calibration);
  const slot = getInventoryPanelSlot(layout.detection, spade.slot);
  if (!slot) {
    warn(
      `Section 1.1 Step 2 dig skipped: Spade inventory slot ${spade.slot} is outside detected inventory geometry. ${formatInventoryPanelDetection(layout.detection)} inventory=${formatInventorySlotSnapshot(snapshot)}.`,
    );
    return false;
  }

  const spadeClick = getRandomInventorySlotClickPoint(slot);
  const spadeScreenPoint: ScreenPoint = {
    x: calibration.captureBounds.x + spadeClick.localPoint.x,
    y: calibration.captureBounds.y + spadeClick.localPoint.y,
  };
  const debugPath = buildEndToEndDebugPath("end-to-end-section-1-step-2-dig-spade-inventory");
  await saveBitmapWithInventoryPanelDebug(bitmap, layout.detection, debugPath, {
    targetSlots: [{ slot: spade.slot, label: spade.name }],
    debugPoints: [
      { x: tabClick.clickLocal.x, y: tabClick.clickLocal.y, label: "inventory-tab" },
      { x: spadeClick.localPoint.x, y: spadeClick.localPoint.y, label: "spade-click" },
    ],
  });

  const movedToSpadePoint = await moveMouseHumanLike(spadeScreenPoint.x, spadeScreenPoint.y, calibration.captureBounds, {
    minDurationMs: SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MAX_MS,
    minStepMs: 16,
    maxStepMs: 36,
    jitterPx: 2.2,
    overshootChance: 0.16,
    maxOvershootPx: 9,
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const clickedPoint = clickScreenPoint(spadeScreenPoint.x, spadeScreenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MIN_MS,
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MAX_MS,
    ),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  log(
    `Section 1.1 Step 2 dig: clicked Spade in inventory. digTile=${formatGeneralStoreTile(digTile)} player=${formatGeneralStoreTile(calibration.playerTile)} item=${spade.name} id=${spade.id} qty=${spade.quantity} slot=${spade.slot} row=${slot.row} col=${slot.col} tabClicked=${tabClick.clickedPoint.x},${tabClick.clickedPoint.y} movedToSpade=${movedToSpadePoint.x},${movedToSpadePoint.y} clicked=${clickedPoint.x},${clickedPoint.y} clickLocal=${spadeClick.localPoint.x},${spadeClick.localPoint.y} offsetFromCenter=${spadeClick.offsetFromCenter.x},${spadeClick.offsetFromCenter.y} sidePanelOpen=${layout.sidePanelOpen ? "yes" : "no"} indicator=${layout.sidePanelIndicator ? `${layout.sidePanelIndicator.centerX},${layout.sidePanelIndicator.centerY}` : "none"} ${formatInventoryPanelDetection(layout.detection)} file=${debugPath}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_TWO_DIG_AFTER_SPADE_CLICK_MIN_MS, SECTION_ONE_STEP_TWO_DIG_AFTER_SPADE_CLICK_MAX_MS),
    () => isCurrentRunActive(token),
  );
  return true;
}

type EndToEndContextMenuDetection = {
  menuBox: { x: number; y: number; width: number; height: number };
  examineLocalPoint: ScreenPoint | null;
  rowHeightPx: number;
  changedPixels: number;
  fillRatio: number;
  distanceFromRightClickPx: number;
  examineSource: "ocr-template" | "not-detected";
  examineMatch: ContextMenuWordMatch | null;
  wordMatches: ContextMenuWordMatch[];
  textBands: ContextMenuTextBand[];
};

type EndToEndContextMenuOptionDetection = {
  menuBox: { x: number; y: number; width: number; height: number };
  optionLocalPoint: ScreenPoint | null;
  rowHeightPx: number;
  changedPixels: number;
  fillRatio: number;
  distanceFromRightClickPx: number;
  optionSource: "ocr-template" | "not-detected";
  optionMatch: ContextMenuWordMatch | null;
  wordMatches: ContextMenuWordMatch[];
  textBands: ContextMenuTextBand[];
};

function getBitmapRgb(bitmap: ScreenBitmap, x: number, y: number): { r: number; g: number; b: number } {
  const safeX = clamp(Math.round(x), 0, bitmap.width - 1);
  const safeY = clamp(Math.round(y), 0, bitmap.height - 1);
  const offset = safeY * bitmap.byteWidth + safeX * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
  };
}

function getPixelDifference(before: ScreenBitmap, after: ScreenBitmap, x: number, y: number): number {
  const a = getBitmapRgb(before, x, y);
  const b = getBitmapRgb(after, x, y);
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function pointDistanceFromBox(point: ScreenPoint, box: { x: number; y: number; width: number; height: number }): number {
  const left = box.x;
  const right = box.x + box.width - 1;
  const top = box.y;
  const bottom = box.y + box.height - 1;
  const dx = point.x < left ? left - point.x : point.x > right ? point.x - right : 0;
  const dy = point.y < top ? top - point.y : point.y > bottom ? point.y - bottom : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

function detectContextMenuOptionFromBitmapDiff(
  before: ScreenBitmap,
  after: ScreenBitmap,
  rightClickLocalPoint: ScreenPoint,
  scalePercent: number,
  targetLabel: ContextMenuLabel,
): EndToEndContextMenuOptionDetection | null {
  if (before.width !== after.width || before.height !== after.height) {
    return null;
  }

  const searchX = clamp(
    rightClickLocalPoint.x - SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_LEFT_PX,
    0,
    Math.max(0, after.width - 1),
  );
  const searchY = clamp(
    rightClickLocalPoint.y - SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_TOP_PX,
    0,
    Math.max(0, after.height - 1),
  );
  const searchRight = clamp(
    rightClickLocalPoint.x + SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_RIGHT_PX,
    searchX,
    Math.max(0, after.width - 1),
  );
  const searchBottom = clamp(
    rightClickLocalPoint.y + SECTION_ONE_STEP_ONE_CONTEXT_MENU_SEARCH_BOTTOM_PX,
    searchY,
    Math.max(0, after.height - 1),
  );
  const searchWidth = searchRight - searchX + 1;
  const searchHeight = searchBottom - searchY + 1;
  const changed = new Uint8Array(searchWidth * searchHeight);
  const seen = new Uint8Array(changed.length);

  for (let y = 0; y < searchHeight; y += 1) {
    for (let x = 0; x < searchWidth; x += 1) {
      const diff = getPixelDifference(before, after, searchX + x, searchY + y);
      if (diff >= SECTION_ONE_STEP_ONE_CONTEXT_MENU_DIFF_THRESHOLD) {
        changed[y * searchWidth + x] = 1;
      }
    }
  }

  let best:
    | {
        box: { x: number; y: number; width: number; height: number };
        pixels: number;
        fillRatio: number;
        distance: number;
        score: number;
      }
    | null = null;
  const queueX: number[] = [];
  const queueY: number[] = [];

  for (let startY = 0; startY < searchHeight; startY += 1) {
    for (let startX = 0; startX < searchWidth; startX += 1) {
      const startIndex = startY * searchWidth + startX;
      if (!changed[startIndex] || seen[startIndex]) {
        continue;
      }

      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;
      let pixels = 0;
      queueX.length = 0;
      queueY.length = 0;
      queueX.push(startX);
      queueY.push(startY);
      seen[startIndex] = 1;

      for (let queueIndex = 0; queueIndex < queueX.length; queueIndex += 1) {
        const x = queueX[queueIndex];
        const y = queueY[queueIndex];
        pixels += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const;
        for (const [neighborX, neighborY] of neighbors) {
          if (neighborX < 0 || neighborY < 0 || neighborX >= searchWidth || neighborY >= searchHeight) {
            continue;
          }

          const neighborIndex = neighborY * searchWidth + neighborX;
          if (changed[neighborIndex] && !seen[neighborIndex]) {
            seen[neighborIndex] = 1;
            queueX.push(neighborX);
            queueY.push(neighborY);
          }
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      if (
        width < SECTION_ONE_STEP_ONE_CONTEXT_MENU_MIN_WIDTH_PX ||
        height < SECTION_ONE_STEP_ONE_CONTEXT_MENU_MIN_HEIGHT_PX ||
        pixels < SECTION_ONE_STEP_ONE_CONTEXT_MENU_MIN_CHANGED_PIXELS
      ) {
        continue;
      }

      const box = {
        x: searchX + minX,
        y: searchY + minY,
        width,
        height,
      };
      const fillRatio = pixels / Math.max(1, width * height);
      if (fillRatio < 0.18) {
        continue;
      }

      const distance = pointDistanceFromBox(rightClickLocalPoint, box);
      if (distance > 260) {
        continue;
      }

      const score = pixels + fillRatio * 2000 - distance * 12 + (distance === 0 ? 2500 : 0);
      if (!best || score > best.score) {
        best = { box, pixels, fillRatio, distance, score };
      }
    }
  }

  if (!best) {
    return null;
  }

  const scale = Number.isFinite(scalePercent) && scalePercent > 0 ? scalePercent / 100 : 1;
  const rowHeightPx = Math.max(12, Math.round(SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPTION_ROW_HEIGHT_LOGICAL * scale));
  const menuX = clamp(best.box.x - 2, 0, after.width - 1);
  const menuY = clamp(best.box.y - 2, 0, after.height - 1);
  const menuBox = {
    x: menuX,
    y: menuY,
    width: clamp(best.box.width + 4, 1, after.width - menuX),
    height: clamp(best.box.height + 4, 1, after.height - menuY),
  };
  const textBands = detectContextMenuTextBands(after, rightClickLocalPoint, { menuBox, rowHeightPx });
  const { match: optionMatch, matches: wordMatches } = findContextMenuLabelMatch(after, textBands, menuBox, targetLabel);
  const optionLocalPoint = optionMatch
    ? {
        x: randomIntInclusive(
          clamp(optionMatch.wordBox.x + Math.max(4, Math.round(optionMatch.wordBox.width * 0.18)), 0, after.width - 1),
          clamp(optionMatch.wordBox.x + Math.max(8, Math.round(optionMatch.wordBox.width * 0.74)), 0, after.width - 1),
        ),
        y: clamp(
          optionMatch.band.centerY + randomIntInclusive(-2, 2),
          optionMatch.band.startY,
          optionMatch.band.endY,
        ),
      }
    : null;

  return {
    menuBox,
    optionLocalPoint,
    rowHeightPx,
    changedPixels: best.pixels,
    fillRatio: best.fillRatio,
    distanceFromRightClickPx: best.distance,
    optionSource: optionMatch ? "ocr-template" : "not-detected",
    optionMatch,
    wordMatches,
    textBands,
  };
}

function detectContextMenuFromBitmapDiff(
  before: ScreenBitmap,
  after: ScreenBitmap,
  rightClickLocalPoint: ScreenPoint,
  scalePercent: number,
): EndToEndContextMenuDetection | null {
  const option = detectContextMenuOptionFromBitmapDiff(before, after, rightClickLocalPoint, scalePercent, "Examine");
  if (!option) {
    return null;
  }

  return {
    menuBox: option.menuBox,
    examineLocalPoint: option.optionLocalPoint,
    rowHeightPx: option.rowHeightPx,
    changedPixels: option.changedPixels,
    fillRatio: option.fillRatio,
    distanceFromRightClickPx: option.distanceFromRightClickPx,
    examineSource: option.optionSource,
    examineMatch: option.optionMatch,
    wordMatches: option.wordMatches,
    textBands: option.textBands,
  };
}

function selectFirstContextMenuActionPoint(
  contextMenu: EndToEndContextMenuOptionDetection,
  bitmap: ScreenBitmap,
): { localPoint: ScreenPoint; band: ContextMenuTextBand } | null {
  const actionBand = getFirstContextMenuActionBand(contextMenu);
  if (!actionBand) {
    return null;
  }

  const left = clamp(Math.max(contextMenu.menuBox.x + 7, actionBand.minX + 4), 0, bitmap.width - 1);
  const right = clamp(
    Math.min(contextMenu.menuBox.x + contextMenu.menuBox.width - 8, actionBand.maxX - 1, actionBand.minX + 46),
    left,
    bitmap.width - 1,
  );
  return {
    localPoint: {
      x: randomIntInclusive(left, right),
      y: clamp(actionBand.centerY + randomIntInclusive(-2, 2), actionBand.startY, actionBand.endY),
    },
    band: actionBand,
  };
}

function getFirstContextMenuActionBand(contextMenu: EndToEndContextMenuOptionDetection): ContextMenuTextBand | null {
  const sortedBands = [...contextMenu.textBands].sort((a, b) => a.centerY - b.centerY);
  const firstActionMinY =
    contextMenu.menuBox.y + Math.max(contextMenu.rowHeightPx + 2, Math.round(contextMenu.rowHeightPx * 1.25));
  return (
    sortedBands.find((band) => band.centerY >= firstActionMinY && band.centerY < contextMenu.menuBox.y + contextMenu.menuBox.height - 2) ??
    sortedBands.find((band) => band.centerY > contextMenu.menuBox.y + Math.round(contextMenu.rowHeightPx * 0.9)) ??
    null
  );
}

function getDetectedContextMenuActionLocalPoint(contextMenu: EndToEndContextMenuOptionDetection | null): ScreenPoint | null {
  if (!contextMenu?.optionLocalPoint || !contextMenu.optionMatch) {
    return null;
  }

  const firstActionMinY =
    contextMenu.menuBox.y + Math.max(contextMenu.rowHeightPx + 2, Math.round(contextMenu.rowHeightPx * 1.25));
  if (contextMenu.optionMatch.band.centerY < firstActionMinY) {
    return null;
  }

  return contextMenu.optionLocalPoint;
}

function getDetectedFirstContextMenuActionLocalPoint(contextMenu: EndToEndContextMenuOptionDetection | null): ScreenPoint | null {
  if (!contextMenu?.optionLocalPoint || !contextMenu.optionMatch) {
    return null;
  }

  const firstActionBand = getFirstContextMenuActionBand(contextMenu);
  if (!firstActionBand) {
    return null;
  }

  const maxCenterDelta = Math.max(3, Math.round(contextMenu.rowHeightPx * 0.45));
  if (Math.abs(contextMenu.optionMatch.band.centerY - firstActionBand.centerY) > maxCenterDelta) {
    return null;
  }

  return contextMenu.optionLocalPoint;
}

function formatContextMenuFirstActionForLog(contextMenu: EndToEndContextMenuOptionDetection | null): string {
  const firstActionBand = contextMenu ? getFirstContextMenuActionBand(contextMenu) : null;
  return firstActionBand
    ? `${firstActionBand.centerY}:${firstActionBand.minX}-${firstActionBand.maxX}/${firstActionBand.pixelCount}`
    : "none";
}

function formatContextMenuOptionDetectionForLog(contextMenu: EndToEndContextMenuOptionDetection | null): string {
  if (!contextMenu) {
    return "none";
  }

  return [
    `menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height}`,
    `changed=${contextMenu.changedPixels}`,
    `fill=${contextMenu.fillRatio.toFixed(2)}`,
    `first=${formatContextMenuFirstActionForLog(contextMenu)}`,
    `option=${contextMenu.optionMatch ? formatContextMenuWordMatch(contextMenu.optionMatch) : "none"}`,
    `words=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"}`,
  ].join(" ");
}

type EndToEndHoverTextProbe = {
  source: string;
  searchBox: { x: number; y: number; width: number; height: number };
  textBands: ContextMenuTextBand[];
  wordMatches: ContextMenuWordMatch[];
  talkToMatch: ContextMenuWordMatch | null;
};

function makeHoverTextSearchBox(
  bitmap: ScreenBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const left = clamp(Math.round(x), 0, Math.max(0, bitmap.width - 1));
  const top = clamp(Math.round(y), 0, Math.max(0, bitmap.height - 1));
  const right = clamp(Math.round(x + width - 1), left, Math.max(0, bitmap.width - 1));
  const bottom = clamp(Math.round(y + height - 1), top, Math.max(0, bitmap.height - 1));
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function detectTalkToHoverTextNearPoint(
  bitmap: ScreenBitmap,
  hoverLocalPoint: ScreenPoint,
  scalePercent: number,
  targetLabel: ContextMenuLabel = "Talk-to",
): { found: boolean; best: EndToEndHoverTextProbe | null; probes: EndToEndHoverTextProbe[] } {
  const scale = Number.isFinite(scalePercent) && scalePercent > 0 ? scalePercent / 100 : 1;
  const rowHeightPx = Math.max(12, Math.round(SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPTION_ROW_HEIGHT_LOGICAL * scale));
  const candidateBoxes = [
    {
      source: "mouse-right",
      box: makeHoverTextSearchBox(bitmap, hoverLocalPoint.x + 8, hoverLocalPoint.y - 52, 220, 120),
    },
    {
      source: "mouse-left",
      box: makeHoverTextSearchBox(bitmap, hoverLocalPoint.x - 230, hoverLocalPoint.y - 52, 230, 120),
    },
    {
      source: "mouse-above",
      box: makeHoverTextSearchBox(bitmap, hoverLocalPoint.x - 110, hoverLocalPoint.y - 130, 270, 120),
    },
    {
      source: "top-left-action",
      box: makeHoverTextSearchBox(bitmap, 0, 0, 330, 95),
    },
  ];

  const probes = candidateBoxes.map(({ source, box }) => {
    const textBands = detectContextMenuTextBands(bitmap, hoverLocalPoint, { menuBox: box, rowHeightPx });
    const { match: talkToMatch, matches: wordMatches } = findContextMenuLabelMatch(bitmap, textBands, box, targetLabel);
    return {
      source,
      searchBox: box,
      textBands,
      wordMatches,
      talkToMatch,
    };
  });
  const best =
    probes
      .filter((probe) => probe.talkToMatch)
      .sort((a, b) => (b.talkToMatch?.score ?? 0) - (a.talkToMatch?.score ?? 0))[0] ?? null;
  return {
    found: best !== null,
    best,
    probes,
  };
}

function formatHoverTextProbeForLog(probe: EndToEndHoverTextProbe): string {
  return [
    `${probe.source}=${probe.searchBox.x},${probe.searchBox.y},${probe.searchBox.width}x${probe.searchBox.height}`,
    `bands=${probe.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"}`,
    `match=${probe.talkToMatch ? formatContextMenuWordMatch(probe.talkToMatch) : "none"}`,
    `words=${probe.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"}`,
  ].join(" ");
}

async function saveSectionOneStepOneInventoryDebug(
  state: EndToEndSectionOneStepOneState,
  token: number,
): Promise<void> {
  if (!isCurrentRunActive(token)) {
    return;
  }

  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 1 inventory debug skipped: RuneLite window not found.");
    return;
  }

  const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
    requireRuneLiteCoordinatePattern: false,
  });
  if (!calibration) {
    warn("Section 1.1 Step 1 inventory debug skipped: RuneLite screenshot capture bounds unavailable.");
    return;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const detection = detectInventoryPanelInScreenshot(bitmap, {
    scalePercentHint: calibration.windowsScalePercent,
  });
  const targetSlots = state.presentTargetItems
    .filter((item) => item.source === "inventory" && item.slot !== undefined)
    .map((item) => ({
      slot: item.slot!,
      label: item.name,
    }));
  const equippedTargets = state.presentTargetItems
    .filter((item) => item.source === "equipment")
    .map((item) => item.name)
    .join(", ");
  const outputPath = buildEndToEndDebugPath("end-to-end-section-1-step-1-inventory");

  await saveBitmapWithInventoryPanelDebug(bitmap, detection, outputPath, { targetSlots });
  log(
    `Section 1.1 Step 1 inventory debug saved: ${formatInventoryPanelDetection(detection)} targetSlots=${formatInventoryDebugTargetSlots(targetSlots)} equippedTargets=${equippedTargets || "none"} capture=${calibration.captureBounds.width}x${calibration.captureBounds.height} scale=${calibration.windowsScalePercent}% file=${outputPath}.`,
  );
}

function getInventoryStepOneExamineTargets(
  state: EndToEndSectionOneStepOneState,
): EndToEndSectionOneStepOneItem[] {
  return state.presentTargetItems
    .filter((item) => item.source === "inventory" && item.slot !== undefined && item.slot >= 0 && item.slot <= 27)
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}

function formatEndToEndStepOneItem(item: EndToEndSectionOneStepOneItem): string {
  const slot = item.slot !== undefined ? `#${item.slot}` : "";
  return `${item.name}@${item.source}${slot}`;
}

async function rightClickExamineInventoryItem(
  item: EndToEndSectionOneStepOneItem,
  calibration: StartupPlayerTileCalibration,
  detection: ReturnType<typeof detectInventoryPanelInScreenshot>,
  token: number,
  index: number,
  total: number,
): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const itemSlot = item.slot ?? -1;
  const slot = getInventoryPanelSlot(detection, itemSlot);
  if (!slot) {
    warn(`Section 1.1 Step 1 examine skipped: ${formatEndToEndStepOneItem(item)} slot is outside inventory geometry.`);
    return false;
  }

  const clickPoint = getRandomInventorySlotClickPoint(slot);
  const rightClickPoint: ScreenPoint = {
    x: calibration.captureBounds.x + clickPoint.localPoint.x,
    y: calibration.captureBounds.y + clickPoint.localPoint.y,
  };
  const movedToItemPoint = await moveMouseHumanLike(rightClickPoint.x, rightClickPoint.y, undefined, {
    minDurationMs: SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MAX_MS,
    minStepMs: 16,
    maxStepMs: 36,
    jitterPx: 2.2,
    overshootChance: 0.16,
    maxOvershootPx: 9,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  await sleepWithAbort(randomIntInclusive(55, 130), () => isCurrentRunActive(token));
  const beforeRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
  const rightClickedPoint = clickScreenPoint(rightClickPoint.x, rightClickPoint.y, calibration.captureBounds, {
    button: "right",
    settleMs: randomIntInclusive(
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MIN_MS,
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MAX_MS,
    ),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MIN_MS, SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MAX_MS),
    () => isCurrentRunActive(token),
  );
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const afterRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
  const contextMenu = detectContextMenuFromBitmapDiff(
    beforeRightClickBitmap,
    afterRightClickBitmap,
    clickPoint.localPoint,
    calibration.windowsScalePercent,
  );
  const examineTextBand = contextMenu?.examineMatch?.band ?? null;
  const debugTimestamp = buildEndToEndDebugTimestamp();
  const debugSlug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const rawDebugPath = buildEndToEndDebugPath(
    `end-to-end-section-1-step-1-examine-${index + 1}-${debugSlug}-raw`,
    debugTimestamp,
  );
  const debugPath = buildEndToEndDebugPath(
    `end-to-end-section-1-step-1-examine-${index + 1}-${debugSlug}`,
    debugTimestamp,
  );
  await saveBitmapAsync(afterRightClickBitmap, rawDebugPath);
  await saveBitmapWithInventoryPanelDebug(afterRightClickBitmap, detection, debugPath, {
    targetSlots: [{ slot: itemSlot, label: item.name }],
    debugPoints: [
      { x: clickPoint.localPoint.x, y: clickPoint.localPoint.y, label: "right-click" },
      ...(contextMenu?.examineLocalPoint
        ? [{ x: contextMenu.examineLocalPoint.x, y: contextMenu.examineLocalPoint.y, label: "examine" }]
        : []),
    ],
    debugBoxes: contextMenu
      ? [
          contextMenu.menuBox,
          ...(examineTextBand
            ? [
                {
                  x: examineTextBand.minX,
                  y: examineTextBand.startY,
                  width: examineTextBand.maxX - examineTextBand.minX + 1,
                  height: examineTextBand.endY - examineTextBand.startY + 1,
                  label: "examine-text-band",
                },
              ]
            : []),
          ...(contextMenu.examineMatch
            ? [
                {
                  ...contextMenu.examineMatch.wordBox,
                  label: "examine-template",
                },
              ]
            : []),
        ]
      : [],
  });

  if (!contextMenu) {
    warn(
      `Section 1.1 Step 1 examine ${index + 1}/${total} stopped: context menu was not detected after right-clicking ${formatEndToEndStepOneItem(item)} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} slotLocal=${slot.x},${slot.y},${slot.width}x${slot.height} clickLocal=${clickPoint.localPoint.x},${clickPoint.localPoint.y} file=${debugPath}.`,
    );
    await pressKeyForMs("escape", randomIntInclusive(45, 95), token);
    return false;
  }

  if (!contextMenu.examineLocalPoint) {
    warn(
      `Section 1.1 Step 1 examine ${index + 1}/${total} stopped: context menu was detected but the Examine option was not recognized by OCR/template after right-clicking ${formatEndToEndStepOneItem(item)} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} slotLocal=${slot.x},${slot.y},${slot.width}x${slot.height} clickLocal=${clickPoint.localPoint.x},${clickPoint.localPoint.y} menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} textBands=${contextMenu.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} rawFile=${rawDebugPath} file=${debugPath}.`,
    );
    await pressKeyForMs("escape", randomIntInclusive(45, 95), token);
    return false;
  }

  const examineLocalPoint = contextMenu.examineLocalPoint;
  const examineScreenPoint = {
    x: calibration.captureBounds.x + examineLocalPoint.x,
    y: calibration.captureBounds.y + examineLocalPoint.y,
  };
  const movedToExaminePoint = await moveMouseHumanLike(examineScreenPoint.x, examineScreenPoint.y, undefined, {
    minDurationMs: SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 32,
    jitterPx: 1.6,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const examineClickedPoint = clickScreenPoint(examineScreenPoint.x, examineScreenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(120, 310),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  log(
    `Section 1.1 Step 1 examine ${index + 1}/${total}: item=${item.name} id=${item.id} qty=${item.quantity} slot=${itemSlot} row=${slot.row} col=${slot.col} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} rightClickLocal=${clickPoint.localPoint.x},${clickPoint.localPoint.y} offsetFromCenter=${clickPoint.offsetFromCenter.x},${clickPoint.offsetFromCenter.y} movedToItem=${movedToItemPoint.x},${movedToItemPoint.y} menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} changed=${contextMenu.changedPixels} fill=${contextMenu.fillRatio.toFixed(2)} distance=${contextMenu.distanceFromRightClickPx.toFixed(1)} rowHeight=${contextMenu.rowHeightPx}px examineSource=${contextMenu.examineSource} examineMatch=${contextMenu.examineMatch ? formatContextMenuWordMatch(contextMenu.examineMatch) : "none"} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} textBands=${contextMenu.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"} examineLocal=${examineLocalPoint.x},${examineLocalPoint.y} movedToExamine=${movedToExaminePoint.x},${movedToExaminePoint.y} clicked=${examineClickedPoint.x},${examineClickedPoint.y} rawFile=${rawDebugPath} file=${debugPath}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_ONE_EXAMINE_AFTER_WAIT_MIN_MS, SECTION_ONE_STEP_ONE_EXAMINE_AFTER_WAIT_MAX_MS),
    () => isCurrentRunActive(token),
  );
  return true;
}

async function examineSectionOneStepOneInventoryItems(token: number): Promise<void> {
  if (!isCurrentRunActive(token)) {
    return;
  }

  let snapshot: RuneLiteLocalApiSnapshot;
  try {
    snapshot = await fetchRuneLiteLocalApiSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Section 1.1 Step 1 examine skipped: RuneLite local inventory unavailable: ${message}.`);
    return;
  }

  const currentState = evaluateEndToEndSectionOneStepOne(snapshot, loadOsrsItemNamesByIdFromCache());
  const targets = getInventoryStepOneExamineTargets(currentState);
  const equippedTargets = currentState.presentTargetItems
    .filter((item) => item.source === "equipment")
    .map(formatEndToEndStepOneItem);
  if (equippedTargets.length > 0) {
    warn(`Section 1.1 Step 1 examine equipment skipped for now: ${equippedTargets.join(", ")}.`);
  }
  if (targets.length === 0) {
    warn(
      `Section 1.1 Step 1 examine skipped: no step-1 target items are currently in inventory. inventorySlots=${formatInventorySlotSnapshot(snapshot)}.`,
    );
    return;
  }

  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 1 examine skipped: RuneLite window not found.");
    return;
  }

  const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
    requireRuneLiteCoordinatePattern: false,
  });
  if (!calibration) {
    warn("Section 1.1 Step 1 examine skipped: RuneLite screenshot capture bounds unavailable.");
    return;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const detection = detectInventoryPanelInScreenshot(bitmap, {
    scalePercentHint: calibration.windowsScalePercent,
  });
  log(
    `Section 1.1 Step 1 examine start: targets=${targets.map(formatEndToEndStepOneItem).join(", ")} inventorySlots=${formatInventorySlotSnapshot(snapshot)} ${formatInventoryPanelDetection(detection)} capture=${calibration.captureBounds.width}x${calibration.captureBounds.height} scale=${calibration.windowsScalePercent}%.`,
  );

  for (let index = 0; index < targets.length && isCurrentRunActive(token); index += 1) {
    const success = await rightClickExamineInventoryItem(targets[index], calibration, detection, token, index, targets.length);
    if (!success) {
      break;
    }
  }
}

function formatCyanBoxForLog(box: CyanBox): string {
  return `${box.x},${box.y},${box.width}x${box.height}@${box.centerX},${box.centerY}/px=${box.pixelCount}/fill=${box.fillRatio.toFixed(2)}`;
}

function getSceneRightBoundary(calibration: StartupPlayerTileCalibration): number {
  const scale = getScaleFromCalibration(calibration);
  return calibration.captureBounds.width - Math.round(GENERAL_STORE_SCENE_RIGHT_PANEL_WIDTH_LOGICAL * scale);
}

function getSceneBottomBoundary(calibration: StartupPlayerTileCalibration): number {
  const scale = getScaleFromCalibration(calibration);
  return calibration.captureBounds.height - Math.round(GENERAL_STORE_SCENE_BOTTOM_UI_HEIGHT_LOGICAL * scale);
}

function makeXMarksQuestIconSearchRoi(bitmap: ScreenBitmap, calibration: StartupPlayerTileCalibration): ItemIconSearchRoi {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, Math.min(bitmap.width, getSceneRightBoundary(calibration))),
    height: Math.max(1, Math.min(bitmap.height, getSceneBottomBoundary(calibration))),
  };
}

function distanceFromPointToBox(point: ScreenPoint, box: Pick<CyanBox, "x" | "y" | "width" | "height">): number {
  const right = box.x + box.width - 1;
  const bottom = box.y + box.height - 1;
  const dx = point.x < box.x ? box.x - point.x : point.x > right ? point.x - right : 0;
  const dy = point.y < box.y ? box.y - point.y : point.y > bottom ? point.y - bottom : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

function findCyanBoxForQuestIconMatch(match: ItemIconMatch, cyanBoxes: readonly CyanBox[]): CyanBox | null {
  const matchPoint = { x: match.centerX, y: match.centerY };
  let best: { box: CyanBox; distance: number } | null = null;
  for (const box of cyanBoxes) {
    const distance = distanceFromPointToBox(matchPoint, box);
    if (distance > SECTION_ONE_STEP_TWO_QUEST_ICON_CYAN_MAX_DISTANCE_PX) {
      continue;
    }
    if (!best || distance < best.distance || (distance === best.distance && box.pixelCount > best.box.pixelCount)) {
      best = { box, distance };
    }
  }

  return best?.box ?? null;
}

function selectQuestIconMatchWithCyan(
  matches: readonly ItemIconMatch[],
  cyanBoxes: readonly CyanBox[],
): { match: ItemIconMatch | null; cyanBox: CyanBox | null; source: "cyan-associated" | "template-only" | "none" } {
  let best: { match: ItemIconMatch; cyanBox: CyanBox; score: number } | null = null;
  for (const match of matches) {
    const cyanBox = findCyanBoxForQuestIconMatch(match, cyanBoxes);
    if (!cyanBox) {
      continue;
    }

    const score = match.score * 1000 + cyanBox.pixelCount;
    if (!best || score > best.score) {
      best = { match, cyanBox, score };
    }
  }

  if (best) {
    return { match: best.match, cyanBox: best.cyanBox, source: "cyan-associated" };
  }

  return { match: matches[0] ?? null, cyanBox: null, source: matches[0] ? "template-only" : "none" };
}

async function findXMarksQuestIconMarker(
  calibration: StartupPlayerTileCalibration,
  label: string,
): Promise<{
  match: ItemIconMatch | null;
  screenPoint: ScreenPoint | null;
  debugPath: string;
  cyanDebugPath: string;
  questDebugPath: string;
  cyanBoxes: CyanBox[];
  matchedCyanBox: CyanBox | null;
  selectionSource: "cyan-associated" | "template-only" | "none";
  detection: ReturnType<typeof detectItemIconTemplate>;
}> {
  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const template = await loadXMarksQuestIconTemplate();
  const rawDetection = detectItemIconTemplate(bitmap, template, {
    searchRoi: makeXMarksQuestIconSearchRoi(bitmap, calibration),
    minScore: SECTION_ONE_STEP_TWO_QUEST_ICON_MIN_SCORE,
    coarseStepPx: 1,
    refineRadiusPx: 1,
    maxMatches: 6,
  });
  const cyanBoxes = detectCyanBoxesInScreenshot(bitmap);
  const selected = selectQuestIconMatchWithCyan(rawDetection.matches, cyanBoxes);
  const detection = { ...rawDetection, bestMatch: selected.match };
  const screenPoint = selected.match
    ? {
        x: calibration.captureBounds.x + selected.match.centerX,
        y: calibration.captureBounds.y + selected.match.centerY,
      }
    : null;
  const localClickPoint = selected.match ? { x: selected.match.centerX, y: selected.match.centerY } : undefined;
  const timestamp = buildEndToEndDebugTimestamp();
  const debugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-xmarks-quest-icon-${label}`, timestamp);
  await saveBitmapWithItemIconTemplateDebug(bitmap, detection, debugPath, {
    clickPoint: localClickPoint,
    debugBoxes: cyanBoxes,
  });

  const cyanDebugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-xmarks-quest-icon-cyan-${label}`, timestamp);
  saveBitmapWithCyanBoxes(bitmap, cyanBoxes, cyanDebugPath);
  const questDebugPath = buildEndToEndQuestDebugPath(`end-to-end-xmarks-quest-icon-${label}`, timestamp);
  await saveBitmapWithItemIconTemplateDebug(bitmap, detection, questDebugPath, {
    clickPoint: localClickPoint,
    debugBoxes: cyanBoxes,
  });

  log(
    `Section 1.1 Step 2 X Marks quest icon marker ${label}: selection=${selected.source} matchedCyan=${selected.cyanBox ? formatCyanBoxForLog(selected.cyanBox) : "none"} ${formatItemIconTemplateDetection(detection)} screen=${screenPoint ? formatScreenPoint(screenPoint) : "none"} cyanBoxes=${cyanBoxes.map(formatCyanBoxForLog).join("|") || "none"} file=${debugPath} cyanFile=${cyanDebugPath} questFile=${questDebugPath}.`,
  );

  return {
    match: selected.match,
    screenPoint,
    debugPath,
    cyanDebugPath,
    questDebugPath,
    cyanBoxes,
    matchedCyanBox: selected.cyanBox,
    selectionSource: selected.source,
    detection,
  };
}

function selectGeneralStoreNpcCyanBox(
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
): { selected: CyanBox | null; candidates: CyanBox[]; all: CyanBox[] } {
  const all = detectCyanBoxesInScreenshot(bitmap);
  const sceneRight = getSceneRightBoundary(calibration);
  const sceneBottom = getSceneBottomBoundary(calibration);
  const candidates = all.filter((box) => {
    if (box.pixelCount < SECTION_ONE_STEP_ONE_CYAN_NPC_MIN_PIXELS) {
      return false;
    }
    if (box.width < SECTION_ONE_STEP_ONE_CYAN_NPC_MIN_WIDTH || box.height < SECTION_ONE_STEP_ONE_CYAN_NPC_MIN_HEIGHT) {
      return false;
    }
    if (box.fillRatio > SECTION_ONE_STEP_ONE_CYAN_NPC_MAX_FILL_RATIO) {
      return false;
    }
    if (box.centerX >= sceneRight || box.centerY >= sceneBottom) {
      return false;
    }
    if (box.width > 180 || box.height > 240) {
      return false;
    }
    return true;
  });
  candidates.sort((a, b) => b.pixelCount - a.pixelCount);
  return {
    all,
    candidates,
    selected: candidates[0] ?? null,
  };
}

function getRandomCyanNpcClickPoint(box: CyanBox, bitmap: ScreenBitmap): ScreenPoint {
  const jitterX = Math.max(2, Math.min(8, Math.round(box.width * 0.16)));
  const jitterY = Math.max(2, Math.min(10, Math.round(box.height * 0.14)));
  return {
    x: clamp(box.centerX + randomIntInclusive(-jitterX, jitterX), 0, bitmap.width - 1),
    y: clamp(box.centerY + randomIntInclusive(-jitterY, jitterY), 0, bitmap.height - 1),
  };
}

async function rightClickTradeGeneralStoreNpc(
  calibration: StartupPlayerTileCalibration,
  token: number,
): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return false;
  }

  let lastFailure = "not-attempted";

  for (let attempt = 1; attempt <= SECTION_ONE_STEP_ONE_NPC_TRADE_MAX_ATTEMPTS && isCurrentRunActive(token); attempt += 1) {
    const bitmap = captureScreenBitmap(calibration.captureBounds);
    const cyan = selectGeneralStoreNpcCyanBox(bitmap, calibration);
    const debugTimestamp = buildEndToEndDebugTimestamp();
    const cyanDebugPath = buildEndToEndDebugPath(
      `end-to-end-section-1-step-1-trade-npc-cyan-attempt-${attempt}`,
      debugTimestamp,
    );
    saveBitmapWithCyanBoxes(bitmap, cyan.all, cyanDebugPath);

    if (!cyan.selected) {
      lastFailure = `no cyan NPC candidate after filtering; allBoxes=${cyan.all.map(formatCyanBoxForLog).join("|") || "none"}`;
      warn(
        `Section 1.1 Step 1 trade attempt ${attempt}/${SECTION_ONE_STEP_ONE_NPC_TRADE_MAX_ATTEMPTS}: no cyan NPC candidate. sceneRight=${getSceneRightBoundary(calibration)} sceneBottom=${getSceneBottomBoundary(calibration)} ${lastFailure} file=${cyanDebugPath}.`,
      );
      await sleepWithAbort(randomIntInclusive(120, 260), () => isCurrentRunActive(token));
      continue;
    }

    const selected = cyan.candidates[(attempt - 1) % Math.max(1, cyan.candidates.length)] ?? cyan.selected;
    const clickLocal = getRandomCyanNpcClickPoint(selected, bitmap);
    const clickScreen = {
      x: calibration.captureBounds.x + clickLocal.x,
      y: calibration.captureBounds.y + clickLocal.y,
    };
    const movedToNpcPoint = await moveMouseHumanLike(clickScreen.x, clickScreen.y, undefined, {
      minDurationMs: SECTION_ONE_STEP_ONE_NPC_TRADE_MOVE_MIN_MS,
      maxDurationMs: SECTION_ONE_STEP_ONE_NPC_TRADE_MOVE_MAX_MS,
      minStepMs: 16,
      maxStepMs: 38,
      jitterPx: 2.1,
      overshootChance: 0.16,
      maxOvershootPx: 9,
      shouldContinue: () => isCurrentRunActive(token),
    });
    if (!isCurrentRunActive(token)) {
      return false;
    }

    await sleepWithAbort(randomIntInclusive(60, 135), () => isCurrentRunActive(token));
    const beforeRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
    const rightClickedPoint = clickScreenPoint(clickScreen.x, clickScreen.y, calibration.captureBounds, {
      button: "right",
      settleMs: randomIntInclusive(
        SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MIN_MS,
        SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MAX_MS,
      ),
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    });
    await sleepWithAbort(
      randomIntInclusive(SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MIN_MS, SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MAX_MS),
      () => isCurrentRunActive(token),
    );
    if (!isCurrentRunActive(token)) {
      return false;
    }

    const afterRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
    const contextMenu = detectContextMenuOptionFromBitmapDiff(
      beforeRightClickBitmap,
      afterRightClickBitmap,
      clickLocal,
      calibration.windowsScalePercent,
      "Trade",
    );
    const rawDebugPath = buildEndToEndDebugPath(
      `end-to-end-section-1-step-1-trade-npc-menu-raw-attempt-${attempt}`,
      debugTimestamp,
    );
    await saveBitmapAsync(afterRightClickBitmap, rawDebugPath);

    if (!contextMenu || !contextMenu.optionLocalPoint) {
      lastFailure = contextMenu
        ? `Trade option not recognized; menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} textBands=${contextMenu.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"}`
        : "context menu not detected";
      log(
        `Section 1.1 Step 1 trade retry ${attempt}/${SECTION_ONE_STEP_ONE_NPC_TRADE_MAX_ATTEMPTS}: ${lastFailure}; npc=${formatCyanBoxForLog(selected)} candidates=${cyan.candidates.map(formatCyanBoxForLog).join("|") || "none"} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} local=${clickLocal.x},${clickLocal.y} movedToNpc=${movedToNpcPoint.x},${movedToNpcPoint.y} cyanFile=${cyanDebugPath} rawFile=${rawDebugPath}.`,
      );
      await pressKeyForMs("escape", randomIntInclusive(45, 95), token);
      await sleepWithAbort(randomIntInclusive(120, 280), () => isCurrentRunActive(token));
      continue;
    }

    const tradeScreenPoint = {
      x: calibration.captureBounds.x + contextMenu.optionLocalPoint.x,
      y: calibration.captureBounds.y + contextMenu.optionLocalPoint.y,
    };
    const movedToTradePoint = await moveMouseHumanLike(tradeScreenPoint.x, tradeScreenPoint.y, undefined, {
      minDurationMs: SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MIN_MS,
      maxDurationMs: SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MAX_MS,
      minStepMs: 14,
      maxStepMs: 32,
      jitterPx: 1.6,
      overshootChance: 0.12,
      maxOvershootPx: 7,
      shouldContinue: () => isCurrentRunActive(token),
    });
    if (!isCurrentRunActive(token)) {
      return false;
    }

    const tradeClickedPoint = clickScreenPoint(tradeScreenPoint.x, tradeScreenPoint.y, calibration.captureBounds, {
      settleMs: randomIntInclusive(120, 310),
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    });
    log(
      `Section 1.1 Step 1 trade attempt ${attempt}/${SECTION_ONE_STEP_ONE_NPC_TRADE_MAX_ATTEMPTS}: npc=${formatCyanBoxForLog(selected)} candidates=${cyan.candidates.map(formatCyanBoxForLog).join("|") || "none"} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} local=${clickLocal.x},${clickLocal.y} movedToNpc=${movedToNpcPoint.x},${movedToNpcPoint.y} menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} changed=${contextMenu.changedPixels} fill=${contextMenu.fillRatio.toFixed(2)} tradeMatch=${contextMenu.optionMatch ? formatContextMenuWordMatch(contextMenu.optionMatch) : "none"} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} tradeLocal=${contextMenu.optionLocalPoint.x},${contextMenu.optionLocalPoint.y} movedToTrade=${movedToTradePoint.x},${movedToTradePoint.y} clicked=${tradeClickedPoint.x},${tradeClickedPoint.y} cyanFile=${cyanDebugPath} rawFile=${rawDebugPath}.`,
    );
    await sleepWithAbort(
      randomIntInclusive(SECTION_ONE_STEP_ONE_TRADE_AFTER_WAIT_MIN_MS, SECTION_ONE_STEP_ONE_TRADE_AFTER_WAIT_MAX_MS),
      () => isCurrentRunActive(token),
    );
    return true;
  }

  if (isCurrentRunActive(token)) {
    warn(
      `Section 1.1 Step 1 trade stopped: failed to open Trade after ${SECTION_ONE_STEP_ONE_NPC_TRADE_MAX_ATTEMPTS} attempt(s). lastFailure=${lastFailure}.`,
    );
  }
  return false;
}

let generalStoreSpadeIconTemplatePromise: Promise<Awaited<ReturnType<typeof loadItemIconTemplate>>[]> | null = null;

function loadGeneralStoreSpadeIconTemplates(): Promise<Awaited<ReturnType<typeof loadItemIconTemplate>>[]> {
  if (!generalStoreSpadeIconTemplatePromise) {
    generalStoreSpadeIconTemplatePromise = Promise.all(
      SECTION_ONE_STEP_ONE_SPADE_ICON_PATHS.map((iconPath) => loadItemIconTemplate(path.basename(iconPath, ".png"), iconPath)),
    ).catch((error) => {
        generalStoreSpadeIconTemplatePromise = null;
        throw error;
      });
  }
  return generalStoreSpadeIconTemplatePromise;
}

function resolveGeneralStoreShopItemSearchRoi(
  bitmap: ScreenBitmap,
  calibration: StartupPlayerTileCalibration,
): ItemIconSearchRoi {
  const left = Math.round(bitmap.width * SECTION_ONE_STEP_ONE_SHOP_SEARCH_LEFT_RATIO);
  const top = Math.round(bitmap.height * SECTION_ONE_STEP_ONE_SHOP_SEARCH_TOP_RATIO);
  const right = Math.min(
    getSceneRightBoundary(calibration) - GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    Math.round(bitmap.width * SECTION_ONE_STEP_ONE_SHOP_SEARCH_RIGHT_RATIO),
  );
  const bottom = Math.min(
    getSceneBottomBoundary(calibration) - GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    Math.round(bitmap.height * SECTION_ONE_STEP_ONE_SHOP_SEARCH_BOTTOM_RATIO),
  );
  const clampedLeft = clamp(left, 0, bitmap.width - 1);
  const clampedTop = clamp(top, 0, bitmap.height - 1);
  const clampedRight = clamp(right, clampedLeft, bitmap.width - 1);
  const clampedBottom = clamp(bottom, clampedTop, bitmap.height - 1);
  return {
    x: clampedLeft,
    y: clampedTop,
    width: clampedRight - clampedLeft + 1,
    height: clampedBottom - clampedTop + 1,
  };
}

function getRandomShopItemClickPoint(match: ItemIconMatch, bitmap: ScreenBitmap): ScreenPoint {
  const jitterX = Math.max(2, Math.min(5, Math.round(match.width * 0.16)));
  const jitterY = Math.max(2, Math.min(5, Math.round(match.height * 0.16)));
  return {
    x: clamp(match.centerX + randomIntInclusive(-jitterX, jitterX), 0, bitmap.width - 1),
    y: clamp(match.centerY + randomIntInclusive(-jitterY, jitterY), 0, bitmap.height - 1),
  };
}

async function rightClickSpadeInGeneralStoreShop(
  calibration: StartupPlayerTileCalibration,
  token: number,
): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return true;
  }

  let templates: Awaited<ReturnType<typeof loadItemIconTemplate>>[];
  try {
    templates = await loadGeneralStoreSpadeIconTemplates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Section 1.1 Step 1 buy-spade stopped: unable to load spade icon template: ${message}.`);
    return true;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const searchRoi = resolveGeneralStoreShopItemSearchRoi(bitmap, calibration);
  const detections = templates.map((template) =>
    detectItemIconTemplate(bitmap, template, {
      searchRoi,
      minScore: SECTION_ONE_STEP_ONE_SHOP_SPADE_MIN_SCORE,
      coarseStepPx: SECTION_ONE_STEP_ONE_SHOP_SPADE_COARSE_STEP_PX,
      refineRadiusPx: SECTION_ONE_STEP_ONE_SHOP_SPADE_REFINE_RADIUS_PX,
      maxMatches: SECTION_ONE_STEP_ONE_SHOP_SPADE_MAX_MATCHES,
    }),
  );
  const detection =
    detections
      .filter((candidate) => candidate.bestMatch)
      .sort((a, b) => (b.bestMatch?.score ?? 0) - (a.bestMatch?.score ?? 0))[0] ??
    detections[0];
  const detectionSummary = detections.map(formatItemIconTemplateDetection).join("; ");
  const debugTimestamp = buildEndToEndDebugTimestamp();
  const debugPath = buildEndToEndDebugPath("end-to-end-section-1-step-1-buy-spade-match", debugTimestamp);

  const clickLocal = detection.bestMatch ? getRandomShopItemClickPoint(detection.bestMatch, bitmap) : undefined;
  await saveBitmapWithItemIconTemplateDebug(bitmap, detection, debugPath, {
    clickPoint: clickLocal,
  });

  if (!detection.bestMatch || !clickLocal) {
    warn(
      `Section 1.1 Step 1 buy-spade stopped: Spade icon was not matched in the General store shop. detections=${detectionSummary} file=${debugPath}.`,
    );
    return true;
  }

  const clickScreen = {
    x: calibration.captureBounds.x + clickLocal.x,
    y: calibration.captureBounds.y + clickLocal.y,
  };
  const movedToSpadePoint = await moveMouseHumanLike(clickScreen.x, clickScreen.y, calibration.captureBounds, {
    minDurationMs: SECTION_ONE_STEP_ONE_SHOP_SPADE_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_ONE_SHOP_SPADE_MOVE_MAX_MS,
    minStepMs: 16,
    maxStepMs: 38,
    jitterPx: 1.8,
    overshootChance: 0.14,
    maxOvershootPx: 8,
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return true;
  }

  await sleepWithAbort(randomIntInclusive(55, 135), () => isCurrentRunActive(token));
  const beforeRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
  const rightClickedPoint = clickScreenPoint(clickScreen.x, clickScreen.y, calibration.captureBounds, {
    button: "right",
    settleMs: randomIntInclusive(
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MIN_MS,
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MAX_MS,
    ),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  await sleepWithAbort(
    randomIntInclusive(
      SECTION_ONE_STEP_ONE_SHOP_SPADE_AFTER_RIGHT_CLICK_MIN_MS,
      SECTION_ONE_STEP_ONE_SHOP_SPADE_AFTER_RIGHT_CLICK_MAX_MS,
    ),
    () => isCurrentRunActive(token),
  );

  const afterRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
  const afterDebugPath = buildEndToEndDebugPath("end-to-end-section-1-step-1-buy-spade-right-click", debugTimestamp);
  await saveBitmapWithItemIconTemplateDebug(afterRightClickBitmap, detection, afterDebugPath, {
    clickPoint: clickLocal,
  });

  const contextMenu = detectContextMenuOptionFromBitmapDiff(
    beforeRightClickBitmap,
    afterRightClickBitmap,
    clickLocal,
    calibration.windowsScalePercent,
    "Cancel",
  );
  const buyOneTarget = contextMenu ? selectFirstContextMenuActionPoint(contextMenu, afterRightClickBitmap) : null;
  if (!contextMenu || !buyOneTarget) {
    warn(
      `Section 1.1 Step 1 buy-spade stopped: Buy 1 row was not detected after right-clicking matched Spade. detections=${detectionSummary} movedToSpade=${movedToSpadePoint.x},${movedToSpadePoint.y} clicked=${rightClickedPoint.x},${rightClickedPoint.y} local=${clickLocal.x},${clickLocal.y} menu=${contextMenu ? `${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height}` : "none"} textBands=${contextMenu?.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"} wordMatches=${contextMenu?.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} file=${debugPath} rightClickFile=${afterDebugPath}.`,
    );
    await pressKeyForMs("escape", randomIntInclusive(45, 95), token);
    return true;
  }

  const buyOneScreenPoint = {
    x: calibration.captureBounds.x + buyOneTarget.localPoint.x,
    y: calibration.captureBounds.y + buyOneTarget.localPoint.y,
  };
  const movedToBuyOnePoint = await moveMouseHumanLike(buyOneScreenPoint.x, buyOneScreenPoint.y, undefined, {
    minDurationMs: SECTION_ONE_STEP_ONE_SHOP_BUY_OPTION_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_ONE_SHOP_BUY_OPTION_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 32,
    jitterPx: 1.6,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return true;
  }

  const buyOneClickedPoint = clickScreenPoint(buyOneScreenPoint.x, buyOneScreenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(120, 310),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  log(
    `Section 1.1 Step 1 buy-spade: clicked first shop menu action as Buy 1. detections=${detectionSummary} movedToSpade=${movedToSpadePoint.x},${movedToSpadePoint.y} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} spadeLocal=${clickLocal.x},${clickLocal.y} menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} changed=${contextMenu.changedPixels} fill=${contextMenu.fillRatio.toFixed(2)} buy1Band=${buyOneTarget.band.centerY}:${buyOneTarget.band.minX}-${buyOneTarget.band.maxX}/${buyOneTarget.band.pixelCount} buy1Local=${buyOneTarget.localPoint.x},${buyOneTarget.localPoint.y} movedToBuy1=${movedToBuyOnePoint.x},${movedToBuyOnePoint.y} clicked=${buyOneClickedPoint.x},${buyOneClickedPoint.y} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} file=${debugPath} rightClickFile=${afterDebugPath}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_ONE_SHOP_BUY_AFTER_WAIT_MIN_MS, SECTION_ONE_STEP_ONE_SHOP_BUY_AFTER_WAIT_MAX_MS),
    () => isCurrentRunActive(token),
  );
  await pressKeyForMs("escape", randomIntInclusive(55, 105), token);
  await sleepWithAbort(randomIntInclusive(220, 420), () => isCurrentRunActive(token));
  return true;
}

async function rightClickSellOneInventoryItem(
  item: EndToEndSectionOneStepOneItem,
  calibration: StartupPlayerTileCalibration,
  token: number,
  index: number,
  total: number,
): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const detection = detectInventoryPanelInScreenshot(bitmap, {
    scalePercentHint: calibration.windowsScalePercent,
  });
  const itemSlot = item.slot ?? -1;
  const slot = getInventoryPanelSlot(detection, itemSlot);
  if (!slot) {
    warn(`Section 1.1 Step 1 sell skipped: ${formatEndToEndStepOneItem(item)} slot is outside inventory geometry.`);
    return false;
  }

  const clickPoint = getRandomInventorySlotClickPoint(slot);
  const rightClickPoint: ScreenPoint = {
    x: calibration.captureBounds.x + clickPoint.localPoint.x,
    y: calibration.captureBounds.y + clickPoint.localPoint.y,
  };
  const movedToItemPoint = await moveMouseHumanLike(rightClickPoint.x, rightClickPoint.y, undefined, {
    minDurationMs: SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_ONE_INVENTORY_CLICK_MAX_MS,
    minStepMs: 16,
    maxStepMs: 36,
    jitterPx: 2.2,
    overshootChance: 0.16,
    maxOvershootPx: 9,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  await sleepWithAbort(randomIntInclusive(55, 130), () => isCurrentRunActive(token));
  const beforeRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
  const rightClickedPoint = clickScreenPoint(rightClickPoint.x, rightClickPoint.y, calibration.captureBounds, {
    button: "right",
    settleMs: randomIntInclusive(
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MIN_MS,
      SECTION_ONE_STEP_ONE_INVENTORY_CLICK_SETTLE_MAX_MS,
    ),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MIN_MS, SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MAX_MS),
    () => isCurrentRunActive(token),
  );
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const afterRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
  const contextMenu = detectContextMenuOptionFromBitmapDiff(
    beforeRightClickBitmap,
    afterRightClickBitmap,
    clickPoint.localPoint,
    calibration.windowsScalePercent,
    "Sell",
  );
  const sellTextBand = contextMenu?.optionMatch?.band ?? null;
  const debugTimestamp = buildEndToEndDebugTimestamp();
  const debugSlug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const rawDebugPath = buildEndToEndDebugPath(
    `end-to-end-section-1-step-1-sell-${index + 1}-${debugSlug}-raw`,
    debugTimestamp,
  );
  const debugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-1-sell-${index + 1}-${debugSlug}`, debugTimestamp);
  await saveBitmapAsync(afterRightClickBitmap, rawDebugPath);
  await saveBitmapWithInventoryPanelDebug(afterRightClickBitmap, detection, debugPath, {
    targetSlots: [{ slot: itemSlot, label: item.name }],
    debugPoints: [
      { x: clickPoint.localPoint.x, y: clickPoint.localPoint.y, label: "right-click" },
      ...(contextMenu?.optionLocalPoint
        ? [{ x: contextMenu.optionLocalPoint.x, y: contextMenu.optionLocalPoint.y, label: "sell-1" }]
        : []),
    ],
    debugBoxes: contextMenu
      ? [
          contextMenu.menuBox,
          ...(sellTextBand
            ? [
                {
                  x: sellTextBand.minX,
                  y: sellTextBand.startY,
                  width: sellTextBand.maxX - sellTextBand.minX + 1,
                  height: sellTextBand.endY - sellTextBand.startY + 1,
                  label: "sell-text-band",
                },
              ]
            : []),
          ...(contextMenu.optionMatch
            ? [
                {
                  ...contextMenu.optionMatch.wordBox,
                  label: "sell-template",
                },
              ]
            : []),
        ]
      : [],
  });

  if (!contextMenu) {
    warn(
      `Section 1.1 Step 1 sell ${index + 1}/${total} stopped: context menu was not detected after right-clicking ${formatEndToEndStepOneItem(item)} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} slotLocal=${slot.x},${slot.y},${slot.width}x${slot.height} clickLocal=${clickPoint.localPoint.x},${clickPoint.localPoint.y} rawFile=${rawDebugPath} file=${debugPath}.`,
    );
    await pressKeyForMs("escape", randomIntInclusive(45, 95), token);
    return false;
  }

  if (!contextMenu.optionLocalPoint) {
    warn(
      `Section 1.1 Step 1 sell ${index + 1}/${total} stopped: Sell 1 option was not recognized by OCR/template after right-clicking ${formatEndToEndStepOneItem(item)} menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} textBands=${contextMenu.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} rawFile=${rawDebugPath} file=${debugPath}.`,
    );
    await pressKeyForMs("escape", randomIntInclusive(45, 95), token);
    return false;
  }

  const sellScreenPoint = {
    x: calibration.captureBounds.x + contextMenu.optionLocalPoint.x,
    y: calibration.captureBounds.y + contextMenu.optionLocalPoint.y,
  };
  const movedToSellPoint = await moveMouseHumanLike(sellScreenPoint.x, sellScreenPoint.y, undefined, {
    minDurationMs: SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_ONE_EXAMINE_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 32,
    jitterPx: 1.6,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const sellClickedPoint = clickScreenPoint(sellScreenPoint.x, sellScreenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(120, 310),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  log(
    `Section 1.1 Step 1 sell ${index + 1}/${total}: item=${item.name} id=${item.id} qty=${item.quantity} slot=${itemSlot} row=${slot.row} col=${slot.col} sellOption=Sell 1 rightClick=${rightClickedPoint.x},${rightClickedPoint.y} rightClickLocal=${clickPoint.localPoint.x},${clickPoint.localPoint.y} offsetFromCenter=${clickPoint.offsetFromCenter.x},${clickPoint.offsetFromCenter.y} movedToItem=${movedToItemPoint.x},${movedToItemPoint.y} menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} changed=${contextMenu.changedPixels} fill=${contextMenu.fillRatio.toFixed(2)} sellMatch=${contextMenu.optionMatch ? formatContextMenuWordMatch(contextMenu.optionMatch) : "none"} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} textBands=${contextMenu.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"} sellLocal=${contextMenu.optionLocalPoint.x},${contextMenu.optionLocalPoint.y} movedToSell=${movedToSellPoint.x},${movedToSellPoint.y} clicked=${sellClickedPoint.x},${sellClickedPoint.y} rawFile=${rawDebugPath} file=${debugPath}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_ONE_SELL_AFTER_WAIT_MIN_MS, SECTION_ONE_STEP_ONE_SELL_AFTER_WAIT_MAX_MS),
    () => isCurrentRunActive(token),
  );
  return true;
}

async function tradeAndSellSectionOneStepOneInventoryItems(token: number): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return false;
  }

  let snapshot: RuneLiteLocalApiSnapshot;
  try {
    snapshot = await fetchRuneLiteLocalApiSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Section 1.1 Step 1 sell skipped: RuneLite local inventory unavailable: ${message}.`);
    return false;
  }

  const currentState = evaluateEndToEndSectionOneStepOne(snapshot, loadOsrsItemNamesByIdFromCache());
  const targets = getInventoryStepOneExamineTargets(currentState);
  const needsSpade = currentState.missingRequiredInventoryItemNames.includes("spade");
  if (targets.length === 0 && !needsSpade) {
    log("Section 1.1 Step 1 shop skipped: no starter gear target items remain and spade is already in inventory.");
    return false;
  }

  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 1 sell skipped: RuneLite window not found.");
    return false;
  }

  const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
    requireRuneLiteCoordinatePattern: false,
  });
  if (!calibration) {
    warn("Section 1.1 Step 1 sell skipped: RuneLite screenshot capture bounds unavailable.");
    return false;
  }

  log(
    `Section 1.1 Step 1 shop start: sellTargets=${targets.map(formatEndToEndStepOneItem).join(", ") || "none"} buy=${needsSpade ? "spade" : "none"} inventorySlots=${formatInventorySlotSnapshot(snapshot)} capture=${calibration.captureBounds.width}x${calibration.captureBounds.height} scale=${calibration.windowsScalePercent}%.`,
  );

  const tradeOpened = await rightClickTradeGeneralStoreNpc(calibration, token);
  if (!tradeOpened || !isCurrentRunActive(token)) {
    return false;
  }

  let soldAllTargets = true;
  for (let index = 0; index < targets.length && isCurrentRunActive(token); index += 1) {
    const success = await rightClickSellOneInventoryItem(targets[index], calibration, token, index, targets.length);
    if (!success) {
      soldAllTargets = false;
      break;
    }
  }

  if (needsSpade && soldAllTargets && isCurrentRunActive(token)) {
    return rightClickSpadeInGeneralStoreShop(calibration, token);
  }

  if (needsSpade && !soldAllTargets) {
    warn("Section 1.1 Step 1 buy-spade skipped: starter gear sell sequence did not complete.");
  }

  return soldAllTargets && targets.length > 0 && !needsSpade;
}

type EndToEndSectionOneWalkRouteDefinition = {
  logPrefix: string;
  destinationLabel: string;
  snapshotIdPrefix: string;
  snapshotLabel: string;
  sourceStep: string;
  planRoute: (playerTile: NonNullable<StartupPlayerTileCalibration["playerTile"]>) => EndToEndGeneralStoreRoutePlan;
};

async function walkToSectionOneDestination(
  token: number,
  routeDefinition: EndToEndSectionOneWalkRouteDefinition,
): Promise<boolean> {
  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn(`${routeDefinition.logPrefix} movement skipped: RuneLite window not found.`);
    return false;
  }

  await turnCameraNorth(token);
  log(
    `${routeDefinition.logPrefix} movement targeting: destination='${routeDefinition.destinationLabel}' mode=${GENERAL_STORE_WALK_TARGETING_MODE}; choosing a random tile from the ${GENERAL_STORE_VISIBLE_PATH_CANDIDATE_COUNT} visible path tiles closest to the objective.`,
  );

  let trustedCoordinateBox: StartupPlayerTileCalibration["coordinateBox"] = null;
  let lastPlayerTile: StartupPlayerTileCalibration["playerTile"] = null;

  for (let attempt = 1; attempt <= GENERAL_STORE_MAX_WALK_CLICKS && isCurrentRunActive(token); attempt += 1) {
    const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
      requireRuneLiteCoordinatePattern: true,
      preferredCoordinateBox: trustedCoordinateBox,
      lockToPreferredCoordinateBox: trustedCoordinateBox !== null,
      expectedTile: lastPlayerTile,
      maxTileJump: GENERAL_STORE_MAX_COORDINATE_JUMP_TILES,
    });
    if (!calibration) {
      warn(`${routeDefinition.logPrefix} movement unavailable: RuneLite screenshot calibration failed.`);
      return false;
    }

    if (!calibration.playerTile) {
      warn(
        `${routeDefinition.logPrefix} movement unavailable: player tile was not detected from the screenshot overlay. raw='${calibration.coordinateLine ?? "unavailable"}' rejected='${calibration.rejectedCoordinateLine ?? "none"}' rejectReason='${calibration.coordinateRejectReason ?? "none"}' source=${calibration.coordinateReadSource ?? "none"} box=${formatCoordinateBoxForLog(calibration)} capture=${calibration.captureBounds.width}x${calibration.captureBounds.height} scale=${calibration.windowsScalePercent}% debug=${calibration.coordinateDebugPath ?? "none"} attempts=${formatCoordinateReadAttemptsForLog(calibration, 16)}.`,
      );
      return false;
    }

    trustedCoordinateBox = calibration.coordinateBox ?? trustedCoordinateBox;
    lastPlayerTile = calibration.playerTile;

    const route = routeDefinition.planRoute(calibration.playerTile);
    const stepTwoInsidePub =
      routeDefinition.sourceStep === STEP_SECTION_ONE_WALK_X_MARKS_THE_SPOT_ID &&
      isTileInsideLumbridgePub(calibration.playerTile);
    const environmentStatus = await prepareKnownEnvironmentForMovement(
      calibration,
      route,
      token,
      `${routeDefinition.logPrefix} movement`,
    );
    if (!isCurrentRunActive(token)) {
      return false;
    }
    if (environmentStatus === "changed") {
      continue;
    }
    if (environmentStatus === "unavailable") {
      return false;
    }

    await ensureGeneralStoreSceneMouseCalibration(calibration, route, token);
    if (!isCurrentRunActive(token)) {
      return false;
    }

    const waypointAttempts = selectGeneralStoreWaypointAttempts(calibration, route);
    const waypoint = waypointAttempts[0] ?? null;
    let savedPathFile: string | null = null;
    try {
      savedPathFile = saveGeneralStoreRoutePathSnapshot(calibration, route, waypoint, {
        idPrefix: routeDefinition.snapshotIdPrefix,
        label: routeDefinition.snapshotLabel,
        sourceStep: routeDefinition.sourceStep,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`${routeDefinition.logPrefix} route path snapshot save failed: ${message}.`);
    }
    log(
      `${routeDefinition.logPrefix} coordinate read: raw='${calibration.coordinateLine ?? "unavailable"}' parsed=${calibration.playerTile.x},${calibration.playerTile.y},${calibration.playerTile.z} source=${calibration.coordinateReadSource ?? "none"} rejected='${calibration.rejectedCoordinateLine ?? "none"}' box=${formatCoordinateBoxForLog(calibration)} capture=${calibration.captureBounds.width}x${calibration.captureBounds.height} scale=${calibration.windowsScalePercent}% attempts=${formatCoordinateReadAttemptsForLog(calibration, 4)}.`,
    );
    log(`${routeDefinition.logPrefix} route to ${routeDefinition.destinationLabel}: ${formatEndToEndGeneralStoreRoutePlan(route)}.`);
    log(
      `${routeDefinition.logPrefix} route path: ${formatEndToEndGeneralStoreRoutePath(route, waypoint?.tile)} selection=${waypoint?.reason ?? "none"} saved=${savedPathFile ?? "none"}.`,
    );
    if (route.status === "already-there") {
      log(`${routeDefinition.logPrefix} movement complete: player is at the ${routeDefinition.destinationLabel} target tile.`);
      return true;
    }

    if (
      routeDefinition.sourceStep === STEP_SECTION_ONE_WALK_X_MARKS_THE_SPOT_ID &&
      route.status === "ready" &&
      route.directDistanceToStoreTiles <= SECTION_ONE_STEP_TWO_QUEST_ICON_NEAR_DISTANCE_TILES
    ) {
      const questIconProbe = await findXMarksQuestIconMarker(calibration, `near-objective-attempt-${attempt}`);
      if (!isCurrentRunActive(token)) {
        return false;
      }
      if (questIconProbe.screenPoint && questIconProbe.matchedCyanBox && stepTwoInsidePub) {
        log(
          `${routeDefinition.logPrefix} movement complete: X Marks quest icon marker is visible with cyan highlight near the objective and player is inside the pub. player=${calibration.playerTile.x},${calibration.playerTile.y},${calibration.playerTile.z} directToDestination=${route.directDistanceToStoreTiles} tile(s) marker=${formatScreenPoint(questIconProbe.screenPoint)} match=${questIconProbe.match ? `${questIconProbe.match.centerX},${questIconProbe.match.centerY}:${questIconProbe.match.score.toFixed(3)}` : "none"} cyan=${formatCyanBoxForLog(questIconProbe.matchedCyanBox)} debug=${questIconProbe.debugPath} questFile=${questIconProbe.questDebugPath}.`,
        );
        return true;
      }
      if (questIconProbe.screenPoint) {
        log(
          `${routeDefinition.logPrefix} near-objective quest icon marker probe did not satisfy arrival conditions; continuing tile pathing. player=${calibration.playerTile.x},${calibration.playerTile.y},${calibration.playerTile.z} insidePub=${stepTwoInsidePub ? "yes" : "no"} directToDestination=${route.directDistanceToStoreTiles} tile(s) marker=${formatScreenPoint(questIconProbe.screenPoint)} cyan=${questIconProbe.matchedCyanBox ? formatCyanBoxForLog(questIconProbe.matchedCyanBox) : "none"} selection=${questIconProbe.selectionSource} debug=${questIconProbe.debugPath}.`,
        );
      }
    }

    if (!waypoint) {
      warn(`${routeDefinition.logPrefix} movement unavailable: ${route.reason ?? "route planner returned no path"}.`);
      return false;
    }

    if (route.status !== "ready") {
      log(
        `${routeDefinition.logPrefix} path fallback: collision route unavailable, clicking intermediate waypoint ${waypoint.tile.x},${waypoint.tile.y},${waypoint.tile.z} toward ${routeDefinition.destinationLabel} anchor ${route.storeTile?.x},${route.storeTile?.y},${route.storeTile?.z}; directToDestination=${route.directDistanceToStoreTiles} tile(s).`,
      );
    }

    let sceneClickPlan: GeneralStoreSceneClickPlan | null = null;
    let attemptedWaypoint = waypoint;
    for (let waypointAttemptIndex = 0; waypointAttemptIndex < waypointAttempts.length; waypointAttemptIndex += 1) {
      attemptedWaypoint = waypointAttempts[waypointAttemptIndex];
      log(
        `${routeDefinition.logPrefix} click candidate group ${waypointAttemptIndex + 1}/${waypointAttempts.length}: target=${attemptedWaypoint.tile.x},${attemptedWaypoint.tile.y},${attemptedWaypoint.tile.z} eligible=${formatEligibleGeneralStoreClickTiles(attemptedWaypoint.eligibleClickTiles)} selection=${attemptedWaypoint.reason}.`,
      );
      sceneClickPlan = await projectGeneralStoreSceneClick(
        calibration,
        attemptedWaypoint.tile,
        attemptedWaypoint.pathTiles,
        attemptedWaypoint.source,
        attemptedWaypoint.eligibleClickTiles,
        route.pathTiles,
        token,
        waypointAttemptIndex === waypointAttempts.length - 1,
      );
      if (!isCurrentRunActive(token)) {
        return false;
      }

      if (sceneClickPlan) {
        if (waypointAttemptIndex > 0) {
          log(
            `${routeDefinition.logPrefix} click fallback accepted: group=${waypointAttemptIndex + 1}/${waypointAttempts.length} clicked=${sceneClickPlan.targetTile.x},${sceneClickPlan.targetTile.y},${sceneClickPlan.targetTile.z}.`,
          );
        }
        break;
      }

      if (waypointAttemptIndex < waypointAttempts.length - 1) {
        log(
          `${routeDefinition.logPrefix} click candidate group ${waypointAttemptIndex + 1}/${waypointAttempts.length} had no exact eligible hover; trying a closer path group.`,
        );
      }
    }

    if (sceneClickPlan) {
      const travel = estimateGeneralStoreSceneTravelWait(sceneClickPlan);
      const clickedPoint = clickScreenPoint(
        sceneClickPlan.screenPoint.x,
        sceneClickPlan.screenPoint.y,
        calibration.captureBounds,
        {
          settleMs: randomIntInclusive(45, 145),
          safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
        },
      );
      log(
        `${routeDefinition.logPrefix} walk click ${attempt}/${GENERAL_STORE_MAX_WALK_CLICKS}: mode=scene source=${sceneClickPlan.source} projection=${sceneClickPlan.projectionSource} fitSamples=${sceneClickPlan.calibrationSampleCount ?? 0} fitMeanPx=${sceneClickPlan.calibrationMeanErrorPx?.toFixed(1) ?? "n/a"} requested=${sceneClickPlan.requestedTargetTile.x},${sceneClickPlan.requestedTargetTile.y},${sceneClickPlan.requestedTargetTile.z} clicked=${sceneClickPlan.targetTile.x},${sceneClickPlan.targetTile.y},${sceneClickPlan.targetTile.z} clickReason=${sceneClickPlan.clickReason} hover='${sceneClickPlan.hoveredLine}' hoverBox=${sceneClickPlan.hoverBoxScreen.x},${sceneClickPlan.hoverBoxScreen.y},${sceneClickPlan.hoverBoxScreen.width}x${sceneClickPlan.hoverBoxScreen.height} finalError=${sceneClickPlan.finalErrorTiles} tile(s) screen=${clickedPoint.x},${clickedPoint.y} initial=${sceneClickPlan.initialScreenPoint.x},${sceneClickPlan.initialScreenPoint.y} anchor=${sceneClickPlan.anchorScreenPoint.x},${sceneClickPlan.anchorScreenPoint.y} scene=${sceneClickPlan.projection.sceneLeft},${sceneClickPlan.projection.sceneTop}-${sceneClickPlan.projection.sceneRight},${sceneClickPlan.projection.sceneBottom} tilePxModel=${sceneClickPlan.projection.topTilePx}-${sceneClickPlan.projection.bottomTilePx}px waypointDelta=${sceneClickPlan.dxTiles},${sceneClickPlan.dyTiles} directToWaypoint=${sceneClickPlan.distanceTiles.toFixed(1)} tile(s) pathToWaypoint=${sceneClickPlan.pathTiles} step(s) eta=${formatGeneralStoreTravelEstimate(travel)} attempts=${formatSceneHoverAttempts(sceneClickPlan.attempts)}.`,
      );

      const waitMs = ticksToMs(travel.waitTicks, GAME_TICK_MS) + randomIntInclusive(80, 320);
      await sleepWithAbort(waitMs, () => isCurrentRunActive(token));
      continue;
    }

    const minimapClickPlan = projectGeneralStoreTileClick(
      calibration,
      attemptedWaypoint.tile,
      attemptedWaypoint.pathTiles,
      attemptedWaypoint.source,
    );
    if (minimapClickPlan) {
      const travel = estimateGeneralStoreTravelWait(minimapClickPlan);
      const execution = await executeMinimapWorldClickPlan(calibration, minimapClickPlan, {
        safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
        shouldContinue: () => isCurrentRunActive(token),
        settleMs: randomIntInclusive(45, 145),
      });
      if (!isCurrentRunActive(token)) {
        return false;
      }

      log(
        `${routeDefinition.logPrefix} walk click ${attempt}/${GENERAL_STORE_MAX_WALK_CLICKS}: mode=minimap source=${minimapClickPlan.source} calibration=${minimapClickPlan.minimapCalibrationSource} target=${attemptedWaypoint.tile.x},${attemptedWaypoint.tile.y},${attemptedWaypoint.tile.z} screen=${execution.clicked.x},${execution.clicked.y} projected=${minimapClickPlan.projectedScreenPoint.x},${minimapClickPlan.projectedScreenPoint.y} center=${minimapClickPlan.minimapCenter.x},${minimapClickPlan.minimapCenter.y} minimap=${minimapClickPlan.minimapSource}/${minimapClickPlan.projectionSource} radius=${minimapClickPlan.minimapRadiusPx}px maxClick=${minimapClickPlan.maxClickDistancePx}px clamped=${minimapClickPlan.wasVectorClamped ? "yes" : "no"} tilePx=${minimapClickPlan.minimapTilePx}px effectiveTilePx=${minimapClickPlan.effectiveMinimapTilePx.toFixed(2)} tilePxScale=${minimapClickPlan.minimapTilePxScale.toFixed(3)} radiusRatio=${minimapClickPlan.minimapRadiusRatio.toFixed(3)} offset=${minimapClickPlan.projectionOffsetLocalX.toFixed(1)},${minimapClickPlan.projectionOffsetLocalY.toFixed(1)} waypointDelta=${minimapClickPlan.dxTiles},${minimapClickPlan.dyTiles} directToWaypoint=${minimapClickPlan.distanceTiles} tile(s) pathToWaypoint=${minimapClickPlan.pathTiles} step(s) clickVector=${execution.clickVectorX},${execution.clickVectorY} eta=${formatGeneralStoreTravelEstimate(travel)} sceneFallback=mouse-ocr-unconfirmed.`,
      );

      const waitMs = ticksToMs(travel.waitTicks, GAME_TICK_MS) + randomIntInclusive(80, 320);
      await sleepWithAbort(waitMs, () => isCurrentRunActive(token));
      continue;
    }

    warn(
      `${routeDefinition.logPrefix} movement stopped: refused to click because mouse OCR did not confirm any eligible tile and minimap projection was unavailable. lastTarget=${attemptedWaypoint.tile.x},${attemptedWaypoint.tile.y},${attemptedWaypoint.tile.z} groups=${waypointAttempts.length}.`,
    );
    return false;
  }

  if (isCurrentRunActive(token)) {
    warn(`${routeDefinition.logPrefix} movement stopped: max walk clicks reached before arrival.`);
  }
  return false;
}

async function walkToGeneralStore(token: number): Promise<boolean> {
  return walkToSectionOneDestination(token, {
    logPrefix: "Section 1.1 Step 1",
    destinationLabel: "Lumbridge General store",
    snapshotIdPrefix: "section-1-step-1",
    snapshotLabel: "Section 1.1 Step 1: walk to Lumbridge General store",
    sourceStep: STEP_SECTION_ONE_WALK_GENERAL_STORE_ID,
    planRoute: planEndToEndGeneralStoreRoute,
  });
}

async function walkToXMarksTheSpotStart(token: number): Promise<boolean> {
  return walkToSectionOneDestination(token, {
    logPrefix: "Section 1.1 Step 2",
    destinationLabel: "X Marks the Spot quest start",
    snapshotIdPrefix: "section-1-step-2",
    snapshotLabel: "Section 1.1 Step 2: walk to X Marks the Spot quest start",
    sourceStep: STEP_SECTION_ONE_WALK_X_MARKS_THE_SPOT_ID,
    planRoute: planEndToEndXMarksTheSpotStartRoute,
  });
}

async function walkToXMarksTheSpotDigTile(token: number, digTile: GeneralStoreTile): Promise<boolean> {
  return walkToSectionOneDestination(token, {
    logPrefix: "Section 1.1 Step 2 dig",
    destinationLabel: `X Marks the Spot dig tile ${formatGeneralStoreTile(digTile)}`,
    snapshotIdPrefix: "section-1-step-2-dig",
    snapshotLabel: `Section 1.1 Step 2: walk to X Marks the Spot dig tile ${formatGeneralStoreTile(digTile)}`,
    sourceStep: STEP_SECTION_ONE_STEP_TWO_DIG_ID,
    planRoute: (playerTile) => planEndToEndXMarksTheSpotDigTileRoute(playerTile, digTile),
  });
}

async function followQuestHelperMinimapCyanArrow(token: number): Promise<boolean> {
  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 2 minimap arrow skipped: RuneLite window not found.");
    return false;
  }

  let clickedCount = 0;
  let trustedCoordinateBox: StartupPlayerTileCalibration["coordinateBox"] = null;
  let lastPlayerTile: StartupPlayerTileCalibration["playerTile"] = null;
  for (
    let clickIndex = 1;
    clickIndex <= SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_CLICKS && isCurrentRunActive(token);
    clickIndex += 1
  ) {
    const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
      requireRuneLiteCoordinatePattern: true,
      preferredCoordinateBox: trustedCoordinateBox,
      lockToPreferredCoordinateBox: trustedCoordinateBox !== null,
      expectedTile: lastPlayerTile,
      maxTileJump: GENERAL_STORE_MAX_COORDINATE_JUMP_TILES,
    });
    if (!calibration) {
      warn("Section 1.1 Step 2 minimap arrow stopped: RuneLite screenshot capture bounds unavailable.");
      return clickedCount > 0;
    }
    if (!calibration.playerTile) {
      warn(
        `Section 1.1 Step 2 minimap arrow stopped: player tile was not detected, so indirect minimap movement would not be environment-aware. raw='${calibration.coordinateLine ?? "unavailable"}' rejected='${calibration.rejectedCoordinateLine ?? "none"}' rejectReason='${calibration.coordinateRejectReason ?? "none"}' source=${calibration.coordinateReadSource ?? "none"} box=${formatCoordinateBoxForLog(calibration)} debug=${calibration.coordinateDebugPath ?? "none"} attempts=${formatCoordinateReadAttemptsForLog(calibration, 8)}.`,
      );
      return clickedCount > 0;
    }

    trustedCoordinateBox = calibration.coordinateBox ?? trustedCoordinateBox;
    lastPlayerTile = calibration.playerTile;

    const environmentStatus = await prepareKnownEnvironmentForMovement(
      calibration,
      null,
      token,
      "Section 1.1 Step 2 minimap arrow",
      { assumeLeavingLumbridgePub: true },
    );
    if (!isCurrentRunActive(token)) {
      return clickedCount > 0;
    }
    if (environmentStatus === "changed") {
      continue;
    }
    if (environmentStatus === "unavailable") {
      return clickedCount > 0;
    }

    const sceneDetection = await findQuestHelperSceneCyanMarker(calibration, `click-${clickIndex}`);
    if (!isCurrentRunActive(token)) {
      return clickedCount > 0;
    }

    if (sceneDetection.selected) {
      const markerTile = await readQuestHelperSceneMarkerTile(
        calibration,
        sceneDetection.selected,
        token,
        `click-${clickIndex}`,
      );
      if (!isCurrentRunActive(token)) {
        return clickedCount > 0;
      }

      if (markerTile) {
        log(
          `Section 1.1 Step 2 dig marker resolved: player=${formatGeneralStoreTile(calibration.playerTile)} digTile=${formatGeneralStoreTile(markerTile.tile)} distance=${tileDistance(calibration.playerTile, markerTile.tile)} tile(s); clicking the exact marker OCR point, then Spade click.`,
        );
        setAutomateBotCurrentStep(STEP_SECTION_ONE_STEP_TWO_DIG_ID);
        const digTileReached = await clickVisibleDigTileMarkerAndWait(calibration, markerTile, token);
        if (!isCurrentRunActive(token)) {
          return false;
        }
        if (!digTileReached) {
          warn(
            `Section 1.1 Step 2 dig stopped: direct marker click did not reach dig tile ${formatGeneralStoreTile(markerTile.tile)}.`,
          );
          return false;
        }

        return clickInventorySpadeForXMarksDig(token, markerTile.tile);
      }

      {
        const bitmap = captureScreenBitmap(calibration.captureBounds);
        const clickLocal = getRandomQuestHelperSceneMarkerClickPoint(sceneDetection.selected, bitmap);
        const clickScreen = {
          x: calibration.captureBounds.x + clickLocal.x,
          y: calibration.captureBounds.y + clickLocal.y,
        };
        const movedToSceneMarkerPoint = await moveMouseHumanLike(clickScreen.x, clickScreen.y, calibration.captureBounds, {
          minDurationMs: SECTION_ONE_STEP_TWO_SCENE_MARKER_MOVE_MIN_MS,
          maxDurationMs: SECTION_ONE_STEP_TWO_SCENE_MARKER_MOVE_MAX_MS,
          minStepMs: 15,
          maxStepMs: 36,
          jitterPx: 1.8,
          overshootChance: 0.13,
          maxOvershootPx: 8,
          safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
          shouldContinue: () => isCurrentRunActive(token),
        });
        if (!isCurrentRunActive(token)) {
          return clickedCount > 0;
        }

        const clickedPoint = clickScreenPoint(clickScreen.x, clickScreen.y, calibration.captureBounds, {
          settleMs: randomIntInclusive(65, 155),
          safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
        });
        clickedCount += 1;
        const waitTicks = estimateQuestHelperSceneMarkerWaitTicks(sceneDetection.selected, bitmap);
        log(
          `Section 1.1 Step 2 scene cyan marker click ${clickIndex}/${SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_CLICKS}: marker tile read failed, so clicked marker only to reposition. marker=${formatCyanBoxForLog(sceneDetection.selected)} local=${clickLocal.x},${clickLocal.y} movedToMarker=${movedToSceneMarkerPoint.x},${movedToSceneMarkerPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} waitTicks=${waitTicks} detection=${formatQuestHelperSceneMarkerDetection(sceneDetection)} file=${sceneDetection.debugPath}.`,
        );

        await sleepWithAbort(ticksToMs(waitTicks, GAME_TICK_MS) + randomIntInclusive(120, 360), () =>
          isCurrentRunActive(token),
        );
        continue;
      }
    }

    const detection = await findQuestHelperMinimapCyanArrow(calibration, token, `click-${clickIndex}`);
    if (!isCurrentRunActive(token)) {
      return clickedCount > 0;
    }

    if (!detection?.selected) {
      if (clickedCount > 0) {
        log(
          `Section 1.1 Step 2 cyan marker follow complete: minimap arrow and scene marker disappeared after ${clickedCount} click(s).`,
        );
        return true;
      }

      warn("Section 1.1 Step 2 cyan marker stopped: no cyan Quest Helper arrow was detected in the minimap or scene.");
      return false;
    }

    const bitmap = captureScreenBitmap(calibration.captureBounds);
    const clickLocal = getRandomQuestHelperMinimapArrowClickPoint(detection.selected, bitmap, detection.minimap);
    const clickScreen = {
      x: calibration.captureBounds.x + clickLocal.x,
      y: calibration.captureBounds.y + clickLocal.y,
    };
    const movedToArrowPoint = await moveMouseHumanLike(clickScreen.x, clickScreen.y, calibration.captureBounds, {
      minDurationMs: SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MOVE_MIN_MS,
      maxDurationMs: SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MOVE_MAX_MS,
      minStepMs: 15,
      maxStepMs: 36,
      jitterPx: 1.8,
      overshootChance: 0.13,
      maxOvershootPx: 8,
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      shouldContinue: () => isCurrentRunActive(token),
    });
    if (!isCurrentRunActive(token)) {
      return clickedCount > 0;
    }

    const clickedPoint = clickScreenPoint(clickScreen.x, clickScreen.y, calibration.captureBounds, {
      settleMs: randomIntInclusive(65, 155),
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    });
    clickedCount += 1;
    const waitTicks = estimateQuestHelperMinimapArrowWaitTicks(detection);
    const dxPx = detection.selected.centerX - detection.minimap.centerLocalX;
    const dyPx = detection.selected.centerY - detection.minimap.centerLocalY;
    log(
      `Section 1.1 Step 2 minimap arrow click ${clickIndex}/${SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_CLICKS}: arrow=${formatCyanBoxForLog(detection.selected)} minimap=${detection.minimap.centerLocalX},${detection.minimap.centerLocalY}/r=${detection.minimap.radiusPx}/source=${detection.minimap.source} deltaPx=${dxPx},${dyPx} local=${clickLocal.x},${clickLocal.y} movedToArrow=${movedToArrowPoint.x},${movedToArrowPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} waitTicks=${waitTicks} detection=${formatQuestHelperMinimapArrowDetection(detection)} file=${detection.debugPath}.`,
    );

    await sleepWithAbort(ticksToMs(waitTicks, GAME_TICK_MS) + randomIntInclusive(120, 360), () =>
      isCurrentRunActive(token),
    );
  }

  if (isCurrentRunActive(token)) {
    warn(
      `Section 1.1 Step 2 minimap arrow stopped: max arrow clicks reached (${SECTION_ONE_STEP_TWO_MINIMAP_ARROW_MAX_CLICKS}) before the cyan arrow disappeared.`,
    );
  }
  return clickedCount > 0;
}

async function hoverTileForActionProbe(
  calibration: StartupPlayerTileCalibration,
  tile: GeneralStoreTile,
  routePathTiles: GeneralStoreTile[],
  token: number,
  debugSlug: string,
): Promise<{ hoverScreenPoint: ScreenPoint; hoverLocalPoint: ScreenPoint; bitmap: ScreenBitmap; fullDebugPath: string; cropDebugPath: string | null; coordinateHover: string } | null> {
  const hoverPlan = await projectGeneralStoreSceneClick(
    calibration,
    tile,
    1,
    "path",
    [tile],
    routePathTiles,
    token,
    false,
  );
  let hoverScreenPoint = hoverPlan?.screenPoint ?? null;
  let coordinateHover = hoverPlan ? `${hoverPlan.hoveredTile.x},${hoverPlan.hoveredTile.y},${hoverPlan.hoveredTile.z}/err=${hoverPlan.finalErrorTiles}` : "not-confirmed";

  if (!hoverScreenPoint) {
    const projection = inferGeneralStoreSceneProjection(calibration);
    const projected = projectGeneralStoreSceneTilePointWithCalibration(
      calibration,
      projection,
      tile,
      getGeneralStoreSceneTargetEdgeMarginPx(calibration),
    );
    if (!projected) {
      return null;
    }

    coordinateHover = "projected-fallback";
    hoverScreenPoint = getSafeScreenPoint(
      projected.screenPoint.x,
      projected.screenPoint.y,
      calibration.captureBounds,
      GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    );
    await moveMouseHumanLike(hoverScreenPoint.x, hoverScreenPoint.y, calibration.captureBounds, {
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      minDurationMs: GENERAL_STORE_MOUSE_MOVE_MIN_MS,
      maxDurationMs: GENERAL_STORE_MOUSE_MOVE_MAX_MS,
      jitterPx: GENERAL_STORE_MOUSE_MOVE_JITTER_PX,
      overshootChance: GENERAL_STORE_MOUSE_MOVE_OVERSHOOT_CHANCE,
      shouldContinue: () => isCurrentRunActive(token),
    });
  }

  if (!isCurrentRunActive(token)) {
    return null;
  }

  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_TWO_VEOS_HOVER_SETTLE_MIN_MS, SECTION_ONE_STEP_TWO_VEOS_HOVER_SETTLE_MAX_MS),
    () => isCurrentRunActive(token),
  );
  if (!isCurrentRunActive(token)) {
    return null;
  }

  const bitmap = captureScreenBitmap(calibration.captureBounds);
  const hoverLocalPoint = {
    x: clamp(hoverScreenPoint.x - calibration.captureBounds.x, 0, bitmap.width - 1),
    y: clamp(hoverScreenPoint.y - calibration.captureBounds.y, 0, bitmap.height - 1),
  };
  const debugTimestamp = buildEndToEndDebugTimestamp();
  const fullDebugPath = buildEndToEndDebugPath(`end-to-end-section-1-step-2-${debugSlug}-hover`, debugTimestamp);
  await saveBitmapAsync(bitmap, fullDebugPath);

  const cropBounds = makeHoverTextSearchBox(bitmap, hoverLocalPoint.x - 260, hoverLocalPoint.y - 150, 520, 300);
  const hoverCrop = cropBitmap(bitmap, cropBounds);
  const cropDebugPath = hoverCrop
    ? buildEndToEndDebugPath(`end-to-end-section-1-step-2-${debugSlug}-hover-crop`, debugTimestamp)
    : null;
  if (hoverCrop && cropDebugPath) {
    await saveBitmapAsync(hoverCrop, cropDebugPath);
  }

  return {
    hoverScreenPoint,
    hoverLocalPoint,
    bitmap,
    fullDebugPath,
    cropDebugPath,
    coordinateHover,
  };
}

async function ensureLumbridgePubDoorOpen(
  calibration: StartupPlayerTileCalibration,
  route: EndToEndGeneralStoreRoutePlan,
  doorTile: GeneralStoreTile,
  token: number,
): Promise<"opened" | "already-open" | "unavailable"> {
  const playerTile = calibration.playerTile;
  if (!playerTile) {
    return "unavailable";
  }

  const doorName = formatLumbridgePubDoorName(doorTile);
  const routePathTiles = route.pathTiles.length > 0 ? route.pathTiles : [playerTile, doorTile];
  const candidates = getLumbridgePubDoorInteractionCandidates(doorTile, route);
  const candidateSummary = candidates
    .map((candidate, index) => `${index + 1}:${candidate.source}@${formatGeneralStoreTile(candidate.tile)}`)
    .join("|");
  log(
    `Section 1.1 Step 2 pub door check: ${doorName} door=${formatGeneralStoreTile(doorTile)} candidates=${candidateSummary || "none"} player=${formatGeneralStoreTile(playerTile)}.`,
  );

  let sawWalkOnlyHover = false;
  const probeSummaries: string[] = [];

  for (let index = 0; index < candidates.length && isCurrentRunActive(token); index += 1) {
    const candidate = candidates[index];
    const debugSource = candidate.source.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const hover = await hoverTileForActionProbe(
      calibration,
      candidate.tile,
      routePathTiles,
      token,
      `pub-${doorName}-door-${debugSource}`,
    );
    if (!hover) {
      const summary = `${index + 1}:${candidate.source}@${formatGeneralStoreTile(candidate.tile)} status=no-hover`;
      probeSummaries.push(summary);
      log(`Section 1.1 Step 2 pub door hover probe ${summary}.`);
      continue;
    }

    const openText = detectTalkToHoverTextNearPoint(hover.bitmap, hover.hoverLocalPoint, calibration.windowsScalePercent, "Open");
    const closeText = detectTalkToHoverTextNearPoint(hover.bitmap, hover.hoverLocalPoint, calibration.windowsScalePercent, "Close");
    const walkText = detectTalkToHoverTextNearPoint(hover.bitmap, hover.hoverLocalPoint, calibration.windowsScalePercent, "Walk");
    const openDetected = openText.found;
    const closeDetected = closeText.found;
    const walkDetected = walkText.found;
    const status = openDetected
      ? "open"
      : closeDetected
        ? "close"
        : walkDetected
          ? "walk-only"
          : "no-hover-action";
    const summary =
      `${index + 1}:${candidate.source}@${formatGeneralStoreTile(candidate.tile)} status=${status}` +
      ` hover=${hover.hoverScreenPoint.x},${hover.hoverScreenPoint.y}` +
      ` coordinateHover=${hover.coordinateHover}`;
    probeSummaries.push(summary);
    log(
      `Section 1.1 Step 2 pub door hover probe ${summary} openProbes=${openText.probes.map(formatHoverTextProbeForLog).join(" ; ")} closeProbes=${closeText.probes.map(formatHoverTextProbeForLog).join(" ; ")} walkProbes=${walkText.probes.map(formatHoverTextProbeForLog).join(" ; ")} hoverFile=${hover.fullDebugPath} crop=${hover.cropDebugPath ?? "none"}.`,
    );

    if (closeDetected && !openDetected) {
      log(
        `Section 1.1 Step 2 pub door check: ${doorName} door already open; left-click hover action exposed Close, so not clicking because it would close the door. candidate=${candidate.source}@${formatGeneralStoreTile(candidate.tile)} player=${formatGeneralStoreTile(playerTile)} closeBest=${closeText.best ? formatHoverTextProbeForLog(closeText.best) : "none"}.`,
      );
      return "already-open";
    }

    if (openDetected) {
      const movedToDoorPoint = await moveMouseHumanLike(hover.hoverScreenPoint.x, hover.hoverScreenPoint.y, calibration.captureBounds, {
        minDurationMs: SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_MOVE_MIN_MS,
        maxDurationMs: SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_MOVE_MAX_MS,
        minStepMs: 14,
        maxStepMs: 32,
        jitterPx: 1.5,
        overshootChance: 0.12,
        maxOvershootPx: 7,
        shouldContinue: () => isCurrentRunActive(token),
      });
      if (!isCurrentRunActive(token)) {
        return "unavailable";
      }

      const clickedPoint = clickScreenPoint(hover.hoverScreenPoint.x, hover.hoverScreenPoint.y, calibration.captureBounds, {
        settleMs: randomIntInclusive(120, 310),
        safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      });
      log(
        `Section 1.1 Step 2 pub door open: left-clicked door candidate after hover action exposed Open. door=${doorName}:${formatGeneralStoreTile(doorTile)} candidate=${candidate.source}@${formatGeneralStoreTile(candidate.tile)} player=${formatGeneralStoreTile(playerTile)} hover=${hover.hoverScreenPoint.x},${hover.hoverScreenPoint.y} movedToDoor=${movedToDoorPoint.x},${movedToDoorPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} coordinateHover=${hover.coordinateHover} openBest=${openText.best ? formatHoverTextProbeForLog(openText.best) : "none"} hoverFile=${hover.fullDebugPath} crop=${hover.cropDebugPath ?? "none"}.`,
      );
      await sleepWithAbort(
        ticksToMs(2, GAME_TICK_MS) + randomIntInclusive(
          SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_AFTER_CLICK_MIN_MS,
          SECTION_ONE_STEP_TWO_PUB_DOOR_MENU_AFTER_CLICK_MAX_MS,
        ),
        () => isCurrentRunActive(token),
      );
      return "opened";
    }

    if (walkDetected) {
      sawWalkOnlyHover = true;
    }
  }

  if (sawWalkOnlyHover) {
    log(
      `Section 1.1 Step 2 pub door check: ${doorName} door treated as passable/already open because hover action exposed Walk but no Open/Close. door=${formatGeneralStoreTile(doorTile)} player=${formatGeneralStoreTile(playerTile)} probes=${probeSummaries.join(" ; ")}.`,
    );
    return "already-open";
  }

  warn(
    `Section 1.1 Step 2 pub door check failed: no hover candidate exposed Open, Close, or Walk. door=${doorName}:${formatGeneralStoreTile(doorTile)} player=${formatGeneralStoreTile(playerTile)} candidates=${candidateSummary || "none"} probes=${probeSummaries.join(" ; ") || "none"}.`,
  );
  return "unavailable";
}

async function rightClickTalkToXMarksQuestIconMarker(
  calibration: StartupPlayerTileCalibration,
  veosTile: GeneralStoreTile,
  marker: Awaited<ReturnType<typeof findXMarksQuestIconMarker>>,
  token: number,
): Promise<boolean> {
  if (!isCurrentRunActive(token) || !marker.match || !marker.screenPoint) {
    return false;
  }

  const clickJitterX = Math.max(1, Math.min(4, Math.round(marker.match.width * 0.12)));
  const clickJitterY = Math.max(1, Math.min(4, Math.round(marker.match.height * 0.12)));
  const clickScreen = getSafeScreenPoint(
    marker.screenPoint.x + randomIntInclusive(-clickJitterX, clickJitterX),
    marker.screenPoint.y + randomIntInclusive(-clickJitterY, clickJitterY),
    calibration.captureBounds,
    GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  );
  const clickLocal = {
    x: clamp(clickScreen.x - calibration.captureBounds.x, 0, calibration.captureBounds.width - 1),
    y: clamp(clickScreen.y - calibration.captureBounds.y, 0, calibration.captureBounds.height - 1),
  };

  const movedToIconPoint = await moveMouseHumanLike(clickScreen.x, clickScreen.y, calibration.captureBounds, {
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    minDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 32,
    jitterPx: 1.3,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  await sleepWithAbort(randomIntInclusive(70, 145), () => isCurrentRunActive(token));
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const beforeRightClickBitmap = captureScreenBitmap(calibration.captureBounds);
  const rightClickedPoint = clickScreenPoint(clickScreen.x, clickScreen.y, calibration.captureBounds, {
    button: "right",
    settleMs: randomIntInclusive(SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MIN_MS, SECTION_ONE_STEP_ONE_CONTEXT_MENU_OPEN_MAX_MS),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  let afterRightClickBitmap: ScreenBitmap | null = null;
  let contextMenu: EndToEndContextMenuOptionDetection | null = null;
  let contextMenuCaptureAttempt = 0;
  for (
    let attempt = 1;
    attempt <= SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_ATTEMPTS && isCurrentRunActive(token);
    attempt += 1
  ) {
    await sleepWithAbort(
      randomIntInclusive(
        SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_DELAY_MIN_MS,
        SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_DELAY_MAX_MS,
      ),
      () => isCurrentRunActive(token),
    );
    if (!isCurrentRunActive(token)) {
      return false;
    }

    const attemptBitmap = captureScreenBitmap(calibration.captureBounds);
    const attemptContextMenu = detectContextMenuOptionFromBitmapDiff(
      beforeRightClickBitmap,
      attemptBitmap,
      clickLocal,
      calibration.windowsScalePercent,
      "Talk-to",
    );
    afterRightClickBitmap = attemptBitmap;
    contextMenu = attemptContextMenu;
    contextMenuCaptureAttempt = attempt;
    if (attemptContextMenu) {
      break;
    }
  }
  if (!afterRightClickBitmap) {
    return false;
  }
  const firstAction = contextMenu ? selectFirstContextMenuActionPoint(contextMenu, afterRightClickBitmap) : null;
  const talkToLocalPoint =
    getDetectedContextMenuActionLocalPoint(contextMenu) ??
    getDetectedFirstContextMenuActionLocalPoint(contextMenu) ??
    firstAction?.localPoint ??
    null;
  const talkToSource = contextMenu?.optionLocalPoint
    ? "ocr-template"
    : firstAction
      ? "first-action-fallback"
      : "not-detected";
  const hoverText = detectTalkToHoverTextNearPoint(
    afterRightClickBitmap,
    clickLocal,
    calibration.windowsScalePercent,
    "Talk-to",
  );
  const debugTimestamp = buildEndToEndDebugTimestamp();
  const rawDebugPath = buildEndToEndDebugPath("end-to-end-section-1-step-2-veos-quest-icon-right-click-raw", debugTimestamp);
  await saveBitmapAsync(afterRightClickBitmap, rawDebugPath);
  const debugPath = buildEndToEndDebugPath("end-to-end-section-1-step-2-veos-quest-icon-right-click", debugTimestamp);
  const menuBoxes = [
    ...(contextMenu ? [contextMenu.menuBox] : []),
    ...(contextMenu?.optionMatch ? [contextMenu.optionMatch.wordBox] : []),
    ...(talkToLocalPoint ? [{ x: talkToLocalPoint.x - 6, y: talkToLocalPoint.y - 6, width: 13, height: 13 }] : []),
    ...(hoverText.best ? [hoverText.best.searchBox] : []),
    ...(hoverText.best?.talkToMatch ? [hoverText.best.talkToMatch.wordBox] : []),
  ];
  await saveBitmapWithItemIconTemplateDebug(afterRightClickBitmap, marker.detection, debugPath, {
    clickPoint: clickLocal,
    debugBoxes: marker.cyanBoxes,
    menuBoxes,
  });

  if (!contextMenu || !talkToLocalPoint) {
    if (!contextMenu && hoverText.found) {
      const movedToFallbackPoint = await moveMouseHumanLike(clickScreen.x, clickScreen.y, calibration.captureBounds, {
        safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
        minDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MIN_MS,
        maxDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MAX_MS,
        minStepMs: 14,
        maxStepMs: 32,
        jitterPx: 1.2,
        overshootChance: 0.1,
        maxOvershootPx: 6,
        shouldContinue: () => isCurrentRunActive(token),
      });
      if (!isCurrentRunActive(token)) {
        return false;
      }

      const clickedPoint = clickScreenPoint(clickScreen.x, clickScreen.y, calibration.captureBounds, {
        settleMs: randomIntInclusive(120, 310),
        safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      });
      log(
        `Section 1.1 Step 2 Veos Talk-to: right-click did not open a detected context menu, but hover text exposed Talk-to; clicked the quest icon marker with left-click. targetTile=${formatGeneralStoreTile(veosTile)} player=${calibration.playerTile ? formatGeneralStoreTile(calibration.playerTile) : "unknown"} icon=${marker.match.centerX},${marker.match.centerY}:${marker.match.score.toFixed(3)} cyan=${marker.matchedCyanBox ? formatCyanBoxForLog(marker.matchedCyanBox) : "none"} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} local=${clickLocal.x},${clickLocal.y} movedToIcon=${movedToIconPoint.x},${movedToIconPoint.y} captureAttempt=${contextMenuCaptureAttempt}/${SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_ATTEMPTS} movedToFallback=${movedToFallbackPoint.x},${movedToFallbackPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} hoverBest=${hoverText.best ? formatHoverTextProbeForLog(hoverText.best) : "none"} hoverProbes=${hoverText.probes.map(formatHoverTextProbeForLog).join(" ; ")} rawFile=${rawDebugPath} file=${debugPath} questFile=${marker.questDebugPath}.`,
      );
      await sleepWithAbort(
        randomIntInclusive(
          SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MIN_MS,
          SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MAX_MS,
        ),
        () => isCurrentRunActive(token),
      );
      return true;
    }

    warn(
      `Section 1.1 Step 2 Veos Talk-to stopped: right-clicked quest icon marker but Talk-to menu action was not detected. player=${calibration.playerTile ? formatGeneralStoreTile(calibration.playerTile) : "unknown"} targetTile=${formatGeneralStoreTile(veosTile)} icon=${marker.match.centerX},${marker.match.centerY}:${marker.match.score.toFixed(3)} cyan=${marker.matchedCyanBox ? formatCyanBoxForLog(marker.matchedCyanBox) : "none"} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} local=${clickLocal.x},${clickLocal.y} movedToIcon=${movedToIconPoint.x},${movedToIconPoint.y} captureAttempt=${contextMenuCaptureAttempt}/${SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_ATTEMPTS} menu=${contextMenu ? `${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height}` : "none"} textBands=${contextMenu?.textBands.map((band) => `${band.centerY}:${band.minX}-${band.maxX}/${band.pixelCount}`).join("|") || "none"} wordMatches=${contextMenu?.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} hoverFound=${hoverText.found ? "yes" : "no"} hoverBest=${hoverText.best ? formatHoverTextProbeForLog(hoverText.best) : "none"} rawFile=${rawDebugPath} file=${debugPath} questFile=${marker.questDebugPath}.`,
    );
    return false;
  }

  const talkToScreenPoint = {
    x: calibration.captureBounds.x + talkToLocalPoint.x,
    y: calibration.captureBounds.y + talkToLocalPoint.y,
  };
  const movedToTalkToPoint = await moveMouseHumanLike(talkToScreenPoint.x, talkToScreenPoint.y, calibration.captureBounds, {
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    minDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 32,
    jitterPx: 1.4,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const clickedPoint = clickScreenPoint(talkToScreenPoint.x, talkToScreenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(120, 310),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  log(
    `Section 1.1 Step 2 Veos Talk-to: right-clicked quest icon marker and selected Talk-to. targetTile=${formatGeneralStoreTile(veosTile)} player=${calibration.playerTile ? formatGeneralStoreTile(calibration.playerTile) : "unknown"} icon=${marker.match.centerX},${marker.match.centerY}:${marker.match.score.toFixed(3)} cyan=${marker.matchedCyanBox ? formatCyanBoxForLog(marker.matchedCyanBox) : "none"} rightClick=${rightClickedPoint.x},${rightClickedPoint.y} rightClickLocal=${clickLocal.x},${clickLocal.y} movedToIcon=${movedToIconPoint.x},${movedToIconPoint.y} captureAttempt=${contextMenuCaptureAttempt}/${SECTION_ONE_STEP_TWO_VEOS_CONTEXT_MENU_CAPTURE_ATTEMPTS} menu=${contextMenu.menuBox.x},${contextMenu.menuBox.y},${contextMenu.menuBox.width}x${contextMenu.menuBox.height} changed=${contextMenu.changedPixels} fill=${contextMenu.fillRatio.toFixed(2)} talkToSource=${talkToSource} talkToMatch=${contextMenu.optionMatch ? formatContextMenuWordMatch(contextMenu.optionMatch) : "none"} wordMatches=${contextMenu.wordMatches.map(formatContextMenuWordMatch).join("|") || "none"} talkToLocal=${talkToLocalPoint.x},${talkToLocalPoint.y} movedToTalkTo=${movedToTalkToPoint.x},${movedToTalkToPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} rawFile=${rawDebugPath} file=${debugPath} questFile=${marker.questDebugPath}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MIN_MS, SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MAX_MS),
    () => isCurrentRunActive(token),
  );
  return true;
}

async function talkToVeos(token: number): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return false;
  }

  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 2 Veos Talk-to skipped: RuneLite window not found.");
    return false;
  }

  const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
    requireRuneLiteCoordinatePattern: true,
  });
  if (!calibration || !calibration.playerTile) {
    warn(
      `Section 1.1 Step 2 Veos Talk-to skipped: player tile unavailable. raw='${calibration?.coordinateLine ?? "unavailable"}' box=${calibration ? formatCoordinateBoxForLog(calibration) : "none"} debug=${calibration?.coordinateDebugPath ?? "none"}.`,
    );
    return false;
  }

  const veosTile: GeneralStoreTile = { ...SECTION_ONE_STEP_TWO_VEOS_TILE };
  const route = planEndToEndXMarksTheSpotStartRoute(calibration.playerTile);
  await ensureGeneralStoreSceneMouseCalibration(calibration, route, token);
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const routePathTiles: GeneralStoreTile[] = [
    { x: calibration.playerTile.x, y: calibration.playerTile.y, z: calibration.playerTile.z },
    veosTile,
  ];
  const questIconProbe = await findXMarksQuestIconMarker(calibration, "veos-talk");
  if (!isCurrentRunActive(token)) {
    return false;
  }

  if (questIconProbe.screenPoint && questIconProbe.matchedCyanBox) {
    return rightClickTalkToXMarksQuestIconMarker(calibration, veosTile, questIconProbe, token);
  }

  if (questIconProbe.screenPoint && !questIconProbe.matchedCyanBox) {
    log(
      `Section 1.1 Step 2 Veos Talk-to: quest icon template matched without nearby cyan marker, ignoring it and falling back to static tile projection. icon=${questIconProbe.match ? `${questIconProbe.match.centerX},${questIconProbe.match.centerY}:${questIconProbe.match.score.toFixed(3)}` : "none"} selection=${questIconProbe.selectionSource} debug=${questIconProbe.debugPath}.`,
    );
  }

  let hoverPlan: GeneralStoreSceneClickPlan | null = null;
  let hoverScreenPoint: ScreenPoint | null = null;
  let hoverSource = "projected-fallback";
  let coordinateHover = "not-confirmed";

  if (!hoverScreenPoint) {
    hoverPlan = await projectGeneralStoreSceneClick(
      calibration,
      veosTile,
      1,
      "path",
      [veosTile],
      routePathTiles,
      token,
      false,
    );
    hoverScreenPoint = hoverPlan?.screenPoint ?? null;
    hoverSource = hoverPlan ? "exact-hover" : "projected-fallback";
    coordinateHover = hoverPlan
      ? `${hoverPlan.hoveredTile.x},${hoverPlan.hoveredTile.y},${hoverPlan.hoveredTile.z}/err=${hoverPlan.finalErrorTiles}`
      : "not-confirmed";
  }

  if (!hoverScreenPoint) {
    const projection = inferGeneralStoreSceneProjection(calibration);
    const projected = projectGeneralStoreSceneTilePointWithCalibration(
      calibration,
      projection,
      veosTile,
      getGeneralStoreSceneTargetEdgeMarginPx(calibration),
    );
    if (!projected) {
      warn(
        `Section 1.1 Step 2 Veos Talk-to stopped: could not project static Veos tile ${veosTile.x},${veosTile.y},${veosTile.z}. player=${calibration.playerTile.x},${calibration.playerTile.y},${calibration.playerTile.z}.`,
      );
      return false;
    }

    hoverScreenPoint = getSafeScreenPoint(
      projected.screenPoint.x,
      projected.screenPoint.y,
      calibration.captureBounds,
      GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    );
    coordinateHover = "projected-fallback";
    await moveMouseHumanLike(hoverScreenPoint.x, hoverScreenPoint.y, calibration.captureBounds, {
      safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      minDurationMs: GENERAL_STORE_MOUSE_MOVE_MIN_MS,
      maxDurationMs: GENERAL_STORE_MOUSE_MOVE_MAX_MS,
      jitterPx: GENERAL_STORE_MOUSE_MOVE_JITTER_PX,
      overshootChance: GENERAL_STORE_MOUSE_MOVE_OVERSHOOT_CHANCE,
      shouldContinue: () => isCurrentRunActive(token),
    });
  }

  if (!isCurrentRunActive(token)) {
    return false;
  }

  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_TWO_VEOS_HOVER_SETTLE_MIN_MS, SECTION_ONE_STEP_TWO_VEOS_HOVER_SETTLE_MAX_MS),
    () => isCurrentRunActive(token),
  );
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const afterHoverBitmap = captureScreenBitmap(calibration.captureBounds);
  const hoverLocalPoint = {
    x: clamp(hoverScreenPoint.x - calibration.captureBounds.x, 0, afterHoverBitmap.width - 1),
    y: clamp(hoverScreenPoint.y - calibration.captureBounds.y, 0, afterHoverBitmap.height - 1),
  };
  const debugTimestamp = buildEndToEndDebugTimestamp();
  const fullDebugPath = buildEndToEndDebugPath("end-to-end-section-1-step-2-veos-hover", debugTimestamp);
  await saveBitmapAsync(afterHoverBitmap, fullDebugPath);

  const cropBounds = makeHoverTextSearchBox(afterHoverBitmap, hoverLocalPoint.x - 260, hoverLocalPoint.y - 150, 520, 300);
  const hoverCrop = cropBitmap(afterHoverBitmap, cropBounds);
  const cropDebugPath = buildEndToEndDebugPath("end-to-end-section-1-step-2-veos-hover-crop", debugTimestamp);
  if (hoverCrop) {
    await saveBitmapAsync(hoverCrop, cropDebugPath);
  }

  const hoverText = detectTalkToHoverTextNearPoint(afterHoverBitmap, hoverLocalPoint, calibration.windowsScalePercent);
  log(
    `Section 1.1 Step 2 Veos hover: targetTile=${veosTile.x},${veosTile.y},${veosTile.z} player=${calibration.playerTile.x},${calibration.playerTile.y},${calibration.playerTile.z} source=${hoverSource} hoverScreen=${hoverScreenPoint.x},${hoverScreenPoint.y} hoverLocal=${hoverLocalPoint.x},${hoverLocalPoint.y} coordinateHover=${coordinateHover} questIcon=${questIconProbe.match ? `${questIconProbe.match.centerX},${questIconProbe.match.centerY}:${questIconProbe.match.score.toFixed(3)}` : "none"} talkToDetected=${hoverText.found ? "yes" : "no"} best=${hoverText.best ? formatHoverTextProbeForLog(hoverText.best) : "none"} probes=${hoverText.probes.map(formatHoverTextProbeForLog).join(" ; ")} file=${fullDebugPath} crop=${hoverCrop ? cropDebugPath : "none"}.`,
  );

  if (!hoverText.found) {
    return false;
  }

  const movedToVeosPoint = await moveMouseHumanLike(hoverScreenPoint.x, hoverScreenPoint.y, calibration.captureBounds, {
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
    minDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MIN_MS,
    maxDurationMs: SECTION_ONE_STEP_TWO_VEOS_TALK_MOVE_MAX_MS,
    minStepMs: 14,
    maxStepMs: 32,
    jitterPx: 1.4,
    overshootChance: 0.12,
    maxOvershootPx: 7,
    shouldContinue: () => isCurrentRunActive(token),
  });
  if (!isCurrentRunActive(token)) {
    return false;
  }

  const clickedPoint = clickScreenPoint(hoverScreenPoint.x, hoverScreenPoint.y, calibration.captureBounds, {
    settleMs: randomIntInclusive(120, 310),
    safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
  });
  log(
    `Section 1.1 Step 2 Veos Talk-to: clicked left-click Talk-to action. targetTile=${veosTile.x},${veosTile.y},${veosTile.z} player=${calibration.playerTile.x},${calibration.playerTile.y},${calibration.playerTile.z} source=${hoverSource} hoverScreen=${hoverScreenPoint.x},${hoverScreenPoint.y} movedToVeos=${movedToVeosPoint.x},${movedToVeosPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} coordinateHover=${coordinateHover} questIcon=${questIconProbe.match ? `${questIconProbe.match.centerX},${questIconProbe.match.centerY}:${questIconProbe.match.score.toFixed(3)}` : "none"} best=${hoverText.best ? formatHoverTextProbeForLog(hoverText.best) : "none"} file=${fullDebugPath} crop=${hoverCrop ? cropDebugPath : "none"}.`,
  );
  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MIN_MS, SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MAX_MS),
    () => isCurrentRunActive(token),
  );
  return true;
}

async function clickVeosDialogueBlueTextOptions(token: number): Promise<boolean> {
  if (!isCurrentRunActive(token)) {
    return false;
  }

  focusRuneLiteWindowForAutomation();
  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    warn("Section 1.1 Step 2 Veos dialogue skipped: RuneLite window not found.");
    return false;
  }

  const calibration = readStartupPlayerTileCalibration(runeLiteWindow, {
    requireRuneLiteCoordinatePattern: false,
  });
  if (!calibration) {
    warn("Section 1.1 Step 2 Veos dialogue skipped: RuneLite screenshot capture bounds unavailable.");
    return false;
  }

  await sleepWithAbort(
    randomIntInclusive(SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MIN_MS, SECTION_ONE_STEP_TWO_VEOS_TALK_AFTER_CLICK_MAX_MS),
    () => isCurrentRunActive(token),
  );

  let clickedCount = 0;
  let lastDebugPath = "none";

  for (
    let clickIndex = 1;
    clickIndex <= SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_TEXT_CLICKS && isCurrentRunActive(token);
    clickIndex += 1
  ) {
    let clickedThisOption = false;

    for (
      let attempt = 1;
      attempt <= SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_MISSING_ATTEMPTS && isCurrentRunActive(token);
      attempt += 1
    ) {
      await sleepWithAbort(randomIntInclusive(70, 145), () => isCurrentRunActive(token));
      if (!isCurrentRunActive(token)) {
        return false;
      }

      const bitmap = captureScreenBitmap(calibration.captureBounds);
      const detection = detectEndToEndChatboxBlueText(bitmap);
      const currentMouseLocal = getCurrentMouseLocalPoint(calibration, bitmap);
      const clickTarget = detection.target
        ? getEndToEndChatboxTextClickPoint(detection.target, bitmap, detection.targetColor, currentMouseLocal)
        : null;
      const clickLocal = clickTarget?.point;
      const debugPath = buildEndToEndDebugPath(
        `end-to-end-section-1-step-2-veos-dialogue-text-click-${clickIndex}-attempt-${attempt}`,
      );
      lastDebugPath = debugPath;
      await saveEndToEndChatboxBlueTextDebug(bitmap, detection, debugPath, clickLocal);

      if (!detection.target || !clickLocal) {
        log(
          `Section 1.1 Step 2 Veos dialogue clickable chatbox text not found yet: click=${clickIndex}/${SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_TEXT_CLICKS} attempt=${attempt}/${SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_MISSING_ATTEMPTS} ${formatEndToEndChatboxBlueTextDetection(detection)} file=${debugPath}.`,
        );
        await sleepWithAbort(randomIntInclusive(160, 340), () => isCurrentRunActive(token));
        continue;
      }

      const clickScreen = {
        x: calibration.captureBounds.x + clickLocal.x,
        y: calibration.captureBounds.y + clickLocal.y,
      };
      const movedToTextPoint =
        clickTarget?.source === "current-hover"
          ? clickScreen
          : await moveMouseHumanLike(clickScreen.x, clickScreen.y, calibration.captureBounds, {
              safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
              minDurationMs: SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_CLICK_MOVE_MIN_MS,
              maxDurationMs: SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_CLICK_MOVE_MAX_MS,
              minStepMs: 14,
              maxStepMs: 32,
              jitterPx: 1.4,
              overshootChance: 0.12,
              maxOvershootPx: 7,
              shouldContinue: () => isCurrentRunActive(token),
            });
      if (!isCurrentRunActive(token)) {
        return false;
      }

      const clickedPoint = clickScreenPoint(clickScreen.x, clickScreen.y, calibration.captureBounds, {
        settleMs: randomIntInclusive(120, 310),
        safeEdgeMarginPx: GENERAL_STORE_CLICK_SAFE_EDGE_MARGIN_PX,
      });
      clickedCount += 1;
      clickedThisOption = true;
      log(
        `Section 1.1 Step 2 Veos dialogue: clicked ${detection.targetColor ?? "unknown"} chatbox text ${clickedCount}/${SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_TEXT_CLICKS}. target=${formatEndToEndChatboxTextCandidate(detection.target)} clickLocal=${clickLocal.x},${clickLocal.y} clickSource=${clickTarget?.source ?? "unknown"} currentMouseLocal=${currentMouseLocal ? `${currentMouseLocal.x},${currentMouseLocal.y}` : "outside"} movedToText=${movedToTextPoint.x},${movedToTextPoint.y} clicked=${clickedPoint.x},${clickedPoint.y} ${formatEndToEndChatboxBlueTextDetection(detection)} file=${debugPath}.`,
      );
      await sleepWithAbort(
        randomIntInclusive(
          SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_AFTER_CLICK_MIN_MS,
          SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_AFTER_CLICK_MAX_MS,
        ),
        () => isCurrentRunActive(token),
      );
      break;
    }

    if (!clickedThisOption) {
      if (clickedCount === 0) {
        log(
          `Section 1.1 Step 2 Veos dialogue complete: no blue or white chatbox text was detected after ${SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_MISSING_ATTEMPTS} attempt(s). lastFile=${lastDebugPath}.`,
        );
        return true;
      }

      log(
        `Section 1.1 Step 2 Veos dialogue complete: no more blue or white chatbox text after ${clickedCount} click(s). lastFile=${lastDebugPath}.`,
      );
      return true;
    }
  }

  log(
    `Section 1.1 Step 2 Veos dialogue stopped after safety max text clicks: clicked=${clickedCount}/${SECTION_ONE_STEP_TWO_VEOS_DIALOGUE_MAX_TEXT_CLICKS} lastFile=${lastDebugPath}.`,
  );
  return clickedCount > 0;
}

async function runSectionOneStepOne(
  localApiSnapshot: RuneLiteLocalApiSnapshot,
  playerName: string | undefined,
): Promise<EndToEndSectionOneStepOneState> {
  const itemNamesById = loadOsrsItemNamesByIdFromCache();
  const state = evaluateEndToEndSectionOneStepOne(localApiSnapshot, itemNamesById);
  log(`Section 1.1 Step 1 starter gear/spade check: ${formatEndToEndSectionOneStepOneState(state)}.`);
  if (state.status === "complete") {
    markEndToEndGuideStepComplete(state.sourceStepId, "starter gear sold and spade is in inventory", playerName);
  }
  if (state.status === "needs-action") {
    const actions = [
      state.presentTargetItems.length > 0 ? "sell starter gear" : null,
      state.missingRequiredInventoryItemNames.length > 0 ? `buy ${state.missingRequiredInventoryItemNames.join(", ")}` : null,
    ].filter(Boolean);
    log(`Section 1.1 Step 1 next action: walk to Lumbridge General store to ${actions.join(" and ")}.`);
  }
  return state;
}

function prepareProjectOsrsCacheSnapshotForBot(): void {
  try {
    const snapshot = ensureProjectOsrsCacheSnapshot();
    log(
      `OSRS cache snapshot ready: project=${snapshot.targetDirectoryPath} source=${snapshot.sourceDirectoryPath} status=${snapshot.alreadyPresent ? "already-present" : "updated"} copied=${snapshot.copiedFiles.length} skipped=${snapshot.skippedFiles.length} copiedFiles=${snapshot.copiedFiles.slice(0, 8).join("|") || "none"}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`OSRS cache snapshot unavailable: ${message}. Falling back to the installed cache resolver for this run.`);
  }
}

export function onEndToEndBotStart(): void {
  const token = ++runToken;

  void (async () => {
    try {
      setAutomateBotCurrentStep(STEP_START_ID);
      log("Started.");
      prepareProjectOsrsCacheSnapshotForBot();

      let playerName = getConfiguredPlayerName();
      let localApiSnapshot: RuneLiteLocalApiSnapshot | null = null;
      if (playerName) {
        playerName = activateEndToEndPlayerName(playerName, "configured player") ?? playerName;
      }

      try {
        await logSectionOneChecklistExecutionPlan();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`Section 1.1 checklist execution order unavailable: ${message}`);
      }

      setAutomateBotCurrentStep(STEP_RUNELITE_LOCAL_API_ID);
      try {
        localApiSnapshot = await logRuneLiteLocalApiProbe();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`RuneLite local HTTP API unavailable: ${message}`);
      }

      setAutomateBotCurrentStep(STEP_WIKISYNC_LOCAL_ID);
      try {
        playerName = await logWikiSyncLocalSnapshotAndActivatePlayer(playerName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`WikiSync local WebSocket unavailable: ${message}`);
      }

      setAutomateBotCurrentStep(STEP_SECTION_ONE_STEP_ONE_ID);
      let shouldWalkToXMarksTheSpotStart = false;
      if (localApiSnapshot) {
        try {
          const sectionOneStepOneState = await runSectionOneStepOne(localApiSnapshot, playerName);
          if (sectionOneStepOneState.status === "complete") {
            shouldWalkToXMarksTheSpotStart = true;
          } else if (isCurrentRunActive(token)) {
            setAutomateBotCurrentStep(STEP_SECTION_ONE_WALK_GENERAL_STORE_ID);
            const movementComplete = await walkToGeneralStore(token);
            if (!movementComplete) {
              warn("Section 1.1 Step 1 ended before the General store was reached; stopping run before follow-up API/cache checks.");
              return;
            }
            await saveSectionOneStepOneInventoryDebug(sectionOneStepOneState, token);
            const stepOneShopActionComplete = await tradeAndSellSectionOneStepOneInventoryItems(token);
            if (!stepOneShopActionComplete) {
              warn("Section 1.1 Step 1 shop action did not complete; stopping before walking to X Marks the Spot quest start.");
              return;
            }
            shouldWalkToXMarksTheSpotStart = true;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warn(`Section 1.1 Step 1 unavailable: ${message}`);
        }
      } else {
        warn("Section 1.1 Step 1 skipped because RuneLite local HTTP API inventory is unavailable.");
      }

      if (shouldWalkToXMarksTheSpotStart && isCurrentRunActive(token)) {
        setAutomateBotCurrentStep(STEP_SECTION_ONE_STEP_TWO_ID);
        let xMarksQuestStateBeforeStep: XMarksWikiSyncQuestState | null = null;
        try {
          xMarksQuestStateBeforeStep = await logXMarksWikiSyncQuestState(playerName, "before step 2");
          if (xMarksQuestStateBeforeStep) {
            markXMarksStartChecklistCompleteFromWikiSync(xMarksQuestStateBeforeStep, playerName);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warn(`Section 1.1 Step 2 WikiSync quest state before step unavailable: ${message}.`);
        }

        const xMarksAlreadyStartedOrCompleted = isXMarksWikiSyncQuestStartedOrCompleted(xMarksQuestStateBeforeStep?.status);
        if (xMarksQuestStateBeforeStep?.status === "completed") {
          log("Section 1.1 Step 2 skipped: WikiSync says X Marks the Spot is already completed.");
        } else {
          log("Section 1.1 Step 2 next action: activate Quest Helper for X Marks the Spot, then infer whether to start at Veos or follow the active minimap arrow.");
          setAutomateBotCurrentStep(STEP_SECTION_ONE_STEP_TWO_QUEST_HELPER_ID);
          const questHelperActivated = await activateQuestHelperForXMarksTheSpot(token);
          if (!questHelperActivated) {
            warn("Section 1.1 Step 2 Quest Helper activation did not complete; stopping before walking to Veos.");
            return;
          }
          const questHelperSearchStartedOrCompleted = isQuestHelperSearchQuestStartedOrCompleted(
            latestQuestHelperXMarksSearchStatus,
          );
          if (questHelperSearchStartedOrCompleted) {
            markEndToEndGuideStepComplete(
              SECTION_ONE_STEP_TWO_START_X_MARKS_CHECKLIST_STEP_ID,
              `Quest Helper search color=${latestQuestHelperXMarksSearchStatus}`,
              playerName,
            );
          }

          if (xMarksAlreadyStartedOrCompleted || questHelperSearchStartedOrCompleted) {
            log(
              `Section 1.1 Step 2 inference: WikiSync=${xMarksQuestStateBeforeStep?.status ?? "unavailable"} QuestHelperSearchColor=${latestQuestHelperXMarksSearchStatus}; skipping Veos start dialogue and following Quest Helper minimap arrow.`,
            );
          } else {
            setAutomateBotCurrentStep(STEP_SECTION_ONE_WALK_X_MARKS_THE_SPOT_ID);
            const xMarksStartReached = await walkToXMarksTheSpotStart(token);
            if (!xMarksStartReached) {
              warn("Section 1.1 Step 2 ended before the X Marks the Spot quest start was reached; stopping run before follow-up API/cache checks.");
              return;
            }
            log("Section 1.1 Step 2 movement complete: arrived near Veos / The Sheared Ram. Clicking Talk-to on static Veos tile.");
            const veosTalkStarted = await talkToVeos(token);
            if (!veosTalkStarted) {
              warn("Section 1.1 Step 2 Veos Talk-to did not complete; stopping before dialogue handling.");
              return;
            }
            log("Section 1.1 Step 2 Veos Talk-to clicked. Handling blue chatbox dialogue text.");
            setAutomateBotCurrentStep(STEP_SECTION_ONE_STEP_TWO_DIALOGUE_ID);
            const veosDialogueHandled = await clickVeosDialogueBlueTextOptions(token);
            if (!veosDialogueHandled) {
              warn("Section 1.1 Step 2 Veos dialogue did not complete; stopping before follow-up API/cache checks.");
              return;
            }
            log("Section 1.1 Step 2 Veos dialogue complete. Polling WikiSync for quest-start confirmation.");
            await pollXMarksWikiSyncQuestStarted(playerName, token, "after Veos dialogue");
            if (!isCurrentRunActive(token)) {
              return;
            }
          }

          log("Section 1.1 Step 2 following Quest Helper cyan minimap arrow.");
          setAutomateBotCurrentStep(STEP_SECTION_ONE_STEP_TWO_MINIMAP_ARROW_ID);
          const minimapArrowFollowed = await followQuestHelperMinimapCyanArrow(token);
          if (!minimapArrowFollowed) {
            warn("Section 1.1 Step 2 minimap arrow follow did not complete; stopping before follow-up API/cache checks.");
            return;
          }
        }
      }

      setAutomateBotCurrentStep(STEP_HISCORES_ID);
      if (playerName) {
        try {
          await logHiscoresSnapshot(playerName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warn(`Hiscores unavailable: ${message}`);
        }
      }

      setAutomateBotCurrentStep(STEP_WIKISYNC_ID);
      if (playerName) {
        try {
          await logWikiSyncSnapshot(playerName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warn(`WikiSync unavailable: ${message}`);
        }
      }

      setAutomateBotCurrentStep(STEP_CACHE_MAP_ID);
      const region = readOsrsCacheMapRegionView({ regionX: 50, regionY: 50 });
      const blockedTiles = region.tiles.filter((tile) => tile.z === 0 && tile.blocked).length;
      log(
        `Cache map loaded: cache=${region.cacheDirectoryPath} region=${region.regionX},${region.regionY} icons=${region.icons.length} objects=${region.objects.length} locations=${region.locationCount} blockedPlane0=${blockedTiles}.`,
      );

      const labeledIcons = region.icons
        .filter((icon) => icon.label)
        .slice(0, 8)
        .map((icon) => `${icon.label}@${icon.worldX},${icon.worldY},${icon.z}`)
        .join("; ");
      log(`Map icon labels: ${labeledIcons || "none"}.`);

      setAutomateBotCurrentStep(STEP_DONE_ID);
      log("Finished end-to-end smoke flow.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Failed: ${message}`);
    } finally {
      if (token === runToken) {
        setAutomateBotCurrentStep(null);
        stopAutomateBot("bot");
      }
    }
  })();
}
