#!/usr/bin/env bash
set -euo pipefail

python3 - "$@" <<'PY'
import argparse
import json
import os
import shlex
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def is_factory_reporting_hook(command: object) -> bool:
    if not isinstance(command, str):
        return False
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = [command]
    for token in tokens:
        name = Path(token).name.lower()
        if name.startswith("factory-") and "hook" in name and (
            "brief" in name or "report" in name
        ):
            return True
    return False


def remove_session_start_reporting_hooks(document: object) -> bool:
    if not isinstance(document, dict):
        return False
    hooks = document.get("hooks")
    if not isinstance(hooks, dict):
        return False
    entries = hooks.get("SessionStart")
    if not isinstance(entries, list):
        return False

    changed = False
    kept_entries = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("hooks"), list):
            kept_entries.append(entry)
            continue
        kept_hooks = []
        removed_from_entry = False
        for hook in entry["hooks"]:
            if isinstance(hook, dict) and is_factory_reporting_hook(
                hook.get("command")
            ):
                changed = True
                removed_from_entry = True
            else:
                kept_hooks.append(hook)
        if kept_hooks:
            copied_entry = dict(entry)
            copied_entry["hooks"] = kept_hooks
            kept_entries.append(copied_entry)
        elif not removed_from_entry:
            kept_entries.append(entry)

    if changed:
        if kept_entries:
            hooks["SessionStart"] = kept_entries
        else:
            del hooks["SessionStart"]
    return changed


def backup_path(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink():
        destination.symlink_to(os.readlink(source))
    elif source.is_dir():
        shutil.copytree(source, destination, symlinks=True)
    else:
        shutil.copy2(source, destination)


def atomic_write_json(path: Path, document: object, mode: int) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(document, output, indent=2, ensure_ascii=False)
            output.write("\n")
        os.chmod(temporary_name, mode)
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


parser = argparse.ArgumentParser(
    description="Remove installed Software Factory reporting skills and SessionStart hooks."
)
parser.add_argument("--home", type=Path, default=Path.home())
parser.add_argument("--backup-root", type=Path)
args = parser.parse_args()
home = args.home.expanduser().resolve()
backup_root = args.backup_root or home / ".local/state/factory-reporting-retirement"

skill_paths = []
for client, root in (
    ("agents", home / ".agents/skills"),
    ("codex", home / ".codex/skills"),
    ("claude", home / ".claude/skills"),
):
    candidate = root / "software-factory"
    if candidate.is_symlink() or candidate.is_dir():
        skill_paths.append((client, candidate))

config_paths = []
codex_hooks = home / ".codex/hooks.json"
if codex_hooks.is_file():
    config_paths.append(("codex", codex_hooks))
claude_dir = home / ".claude"
if claude_dir.is_dir():
    config_paths.extend(
        ("claude", path)
        for path in sorted(claude_dir.glob("settings*.json"))
        if path.is_file()
    )

changed_configs = []
for client, path in config_paths:
    document = json.loads(path.read_text(encoding="utf-8"))
    if remove_session_start_reporting_hooks(document):
        changed_configs.append((client, path, document, path.stat().st_mode & 0o777))

if not skill_paths and not changed_configs:
    print(json.dumps({"changed": False, "backup_dir": None, "removed_skills": [], "changed_configs": []}))
    raise SystemExit(0)

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup_root.mkdir(parents=True, exist_ok=True)
backup_dir = backup_root / stamp
suffix = 1
while backup_dir.exists():
    backup_dir = backup_root / f"{stamp}-{suffix}"
    suffix += 1
backup_dir.mkdir(parents=True)

for client, path in skill_paths:
    backup_path(path, backup_dir / "skills" / client / "software-factory")
for client, path, _document, _mode in changed_configs:
    backup_path(path, backup_dir / "settings" / client / path.name)

for _client, path in skill_paths:
    if path.is_symlink() or not path.is_dir():
        path.unlink(missing_ok=True)
    else:
        shutil.rmtree(path)
for _client, path, document, mode in changed_configs:
    atomic_write_json(path, document, mode)

print(
    json.dumps(
        {
            "changed": True,
            "backup_dir": str(backup_dir),
            "removed_skills": [str(path) for _client, path in skill_paths],
            "changed_configs": [str(path) for _client, path, _doc, _mode in changed_configs],
        }
    )
)
PY
