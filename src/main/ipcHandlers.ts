import * as fs from "fs";
import * as path from "path";
import * as robotModule from "robotjs";
import { app, dialog, ipcMain } from "electron";
import { AppState } from "./global-state";
import {
  createFileInOutputFolder,
  renameFileInOutputFolder,
  duplicateFileInOutputFolder,
  updateActiveCsvRow,
  deleteActiveCsvRow,
  insertActiveCsvRowAbove,
  insertActiveCsvRowBelow,
  renameActiveCsvRowStep,
  moveActiveCsvRow,
  moveActiveCsvRowToBottom,
  moveActiveCsvRowToTop,
  setActiveFileFromRelativePath,
  sendOutputFolderState,
  ensureCsvFileInitialized,
  getSavedScreenshotNameSuffix,
  getSavedScreenshotSavePath,
  getSavedArceuusBloodRuneConfig,
  getSavedGuardianOfTheRiftConfig,
  getSavedEndToEndConfig,
  getSavedAllInOneMiningConfig,
  getSavedColossalPouchFullFillCountSinceRepair,
  setSavedScreenshotNameSuffix,
  setSavedScreenshotSavePath,
  setSavedArceuusBloodRuneConfig,
  setSavedGuardianOfTheRiftConfig,
  setSavedEndToEndConfig,
  setSavedAllInOneMiningConfig,
  setSavedColossalPouchFullFillCountSinceRepair,
} from "./csvOperator";
import {
  normalizeArceuusBloodRuneConfig,
  type ArceuusBloodRuneConfig,
} from "./automate-bots/arceuus-blood-rune-config";
import {
  normalizeGuardianOfTheRiftConfig,
  type GuardianOfTheRiftConfig,
} from "./automate-bots/guardian-of-the-rift-config";
import { normalizeEndToEndConfig, type EndToEndConfig } from "./automate-bots/end-to-end-config";
import {
  normalizeAllInOneMiningConfig,
  type AllInOneMiningConfig,
} from "./automate-bots/all-in-one-mining-config";
import { readGuardianOfTheRiftRunStatsSnapshot } from "./guardianOfTheRiftRunStats";
import { readActiveFileRows } from "./csvOperations";
import { resolveInsideOutputFolder } from "./fileManager";
import { getReplayTargetPoint } from "./utils";
import { replayActiveCsv, requestReplayStop } from "./replayManager";
import {
  toggleRecording,
  sendRecordingState,
  sendReplayState,
  sendReplayRowState,
  sendReplayRepeatState,
  sendReplayRepeatCountState,
  sendReplayDelayState,
  sendMarkerColorState,
} from "./recordingManager";
import { testColorDetectionOnce } from "./colorWatcher";
import { DEFAULT_OUTPUT_FILE_NAME } from "./constants";
import {
  sendAutomateBotState,
  setActiveView,
  setSelectedAutomateBotId,
  toggleSelectedAutomateBot,
  startAutomateBotFromStep,
} from "./automateBotManager";
import { runAgilityScreenshotCapture } from "./automate-bots/shared/screenshot-capture";
import { holdRobotKey, tapRobotKey } from "./automate-bots/shared/robot-keyboard";
import { forceCameraNorthForCalibration } from "./automate-bots/shared/camera-north-calibration";
import { runSceneMouseAutoCalibration } from "./automate-bots/shared/scene-mouse-auto-calibration";
import { getSceneMouseCalibrationActiveFitMetrics } from "./automate-bots/shared/scene-mouse-calibration";
import { runMinimapClickAutoCalibration } from "./automate-bots/shared/minimap-click-auto-calibration";
import {
  pushAutomateBotLog,
  sendAutomateBotLogs,
  startAutomateBotLogSession,
  stopAutomateBotLogSession,
} from "./automateBotLogs";
import { listLogReportFiles, sendLogReport } from "./logReporter";
import { CHANNELS } from "./ipcChannels";
import { findRuneLiteWindow, focusRuneLiteWindowForAutomation } from "./runeLiteWindow";
import { readOsrsCacheMapRegionView } from "./automate-bots/cache/cache-map-view";
import { fetchEndToEndSectionOneChecklist } from "./automate-bots/end-to-end/guide-checklist";
import { readLatestEndToEndRoutePathSnapshot } from "./automate-bots/end-to-end/route-path-snapshot";

