import React from "react";

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
};

type MarkerColorState = {
  color: "green" | "red" | "none";
  confidence: number;
  point: { x: number; y: number } | null;
};

type FolderState = {
  activeFile: string;
  activeRelativePath: string;
  activeFileRows: CsvRow[];
  tree: ExplorerNode[];
};

type RowFormState = {
  action: string;
  x: string;
  y: string;
  elapsedSeconds: string;
  radius: string;
  elapsedRange: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  elapsedMin: string;
  elapsedMax: string;
};

type ClickerTabsProps = {
  folderState: FolderState;
  selectedFilePaths: string[];
  selectedCsvRowIndexes: number[];
  editingRelativePath: string | null;
  editingName: string;
  editingCsvRowIndex: number | null;
  editingStepName: string;
  selectedCsvRowIndex: number | null;
  replayingCsvRowIndex: number | null;
  isReplaying: boolean;
  isRecording: boolean;
  isReplayRepeatEnabled: boolean;
  replayRepeatCount: number;
  replayClickDelayMs: number;
  cursorPos: {
    x: number;
    y: number;
    runLiteWindow?: { x: number; y: number; width: number; height: number } | null;
  } | null;
  markerColorState: MarkerColorState;
  selectedCsvRow: CsvRow | null;
  rowForm: RowFormState;
  isSavingRow: boolean;
  onNewFile: () => void;
  onFileClick: (path: string, additive: boolean, withRange: boolean) => void;
  onFileContextMenu: (e: React.MouseEvent, path: string, additive: boolean, withRange: boolean) => void;
  onDuplicateSelectedFiles: () => void;
  onDeleteSelectedFiles: () => void;
  onEditingNameChange: (value: string) => void;
  onEditingNameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onEditingNameBlur: () => void;
  onCsvRowContextMenu: (e: React.MouseEvent, rowIndex: number, stepName: string) => void;
  onCsvRowDragStart: (rowIndex: number) => void;
  onCsvRowDragMove: (fromRowIndex: number, targetRowIndex: number, placement: "before" | "after") => void;
  onCsvRowDragEnd: () => void;
  onSelectedCsvRowChange: (rowIndex: number, additive: boolean, withRange: boolean) => void;
  onDuplicateSelectedCsvRows: () => void;
  onDeleteSelectedCsvRows: () => void;
  onEditingStepNameChange: (value: string) => void;
  onEditingStepNameSubmit: () => void;
  onEditingStepNameCancel: () => void;
  onToggleRecording: () => void;
  onReplayCsv: () => void;
  onStopReplay: () => void;
  onTestColorDetection: () => void;
  onReplayRepeatChange: (enabled: boolean) => void;
  onReplayRepeatCountChange: (value: string) => void;
  onReplayClickDelayChange: (value: string) => void;
  onRowFormChange: (field: keyof RowFormState, value: string) => void;
  onSaveRow: () => void;
  onPlaySelectedCsvRow: () => void;
};

