import { observedThreadKey, type ObservedThread } from "./observed-activity";

export type HistoryThreadDetailHandler = (
  threadId: string,
  sourceId?: string,
) => void | Promise<void>;

function targetKindLabel(kind: "task" | "subtask"): string {
  return kind === "task" ? "Task" : "Subtask";
}

export function HistoryThreadLinks({
  onOpenThreadDetail,
  threads,
}: {
  onOpenThreadDetail: HistoryThreadDetailHandler;
  threads: readonly ObservedThread[];
}) {
  if (threads.length === 0) return null;

  return (
    <div aria-label="Associated T3 threads" className="history-threads">
      <strong>Associated T3 threads</strong>
      <ul className="history-thread-list">
        {threads.map((thread) => {
          const title = thread.title || "Untitled T3 thread";
          const ownership = thread.association.links
            .map(
              ({ target }) =>
                `${targetKindLabel(target.kind)}: ${target.label}`,
            )
            .join(" · ");
          const source = thread.sourceId ?? thread.machineId;

          return (
            <li
              className="history-thread-item"
              key={observedThreadKey(thread.threadId, thread.sourceId)}
            >
              <button
                aria-label={`View T3 thread details for ${title}`}
                className="history-thread-link"
                onClick={() =>
                  void onOpenThreadDetail(thread.threadId, thread.sourceId)
                }
                type="button"
              >
                {title}
              </button>
              <span className="history-thread-ownership">{ownership}</span>
              {source && (
                <span className="history-thread-source">Source: {source}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
