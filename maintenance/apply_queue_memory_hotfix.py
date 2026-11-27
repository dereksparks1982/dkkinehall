#!/usr/bin/env python3
"""Apply the narrowly scoped queue-memory maintenance patch to an installed runtime.
Keep all native binaries, codecs, icons, library data and other application files.
The full-package release gate remains independent of this maintenance operation.
"""
import io
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import json
from sync_original_runtime import CHUNK, sha

PATCHES=json.loads("[[\"  const load = (index, autoplay = true) => {\",\"  // MKV headers are read only for the selected item, not the entire folder.\\n  // Keep one pipeline active and at most one waiting selection. Rapid skips\\n  // replace the waiting selection instead of accumulating pending file reads.\\n  let inspectionActive=null,inspectionNext=null;\\n  const inspectSelectedMkv=item=>{\\n    if(!item?.file||item.file.dvdToken||!/\\\\.mkv$/i.test(item.name))return;\\n    const needsTracks=!!window.DKMatroska&&[\\\"not-mkv\\\",\\\"deferred\\\",\\\"pending\\\"].includes(item.mkvInspection);\\n    const needsChapters=!!window.DKMkvChapters&&!item.chaptersInspected;\\n    if(!needsTracks&&!needsChapters)return;\\n    if(inspectionActive===item){ \\n      if(inspectionNext&&inspectionNext!==item&&inspectionNext.mkvInspection===\\\"pending\\\")\\n        inspectionNext.mkvInspection=\\\"deferred\\\";\\n      inspectionNext=null;\\n      return;\\n    }\\n    if(inspectionNext&&inspectionNext!==item&&inspectionNext.mkvInspection===\\\"pending\\\")\\n      inspectionNext.mkvInspection=\\\"deferred\\\";\\n    if(needsTracks)item.mkvInspection=\\\"pending\\\";\\n    inspectionNext=item;\\n    if(inspectionActive)return;\\n    const pump=async()=>{\\n      while(inspectionNext){\\n        const selected=inspectionNext;\\n        inspectionNext=null;\\n        if(!state.queue.includes(selected)||current()!==selected){\\n          if(selected.mkvInspection===\\\"pending\\\")selected.mkvInspection=\\\"deferred\\\";\\n          continue;\\n        }\\n        inspectionActive=selected;\\n        try{\\n          if(selected.mkvInspection===\\\"pending\\\"&&window.DKMatroska){\\n            try{\\n              const result=await window.DKMatroska.inspectFile(selected.file);\\n              if(!state.queue.includes(selected))continue;\\n              selected.embeddedSubtitles=result.tracks||[];\\n              selected.embeddedAudio=result.audioTracks||[];\\n              selected.embeddedVideo=result.videoTracks||[];\\n              selected.mkvInspection=result.truncated?\\\"partial\\\":\\\"complete\\\";\\n            }catch(_){selected.mkvInspection=\\\"unavailable\\\";}\\n            if(current()===selected&&!state.stopped){\\n              updateSubtitleStatus();\\n              restoreAudioPreference();\\n              restoreEmbeddedSubtitlePreference(selected);\\n              refreshOpenSubtitleMenu();\\n              if(selected.compatPending){\\n                selected.compatPending=false;\\n                const epoch=selected.playbackEpoch;\\n                void tryCompatibleFallback(selected).then(ok=>{\\n                  if(!ok&&current()===selected&&selected.playbackEpoch===epoch&&!state.stopped)\\n                    void tryNativeCodec(selected);\\n                }).catch(()=>{});\\n              }\\n            }\\n          }\\n          if(current()===selected&&state.queue.includes(selected)&&!state.stopped&&\\n             !selected.chaptersInspected&&window.DKMkvChapters){\\n            try{\\n              const chapters=await window.DKMkvChapters.inspectFile(selected.file);\\n              if(state.queue.includes(selected)){\\n                selected.chaptersInspected=true;\\n                mergeChapters(selected,chapters);\\n              }\\n            }catch(_){/* Optional chapter metadata may be unavailable. */}\\n          }\\n        }finally{inspectionActive=null;}\\n      }\\n    };\\n    void pump().catch(()=>{inspectionActive=null;});\\n  };\\n  const load = (index, autoplay = true) => {\"],[\"    item.compatPending = false;\\n    item.requestedFormat\",\"    item.compatPending = false;\\n    inspectSelectedMkv(item);\\n    item.requestedFormat\"],[\"    media.load();\\n    screen.classList.remove(\\\"empty\\\", \\\"stopped\\\");\",\"    media.load();\\n    // Converted video blobs belong to the current playback, not the playlist.\\n    if(previous&&previous!==item)releaseCompatible(previous);\\n    screen.classList.remove(\\\"empty\\\", \\\"stopped\\\");\"],[\"      if (!file.dvdToken&&/\\\\.mkv$/i.test(file.name) && window.DKMkvChapters) {\\n        void window.DKMkvChapters.inspectFile(file).then(chapters=>{\\n          if (!state.queue.includes(item)) return;\\n          mergeChapters(item,chapters);\\n        }).catch(()=>{});\\n      }\\n      if (!file.dvdToken&&/\\\\.mkv$/i.test(file.name) && window.DKMatroska) {\\n        item.mkvInspection = \\\"pending\\\";\\n        void window.DKMatroska.inspectFile(file).then(result => {\\n          if (!state.queue.includes(item)) return;\\n          item.embeddedSubtitles = result.tracks || [];\\n          item.embeddedAudio = result.audioTracks || [];\\n          item.embeddedVideo = result.videoTracks || [];\\n          item.mkvInspection = result.truncated ? \\\"partial\\\" : \\\"complete\\\";\\n          if (current() === item) {\\n            updateSubtitleStatus(); restoreAudioPreference(); restoreEmbeddedSubtitlePreference(item);\\n            refreshOpenSubtitleMenu();\\n            if(item.compatPending){\\n              item.compatPending=false;\\n              void tryCompatibleFallback(item).then(ok=>{\\n                if(!ok && current()===item)void tryNativeCodec(item);\\n              });\\n            }\\n          }\\n        }).catch(() => {\\n          item.mkvInspection = \\\"unavailable\\\";\\n          if (current() === item) {\\n            updateSubtitleStatus();\\n            refreshOpenSubtitleMenu();\\n            if(item.compatPending){\\n              item.compatPending=false;\\n              void tryNativeCodec(item);\\n            }\\n          }\\n        });\\n      }\",\"\"]]")
TARGET="resources/app/docs/player.js"
MARKER="  let inspectionActive=null,inspectionNext=null;"

