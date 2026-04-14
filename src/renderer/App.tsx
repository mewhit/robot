import React, { useState, useEffect, useCallback } from "react";
import type { IpcRenderer } from "electron";

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

function TreeNode({
  node,
  activeRelativePath,
  activeFileRows,
  selectedCsvRowIndex,
  selectedFilePaths,
  replayingCsvRowIndex,
  isReplaying,
  editingRelativePath,
  editingName,
  onFileClick,
  onCsvRowClick,
  onCsvRowContextMenu,
  onContextMenu,
  onEditingNameChange,
  onEditingNameKeyDown,
  onEditingNameBlur,
}: {
  node: ExplorerNode;
  activeRelativePath: string | null;
  activeFileRows: CsvRow[];
  selectedCsvRowIndex: number | null;
  selectedFilePaths: string[];
  replayingCsvRowIndex: number | null;
  isReplaying: boolean;
  editingRelativePath: string | null;
  editingName: string;
  onFileClick: (path: string, additive: boolean) => void;
  onCsvRowClick: (rowIndex: number) => void;
  onCsvRowContextMenu: (e: React.MouseEvent, rowIndex: number, stepName: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, additive: boolean) => void;
  onEditingNameChange: (value: string) => void;
  onEditingNameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onEditingNameBlur: () => void;
}) {
  const isEditing = !node.isDirectory && node.relativePath === editingRelativePath;
  const isActiveFile = !node.isDirectory && node.relativePath === activeRelativePath;
  const isFileSelected = !node.isDirectory && selectedFilePaths.includes(node.relativePath);

  return (
    <li>
      <div
        className={`tree-item${isActiveFile ? " active" : ""}${isFileSelected ? " file-selected" : ""}`}
        onClick={(e) => {
          if (!node.isDirectory) onFileClick(node.relativePath, e.ctrlKey || e.metaKey);
        }}
        onContextMenu={(e) => {
          if (!node.isDirectory) {
            e.preventDefault();
            onContextMenu(e, node.relativePath, e.ctrlKey || e.metaKey);
          }
        }}
      >
        {node.isDirectory ? "[DIR] " : "[FILE] "}
        {isEditing ? (
          <input
            className="rename-input"
            value={editingName}
            autoFocus
            onChange={(e) => onEditingNameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onEditingNameKeyDown}
            onBlur={onEditingNameBlur}
          />
        ) : (
          node.name
        )}
      </div>
      {isActiveFile && activeFileRows.length > 0 && (
        <ul className="tree-children">
          {activeFileRows.map((row) => (
            <li
              key={`${node.relativePath}-row-${row.index}`}
              className={`tree-item csv-line${selectedCsvRowIndex === row.index ? " selected" : ""}${
                isReplaying && replayingCsvRowIndex === row.index ? " replaying" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onCsvRowClick(row.index);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCsvRowContextMenu(e, row.index, row.stepName);
              }}
            >
              {`${row.index + 1}. ${row.stepName}`}
            </li>
          ))}
        </ul>
      )}
      {node.isDirectory && (node.children ?? []).length > 0 && (
        <ul className="tree-children">
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              activeRelativePath={activeRelativePath}
              activeFileRows={activeFileRows}
              selectedCsvRowIndex={selectedCsvRowIndex}
              selectedFilePaths={selectedFilePaths}
              replayingCsvRowIndex={replayingCsvRowIndex}
              isReplaying={isReplaying}
              editingRelativePath={editingRelativePath}
              editingName={editingName}
              onFileClick={onFileClick}
              onCsvRowClick={onCsvRowClick}
              onCsvRowContextMenu={onCsvRowContextMenu}
              onContextMenu={onContextMenu}
              onEditingNameChange={onEditingNameChange}
              onEditingNameKeyDown={onEditingNameKeyDown}
              onEditingNameBlur={onEditingNameBlur}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function App() {
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

    ipcRenderer.on("recording-state", onRecordingState);
    ipcRenderer.on("replaying-state", onReplayingState);
    ipcRenderer.on("replay-repeat-state", onReplayRepeatState);
    ipcRenderer.on("replay-delay-state", onReplayDelayState);
    ipcRenderer.on("replay-row-state", onReplayRowState);
    ipcRenderer.on("output-folder-state", onFolderState);
    ipcRenderer.send("ui-ready");

    return () => {
      ipcRenderer.removeListener("recording-state", onRecordingState);
      ipcRenderer.removeListener("replaying-state", onReplayingState);
      ipcRenderer.removeListener("replay-repeat-state", onReplayRepeatState);
      ipcRenderer.removeListener("replay-delay-state", onReplayDelayState);
      ipcRenderer.removeListener("replay-row-state", onReplayRowState);
      ipcRenderer.removeListener("output-folder-state", onFolderState);
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

  const handleRenameCsvRowStep = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    const nextName = window.prompt("Step name", csvRowContextMenu.stepName);
    hideCsvRowContextMenu();
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed) {
      window.alert("Step name is required.");
      return;
    }
    const result = await ipcRenderer.invoke("rename-active-csv-row-step", {
      rowIndex: csvRowContextMenu.rowIndex,
      stepName: trimmed,
    });
    if (!result?.ok) {
      window.alert(result?.error || "Unable to rename step.");
    }
  }, [csvRowContextMenu, hideCsvRowContextMenu]);

  const handlePlayCsvRow = useCallback(async () => {
    if (csvRowContextMenu === null) return;
    hideCsvRowContextMenu();
    const result = await ipcRenderer.invoke("play-csv-row", csvRowContextMenu.rowIndex);
    if (!result?.ok) {
      window.alert(result?.error || "Unable to play row.");
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
        <aside className="sidebar">
          <div className="sidebar-head">
            <h2 className="sidebar-title">EXPLORER</h2>
            <button
              className="new-file-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleNewFile();
              }}
            >
              New File
            </button>
          </div>
          <ul className="tree">
            {folderState.tree.length === 0 ? (
              <li className="tree-item">No files</li>
            ) : (
              folderState.tree.map((node) => (
                <TreeNode
                  key={node.relativePath}
                  node={node}
                  activeRelativePath={folderState.activeRelativePath}
                  activeFileRows={folderState.activeFileRows}
                  selectedCsvRowIndex={selectedCsvRowIndex}
                  selectedFilePaths={selectedFilePaths}
                  replayingCsvRowIndex={replayingCsvRowIndex}
                  isReplaying={isReplaying}
                  editingRelativePath={editingRelativePath}
                  editingName={editingName}
                  onFileClick={handleFileClick}
                  onCsvRowClick={setSelectedCsvRowIndex}
                  onCsvRowContextMenu={handleCsvRowContextMenu}
                  onContextMenu={handleContextMenu}
                  onEditingNameChange={setEditingName}
                  onEditingNameKeyDown={handleEditingNameKeyDown}
                  onEditingNameBlur={() => void submitRename()}
                />
              ))
            )}
          </ul>
        </aside>
        <main className="main">
          <h1 className="title">Robot Recorder</h1>
          <p className="status">{isReplaying ? "Replaying..." : isRecording ? "Recording..." : "Stopped"}</p>
          <div className="meta">
            <div>
              <strong>File:</strong> <span>{folderState.activeFile || "-"}</span>
            </div>
            <div>
              <strong>Rows:</strong> <span>{folderState.activeFileRows.length}</span>
            </div>
            {selectedCsvRow ? (
              <>
                <div className="edit-groups">
                  <div className="edit-line">
                    <strong>Action</strong>
                    <input value={rowForm.action} onChange={(e) => handleRowFormChange("action", e.target.value)} />
                  </div>
                  <div className="group-separator" />
                  <div className="edit-line">
                    <strong>Coordinates and allowed range</strong>
                    <div className="axis-groups">
                      <div className="axis-row">
                        <span className="axis-row-label">X values</span>
                        <div className="inline-fields inline-fields--three">
                          <label className="field">
                            <span className="field-label">X coordinate</span>
                            <input
                              aria-label="X coordinate"
                              placeholder="e.g. 540"
                              value={rowForm.x}
                              onChange={(e) => handleRowFormChange("x", e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span className="field-label">Minimum X</span>
                            <input
                              aria-label="Minimum X value"
                              placeholder="e.g. 500"
                              value={rowForm.xMin}
                              onChange={(e) => handleRowFormChange("xMin", e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span className="field-label">Maximum X</span>
                            <input
                              aria-label="Maximum X value"
                              placeholder="e.g. 580"
                              value={rowForm.xMax}
                              onChange={(e) => handleRowFormChange("xMax", e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                      <div className="axis-row">
                        <span className="axis-row-label">Y values</span>
                        <div className="inline-fields inline-fields--three">
                          <label className="field">
                            <span className="field-label">Y coordinate</span>
                            <input
                              aria-label="Y coordinate"
                              placeholder="e.g. 320"
                              value={rowForm.y}
                              onChange={(e) => handleRowFormChange("y", e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span className="field-label">Minimum Y</span>
                            <input
                              aria-label="Minimum Y value"
                              placeholder="e.g. 300"
                              value={rowForm.yMin}
                              onChange={(e) => handleRowFormChange("yMin", e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span className="field-label">Maximum Y</span>
                            <input
                              aria-label="Maximum Y value"
                              placeholder="e.g. 340"
                              value={rowForm.yMax}
                              onChange={(e) => handleRowFormChange("yMax", e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="group-separator" />
                  <div className="edit-line">
                    <strong>Elapsed time and allowed range</strong>
                    <div className="inline-fields inline-fields--three">
                      <label className="field">
                        <span className="field-label">Elapsed time (seconds)</span>
                        <input
                          aria-label="Elapsed time in seconds"
                          placeholder="e.g. 0.250"
                          value={rowForm.elapsedSeconds}
                          onChange={(e) => handleRowFormChange("elapsedSeconds", e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Minimum elapsed (seconds)</span>
                        <input
                          aria-label="Minimum elapsed time in seconds"
                          placeholder="Leave empty to disable"
                          value={rowForm.elapsedMin}
                          onChange={(e) => handleRowFormChange("elapsedMin", e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Maximum elapsed (seconds)</span>
                        <input
                          aria-label="Maximum elapsed time in seconds"
                          placeholder="Leave empty to disable"
                          value={rowForm.elapsedMax}
                          onChange={(e) => handleRowFormChange("elapsedMax", e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                  <button type="button" onClick={() => void handleSaveRow()} disabled={isSavingRow}>
                    {isSavingRow ? "Saving..." : "Save Row"}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <strong>Selection:</strong> <span>Click a CSV line in the tree.</span>
              </div>
            )}
          </div>

          <div className="replay-settings">
            <label>
              <input
                type="checkbox"
                checked={isReplayRepeatEnabled}
                onChange={(e) => handleReplayRepeatChange(e.target.checked)}
                disabled={isRecording}
              />
              Repeat replay
            </label>
            <label className="delay-setting">
              <span>Click delay (ms)</span>
              <input
                type="number"
                min={0}
                step={50}
                value={replayClickDelayMs}
                onChange={(e) => handleReplayClickDelayChange(e.target.value)}
                disabled={isRecording}
              />
            </label>
          </div>

          <div className="action-buttons">
            <button
              className={`record-btn${isRecording ? " recording" : ""}`}
              type="button"
              onClick={handleToggleRecording}
              disabled={isReplaying}
            >
              {isRecording ? "Stop Recording (F3)" : "Start Recording (F3)"}
            </button>
            <button
              className="replay-btn"
              type="button"
              onClick={isReplaying ? handleStopReplay : () => void handleReplayCsv()}
              disabled={isRecording}
            >
              {isReplaying ? "Stop Replay (F2)" : "Replay CSV (F2)"}
            </button>
          </div>
        </main>
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
          <div className="context-item" onClick={() => void handleRenameCsvRowStep()}>
            Rename Step
          </div>
          <div className="context-item context-item--danger" onClick={() => void handleDeleteCsvRow()}>
            Delete Row
          </div>
        </div>
      )}
    </>
  );
}
