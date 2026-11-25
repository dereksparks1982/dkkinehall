"use strict";

// DK Kinehall local FFmpeg bridge. Electron-only, no localhost server, no
// URL/filename access from the renderer and no PATH-based codec dependency.
// A release must bundle a license-compliant FFmpeg binary before activation.
const fs = require("node:fs");
const path = require("node:path");
const {spawn} = require("node:child_process");
const {randomUUID} = require("node:crypto");

const channels = [
  "capabilities", "start", "write", "finish", "ack", "cancel"
].map(name => "dk-kinehall:transcode-" + name);

function bundledFFmpeg(repositoryRoot) {
  const candidates = [
    path.join(repositoryRoot, "standalone", "bin", "ffmpeg"),
    path.join(process.resourcesPath, "bin", "ffmpeg"),
    path.join(__dirname, "bin", "ffmpeg")
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111)) return candidate;
    } catch (_) {}
  }
  return null;
}

function install({win, ipcMain, repositoryRoot}) {
  if (!win || !ipcMain) throw new TypeError("Electron window required");
  const executable = bundledFFmpeg(repositoryRoot);
  let active = null;

  const validateSender = event => {
    if (win.isDestroyed() || event.sender !== win.webContents)
      throw new Error("Native conversion is only available to DK Kinehall");
  };
  const emit = (type, id, more = {}) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send("dk-kinehall:transcode-event", {type,id,...more});
  };
  const cancel = (job, notify = false) => {
    if (!job) return;
    job.cancelled = true;
    if (active === job) active = null;
    try {job.child.stdin.destroy();} catch (_) {}
    try {job.child.kill("SIGTERM");} catch (_) {}
    if (notify) emit("cancelled",job.id);
  };
  const assertActive = (id) => {
    if (typeof id !== "string" || !active || active.id !== id ||
        active.cancelled) throw new Error("Conversion session is not active");
    return active;
  };
  const argsFor = (format, hardware) => {
    const args = [
      "-hide_banner", "-loglevel", "error", "-nostats",
      "-probesize", "16777216", "-analyzeduration", "3000000"
    ];
    // FFmpeg will fall back to software when auto GPU decoding is unavailable.
    // Encoding below remains software, so the switch is not a GPU guarantee.
    if (hardware) args.push("-hwaccel","auto");
    args.push("-f","matroska","-i","pipe:0",
      "-map","0:v:0","-map","0:a:0?","-sn","-dn","-map_metadata","-1",
      "-pix_fmt","yuv420p");
    if (format === "mp4") {
      args.push("-c:v","libx264","-preset","veryfast","-tune","zerolatency",
        "-profile:v","baseline","-c:a","aac","-b:a","160k",
        "-movflags","frag_keyframe+empty_moov+default_base_moof",
        "-frag_duration","1000000","-f","mp4","pipe:1");
    } else {
      args.push("-c:v","libvpx-vp9","-deadline","realtime","-cpu-used","6",
        "-b:v","0","-crf","34","-c:a","libopus","-b:a","128k",
        "-cluster_time_limit","1000","-f","webm","pipe:1");
    }
    return args;
  };

  ipcMain.handle(channels[0], event => {
    validateSender(event);
    return {available: Boolean(executable), formats: executable ? ["mp4","webm"] : [],
      hardware: "auto-decode", requiresBundledFFmpeg: !executable};
  });
  ipcMain.handle(channels[1], (event, options) => {
    validateSender(event);
    if (!executable) throw new Error("Bundled transcoding engine is not installed");
    if (!options || !["mp4","webm"].includes(options.format))
      throw new Error("Unsupported requested output format");
    if (active) cancel(active,true);
    const id = randomUUID();
    const child = spawn(executable,argsFor(options.format,options.hardware === true),{
      stdio:["pipe","pipe","pipe"],windowsHide:true,
      env:{...process.env, AV_LOG_FORCE_NOCOLOR:"1"}
    });
    const job = {id,child,cancelled:false,stderr:""};
    active=job;
    child.stdout.on("data",chunk => {
      if (job.cancelled || active !== job) return;
      // One output chunk in flight. Chromium acknowledges only after
      // SourceBuffer has accepted it, bounding interprocess memory.
      child.stdout.pause();
      emit("data",id,{bytes:Uint8Array.from(chunk)});
    });
    child.stderr.on("data",chunk => {
      if (job.stderr.length < 3072)
        job.stderr += String(chunk).slice(0,3072-job.stderr.length);
    });
    child.on("error",error => {
      if (!job.cancelled) emit("error",id,{message:String(error.message||error)});
      if (active === job) active=null;
    });
    child.on("close",code => {
      if (active === job) active=null;
      if (job.cancelled) return;
      if (code === 0) emit("complete",id);
      else emit("error",id,{message:
        (job.stderr.trim() || "FFmpeg conversion did not complete").slice(0,240)});
    });
    return {id,format:options.format};
  });
  ipcMain.handle(channels[2],async(event,payload) => {
    validateSender(event);
    const job=assertActive(payload?.id);
    const data=payload?.bytes;
    if (!(data instanceof Uint8Array) || data.byteLength < 1 ||
        data.byteLength > 1048576)
      throw new Error("Invalid conversion input chunk");
    // Await each input write: the renderer never queues an entire movie
    // or unlimited pending IPC payloads.
    await new Promise((resolve,reject) => {
      job.child.stdin.write(Buffer.from(data),error =>
        error ? reject(error) : resolve());
    });
    return true;
  });
  ipcMain.handle(channels[3],(event,id) => {
    validateSender(event);
    const job=assertActive(id);
    job.child.stdin.end();
    return true;
  });
  ipcMain.handle(channels[4],(event,id) => {
    validateSender(event);
    const job=assertActive(id);
    job.child.stdout.resume();
    return true;
  });
  ipcMain.handle(channels[5],(event,id) => {
    validateSender(event);
    if(active && active.id===id)cancel(active,true);
    return true;
  });
  win.once("closed",() => {
    if(active)cancel(active);
    channels.forEach(name => ipcMain.removeHandler(name));
  });
  return {available:Boolean(executable)};
}
module.exports = {install,bundledFFmpeg};
