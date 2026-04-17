import * as fs from "fs";
import * as path from "path";
import * as robotModule from "robotjs";
import { ipcMain } from "electron";
import { AppState } from "./global-state";
import {
  createFileInOutputFolder,
  renameFileInOutputFolder,
  updateActiveCsvRow,
  deleteActiveCsvRow,
  insertActiveCsvRowAbove,
  insertActiveCsvRowBelow,
  renameActiveCsvRowStep,
  setActiveFileFromRelativePath,
  sendOutputFolderState,
  ensureCsvFileInitialized,
} from "./csvOperator";
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
  sendReplayDelayState,
  sendMarkerColorState,
} from "./recordingManager";
import { testColorDetectionOnce } from "./colorWatcher";
import { DEFAULT_OUTPUT_FILE_NAME } from "./constants";
import { ensureRuneLiteWindowBoundsForAutomation } from "./ioHookHandlers";
import {
  sendAutomateBotState,
  setActiveView,
  setSelectedAutomateBotId,
  toggleSelectedAutomateBot,
  startAutomateBotFromStep,
} from "./automateBotManager";
import { sendAutomateBotLogs } from "./automateBotLogs";
import { CHANNELS } from "./ipcChannels";

const robot = ((robotModule as unknown as { default?: any }).default ?? robotModule) as any;

export function setupIpcHandlers() {
  ipcMain.on(CHANNELS.TOGGLE_RECORDING, () => {
    if (!AppState.recording) {
      ensureRuneLiteWindowBoundsForAutomation();
    }
    toggleRecording("ui");
  });

  ipcMain.on(CHANNELS.UI_READY, () => {
    sendRecordingState();
    sendReplayState();
    sendReplayRowState();
    sendReplayRepeatState();
    sendReplayDelayState();
    sendMarkerColorState();
    sendAutomateBotState();
    sendAutomateBotLogs();
    sendOutputFolderState();
  });

  ipcMain.on(CHANNELS.SET_ACTIVE_VIEW, (_event, view: "clicker" | "automateBot") => {
    setActiveView(view === "automateBot" ? "automateBot" : "clicker");
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

  ipcMain.on(CHANNELS.SET_REPLAY_REPEAT, (_event, enabled: boolean) => {
    AppState.replayRepeatEnabled = Boolean(enabled);
    sendReplayRepeatState();
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
