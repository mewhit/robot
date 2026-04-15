import React, { useState, useEffect, useCallback } from "react";
import type { IpcRenderer } from "electron";
import ClickerTabs from "./clicker-tabs";
import AutomateBot from "./automate-bot";

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

type MarkerColorState = {
  color: "green" | "red" | "none";
  confidence: number;
  point: { x: number; y: number } | null;
};

type ActiveView = "clicker" | "automateBot";
const ACTIVE_VIEW_STORAGE_KEY = "robot.activeView";

function getInitialActiveView(): ActiveView {
  const savedView = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
  return savedView === "automateBot" ? "automateBot" : "clicker";
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>(() => getInitialActiveView());
  const [isRecording, setIsRecording] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isReplayRepeatEnabled, setIsReplayRepeatEnabled] = useState(false);
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
  const [selectedCsvRowIndex, setSelectedCsvRowIndex] = useState<number | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
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
  const [taskTree, setTaskTree] = useState<TaskNode[]>([
    {
      id: "agility",
      name: "Agility",
      children: [
        {
          id: "falador-rooftop",
          name: "Falador Roof Top",
        },
      ],
    },
  ]);
  const [expandedTaskNodeIds, setExpandedTaskNodeIds] = useState<Set<string>>(new Set(["agility"]));

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

  const hideContextMenu = useCallback(() => setContextMenu(null), []);
  const hideCsvRowContextMenu = useCallback(() => setCsvRowContextMenu(null), []);

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
    const onReplayDelayState = (_: unknown, delayMs: number) => {
      setReplayClickDelayMs(Number.isFinite(delayMs) ? Math.max(0, Math.round(delayMs)) : 0);
    };
    const onReplayRowState = (_: unknown, rowIndex: number | null) => {
      setReplayingCsvRowIndex(Number.isInteger(rowIndex) ? rowIndex : null);
    };
    const onFolderState = (_: unknown, payload: FolderState) => {
      setFolderState(payload);
      setSelectedFilePaths((current) => current.filter((path) => payload.files.includes(path)));
      setSelectedCsvRowIndex((current) => {
        if (payload.activeFileRows.length === 0) {
          return null;
        }
        if (current === null) {
          return null;
        }
        return payload.activeFileRows.some((row) => row.index === current) ? current : null;
      });
    };
    const onMarkerColorState = (_: unknown, payload: MarkerColorState) => {
      setMarkerColorState(payload);
    };

    ipcRenderer.on("recording-state", onRecordingState);
    ipcRenderer.on("replaying-state", onReplayingState);
    ipcRenderer.on("replay-repeat-state", onReplayRepeatState);
    ipcRenderer.on("replay-delay-state", onReplayDelayState);
    ipcRenderer.on("replay-row-state", onReplayRowState);
    ipcRenderer.on("marker-color-state", onMarkerColorState);
    ipcRenderer.on("output-folder-state", onFolderState);
    const onCursorPos = (
      _: unknown,
      pos: { x: number; y: number; runLiteWindow?: { x: number; y: number; width: number; height: number } | null },
    ) => setCursorPos(pos);
    ipcRenderer.on("cursor-pos", onCursorPos);
    ipcRenderer.send("ui-ready");

    return () => {
      ipcRenderer.removeListener("recording-state", onRecordingState);
      ipcRenderer.removeListener("replaying-state", onReplayingState);
      ipcRenderer.removeListener("replay-repeat-state", onReplayRepeatState);
      ipcRenderer.removeListener("replay-delay-state", onReplayDelayState);
      ipcRenderer.removeListener("replay-row-state", onReplayRowState);
      ipcRenderer.removeListener("marker-color-state", onMarkerColorState);
      ipcRenderer.removeListener("output-folder-state", onFolderState);
      ipcRenderer.removeListener("cursor-pos", onCursorPos);
    };
  }, []);

  useEffect(() => {
    const hideAll = () => {
      hideContextMenu();
      hideCsvRowContextMenu();
    };
    window.addEventListener("click", hideAll);
    window.addEventListener("resize", hideAll);
    return () => {
      window.removeEventListener("click", hideAll);
      window.removeEventListener("resize", hideAll);
    };
  }, [hideContextMenu, hideCsvRowContextMenu]);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView);
  }, [activeView]);

  const handleToggleRecording = () => ipcRenderer.send("toggle-recording");

  const handleReplayCsv = async () => {
    try {
      const result = await ipcRenderer.invoke("replay-active-csv", { fromUi: true });
      if (!result?.ok) {
        window.alert(result?.error || "Unable to replay CSV.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Unable to replay CSV: ${message}`);
    }
  };

  const handleStopReplay = () => {
    ipcRenderer.send("stop-replay");
  };

  const handleTestColorDetection = async () => {
    try {
      const result = await ipcRenderer.invoke("test-color-detection");
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
    ipcRenderer.send("set-replay-repeat", enabled);
  };

  const handleReplayClickDelayChange = (value: string) => {
    const nextValue = Number(value);
    const safeDelay = Number.isFinite(nextValue) ? Math.max(0, Math.round(nextValue)) : 0;
    setReplayClickDelayMs(safeDelay);
    ipcRenderer.send("set-replay-click-delay-ms", safeDelay);
  };

  const handleNewFile = async () => {
    const trimmedName = getDefaultNewFileName();

    try {
      console.log(`[ui] create-file requested: ${trimmedName}`);
      const result = await ipcRenderer.invoke("create-file", trimmedName);
      if (!result?.ok) {
        window.alert(result?.error || "Unable to create file.");
        return;
      }

      // Request a state sync in case the main process update event was missed.
      ipcRenderer.send("ui-ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Unable to create file: ${message}`);
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, relativePath: string, additive: boolean) => {
    e.stopPropagation();
    setCsvRowContextMenu(null);

    setSelectedFilePaths((current) => {
      if (additive) {
        if (current.includes(relativePath)) {
          return current.filter((path) => path !== relativePath);
        }
        return [...current, relativePath];
      }

      return current.includes(relativePath) ? current : [relativePath];
    });

    setContextMenu({ x: e.clientX, y: e.clientY, relativePath });
  }, []);

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

    await ipcRenderer.invoke("rename-file", {
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
    const selectedTargets = selectedFilePaths.includes(contextMenu.relativePath) ? selectedFilePaths : [contextMenu.relativePath];
    const isMassDelete = selectedTargets.length > 1;
    const label = isMassDelete
      ? `${selectedTargets.length} selected files`
      : (selectedTargets[0].split(/[/\\]/).pop() ?? selectedTargets[0]);
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
    hideContextMenu();
    if (!confirmed) return;

    for (const relativePath of selectedTargets) {
      await ipcRenderer.invoke("delete-file", relativePath);
    }

    setSelectedFilePaths((current) => current.filter((path) => !selectedTargets.includes(path)));
  };

  const handleCsvRowContextMenu = useCallback((e: React.MouseEvent, rowIndex: number, stepName: string) => {
    e.stopPropagation();
    setContextMenu(null);
    setCsvRowContextMenu({ x: e.clientX, y: e.clientY, rowIndex, stepName });
  }, []);

  const cancelCsvRowRename = useCallback(() => {
    setEditingCsvRowIndex(null);
    setEditingStepName("");
  }, []);

  const submitCsvRowRename = useCallback(async () => {
    if (editingCsvRowIndex === null) return;
    const trimmed = editingStepName.trim();
    cancelCsvRowRename();
    if (!trimmed) return;
    const result = await ipcRenderer.invoke("rename-active-csv-row-step", {
      rowIndex: editingCsvRowIndex,
      stepName: trimmed,
    });
    if (!result?.ok) {
      window.alert(result?.error || "Unable to rename step.");
    }
  }, [cancelCsvRowRename, editingCsvRowIndex, editingStepName]);

  const handleRenameCsvRowStep = useCallback(() => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    setEditingCsvRowIndex(csvRowContextMenu.rowIndex);
    setEditingStepName(csvRowContextMenu.stepName);
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handlePlayCsvRow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke("play-csv-row", csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to play row.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleResumeCsvRow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke("replay-active-csv-from-row", { rowIndex: csvRowContextMenu.rowIndex });
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
    const result = await ipcRenderer.invoke("delete-active-csv-row", csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to delete row.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleInsertStepAbove = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke("insert-active-csv-row-above", csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to insert step above.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleInsertStepBelow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke("insert-active-csv-row-below", csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to insert step below.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handleFileClick = useCallback(
    (relativePath: string, additive: boolean) => {
      hideContextMenu();
      cancelRename();
      setSelectedCsvRowIndex(null);

      if (additive) {
        setSelectedFilePaths((current) => {
          if (current.includes(relativePath)) {
            return current.filter((path) => path !== relativePath);
          }
          return [...current, relativePath];
        });
        return;
      }

      setSelectedFilePaths([relativePath]);
      ipcRenderer.send("set-active-file", relativePath);
    },
    [cancelRename, hideContextMenu],
  );

  const contextMenuSelectedTargets = contextMenu
    ? selectedFilePaths.includes(contextMenu.relativePath)
      ? selectedFilePaths
      : [contextMenu.relativePath]
    : [];
  const canRenameContextTarget = contextMenuSelectedTargets.length === 1;

  const selectedCsvRow =
    selectedCsvRowIndex === null ? null : (folderState.activeFileRows.find((row) => row.index === selectedCsvRowIndex) ?? null);

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
    if (!selectedCsvRow) {
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

    if ((elapsedMin !== null && !Number.isFinite(elapsedMin)) || (elapsedMax !== null && !Number.isFinite(elapsedMax))) {
      window.alert("Elapsed range values must be numeric or empty.");
      return;
    }

    setIsSavingRow(true);
    try {
      const result = await ipcRenderer.invoke("update-active-csv-row", {
        rowIndex: selectedCsvRow.index,
        action: rowForm.action.trim(),
        stepName: selectedCsvRow.stepName,
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
        window.alert(result?.error || "Unable to save CSV row.");
      }
    } finally {
      setIsSavingRow(false);
    }
  }, [
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
    selectedCsvRow,
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
          <button className={`nav-tab ${activeView === "clicker" ? "active" : ""}`} onClick={() => setActiveView("clicker")}>
            Clicker
          </button>
          <button className={`nav-tab ${activeView === "automateBot" ? "active" : ""}`} onClick={() => setActiveView("automateBot")}>
            Automate Bot
          </button>
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
            replayClickDelayMs={replayClickDelayMs}
            cursorPos={cursorPos}
            markerColorState={markerColorState}
            selectedCsvRow={selectedCsvRow}
            rowForm={rowForm}
            isSavingRow={isSavingRow}
            onNewFile={() => void handleNewFile()}
            onFileClick={handleFileClick}
            onFileContextMenu={handleContextMenu}
            onEditingNameChange={setEditingName}
            onEditingNameKeyDown={handleEditingNameKeyDown}
            onEditingNameBlur={() => void submitRename()}
            onCsvRowContextMenu={handleCsvRowContextMenu}
            onSelectedCsvRowChange={setSelectedCsvRowIndex}
            onEditingStepNameChange={setEditingStepName}
            onEditingStepNameSubmit={() => void submitCsvRowRename()}
            onEditingStepNameCancel={cancelCsvRowRename}
            onToggleRecording={handleToggleRecording}
            onReplayCsv={() => void handleReplayCsv()}
            onStopReplay={handleStopReplay}
            onTestColorDetection={() => void handleTestColorDetection()}
            onReplayRepeatChange={handleReplayRepeatChange}
            onReplayClickDelayChange={handleReplayClickDelayChange}
            onRowFormChange={handleRowFormChange}
            onSaveRow={() => void handleSaveRow()}
          />
        ) : (
          <AutomateBot taskTree={taskTree} expandedTaskNodeIds={expandedTaskNodeIds} onToggleTaskNodeExpand={handleToggleTaskNodeExpand} />
        )}
      </div>
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          {canRenameContextTarget && (
            <div className="context-item" onClick={() => void handleRename()}>
              Rename
            </div>
          )}
          <div className="context-item context-item--danger" onClick={() => void handleDelete()}>
            {contextMenuSelectedTargets.length > 1 ? `Delete Selected (${contextMenuSelectedTargets.length})` : "Delete"}
          </div>
        </div>
      )}
      {csvRowContextMenu && (
        <div className="context-menu" style={{ left: csvRowContextMenu.x, top: csvRowContextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="context-item" onClick={() => void handlePlayCsvRow()}>
            Play (row)
          </div>
          <div className="context-item" onClick={() => void handleResumeCsvRow()}>
            Resume from here
          </div>
          <div className="context-item" onClick={() => void handleRenameCsvRowStep()}>
            Rename Step
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
