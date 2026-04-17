import { app } from "electron";
import { uIOhook } from "uiohook-napi";
import { AppState } from "./global-state";
import { hideOverlay } from "./overlay";
import { setupIpcHandlers } from "./ipcHandlers";
import { setupIoHookHandlers } from "./ioHookHandlers";
import { createWindow, buildAppMenu, createNewOutputFile } from "./csvOperator";
import { loadSavedAutomateBotSelection } from "./automateBotManager";

// Setup error handling
process.on("SIGINT", () => {
  hideOverlay();
  uIOhook.stop();
  process.exit(0);
});

// App lifecycle
app.whenReady().then(() => {
  buildAppMenu();
  createNewOutputFile();
  loadSavedAutomateBotSelection();
  createWindow();
  setupIpcHandlers();
  setupIoHookHandlers();
  uIOhook.start();
  console.log("UI ready. Click the button or press F3 to start/stop recording.");
});

app.on("window-all-closed", () => {
  hideOverlay();
  uIOhook.stop();
  app.quit();
});
