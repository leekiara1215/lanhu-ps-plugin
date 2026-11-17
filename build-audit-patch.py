"""Hash-pinned two-seam adapter. Lifecycle operations live in gameui-delivery.py."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMPATIBILITY = json.loads((HERE / "compatibility.json").read_text())
ORIGINAL_SHA256 = COMPATIBILITY["official"]["indexSha256"]
MODULES = ("gameui-core.js", "gameui-ps.js", "gameui-export.js")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def validate_official(plugin, original=None):
    manifest_bytes = (plugin / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    supported = COMPATIBILITY["official"]
    if (sha(manifest_bytes) != supported["manifestSha256"] or
            any(manifest.get(key) != supported[key] for key in ("id", "version", "manifestVersion", "main")) or
            manifest.get("host", {}).get("app") != supported["hostApp"] or
            manifest.get("host", {}).get("data", {}).get("apiVersion") != supported["apiVersion"]):
        raise ValueError("Unsupported official manifest/version; refusing to patch.")
    return build((plugin / "index.js").read_bytes() if original is None else original)


def build(original):
    if sha(original) != ORIGINAL_SHA256:
        raise ValueError("Unsupported official plugin hash; refusing to patch.")
    source = original.decode("utf-8")
    seam = "t.prototype.formatFrame=function"
    wrapper = ('t.prototype.formatPluginData=(function(original){return function(M,t,e,i){'
               'return original.apply(this,arguments).then(function(payload){'
               'return require("./gameui-export.js").capture(payload,e,M.id,this)}.bind(this))}})'
               '(t.prototype.formatPluginData),')
    finalize = 'case 4:return s=O.sent(),i({type:r.UploadCallBackType.artboard'
    changed = ('case 4:return s=O.sent(),s=require("./gameui-export.js").finalize(s,e),'
               'i({type:r.UploadCallBackType.artboard')
    if source.count(seam) != 1 or source.count(finalize) != 1:
        raise ValueError("Official plugin seams changed.")
    return source.replace(seam, wrapper + seam).replace(finalize, changed).encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plugin", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()
    if args.install or args.restore:
        # Do not continue the old unjournaled in-place installation path.
        parser.error("Use gameui-delivery.py install/uninstall with --state; legacy flags no longer mutate plugins.")
    patched = validate_official(args.plugin)
    if args.output.exists():
        raise ValueError("Output already exists; choose a fresh build directory.")
    args.output.mkdir(parents=True)
    original = (args.plugin / "index.js").read_bytes()
    (args.output / "official-index.js").write_bytes(original)
    (args.output / "enhanced-index.js").write_bytes(patched)
    state = {"originalSha256": sha(original), "patchedSha256": sha(patched),
             "projectId": COMPATIBILITY["projectId"], "modules": {
                 name: sha((HERE / name).read_bytes()) for name in MODULES}, "status": "built_not_installed"}
    (args.output / "plugin-state.json").write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps(state))


if __name__ == "__main__":
    main()
