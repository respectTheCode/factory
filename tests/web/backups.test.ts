import { describe, expect, test } from "bun:test";

import { settingsDraft, settingsFromDraft } from "../../src/web/backups";

const settings = {
  enabled: true,
  intervalMinutes: 30,
  keepRecent: 336,
  keepDaily: 30,
};

describe("backup settings form values", () => {
  test("allows engine-supported zero retention and maximum interval", () => {
    expect(
      settingsFromDraft(settings, {
        ...settingsDraft(settings),
        intervalMinutes: "10080",
        keepRecent: "0",
        keepDaily: "0",
      }).settings,
    ).toEqual({
      enabled: true,
      intervalMinutes: 10080,
      keepRecent: 0,
      keepDaily: 0,
    });
  });

  test("rejects blank and out-of-range values instead of coercing drafts", () => {
    expect(
      settingsFromDraft(settings, {
        ...settingsDraft(settings),
        intervalMinutes: "",
      }).error,
    ).toContain("intervalMinutes");
    expect(
      settingsFromDraft(settings, {
        ...settingsDraft(settings),
        keepDaily: "10001",
      }).error,
    ).toContain("keepDaily");
  });
});
