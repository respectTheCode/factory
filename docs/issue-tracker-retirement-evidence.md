# Agent reporting retirement evidence

Completed on 2026-10-16 as part of the Factory issue-tracker pivot.

## Host changes

| Host                                    | Backup directory                                                          |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `M4-Agent-Mini.local` (`M4 Agent Mini`) | `/Users/agent/.local/state/factory-reporting-retirement/20261016T190343Z` |
| `M5-Agent-Mini.local` (`M5 Agent Mini`) | `/Users/agent/.local/state/factory-reporting-retirement/20261016T190344Z` |

On both hosts, `~/.codex/skills/software-factory` and `~/.claude/skills/software-factory`
were copied to the backup directory and removed. No Factory skill was installed under
`~/.agents/skills`. The helper saved the original `~/.codex/hooks.json` and
`~/.claude/settings.json` before removing the Factory-only `SessionStart` hook entries.

Read-back confirmed that both clients on both hosts have no installed `software-factory`
skill and no Factory reporting hook in `SessionStart`. Each backup contains the removed skill
and original settings files. Comparing the current settings with their backups after removing
only the targeted Factory entries produced identical remaining settings; file modes were
preserved. Other hook entries remain. No generated Factory reporting block was found in the
global Codex or Claude instruction files checked, so those files were left unchanged.

## Preventing reinstalls

The client installer now installs the Factory CLI, token, and environment file, then runs
`factory doctor`. It does not install skills, merge client hooks, or trust a Codex hook. Client
tarballs now contain only the CLI binary and installer. The focused regression checks passed:

```text
bun test tests/cli/uninstall-agent-reporting.test.ts tests/cli/agent-client-packaging.test.ts
3 pass, 0 fail, 46 assertions
```

The backups contain local configuration and skill files and should remain private to each
host. No credential values are recorded here.
