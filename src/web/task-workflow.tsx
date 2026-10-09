import type { PullRequestRequirementChange } from "./finish-rule-draft";
import { reorderIds } from "./task-summary";
import type { ReportedStatus } from "./status-presentation";
import { useEffect, useState, type ReactNode } from "react";
import {
  FinishRulePanel,
  HumanCheckDialog,
  StepRow,
  TaskActivity,
  orderedSteps,
  type FinishRule,
  type FinishMetadata,
  type RequiredPullRequest,
  type WorkflowActivity,
  type WorkflowStep,
  type WorkflowStepStatus,
} from "./workflow-panel";
import { elapsedLabel, relativeAgeLabel } from "./task-tracking";
import { prPresentation, WorkflowPullRequests } from "./workflow-pr";
import type { GitHubStatusSnapshot } from "../github";
import type { TrackingHandoff } from "./task-tracking";

type Props = {
  openCheck?: boolean;
  onCheckClose?: () => void;
  task: {
    id: string;
    simpleId: string;
    name: string;
    subtasks: WorkflowStep[];
    humanCheckText?: string;
    pullRequestUrl?: string;
  };
  status?: {
    taskState: string;
    taskCompleted: boolean;
    manualHold?: boolean;
    finishRule: FinishRule;
    humanCheckReady: boolean;
    humanCheckText?: string;
    taskRevision?: number;
    workflowEpoch?: number;
    latestTaskReport?: {
      id: string;
      reporter: string;
      summary?: string;
      reason?: string;
      createdAt: Date | string;
      reportedState: string;
      testedRevision?: string;
    };
    finishMetadata?: FinishMetadata;
    requiredPullRequests: RequiredPullRequest[];
    subtasks: WorkflowStepStatus[];
  };
  disabled: boolean;
  operator?: string;
  githubStatuses: Record<string, GitHubStatusSnapshot | undefined>;
  needs?: Array<{
    id: string;
    kind: string;
    label: string;
    detail?: string;
    taskId?: string;
    ageLabel: string;
    threadId?: string;
    sourceId?: string;
    subtaskId?: string;
  }>;
  onOpenNeed: (item: NonNullable<Props["needs"]>[number]) => void;
  onSaveRule: (
    rule: FinishRule,
    humanCheckText: string | undefined,
    pullRequestRequirements: PullRequestRequirementChange[],
    expectedRevision: number,
    expectedWorkflowEpoch: number,
  ) => Promise<unknown>;
  onCheck: (note?: string) => Promise<unknown>;
  onSendBack: (reason: string) => Promise<unknown>;
  onStep: (
    id: string,
    state: ReportedStatus,
    note?: string,
    reason?: string,
    handoff?: TrackingHandoff,
  ) => Promise<unknown>;
  onAdd: (name: string) => Promise<unknown>;
  onEditStep: (
    step: WorkflowStep,
    patch: { name: string; description?: string; evidence?: string },
  ) => Promise<unknown>;
  onSkipStep: (id: string) => Promise<unknown>;
  onRemoveStep: (id: string) => Promise<unknown>;
  onReorder: (ids: string[]) => Promise<unknown>;
  onHistory: (cursor?: string) => Promise<{
    items: WorkflowActivity[];
    totalCount: number;
    nextCursor?: string;
  }>;
  onStepHistory?: (id: string) => Promise<WorkflowActivity[]>;
  stepEvidence?: (step: WorkflowStep) => ReactNode;
  onLink: (url: string, expectedRevision: number) => Promise<unknown>;
  onRefresh: () => void;
  children: ReactNode;
};

