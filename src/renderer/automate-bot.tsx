import React, { useEffect, useMemo, useRef } from "react";
import type {
  GuardianOfTheRiftActiveElement,
  GuardianOfTheRiftConfig,
  GuardianOfTheRiftPouch,
} from "../main/automate-bots/guardian-of-the-rift-config";
import { GUARDIAN_OF_THE_RIFT_POUCHES } from "../main/automate-bots/guardian-of-the-rift-config";

type TaskNode = {
  id: string;
  name: string;
  children?: TaskNode[];
};

type AutomateBotProps = {
  taskTree: TaskNode[];
  selectableTaskIds: Set<string>;
  expandedTaskNodeIds: Set<string>;
  selectedTaskNodeId: string | null;
  isSelectedTaskRunning: boolean;
  currentStepId: string | null;
  logLines: string[];
  showGuardianOfTheRiftConfig: boolean;
  guardianOfTheRiftElements: readonly GuardianOfTheRiftActiveElement[];
  guardianOfTheRiftConfig: GuardianOfTheRiftConfig;
  onToggleTaskNodeExpand: (id: string) => void;
  onSelectTaskNode: (id: string) => void;
  onToggleSelectedTaskRun: (taskNodeId?: string) => void;
  onStepContextMenu: (e: React.MouseEvent, stepId: string, stepName: string) => void;
  onGuardianOfTheRiftElementEnabledChange: (element: GuardianOfTheRiftActiveElement, enabled: boolean) => void;
  onGuardianOfTheRiftUseAgilityCourseChange: (enabled: boolean) => void;
  onGuardianOfTheRiftPouchChange: (pouch: GuardianOfTheRiftPouch, enabled: boolean) => void;
};