function TreeNode({
  node,
  activeRelativePath,
  selectedFilePaths,
  editingRelativePath,
  editingName,
  onFileClick,
  onContextMenu,
  onEditingNameChange,
  onEditingNameKeyDown,
  onEditingNameBlur,
}: {
  node: ExplorerNode;
  activeRelativePath: string | null;
  selectedFilePaths: string[];
  editingRelativePath: string | null;
  editingName: string;
  onFileClick: (path: string, additive: boolean, withRange: boolean) => void;
  onContextMenu: (e: React.MouseEvent, path: string, additive: boolean, withRange: boolean) => void;
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
          onMouseDown={(e) => {
            if (node.isDirectory) return;
            if (e.button !== 0) return;

            onFileClick(node.relativePath, e.ctrlKey || e.metaKey, e.shiftKey);
          }}
          onContextMenu={(e) => {
            if (!node.isDirectory) {
              e.preventDefault();
              onContextMenu(e, node.relativePath, e.ctrlKey || e.metaKey, e.shiftKey);
            }
          }}
      >
        {node.isDirectory ? "[DIR] " : "[FILE] "}
        {isEditing ? (
          <input
            className="rename-input"
            value={editingName}
            ref={(el) => {
              if (el && !el.dataset.initialized) {
                el.dataset.initialized = "1";
                el.focus();
                const dotIndex = editingName.lastIndexOf(".");
                const selEnd = dotIndex > 0 ? dotIndex : editingName.length;
                el.setSelectionRange(0, selEnd);
              }
            }}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onEditingNameKeyDown}
            onBlur={onEditingNameBlur}
          />
        ) : (
          node.name
        )}
      </div>
      {node.isDirectory && (node.children ?? []).length > 0 && (
        <ul className="tree-children">
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              activeRelativePath={activeRelativePath}
              selectedFilePaths={selectedFilePaths}
              editingRelativePath={editingRelativePath}
              editingName={editingName}
              onFileClick={onFileClick}
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

export default function ClickerTabs(props: ClickerTabsProps) {
  const {
    folderState,
    selectedFilePaths,
    selectedCsvRowIndexes,
    editingRelativePath,
    editingName,
    editingCsvRowIndex,
    editingStepName,
    selectedCsvRowIndex,
    replayingCsvRowIndex,
    isReplaying,
    isRecording,
    isReplayRepeatEnabled,
    replayRepeatCount,
    replayClickDelayMs,
    cursorPos,
    markerColorState,
    selectedCsvRow,
    rowForm,
    isSavingRow,
    onNewFile,
    onFileClick,
    onFileContextMenu,
    onDuplicateSelectedFiles,
    onDeleteSelectedFiles,
    onEditingNameChange,
    onEditingNameKeyDown,
    onEditingNameBlur,
  onCsvRowContextMenu,
  onCsvRowDragStart,
  onCsvRowDragMove,
  onCsvRowDragEnd,
  onSelectedCsvRowChange,
    onDuplicateSelectedCsvRows,
    onDeleteSelectedCsvRows,
    onEditingStepNameChange,
    onEditingStepNameSubmit,
    onEditingStepNameCancel,
    onToggleRecording,
    onReplayCsv,
    onStopReplay,
    onTestColorDetection,
    onReplayRepeatChange,
    onReplayRepeatCountChange,
    onReplayClickDelayChange,
    onRowFormChange,
    onSaveRow,
    onPlaySelectedCsvRow,
  } = props;

  return (
    <div className="clicker-layout">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2 className="sidebar-title">EXPLORER</h2>
          <div className="sidebar-actions">
            <button
              className="sidebar-action-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicateSelectedFiles();
              }}
              disabled={selectedFilePaths.length === 0}
            >
              Duplicate
            </button>
            <button
              className="sidebar-action-btn sidebar-action-btn-danger"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSelectedFiles();
              }}
              disabled={selectedFilePaths.length === 0}
            >
              Delete
            </button>
            <button
              className="new-file-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNewFile();
              }}
            >
              New File
            </button>
          </div>
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
                selectedFilePaths={selectedFilePaths}
                editingRelativePath={editingRelativePath}
                editingName={editingName}
                onFileClick={onFileClick}
                onContextMenu={onFileContextMenu}
                onEditingNameChange={onEditingNameChange}
                onEditingNameKeyDown={onEditingNameKeyDown}
                onEditingNameBlur={onEditingNameBlur}
              />
            ))
          )}
        </ul>
      </aside>
      <aside className="sidebar csv-panel">
        <div className="sidebar-head">
          <h2 className="sidebar-title">STEPS</h2>
          <div className="sidebar-actions">
            <button
              className="sidebar-action-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicateSelectedCsvRows();
              }}
              disabled={selectedCsvRowIndexes.length === 0}
            >
              Duplicate
            </button>
            <button
              className="sidebar-action-btn sidebar-action-btn-danger"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSelectedCsvRows();
              }}
              disabled={selectedCsvRowIndexes.length === 0}
            >
              Delete
            </button>
          </div>
        </div>
        <ul className="tree">
          {folderState.activeFileRows.length === 0 ? (
            <li className="tree-item">No steps</li>
          ) : (
            folderState.activeFileRows.map((row) => {
              const isEditingThisRow = editingCsvRowIndex === row.index;
              return (
                <li
                  key={`row-${row.index}`}
                  className={`tree-item csv-line${selectedCsvRowIndexes.includes(row.index) ? " selected" : ""}${
                    isReplaying && replayingCsvRowIndex === row.index ? " replaying" : ""
                  }`}
                  draggable={!isEditingThisRow}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    if (isEditingThisRow) {
                      return;
                    }
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(row.index));
                    onCsvRowDragStart(row.index);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const sourceRowIndex = Number(e.dataTransfer.getData("text/plain"));
                    if (!Number.isInteger(sourceRowIndex)) {
                      return;
                    }

                    const rect = e.currentTarget.getBoundingClientRect();
                    const placement: "before" | "after" =
                      e.clientY > rect.top + rect.height / 2 ? "after" : "before";

                    if (sourceRowIndex !== row.index) {
                      onCsvRowDragMove(sourceRowIndex, row.index, placement);
                    }
                  }}
                  onDragEnd={() => {
                    onCsvRowDragEnd();
                  }}
                  onMouseDown={(e) => {
                    if (isEditingThisRow || e.button !== 0) {
                      return;
                    }

                    onSelectedCsvRowChange(row.index, e.ctrlKey || e.metaKey, e.shiftKey);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onCsvRowContextMenu(e, row.index, row.stepName);
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{`${row.index + 1}. `}</span>
                  {isEditingThisRow ? (
                    <input
                      className="rename-input"
                      value={editingStepName}
                      ref={(el) => {
                        if (el && !el.dataset.initialized) {
                          el.dataset.initialized = "1";
                          el.focus();
                          el.select();
                        }
                      }}
                      onChange={(e) => onEditingStepNameChange(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onEditingStepNameSubmit();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          onEditingStepNameCancel();
                        }
                      }}
                      onBlur={onEditingStepNameSubmit}
                    />
                  ) : (
                    row.stepName
                  )}
                </li>
              );
            })
          )}
        </ul>
      </aside>
      <main className="main">
        <h1 className="title">Robot Recorder</h1>
        <p className="cursor-pos-display">
          Cursor: {cursorPos ? `${cursorPos.x}, ${cursorPos.y}` : "-"}
          {cursorPos?.runLiteWindow && (
            <>
              <br />
              RuneLite: X:{cursorPos.runLiteWindow.x}, Y:{cursorPos.runLiteWindow.y}, W:
              {cursorPos.runLiteWindow.width}, H:{cursorPos.runLiteWindow.height}
            </>
          )}
        </p>
        <p className="status">{isReplaying ? "Replaying..." : isRecording ? "Recording..." : "Stopped"}</p>
        <p className={`status marker-status marker-${markerColorState.color}`}>
          Marker: {markerColorState.color.toUpperCase()}
          {markerColorState.point ? ` at ${markerColorState.point.x}, ${markerColorState.point.y}` : ""}
          {` (confidence ${Math.round(markerColorState.confidence * 100)}%)`}
        </p>
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
                  <strong>
                    Action{selectedCsvRowIndexes.length > 1 ? ` (${selectedCsvRowIndexes.length} selected)` : ""}
                  </strong>
                  <input value={rowForm.action} onChange={(e) => onRowFormChange("action", e.target.value)} />
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
                            onChange={(e) => onRowFormChange("x", e.target.value)}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Minimum X</span>
                          <input
                            aria-label="Minimum X value"
                            placeholder="e.g. 500"
                            value={rowForm.xMin}
                            onChange={(e) => onRowFormChange("xMin", e.target.value)}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Maximum X</span>
                          <input
                            aria-label="Maximum X value"
                            placeholder="e.g. 580"
                            value={rowForm.xMax}
                            onChange={(e) => onRowFormChange("xMax", e.target.value)}
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
                            onChange={(e) => onRowFormChange("y", e.target.value)}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Minimum Y</span>
                          <input
                            aria-label="Minimum Y value"
                            placeholder="e.g. 300"
                            value={rowForm.yMin}
                            onChange={(e) => onRowFormChange("yMin", e.target.value)}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Maximum Y</span>
                          <input
                            aria-label="Maximum Y value"
                            placeholder="e.g. 340"
                            value={rowForm.yMax}
                            onChange={(e) => onRowFormChange("yMax", e.target.value)}
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
                        onChange={(e) => onRowFormChange("elapsedSeconds", e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Minimum elapsed (seconds)</span>
                      <input
                        aria-label="Minimum elapsed time in seconds"
                        placeholder="Leave empty to disable"
                        value={rowForm.elapsedMin}
                        onChange={(e) => onRowFormChange("elapsedMin", e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Maximum elapsed (seconds)</span>
                      <input
                        aria-label="Maximum elapsed time in seconds"
                        placeholder="Leave empty to disable"
                        value={rowForm.elapsedMax}
                        onChange={(e) => onRowFormChange("elapsedMax", e.target.value)}
                      />
                    </label>
                  </div>
                </div>
                <button type="button" onClick={onPlaySelectedCsvRow}>
                  Click
                </button>
                <button type="button" onClick={onSaveRow} disabled={isSavingRow}>
                  {isSavingRow
                    ? "Saving..."
                    : selectedCsvRowIndexes.length > 1
                      ? `Save ${selectedCsvRowIndexes.length} rows`
                      : "Save Row"}
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
              onChange={(e) => onReplayRepeatChange(e.target.checked)}
              disabled={isRecording}
            />
            Repeat replay
          </label>
          <label className="delay-setting">
            <span>Repeat count</span>
            <span className="delay-setting-note">(0 = infinite)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={replayRepeatCount}
              onChange={(e) => onReplayRepeatCountChange(e.target.value)}
              disabled={isRecording}
            />
          </label>
          <label className="delay-setting">
            <span>Click delay (ms)</span>
            <input
              type="number"
              min={0}
              step={50}
              value={replayClickDelayMs}
              onChange={(e) => onReplayClickDelayChange(e.target.value)}
              disabled={isRecording}
            />
          </label>
        </div>

        <div className="action-buttons">
          <button
            className={`record-btn${isRecording ? " recording" : ""}`}
            type="button"
            onClick={onToggleRecording}
            disabled={isReplaying}
          >
            {isRecording ? "Stop Recording (F3)" : "Start Recording (F3)"}
          </button>
          <button className="replay-btn" type="button" onClick={isReplaying ? onStopReplay : onReplayCsv} disabled={isRecording}>
            {isReplaying ? "Stop Replay (F2)" : "Replay CSV (F2)"}
          </button>
          <div className="test-color-btn-row">
            <button className="test-color-btn" type="button" onClick={onTestColorDetection} disabled={isRecording || isReplaying}>
              Test Color Matcher
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
