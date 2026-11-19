"""Build deterministic test bundles and manage a hash-guarded official upload adapter.

Never discovers or controls Photoshop. Always supply --plugin and an external --state.
Panel staging is independently loaded through Adobe UXP Developer Tool.
"""
import argparse
from contextlib import contextmanager
import importlib.util
import json
import os
import re
from pathlib import Path
import posixpath
import shutil
import sys
import tempfile
import uuid
import zipfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gameui_patch", HERE / "build-audit-patch.py")
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
MODULES = patch.MODULES
NAMES = ("index.js",) + MODULES
DELIVERY_FILES = MODULES + ("build-audit-patch.py", "gameui-delivery.py", "compatibility.json", "DELIVERY.md")
PANEL_FILES = ("manifest.json", "index.html", "panel.css", "panel.js", "README.md",
               "gameui-core.js", "gameui-ps.js", "gameui-authoring.js")
PANEL_REQUIRE = re.compile(rb"""\brequire\(\s*["'](\.{1,2}/[a-zA-Z0-9._/-]+\.js)["']\s*\)""")


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def read(path):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("Refusing symlink/non-file: " + str(path))
    return path.read_bytes() if path.exists() else None


def digest(value):
    return None if value is None else patch.sha(value)


def atomic_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    if value is None:
        path.unlink(missing_ok=True)
        return
    fd, temp = tempfile.mkstemp(prefix=".gameui-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, (path.stat().st_mode & 0o777) if path.exists() else 0o644)
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


def hashes(files):
    return {name: digest(files[name]) for name in NAMES}


def read_files(plugin):
    return {name: read(plugin / name) for name in NAMES}


def validate_paths(plugin, state):
    plugin, state = Path(plugin).absolute(), Path(state).absolute()
    for path in (plugin, state):
        if path.is_symlink() or path.resolve() != path:
            raise ValueError("Plugin/state paths must be real paths without symlink components.")
    if not plugin.is_dir() or plugin == state or plugin in state.parents or state in plugin.parents:
        raise ValueError("State must be external to the plugin directory.")
    return plugin, state


@contextmanager
def lock(state):
    state.mkdir(parents=True, exist_ok=True)
    path = state / "lock"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError("Delivery lock exists. Check the recorded PID; use recover --clear-stale-lock after process exit.")
    with os.fdopen(fd, "w") as stream:
        stream.write(str(os.getpid()))
    try:
        yield
    finally:
        path.unlink(missing_ok=True)


def load_state(plugin, state):
    value = read(state / "state.json")
    if value is None:
        patch.validate_official(plugin)
        files = read_files(plugin)
        if any(files[name] is not None for name in MODULES):
            raise ValueError("Unmanaged adapter files exist; refusing to overwrite.")
        return {"schemaVersion": 1, "plugin": str(plugin), "installed": False,
                "release": None, "bundleId": None, "hashes": hashes(files), "previousTransaction": None}
    result = json.loads(value)
    if result.get("schemaVersion") != 1 or result.get("plugin") != str(plugin):
        raise ValueError("State schema or plugin path differs.")
    official = read(state / "official-index.js")
    if digest(official) != patch.ORIGINAL_SHA256:
        raise ValueError("Original backup is missing or corrupt.")
    patch.validate_official(plugin, official)
    if hashes(read_files(plugin)) != result["hashes"]:
        raise ValueError("Plugin changed externally; refusing to overwrite.")
    return result


def require_clean_journal(state):
    if read(state / "active.json") is not None:
        raise ValueError("An interrupted transaction exists. Run recover first.")


def snapshot(folder, files):
    folder.mkdir(parents=True)
    for name, value in files.items():
        if value is not None:
            (folder / name).write_bytes(value)


def load_snapshot(folder, expected):
    result = {name: read(folder / name) for name in NAMES}
    if hashes(result) != expected:
        raise ValueError("Transaction snapshot is corrupt.")
    return result


def restore_transaction(plugin, state, journal):
    folder = state / "transactions" / journal["id"]
    before = load_snapshot(folder / "before", journal["beforeHashes"])
    after = load_snapshot(folder / "after", journal["afterHashes"])
    current = read_files(plugin)
    for name in NAMES:
        if current[name] not in (before[name], after[name]):
            raise ValueError("Recovery found external changes; preserving all files: " + name)
    state_bytes = read(state / "state.json")
    if digest(state_bytes) not in (journal["beforeStateHash"], journal["afterStateHash"]):
        raise ValueError("Recovery state changed externally; preserving files.")
    before_state = read(folder / "before-state.json")
    after_state = read(folder / "after-state.json")
    if digest(before_state) != journal["beforeStateHash"] or digest(after_state) != journal["afterStateHash"]:
        raise ValueError("Recovery state snapshot is corrupt.")
    # Restore entrypoint first; then restore/remove modules. Host must be closed.
    for name in NAMES:
        if read(plugin / name) != current[name]:
            raise ValueError("Concurrent external change during recovery: " + name)
        atomic_write(plugin / name, before[name])
    atomic_write(state / "state.json", before_state)
    atomic_write(state / "active.json", None)


def transaction(plugin, state, current, target, files, operation):
    before = read_files(plugin)
    if hashes(before) != current["hashes"]:
        raise ValueError("Plugin changed during preflight.")
    original = before["index.js"] if not current["installed"] else read(state / "official-index.js")
    backup = read(state / "official-index.js")
    if backup is not None and backup != original:
        raise ValueError("Existing original backup differs.")
    if backup is None:
        atomic_write(state / "official-index.js", original)
    transaction_id = uuid.uuid4().hex
    folder = state / "transactions" / transaction_id
    snapshot(folder / "before", before)
    snapshot(folder / "after", files)
    before_state = read(state / "state.json")
    target = dict(target, hashes=hashes(files), previousTransaction=transaction_id if operation != "rollback" else None)
    after_state = encoded(target)
    if before_state is not None:
        (folder / "before-state.json").write_bytes(before_state)
    (folder / "after-state.json").write_bytes(after_state)
    journal = {"id": transaction_id, "plugin": str(plugin), "operation": operation,
               "beforeHashes": hashes(before), "afterHashes": hashes(files),
               "beforeStateHash": digest(before_state), "afterStateHash": digest(after_state), "beforeLogicalState": current}
    atomic_write(folder / "journal.json", encoded(journal))
    atomic_write(state / "active.json", encoded(journal))
    try:
        # Modules first on install/upgrade; official entrypoint first on uninstall.
        order = NAMES if not target["installed"] else MODULES + ("index.js",)
        for name in order:
            if read(plugin / name) != before[name]:
                raise ValueError("Concurrent external change; refusing overwrite: " + name)
            if files[name] != before[name]:
                atomic_write(plugin / name, files[name])
        if hashes(read_files(plugin)) != hashes(files):
            raise ValueError("Post-write readback differs.")
        atomic_write(state / "state.json", after_state)
        atomic_write(state / "active.json", None)
    except Exception:
        restore_transaction(plugin, state, journal)
        raise
    return {"status": operation + "_complete_reload_required", "release": target["release"], "transaction": transaction_id}


def safe_bundle_path(name):
    if not isinstance(name, str) or not name:
        raise ValueError("Bundle paths must be nonempty strings.")
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or name != path.as_posix():
        raise ValueError("Unsafe bundle path: " + name)
    return path


def validate_panel_modules(bundle, panel_names):
    pending = ["Panel/panel.js"]
    visited = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        if name == "Panel/lanhu-host.js" and "Panel/gameui-export.js" not in panel_names:
            raise ValueError("Panel Lanhu host dependencies are incomplete: Panel/gameui-export.js")
        for relative in PANEL_REQUIRE.findall(read(bundle / name)):
            dependency = posixpath.normpath(posixpath.join(posixpath.dirname(name), relative.decode("ascii")))
            if dependency == "Panel/lanhu-runtime.js":
                continue  # The optional integrated runtime has its own identity check.
            if dependency not in panel_names:
                if dependency in {"Panel/lanhu-host.js", "Panel/gameui-export.js"}:
                    raise ValueError("Panel Lanhu host dependencies are incomplete: " + dependency)
                raise ValueError("Panel module dependency missing: " + dependency)
            pending.append(dependency)


def load_bundle(bundle):
    manifest_bytes = read(bundle / "bundle.json")
    if manifest_bytes is None:
        raise ValueError("Bundle manifest is missing.")
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or manifest.get("compatibility") != patch.COMPATIBILITY:
        raise ValueError("Unsupported bundle schema/compatibility.")
    if not isinstance(manifest.get("release"), str) or not manifest["release"].strip():
        raise ValueError("Bundle release is missing.")
    if not isinstance(manifest.get("panelIncluded"), bool):
        raise ValueError("Bundle panelIncluded must be a boolean.")
    files = manifest.get("files")
    if not isinstance(files, dict) or not all(name in files for name in DELIVERY_FILES):
        raise ValueError("Bundle is incomplete.")
    for name, checksum in files.items():
        path = bundle / safe_bundle_path(name)
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError("Bundle checksum must be a lowercase SHA-256: " + name)
        data = read(path)
        if data is None or path.resolve() != path.absolute() or patch.sha(data) != checksum:
            raise ValueError("Bundle file missing, modified or linked: " + name)
    actual = set()
    for path in bundle.rglob("*"):
        if path.is_symlink():
            raise ValueError("Bundle contains a symlink: " + str(path))
        if path.is_file() and path != bundle / "bundle.json":
            actual.add(path.relative_to(bundle).as_posix())
    if actual != set(files):
        raise ValueError("Bundle file inventory differs from its checksum manifest.")
    panel_names = {name for name in files if name.startswith("Panel/")}
    if manifest["panelIncluded"]:
        if not {"Panel/" + name for name in PANEL_FILES}.issubset(panel_names):
            raise ValueError("Panel runtime/documentation file manifest is incomplete.")
        panel_manifest = json.loads(read(bundle / "Panel/manifest.json"))
        if not isinstance(panel_manifest, dict):
            raise ValueError("Panel manifest must be an object.")
        main = panel_manifest.get("main")
        safe_bundle_path(main)
        if ("Panel/" + main not in files or not isinstance(panel_manifest.get("id"), str) or
                not panel_manifest["id"].strip() or panel_manifest["id"] == patch.COMPATIBILITY["official"]["id"] or
                not isinstance(panel_manifest.get("host"), dict) or panel_manifest["host"].get("app") != "PS"):
            raise ValueError("Panel main file, independent plugin ID or Photoshop host is invalid.")
        validate_panel_modules(bundle, panel_names)
        integrated_files = {"Panel/lanhu-runtime.js", "Panel/lanhu-runtime.json"}
        if integrated_files & panel_names:
            if not integrated_files.issubset(panel_names):
                raise ValueError("Panel Lanhu runtime/identity pair is incomplete.")
            identity = json.loads(read(bundle / "Panel/lanhu-runtime.json"))
            official = patch.COMPATIBILITY["official"]
            if (not isinstance(identity, dict) or identity.get("schemaVersion") != 1 or
                    identity.get("officialIndexSha256") != official["indexSha256"] or
                    identity.get("officialManifestSha256") != official["manifestSha256"] or
                    identity.get("projectId") != patch.COMPATIBILITY["projectId"] or
                    identity.get("runtimeSha256") != files["Panel/lanhu-runtime.js"] or
                    panel_manifest.get("host", {}).get("data", {}).get("apiVersion") != 2 or
                    not {"Panel/lanhu-host.js", "Panel/gameui-export.js"}.issubset(panel_names)):
                raise ValueError("Panel Lanhu runtime identity or dependencies are invalid.")
    elif panel_names or (bundle / "Panel").exists():
        raise ValueError("Bundle contains Panel files while panelIncluded is false.")
    manifest["bundleId"] = patch.sha(encoded(manifest))
    return manifest


def build_bundle(output, release, panel=None, source=HERE):
    if output.exists() or Path(str(output) + ".zip").exists():
        raise ValueError("Build output exists; choose a fresh output path.")
    contents = {name: (source / name).read_bytes() for name in DELIVERY_FILES}
    if panel is not None:
        if panel.is_symlink() or not (panel / "manifest.json").is_file():
            raise ValueError("Panel staging must contain a native UXP manifest.json.")
        panel_manifest = json.loads((panel / "manifest.json").read_text())
        if panel_manifest.get("id") == patch.COMPATIBILITY["official"]["id"] or panel_manifest.get("host", {}).get("app") != "PS":
            raise ValueError("Panel must have its own plugin ID and Photoshop host.")
        for path in sorted(panel.rglob("*")):
            if path.is_symlink():
                raise ValueError("Panel staging may not contain symlinks.")
            if path.is_file():
                contents["Panel/" + path.relative_to(panel).as_posix()] = path.read_bytes()
    manifest = {"schemaVersion": 1, "release": release, "compatibility": patch.COMPATIBILITY,
                "panelIncluded": panel is not None, "files": {name: patch.sha(data) for name, data in contents.items()}}
    contents["bundle.json"] = encoded(manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".gameui-bundle-", dir=output.parent))
    archive_temp = temporary / "archive.zip"
    try:
        staging = temporary / "bundle"
        staging.mkdir()
        for name, data in contents.items():
            target = staging / safe_bundle_path(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        load_bundle(staging)
        with zipfile.ZipFile(archive_temp, "w", compression=zipfile.ZIP_STORED) as archive:
            for name in sorted(contents):
                info = zipfile.ZipInfo(name, date_time=(2026, 11, 17, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, contents[name])
        os.replace(staging, output)
        os.replace(archive_temp, Path(str(output) + ".zip"))
    finally:
        shutil.rmtree(temporary)
    return {"status": "built_not_installed", "bundle": str(output), "archive": str(Path(str(output) + '.zip')),
            "sha256": patch.sha(Path(str(output) + '.zip').read_bytes()), "panelIncluded": panel is not None}


def diagnose(plugin, state):
    plugin, state = validate_paths(plugin, state)
    require_clean_journal(state)
    current = load_state(plugin, state)
    return {"status": "installed_on_disk_reload_not_observed" if current["installed"] else "official_on_disk",
            "release": current["release"], "hashes": current["hashes"], "compatibility": patch.COMPATIBILITY,
            "previousTransaction": current["previousTransaction"]}


def mutate(operation, plugin, state, bundle=None):
    plugin, state = validate_paths(plugin, state)
    with lock(state):
        require_clean_journal(state)
        current = load_state(plugin, state)
        files = read_files(plugin)
        target = dict(current)
        if operation in ("install", "upgrade"):
            manifest = load_bundle(bundle)
            if current["installed"] and current["bundleId"] == manifest["bundleId"]:
                return {"status": "already_installed", "release": current["release"]}
            if current["installed"] and operation == "install":
                raise ValueError("Different bundle installed; use upgrade explicitly.")
            if not current["installed"] and operation == "upgrade":
                raise ValueError("No adapter installed; use install.")
            if current["installed"] and current["release"] == manifest["release"]:
                raise ValueError("Release identity reused with different bytes; build a new release.")
            original = read(state / "official-index.js") if current["installed"] else files["index.js"]
            files = {"index.js": patch.validate_official(plugin, original),
                     **{name: read(bundle / name) for name in MODULES}}
            target.update(installed=True, release=manifest["release"], bundleId=manifest["bundleId"])
        elif operation == "uninstall":
            if not current["installed"]:
                return {"status": "already_uninstalled"}
            files = {"index.js": read(state / "official-index.js"), **dict.fromkeys(MODULES)}
            target.update(installed=False, release=None, bundleId=None)
        elif operation == "rollback":
            previous = current["previousTransaction"]
            if not previous:
                return {"status": "nothing_to_rollback"}
            journal_path = state / "transactions" / previous / "journal.json"
            journal = json.loads(read(journal_path))
            if journal["plugin"] != str(plugin) or journal["afterHashes"] != current["hashes"]:
                raise ValueError("Rollback transaction does not match current state.")
            files = load_snapshot(journal_path.parent / "before", journal["beforeHashes"])
            target = journal["beforeLogicalState"]
        else:
            raise ValueError("Unknown operation.")
        return transaction(plugin, state, current, target, files, operation)


def recover(plugin, state, clear_stale_lock=False):
    plugin, state = validate_paths(plugin, state)
    if clear_stale_lock and (state / "lock").exists():
        pid = int((state / "lock").read_text())
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            (state / "lock").unlink()
        else:
            raise ValueError("Lock owner is still alive; refusing to clear.")
    with lock(state):
        active = read(state / "active.json")
        if active is None:
            return {"status": "nothing_to_recover"}
        journal = json.loads(active)
        if journal["plugin"] != str(plugin):
            raise ValueError("Recovery plugin path differs.")
        original = read(state / "official-index.js")
        patch.validate_official(plugin, original)
        restore_transaction(plugin, state, journal)
        return {"status": "recovered_previous_state_reload_required", "transaction": journal["id"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build", help="Create a deterministic directory + unsigned ZIP; no host changes")
    build_parser.add_argument("--output", type=Path, required=True)
    build_parser.add_argument("--release", default=patch.COMPATIBILITY["adapterVersion"])
    build_parser.add_argument("--panel-staging", type=Path)
    for command in ("diagnose", "install", "upgrade", "uninstall", "rollback", "recover"):
        sub = commands.add_parser(command)
        sub.add_argument("--plugin", type=Path, required=True)
        sub.add_argument("--state", type=Path, required=True)
        if command in ("install", "upgrade"):
            sub.add_argument("--bundle", type=Path, required=True)
        if command == "recover":
            sub.add_argument("--clear-stale-lock", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "build":
            result = build_bundle(args.output, args.release, args.panel_staging)
        elif args.command == "diagnose":
            result = diagnose(args.plugin, args.state)
        elif args.command == "recover":
            result = recover(args.plugin, args.state, args.clear_stale_lock)
        else:
            result = mutate(args.command, args.plugin, args.state, getattr(args, "bundle", None))
        print(json.dumps(result, ensure_ascii=False))
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(2, json.dumps({"status": "refused", "error": str(error)}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