function formatGuardianElementLabel(value: GuardianOfTheRiftActiveElement): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatGuardianPouchLabel(value: GuardianOfTheRiftPouch): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TaskNodeComponent({
  node,
  selectableTaskIds,
  expandedNodeIds,
  selectedNodeId,
  isSelectedTaskRunning,
  activeStepId,
  onToggleExpand,
  onSelectNode,
  onToggleSelectedTaskRun,
  onStepContextMenu,
}: {
  node: TaskNode;
  selectableTaskIds: Set<string>;
  expandedNodeIds: Set<string>;
  selectedNodeId: string | null;
  isSelectedTaskRunning: boolean;
  activeStepId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (id: string) => void;
  onToggleSelectedTaskRun: (taskNodeId?: string) => void;
  onStepContextMenu: (e: React.MouseEvent, stepId: string, stepName: string) => void;
}) {
  const isExpanded = expandedNodeIds.has(node.id);
  const hasChildren = (node.children ?? []).length > 0;
  const isSelectableTask = selectableTaskIds.has(node.id);
  const isSelected = isSelectableTask && selectedNodeId === node.id;
  const isActiveStep = node.id === activeStepId;
  const isStep = !hasChildren && node.id.includes("-step-");

  return (
    <li>
      <div
        className={`tree-item task-item${isSelected ? " selected" : ""}${isActiveStep ? " active-step" : ""}`}
        onClick={() => {
          if (isSelectableTask) {
            onSelectNode(node.id);
          }
        }}
        onContextMenu={(e) => {
          if (isStep) {
            e.preventDefault();
            e.stopPropagation();
            onStepContextMenu(e, node.id, node.name);
          }
        }}
      >
        {hasChildren && (
          <span
            className={`expand-icon${isExpanded ? " expanded" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
          >
            ▶
          </span>
        )}
        {!hasChildren && <span className="expand-icon placeholder" />}
        <span className="task-name">{node.name}</span>
        {isSelectableTask && (
          <button
            type="button"
            className={`task-play-btn${isSelectedTaskRunning && isSelected ? " running" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelectedTaskRun(node.id);
            }}
          >
            {isSelectedTaskRunning && isSelected ? "Stop" : "Play"}
          </button>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul className="tree-children">
          {(node.children ?? []).map((child) => (
            <TaskNodeComponent
              key={child.id}
              node={child}
              selectableTaskIds={selectableTaskIds}
              expandedNodeIds={expandedNodeIds}
              selectedNodeId={selectedNodeId}
              isSelectedTaskRunning={isSelectedTaskRunning}
              activeStepId={activeStepId}
              onToggleExpand={onToggleExpand}
              onSelectNode={onSelectNode}
              onToggleSelectedTaskRun={onToggleSelectedTaskRun}
              onStepContextMenu={onStepContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function AutomateBot(props: AutomateBotProps) {
  const {
    taskTree,
    selectableTaskIds,
    expandedTaskNodeIds,
    selectedTaskNodeId,
    isSelectedTaskRunning,
    currentStepId,
    logLines,
    showGuardianOfTheRiftConfig,
    guardianOfTheRiftElements,
    guardianOfTheRiftConfig,
    onToggleTaskNodeExpand,
    onSelectTaskNode,
    onToggleSelectedTaskRun,
    onStepContextMenu,
    onGuardianOfTheRiftElementEnabledChange,
    onGuardianOfTheRiftUseAgilityCourseChange,
    onGuardianOfTheRiftPouchChange,
  } = props;

  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const visibleLogLines = useMemo(() => logLines.slice(-500), [logLines]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [visibleLogLines]);

  return (
    <div className="automatebot-view">
      <aside className="sidebar automatebot-sidebar">
        <div className="sidebar-head">
          <h2 className="sidebar-title">TASKS</h2>
        </div>
        <ul className="tree">
          {taskTree.length === 0 ? (
            <li className="tree-item">No tasks</li>
          ) : (
            taskTree.map((node) => (
              <TaskNodeComponent
                key={node.id}
                node={node}
                selectableTaskIds={selectableTaskIds}
                expandedNodeIds={expandedTaskNodeIds}
                selectedNodeId={selectedTaskNodeId}
                isSelectedTaskRunning={isSelectedTaskRunning}
                activeStepId={currentStepId}
                onToggleExpand={onToggleTaskNodeExpand}
                onSelectNode={onSelectTaskNode}
                onToggleSelectedTaskRun={onToggleSelectedTaskRun}
                onStepContextMenu={onStepContextMenu}
              />
            ))
          )}
        </ul>
        {showGuardianOfTheRiftConfig && (
          <div className="automatebot-config-panel">
            <h3 className="automatebot-config-title">Guardian of the Rift</h3>
            <label className="automatebot-toggle-row">
              <span className="automatebot-toggle-label">Use agility course</span>
              <input
                type="checkbox"
                checked={guardianOfTheRiftConfig.useAgilityCourse}
                onChange={(e) => onGuardianOfTheRiftUseAgilityCourseChange(e.target.checked)}
              />
              <span className="automatebot-toggle-value">
                {guardianOfTheRiftConfig.useAgilityCourse ? "Yes" : "No"}
              </span>
            </label>
            <p className="automatebot-config-subtitle">Pouches</p>
            <div className="automatebot-element-grid">
              {GUARDIAN_OF_THE_RIFT_POUCHES.map((pouch) => {
                const isAbyssalSelected = guardianOfTheRiftConfig.pouches.abyssal;
                const isChecked = guardianOfTheRiftConfig.pouches[pouch];
                const isDisabled = pouch !== "abyssal" && isAbyssalSelected;

                return (
                  <label
                    key={pouch}
                    className={`automatebot-toggle-row automatebot-toggle-row-small${isDisabled ? " automatebot-toggle-row-disabled" : ""}`}
                  >
                    <span className="automatebot-toggle-label">{formatGuardianPouchLabel(pouch)}</span>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={(e) => onGuardianOfTheRiftPouchChange(pouch, e.target.checked)}
                    />
                    <span className="automatebot-toggle-value">{isChecked ? "Yes" : "No"}</span>
                  </label>
                );
              })}
            </div>
            <p className="automatebot-config-subtitle">Active guardian elements (12)</p>
            <div className="automatebot-element-grid">
              {guardianOfTheRiftElements.map((element) => {
                const enabled = guardianOfTheRiftConfig.activeGuardianElements[element];

                return (
                  <label key={element} className="automatebot-toggle-row automatebot-toggle-row-small">
                    <span className="automatebot-toggle-label">{formatGuardianElementLabel(element)}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => onGuardianOfTheRiftElementEnabledChange(element, e.target.checked)}
                    />
                    <span className="automatebot-toggle-value">{enabled ? "Yes" : "No"}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      <aside className="automatebot-log-panel">
        <div className="automatebot-log-head">
          <h2 className="sidebar-title">LOGS</h2>
          <span className="automatebot-log-count">{visibleLogLines.length}</span>
        </div>
        <div className="automatebot-log-list" ref={logContainerRef}>
          {visibleLogLines.length === 0 ? (
            <p className="automatebot-log-empty">No logs yet.</p>
          ) : (
            visibleLogLines.map((line, index) => (
              <p key={`${index}-${line}`} className="automatebot-log-line">
                {line}
              </p>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
