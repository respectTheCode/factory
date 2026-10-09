# Simplified workflow validation

T-94 · 2026-10-09 · coordinator evidence, before PR publication

The user approved the desktop and phone design. This record covers implementation
and local validation; PR review, merge, deployment, and product acceptance are
separate delivery evidence.

- Full regression suite: **614 tests passed, zero failures**, 2,978 assertions
  across 145 files. `/tmp/factory-round3-suite-final.log`.
- Typecheck and web build passed. `/tmp/factory-round3-build.log`.
- Repository formatting and `git diff --check` passed.
  `/tmp/factory-round3-format.log`.
- Software Factory skill contract: 4 tests passed, 20 assertions.
  `/tmp/factory-round3-skill-contract.log`.
- A fresh disposable database completed the **35-check Chrome journey** from
  Step creation to stacked-merge waiting, including keyboard reorder, reload
  persistence, no-reason Step Done, human-owned blocked Step with parent Active,
  zero-Step Task reports at epoch zero, optional checks, send-back, reopen,
  reasoned manual completion, and closed-PR requirement edits.
  `/tmp/factory-round3-clean-journeys.log`.
- The two-PR regression proves that making the open PR optional stays local
  until Save. Cancel preserves both required PRs, Task revision, Active state,
  and audit count. Save and finish records Kevin as the requirement-change and
  completion actor, then persists both after reload.
- Fresh desktop (1280px) and phone (390px) screenshots check visible element
  edges against the viewport and every ancestor with horizontal hidden/clip
  overflow. Primary, extra, changed-head, empty, and two-PR draft states pass.
  Logs: `/tmp/factory-round3-{primary,extra,changed,empty,b6}-capture.log`.
- T3 Open thread details opens the observed-activity panel without sending a
  message. `/tmp/factory-round3-t3-details.log`.

Screenshots are disposable test artifacts under
`output/playwright/simplified-workflow/`, excluded from Git. The approved design
and independent Opus reviews are retained in this directory. The original root
checkout and unrelated dirty files were preserved.

## Final correction round

Round 3 found a mismatch between agent-reported blockers and deliberate manual
holds. `TaskStatus.manualHold` now exactly matches the server completion guard.
Required-PR summaries include all canonical sources; an agent-report finish keeps
the report author's proof, with human rule edits recorded separately. Callout
actions move focus to the editor or replacement-PR input.

- Full regression suite: **624 passed, zero failures**, 3,003 assertions across
  146 files. `/tmp/factory-round4-suite.log`.
- The final replacement-button label and test were then checked with **151
  focused tests, zero failures**, 642 assertions.
  `/tmp/factory-round4-focused-final.log`.
- Final typecheck/build, formatting, and whitespace checks passed.
  `/tmp/factory-round4-build-final.log`, `/tmp/factory-round4-format-final.log`.
- The fresh focused Chrome journey passed **19 evidence records** covering
  agent-blocked Save and finish, manual-held Save rule, send-back dialog mode,
  report-author proof after check removal, stale-draft refusal, replacement PR
  linking with an editor open, and Mark not required through focused draft,
  Cancel, Save, and reload. `/tmp/factory-round4-journeys-final.log`.
- The earlier clean 35-check Step/Task journey remains applicable. All changed
  interactions were exercised again in the focused journey.
- Final captures: primary 32, extra 22, two-PR draft 2, changed-head 2, empty 2,
  and T3 details, plus the novel focused-journey captures at both desktop and
  phone widths. Visible horizontal edges and hidden/clip ancestors pass.
  `/tmp/factory-round4-captures-final.log`,
  `/tmp/factory-round4-changed-capture-final.log`,
  `/tmp/factory-round4-empty-capture-final.log`,
  `/tmp/factory-round4-t3-details-final.log`.

## Release candidate and S16 follow-up

Opus 5.5 round 4 returned Ready for UI/accessibility/workflow. Its nonblocking
S16 was fixed before publication: Step-only closed PRs cannot replace the Task's
separate PR, existing Task PR replacement is explicit, and the form captures the
opening revision and refuses stale submission. Mark-not-required focus resets on
Cancel/Save; Change finish rule opens an already-open editor. The agent brief now
uses the same deliberate manual-hold definition as the server.

- Final full suite: **629 passed, zero failures**, 3,022 assertions across 146
  files. `/tmp/factory-release-suite.log`.
- Final build/typecheck, formatting, and `git diff --check` passed.
- Fresh headed Chrome S16 journey verified Step-only action safety, focused
  checkbox draft and Cancel, explicit replacement disclosure and consequence,
  background revision change disabling submission, fresh replacement Save, and
  reload. Task PR changed from #36 to #39 while Step PR #37 remained required;
  Task remained unfinished. `/tmp/factory-s16-chrome.log`.
- Eight fresh desktop/phone captures: `s16-{step-only,replacement,stale,saved}-`
  `{desktop,mobile}.png` under the ignored screenshot artifact directory. No
  document horizontal overflow or broken images; replacement phone screenshot
  visually inspected. Earlier stronger ancestor-clipping checks remain applicable
  to unchanged layouts.

Opus 5.5 round 5 confirmed S16 and the focus/brief corrections: **Ready**, no
blockers or unresolved objections. Its evidence limits are preserved in the
review. A supplemental Chrome API readback explicitly asserts Task PR #39,
Step PR #37 still required, and Task unfinished after reload; returned JSON is
logged at `/tmp/factory-s16-readback.log`. The earlier background rename did not
supply a valid expected revision (status uses `taskRevision`), but did change
the revision and exercise stale-form refusal; authoritative revision guards
remain covered by the application/API tests.
