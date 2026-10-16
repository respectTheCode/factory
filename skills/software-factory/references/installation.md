# Install and verify the Factory skill

The canonical source is the complete skills/software-factory directory in the Factory
checkout. Install that same directory on each agent machine into both the Codex and
Claude Code skill locations.

For Codex, use $CODEX_HOME/skills/software-factory when CODEX_HOME is configured;
otherwise use ~/.codex/skills/software-factory. For Claude Code, use
~/.claude/skills/software-factory. Repeat the copy and verification on both machines.

From a checkout containing the approved source revision, copy the whole directory,
including SKILL.md and references. Back up each existing destination before replacing
it, preserving any parent-directory symlinks. For example:

    SOURCE=/absolute/path/to/factory/skills/software-factory
    CODEX_ROOT="$HOME/.codex"
    if [ -n "${CODEX_HOME:-}" ]; then CODEX_ROOT="$CODEX_HOME"; fi

    for DEST in "$CODEX_ROOT/skills/software-factory" "$HOME/.claude/skills/software-factory"; do
      mkdir -p "$DEST"
      rsync -a --delete "$SOURCE/" "$DEST/"
      diff -qr "$SOURCE" "$DEST"
    done

Run the comparison on each machine and resolve every reported difference. Use the same
source revision for all four installed copies. A Factory service deployment does not
refresh agent skill files.

For a documentation-only refresh, do not use scripts/install-agent-client.sh: it also
installs the Factory binary, writes endpoint and token configuration, copies a
credential, installs session hooks, changes client settings, and runs client setup
checks. Do not change those client settings just to update skill instructions.

Start fresh Codex and Claude Code sessions after copying. A session that was already
open may still have the old skill loaded; verify discovery in a new session or
explicitly load the skill before relying on it.
