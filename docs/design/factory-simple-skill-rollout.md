# Simplified Factory skill rollout

2026-10-15. Documentation-only installation from `66fc89516949f8675a66ddd30f640dcac7fb8404` plus the uncommitted skill changes in this worktree. No application deployment.

The entrypoint is 60 lines, with routine reporting and installation details in references. Steps and session association are optional. T3 executes work, GitHub owns review and merge, and trackers own requirements. Factory retains work and evidence without claiming deployment or human acceptance.

## Installed copies

All five canonical files were copied as one directory, then independently rehashed against the source on both machines. All four copies match. Previous copies were backed up before replacement. M5's Claude parent-directory symlink was preserved.

| Machine             | Client | Installed path                                              | Backup                                                                                     |
| ------------------- | ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| M4-Agent-Mini.local | codex  | `/Users/agent/.codex/skills/software-factory`               | `/Users/agent/.local/state/factory/skill-rollouts/20261015T135142.997957Z/codex-previous`  |
| M4-Agent-Mini.local | claude | `/Users/agent/.claude/skills/software-factory`              | `/Users/agent/.local/state/factory/skill-rollouts/20261015T135142.997957Z/claude-previous` |
| M5-Agent-Mini.local | codex  | `/Users/agent/.codex/skills/software-factory`               | `/Users/agent/.local/state/factory/skill-rollouts/20261015T135149.170036Z/codex-previous`  |
| M5-Agent-Mini.local | claude | `/Users/agent/dot-files/ClaudeCode/skills/software-factory` | `/Users/agent/.local/state/factory/skill-rollouts/20261015T135149.170036Z/claude-previous` |

## Fresh-process verification

- Codex on M4 and M5: `codex debug prompt-input` in a fresh temporary working directory advertises the installed `software-factory` skill at `r0/software-factory/SKILL.md`. This proves discovery; the debug probe does not load its body.
- Claude Code on M4: a fresh nonpersistent, read-only print session discovers and invokes `Skill(software-factory)`. It correctly reports the three Home groups and that Steps and session association are optional. No Factory calls or writes were requested.
- Claude Code on M5: fresh initialization discovers `software-factory`, but the model call returns `Not logged in · Please run /login`. A login-shell retry has the same result. Full skill loading remains unverified until Claude is logged in. An existing SessionEnd hook also reports `node: command not found`; hook configuration was not changed.

No binaries, endpoint configuration, tokens, hooks, or client settings were changed. Existing sessions may retain old instructions; start a fresh session to use the updated skill.

## Canonical SHA-256 manifest

| File                                | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `SKILL.md`                          | `9c7be7a9f339327d825933ba1235be9309bc74a6047b56ad968fc6196c6bbd03` |
| `references/cli-and-maintenance.md` | `2d189332d1d8c75db8e36bbb3144294f30063d4d9976bfdbb1aec3bc37191533` |
| `references/installation.md`        | `5f1292df09ab8ecc0a1305b3588ee315b802c4cd695cedaa51d442b26fbec155` |
| `references/reviewer-acceptance.md` | `38b4bbec776aa30f9b5c2a7f76d79c68ace84c793f01325ca427c514ee8805e3` |
| `references/routine-workflow.md`    | `b4f6594a25143b87f14437c67c22b3ff08d6d5c7f2df887f9f9419c9324743f6` |

Validation: the skill contract test passes (4 tests, 34 assertions). Installation and independent verification reports are retained under each machine's skill-rollout state directory.
