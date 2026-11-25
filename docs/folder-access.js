/* DK Kinehall: directory-handle scanning, shared by web and standalone.
 * No filesystem access is attempted without a user-approved directory handle.
 * Keep memory and queue use bounded even for very large collections.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DKFolderAccess = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const MAX_FILES = 500;
  const MAX_VISITS = 12000;
  const MAX_DEPTH = 6;
  const playable = name => /\.(mp4|m4v|mov|mkv|avi|webm|ogg|ogv|mp3|m4a|aac|wav|flac|opus|ts)$/i.test(name);
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  async function scan(handle, options = {}) {
    if (!handle || handle.kind !== "directory" || typeof handle.entries !== "function")
      throw new TypeError("Choose a readable media directory");
    const maxFiles = Math.min(MAX_FILES, Math.max(1, Number(options.maxFiles) || MAX_FILES));
    const maxDepth = Math.min(MAX_DEPTH, Math.max(0, Number.isInteger(options.maxDepth) ? options.maxDepth : MAX_DEPTH));
    const queue = [{dir:handle, prefix:"", depth:0}];
    const output = [];
    let visited = 0, truncated = false;
    while (queue.length) {
      if (options.signal?.aborted) throw new Error("Folder scan cancelled");
      const {dir, prefix, depth} = queue.shift();
      const children = [];
      for await (const [name, entry] of dir.entries()) {
        if (options.signal?.aborted) throw new Error("Folder scan cancelled");
        if (++visited > MAX_VISITS) { truncated = true; break; }
        if (!entry || (entry.kind !== "file" && entry.kind !== "directory")) continue;
        children.push({name, entry});
      }
      children.sort((a, b) => byName(a.name, b.name));
      for (const {name, entry} of children) {
        if (options.signal?.aborted) throw new Error("Folder scan cancelled");
        if (entry.kind === "directory") {
          if (depth < maxDepth) queue.push({dir:entry, prefix:prefix+name+"/", depth:depth+1});
          else truncated = true;
        } else if (playable(name)) {
          if (output.length >= maxFiles) {truncated = true; continue;}
          try {
            const file = await entry.getFile();
            if (file && file.name) output.push({file, handle:entry, path:prefix+name});
          } catch (_) { /* One unreadable file must not block the folder. */ }
        }
      }
      if (visited > MAX_VISITS) break;
    }
    output.sort((a, b) => byName(a.path, b.path));
    return {files:output, truncated, visited};
  }
  return Object.freeze({scan, playable, MAX_FILES, MAX_VISITS, MAX_DEPTH});
});
