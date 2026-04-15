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
import { DEFAULT_OUTPUT_FILE_NAME } from "./constants";

const robot = ((robotModule as unknown as { default?: any }).default ?? robotModule) as any;

export function setupIpcHandlers() {
  ipcMain.on("toggle-recording", () => {
    toggleRecording("ui");
  });

  ipcMain.on("ui-ready", () => {
    sendRecordingState();
    sendReplayState();
    sendReplayRowState();
    sendReplayRepeatState();
    sendReplayDelayState();
    sendMarkerColorState();
    sendOutputFolderState();
  });

  ipcMain.on("set-replay-repeat", (_event, enabled: boolean) => {
    AppState.replayRepeatEnabled = Boolean(enabled);
    sendReplayRepeatState();
  });

  ipcMain.on("set-replay-click-delay-ms", (_event, delayMs: number) => {
    if (!Number.isFinite(delayMs)) {
      AppState.replayExtraDelayMs = 0;
    } else {
      AppState.replayExtraDelayMs = Math.max(0, Math.round(delayMs));
    }
    sendReplayDelayState();
  });

  ipcMain.on("stop-replay", () => {
    requestReplayStop("ui");
  });

  ipcMain.on("set-active-file", (_event, relativePath: string) => {
    try {
      setActiveFileFromRelativePath(relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not set active file: ${message}`);
    }
  });

  ipcMain.handle("create-file", (_event, fileName: string) => {
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

  ipcMain.handle("rename-file", (_event, payload: { relativePath: string; newName: string }) => {
    try {
      renameFileInOutputFolder(payload.relativePath, payload.newName);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not rename file: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("delete-file", (_event, relativePath: string) => {
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
    "update-active-csv-row",
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
      }
    ) => {
      try {
        updateActiveCsvRow(payload);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Could not update csv row: ${message}`);
        return { ok: false, error: message };
      }
    }
  );

  ipcMain.handle("play-csv-row", (_event, rowIndex: number) => {
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

  ipcMain.handle("delete-active-csv-row", (_event, rowIndex: number) => {
    try {
      deleteActiveCsvRow(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not delete csv row: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("insert-active-csv-row-above", (_event, rowIndex: number) => {
    try {
      insertActiveCsvRowAbove(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not insert csv row above: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("insert-active-csv-row-below", (_event, rowIndex: number) => {
    try {
      insertActiveCsvRowBelow(rowIndex);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not insert csv row below: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("rename-active-csv-row-step", (_event, payload: { rowIndex: number; stepName: string }) => {
    try {
      renameActiveCsvRowStep(payload.rowIndex, payload.stepName);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not rename csv row step: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("replay-active-csv", async (_event, payload?: { fromUi?: boolean }) => {
    try {
      await replayActiveCsv({ fromUi: payload?.fromUi === true });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not replay csv: ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("replay-active-csv-from-row", async (_event, payload: { rowIndex: number }) => {
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
