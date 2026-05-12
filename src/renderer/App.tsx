import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { IpcRenderer } from "electron";
import ClickerTabs from "./clicker-tabs";
import AutomateBot from "./automate-bot";
import GotrStatsView from "./gotr-stats-view";
import type { GuardianOfTheRiftRunStatsSnapshot } from "../main/guardianOfTheRiftRunStats";
import {
  AUTOMATE_BOTS,
  DEFAULT_AUTOMATE_BOT_ID,
  RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID,
  RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID,
} from "../main/automate-bots/definitions";
import {
  createDefaultArceuusBloodRuneConfig,
  normalizeArceuusBloodRuneAgilityLevel,
  normalizeArceuusBloodRuneConfig,
  type ArceuusBloodRuneConfig,
} from "../main/automate-bots/arceuus-blood-rune-config";
import {
  GUARDIAN_OF_THE_RIFT_ACTIVE_ELEMENTS,
  createDefaultGuardianOfTheRiftConfig,
  type GuardianOfTheRiftActiveElement,
  type GuardianOfTheRiftConfig,
  type GuardianOfTheRiftPouch,
  normalizeGuardianOfTheRiftConfig,
  normalizeGuardianOfTheRiftRunecraftLevel,
} from "../main/automate-bots/guardian-of-the-rift-config";
import { CHANNELS } from "../main/ipcChannels";

declare global {
  interface Window {
    require: NodeRequire;
  }
}

const { ipcRenderer } = window.require("electron") as {
  ipcRenderer: IpcRenderer;
};

type ExplorerNode = {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children?: ExplorerNode[];
};

type TaskNode = {
  id: string;
  name: string;
  children?: TaskNode[];
};

type CsvRow = {
  index: number;
  action: string;
  stepName: string;
  x: number;
  y: number;
  elapsedSeconds: number;
  radius: number;
  elapsedRange: string;
  xMin: number;

  xMax: number;
  yMin: number;
  yMax: number;
  elapsedMin: number | null;
  elapsedMax: number | null;
  percentageX: number;
  percentageY: number;
  rangeX: {
    min: number;
    max: number;
  };
  rangeY: {
    min: number;
    max: number;
  };
};

type FolderState = {
  folderPath: string;
  activeFile: string;
  activeRelativePath: string;
  activeFileLines: string[];
  activeFileRows: CsvRow[];
  files: string[];
  tree: ExplorerNode[];
};

type ContextMenuState = {
  x: number;
  y: number;
  relativePath: string;
} | null;

type CsvRowContextMenuState = {
  x: number;
  y: number;
  rowIndex: number;
  stepName: string;
} | null;

type StepContextMenuState = {
  x: number;
  y: number;
  stepId: string;
  stepName: string;
} | null;

type MarkerColorState = {
  color: "green" | "red" | "none";
  confidence: number;
  point: { x: number; y: number } | null;
};

type ActiveView = "clicker" | "automateBot" | "stats" | "debug";
const ACTIVE_VIEW_STORAGE_KEY = "robot.activeView";
const SELECTED_AUTOMATE_BOT_STORAGE_KEY = "robot.selectedAutomateBotId";
const EXPANDED_TASK_NODE_IDS_STORAGE_KEY = "robot.expandedTaskNodeIds";

function getInitialActiveView(): ActiveView {
  const savedView = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
  if (savedView === "automateBot") {
    return "automateBot";
  }
  if (savedView === "stats") {
    return "stats";
  }
  if (savedView === "debug") {
    return "debug";
  }
  return "clicker";
}

function getInitialSelectedTaskNodeId(): string | null {
  const savedId = window.localStorage.getItem(SELECTED_AUTOMATE_BOT_STORAGE_KEY);
  if (typeof savedId !== "string") {
    return DEFAULT_AUTOMATE_BOT_ID;
  }

  const normalized = savedId.trim();
  return normalized.length > 0 ? normalized : DEFAULT_AUTOMATE_BOT_ID;
}

