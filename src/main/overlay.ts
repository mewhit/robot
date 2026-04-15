import * as fs from "fs";
import * as child_process from "child_process";
import * as path from "path";
import { AppState } from "./global-state";
import { OVERLAY_CS, OVERLAY_SOURCE_FILE, OVERLAY_EXE_FILE, CSC_CANDIDATES } from "./constants";

export function ensureOverlayExecutable(): string {
  const sourcePath = path.resolve(process.cwd(), OVERLAY_SOURCE_FILE);
  const exePath = path.resolve(process.cwd(), OVERLAY_EXE_FILE);

  if (fs.existsSync(exePath)) {
    return exePath;
  }

  fs.writeFileSync(sourcePath, OVERLAY_CS, "utf8");

  const compilerArgs = [
    "/nologo",
    "/target:winexe",
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    `/out:${exePath}`,
    sourcePath,
  ];

  for (const csc of CSC_CANDIDATES) {
    try {
      const result = child_process.spawnSync(csc, compilerArgs, { stdio: "ignore" });
      if (result.status === 0 && fs.existsSync(exePath)) {
        return exePath;
      }
    } catch {
      // Try next compiler candidate.
    }
  }

  throw new Error("Unable to compile overlay executable. Could not find a working csc.exe.");
}

export function showOverlay() {
  if (AppState.overlayProcess) return;

  try {
    const exePath = ensureOverlayExecutable();
    AppState.overlayProcess = child_process.spawn(exePath, [], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });

    AppState.overlayProcessPid = AppState.overlayProcess.pid ?? null;
    AppState.overlayProcess.once("exit", () => {
      AppState.overlayProcess = null;
      AppState.overlayProcessPid = null;
    });

    AppState.overlayProcess.unref();
  } catch (err) {
    AppState.recording = false;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Could not show overlay: ${message}`);
  }
}

function killOverlayProcessByPid(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    // /T ensures any child process tree is also terminated.
    child_process.spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore if process already exited.
  }
}

export function hideOverlay() {
  const pid = AppState.overlayProcessPid ?? AppState.overlayProcess?.pid ?? null;
  if (pid !== null) {
    killOverlayProcessByPid(pid);
  }

  AppState.overlayProcess = null;
  AppState.overlayProcessPid = null;
}
