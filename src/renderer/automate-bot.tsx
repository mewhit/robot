import React, { useEffect, useMemo, useRef } from "react";

type TaskNode = {
  id: string;
  name: string;
  children?: TaskNode[];
};

type AutomateBotProps = {
  taskTree: TaskNode[];
  expandedTaskNodeIds: Set<string>;
  selectedTaskNodeId: string | null;
  isSelectedTaskRunning: boolean;
  currentStepId: string | null;
  logLines: string[];
  onToggleTaskNodeExpand: (id: string) => void;
  onSelectTaskNode: (id: string) => void;
  onToggleSelectedTaskRun: () => void;
  onStepContextMenu: (e: React.MouseEvent, stepId: string, stepName: string) => void;
};

function TaskNodeComponent({
  node,
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
  expandedNodeIds: Set<string>;
  selectedNodeId: string | null;
  isSelectedTaskRunning: boolean;
  activeStepId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (id: string) => void;
  onToggleSelectedTaskRun: () => void;
  onStepContextMenu: (e: React.MouseEvent, stepId: string, stepName: string) => void;
}) {
  const isExpanded = expandedNodeIds.has(node.id);
  const hasChildren = (node.children ?? []).length > 0;
  const isSelectableTask = node.id === "agility";
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
              onSelectNode(node.id);
              onToggleSelectedTaskRun();
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
    expandedTaskNodeIds,
    selectedTaskNodeId,
    isSelectedTaskRunning,
    currentStepId,
    logLines,
    onToggleTaskNodeExpand,
    onSelectTaskNode,
    onToggleSelectedTaskRun,
    onStepContextMenu,
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