const robot = ((robotModule as unknown as { default?: any }).default ?? robotModule) as any;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAutomateBotCalibration(): Promise<{ ok: true } | { ok: false; error: string }> {
  let calibrationLogSessionStarted = false;
  let calibrationStopReason = "calibration-failed";

  try {
    if (AppState.automateBotRunning) {
      const message = "Stop the running Automate Bot before 3D calibration.";
      pushAutomateBotLog("error", `Automate Bot calibration: ${message}`);
      return { ok: false, error: message };
    }

    startAutomateBotLogSession("calibration", "ui", "3d-scene-mouse", "calibration-started");
    calibrationLogSessionStarted = true;
    pushAutomateBotLog("info", "Automate Bot calibration: started from UI.");

    const runeLiteWindow = findRuneLiteWindow();
    if (!runeLiteWindow) {
      const message = "RuneLite window not found for Automate Bot calibration.";
      calibrationStopReason = "runelite-window-not-found";
      pushAutomateBotLog("error", `Automate Bot calibration: ${message}`);
      return { ok: false, error: message };
    }

    const runeLiteBounds = runeLiteWindow.getBounds();
    pushAutomateBotLog(
      "info",
      `Automate Bot calibration: RuneLite window detected bounds=${runeLiteBounds.width}x${runeLiteBounds.height}@${runeLiteBounds.x},${runeLiteBounds.y} visible=${runeLiteWindow.isVisible() ? "yes" : "no"}.`,
    );
    pushAutomateBotLog("info", "Automate Bot calibration: focusing RuneLite, holding W for 2000ms, then pressing PageDown 3 times.");
    focusRuneLiteWindowForAutomation();
    await sleep(150);

    const pitchResult = await holdRobotKey("w", 2000);
    if (!pitchResult.ok) {
      throw new Error(pitchResult.error || "W hold failed.");
    }
    pushAutomateBotLog("info", "Automate Bot calibration: camera pitch hold completed.");

    await sleep(100);

    for (let index = 0; index < 3; index += 1) {
      const zoomResult = await tapRobotKey("pagedown", {
        minHoldMs: 45,
        maxHoldMs: 90,
        afterMs: 120,
      });
      if (!zoomResult.ok) {
        throw new Error(zoomResult.error || `PageDown press ${index + 1} failed.`);
      }
      pushAutomateBotLog("info", `Automate Bot calibration: PageDown zoom press ${index + 1}/3 completed.`);
    }

    await sleep(250);
    pushAutomateBotLog("info", "Automate Bot calibration: starting camera north calibration.");
    const cameraNorth = await forceCameraNorthForCalibration(runeLiteWindow, {
      shouldContinue: () => !AppState.automateBotRunning,
      log: (message) => pushAutomateBotLog("info", `Automate Bot calibration: ${message}`),
    });
    if (!cameraNorth.ok) {
      calibrationStopReason = "camera-north-calibration-failed";
      pushAutomateBotLog("error", `Automate Bot calibration: ${cameraNorth.error}`);
      return { ok: false, error: cameraNorth.error };
    }
    pushAutomateBotLog(
      "info",
      `Automate Bot calibration: camera north ready after ${cameraNorth.attempts} attempt(s); ${cameraNorth.summary}.`,
    );

    await sleep(250);
    pushAutomateBotLog("info", "Automate Bot calibration: starting 3D scene mouse sampling.");

    const sceneCalibration = await runSceneMouseAutoCalibration(runeLiteWindow, {
      source: "automate-button-calibration",
      log: (message) => pushAutomateBotLog("info", `Automate Bot calibration: ${message}`),
    });
    if (!sceneCalibration.ok) {
      const message = sceneCalibration.error || "3D scene calibration failed.";
      calibrationStopReason = "scene-calibration-failed";
      pushAutomateBotLog("error", `Automate Bot calibration: ${message}`);
      return { ok: false, error: message };
    }

    const activeSceneFit = getSceneMouseCalibrationActiveFitMetrics(sceneCalibration.fit);
    pushAutomateBotLog(
      "info",
      `Automate Bot calibration: done. 3D samples=${sceneCalibration.sampleCount} activeFit=${
        activeSceneFit?.model ?? "none"
      } fitSamples=${activeSceneFit?.sampleCount ?? "n/a"} mean=${
        activeSceneFit?.meanErrorPx.toFixed(1) ?? "n/a"
      }px max=${activeSceneFit?.maxErrorPx.toFixed(1) ?? "n/a"}px.`,
    );

    pushAutomateBotLog("info", "Automate Bot calibration: starting minimap click calibration.");
    const minimapCalibration = await runMinimapClickAutoCalibration(runeLiteWindow, {
      assumeCameraNorth: true,
      isRunning: () => !AppState.automateBotRunning,
      log: (message) => pushAutomateBotLog("info", `Automate Bot calibration: ${message}`),
    });
    if (!minimapCalibration.ok) {
      const message = minimapCalibration.error || "Minimap click calibration failed.";
      calibrationStopReason = "minimap-calibration-failed";
      pushAutomateBotLog("error", `Automate Bot calibration: ${message}`);
      return { ok: false, error: message };
    }

    pushAutomateBotLog(
      "info",
      `Automate Bot calibration: minimap done. samples=${minimapCalibration.sampleCount} trusted=${
        minimapCalibration.trusted ? "yes" : "no"
      } path=${minimapCalibration.savedCalibrationPath ?? "none"}.`,
    );
    calibrationStopReason = "calibration-completed";
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    calibrationStopReason = "calibration-error";
    pushAutomateBotLog("error", `Automate Bot calibration failed: ${message}`);
    console.error(`Automate Bot calibration failed: ${message}`);
    return { ok: false, error: message };
  } finally {
    if (calibrationLogSessionStarted) {
      pushAutomateBotLog("info", `Automate Bot calibration: log session closing reason=${calibrationStopReason}.`);
      stopAutomateBotLogSession("ui", calibrationStopReason);
    }
  }
}