def patch(data):
    text=data.decode("utf-8")
    if MARKER in text:
        if "inspectSelectedMkv(item);" not in text or "if(previous&&previous!==item)releaseCompatible(previous);" not in text:
            raise RuntimeError("Incomplete existing queue-memory patch")
        return data
    for old,new in PATCHES:
        if text.count(old)!=1:
            raise RuntimeError("Installed player is not compatible with the queue-memory patch; no changes made")
        text=text.replace(old,new,1)
    return text.encode("utf-8")

def main(root):
    internal=root/"_internal"
    launcher=root/"DK Kinehall"
    external=root/"docs/player.js"
    parts=sorted(internal.glob("runtime.tar.gz.*"))
    if len(parts)<2 or not external.is_file() or not launcher.is_file():
        raise RuntimeError("Original installed player missing")
    external_data=patch(external.read_bytes())
    with tempfile.TemporaryDirectory(prefix=".dk-hotfix-",dir=internal) as work:
        work=Path(work)
        original=work/"original.tar.gz"
        updated=work/"updated.tar.gz"
        with original.open("wb") as out:
            for part in parts:
                with part.open("rb") as inp:shutil.copyfileobj(inp,out,1024*1024)
        old_sha=sha(original)
        binary=launcher.read_bytes()
        if binary.count(old_sha.encode("ascii"))!=1:
            raise RuntimeError("Installed launcher cache ID does not match runtime")
        count=0
        changed=False
        expected=None
        with tarfile.open(original,"r:gz") as src,tarfile.open(updated,"w:gz",compresslevel=3) as dst:
            for entry in src:
                if entry.name.removeprefix("./")==TARGET:
                    if not entry.isfile():raise RuntimeError("Invalid player resource")
                    count+=1
                    old=src.extractfile(entry).read()
                    expected=patch(old)
                    changed=changed or expected!=old
                    entry.size=len(expected)
                    dst.addfile(entry,io.BytesIO(expected))
                elif entry.isfile():
                    dst.addfile(entry,src.extractfile(entry))
                else:dst.addfile(entry)
        if count!=1:raise RuntimeError("Expected exactly one embedded player resource")
        if not changed and external_data==external.read_bytes():
            print("Queue-memory maintenance patch already installed.")
            return
        if changed:
            with tarfile.open(updated,"r:gz") as verify:
                members=[m for m in verify if m.name.removeprefix("./")==TARGET]
                if len(members)!=1 or verify.extractfile(members[0]).read()!=expected:
                    raise RuntimeError("Embedded player verification failed")
            new_sha=sha(updated)
            patched=binary.replace(old_sha.encode("ascii"),new_sha.encode("ascii"))
            pending=[]
            with updated.open("rb") as inp:
                index=0
                while chunk:=inp.read(CHUNK):
                    stage=work/("runtime.tar.gz.%03d"%index)
                    stage.write_bytes(chunk)
                    pending.append((stage,internal/stage.name))
                    index+=1
            if len(pending)<2:raise RuntimeError("Unexpected runtime size")
            staged_launcher=work/"launcher"
            staged_launcher.write_bytes(patched)
            staged_launcher.chmod(launcher.stat().st_mode)
            for part in parts:part.unlink()
            for stage,target in pending:os.replace(stage,target)
            os.replace(staged_launcher,launcher)
        external.write_bytes(external_data)
    print("Queue-memory maintenance patch installed; existing codecs and icons unchanged.")

if __name__=="__main__":
    try:main(Path(sys.argv[1]).resolve())
    except Exception as exc:raise SystemExit("ERROR: "+str(exc))
