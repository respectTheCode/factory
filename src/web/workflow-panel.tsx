import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ReportedStatus } from "./status-presentation";
import { elapsedLabel, type TrackingHandoff } from "./task-tracking";
import {
  createFinishRuleDraft,
  draftPullRequests,
  finishRuleConsequence,
  finishRuleRequirementChanges,
  type PullRequestRequirementChange,
} from "./finish-rule-draft";
import { focusFinishRuleEditor } from "./workflow-focus";
import "./workflow.css";

export type FinishRule = import("../application").TaskFinishRule;
type Wire<T> = T extends Date
  ? Date | string
  : T extends Array<infer U>
    ? Array<Wire<U>>
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export type FinishMetadata = Wire<import("../application").TaskFinishMetadata>;
export type WorkflowStep = {
  id: string;
  simpleId: string;
  name: string;
  description?: string;
  evidence?: string;
  sortOrder?: number;
  archiveState?: "released" | "wont_do";
  pullRequestUrl?: string;
};
export type WorkflowStepStatus = {
  subtaskId: string;
  reportedState?: ReportedStatus;
  reason?: string;
  reporter?: string;
  reportCreatedAt?: Date | string;
  handoff?: TrackingHandoff;
};
export type WorkflowActivity = {
  id: string;
  actor: string;
  text: string;
  at: Date | string;
  earlierReview?: boolean;
  subtaskId?: string;
};

export function finishProvenance(metadata?: FinishMetadata): string {
  if (!metadata) return "Done · completion proof unavailable";
  if (metadata.kind === "pr_merge")
    return `Done · ${metadata.mergeProofs?.map((proof) => `PR #${proof.pullRequestUrl.split("/").pop()} merged to ${proof.defaultBranch} · ${proof.mergeSha.slice(0, 7)} · merged ${new Date(proof.mergedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`).join(" · ") || "merge proof unavailable"}`;
  if (metadata.kind === "human_check")
    return `Done · ${metadata.actor} checked it${metadata.reason ? `: ${metadata.reason}` : ""}`;
  if (metadata.kind === "human_mark_done")
    return `Done · ${metadata.actor} marked it done: ${metadata.reason ?? "reason unavailable"}`;
  if (metadata.kind === "legacy_completion")
    return `Done · earlier completion recorded${metadata.reason ? `: ${metadata.reason}` : ""}`;
  return `Done · ${metadata.actor} finished it`;
}

export function stepPresentation(state?: ReportedStatus) {
  return state === "complete"
    ? { code: "DONE", label: "Done", tone: "done" }
    : state === "in_progress"
      ? { code: "DOING", label: "Doing", tone: "doing" }
      : state === "blocked"
        ? { code: "BLOCKED", label: "Blocked", tone: "blocked" }
        : { code: "TODO", label: "To do", tone: "todo" };
}

export function orderedSteps(steps: WorkflowStep[]) {
  return steps
    .map((step, index) => ({ step, index }))
    .sort(
      (a, b) => (a.step.sortOrder ?? a.index) - (b.step.sortOrder ?? b.index),
    )
    .map(({ step }) => step);
}

export function StepDial({
  state,
  skipped,
}: {
  state?: ReportedStatus;
  skipped?: boolean;
}) {
  const { tone } = stepPresentation(state);
  return (
    <svg
      className={`step-dial ${tone}`}
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
    >
      {skipped ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke="var(--ink-dim)"
            strokeWidth="1.4"
          />
          <path d="m4.5 11.5 7-7" stroke="var(--ink-dim)" strokeWidth="1.4" />
        </>
      ) : tone === "done" ? (
        <>
          <circle cx="8" cy="8" r="6" fill="currentColor" />
          <path d="m5 8 2 2 4-4" stroke="var(--canvas)" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray={tone === "todo" ? "2 2" : undefined}
          />
          {tone === "doing" && (
            <path d="M8 8V3.5A4.5 4.5 0 0 1 12.5 8Z" fill="currentColor" />
          )}
          {tone === "blocked" && (
            <path d="M4.5 8h7" stroke="currentColor" strokeWidth="1.7" />
          )}
        </>
      )}
    </svg>
  );
}

