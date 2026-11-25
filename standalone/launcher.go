// DK Kinehall: portable Linux launcher for the exact existing web player.
// All runtime bytes ship inside _internal. Nothing is downloaded at launch.
// A cache copy avoids reconstructing the Chromium runtime on every start.
package main

import (
  "archive/tar"
  "compress/gzip"
  "errors"
  "fmt"
  "io"
  "net/url"
  "os"
  "os/exec"
  "path/filepath"
  "sort"
  "strings"
  "syscall"
)

var bundleID = "unbuilt"

func unpack(base string) (string, error) {
  if bundleID == "unbuilt" || len(bundleID) < 12 {
    return "", errors.New("portable browser bundle metadata is missing")
  }
  userCache, err := os.UserCacheDir()
  if err != nil { return "", err }
  cacheBase := filepath.Join(userCache, "dk-kinehall")
  if err = os.MkdirAll(cacheBase, 0700); err != nil { return "", err }
  target := filepath.Join(cacheBase, "runtime-"+bundleID[:20])
  binary := filepath.Join(target, "electron")
  if info, e := os.Stat(binary); e == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0 {
    if _, e := os.Stat(filepath.Join(target, ".complete")); e == nil {
      return binary, nil
    }
  }

  parts, err := filepath.Glob(filepath.Join(base, "_internal", "runtime.tar.gz.*"))
  if err != nil { return "", err }
  sort.Strings(parts)
  if len(parts) == 0 { return "", errors.New("bundled Chromium runtime is missing") }

  files := make([]*os.File, 0, len(parts))
  readers := make([]io.Reader, 0, len(parts))
  for _, p := range parts {
    f, e := os.Open(p)
    if e != nil {
      for _, file := range files { _ = file.Close() }
      return "", e
    }
    files = append(files, f)
    readers = append(readers, f)
  }
  defer func(){ for _, file := range files { _ = file.Close() } }()

  zipped, err := gzip.NewReader(io.MultiReader(readers...))
  if err != nil { return "", err }
  defer zipped.Close()
  tmp, err := os.MkdirTemp(cacheBase, ".unpack-")
  if err != nil { return "", err }
  defer os.RemoveAll(tmp)

  tr := tar.NewReader(zipped)
  for {
    header, e := tr.Next()
    if e == io.EOF { break }
    if e != nil { return "", fmt.Errorf("invalid bundled runtime: %w", e) }
    clean := filepath.Clean(header.Name)
    if clean == "." { continue }
    if filepath.IsAbs(clean) || clean == ".." ||
       strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
      return "", errors.New("invalid runtime archive path")
    }
    filename := filepath.Join(tmp, clean)
    if !strings.HasPrefix(filename, tmp+string(os.PathSeparator)) {
      return "", errors.New("invalid archive path")
    }
    switch header.Typeflag {
    case tar.TypeDir:
      if e := os.MkdirAll(filename, 0700); e != nil { return "", e }
    case tar.TypeReg, tar.TypeRegA:
      if e := os.MkdirAll(filepath.Dir(filename), 0700); e != nil { return "", e }
      output, e := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
      if e != nil { return "", e }
      _, copyErr := io.Copy(output, tr)
      closeErr := output.Close()
      if copyErr != nil { return "", copyErr }
      if closeErr != nil { return "", closeErr }
      mode := os.FileMode(header.Mode) & 0777
      if mode&0111 != 0 {
        if e := os.Chmod(filename, 0700); e != nil { return "", e }
      }
    default:
      return "", fmt.Errorf("unexpected archive entry: %s", header.Name)
    }
  }
  if info, err := os.Stat(filepath.Join(tmp, "electron")); err != nil ||
     !info.Mode().IsRegular() || info.Mode()&0111 == 0 {
    return "", errors.New("bundled browser executable missing after extraction")
  }
  if err := os.WriteFile(filepath.Join(tmp, ".complete"), []byte(bundleID), 0600); err != nil {
    return "", err
  }
  // Another launch may have completed unpacking already.
  if err := os.Rename(tmp, target); err != nil {
    if _, good := os.Stat(filepath.Join(target, ".complete")); good != nil {
      return "", fmt.Errorf("could not prepare portable runtime: %w", err)
    }
  }
  return binary, nil
}

// Provide GNOME with an application icon and a dock launcher without an
// installer, elevated privileges, or an extra download. The ELF remains the
// same direct, double-clickable application in the repository root.
func registerDesktopIcon(executable string) {
  base := filepath.Dir(executable)
  icon := filepath.Join(base, "docs", "icons", "dk-media-player-512.png")
  if stat, err := os.Stat(icon); err != nil || !stat.Mode().IsRegular() { return }
  home, err := os.UserHomeDir()
  if err != nil { return }
  dataHome := os.Getenv("XDG_DATA_HOME")
  if dataHome == "" || !filepath.IsAbs(dataHome) {
    dataHome = filepath.Join(home, ".local", "share")
  }
  appDir := filepath.Join(dataHome, "applications")
  if err := os.MkdirAll(appDir, 0700); err == nil {
    // The application ID and WM_CLASS must match the desktop entry filename.
    // Shell metacharacters in an executable path must remain quoted.
    escaped := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "$", "\\$", "%", "%%").Replace(executable)
    entry := "[Desktop Entry]\n" +
      "Type=Application\n" +
      "Name=DK Kinehall\n" +
      "Name[ru]=ДК Кинехолл\n" +
      "Comment=Play local videos and music\n" +
      "Exec=\"" + escaped + "\"\n" +
      "Icon=" + icon + "\n" +
      "Terminal=false\n" +
      "StartupNotify=true\n" +
      "StartupWMClass=dk-kinehall\n" +
      "Categories=AudioVideo;Video;Player;\n"
    path := filepath.Join(appDir, "dk-kinehall.desktop")
    _ = os.WriteFile(path, []byte(entry), 0644)
  }
  // GNOME Files/Nautilus displays an ELF as a gear unless its per-file icon
  // metadata has been set. This optional operation runs on first launch and
  // does not require any installation, root privileges or internet access.
  if gio, err := exec.LookPath("gio"); err == nil {
    iconURI := (&url.URL{Scheme:"file", Path:icon}).String()
    command := exec.Command(gio, "set", "-t", "string", executable, "metadata::custom-icon", iconURI)
    _ = command.Run()
  }
}

func main() {
  executable, err := os.Executable()
  if err != nil { fmt.Fprintln(os.Stderr, "DK Kinehall:", err); os.Exit(1) }
  base := filepath.Dir(executable)
  registerDesktopIcon(executable)
  runtime, err := unpack(base)
  if err != nil {
    fmt.Fprintln(os.Stderr, "DK Kinehall could not start:", err)
    os.Exit(1)
  }
  // A stock Ubuntu desktop does not allow an uninstalled app to register
  // Chrome's setuid sandbox helper. This player is not a general web browser:
  // the Electron host permits only the local DK Kinehall page.
  // No user installation, system privileges or additional downloads.
  args := append([]string{runtime, "--no-sandbox"}, os.Args[1:]...)
  if err := syscall.Exec(runtime, args, os.Environ()); err != nil {
    fmt.Fprintln(os.Stderr, "DK Kinehall could not launch:", err)
    os.Exit(1)
  }
}