export function setupIpcHandlers() {
  const resolveScreenshotFolderStartPath = (): string => {
    const savedPath = getSavedScreenshotSavePath();
    if (!savedPath) {
      return app.getPath("pictures");
    }

    const resolvedSavedPath = path.resolve(savedPath);
    if (fs.existsSync(resolvedSavedPath) && fs.statSync(resolvedSavedPath).isDirectory()) {
      return resolvedSavedPath;
    }

    const parentDir = path.dirname(resolvedSavedPath);
    if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
      return parentDir;
    }

    return app.getPath("pictures");
  };

  ipcMain.on(CHANNELS.TOGGLE_RECORDING, () => {
    toggleRecording("ui");
  });

  ipcMain.on(CHANNELS.UI_READY, () => {
    sendRecordingState();
    sendReplayState();
    sendReplayRowState();
    sendReplayRepeatState();
    sendReplayRepeatCountState();
    sendReplayDelayState();
    sendMarkerColorState();
    sendAutomateBotState();
    sendAutomateBotLogs();
    sendOutputFolderState();
  });

  ipcMain.on(CHANNELS.SET_ACTIVE_VIEW, (_event, view: "clicker" | "automateBot" | "stats" | "map" | "debug") => {
    if (view === "automateBot") {
      setActiveView("automateBot");
      return;
    }
    if (view === "stats") {
      setActiveView("stats");
      return;
    }
    if (view === "map") {
      setActiveView("map");
      return;
    }
    if (view === "debug") {
      setActiveView("debug");
      return;
    }
    setActiveView("clicker");
  });

  ipcMain.on(CHANNELS.SET_SELECTED_AUTOMATE_BOT, (_event, botId: string | null) => {
    setSelectedAutomateBotId(botId);
  });

  ipcMain.handle(CHANNELS.TOGGLE_SELECTED_AUTOMATE_BOT, async () => {
    try {
      toggleSelectedAutomateBot("ui");
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not toggle automate bot: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.START_AUTOMATE_BOT_FROM_STEP, async (_event, stepId: string) => {
    try {
      startAutomateBotFromStep(stepId);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not start automate bot from step: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.RUN_AUTOMATE_BOT_CALIBRATION, async () => runAutomateBotCalibration());

  ipcMain.handle(CHANNELS.GET_LOG_REPORT_FILES, async () => {
    try {
      return { ok: true, files: listLogReportFiles() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not list log report files: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SEND_LOG_REPORT, async (_event, logFilePath: string) => {
    try {
      return await sendLogReport(logFilePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not send log report: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(
    CHANNELS.RUN_SCREENSHOT_CAPTURE,
    async (_event, payload?: { filePath?: string; fileNameSuffix?: string }) => {
      try {
        const requestedPath = payload?.filePath?.trim() || undefined;
        const requestedSuffix = payload?.fileNameSuffix?.trim() || undefined;
        const result = runAgilityScreenshotCapture({
          targetFilePath: requestedPath,
          fileNameSuffix: requestedSuffix,
        });
        if (!result.ok) {
          return { ok: false, error: result.error ?? "Screenshot capture failed." };
        }
        return { ok: true, filePath: result.filePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Could not capture screenshot: ${message}`);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(CHANNELS.PICK_SCREENSHOT_SAVE_PATH, async () => {
    try {
      const openDialogOptions: Electron.OpenDialogOptions = {
        title: "Choose Screenshot Folder",
        defaultPath: resolveScreenshotFolderStartPath(),
        properties: ["openDirectory", "createDirectory"],
      };

      const response = AppState.mainWindow
        ? await dialog.showOpenDialog(AppState.mainWindow, openDialogOptions)
        : await dialog.showOpenDialog(openDialogOptions);

      if (response.canceled || response.filePaths.length === 0) {
        return { ok: true, canceled: true };
      }

      return { ok: true, filePath: response.filePaths[0] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not pick screenshot save path: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_SCREENSHOT_SAVE_PATH, () => {
    try {
      return {
        ok: true,
        path: getSavedScreenshotSavePath(),
        suffix: getSavedScreenshotNameSuffix(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not get screenshot save path: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SET_SCREENSHOT_SAVE_PATH, (_event, screenshotPath: string) => {
    try {
      setSavedScreenshotSavePath(screenshotPath);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not save screenshot save path: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SET_SCREENSHOT_NAME_SUFFIX, (_event, screenshotNameSuffix: string) => {
    try {
      setSavedScreenshotNameSuffix(screenshotNameSuffix);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not save screenshot name suffix: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_DEBUG_FOLDER_FILES, (_event, folderPath: string) => {
    try {
      if (!folderPath) {
        return { ok: true, files: [] };
      }

      const files = fs.readdirSync(folderPath, { withFileTypes: true });
      const fileNames = files
        .filter((file) => file.isFile())
        .map((file) => file.name)
        .sort();

      return { ok: true, files: fileNames };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not read debug folder: ${message}`);
      return { ok: true, files: [] };
    }
  });

  ipcMain.handle(CHANNELS.GET_ARCEUUS_BLOOD_RUNE_CONFIG, () => {
    try {
      return {
        ok: true,
        config: getSavedArceuusBloodRuneConfig(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not get Arceuus Blood Rune config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SET_ARCEUUS_BLOOD_RUNE_CONFIG, (_event, config: ArceuusBloodRuneConfig) => {
    try {
      setSavedArceuusBloodRuneConfig(normalizeArceuusBloodRuneConfig(config));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not save Arceuus Blood Rune config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_END_TO_END_CONFIG, () => {
    try {
      return {
        ok: true,
        config: getSavedEndToEndConfig(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not get End To End config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SET_END_TO_END_CONFIG, (_event, config: EndToEndConfig) => {
    try {
      setSavedEndToEndConfig(normalizeEndToEndConfig(config));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not save End To End config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_END_TO_END_SECTION_ONE_CHECKLIST, async () => {
    try {
      return {
        ok: true,
        checklist: await fetchEndToEndSectionOneChecklist(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not fetch End To End section 1 checklist: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_END_TO_END_LATEST_PATH, () => {
    try {
      const result = readLatestEndToEndRoutePathSnapshot();
      return {
        ok: true,
        path: result.snapshot,
        filePath: result.filePath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not read End To End latest path: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_GUARDIAN_OF_THE_RIFT_CONFIG, () => {
    try {
      return {
        ok: true,
        config: getSavedGuardianOfTheRiftConfig(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not get Guardian of the Rift config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_ALL_IN_ONE_MINING_CONFIG, () => {
    try {
      return {
        ok: true,
        config: getSavedAllInOneMiningConfig(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not get All-In-One Mining config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SET_ALL_IN_ONE_MINING_CONFIG, (_event, config: AllInOneMiningConfig) => {
    try {
      setSavedAllInOneMiningConfig(normalizeAllInOneMiningConfig(config));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not save All-In-One Mining config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SET_GUARDIAN_OF_THE_RIFT_CONFIG, (_event, config: GuardianOfTheRiftConfig) => {
    try {
      setSavedGuardianOfTheRiftConfig(normalizeGuardianOfTheRiftConfig(config));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not save Guardian of the Rift config: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_GUARDIAN_OF_THE_RIFT_COLOSSAL_POUCH_FILL_COUNT, () => {
    try {
      return {
        ok: true,
        count: getSavedColossalPouchFullFillCountSinceRepair(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not get colossal pouch fill count: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.SET_GUARDIAN_OF_THE_RIFT_COLOSSAL_POUCH_FILL_COUNT, (_event, count: number) => {
    try {
      setSavedColossalPouchFullFillCountSinceRepair(count);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not save colossal pouch fill count: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.GET_GUARDIAN_OF_THE_RIFT_RUN_STATS, () => {
    try {
      return {
        ok: true,
        snapshot: readGuardianOfTheRiftRunStatsSnapshot(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not read Guardian of the Rift run stats: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(
    CHANNELS.GET_OSRS_CACHE_MAP_REGION,
    (_event, payload?: { regionX?: number; regionY?: number; worldX?: number; worldY?: number }) => {
      try {
        const rawRegionX =
          typeof payload?.worldX === "number" && Number.isFinite(payload.worldX)
            ? payload.worldX >> 6
            : payload?.regionX;
        const rawRegionY =
          typeof payload?.worldY === "number" && Number.isFinite(payload.worldY)
            ? payload.worldY >> 6
            : payload?.regionY;
        const regionX = Number.isFinite(rawRegionX) ? Math.trunc(Number(rawRegionX)) : 50;
        const regionY = Number.isFinite(rawRegionY) ? Math.trunc(Number(rawRegionY)) : 50;
        return {
          ok: true,
          region: readOsrsCacheMapRegionView({ regionX, regionY }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Could not read OSRS cache map region: ${message}`);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.on(CHANNELS.SET_REPLAY_REPEAT, (_event, enabled: boolean) => {
    AppState.replayRepeatEnabled = Boolean(enabled);
    sendReplayRepeatState();
  });

  ipcMain.on(CHANNELS.SET_REPLAY_REPEAT_COUNT, (_event, repeatCount: number) => {
    if (!Number.isFinite(repeatCount)) {
      AppState.replayRepeatCount = 0;
    } else {
      AppState.replayRepeatCount = Math.max(0, Math.round(repeatCount));
    }
    sendReplayRepeatCountState();
  });

  ipcMain.on(CHANNELS.SET_REPLAY_CLICK_DELAY_MS, (_event, delayMs: number) => {
    if (!Number.isFinite(delayMs)) {
      AppState.replayExtraDelayMs = 0;
    } else {
      AppState.replayExtraDelayMs = Math.max(0, Math.round(delayMs));
    }
    sendReplayDelayState();
  });

  ipcMain.on(CHANNELS.STOP_REPLAY, () => {
    requestReplayStop("ui");
  });

  ipcMain.handle(CHANNELS.TEST_COLOR_DETECTION, async () => {
    try {
      await testColorDetectionOnce();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Color detection test failed: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.on(CHANNELS.SET_ACTIVE_FILE, (_event, relativePath: string) => {
    try {
      setActiveFileFromRelativePath(relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not set active file: ${message}`);
    }
  });

  ipcMain.handle(CHANNELS.CREATE_FILE, (_event, fileName: string) => {
    try {
      console.log(`create-file IPC received: ${fileName}`);
      createFileInOutputFolder(fileName);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not create file: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.RENAME_FILE, (_event, payload: { relativePath: string; newName: string }) => {
    try {
      renameFileInOutputFolder(payload.relativePath, payload.newName);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not rename file: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.DUPLICATE_FILE, (_event, relativePath: string) => {
    try {
      duplicateFileInOutputFolder(relativePath);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not duplicate file: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.DELETE_FILE, (_event, relativePath: string) => {
    try {
      const targetPath = resolveInsideOutputFolder(relativePath);
      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        throw new Error("File does not exist");
      }
      fs.unlinkSync(targetPath);
      if (AppState.outputFilePath === targetPath) {
        AppState.outputFilePath = path.join(AppState.outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
        ensureCsvFileInitialized(AppState.outputFilePath);
      }
      console.log(`Deleted file: ${targetPath}`);
      sendOutputFolderState();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not delete file: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(
    CHANNELS.UPDATE_ACTIVE_CSV_ROW,
    (
      _event,
      payload: {
        rowIndex: number;
        action: string;
        x: number;
        y: number;
        elapsedSeconds: number;
        radius: number;
        elapsedRange?: string;
        xMin?: number;
        xMax?: number;
        yMin?: number;
        yMax?: number;
        elapsedMin?: number | null;
        elapsedMax?: number | null;
      },
    ) => {
      try {
        updateActiveCsvRow(payload);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Could not update csv row: ${message}`);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(CHANNELS.PLAY_CSV_ROW, (_event, rowIndex: number) => {
    try {
      if (!Number.isInteger(rowIndex) || rowIndex < 0) {
        throw new Error("Invalid row index");
      }
      const rows = readActiveFileRows();
      if (rowIndex >= rows.length) {
        throw new Error("Row index out of range");
      }
      const row = rows[rowIndex];
      const target = getReplayTargetPoint(row);
      robot.moveMouse(target.x, target.y);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not play csv row: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.DELETE_ACTIVE_CSV_ROW, (_event, rowIndex: number) => {
    try {
      deleteActiveCsvRow(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not delete csv row: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(
    CHANNELS.MOVE_ACTIVE_CSV_ROW,
    (_event, payload: { rowIndex: number; targetRowIndex: number; placement?: "before" | "after" }) => {
      try {
        moveActiveCsvRow(payload.rowIndex, payload.targetRowIndex, payload.placement);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Could not move csv row: ${message}`);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(CHANNELS.MOVE_ACTIVE_CSV_ROW_TO_TOP, (_event, rowIndex: number) => {
    try {
      moveActiveCsvRowToTop(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not move csv row to top: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.MOVE_ACTIVE_CSV_ROW_TO_BOTTOM, (_event, rowIndex: number) => {
    try {
      moveActiveCsvRowToBottom(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not move csv row to bottom: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.INSERT_ACTIVE_CSV_ROW_ABOVE, (_event, rowIndex: number) => {
    try {
      insertActiveCsvRowAbove(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not insert csv row above: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.INSERT_ACTIVE_CSV_ROW_BELOW, (_event, rowIndex: number) => {
    try {
      insertActiveCsvRowBelow(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not insert csv row below: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.RENAME_ACTIVE_CSV_ROW_STEP, (_event, payload: { rowIndex: number; stepName: string }) => {
    try {
      renameActiveCsvRowStep(payload.rowIndex, payload.stepName);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not rename csv row step: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.REPLAY_ACTIVE_CSV, async (_event, payload?: { fromUi?: boolean }) => {
    try {
      await replayActiveCsv({ fromUi: payload?.fromUi === true });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not replay csv: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.REPLAY_ACTIVE_CSV_FROM_ROW, async (_event, payload: { rowIndex: number }) => {
    try {
      await replayActiveCsv({ fromUi: true, fromRowIndex: payload.rowIndex });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not resume csv from row: ${message}`);
      return { ok: false, error: message };
    }
  });
}
