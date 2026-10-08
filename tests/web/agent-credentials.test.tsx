import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentCredentialsSection,
  agentCredentialAccessChanged,
  agentCredentialCreateInput,
  agentCredentialDraftForRole,
} from "../../src/web/agent-credentials";
import {
  AgentTokenBanner,
  AgentTokenHandoffContext,
  agentTokenNoticeAnnouncement,
} from "../../src/web/agent-token-handoff";
import { ConnectionsPage } from "../../src/web/connections";

describe("agent credential settings UI", () => {
  test("keeps the agent section visible with an explicit disconnected state", () => {
    const html = renderToStaticMarkup(
      <AgentCredentialsSection canManage={false} client={null} />,
    );
    expect(html).toContain("Agent credentials");
    expect(html).toContain("Waiting for the Factory connection");
    expect(html).toContain("Add credential");
    expect(html).not.toContain("localStorage");
  });

  test("keeps T3 connections and agent credentials as separate sections", () => {
    const html = renderToStaticMarkup(
      <ConnectionsPage canManage={false} client={null} />,
    );
    expect(html).toContain("Connections");
    expect(html).toContain("read-only T3 activity");
    expect(html).toContain("Agent credentials");
  });

  test("clears reviewer identity when switching to coding and scopes the payload", () => {
    const reviewerDraft = {
      allProjects: true,
      machineId: "agent-one",
      projectIds: ["project-one"],
      reviewerName: "Bitsy",
      role: "reviewer" as const,
    };

    const codingDraft = agentCredentialDraftForRole(reviewerDraft, "coding");
    expect(codingDraft).toMatchObject({
      role: "coding",
      allProjects: false,
      reviewerName: "",
    });
    expect(agentCredentialCreateInput(codingDraft)).not.toHaveProperty(
      "reviewerName",
    );
    expect(agentCredentialCreateInput(reviewerDraft)).toMatchObject({
      reviewerName: "Bitsy",
      role: "reviewer",
    });
  });

  test("detects access changes without treating checkbox order as a change", () => {
    const initial = { allProjects: false, projectIds: ["one", "two"] };
    expect(
      agentCredentialAccessChanged(initial, {
        allProjects: false,
        projectIds: ["two", "one"],
      }),
    ).toBe(false);
    expect(
      agentCredentialAccessChanged(initial, {
        allProjects: false,
        projectIds: ["one"],
      }),
    ).toBe(true);
    expect(
      agentCredentialAccessChanged(initial, {
        allProjects: true,
        projectIds: ["one", "two"],
      }),
    ).toBe(true);
  });

  test("announces a new token without placing the secret in the live region", () => {
    const token = "factory-secret-token";
    const notice = { kind: "created" as const, machineId: "m5-mini", token };
    const announcement = agentTokenNoticeAnnouncement(notice);
    expect(announcement).toContain("m5-mini");
    expect(announcement).not.toContain(token);

    const html = renderToStaticMarkup(
      <AgentTokenHandoffContext.Provider
        value={{
          dismiss: () => {},
          issue: () => {},
          notice,
          pending: false,
          setPending: () => {},
        }}
      >
        <AgentTokenBanner />
      </AgentTokenHandoffContext.Provider>,
    );
    expect(html).toContain("I’ve saved it");
    expect(html).not.toContain(">Dismiss<");
    expect(html).toContain('aria-labelledby="agent-token-notice-title"');
    expect(html).toContain(
      "New agent token created for m5-mini. Copy or save it now; it will not be shown again.",
    );
    const liveRegion = html.match(
      /<div class="visually-hidden" role="status">([^<]*)<\/div>/,
    )?.[1];
    expect(liveRegion).toContain("m5-mini");
    expect(liveRegion).not.toContain(token);
    expect(html).toContain(token);
  });
});
