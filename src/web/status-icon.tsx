import { statusDefinitions, type WorkStatus } from "./status-presentation";

export function StatusIcon({
  state,
  size = 20,
  decorative = false,
}: {
  state: WorkStatus;
  size?: number;
  decorative?: boolean;
}) {
  const definition = statusDefinitions[state];
  const label = definition.label;
  const glow = [
    "active",
    "awaiting_verification",
    "blocked",
    "completed",
    "released",
  ].includes(state)
    ? `glow-${state === "active" ? "info" : state === "awaiting_verification" ? "warn" : state === "blocked" ? "down" : "ok"}`
    : "";
  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className={`status-icon status-icon-${state} ${glow}`}
      fill="none"
      height={size}
      role={decorative ? undefined : "img"}
      viewBox="0 0 16 16"
      width={size}
    >
      {!decorative && <title>{label}</title>}
      {state === "planned" && (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke={definition.color}
          strokeWidth="1.6"
          strokeDasharray="2.5 2.6"
        />
      )}
      {state === "backlog" && (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke={definition.color}
          strokeWidth="1.6"
          strokeDasharray="1.2 2.2"
        />
      )}
      {state === "active" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <path d="M8 8V3.6A4.4 4.4 0 0 1 12.4 8Z" fill={definition.color} />
        </>
      )}
      {state === "awaiting_verification" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
            strokeDasharray="2.5 2.6"
          />
          <circle cx="8" cy="8" r="3" fill={definition.color} />
        </>
      )}
      {state === "blocked" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <rect
            x="4.8"
            y="7.1"
            width="6.4"
            height="1.8"
            rx="0.4"
            fill={definition.color}
          />
        </>
      )}
      {state === "completed" && (
        <>
          <circle cx="8" cy="8" r="6.3" fill={definition.color} />
          <path
            d="m5.2 8.2 1.9 1.9 3.8-4"
            stroke="var(--canvas)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {state === "released" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <path
            d="m5.4 8.2 1.8 1.8 3.5-3.7"
            stroke={definition.color}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {state === "wont_do" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <path
            d="m4.8 11.2 6.4-6.4"
            stroke={definition.color}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