function getInitialExpandedTaskNodeIds(): Set<string> {
  const raw = window.localStorage.getItem(EXPANDED_TASK_NODE_IDS_STORAGE_KEY);
  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.map((value) => String(value)));
  } catch {
    return new Set();
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>(() => getInitialActiveView());
  const [isRecording, setIsRecording] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isReplayRepeatEnabled, setIsReplayRepeatEnabled] = useState(false);
  const [replayRepeatCount, setReplayRepeatCount] = useState(0);
  const [replayClickDelayMs, setReplayClickDelayMs] = useState(0);
  const [folderState, setFolderState] = useState<FolderState>({
    folderPath: "-",
    activeFile: "-",
    activeRelativePath: "",
    activeFileLines: [],
    activeFileRows: [],
    files: [],
    tree: [],
  });
  const [selectedCsvRowIndexes, setSelectedCsvRowIndexes] = useState<number[]>([]);
  const [lastSelectedCsvRowIndex, setLastSelectedCsvRowIndex] = useState<number | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [lastSelectedFilePath, setLastSelectedFilePath] = useState<string | null>(null);
  const [replayingCsvRowIndex, setReplayingCsvRowIndex] = useState<number | null>(null);
  const [rowForm, setRowForm] = useState({
    action: "",
    x: "",
    y: "",
    elapsedSeconds: "",
    radius: "",
    elapsedRange: "none",
    xMin: "",
    xMax: "",
    yMin: "",
    yMax: "",
    elapsedMin: "",
    elapsedMax: "",
  });
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [csvRowContextMenu, setCsvRowContextMenu] = useState<CsvRowContextMenuState>(null);
  const [stepContextMenu, setStepContextMenu] = useState<StepContextMenuState>(null);
  const [editingRelativePath, setEditingRelativePath] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [cursorPos, setCursorPos] = useState<{
    x: number;
    y: number;
    runLiteWindow?: { x: number; y: number; width: number; height: number } | null;
  } | null>(null);
  const [editingCsvRowIndex, setEditingCsvRowIndex] = useState<number | null>(null);
  const [editingStepName, setEditingStepName] = useState("");
  const [markerColorState, setMarkerColorState] = useState<MarkerColorState>({
    color: "none",
    confidence: 0,
    point: null,
  });
  const [selectedTaskNodeId, setSelectedTaskNodeId] = useState<string | null>(() => getInitialSelectedTaskNodeId());
  const [isSelectedTaskRunning, setIsSelectedTaskRunning] = useState(false);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [expandedTaskNodeIds, setExpandedTaskNodeIds] = useState<Set<string>>(() => getInitialExpandedTaskNodeIds());
  const [automateBotLogLines, setAutomateBotLogLines] = useState<string[]>([]);
  const [debugNotice, setDebugNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [screenshotSavePath, setScreenshotSavePath] = useState("");
  const [screenshotNameSuffix, setScreenshotNameSuffix] = useState("");
  const [arceuusBloodRuneConfig, setArceuusBloodRuneConfig] = useState<ArceuusBloodRuneConfig>(() =>
    createDefaultArceuusBloodRuneConfig(),
  );
  const [guardianOfTheRiftConfig, setGuardianOfTheRiftConfig] = useState<GuardianOfTheRiftConfig>(() =>
    createDefaultGuardianOfTheRiftConfig(),
  );
  const [guardianOfTheRiftColossalFillCount, setGuardianOfTheRiftColossalFillCount] = useState(0);
  const [debugFolderFiles, setDebugFolderFiles] = useState<string[]>([]);
  const [gotrRunStatsSnapshot, setGotrRunStatsSnapshot] = useState<GuardianOfTheRiftRunStatsSnapshot | null>(null);
  const [isGotrRunStatsLoading, setIsGotrRunStatsLoading] = useState(false);
  const [gotrRunStatsError, setGotrRunStatsError] = useState<string | null>(null);
  const taskTree = useMemo<TaskNode[]>(() => {
    const groups = new Map<string, TaskNode>();
    const result: TaskNode[] = [];

    for (const bot of AUTOMATE_BOTS) {
      const leaf: TaskNode = { id: bot.id, name: bot.name };

      if (bot.group) {
        let parent = groups.get(bot.group);
        if (!parent) {
          parent = { id: `group-${bot.group}`, name: bot.group, children: [] };
          groups.set(bot.group, parent);
          result.push(parent);
        }
        parent.children!.push(leaf);
      } else {
        result.push(leaf);
      }
    }

    return result;
  }, []);
  const selectableTaskIds = useMemo(() => new Set(AUTOMATE_BOTS.map((bot) => bot.id)), []);
  const groupNodeIdByBotId = useMemo(() => {
    const map = new Map<string, string>();
    for (const bot of AUTOMATE_BOTS) {
      if (bot.group) {
        map.set(bot.id, `group-${bot.group}`);
      }
    }
    return map;
  }, []);

  const handleToggleTaskNodeExpand = useCallback((id: string) => {
    setExpandedTaskNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selectedTaskNodeId) {
      return;
    }

    const parentGroupId = groupNodeIdByBotId.get(selectedTaskNodeId);
    if (!parentGroupId) {
      return;
    }

    setExpandedTaskNodeIds((prev) => {
      if (prev.has(parentGroupId)) {
        return prev;
      }

      const next = new Set(prev);
      next.add(parentGroupId);
      return next;
    });
  }, [groupNodeIdByBotId, selectedTaskNodeId]);

  const hideContextMenu = useCallback(() => setContextMenu(null), []);
  const hideCsvRowContextMenu = useCallback(() => setCsvRowContextMenu(null), []);
  const hideStepContextMenu = useCallback(() => setStepContextMenu(null), []);

  const getDefaultNewFileName = useCallback(() => {
    const baseName = "new-clicks";
    const extension = ".csv";
    const existing = new Set(folderState.files.map((file) => file.split(/[/\\]/).pop()?.toLowerCase() ?? ""));

    const defaultName = `${baseName}${extension}`;
    if (!existing.has(defaultName.toLowerCase())) {
      return defaultName;
    }

    let index = 1;
    while (existing.has(`${baseName}-${index}${extension}`.toLowerCase())) {
      index += 1;
    }

    return `${baseName}-${index}${extension}`;
  }, [folderState.files]);

  useEffect(() => {
    const onRecordingState = (_: unknown, isRec: boolean) => setIsRecording(isRec);
    const onReplayingState = (_: unknown, isReplay: boolean) => setIsReplaying(isReplay);
    const onReplayRepeatState = (_: unknown, enabled: boolean) => setIsReplayRepeatEnabled(enabled);
    const onReplayRepeatCountState = (_: unknown, count: number) =>
      setReplayRepeatCount(Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0);
    const onReplayDelayState = (_: unknown, delayMs: number) => {
      setReplayClickDelayMs(Number.isFinite(delayMs) ? Math.max(0, Math.round(delayMs)) : 0);
    };
    const onReplayRowState = (_: unknown, rowIndex: number | null) => {
      setReplayingCsvRowIndex(Number.isInteger(rowIndex) ? rowIndex : null);
    };
    const onFolderState = (_: unknown, payload: FolderState) => {
      setFolderState(payload);
      const activeRowIndexes = new Set(payload.activeFileRows.map((row) => row.index));
      setSelectedFilePaths((current) => {
        const next = current.filter((path) => payload.files.includes(path));
        setLastSelectedFilePath((currentLastSelectedPath) => {
          if (next.length === 0) {
            return null;
          }

          if (currentLastSelectedPath && next.includes(currentLastSelectedPath)) {
            return currentLastSelectedPath;
          }

          return next[0] ?? null;
        });

        return next;
      });
      setSelectedCsvRowIndexes((current) => {
        const next = current.filter((rowIndex) => activeRowIndexes.has(rowIndex));
        setLastSelectedCsvRowIndex((currentLastSelectedCsvRowIndex) => {
          if (next.length === 0) {
            return null;
          }

          if (currentLastSelectedCsvRowIndex !== null && next.includes(currentLastSelectedCsvRowIndex)) {
            return currentLastSelectedCsvRowIndex;
          }

          return next[next.length - 1] ?? null;
        });
        return next;
      });
    };
    const onMarkerColorState = (_: unknown, payload: MarkerColorState) => {
      setMarkerColorState(payload);
    };
    const onAutomateBotState = (
      _: unknown,
      payload: { selectedBotId: string | null; isRunning: boolean; currentStepId?: string | null },
    ) => {
      setSelectedTaskNodeId(payload.selectedBotId ?? DEFAULT_AUTOMATE_BOT_ID);
      setIsSelectedTaskRunning(Boolean(payload.isRunning));
      setCurrentStepId(payload.currentStepId ?? null);
    };
    const onAutomateBotLogsState = (_: unknown, payload: unknown) => {
      if (!Array.isArray(payload)) {
        return;
      }

      setAutomateBotLogLines(payload.map((line) => String(line)).slice(-500));
    };
    const onAutomateBotLog = (_: unknown, payload: unknown) => {
      setAutomateBotLogLines((current) => {
        const next = [...current, String(payload)];
        if (next.length > 500) {
          return next.slice(next.length - 500);
        }
        return next;
      });
    };
    const onAutomateBotError = (_: unknown, payload: { message?: string } | undefined) => {
      const message = payload?.message ? String(payload.message) : "Unknown automate bot error.";
      setAutomateBotLogLines((current) => {
        const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
        const next = [...current, `[${timestamp}] [ERROR] ${message}`];
        if (next.length > 500) {
          return next.slice(next.length - 500);
        }
        return next;
      });
      window.alert(message);
    };

      ipcRenderer.on(CHANNELS.RECORDING_STATE, onRecordingState);
      ipcRenderer.on(CHANNELS.REPLAYING_STATE, onReplayingState);
      ipcRenderer.on(CHANNELS.REPLAY_REPEAT_STATE, onReplayRepeatState);
      ipcRenderer.on(CHANNELS.REPLAY_REPEAT_COUNT_STATE, onReplayRepeatCountState);
      ipcRenderer.on(CHANNELS.REPLAY_DELAY_STATE, onReplayDelayState);
    ipcRenderer.on(CHANNELS.REPLAY_ROW_STATE, onReplayRowState);
    ipcRenderer.on(CHANNELS.MARKER_COLOR_STATE, onMarkerColorState);
    ipcRenderer.on(CHANNELS.AUTOMATE_BOT_STATE, onAutomateBotState);
    ipcRenderer.on(CHANNELS.AUTOMATE_BOT_LOGS_STATE, onAutomateBotLogsState);
    ipcRenderer.on(CHANNELS.AUTOMATE_BOT_LOG, onAutomateBotLog);
    ipcRenderer.on(CHANNELS.AUTOMATE_BOT_ERROR, onAutomateBotError);
    ipcRenderer.on(CHANNELS.OUTPUT_FOLDER_STATE, onFolderState);
    const onCursorPos = (
      _: unknown,
      pos: { x: number; y: number; runLiteWindow?: { x: number; y: number; width: number; height: number } | null },
    ) => setCursorPos(pos);
    ipcRenderer.on(CHANNELS.CURSOR_POS, onCursorPos);
    ipcRenderer.send(CHANNELS.UI_READY);

    void ipcRenderer
      .invoke(CHANNELS.GET_SCREENSHOT_SAVE_PATH)
      .then((result: { ok?: boolean; path?: string; suffix?: string }) => {
        if (!result?.ok) {
          return;
        }
        setScreenshotSavePath(typeof result.path === "string" ? result.path : "");
        setScreenshotNameSuffix(typeof result.suffix === "string" ? result.suffix : "");
      })
      .catch(() => {
        // Ignore non-critical config read failures.
      });

    void ipcRenderer
      .invoke(CHANNELS.GET_ARCEUUS_BLOOD_RUNE_CONFIG)
      .then((result: { ok?: boolean; config?: ArceuusBloodRuneConfig }) => {
        if (!result?.ok || !result.config) {
          return;
        }

        setArceuusBloodRuneConfig(normalizeArceuusBloodRuneConfig(result.config));
      })
      .catch(() => {
        // Ignore non-critical config read failures.
      });

    void ipcRenderer
      .invoke(CHANNELS.GET_GUARDIAN_OF_THE_RIFT_CONFIG)
      .then((result: { ok?: boolean; config?: GuardianOfTheRiftConfig }) => {
        if (!result?.ok || !result.config) {
          return;
        }

        setGuardianOfTheRiftConfig(result.config);
      })
      .catch(() => {
        // Ignore non-critical config read failures.
      });

    void ipcRenderer
      .invoke(CHANNELS.GET_GUARDIAN_OF_THE_RIFT_COLOSSAL_POUCH_FILL_COUNT)
      .then((result: { ok?: boolean; count?: number }) => {
        if (!result?.ok || typeof result.count !== "number") {
          return;
        }

        setGuardianOfTheRiftColossalFillCount(Math.max(0, Math.round(result.count)));
      })
      .catch(() => {
        // Ignore non-critical config read failures.
      });

    return () => {
      ipcRenderer.removeListener(CHANNELS.RECORDING_STATE, onRecordingState);
      ipcRenderer.removeListener(CHANNELS.REPLAYING_STATE, onReplayingState);
      ipcRenderer.removeListener(CHANNELS.REPLAY_REPEAT_STATE, onReplayRepeatState);
      ipcRenderer.removeListener(CHANNELS.REPLAY_REPEAT_COUNT_STATE, onReplayRepeatCountState);
      ipcRenderer.removeListener(CHANNELS.REPLAY_DELAY_STATE, onReplayDelayState);
      ipcRenderer.removeListener(CHANNELS.REPLAY_ROW_STATE, onReplayRowState);
      ipcRenderer.removeListener(CHANNELS.MARKER_COLOR_STATE, onMarkerColorState);
      ipcRenderer.removeListener(CHANNELS.AUTOMATE_BOT_STATE, onAutomateBotState);
      ipcRenderer.removeListener(CHANNELS.AUTOMATE_BOT_LOGS_STATE, onAutomateBotLogsState);
      ipcRenderer.removeListener(CHANNELS.AUTOMATE_BOT_LOG, onAutomateBotLog);
      ipcRenderer.removeListener(CHANNELS.AUTOMATE_BOT_ERROR, onAutomateBotError);
      ipcRenderer.removeListener(CHANNELS.OUTPUT_FOLDER_STATE, onFolderState);
      ipcRenderer.removeListener(CHANNELS.CURSOR_POS, onCursorPos);
    };
  }, []);

  useEffect(() => {
    const hideAll = () => {
      hideContextMenu();
      hideCsvRowContextMenu();
      hideStepContextMenu();
    };
    window.addEventListener("click", hideAll);
    window.addEventListener("resize", hideAll);
    return () => {
      window.removeEventListener("click", hideAll);
      window.removeEventListener("resize", hideAll);
    };
  }, [hideContextMenu, hideCsvRowContextMenu, hideStepContextMenu]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView);
    ipcRenderer.send(CHANNELS.SET_ACTIVE_VIEW, activeView);
  }, [activeView]);

  useEffect(() => {
    const saved = selectedTaskNodeId?.trim() ?? "";
    if (saved.length > 0) {
      window.localStorage.setItem(SELECTED_AUTOMATE_BOT_STORAGE_KEY, saved);
      return;
    }

    window.localStorage.removeItem(SELECTED_AUTOMATE_BOT_STORAGE_KEY);
  }, [selectedTaskNodeId]);

  useEffect(() => {
    window.localStorage.setItem(EXPANDED_TASK_NODE_IDS_STORAGE_KEY, JSON.stringify(Array.from(expandedTaskNodeIds)));
  }, [expandedTaskNodeIds]);

  useEffect(() => {
    ipcRenderer.send(CHANNELS.SET_SELECTED_AUTOMATE_BOT, selectedTaskNodeId);
  }, [selectedTaskNodeId]);

  const handleToggleRecording = () => ipcRenderer.send(CHANNELS.TOGGLE_RECORDING);

  const refreshGotrRunStats = useCallback(async () => {
    setIsGotrRunStatsLoading(true);
    setGotrRunStatsError(null);
    try {
      const result = await ipcRenderer.invoke(CHANNELS.GET_GUARDIAN_OF_THE_RIFT_RUN_STATS);
      if (!result?.ok) {
        setGotrRunStatsError(result?.error || "Unable to read Guardian stats.");
        return;
      }

      setGotrRunStatsSnapshot(result.snapshot ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGotrRunStatsError(`Unable to read Guardian stats: ${message}`);
    } finally {
      setIsGotrRunStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === "stats") {
      void refreshGotrRunStats();
    }
  }, [activeView, refreshGotrRunStats]);

  const handleReplayCsv = async () => {
    try {
      const result = await ipcRenderer.invoke(CHANNELS.REPLAY_ACTIVE_CSV, { fromUi: true });
      if (!result?.ok) {
        window.alert(result?.error || "Unable to replay CSV.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Unable to replay CSV: ${message}`);
    }
  };

  const handleToggleSelectedTaskRun = useCallback(
    async (botId?: string) => {
      const requestedBotId = typeof botId === "string" ? botId.trim() : "";
      if (requestedBotId && requestedBotId !== selectedTaskNodeId) {
        setSelectedTaskNodeId(requestedBotId);
        ipcRenderer.send(CHANNELS.SET_SELECTED_AUTOMATE_BOT, requestedBotId);
      }

      try {
        const result = await ipcRenderer.invoke(CHANNELS.TOGGLE_SELECTED_AUTOMATE_BOT);
        if (!result?.ok) {
          window.alert(result?.error || "Unable to toggle Automate Bot.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(`Unable to toggle Automate Bot: ${message}`);
      }
    },
    [selectedTaskNodeId],
  );

  const refreshDebugFolderFiles = useCallback(async () => {
    if (!screenshotSavePath) {
      setDebugFolderFiles([]);
      return;
    }

    try {
      const result = await ipcRenderer.invoke(CHANNELS.GET_DEBUG_FOLDER_FILES, screenshotSavePath);
      if (result?.ok) {
        setDebugFolderFiles(result.files || []);
      } else {
        setDebugFolderFiles([]);
      }
    } catch (error) {
      console.error("Failed to fetch debug folder files:", error);
      setDebugFolderFiles([]);
    }
  }, [screenshotSavePath]);

  const handleRunScreenshotCapture = useCallback(async () => {
    try {
      const result = await ipcRenderer.invoke(CHANNELS.RUN_SCREENSHOT_CAPTURE, {
        filePath: screenshotSavePath.trim() || undefined,
        fileNameSuffix: screenshotNameSuffix.trim() || undefined,
      });
      if (!result?.ok) {
        setDebugNotice({
          text: result?.error || "Unable to capture screenshot.",
          tone: "error",
        });
        return;
      }

      await refreshDebugFolderFiles();

      if (result.filePath) {
        const normalizedPath = String(result.filePath).replace(/\\/g, "/");
        const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
        setDebugNotice({
          text: `Saved ${fileName}`,
          tone: "success",
        });
      } else {
        setDebugNotice({
          text: "Screenshot captured.",
          tone: "success",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDebugNotice({
        text: `Unable to capture screenshot: ${message}`,
        tone: "error",
      });
    }
  }, [refreshDebugFolderFiles, screenshotNameSuffix, screenshotSavePath]);

  const handleChooseScreenshotSavePath = useCallback(async () => {
    try {
      const result = await ipcRenderer.invoke(CHANNELS.PICK_SCREENSHOT_SAVE_PATH);
      if (!result?.ok) {
        setDebugNotice({
          text: result?.error || "Unable to choose screenshot path.",
          tone: "error",
        });
        return;
      }

      if (result.canceled || !result.filePath) {
        return;
      }

      const nextPath = String(result.filePath);
      setScreenshotSavePath(nextPath);
      await ipcRenderer.invoke(CHANNELS.SET_SCREENSHOT_SAVE_PATH, nextPath);
      setDebugNotice({
        text: "Screenshot path selected.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDebugNotice({
        text: `Unable to choose screenshot path: ${message}`,
        tone: "error",
      });
    }
  }, []);

  const handleScreenshotNameSuffixChange = useCallback((value: string) => {
    setScreenshotNameSuffix(value);
    void ipcRenderer.invoke(CHANNELS.SET_SCREENSHOT_NAME_SUFFIX, value).catch(() => {
      // Ignore non-critical config write failures.
    });
  }, []);

  const handleGuardianOfTheRiftElementEnabledChange = useCallback(
    (element: GuardianOfTheRiftActiveElement, enabled: boolean) => {
      setGuardianOfTheRiftConfig((prev) => {
        const next: GuardianOfTheRiftConfig = {
          ...prev,
          activeGuardianElements: {
            ...prev.activeGuardianElements,
            [element]: enabled,
          },
        };

        void ipcRenderer.invoke(CHANNELS.SET_GUARDIAN_OF_THE_RIFT_CONFIG, next).catch(() => {
          // Ignore non-critical config write failures.
        });

        return next;
      });
    },
    [],
  );

  const handleArceuusBloodRuneAgilityLevelChange = useCallback((level: number) => {
    setArceuusBloodRuneConfig((prev) => {
      const next: ArceuusBloodRuneConfig = {
        ...prev,
        agilityLevel: normalizeArceuusBloodRuneAgilityLevel(level),
      };

      void ipcRenderer.invoke(CHANNELS.SET_ARCEUUS_BLOOD_RUNE_CONFIG, next).catch(() => {
        // Ignore non-critical config write failures.
      });

      return next;
    });
  }, []);

  const handleGuardianOfTheRiftUseAgilityCourseChange = useCallback((enabled: boolean) => {
    setGuardianOfTheRiftConfig((prev) => {
      const next: GuardianOfTheRiftConfig = {
        ...prev,
        useAgilityCourse: enabled,
      };

      void ipcRenderer.invoke(CHANNELS.SET_GUARDIAN_OF_THE_RIFT_CONFIG, next).catch(() => {
        // Ignore non-critical config write failures.
      });

      return next;
    });
  }, []);

  const handleGuardianOfTheRiftRunecraftLevelChange = useCallback((level: number) => {
    setGuardianOfTheRiftConfig((prev) => {
      const next: GuardianOfTheRiftConfig = {
        ...prev,
        runecraftLevel: normalizeGuardianOfTheRiftRunecraftLevel(level),
      };

      void ipcRenderer.invoke(CHANNELS.SET_GUARDIAN_OF_THE_RIFT_CONFIG, next).catch(() => {
        // Ignore non-critical config write failures.
      });

      return next;
    });
  }, []);

  const handleGuardianOfTheRiftPouchChange = useCallback((pouch: GuardianOfTheRiftPouch, enabled: boolean) => {
    setGuardianOfTheRiftConfig((prev) => {
      const merged = {
        ...prev,
        pouches: {
          ...prev.pouches,
          [pouch]: enabled,
        },
      };
      // normalizeGuardianOfTheRiftConfig enforces the abyssal-exclusive rule
      const next = normalizeGuardianOfTheRiftConfig(merged);

      void ipcRenderer.invoke(CHANNELS.SET_GUARDIAN_OF_THE_RIFT_CONFIG, next).catch(() => {
        // Ignore non-critical config write failures.
      });

      return next;
    });
  }, []);

  const handleGuardianOfTheRiftColossalFillCountChange = useCallback((count: number) => {
    const next = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
    setGuardianOfTheRiftColossalFillCount(next);
    void ipcRenderer.invoke(CHANNELS.SET_GUARDIAN_OF_THE_RIFT_COLOSSAL_POUCH_FILL_COUNT, next).catch(() => {
      // Ignore non-critical config write failures.
    });
  }, []);

  useEffect(() => {
    if (!debugNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setDebugNotice(null);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [debugNotice]);

  useEffect(() => {
    void refreshDebugFolderFiles();
  }, [refreshDebugFolderFiles]);

  const handleStepContextMenu = useCallback((e: React.MouseEvent, stepId: string, stepName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null);
    setCsvRowContextMenu(null);
    setStepContextMenu({ x: e.clientX, y: e.clientY, stepId, stepName });
  }, []);

  const handleResumeFromStep = useCallback(async () => {
    if (!stepContextMenu) return;
    hideStepContextMenu();
    try {
      const result = await ipcRenderer.invoke(CHANNELS.START_AUTOMATE_BOT_FROM_STEP, stepContextMenu.stepId);
      if (!result?.ok) {
        window.alert(result?.error || "Unable to resume from step.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Unable to resume from step: ${message}`);
    }
  }, [stepContextMenu, hideStepContextMenu]);

  const handleStopReplay = () => {
    ipcRenderer.send(CHANNELS.STOP_REPLAY);
  };

  const handleTestColorDetection = async () => {
    try {
      const result = await ipcRenderer.invoke(CHANNELS.TEST_COLOR_DETECTION);
      if (!result?.ok) {
        window.alert(result?.error || "Color detection test failed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Color detection test failed: ${message}`);
    }
  };

  const handleReplayRepeatChange = (enabled: boolean) => {
    setIsReplayRepeatEnabled(enabled);
    ipcRenderer.send(CHANNELS.SET_REPLAY_REPEAT, enabled);
  };

  const handleReplayRepeatCountChange = (value: string) => {
    const nextValue = Number(value);
    const safeCount = Number.isFinite(nextValue) ? Math.max(0, Math.round(nextValue)) : 0;
    setReplayRepeatCount(safeCount);
    ipcRenderer.send(CHANNELS.SET_REPLAY_REPEAT_COUNT, safeCount);
  };

  const handleReplayClickDelayChange = (value: string) => {
    const nextValue = Number(value);
    const safeDelay = Number.isFinite(nextValue) ? Math.max(0, Math.round(nextValue)) : 0;
    setReplayClickDelayMs(safeDelay);
    ipcRenderer.send(CHANNELS.SET_REPLAY_CLICK_DELAY_MS, safeDelay);
  };

  const handleNewFile = async () => {
    const trimmedName = getDefaultNewFileName();

    try {
      console.log(`[ui] create-file requested: ${trimmedName}`);
      const result = await ipcRenderer.invoke(CHANNELS.CREATE_FILE, trimmedName);
      if (!result?.ok) {
        window.alert(result?.error || "Unable to create file.");
        return;
      }

      // Request a state sync in case the main process update event was missed.
      ipcRenderer.send(CHANNELS.UI_READY);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Unable to create file: ${message}`);
    }
  };

  const getNextSelectedFilePaths = useCallback(
    (current: string[], relativePath: string, additive: boolean, withRange: boolean) => {
      if (!relativePath) {
        return current;
      }

      const targetIndex = folderState.files.indexOf(relativePath);
      if (targetIndex === -1) {
        return current;
      }

      if (withRange) {
        const anchorIndex = lastSelectedFilePath === null ? -1 : folderState.files.indexOf(lastSelectedFilePath);
        const baseIndex = anchorIndex === -1 ? targetIndex : anchorIndex;
        const rangeStart = Math.min(baseIndex, targetIndex);
        const rangeEnd = Math.max(baseIndex, targetIndex);
        const range = folderState.files.slice(rangeStart, rangeEnd + 1);

        if (additive) {
          return Array.from(new Set([...current, ...range]));
        }

        return range;
      }

      if (additive) {
        if (current.includes(relativePath)) {
          return current.filter((path) => path !== relativePath);
        }

        return [...current, relativePath];
      }

      return [relativePath];
    },
    [folderState.files, lastSelectedFilePath],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, relativePath: string, additive: boolean, withRange: boolean) => {
      e.stopPropagation();
      setCsvRowContextMenu(null);

      setSelectedFilePaths((current) => getNextSelectedFilePaths(current, relativePath, additive, withRange));
      setLastSelectedFilePath(relativePath);
      ipcRenderer.send(CHANNELS.SET_ACTIVE_FILE, relativePath);
      setContextMenu({ x: e.clientX, y: e.clientY, relativePath });
    },
    [getNextSelectedFilePaths],
  );

  const handleDeleteSelectedFiles = async () => {
    if (selectedFilePaths.length === 0) return;
    const label = `${selectedFilePaths.length} selected files`;
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!confirmed) return;

    for (const relativePath of selectedFilePaths) {
      const result = await ipcRenderer.invoke(CHANNELS.DELETE_FILE, relativePath);
      if (!result?.ok) {
        window.alert(result?.error || `Unable to delete ${relativePath}.`);
        return;
      }
    }

    setSelectedFilePaths((current) => current.filter((path) => !selectedFilePaths.includes(path)));
    setLastSelectedFilePath(null);
  };

  const handleDuplicateSelectedFiles = async () => {
    if (selectedFilePaths.length === 0) return;
    const confirmed = window.confirm(`Duplicate ${selectedFilePaths.length} selected files?`);
    if (!confirmed) return;

    for (const relativePath of selectedFilePaths) {
      const result = await ipcRenderer.invoke(CHANNELS.DUPLICATE_FILE, relativePath);
      if (!result?.ok) {
        window.alert(result?.error || `Unable to duplicate ${relativePath}.`);
        return;
      }
    }
  };

  const startRename = useCallback((relativePath: string) => {
    const currentName = relativePath.split(/[/\\]/).pop() ?? "";
    setEditingRelativePath(relativePath);
    setEditingName(currentName);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingRelativePath(null);
    setEditingName("");
  }, []);

  const submitRename = useCallback(async () => {
    if (!editingRelativePath) return;
    const nextName = editingName.trim();
    const currentName = editingRelativePath.split(/[/\\]/).pop() ?? "";

    if (!nextName || nextName === currentName) {
      cancelRename();
      return;
    }

    await ipcRenderer.invoke(CHANNELS.RENAME_FILE, {
      relativePath: editingRelativePath,
      newName: nextName,
    });
    cancelRename();
  }, [cancelRename, editingName, editingRelativePath]);

  const handleRename = () => {
    if (!contextMenu) return;
    startRename(contextMenu.relativePath);
    hideContextMenu();
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const selectedTargets = selectedFilePaths.includes(contextMenu.relativePath)
      ? selectedFilePaths
      : [contextMenu.relativePath];
    const isMassDelete = selectedTargets.length > 1;
    const label = isMassDelete
      ? `${selectedTargets.length} selected files`
      : (selectedTargets[0].split(/[/\\]/).pop() ?? selectedTargets[0]);
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
    hideContextMenu();
    if (!confirmed) return;

    for (const relativePath of selectedTargets) {
      await ipcRenderer.invoke(CHANNELS.DELETE_FILE, relativePath);
    }

    setSelectedFilePaths((current) => current.filter((path) => !selectedTargets.includes(path)));
    if (selectedTargets.includes(lastSelectedFilePath ?? "")) {
      setLastSelectedFilePath(null);
    }
  };

  const handleCsvRowContextMenu = useCallback((e: React.MouseEvent, rowIndex: number, stepName: string) => {
    e.stopPropagation();
    setContextMenu(null);
    setCsvRowContextMenu({ x: e.clientX, y: e.clientY, rowIndex, stepName });
  }, []);

  const selectedCsvRowIndex = useMemo(
    () => (selectedCsvRowIndexes.length > 0 ? selectedCsvRowIndexes[selectedCsvRowIndexes.length - 1] : null),
    [selectedCsvRowIndexes],
  );
  const selectedCsvRow = useMemo(
    () =>
      selectedCsvRowIndex === null
        ? null
        : (folderState.activeFileRows.find((row) => row.index === selectedCsvRowIndex) ?? null),
    [selectedCsvRowIndex, folderState.activeFileRows],
  );

  const handlePlaySelectedCsvRow = useCallback(async () => {
    const targetIndex = selectedCsvRowIndexes.length > 0 ? selectedCsvRowIndexes[selectedCsvRowIndexes.length - 1] : null;
    if (targetIndex === null) return;
    const result = await ipcRenderer.invoke(CHANNELS.PLAY_CSV_ROW, targetIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to play row.");
    }
  }, [selectedCsvRowIndexes]);

  const getMovedCsvRowIndex = (
    sourceRowIndex: number,
    targetRowIndex: number,
    placement: "before" | "after",
    totalRows: number,
  ): number | null => {
    if (totalRows <= 0) {
      return null;
    }

    const normalizedSource = Math.max(0, Math.min(Math.floor(sourceRowIndex), totalRows - 1));
    const normalizedTarget = Math.max(0, Math.min(Math.floor(targetRowIndex), totalRows - 1));

    if (normalizedSource === normalizedTarget && placement === "before") {
      return normalizedSource;
    }

    const insertBase = normalizedTarget + (placement === "after" ? 1 : 0);
    const normalizedInsert = Math.min(Math.max(insertBase, 0), totalRows);
    const targetIndex = normalizedSource < normalizedInsert ? normalizedInsert - 1 : normalizedInsert;

    return Math.max(0, Math.min(Math.floor(targetIndex), totalRows - 1));
  };

  const cancelCsvRowRename = useCallback(() => {
    setEditingCsvRowIndex(null);
    setEditingStepName("");
  }, []);

  const submitCsvRowRename = useCallback(async () => {
    if (editingCsvRowIndex === null) return;
    const trimmed = editingStepName.trim();
    cancelCsvRowRename();
    if (!trimmed) return;
    const result = await ipcRenderer.invoke(CHANNELS.RENAME_ACTIVE_CSV_ROW_STEP, {
      rowIndex: editingCsvRowIndex,
      stepName: trimmed,
    });
    if (!result?.ok) {
      window.alert(result?.error || "Unable to rename step.");
    }
  }, [cancelCsvRowRename, editingCsvRowIndex, editingStepName]);

  const handleCsvRowDragStart = useCallback((rowIndex: number) => {
    setSelectedCsvRowIndexes((current) => {
      return current.includes(rowIndex) ? current : [rowIndex];
    });
    setLastSelectedCsvRowIndex(rowIndex);
  }, []);

  const handleCsvRowDragMove = useCallback(
    async (sourceRowIndex: number, targetRowIndex: number, placement: "before" | "after") => {
      const rowCount = folderState.activeFileRows.length;
      if (rowCount === 0) {
        return;
      }

      const normalizedSource = Math.max(0, Math.min(Math.floor(sourceRowIndex), rowCount - 1));
      const normalizedTarget = Math.max(0, Math.min(Math.floor(targetRowIndex), rowCount - 1));

      if (normalizedSource === normalizedTarget && placement === "before") {
        return;
      }

      const result = await ipcRenderer.invoke(CHANNELS.MOVE_ACTIVE_CSV_ROW, {
        rowIndex: normalizedSource,
        targetRowIndex: normalizedTarget,
        placement,
      });
      if (!result?.ok) {
        window.alert(result?.error || "Unable to move row.");
        return;
      }

      const movedIndex = getMovedCsvRowIndex(normalizedSource, normalizedTarget, placement, rowCount);
      if (movedIndex !== null) {
        setSelectedCsvRowIndexes([movedIndex]);
        setLastSelectedCsvRowIndex(movedIndex);
      }
    },
    [folderState.activeFileRows.length, getMovedCsvRowIndex],
  );

  const handleCsvRowDragEnd = useCallback(() => {
    setCsvRowContextMenu(null);
  }, []);

  const handleRenameCsvRowStep = useCallback(() => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    setEditingCsvRowIndex(csvRowContextMenu.rowIndex);
    setEditingStepName(csvRowContextMenu.stepName);
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handlePlayCsvRow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke(CHANNELS.PLAY_CSV_ROW, csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to play row.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleResumeCsvRow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke(CHANNELS.REPLAY_ACTIVE_CSV_FROM_ROW, {
      rowIndex: csvRowContextMenu.rowIndex,
    });
    if (!result?.ok) {
      window.alert(result?.error || "Unable to resume from row.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleDeleteCsvRow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    const rowNumber = csvRowContextMenu.rowIndex + 1;
    const confirmed = window.confirm(`Delete row ${rowNumber}? This cannot be undone.`);
    hideCsvRowContextMenu();
    if (!confirmed) return;
    const result = await ipcRenderer.invoke(CHANNELS.DELETE_ACTIVE_CSV_ROW, csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to delete row.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleInsertStepAbove = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke(CHANNELS.INSERT_ACTIVE_CSV_ROW_ABOVE, csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to insert step above.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleInsertStepBelow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke(CHANNELS.INSERT_ACTIVE_CSV_ROW_BELOW, csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to insert step below.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleMoveCsvRowToTop = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    const rowIndex = csvRowContextMenu.rowIndex;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke(CHANNELS.MOVE_ACTIVE_CSV_ROW_TO_TOP, rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to move row to top.");
      return;
    }

    const rowCount = folderState.activeFileRows.length;
    if (rowCount > 0) {
      setSelectedCsvRowIndexes([0]);
      setLastSelectedCsvRowIndex(0);
    }
  }, [csvRowContextMenu, folderState.activeFileRows.length, hideCsvRowContextMenu]);

  const handleMoveCsvRowToBottom = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    const rowIndex = csvRowContextMenu.rowIndex;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke(CHANNELS.MOVE_ACTIVE_CSV_ROW_TO_BOTTOM, rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to move row to bottom.");
      return;
    }

    const lastIndex = folderState.activeFileRows.length - 1;
    if (lastIndex >= 0) {
      setSelectedCsvRowIndexes([lastIndex]);
      setLastSelectedCsvRowIndex(lastIndex);
    }
  }, [csvRowContextMenu, folderState.activeFileRows.length, hideCsvRowContextMenu]);

  const handleFileClick = useCallback(
    (relativePath: string, additive: boolean, withRange: boolean) => {
      hideContextMenu();
      cancelRename();
      setSelectedCsvRowIndexes([]);
      setLastSelectedCsvRowIndex(null);
      setSelectedFilePaths((current) => getNextSelectedFilePaths(current, relativePath, additive, withRange));
      setLastSelectedFilePath(relativePath);
      ipcRenderer.send(CHANNELS.SET_ACTIVE_FILE, relativePath);
    },
    [cancelRename, hideContextMenu, getNextSelectedFilePaths],
  );

  const handleRowSelection = useCallback(
    (rowIndex: number, additive: boolean, withRange: boolean) => {
      if (!Number.isInteger(rowIndex) || rowIndex < 0) return;

      setSelectedCsvRowIndexes((current) => {
        const activeRowIndexes = new Set(folderState.activeFileRows.map((row) => row.index));
        if (!activeRowIndexes.has(rowIndex)) {
          return current;
        }

        const availableRows = current.filter((value) => activeRowIndexes.has(value));
        let next: number[];

        if (withRange) {
          const anchor = lastSelectedCsvRowIndex === null ? rowIndex : lastSelectedCsvRowIndex;
          const rangeStart = Math.min(anchor, rowIndex);
          const rangeEnd = Math.max(anchor, rowIndex);
          const inRangeRows = folderState.activeFileRows
            .filter((row) => row.index >= rangeStart && row.index <= rangeEnd)
            .map((row) => row.index);

          next = additive ? Array.from(new Set([...availableRows, ...inRangeRows])) : inRangeRows;
        } else if (additive) {
          if (availableRows.includes(rowIndex)) {
            next = availableRows.filter((currentRowIndex) => currentRowIndex !== rowIndex);
          } else {
            next = [...availableRows, rowIndex];
          }
        } else {
          next = [rowIndex];
        }

        return next.sort((a, b) => a - b);
      });

      setLastSelectedCsvRowIndex(rowIndex);
    },
    [folderState.activeFileRows, lastSelectedCsvRowIndex],
  );

  const handleDuplicateSelectedCsvRows = async () => {
    if (selectedCsvRowIndexes.length === 0) return;

    const targets = [...selectedCsvRowIndexes].sort((a, b) => b - a);
    const confirmed = window.confirm(`Duplicate ${targets.length} selected rows?`);
    if (!confirmed) return;

    for (const rowIndex of targets) {
      const result = await ipcRenderer.invoke(CHANNELS.INSERT_ACTIVE_CSV_ROW_BELOW, rowIndex);
      if (!result?.ok) {
        window.alert(result?.error || `Unable to duplicate row ${rowIndex + 1}.`);
        return;
      }
    }
  };

  const handleDeleteSelectedCsvRows = async () => {
    if (selectedCsvRowIndexes.length === 0) return;

    const label = `${selectedCsvRowIndexes.length} selected rows`;
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!confirmed) return;

    for (const rowIndex of [...selectedCsvRowIndexes].sort((a, b) => b - a)) {
      const result = await ipcRenderer.invoke(CHANNELS.DELETE_ACTIVE_CSV_ROW, rowIndex);
      if (!result?.ok) {
        window.alert(result?.error || `Unable to delete row ${rowIndex + 1}.`);
        return;
      }
    }

    setSelectedCsvRowIndexes([]);
    setLastSelectedCsvRowIndex(null);
  };

  const contextMenuSelectedTargets = contextMenu
    ? selectedFilePaths.includes(contextMenu.relativePath)
      ? selectedFilePaths
      : [contextMenu.relativePath]
    : [];
  const canRenameContextTarget = contextMenuSelectedTargets.length === 1;
  const mouseLocationText = cursorPos ? `X: ${cursorPos.x} Y: ${cursorPos.y}` : "X: -- Y: --";

  useEffect(() => {
    if (!selectedCsvRow) {
      setRowForm({
        action: "",
        x: "",
        y: "",
        elapsedSeconds: "",
        radius: "",
        elapsedRange: "none",
        xMin: "",
        xMax: "",
        yMin: "",
        yMax: "",
        elapsedMin: "",
        elapsedMax: "",
      });
      return;
    }

    setRowForm({
      action: selectedCsvRow.action,
      x: String(selectedCsvRow.x),
      y: String(selectedCsvRow.y),
      elapsedSeconds: selectedCsvRow.elapsedSeconds.toFixed(3),
      radius: String(selectedCsvRow.radius),
      elapsedRange: selectedCsvRow.elapsedRange || "none",
      xMin: String(selectedCsvRow.xMin),
      xMax: String(selectedCsvRow.xMax),
      yMin: String(selectedCsvRow.yMin),
      yMax: String(selectedCsvRow.yMax),
      elapsedMin: selectedCsvRow.elapsedMin === null ? "" : String(selectedCsvRow.elapsedMin),
      elapsedMax: selectedCsvRow.elapsedMax === null ? "" : String(selectedCsvRow.elapsedMax),
    });
  }, [selectedCsvRow]);

  const handleRowFormChange = useCallback((field: keyof typeof rowForm, value: string) => {
    setRowForm((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);

  const handleSaveRow = useCallback(async () => {
    if (selectedCsvRowIndexes.length === 0 || !folderState.activeFileRows.length) {
      return;
    }

    const x = Number(rowForm.x);
    const y = Number(rowForm.y);
    const elapsedSeconds = Number(rowForm.elapsedSeconds);
    const radius = Number(rowForm.radius);
    const xMin = Number(rowForm.xMin);
    const xMax = Number(rowForm.xMax);
    const yMin = Number(rowForm.yMin);
    const yMax = Number(rowForm.yMax);
    const elapsedMinRaw = rowForm.elapsedMin.trim().toLowerCase();
    const elapsedMaxRaw = rowForm.elapsedMax.trim().toLowerCase();
    const elapsedMin = elapsedMinRaw === "none" || elapsedMinRaw === "" ? null : Number(rowForm.elapsedMin);
    const elapsedMax = elapsedMaxRaw === "none" || elapsedMaxRaw === "" ? null : Number(rowForm.elapsedMax);

    if (!rowForm.action.trim()) {
      window.alert("Action is required.");
      return;
    }

    if (![x, y, elapsedSeconds, radius, xMin, xMax, yMin, yMax].every((value) => Number.isFinite(value))) {
      window.alert("X, Y, radius, and X/Y ranges must be valid numbers.");
      return;
    }

    if (
      (elapsedMin !== null && !Number.isFinite(elapsedMin)) ||
      (elapsedMax !== null && !Number.isFinite(elapsedMax))
    ) {
      window.alert("Elapsed range values must be numeric or empty.");
      return;
    }

    setIsSavingRow(true);
    try {
      const rowsByIndex = new Map(folderState.activeFileRows.map((row) => [row.index, row]));
      const targets = [...selectedCsvRowIndexes].sort((a, b) => a - b);

      for (const rowIndex of targets) {
        const row = rowsByIndex.get(rowIndex);
        if (!row) {
          window.alert(`Row ${rowIndex + 1} is no longer available.`);
          return;
        }

        const result = await ipcRenderer.invoke(CHANNELS.UPDATE_ACTIVE_CSV_ROW, {
          rowIndex,
          action: rowForm.action.trim(),
          stepName: row.stepName,
          x,
          y,
          elapsedSeconds,
          radius,
          elapsedRange: rowForm.elapsedRange.trim() || "none",
          xMin,
          xMax,
          yMin,
          yMax,
          elapsedMin,
          elapsedMax,
        });

        if (!result?.ok) {
          window.alert(result?.error || `Unable to save row ${rowIndex + 1}.`);
          return;
        }
      }
    } finally {
      setIsSavingRow(false);
    }
  }, [
    folderState.activeFileRows,
    selectedCsvRowIndexes,
    rowForm.action,
    rowForm.elapsedMax,
    rowForm.elapsedMin,
    rowForm.elapsedRange,
    rowForm.elapsedSeconds,
    rowForm.radius,
    rowForm.x,
    rowForm.xMax,
    rowForm.xMin,
    rowForm.y,
    rowForm.yMax,
    rowForm.yMin,
  ]);

  const handleEditingNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void submitRename();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    },
    [cancelRename, submitRename],
  );

  return (
    <>
      <div className="panel">
        <div className="view-navigation">
          <button
            className={`nav-tab ${activeView === "clicker" ? "active" : ""}`}
            onClick={() => setActiveView("clicker")}
          >
            Clicker
          </button>
          <button
            className={`nav-tab ${activeView === "automateBot" ? "active" : ""}`}
            onClick={() => setActiveView("automateBot")}
          >
            Automate Bot
          </button>
          <button
            className={`nav-tab ${activeView === "stats" ? "active" : ""}`}
            onClick={() => setActiveView("stats")}
          >
            Stats
          </button>
          <button
            className={`nav-tab ${activeView === "debug" ? "active" : ""}`}
            onClick={() => setActiveView("debug")}
          >
            Debug
          </button>
          <div className="nav-mouse-pos" title="Current mouse location">
            Mouse: {mouseLocationText}
          </div>
        </div>

        {activeView === "clicker" ? (
          <ClickerTabs
            folderState={folderState}
            selectedFilePaths={selectedFilePaths}
            editingRelativePath={editingRelativePath}
            editingName={editingName}
            editingCsvRowIndex={editingCsvRowIndex}
            editingStepName={editingStepName}
            selectedCsvRowIndex={selectedCsvRowIndex}
            replayingCsvRowIndex={replayingCsvRowIndex}
            isReplaying={isReplaying}
            isRecording={isRecording}
            isReplayRepeatEnabled={isReplayRepeatEnabled}
            replayRepeatCount={replayRepeatCount}
            replayClickDelayMs={replayClickDelayMs}
            cursorPos={cursorPos}
            markerColorState={markerColorState}
            selectedCsvRowIndexes={selectedCsvRowIndexes}
            selectedCsvRow={selectedCsvRow}
            rowForm={rowForm}
            isSavingRow={isSavingRow}
            onNewFile={() => void handleNewFile()}
            onFileClick={handleFileClick}
            onFileContextMenu={handleContextMenu}
            onDuplicateSelectedFiles={() => void handleDuplicateSelectedFiles()}
            onDeleteSelectedFiles={() => void handleDeleteSelectedFiles()}
            onEditingNameChange={setEditingName}
            onEditingNameKeyDown={handleEditingNameKeyDown}
            onEditingNameBlur={() => void submitRename()}
            onCsvRowContextMenu={handleCsvRowContextMenu}
            onCsvRowDragStart={handleCsvRowDragStart}
            onCsvRowDragMove={handleCsvRowDragMove}
            onCsvRowDragEnd={handleCsvRowDragEnd}
            onSelectedCsvRowChange={handleRowSelection}
            onDuplicateSelectedCsvRows={() => void handleDuplicateSelectedCsvRows()}
            onDeleteSelectedCsvRows={() => void handleDeleteSelectedCsvRows()}
            onEditingStepNameChange={setEditingStepName}
            onEditingStepNameSubmit={() => void submitCsvRowRename()}
            onEditingStepNameCancel={cancelCsvRowRename}
            onToggleRecording={handleToggleRecording}
            onReplayCsv={() => void handleReplayCsv()}
            onStopReplay={handleStopReplay}
            onTestColorDetection={() => void handleTestColorDetection()}
            onReplayRepeatChange={handleReplayRepeatChange}
            onReplayRepeatCountChange={handleReplayRepeatCountChange}
            onReplayClickDelayChange={handleReplayClickDelayChange}
            onRowFormChange={handleRowFormChange}
            onSaveRow={() => void handleSaveRow()}
            onPlaySelectedCsvRow={() => void handlePlaySelectedCsvRow()}
          />
        ) : activeView === "automateBot" ? (
          <AutomateBot
            taskTree={taskTree}
            selectableTaskIds={selectableTaskIds}
            expandedTaskNodeIds={expandedTaskNodeIds}
            selectedTaskNodeId={selectedTaskNodeId}
            isSelectedTaskRunning={isSelectedTaskRunning}
            currentStepId={currentStepId}
            logLines={automateBotLogLines}
            showArceuusBloodRuneConfig={selectedTaskNodeId === RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID}
            arceuusBloodRuneAgilityLevel={arceuusBloodRuneConfig.agilityLevel}
            showGuardianOfTheRiftConfig={selectedTaskNodeId === RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}
            guardianOfTheRiftElements={GUARDIAN_OF_THE_RIFT_ACTIVE_ELEMENTS}
            guardianOfTheRiftConfig={guardianOfTheRiftConfig}
            onToggleTaskNodeExpand={handleToggleTaskNodeExpand}
            onSelectTaskNode={setSelectedTaskNodeId}
            onToggleSelectedTaskRun={(taskNodeId) => void handleToggleSelectedTaskRun(taskNodeId)}
            onStepContextMenu={handleStepContextMenu}
            onArceuusBloodRuneAgilityLevelChange={handleArceuusBloodRuneAgilityLevelChange}
            onGuardianOfTheRiftElementEnabledChange={handleGuardianOfTheRiftElementEnabledChange}
            onGuardianOfTheRiftUseAgilityCourseChange={handleGuardianOfTheRiftUseAgilityCourseChange}
            onGuardianOfTheRiftRunecraftLevelChange={handleGuardianOfTheRiftRunecraftLevelChange}
            onGuardianOfTheRiftPouchChange={handleGuardianOfTheRiftPouchChange}
            colossalPouchFullFillCount={guardianOfTheRiftColossalFillCount}
            onGuardianOfTheRiftColossalFillCountChange={handleGuardianOfTheRiftColossalFillCountChange}
          />
        ) : activeView === "stats" ? (
          <GotrStatsView
            snapshot={gotrRunStatsSnapshot}
            isLoading={isGotrRunStatsLoading}
            error={gotrRunStatsError}
            onRefresh={() => void refreshGotrRunStats()}
          />
        ) : (
          <div className="debug-view">
            <div className="debug-save-row">
              <button type="button" className="debug-action-btn" onClick={() => void handleRunScreenshotCapture()}>
                Screenshot (F2)
              </button>
              <button type="button" className="debug-action-btn" onClick={() => void handleChooseScreenshotSavePath()}>
                Choose Path
              </button>
              <input
                type="text"
                className="debug-save-path"
                value={screenshotSavePath}
                readOnly
                placeholder="Default path: ./test-images/[dimensions]-[resolution]-[scale]-[suffix].png"
              />
              <input
                type="text"
                className="debug-save-suffix"
                value={screenshotNameSuffix}
                onChange={(e) => handleScreenshotNameSuffixChange(e.target.value)}
                placeholder="Suffix"
                aria-label="Screenshot name suffix"
                spellCheck={false}
              />
            </div>
            {debugNotice && (
              <p className={`debug-notice${debugNotice.tone === "error" ? " debug-notice-error" : ""}`}>
                {debugNotice.text}
              </p>
            )}
            <div className="debug-files-container">
              <h3 className="debug-files-title">Debug Folder Files</h3>
              {debugFolderFiles.length > 0 ? (
                <ul className="debug-files-list">
                  {debugFolderFiles.map((file) => (
                    <li key={file} className="debug-file-item">
                      {file}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="debug-files-empty">
                  {screenshotSavePath ? "No files in folder" : "Select a folder to view files"}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {canRenameContextTarget && (
            <div className="context-item" onClick={() => void handleRename()}>
              Rename
            </div>
          )}
          <div className="context-item context-item--danger" onClick={() => void handleDelete()}>
            {contextMenuSelectedTargets.length > 1
              ? `Delete Selected (${contextMenuSelectedTargets.length})`
              : "Delete"}
          </div>
        </div>
      )}
      {stepContextMenu && (
        <div
          className="context-menu"
          style={{ left: stepContextMenu.x, top: stepContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-item" onClick={() => void handleResumeFromStep()}>
            Resume from {stepContextMenu.stepName}
          </div>
        </div>
      )}
      {csvRowContextMenu && (
        <div
          className="context-menu"
          style={{ left: csvRowContextMenu.x, top: csvRowContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-item" onClick={() => void handlePlayCsvRow()}>
            Play (row)
          </div>
          <div className="context-item" onClick={() => void handleResumeCsvRow()}>
            Resume from here
          </div>
          <div className="context-item" onClick={() => void handleRenameCsvRowStep()}>
            Rename Step
          </div>
          <div className="context-item" onClick={() => void handleMoveCsvRowToTop()}>
            Push to Top
          </div>
          <div className="context-item" onClick={() => void handleMoveCsvRowToBottom()}>
            Push to Bottom
          </div>
          <div className="context-item" onClick={() => void handleInsertStepAbove()}>
            Step above
          </div>
          <div className="context-item" onClick={() => void handleInsertStepBelow()}>
            Step under
          </div>
          <div className="context-item context-item--danger" onClick={() => void handleDeleteCsvRow()}>
            Delete Row
          </div>
        </div>
      )}
    </>
  );
}
