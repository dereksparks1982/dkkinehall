#!/usr/bin/env python3
"""Developer preview only: use a private copy of the installed Chromium runtime.
System FFmpeg is permitted for this local test, never for release distribution.
Does not edit the existing installation or change the release gate.
"""
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from library_bundle import LibraryBundle
from sync_original_runtime import verify_player_settings, stage_standalone_background

def main():
    source=Path(__file__).resolve().parents[1]
    installed=Path(os.environ.get("DK_KINEHALL_DIR",str(Path.home()/"DKLab/Projects/DK Kinehall"))).resolve()
    parts=sorted((installed/"_internal").glob("runtime.tar.gz.*"))
    tools={name:shutil.which(name) for name in ("ffmpeg","ffprobe")}
    if not all(tools.values()):
        raise RuntimeError("Local preview requires existing ffmpeg and ffprobe; nothing installed or changed.")
    if not parts or not (installed/"DK Kinehall").is_file():
        raise RuntimeError("Existing standalone installation not found: "+str(installed))
    for name,exe in tools.items():
        subprocess.run([exe,"-version"],check=True,stdout=subprocess.DEVNULL,timeout=15)
    verify_player_settings((source/"docs/index.html").read_bytes())
    with tempfile.TemporaryDirectory(prefix="dk-kinehall-preview-") as work:
        work=Path(work)
        archive=work/"runtime.tar.gz"
        with archive.open("wb") as out:
            for part in parts:
                with part.open("rb") as inp:shutil.copyfileobj(inp,out)
        runtime=work/"runtime"
        runtime.mkdir()
        with tarfile.open(archive,"r:gz") as tar:
            tar.extractall(runtime,filter="data")
        archive.unlink()
        app=runtime/"resources/app"
        if not (runtime/"electron").is_file() or not (app/"main.cjs").is_file():
            raise RuntimeError("Unexpected original runtime layout")
        bundle=LibraryBundle(source)
        mainfile=app/"main.cjs"
        data=bundle.patch_main(mainfile.read_bytes())
        data=data.replace(b'require("./desktop/codec-host.cjs").install(win);',b'')
        # Confirm original bootstrap before staging preview-only changes.
        anchor=b'require("./desktop/library-host.cjs").install(win, player);'
        if data.count(anchor)!=1:raise RuntimeError("Unexpected library bootstrap")
        mainfile.write_bytes(data)
        preloads=[]
        for candidate in sorted(app.glob("preload*")):
            if not candidate.is_file() or candidate.suffix not in (".js",".cjs"):continue
            original=candidate.read_bytes()
            if b"DKStandalone" not in original or b"exposeInMainWorld" not in original:continue
            data=bundle.patch_preload("resources/app/"+candidate.name,original)
            marker=b"/* DK Kinehall bundled decoder bridge */"
            if marker in data:
                start=data.index(marker)
                end=data.find(b"\n})();",start)
                if end<0:raise RuntimeError("Malformed existing codec preload")
                data=data[:start]+data[end+len(b"\n})();"):]
            data+=b"\n;"+marker+b"\n(function(){\n"+(source/"desktop/codec-preload.cjs").read_bytes()+b"\n})();\n"
            candidate.write_bytes(data)
            preloads.append(candidate)
        bundle.assert_ready()
        if len(preloads)!=1:raise RuntimeError("Expected one original preload")
        for item in (source/"docs").rglob("*"):
            rel=item.relative_to(source/"docs")
            if not item.is_file() or rel.parts[0]=="icons":continue
            dest=app/"docs"/rel
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(item,dest)
        stage_standalone_background(source, app/"docs")
        (app/"desktop").mkdir(exist_ok=True)
        for name in ("library-host.cjs","library-indexer.cjs","codec-host.cjs","codec-policy.cjs","codec-source.cjs"):
            shutil.copy2(source/"desktop"/name,app/"desktop"/name)
        # Disable preview deletion, even if the normal native library offers it.
        host=app/"desktop/library-host.cjs"
        data=host.read_text()
        old="return native.deleteVideo(id,filePath,{dialog,shell,window:home});"
        if old not in data:raise RuntimeError("Cannot disable preview deletion")
        host.write_text(data.replace(old,'throw new Error("Deletion is disabled in the development preview");'))
        # System executables must not load stale bundled FFmpeg libraries.
        codec=app/"desktop/codec-host.cjs"
        code=codec.read_text()
        old_env='LD_LIBRARY_PATH:libs+path.delimiter+(process.env.LD_LIBRARY_PATH||""),'
        if old_env not in code:raise RuntimeError("Unexpected codec environment")
        codec.write_text(code.replace(old_env,'LD_LIBRARY_PATH:"",'))
        (app/"bin").mkdir(exist_ok=True)
        for name,exe in tools.items():
            dest=app/"bin"/name
            if dest.exists() or dest.is_symlink():dest.unlink()
            dest.symlink_to(Path(exe).resolve())
        profile=work/"profile"
        profile.mkdir()
        (profile/"userData").mkdir()
        env=dict(os.environ,XDG_CONFIG_HOME=str(profile/"config"),XDG_CACHE_HOME=str(profile/"cache"),XDG_DATA_HOME=str(profile/"data"))
        # Ensure Electron's single-instance lock and browser storage are private.
        data=mainfile.read_text()
        prefix='require("electron").app.setPath("userData",'+__import__("json").dumps(str(profile/"userData"))+');\n'
        # Insert after strict directive when present.
        if data.startswith('"use strict";'):
            data=data.replace('"use strict";','"use strict";\n'+prefix,1)
        else:data=prefix+data
        mainfile.write_text(data)
        print("Launching v0.9.3 local preview. Close both windows to remove the temporary copy.",flush=True)
        return subprocess.run([str(runtime/"electron"),str(app), "--user-data-dir="+str(profile/"userData"),*sys.argv[1:]],cwd=runtime,env=env).returncode

if __name__=="__main__":
    try:sys.exit(main())
    except Exception as exc:raise SystemExit("PREVIEW ERROR: "+str(exc))
