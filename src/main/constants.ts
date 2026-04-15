import * as path from "path";
import { UiohookKey } from "uiohook-napi";

// CSV Headers
export const LEGACY_CSV_HEADER = "action,click_position,elapsed_seconds,radius";
export const CSV_HEADER_WITH_ELAPSED_RANGE = "action,click_position,elapsed_seconds,radius,elapsed_range";
export const CSV_HEADER_WITH_RANGES =
  "action,click_position,elapsed_seconds,radius,elapsed_range,x_min,x_max,y_min,y_max,elapsed_min,elapsed_max";

// CSV Defaults
export const DEFAULT_ELAPSED_RANGE = "none";
export const DEFAULT_RANGE_NONE = "";
export const DEFAULT_CLICK_RADIUS = 10;

// Output paths
export const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "saved-clicks");
export const DEFAULT_OUTPUT_FILE_NAME = "clicks.csv";

// Overlay
export const OVERLAY_SOURCE_FILE = ".overlay-window.cs";
export const OVERLAY_EXE_FILE = ".overlay-window.exe";
export const REPLAY_FOCUS_DELAY_MS = 600;

// Replay
export const REPLAY_KEY_PRESS_MS = 60;

// Key mappings
export const UIOHOOK_KEY_TO_ROBOTJS: Record<number, string> = {
  // Letters
  [UiohookKey.A]: "a",
  [UiohookKey.B]: "b",
  [UiohookKey.C]: "c",
  [UiohookKey.D]: "d",
  [UiohookKey.E]: "e",
  [UiohookKey.F]: "f",
  [UiohookKey.G]: "g",
  [UiohookKey.H]: "h",
  [UiohookKey.I]: "i",
  [UiohookKey.J]: "j",
  [UiohookKey.K]: "k",
  [UiohookKey.L]: "l",
  [UiohookKey.M]: "m",
  [UiohookKey.N]: "n",
  [UiohookKey.O]: "o",
  [UiohookKey.P]: "p",
  [UiohookKey.Q]: "q",
  [UiohookKey.R]: "r",
  [UiohookKey.S]: "s",
  [UiohookKey.T]: "t",
  [UiohookKey.U]: "u",
  [UiohookKey.V]: "v",
  [UiohookKey.W]: "w",
  [UiohookKey.X]: "x",
  [UiohookKey.Y]: "y",
  [UiohookKey.Z]: "z",
  // Digits
  11: "0",
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  // Numpad
  [UiohookKey.Numpad0]: "numpad_0",
  [UiohookKey.Numpad1]: "numpad_1",
  [UiohookKey.Numpad2]: "numpad_2",
  [UiohookKey.Numpad3]: "numpad_3",
  [UiohookKey.Numpad4]: "numpad_4",
  [UiohookKey.Numpad5]: "numpad_5",
  [UiohookKey.Numpad6]: "numpad_6",
  [UiohookKey.Numpad7]: "numpad_7",
  [UiohookKey.Numpad8]: "numpad_8",
  [UiohookKey.Numpad9]: "numpad_9",
  [UiohookKey.NumpadMultiply]: "multiply",
  [UiohookKey.NumpadAdd]: "add",
  [UiohookKey.NumpadSubtract]: "subtract",
  [UiohookKey.NumpadDecimal]: "decimal",
  [UiohookKey.NumpadDivide]: "divide",
  // Special keys
  [UiohookKey.Enter]: "enter",
  [UiohookKey.Backspace]: "backspace",
  [UiohookKey.Tab]: "tab",
  [UiohookKey.Escape]: "escape",
  [UiohookKey.Space]: "space",
  [UiohookKey.Delete]: "delete",
  [UiohookKey.Insert]: "insert",
  [UiohookKey.Home]: "home",
  [UiohookKey.End]: "end",
  [UiohookKey.PageUp]: "pageup",
  [UiohookKey.PageDown]: "pagedown",
  [UiohookKey.ArrowLeft]: "left",
  [UiohookKey.ArrowRight]: "right",
  [UiohookKey.ArrowUp]: "up",
  [UiohookKey.ArrowDown]: "down",
  // Function keys
  [UiohookKey.F1]: "f1",
  [UiohookKey.F2]: "f2",
  [UiohookKey.F3]: "f3",
  [UiohookKey.F4]: "f4",
  [UiohookKey.F5]: "f5",
  [UiohookKey.F6]: "f6",
  [UiohookKey.F7]: "f7",
  [UiohookKey.F8]: "f8",
  [UiohookKey.F9]: "f9",
  [UiohookKey.F10]: "f10",
  [UiohookKey.F11]: "f11",
  [UiohookKey.F12]: "f12",
  // Punctuation
  [UiohookKey.Semicolon]: "semicolon",
  [UiohookKey.Equal]: "equal",
  [UiohookKey.Comma]: "comma",
  [UiohookKey.Minus]: "minus",
  [UiohookKey.Period]: "period",
  [UiohookKey.Slash]: "slash",
  [UiohookKey.Backquote]: "grave",
  [UiohookKey.BracketLeft]: "left_bracket",
  [UiohookKey.Backslash]: "backslash",
  [UiohookKey.BracketRight]: "right_bracket",
  [UiohookKey.Quote]: "quote",
};

export const LEGACY_REPLAY_KEY_ALIASES: Record<string, string> = {
  ".": "period",
  ",": "comma",
  "-": "minus",
  "=": "equal",
  "/": "slash",
  "\\": "backslash",
  ";": "semicolon",
  "`": "grave",
  "[": "left_bracket",
  "]": "right_bracket",
  "'": "quote",
};

export const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
]);

// C# overlay source code
export const OVERLAY_CS = `
using System;
using System.Drawing;
using System.Windows.Forms;

public class OverlayForm : Form
{
  public OverlayForm()
  {
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    StartPosition = FormStartPosition.Manual;
    Bounds = SystemInformation.VirtualScreen;
    BackColor = Color.Lime;
    TransparencyKey = Color.Lime;
    DoubleBuffered = true;
  }

  protected override bool ShowWithoutActivation
  {
    get { return true; }
  }

  protected override CreateParams CreateParams
  {
    get
    {
      const int WS_EX_TRANSPARENT = 0x20;
      const int WS_EX_TOOLWINDOW = 0x80;
      const int WS_EX_NOACTIVATE = 0x08000000;
      var cp = base.CreateParams;
      cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
      return cp;
    }
  }

  protected override void OnPaint(PaintEventArgs e)
  {
    base.OnPaint(e);
    using (var pen = new Pen(Color.Red, 10))
    {
      const int inset = 5;
      e.Graphics.DrawRectangle(pen, inset, inset, Width - (inset * 2), Height - (inset * 2));
    }
  }
}

public static class Program
{
  [STAThread]
  public static void Main()
  {
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new OverlayForm());
  }
}
`;

export const CSC_CANDIDATES = [
  "csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];