export function StepRow({
  step,
  status,
  disabled,
  operator,
  onChange,
  detail,
  onOpenDetail,
  onReorder,
  onMoveBefore,
  reorderDisabled,
}: {
  step: WorkflowStep;
  status?: WorkflowStepStatus;
  disabled: boolean;
  operator?: string;
  onChange: (
    state: ReportedStatus,
    note?: string,
    reason?: string,
    handoff?: TrackingHandoff,
  ) => Promise<unknown>;
  detail?: ReactNode;
  onOpenDetail?: () => void;
  onReorder?: (direction: "up" | "down") => void;
  onMoveBefore?: (id: string, beforeId?: string) => void;
  reorderDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [expanded, setExpanded] = useState(false),
    [noteOpen, setNoteOpen] = useState(false),
    [note, setNote] = useState("");
  const [block, setBlock] = useState(false),
    [reason, setReason] = useState(""),
    [owner, setOwner] = useState<"human" | "agent" | "unknown">("human"),
    [other, setOther] = useState("");
  const [saving, setSaving] = useState(false),
    [savingState, setSavingState] = useState<ReportedStatus | null>(null),
    [error, setError] = useState("");
  const dial = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    startY: number;
    beforeId?: string;
    moved: boolean;
  } | null>(null);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const state = stepPresentation(status?.reportedState);
  const choices: Array<[ReportedStatus, string]> = [
    ["not_started", "To do"],
    ["in_progress", "Doing"],
    ["complete", "Done"],
    ["blocked", "Blocked"],
  ];
  const save = async (next: ReportedStatus) => {
    if (saving || disabled || next === status?.reportedState) return;
    const run = async () => {
      setSaving(true);
      setSavingState(next);
      setError("");
      try {
        await onChange(
          next,
          note.trim() || undefined,
          next === "blocked" ? reason.trim() : undefined,
          next === "blocked"
            ? {
                nextOwnerKind: owner,
                nextOwner:
                  owner === "human"
                    ? operator || "Human"
                    : owner === "agent"
                      ? "The agent"
                      : other.trim(),
                nextAction: reason.trim(),
              }
            : undefined,
        );
        setOpen(false);
        setBlock(false);
        setNote("");
        dial.current?.focus();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't save the step. Try again.",
        );
        setRetry(() => run);
      } finally {
        setSaving(false);
        setSavingState(null);
      }
    };
    await run();
  };
  return (
    <article
      className={`workflow-step ${state.tone}`}
      id={`floor-subtask-${step.id}`}
      data-step-id={step.id}
    >
      <div className="workflow-step-row">
        {onReorder && !reorderDisabled && (
          <button
            type="button"
            className="step-reorder"
            onPointerDown={(event) => {
              if (disabled || reorderDisabled) return;
              drag.current = { startY: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (
                !drag.current ||
                Math.abs(event.clientY - drag.current.startY) < 6
              )
                return;
              drag.current.moved = true;
              const target = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest<HTMLElement>("[data-step-id]");
              if (target) {
                const after =
                  event.clientY >
                  target.getBoundingClientRect().top +
                    target.getBoundingClientRect().height / 2;
                drag.current.beforeId = after
                  ? (target.nextElementSibling as HTMLElement | null)?.dataset
                      .stepId
                  : target.dataset.stepId;
              }
            }}
            onPointerUp={() => {
              if (drag.current?.moved)
                onMoveBefore?.(step.id, drag.current.beforeId);
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            disabled={disabled || reorderDisabled}
            aria-label={`Reorder ${step.name}. Use up or down arrow keys`}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                onReorder(event.key === "ArrowUp" ? "up" : "down");
              }
            }}
          >
            ⠿
          </button>
        )}
        <button
          type="button"
          ref={dial}
          className="step-dial-button"
          disabled={disabled}
          title={disabled ? "Reconnect to Factory to edit" : undefined}
          aria-expanded={open}
          aria-label={`Step ${step.simpleId}, ${step.name}: ${state.label}. Change state`}
          onClick={() => {
            setOpen(!open);
            setError("");
          }}
        >
          <StepDial
            state={status?.reportedState}
            skipped={step.archiveState === "wont_do"}
          />
        </button>
        <button
          type="button"
          className="step-name"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            if (!expanded) onOpenDetail?.();
          }}
        >
          {step.name}
        </button>
        <span className={`step-state ${state.tone}`}>
          {step.archiveState === "wont_do" ? "SKIPPED" : state.code}
        </span>
        <span className="step-meta">
          {status?.reporter
            ? `${status.reporter} · ${elapsedLabel(status.reportCreatedAt)}`
            : "—"}
        </span>
      </div>
      {status?.reportedState === "blocked" && (
        <p className="step-blocker">
          Blocked: {status.reason || "Reason not recorded"} ·{" "}
          {status.handoff?.nextOwnerKind === "human"
            ? "on you"
            : status.handoff?.nextOwner
              ? `on ${status.handoff.nextOwner}`
              : "owner not stated"}
        </p>
      )}
      {open && (
        <div
          className="step-control"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              dial.current?.focus();
            }
          }}
        >
          <div
            className="step-segments"
            role="radiogroup"
            aria-label={`State for ${step.name}`}
            onKeyDown={(event) => {
              const keys = [
                "ArrowRight",
                "ArrowDown",
                "ArrowLeft",
                "ArrowUp",
                "Home",
                "End",
              ];
              if (!keys.includes(event.key)) return;
              const radios = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[role=radio]",
                ),
              );
              const index = radios.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? radios.length - 1
                    : (index +
                        (["ArrowRight", "ArrowDown"].includes(event.key)
                          ? 1
                          : -1) +
                        radios.length) %
                      radios.length;
              radios.forEach(
                (radio, i) => (radio.tabIndex = i === next ? 0 : -1),
              );
              radios[next]?.focus();
            }}
          >
            {choices.map(([value, label]) => (
              <button
                type="button"
                role="radio"
                key={value}
                aria-checked={
                  block ? value === "blocked" : state.label === label
                }
                tabIndex={
                  (block ? value === "blocked" : state.label === label) ? 0 : -1
                }
                disabled={saving || disabled}
                onClick={() =>
                  value === "blocked" ? setBlock(true) : void save(value)
                }
              >
                {saving && savingState === value ? "Saving…" : label}
              </button>
            ))}
          </div>
          {!block && (
            <button
              type="button"
              className="workflow-text-button"
              onClick={() => setNoteOpen(!noteOpen)}
            >
              Add a note
            </button>
          )}
          {noteOpen && (
            <label>
              Note (optional)
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          )}
          {block && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save("blocked");
              }}
            >
              <label>
                What's in the way?
                <input
                  autoFocus
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <fieldset>
                <legend>Who can unblock it?</legend>
                {[
                  ["human", "Me"],
                  ["agent", "The agent"],
                  ["unknown", "Someone else"],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`owner-${step.id}`}
                      checked={owner === value}
                      onChange={() => setOwner(value as typeof owner)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              {owner === "unknown" && (
                <label>
                  Name
                  <input
                    required
                    value={other}
                    onChange={(event) => setOther(event.target.value)}
                  />
                </label>
              )}
              <div className="step-block-actions">
                <button
                  type="submit"
                  disabled={
                    saving ||
                    disabled ||
                    !reason.trim() ||
                    (owner === "unknown" && !other.trim())
                  }
                >
                  Save as blocked
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setBlock(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="workflow-error">
              {error}{" "}
              <button
                type="button"
                disabled={saving}
                onClick={() => void retry?.()}
              >
                Try again
              </button>
            </p>
          )}
        </div>
      )}
      {expanded && (
        <div className="step-detail">
          {step.description && (
            <p>
              <strong>Notes</strong> {step.description}
            </p>
          )}
          {step.evidence && (
            <p>
              <strong>Evidence</strong> {step.evidence}
            </p>
          )}
          {step.pullRequestUrl && (
            <a href={step.pullRequestUrl} rel="noreferrer" target="_blank">
              Open PR ↗
            </a>
          )}
          {detail}
        </div>
      )}
    </article>
  );
}

