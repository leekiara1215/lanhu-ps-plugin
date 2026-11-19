"""Hash-pinned upload adapter. Lifecycle operations live in gameui-delivery.py."""
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
    test_project = json.dumps(COMPATIBILITY["projectId"])
    wrapper = ('t.prototype.gameuiBoardScope=function(config){'
               f'if((config.projectId||config.projectID)!=={test_project})return null;'
               'var adapter=require("./gameui-export.js");return '
               'typeof adapter.prepareAnalysis==="function"?adapter:null},'
               't.prototype.formatPluginData=(function(original){return function(M,t,e,i){'
               'return original.apply(this,arguments).then(function(payload){'
               'return require("./gameui-export.js").capture(payload,e,M.id,this,'
               'this.gameuiBoardScope(e)?{document:M,mode:t,board:i}:undefined)}.bind(this))}})'
               '(t.prototype.formatPluginData),')
    snapshot = ('case 1:return g.trys.push([1,12,,13]),[4,(0,a.batchPlay)(a.getDocumentData,y)];'
                'case 2:if((e=g.sent()).length<1)throw new Error("get document data faild");'
                'if(i=e[0].json,A=JSON.parse(i),')
    prepare = ('case 1:return g.trys.push([1,12,,13]),o=this.gameuiBoardScope(M),'
               '[4,(0,a.batchPlay)(a.getDocumentData,y).then(function(values){'
               'if(!values.length)throw new Error("get document data faild");'
               'var document=JSON.parse(values[0].json);'
               'return o?o.prepareAnalysis(document,M,require("photoshop").app.activeDocument):document})];'
               'case 2:if(A=g.sent(),')
    finalize = 'case 4:return s=O.sent(),i({type:r.UploadCallBackType.artboard'
    changed = ('case 4:return s=O.sent(),s=require("./gameui-export.js").finalize(s,e),'
               'i({type:r.UploadCallBackType.artboard')
    if any(source.count(value) != 1 for value in (seam, snapshot, finalize)):
        raise ValueError("Official plugin seams changed.")
    return source.replace(seam, wrapper + seam).replace(snapshot, prepare).replace(finalize, changed).encode("utf-8")


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
