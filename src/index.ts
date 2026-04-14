import * as fs from "fs";
import * as child_process from "child_process";
import { uIOhook, UiohookKey } from "uiohook-napi";

const OUTPUT_FILE = "clicks.txt";
let recording = false;
let lastClickTime: number | null = null;
let overlayProcess: child_process.ChildProcess | null = null;

const OVERLAY_PS1 = `
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
$w = New-Object System.Windows.Window
$w.WindowStyle = 'None'
$w.AllowsTransparency = $true
$w.Background = [System.Windows.Media.Brushes]::Transparent
$w.Topmost = $true
$w.ShowInTaskbar = $false
$w.WindowState = 'Maximized'
$w.ResizeMode = 'NoResize'
$w.IsHitTestVisible = $false

$border = New-Object System.Windows.Controls.Border
$border.BorderBrush = [System.Windows.Media.Brushes]::Red
$border.BorderThickness = New-Object System.Windows.Thickness(10)
$border.Background = [System.Windows.Media.Brushes]::Transparent

$grid = New-Object System.Windows.Controls.Grid
$grid.Children.Add($border) | Out-Null
$w.Content = $grid
$w.ShowDialog() | Out-Null
`;

function showOverlay() {
  overlayProcess = child_process.spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", OVERLAY_PS1], {
    stdio: "ignore",
    detached: true,
  });
}

function hideOverlay() {
  if (overlayProcess) {
    overlayProcess.kill();
    overlayProcess = null;
  }
}

console.log("Press F3 to start/stop recording. Press Ctrl+C to quit.");

uIOhook.on("keydown", (e) => {
  if (e.keycode === UiohookKey.F3) {
    recording = !recording;
    if (recording) {
      lastClickTime = null;
      showOverlay();
      console.log("Recording STARTED — click anywhere to register positions.");
    } else {
      hideOverlay();
      console.log("Recording STOPPED.");
    }
  }
});

uIOhook.on("mousedown", (e) => {
  if (!recording) return;
  if (e.button === 1 || e.button === 2) {
    const button = e.button === 1 ? "left" : "right";
    const now = Date.now();
    const elapsed = lastClickTime !== null ? ((now - lastClickTime) / 1000).toFixed(3) + "s" : "first click";
    lastClickTime = now;

    const line = `(${e.x}, ${e.y}) button: ${button} elapsed: ${elapsed}\n`;
    console.log(`Registered click at: ${line.trim()}`);
    fs.appendFileSync(OUTPUT_FILE, line);
  }
});

process.on("SIGINT", () => {
  hideOverlay();
  uIOhook.stop();
  process.exit(0);
});

uIOhook.start();