export function TaskActivity({
  items,
  totalCount,
  onLoadMore,
  loading,
  title = "Activity",
}: {
  title?: string;
  items: WorkflowActivity[];
  totalCount?: number;
  onLoadMore?: () => void;
  loading?: boolean;
}) {
  const [all, setAll] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const latestSeen = useRef(0);
  useEffect(() => {
    if (items.length && seen.current) {
      const added = items.filter(
        (item) =>
          !seen.current!.has(item.id) &&
          new Date(item.at).getTime() > latestSeen.current,
      );
      if (added.length)
        setAnnouncement(added.map((item) => item.text).join(" "));
    }
    if (items.length) {
      seen.current = new Set(items.map((item) => item.id));
      latestSeen.current = Math.max(
        latestSeen.current,
        ...items.map((item) => new Date(item.at).getTime()),
      );
    }
  }, [items]);
  const ordered = [...items].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  return (
    <section className="workflow-section">
      <p className="eyebrow">{title}</p>
      <span className="workflow-sr-only" aria-live="polite">
        {announcement}
      </span>
      {ordered.length ? (
        <ol className="workflow-activity">
          {(all ? ordered : ordered.slice(0, 6)).map((item, index, rows) => (
            <li key={item.id}>
              {(index === 0 ||
                new Date(rows[index - 1]!.at).toDateString() !==
                  new Date(item.at).toDateString()) && (
                <span className="workflow-activity-day">
                  {new Date(item.at).toDateString() ===
                  new Date().toDateString()
                    ? "TODAY"
                    : new Date(item.at).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                </span>
              )}
              <time dateTime={new Date(item.at).toISOString()}>
                {new Date(item.at).toLocaleString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <span className="activity-who">
                {item.actor === "Codex"
                  ? "CX"
                  : item.actor === "Claude"
                    ? "CL"
                    : item.actor === "GitHub"
                      ? "GH"
                      : item.actor.slice(0, 2).toUpperCase()}
              </span>
              <span>
                {item.text}{" "}
                {item.earlierReview && (
                  <span className="workflow-chip">EARLIER REVIEW</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="workflow-muted">No updates yet.</p>
      )}
      {onLoadMore && (totalCount ?? ordered.length) > ordered.length ? (
        <button
          type="button"
          className="workflow-text-button"
          disabled={loading}
          onClick={() => {
            setAll(true);
            onLoadMore();
          }}
        >
          {loading ? "Loading…" : `Show more (${totalCount})`}
        </button>
      ) : (
        ordered.length > 6 && (
          <button
            type="button"
            className="workflow-text-button"
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `Show all (${ordered.length})`}
          </button>
        )
      )}
    </section>
  );
}

export function HumanCheckDialog({
  title,
  checkText,
  onClose,
  onCheck,
  onSendBack,
  evidence,
  returnFocus,
}: {
  returnFocus?: () => void;
  title: string;
  checkText?: string;
  onClose: () => void;
  onCheck: (note?: string) => Promise<unknown>;
  onSendBack: (reason: string) => Promise<unknown>;
  evidence?: ReactNode;
}) {
  const backdrop = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const [note, setNote] = useState(""),
    [sendBack, setSendBack] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const inert: HTMLElement[] = [];
    let branch: HTMLElement | null = backdrop.current;
    while (branch?.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (
          sibling !== branch &&
          sibling instanceof HTMLElement &&
          !sibling.inert
        ) {
          sibling.inert = true;
          inert.push(sibling);
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    heading.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      inert.forEach((el) => (el.inert = false));
      if (opener?.isConnected && !opener.hasAttribute("disabled"))
        opener.focus();
      else returnFocus?.();
    };
  }, []);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (sendBack) await onSendBack(reason.trim());
      else await onCheck(note.trim() || undefined);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't save your check. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="workflow-dialog-backdrop"
      ref={backdrop}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onClose();
        }
        if (event.key === "Tab") {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not([disabled]),textarea:not([disabled]),a[href]",
            ),
          ).filter((el) => !el.closest("[hidden]"));
          const first = controls[0],
            last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === heading.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-check-title"
        className="workflow-dialog"
      >
        <p className="eyebrow">Your check</p>
        <h2 ref={heading} tabIndex={-1} id="workflow-check-title">
          {title}
        </h2>
        <p className="eyebrow">What to check</p>
        <p>
          {checkText ||
            "Check this task against the recorded requirements and evidence."}
        </p>
        {evidence}
        {!sendBack && (
          <label>
            What you checked (optional)
            <textarea
              disabled={busy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        )}
        {sendBack && (
          <label>
            What needs to change?
            <textarea
              autoFocus
              required
              disabled={busy}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="workflow-error">
            {error}
          </p>
        )}
        <div className="workflow-dialog-actions">
          <button
            type="button"
            disabled={busy || (sendBack && !reason.trim())}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : sendBack ? "Send back" : "Mark checked"}
          </button>
          {!sendBack && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setSendBack(true)}
            >
              Send back…
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

export function FinishRulePanel({
  rule,
  rows,
  disabled,
  onSave,
  children,
  humanCheckText,
  finished,
  checked,
  agentFinished,
  editRequest,
  snapshotRevision,
  workflowEpoch,
  held,
}: {
  held?: boolean;
  snapshotRevision?: number;
  workflowEpoch?: number;
  checked?: boolean;
  finished?: boolean;
  agentFinished: boolean;
  humanCheckText?: string;
  rule: FinishRule;
  rows: RequiredPullRequest[];
  disabled: boolean;
  onSave: (
    rule: FinishRule,
    humanCheckText: string | undefined,
    changes: PullRequestRequirementChange[],
    expectedRevision: number,
    expectedWorkflowEpoch: number,
  ) => Promise<unknown>;
  children: (
    rows: RequiredPullRequest[],
    onDraftRequired?: (url: string, required: boolean) => void,
    saving?: boolean,
    linkRequest?: number,
  ) => ReactNode;
  editRequest?: {
    id: number;
    pullRequestUrl?: string;
    action?: "edit" | "link";
  };
}) {
  const ruleId = useId();
  const editorRef = useRef<HTMLDivElement>(null);
  const [editorFocusUrl, setEditorFocusUrl] = useState<string>();
  const [linkRequest, setLinkRequest] = useState<number>();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(() =>
      createFinishRuleDraft(
        rule,
        rows,
        humanCheckText,
        snapshotRevision,
        workflowEpoch,
      ),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guardsAvailable =
    typeof snapshotRevision === "number" &&
    Number.isSafeInteger(snapshotRevision) &&
    snapshotRevision >= 0 &&
    typeof workflowEpoch === "number" &&
    Number.isSafeInteger(workflowEpoch) &&
    workflowEpoch >= 0;
  const openEditor = () => {
    if (!guardsAvailable) return;
    setEditorFocusUrl(undefined);
    setDraft(
      createFinishRuleDraft(
        rule,
        rows,
        humanCheckText,
        snapshotRevision,
        workflowEpoch,
      ),
    );
    setError("");
    setEditing(true);
  };
  useEffect(() => {
    if (editRequest?.action === "link" && !finished) {
      setEditing(false);
      setEditorFocusUrl(undefined);
      setLinkRequest(editRequest.id);
      return;
    }
    if (editRequest && !finished && guardsAvailable) {
      const next = createFinishRuleDraft(
        rule,
        rows,
        humanCheckText,
        snapshotRevision,
        workflowEpoch,
      );
      if (editRequest.pullRequestUrl)
        next.requirements[editRequest.pullRequestUrl] = false;
      setEditorFocusUrl(editRequest.pullRequestUrl);
      setDraft(next);
      setError("");
      setEditing(true);
    }
  }, [editRequest?.id]);
  useEffect(() => {
    if (!editing) return;
    focusFinishRuleEditor(editorRef.current, editorFocusUrl);
  }, [editing, editorFocusUrl, editRequest?.id]);
  const draftRows = draftPullRequests(draft.rows, draft);
  const consequence = finishRuleConsequence(
    draft.rule,
    draftRows,
    agentFinished,
    held,
  );
  const staleDraft =
    snapshotRevision !== draft.expectedRevision ||
    workflowEpoch !== draft.expectedWorkflowEpoch;
  const setRequired = (url: string, required: boolean) =>
    setDraft((current) => ({
      ...current,
      requirements: { ...current.requirements, [url]: required },
    }));
  return (
    <section className="workflow-section finish-rule">
      <div className="workflow-section-heading">
        <p className="eyebrow">
          Finish rule{" "}
          <span className="workflow-chip">
            {rule.kind === "pr_merge" ? "ON MERGE" : "AGENT FINISHES"}
            {rule.requireHumanCheck ? " + YOUR CHECK" : ""}
          </span>
        </p>
        {finished ? (
          <span className="workflow-muted">Reopen to change</span>
        ) : (
          <button
            type="button"
            className="workflow-text-button"
            disabled={disabled || busy || !guardsAvailable}
            title={
              !guardsAvailable
                ? "Refresh Factory before editing this finish rule"
                : disabled
                  ? "Reconnect to Factory to edit"
                  : undefined
            }
            aria-expanded={editing}
            onClick={() => (editing ? setEditing(false) : openEditor())}
          >
            Edit
          </button>
        )}
      </div>
      <p>
        {rule.kind === "pr_merge"
          ? "Finishes when all required PRs reach the default branch."
          : "Finishes when the agent reports the task finished."}
        {rule.requireHumanCheck ? " Then waits for your check." : ""}
      </p>
      {rule.requireHumanCheck && (
        <p>
          <span
            role="img"
            className={`workflow-check-slot ${checked ? "checked" : ""}`}
            aria-label={checked ? "Checked" : "Awaiting your check"}
          >
            {checked ? "☑" : "□"}
          </span>{" "}
          Your check: {humanCheckText || "Recorded check requirements"}
        </p>
      )}
      {editing ? (
        <div className="finish-rule-editor" ref={editorRef}>
          <fieldset>
            <legend tabIndex={-1}>How does this task finish?</legend>
            {[
              [
                "pr_merge",
                "Its required PRs merge",
                "For code: all required PRs must reach the repository’s default branch.",
              ],
              [
                "agent_report",
                "The agent finishes",
                "For non-code work: the agent’s Task report finishes it directly.",
              ],
            ].map(([kind, label, description]) => (
              <label key={kind}>
                <input
                  type="radio"
                  name={`${ruleId}-finish-kind`}
                  disabled={busy}
                  checked={draft.rule.kind === kind}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      rule: {
                        ...current.rule,
                        kind: kind as FinishRule["kind"],
                      },
                    }))
                  }
                />
                <span>
                  {label}
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {draft.rule.kind === "pr_merge" && (
            <div className="finish-rule-required">
              <p className="eyebrow">Required PRs</p>
              {children(draftRows, setRequired, busy)}
            </div>
          )}
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={draft.rule.requireHumanCheck}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  rule: {
                    ...current.rule,
                    requireHumanCheck: event.target.checked,
                  },
                }))
              }
            />{" "}
            Also require my check
          </label>
          {draft.rule.requireHumanCheck && (
            <label>
              What should you check?
              <textarea
                maxLength={500}
                required
                disabled={busy}
                value={draft.humanCheckText}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    humanCheckText: event.target.value,
                  }))
                }
              />
            </label>
          )}
          <p
            className={`workflow-consequence ${consequence.warning ? "workflow-warning" : ""}`}
          >
            {consequence.text}
          </p>
          {staleDraft && (
            <p role="alert" className="workflow-warning">
              This Task changed while you were editing. Cancel and reopen the
              editor to review its current rule and PRs.
            </p>
          )}
          {error && (
            <p role="alert" className="workflow-error">
              {error}
            </p>
          )}
          <div className="workflow-dialog-actions">
            <button
              type="button"
              disabled={
                busy ||
                disabled ||
                !guardsAvailable ||
                staleDraft ||
                (draft.rule.requireHumanCheck && !draft.humanCheckText.trim())
              }
              onClick={() => {
                const expectedRevision = draft.expectedRevision;
                const expectedWorkflowEpoch = draft.expectedWorkflowEpoch;
                if (
                  expectedRevision === undefined ||
                  expectedWorkflowEpoch === undefined ||
                  !guardsAvailable ||
                  staleDraft
                )
                  return;
                setBusy(true);
                setError("");
                void onSave(
                  draft.rule,
                  draft.humanCheckText.trim() || undefined,
                  finishRuleRequirementChanges(draft.rows, draft),
                  expectedRevision,
                  expectedWorkflowEpoch,
                )
                  .then(() => {
                    setEditing(false);
                    setEditorFocusUrl(undefined);
                  })
                  .catch((err) =>
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Couldn't save the finish rule.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy
                ? "Saving…"
                : consequence.finishes
                  ? "Save and finish"
                  : "Save rule"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setEditorFocusUrl(undefined);
                setDraft(
                  createFinishRuleDraft(
                    rule,
                    rows,
                    humanCheckText,
                    snapshotRevision,
                    workflowEpoch,
                  ),
                );
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        rule.kind === "pr_merge" &&
        children(rows, undefined, false, linkRequest)
      )}
    </section>
  );
}

export type RequiredPullRequest = Wire<
  import("../application").TaskRequiredPullRequest
>;

export function TaskProvenance({ metadata }: { metadata?: FinishMetadata }) {
  return (
    <p className="task-provenance">
      {finishProvenance(metadata)}
      {metadata?.mergeProofs?.map((proof) => (
        <a
          key={proof.pullRequestUrl}
          href={`${proof.pullRequestUrl.split("/pull/")[0]}/commit/${proof.mergeSha}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open merge commit ${proof.mergeSha.slice(0, 7)}`}
        >
          {" "}
          ↗
        </a>
      ))}
    </p>
  );
}