export function TaskWorkflow(props: Props) {
  const { task, status, disabled } = props;
  const [check, setCheck] = useState(false),
    [name, setName] = useState(""),
    [addError, setAddError] = useState(""),
    [items, setItems] = useState<WorkflowActivity[]>([]),
    [historyError, setHistoryError] = useState(""),
    [actionError, setActionError] = useState(""),
    [cursor, setCursor] = useState<string | undefined>(),
    [totalCount, setTotalCount] = useState(0),
    [historyLoading, setHistoryLoading] = useState(false);
  const [ruleEditRequest, setRuleEditRequest] = useState<{
    id: number;
    pullRequestUrl?: string;
    action?: "edit" | "link";
  }>();
  useEffect(() => {
    if (props.openCheck && status?.humanCheckReady) setCheck(true);
  }, [props.openCheck, status?.humanCheckReady]);
  useEffect(() => {
    let active = true;
    void props
      .onHistory()
      .then((rows) => {
        if (active) {
          setItems(rows.items);
          setCursor(rows.nextCursor);
          setTotalCount(rows.totalCount);
          setHistoryError("");
        }
      })
      .catch((err) => {
        if (active)
          setHistoryError(
            err instanceof Error ? err.message : "Activity unavailable",
          );
      });
    return () => {
      active = false;
    };
  }, [task.id, status]);
  const steps = orderedSteps(task.subtasks);
  const done = steps.filter(
    (step) =>
      step.archiveState !== "wont_do" &&
      (status?.subtasks.find((s) => s.subtaskId === step.id)?.reportedState ===
        "complete" ||
        step.archiveState === "released"),
  );
  const skipped = steps.filter((step) => step.archiveState === "wont_do");
  const left = steps.filter(
    (step) => step.archiveState !== "wont_do" && !done.includes(step),
  );
  const finished = status?.taskCompleted || status?.taskState === "completed";
  const normal = finished
    ? done
    : steps.filter((step) => step.archiveState !== "wont_do");
  const runAction = async (action: () => Promise<unknown>) => {
    setActionError("");
    try {
      await action();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Couldn't update the step. Try again.",
      );
    }
  };
  const checkNeed = props.needs?.find((item) => item.kind === "check");
  const requiredMerge = status?.requiredPullRequests
    .filter((row) => row.required && row.merge)
    .map((row) => row.merge!)
    .sort(
      (a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime(),
    )[0];
  const finishActor =
    status?.latestTaskReport?.reporter ||
    (requiredMerge
      ? "GitHub"
      : status?.finishMetadata?.actor || "Actor not recorded");
  const checkAge = checkNeed?.ageLabel
    ? relativeAgeLabel(checkNeed.ageLabel)
    : elapsedLabel(
        status?.latestTaskReport?.createdAt ?? requiredMerge?.mergedAt,
      );
  const renderStep = (step: WorkflowStep) => (
    <StepRow
      key={step.id}
      step={step}
      status={status?.subtasks.find((row) => row.subtaskId === step.id)}
      operator={props.operator}
      disabled={disabled || Boolean(step.archiveState)}
      reorderDisabled={finished}
      onMoveBefore={(id, beforeId) =>
        void runAction(() =>
          props.onReorder(
            reorderIds(
              steps.map((row) => row.id),
              id,
              beforeId,
            ),
          ),
        )
      }
      onReorder={(direction) => {
        const index = steps.indexOf(step);
        const destination = direction === "up" ? index - 1 : index + 1;
        if (destination < 0 || destination >= steps.length) return;
        const next = [...steps];
        next.splice(index, 1);
        next.splice(destination, 0, step);
        void runAction(() => props.onReorder(next.map((row) => row.id)));
      }}
      onChange={(state, note, reason, handoff) =>
        props.onStep(step.id, state, note, reason, handoff)
      }
      detail={
        <>
          <StepHistory id={step.id} onLoad={props.onStepHistory} />
          <StepEdit
            step={step}
            disabled={disabled || finished}
            onSave={(patch) => props.onEditStep(step, patch)}
          />
          {props.stepEvidence?.(step)}
          <button
            type="button"
            className="workflow-text-button"
            disabled={disabled || finished || Boolean(step.archiveState)}
            onClick={() => void runAction(() => props.onSkipStep(step.id))}
          >
            Skip step
          </button>
          <button
            type="button"
            className="workflow-text-button"
            disabled={disabled || finished}
            onClick={() => {
              if (
                window.confirm(
                  `Delete “${step.name}” and its history? Skip keeps the history.`,
                )
              )
                void runAction(() => props.onRemoveStep(step.id));
            }}
          >
            Delete
          </button>
        </>
      }
    />
  );
  return (
    <div className="task-workflow">
      {props.needs?.length || status?.humanCheckReady ? (
        <section
          className="workflow-needs"
          aria-label={`Needs you for ${task.simpleId}`}
        >
          <p className="eyebrow">Needs you</p>
          <ol className="workflow-needs-list">
            {props.needs
              ?.filter((item) => item.kind !== "check")
              .map((item) => {
                const row = status?.requiredPullRequests.find((row) =>
                  item.id.endsWith(row.pullRequestUrl),
                );
                const snapshot =
                  row &&
                  (props.githubStatuses[row.pullRequestUrl] ??
                    row.sources
                      .map(
                        (source) =>
                          props.githubStatuses[
                            `${source.kind === "step" ? "subtask" : "task"}:${source.id}`
                          ],
                      )
                      .find(Boolean));
                const presentation =
                  row &&
                  prPresentation(
                    row,
                    snapshot,
                    status?.latestTaskReport?.testedRevision,
                  );
                const actionLabel = item.threadId
                  ? "Open thread details"
                  : item.kind === "review"
                    ? "Open PR ↗"
                    : item.kind === "unblock"
                      ? "Go to blocker"
                      : item.id.startsWith("decide:github:")
                        ? "Open Connections"
                        : "Open";
                return (
                  <li className="workflow-needs-item" key={item.id}>
                    <span className={`workflow-verb ${item.kind}`}>
                      {item.kind.toUpperCase()}
                    </span>
                    <div className="workflow-needs-copy">
                      {item.label}
                      <small>
                        {item.detail}
                        {item.kind === "review" &&
                        status?.latestTaskReport?.reporter
                          ? ` · ${status.latestTaskReport.reporter} · Task report`
                          : ""}{" "}
                        · {relativeAgeLabel(item.ageLabel)}
                        {item.threadId && " · Respond in T3"}
                      </small>
                      {item.kind === "review" && presentation?.changedHead && (
                        <small className="workflow-warning">
                          New commits since{" "}
                          {status?.latestTaskReport?.reporter || "the agent"}{" "}
                          reported ready (
                          {status?.latestTaskReport?.testedRevision?.slice(
                            0,
                            7,
                          )}{" "}
                          → {snapshot?.pullRequest?.headSha.slice(0, 7)}).
                          Evidence is not confirmed on this head.
                        </small>
                      )}
                      {item.kind === "decide" &&
                        item.id.startsWith("decide:no-pr:") && (
                          <div className="workflow-need-actions">
                            <button
                              type="button"
                              disabled={disabled}
                              className="workflow-text-button"
                              onClick={() =>
                                setRuleEditRequest({
                                  id: Date.now(),
                                  action: "link",
                                })
                              }
                            >
                              Link a PR
                            </button>
                            <button
                              type="button"
                              disabled={disabled}
                              className="workflow-text-button"
                              onClick={() =>
                                setRuleEditRequest({
                                  id: Date.now(),
                                  action: "edit",
                                })
                              }
                            >
                              Change finish rule
                            </button>
                          </div>
                        )}
                      {item.kind === "decide" && row && (
                        <div className="workflow-need-actions">
                          <a
                            aria-label={`Open PR ↗: ${item.kind} ${item.label}, ${task.simpleId}, ${relativeAgeLabel(item.ageLabel)}`}
                            href={row.pullRequestUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open PR ↗
                          </a>
                          {row.pullRequestUrl === task.pullRequestUrl &&
                            row.sources.some(
                              (source) =>
                                source.kind === "task" && source.id === task.id,
                            ) && (
                              <button
                                type="button"
                                disabled={disabled}
                                className="workflow-text-button"
                                aria-label={`Link a replacement PR: ${item.label}, ${task.simpleId}, ${relativeAgeLabel(item.ageLabel)}`}
                                onClick={() =>
                                  setRuleEditRequest({
                                    id: Date.now(),
                                    action: "link",
                                  })
                                }
                              >
                                Link a replacement PR
                              </button>
                            )}
                          <button
                            type="button"
                            disabled={disabled}
                            className="workflow-text-button"
                            aria-label={`Mark not required: ${item.label}, ${task.simpleId}, ${relativeAgeLabel(item.ageLabel)}`}
                            onClick={() =>
                              setRuleEditRequest({
                                id: Date.now(),
                                pullRequestUrl: row.pullRequestUrl,
                              })
                            }
                          >
                            Mark not required
                          </button>
                          <button
                            type="button"
                            disabled={disabled}
                            className="workflow-text-button"
                            aria-label={`Change finish rule: ${item.label}, ${task.simpleId}, ${relativeAgeLabel(item.ageLabel)}`}
                            onClick={() =>
                              setRuleEditRequest({
                                id: Date.now(),
                                action: "edit",
                              })
                            }
                          >
                            Change finish rule
                          </button>
                        </div>
                      )}
                    </div>
                    {!(
                      item.kind === "decide" &&
                      (row || item.id.startsWith("decide:no-pr:"))
                    ) && (
                      <button
                        type="button"
                        className="workflow-text-button"
                        aria-label={`${actionLabel}: ${item.kind} ${item.label}, ${task.simpleId} ${task.name}, ${relativeAgeLabel(item.ageLabel)}`}
                        onClick={() => props.onOpenNeed(item)}
                      >
                        {actionLabel}
                      </button>
                    )}
                  </li>
                );
              })}
            {status?.humanCheckReady && (
              <li className="workflow-needs-item">
                <span className="workflow-verb">CHECK</span>
                <div className="workflow-needs-copy">
                  {status.humanCheckText ||
                    task.humanCheckText ||
                    "Check this task"}
                  <small>
                    Finished by {finishActor} · {checkAge} ·{" "}
                    {status.latestTaskReport ? "Task report" : "Merge proof"}
                  </small>
                </div>
                <button
                  type="button"
                  className="workflow-text-button"
                  disabled={disabled}
                  aria-label={`Check…: ${status.humanCheckText || task.humanCheckText || "Check this task"}, ${task.simpleId} ${task.name}, ${checkAge}`}
                  onClick={() => setCheck(true)}
                >
                  Check…
                </button>
              </li>
            )}
          </ol>
        </section>
      ) : null}
      {status?.finishRule ? (
        <FinishRulePanel
          rule={status.finishRule}
          rows={status.requiredPullRequests}
          snapshotRevision={status.taskRevision}
          workflowEpoch={status.workflowEpoch}
          disabled={disabled || finished}
          finished={finished}
          checked={status.finishMetadata?.kind === "human_check"}
          agentFinished={status.latestTaskReport?.reportedState === "finished"}
          held={status.manualHold === true}
          onSave={props.onSaveRule}
          humanCheckText={status.humanCheckText ?? task.humanCheckText}
          editRequest={ruleEditRequest}
        >
          {(rows, onDraftRequired, saving, linkRequest) => (
            <div id={`workflow-prs-${task.id}`}>
              <WorkflowPullRequests
                rows={rows}
                statuses={props.githubStatuses}
                testedRevision={status.latestTaskReport?.testedRevision}
                disabled={disabled || finished || Boolean(saving)}
                onDraftRequired={onDraftRequired}
                linkRequest={linkRequest}
                taskPullRequestUrl={task.pullRequestUrl}
                taskPullRequestRequired={
                  status.requiredPullRequests
                    .find((row) => row.pullRequestUrl === task.pullRequestUrl)
                    ?.sources.find(
                      (source) =>
                        source.kind === "task" && source.id === task.id,
                    )?.required
                }
                snapshotRevision={status.taskRevision}
                onLink={props.onLink}
                onRefresh={props.onRefresh}
              />
            </div>
          )}
        </FinishRulePanel>
      ) : (
        <p className="workflow-muted">
          Finish rule unavailable. Refresh Factory before changing this task.
        </p>
      )}
      <section className="workflow-section">
        <div className="workflow-section-heading">
          <p className="eyebrow">Steps</p>
          <span className="workflow-muted">
            {steps.length
              ? `${done.length} of ${steps.filter((step) => step.archiveState !== "wont_do").length} done`
              : "No steps"}
          </span>
        </div>
        {steps.length ? (
          normal.map(renderStep)
        ) : (
          <p className="workflow-muted">
            No steps. This task can report and finish without a checklist.
          </p>
        )}
        {skipped.length > 0 && (
          <details className="workflow-skipped">
            <summary>
              Skipped steps ({skipped.length}) · kept in history
            </summary>
            {skipped.map(renderStep)}
          </details>
        )}
        {finished && left.length > 0 && (
          <details className="workflow-left-open">
            <summary>Left open when the task finished ({left.length})</summary>
            <p>
              These steps keep their recorded state and do not reopen the task.
            </p>
            {left.map(renderStep)}
          </details>
        )}
        {!finished &&
          !["released", "wont_do"].includes(status?.taskState ?? "") && (
            <form
              className="workflow-add-step"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                setAddError("");
                void props
                  .onAdd(name.trim())
                  .then(() => setName(""))
                  .catch((err) =>
                    setAddError(
                      err instanceof Error
                        ? err.message
                        : "Couldn't add the step.",
                    ),
                  );
              }}
            >
              <input
                aria-label={`New step for ${task.name}`}
                placeholder="+ Add a step"
                disabled={disabled}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setName("");
                }}
              />
              <button type="submit" disabled={disabled || !name.trim()}>
                Add step
              </button>
            </form>
          )}
        {addError && (
          <p role="alert" className="workflow-error">
            {addError}
          </p>
        )}
      </section>
      {actionError && (
        <p role="alert" className="workflow-error">
          {actionError}
        </p>
      )}
      <TaskActivity
        items={items}
        totalCount={totalCount}
        loading={historyLoading}
        onLoadMore={
          cursor
            ? () => {
                setHistoryLoading(true);
                void props
                  .onHistory(cursor)
                  .then((page) => {
                    setItems((current) => [
                      ...current,
                      ...page.items.filter(
                        (item) => !current.some((row) => row.id === item.id),
                      ),
                    ]);
                    setCursor(page.nextCursor);
                    setTotalCount(page.totalCount);
                  })
                  .catch((err) =>
                    setHistoryError(
                      err instanceof Error
                        ? err.message
                        : "Couldn't load activity.",
                    ),
                  )
                  .finally(() => setHistoryLoading(false));
              }
            : undefined
        }
      />
      {historyError && (
        <p role="alert" className="workflow-error">
          {historyError}
        </p>
      )}
      <details className="workflow-evidence">
        <summary>
          ▸ Evidence · sessions, handoffs, PR packet, screenshots
        </summary>
        {props.children}
      </details>
      {check && (
        <HumanCheckDialog
          title={`${task.simpleId} · ${task.name}`}
          checkText={status?.humanCheckText ?? task.humanCheckText}
          onClose={() => {
            setCheck(false);
            props.onCheckClose?.();
          }}
          onCheck={props.onCheck}
          onSendBack={props.onSendBack}
          returnFocus={() => {
            const heading = document.querySelector<HTMLElement>(
              `#floor-task-${task.id} .row-toggle`,
            );
            heading?.focus();
          }}
          evidence={
            <div className="workflow-check-evidence">
              <p>
                Finished by {finishActor} · {checkAge} · rule:{" "}
                {status?.finishRule.kind === "pr_merge"
                  ? "required PRs reach the default branch"
                  : "agent finishes"}
                {status?.finishRule.requireHumanCheck ? " + your check" : ""}.
              </p>
              {(status?.latestTaskReport?.summary ||
                status?.latestTaskReport?.reason) && (
                <section>
                  <p className="eyebrow">Agent’s finish report</p>
                  <blockquote>
                    {status.latestTaskReport.summary ||
                      status.latestTaskReport.reason}
                  </blockquote>
                </section>
              )}
              {status?.requiredPullRequests
                .filter((row) => row.required)
                .map((row) => (
                  <p key={row.pullRequestUrl}>
                    {row.merge ? (
                      <>
                        <a
                          href={row.pullRequestUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PR #{row.pullRequestUrl.split("/").pop()} ↗
                        </a>{" "}
                        · {row.merge.mergeSha.slice(0, 7)} reached{" "}
                        {row.merge.defaultBranch}
                      </>
                    ) : (
                      "Merge proof unavailable"
                    )}
                  </p>
                ))}
              <p>
                <span
                  role="img"
                  className="workflow-check-slot"
                  aria-label="Awaiting your check"
                >
                  □
                </span>{" "}
                Your check
              </p>
              <p className="workflow-muted">
                Other finish conditions are met. Deployment remains separate.
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}
function StepEdit({
  step,
  disabled,
  onSave,
}: {
  step: WorkflowStep;
  disabled: boolean;
  onSave: (patch: {
    name: string;
    description?: string;
    evidence?: string;
  }) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(step.name),
    [description, setDescription] = useState(step.description ?? ""),
    [evidence, setEvidence] = useState(step.evidence ?? ""),
    [error, setError] = useState("");
  return (
    <>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            void onSave({ name: name.trim(), description, evidence })
              .then(() => setEditing(false))
              .catch((err) =>
                setError(
                  err instanceof Error ? err.message : "Couldn't save step.",
                ),
              );
          }}
        >
          <label>
            Step title
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            Evidence
            <textarea
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={disabled || !name.trim()}>
            Save step
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="workflow-text-button"
          disabled={disabled}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      )}
    </>
  );
}

function StepHistory({
  id,
  onLoad,
}: {
  id: string;
  onLoad?: Props["onStepHistory"];
}) {
  const [items, setItems] = useState<WorkflowActivity[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (onLoad)
      void onLoad(id)
        .then((rows) => {
          if (active) setItems(rows);
        })
        .catch((err) => {
          if (active)
            setError(
              err instanceof Error
                ? err.message
                : "Couldn't load Step history.",
            );
        });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <>
      <TaskActivity items={items} title="Step history" />
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
    </>
  );
}
