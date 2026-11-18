"""Run against a read-only official source; every mutation is inside TemporaryDirectory."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("delivery", HERE / "gameui-delivery.py")
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)
OFFICIAL = Path(os.environ.get("GAMEUI_OFFICIAL_PLUGIN", "/Users/betta/Library/Application Support/Adobe/UXP/Plugins/External/com.lanhu.ps_1.0.32"))


def tree_hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob("*") if p.is_file()}


class DeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not OFFICIAL.is_dir():
            raise RuntimeError("Set GAMEUI_OFFICIAL_PLUGIN to an original complete official plugin directory.")
        delivery.patch.validate_official(OFFICIAL)
        cls.original_hashes = tree_hashes(OFFICIAL)

    @classmethod
    def tearDownClass(cls):
        if tree_hashes(OFFICIAL) != cls.original_hashes:
            raise AssertionError("Read-only official source changed during testing.")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gameui-delivery-test-")
        self.root = Path(self.temp.name).resolve()
        self.plugin = self.root / "official-copy"
        shutil.copytree(OFFICIAL, self.plugin)
        self.state = self.root / "state"
        self.before = tree_hashes(self.plugin)
        self.bundle = self.root / "bundle-v1"
        delivery.build_bundle(self.bundle, "test-1")

    def tearDown(self):
        self.temp.cleanup()

    def operate(self, operation, bundle=None):
        return delivery.mutate(operation, self.plugin, self.state, bundle or self.bundle)

    def installed(self):
        return delivery.diagnose(self.plugin, self.state)["status"].startswith("installed")

    def second_bundle(self, release="test-2"):
        source = self.root / "source"
        source.mkdir()
        for name in delivery.DELIVERY_FILES:
            shutil.copyfile(HERE / name, source / name)
        for name in ("gameui-core.js", "gameui-export.js"):
            with (source / name).open("a") as stream:
                stream.write("\n// Second local test release.\n")
        target = self.root / "bundle-v2"
        delivery.build_bundle(target, release, source=source)
        return target

    def test_real_install_repeat_uninstall_and_full_tree_restore(self):
        self.assertFalse(self.installed())
        self.operate("install")
        self.assertTrue(self.installed())
        self.assertEqual(self.operate("install")["status"], "already_installed")
        changed = tree_hashes(self.plugin)
        self.assertEqual({key for key in changed if changed[key] != self.before.get(key)}, set(delivery.NAMES))
        self.operate("uninstall")
        self.assertEqual(tree_hashes(self.plugin), self.before)
        self.assertEqual(self.operate("uninstall")["status"], "already_uninstalled")

    def test_upgrade_rollback_and_repeat_rollback(self):
        self.operate("install")
        first = tree_hashes(self.plugin)
        second = self.second_bundle()
        with self.assertRaisesRegex(ValueError, "use upgrade"):
            self.operate("install", second)
        self.operate("upgrade", second)
        self.assertNotEqual(tree_hashes(self.plugin), first)
        self.assertEqual(delivery.diagnose(self.plugin, self.state)["release"], "test-2")
        self.assertEqual(self.operate("upgrade", second)["status"], "already_installed")
        self.operate("rollback")
        self.assertEqual(tree_hashes(self.plugin), first)
        self.assertEqual(self.operate("rollback")["status"], "nothing_to_rollback")
        self.operate("uninstall")
        self.assertEqual(tree_hashes(self.plugin), self.before)

    def test_rollback_initial_install_and_uninstall(self):
        self.operate("install")
        self.operate("rollback")
        self.assertEqual(tree_hashes(self.plugin), self.before)
        self.operate("install")
        installed = tree_hashes(self.plugin)
        self.operate("uninstall")
        self.operate("rollback")
        self.assertEqual(tree_hashes(self.plugin), installed)
        self.assertTrue(self.installed())

    def test_unknown_manifest_or_index_refused_without_writes(self):
        for name in ("manifest.json", "index.js"):
            original = (self.plugin / name).read_bytes()
            (self.plugin / name).write_bytes(original + b" ")
            before = tree_hashes(self.plugin)
            with self.assertRaisesRegex(ValueError, "Unsupported"):
                self.operate("install")
            self.assertEqual(tree_hashes(self.plugin), before)
            (self.plugin / name).write_bytes(original)

    def test_seams_checked_even_when_digest_is_injected(self):
        original = (self.plugin / "index.js").read_bytes()
        broken = original.replace(b"t.prototype.formatFrame=function", b"t.prototype.otherFrame=function")
        with mock.patch.object(delivery.patch, "ORIGINAL_SHA256", delivery.patch.sha(broken)):
            with self.assertRaisesRegex(ValueError, "seams"):
                delivery.patch.build(broken)

    def test_external_changes_preserved_for_all_lifecycle_commands(self):
        self.operate("install")
        second = self.second_bundle()
        for name in delivery.NAMES + ("manifest.json",):
            original = (self.plugin / name).read_bytes()
            (self.plugin / name).write_bytes(original + b"\nexternal edit\n")
            before = tree_hashes(self.plugin)
            for command in ("upgrade", "uninstall", "rollback"):
                with self.assertRaises(ValueError):
                    self.operate(command, second)
                self.assertEqual(tree_hashes(self.plugin), before)
            (self.plugin / name).write_bytes(original)

    def test_legacy_unmanaged_files_and_bad_bundle_rejected(self):
        (self.plugin / "gameui-core.js").write_text("external")
        with self.assertRaisesRegex(ValueError, "Unmanaged"):
            self.operate("install")
        (self.plugin / "gameui-core.js").unlink()
        (self.bundle / "gameui-core.js").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "modified"):
            self.operate("install")
        self.assertEqual(tree_hashes(self.plugin), self.before)

    def test_release_identity_reuse_rejected(self):
        self.operate("install")
        before = tree_hashes(self.plugin)
        with self.assertRaisesRegex(ValueError, "identity reused"):
            self.operate("upgrade", self.second_bundle("test-1"))
        self.assertEqual(tree_hashes(self.plugin), before)

    def test_failure_restores_previous_files_and_state(self):
        for operation in ("install", "upgrade", "uninstall", "rollback"):
            with self.subTest(operation=operation):
                if operation == "install":
                    bundle = self.bundle
                else:
                    if not self.installed():
                        self.operate("install")
                    bundle = self.second_bundle() if operation == "upgrade" else self.bundle
                before = tree_hashes(self.plugin)
                state_before = delivery.read(self.state / "state.json")
                writer = delivery.atomic_write
                count = 0

                def fail_once(path, value):
                    nonlocal count
                    if path.parent == self.plugin:
                        count += 1
                        if count == 2:
                            raise OSError("simulated atomic replacement failure")
                    return writer(path, value)

                with mock.patch.object(delivery, "atomic_write", fail_once):
                    with self.assertRaisesRegex(OSError, "simulated"):
                        self.operate(operation, bundle)
                self.assertEqual(tree_hashes(self.plugin), before)
                self.assertEqual(delivery.read(self.state / "state.json"), state_before)
                self.assertFalse((self.state / "active.json").exists())

    def test_crash_journal_recovery_and_external_changes_refused(self):
        writer = delivery.atomic_write
        count = 0

        def crash(path, value):
            nonlocal count
            if path.parent == self.plugin:
                count += 1
                if count == 2:
                    raise KeyboardInterrupt("simulated process termination")
            return writer(path, value)

        with mock.patch.object(delivery, "atomic_write", crash):
            with self.assertRaises(KeyboardInterrupt):
                self.operate("install")
        self.assertTrue((self.state / "active.json").exists())
        with self.assertRaisesRegex(ValueError, "interrupted"):
            self.operate("install")
        target = self.plugin / "gameui-core.js"
        interrupted = target.read_bytes()
        target.write_bytes(interrupted + b"external edit")
        before_recovery = tree_hashes(self.plugin)
        with self.assertRaisesRegex(ValueError, "external changes"):
            delivery.recover(self.plugin, self.state)
        self.assertEqual(tree_hashes(self.plugin), before_recovery)
        target.write_bytes(interrupted)
        delivery.recover(self.plugin, self.state)
        self.assertEqual(tree_hashes(self.plugin), self.before)
        self.assertEqual(delivery.recover(self.plugin, self.state)["status"], "nothing_to_recover")

    def test_backup_corruption_and_symlink_refused(self):
        self.operate("install")
        (self.state / "official-index.js").write_bytes(b"corrupt")
        before = tree_hashes(self.plugin)
        with self.assertRaisesRegex(ValueError, "backup"):
            self.operate("uninstall")
        self.assertEqual(tree_hashes(self.plugin), before)
        source = self.plugin / "gameui-core.js"
        saved = source.read_bytes()
        source.unlink()
        external = self.root / "external.js"
        external.write_bytes(saved)
        source.symlink_to(external)
        with self.assertRaises(ValueError):
            self.operate("uninstall")
        self.assertEqual(external.read_bytes(), saved)

    def panel_staging(self):
        panel = self.root / "panel-staging"
        panel.mkdir(exist_ok=True)
        for name in delivery.PANEL_FILES:
            (panel / name).write_text("Synthetic test staging " + name)
        (panel / "manifest.json").write_text(json.dumps({"id": "com.betta.gameui.test", "version": "0.1.0",
                                                       "main": "index.html", "host": {"app": "PS"}}))
        return panel

    def test_bundle_is_deterministic_with_panel_staging(self):
        panel = self.panel_staging()
        first, second = self.root / "first", self.root / "second"
        a = delivery.build_bundle(first, "test-1", panel)
        b = delivery.build_bundle(second, "test-1", panel)
        self.assertEqual(a["sha256"], b["sha256"])
        self.assertEqual(tree_hashes(first), tree_hashes(second))
        self.assertTrue(delivery.load_bundle(first)["panelIncluded"])
        with self.assertRaisesRegex(ValueError, "output exists"):
            delivery.build_bundle(first, "test-1", panel)

    def test_lanhu_panel_dependency_and_runtime_identity_rejections_preserve_plugin(self):
        panel = self.panel_staging()
        (panel / "panel.js").write_text('require("./lanhu-host.js");')
        with self.assertRaisesRegex(ValueError, "Lanhu host dependencies"):
            delivery.build_bundle(self.root / "missing-host", "missing-host", panel)
        self.assertEqual(tree_hashes(self.plugin), self.before)
        for name in ("lanhu-host.js", "gameui-export.js"):
            (panel / name).write_text("Synthetic host dependency")
        (panel / "lanhu-runtime.js").write_text("Synthetic runtime; not executed")
        with self.assertRaisesRegex(ValueError, "runtime/identity pair"):
            delivery.build_bundle(self.root / "missing-identity", "missing-identity", panel)
        (panel / "lanhu-runtime.json").write_text(json.dumps({"schemaVersion": 1, "runtimeSha256": "0" * 64}))
        with self.assertRaisesRegex(ValueError, "runtime identity"):
            delivery.build_bundle(self.root / "bad-identity", "bad-identity", panel)
        self.assertEqual(tree_hashes(self.plugin), self.before)

    def test_null_or_malformed_checksums_and_missing_files_refused_without_plugin_changes(self):
        for index, checksum in enumerate((None, True, 123, "", "a" * 63, "A" * 64, "g" * 64)):
            with self.subTest(checksum=checksum):
                bundle = self.root / ("bad-checksum-" + str(index))
                shutil.copytree(self.bundle, bundle)
                (bundle / "gameui-core.js").unlink()
                manifest = json.loads((bundle / "bundle.json").read_text())
                manifest["files"]["gameui-core.js"] = checksum
                (bundle / "bundle.json").write_bytes(delivery.encoded(manifest))
                with self.assertRaisesRegex(ValueError, "checksum"):
                    self.operate("install", bundle)
                self.assertEqual(tree_hashes(self.plugin), self.before)
        missing = self.root / "missing-module"
        shutil.copytree(self.bundle, missing)
        (missing / "gameui-export.js").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            self.operate("install", missing)
        self.assertEqual(tree_hashes(self.plugin), self.before)
        self.operate("install")
        installed = tree_hashes(self.plugin)
        state_before = delivery.read(self.state / "state.json")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.operate("upgrade", self.root / "bad-checksum-0")
        self.assertEqual(tree_hashes(self.plugin), installed)
        self.assertEqual(delivery.read(self.state / "state.json"), state_before)

    def test_bundle_required_files_types_and_inventory_refused(self):
        for index, change in enumerate((
                lambda b, m: m["files"].pop("gameui-core.js"),
                lambda b, m: m.update(files=[]),
                lambda b, m: m.update(panelIncluded="false"),
                lambda b, m: (b / "unlisted.js").write_text("unlisted"),
                lambda b, m: ((b / "gameui-core.js").unlink(), (b / "gameui-core.js").mkdir()),
                lambda b, m: ((b / "gameui-core.js").unlink(), (b / "gameui-core.js").symlink_to(self.bundle / "gameui-core.js")))):
            bundle = self.root / ("bad-inventory-" + str(index))
            shutil.copytree(self.bundle, bundle)
            manifest = json.loads((bundle / "bundle.json").read_text())
            change(bundle, manifest)
            (bundle / "bundle.json").write_bytes(delivery.encoded(manifest))
            with self.assertRaises(ValueError):
                self.operate("install", bundle)
            self.assertEqual(tree_hashes(self.plugin), self.before)

    def test_panel_flag_required_files_and_main_refused_without_plugin_changes(self):
        complete = self.root / "panel-bundle"
        delivery.build_bundle(complete, "test-panel", self.panel_staging())
        changes = [("missing-" + name, name) for name in delivery.PANEL_FILES]
        for index, (label, name) in enumerate(changes):
            with self.subTest(label=label):
                bundle = self.root / ("bad-panel-" + str(index))
                shutil.copytree(complete, bundle)
                manifest = json.loads((bundle / "bundle.json").read_text())
                (bundle / "Panel" / name).unlink()
                manifest["files"].pop("Panel/" + name)
                (bundle / "bundle.json").write_bytes(delivery.encoded(manifest))
                with self.assertRaisesRegex(ValueError, "Panel"):
                    self.operate("install", bundle)
                self.assertEqual(tree_hashes(self.plugin), self.before)
        for index, main in enumerate((None, "missing.html", "../index.html", "/tmp/main.html")):
            bundle = self.root / ("bad-main-" + str(index))
            shutil.copytree(complete, bundle)
            manifest = json.loads((bundle / "bundle.json").read_text())
            panel_manifest = json.loads((bundle / "Panel/manifest.json").read_text())
            panel_manifest["main"] = main
            data = delivery.encoded(panel_manifest)
            (bundle / "Panel/manifest.json").write_bytes(data)
            manifest["files"]["Panel/manifest.json"] = delivery.patch.sha(data)
            (bundle / "bundle.json").write_bytes(delivery.encoded(manifest))
            with self.assertRaises(ValueError):
                self.operate("install", bundle)
            self.assertEqual(tree_hashes(self.plugin), self.before)
        manifest = json.loads((complete / "bundle.json").read_text())
        manifest["panelIncluded"] = False
        (complete / "bundle.json").write_bytes(delivery.encoded(manifest))
        with self.assertRaisesRegex(ValueError, "panelIncluded"):
            self.operate("install", complete)
        self.assertEqual(tree_hashes(self.plugin), self.before)
        manifest = json.loads((self.bundle / "bundle.json").read_text())
        manifest["panelIncluded"] = True
        (self.bundle / "bundle.json").write_bytes(delivery.encoded(manifest))
        with self.assertRaisesRegex(ValueError, "Panel"):
            self.operate("install")
        self.assertEqual(tree_hashes(self.plugin), self.before)

    def test_cli_install_diagnose_uninstall(self):
        for command, expected in (("install", "install_complete"), ("diagnose", "installed_on_disk"), ("uninstall", "uninstall_complete")):
            args = ["python3", str(HERE / "gameui-delivery.py"), command,
                    "--plugin", str(self.plugin), "--state", str(self.state)]
            if command == "install":
                args += ["--bundle", str(self.bundle)]
            result = subprocess.run(args, capture_output=True, text=True, check=True)
            self.assertTrue(json.loads(result.stdout)["status"].startswith(expected))
        self.assertEqual(tree_hashes(self.plugin), self.before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
