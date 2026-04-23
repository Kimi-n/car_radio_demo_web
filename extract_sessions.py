#!/usr/bin/env python3
"""Extract videos and sessionId log files from a zip/rar archive.

Usage:
    python extract_sessions.py <archive.zip|archive.rar> [--output-dir DIR]

Behavior:
    1. Extracts the archive to a temporary directory.
    2. Auto-detects whether the archive's first layer is a same-named folder.
    3. Copies all top-level video files into the output directory.
    4. Scans every .gz file under the "日志" subdirectory, searching for
       "currentDirectiveSet:sessionId=<VALUE>,..." and extracting <VALUE>.
    5. For each unique sessionId, writes a file named <VALUE> containing
       all matching log lines.
    6. Output goes to <archive-parent>/<archive-stem>/ (with timestamp suffix
       on conflict). Temporary files are deleted on exit.
"""

import argparse
import gzip
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv",
    ".ts", ".webm", ".m4v", ".mpg", ".mpeg", ".3gp",
}
LOG_DIR_NAME = "日志"
SESSION_PATTERN = re.compile(r"currentDirectiveSet:sessionId\s*=\s*([^,\r\n]*)")
INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
MAX_FILENAME_LEN = 200

log = logging.getLogger("extract_sessions")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract videos and sessionId log files from a zip/rar archive."
    )
    parser.add_argument("archive", help="Path to the zip or rar archive")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Output base directory (default: same directory as the archive)",
    )
    return parser.parse_args()


def find_7z():
    """Locate 7z.exe — PATH first, then common install locations."""
    path = shutil.which("7z") or shutil.which("7z.exe")
    if path:
        return path
    common = [
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ]
    for candidate in common:
        if os.path.isfile(candidate):
            return candidate
    return None


def extract_archive(archive_path: Path, dest_dir: Path) -> None:
    """Dispatch to the right extractor based on file extension."""
    ext = archive_path.suffix.lower()
    if ext == ".zip":
        _extract_zip(archive_path, dest_dir)
    elif ext == ".rar":
        _extract_with_7z(archive_path, dest_dir)
    else:
        log.info("Unknown extension %s, trying 7z fallback", ext)
        _extract_with_7z(archive_path, dest_dir)


def _extract_zip(archive_path: Path, dest_dir: Path) -> None:
    """Extract zip, attempting to fix non-UTF-8 Chinese filenames."""
    with zipfile.ZipFile(archive_path) as zf:
        for info in zf.infolist():
            raw_name = info.filename
            # Bit 0x800 in flag_bits signals UTF-8 filenames. If not set, the
            # bytes were decoded as cp437 by zipfile — re-decode as GBK (or
            # UTF-8) for Chinese-language archives produced on Windows.
            if not info.flag_bits & 0x800:
                try:
                    raw_bytes = raw_name.encode("cp437")
                except UnicodeEncodeError:
                    raw_bytes = None
                if raw_bytes:
                    for enc in ("gbk", "utf-8"):
                        try:
                            raw_name = raw_bytes.decode(enc)
                            break
                        except UnicodeDecodeError:
                            continue
            info.filename = raw_name
            zf.extract(info, dest_dir)


def _extract_with_7z(archive_path: Path, dest_dir: Path) -> None:
    """Extract via the 7z.exe command line."""
    seven_zip = find_7z()
    if not seven_zip:
        raise RuntimeError(
            "7-Zip not found. Install 7-Zip from https://www.7-zip.org/ "
            "and ensure 7z.exe is on PATH or in the default install location."
        )
    cmd = [seven_zip, "x", str(archive_path), f"-o{dest_dir}", "-y"]
    log.debug("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"7z extraction failed (exit {result.returncode}): "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )


def normalize_layout(extract_dir: Path) -> Path:
    """Return the real content root.

    If the archive's first layer is a single directory that holds the actual
    payload (the common case), return that directory. Otherwise return the
    extract directory itself (fallback for archives without a wrapper dir).
    """
    entries = list(extract_dir.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        inner = entries[0]
        if (inner / LOG_DIR_NAME).is_dir() or _has_video(inner):
            return inner
    return extract_dir


def _has_video(directory: Path) -> bool:
    for entry in directory.iterdir():
        if entry.is_file() and entry.suffix.lower() in VIDEO_EXTENSIONS:
            return True
    return False


def find_videos(content_root: Path) -> list:
    """Top-level video files only (non-recursive, per spec: '同层')."""
    return sorted(
        entry for entry in content_root.iterdir()
        if entry.is_file() and entry.suffix.lower() in VIDEO_EXTENSIONS
    )


def find_log_dir(content_root: Path):
    candidate = content_root / LOG_DIR_NAME
    return candidate if candidate.is_dir() else None


def decode_bytes(data: bytes) -> str:
    """Decode log bytes with UTF-8 → GBK → replace fallback."""
    for enc in ("utf-8", "gbk"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_session_id(line: str):
    """Return the sessionId value from a line, or None if not found / empty."""
    match = SESSION_PATTERN.search(line)
    if not match:
        return None
    value = match.group(1).strip()
    return value or None


def scan_gz_for_sessions(log_dir: Path) -> dict:
    """Return {sessionId: [matching lines...]}, preserving first-seen order."""
    results = {}
    gz_files = sorted(log_dir.glob("*.gz"))
    if not gz_files:
        log.warning("No .gz files found in %s", log_dir)
        return results
    for gz_path in gz_files:
        try:
            with gzip.open(gz_path, "rb") as fh:
                data = fh.read()
        except OSError as e:
            log.warning("Failed to read %s: %s", gz_path.name, e)
            continue
        text = decode_bytes(data)
        for line in text.splitlines():
            session_id = extract_session_id(line)
            if session_id is None:
                continue
            results.setdefault(session_id, []).append(line)
    return results


def sanitize_filename(name: str) -> str:
    sanitized = INVALID_FILENAME_CHARS.sub("_", name).strip().strip(".")
    if not sanitized:
        sanitized = "_"
    if len(sanitized) > MAX_FILENAME_LEN:
        sanitized = sanitized[:MAX_FILENAME_LEN]
    return sanitized


def resolve_output_dir(output_base: Path, archive_stem: str) -> Path:
    """Pick an output path, adding a timestamp suffix on conflict."""
    target = output_base / archive_stem
    if not target.exists():
        return target
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return output_base / f"{archive_stem}_{stamp}"


def build_output(output_dir: Path, videos: list, sessions: dict) -> None:
    output_dir.mkdir(parents=True, exist_ok=False)

    for video in videos:
        dest = output_dir / video.name
        shutil.copy2(video, dest)
        log.info("Copied video: %s", video.name)

    for session_id, lines in sessions.items():
        safe_name = sanitize_filename(session_id)
        if safe_name != session_id:
            log.warning(
                "sessionId contains invalid filename chars; using '%s' instead of '%s'",
                safe_name, session_id,
            )
        target = output_dir / safe_name
        # Defensive: if two sessionIds collapse to the same safe name, append lines
        mode = "a" if target.exists() else "w"
        with open(target, mode, encoding="utf-8", newline="\n") as fh:
            for line in lines:
                fh.write(line)
                fh.write("\n")
        log.info("Wrote sessionId file: %s (%d line(s))", safe_name, len(lines))


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(message)s",
    )
    args = parse_args()

    archive_path = Path(args.archive).expanduser().resolve()
    if not archive_path.is_file():
        log.error("Archive not found: %s", archive_path)
        return 1

    output_base = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir else archive_path.parent
    )
    output_base.mkdir(parents=True, exist_ok=True)

    temp_dir = Path(tempfile.mkdtemp(prefix="extract_sessions_"))
    log.info("Temp extract dir: %s", temp_dir)
    try:
        log.info("Extracting %s", archive_path.name)
        extract_archive(archive_path, temp_dir)

        content_root = normalize_layout(temp_dir)
        log.info("Content root: %s", content_root)

        videos = find_videos(content_root)
        log.info("Found %d video file(s)", len(videos))

        log_dir = find_log_dir(content_root)
        if log_dir is None:
            log.warning("Log directory '%s' not found under content root", LOG_DIR_NAME)
            sessions = {}
        else:
            log.info("Scanning log directory: %s", log_dir)
            sessions = scan_gz_for_sessions(log_dir)
        log.info("Found %d unique sessionId(s)", len(sessions))

        output_dir = resolve_output_dir(output_base, archive_path.stem)
        log.info("Output directory: %s", output_dir)
        build_output(output_dir, videos, sessions)

        log.info(
            "Done. %d video(s), %d sessionId file(s) → %s",
            len(videos), len(sessions), output_dir,
        )
        return 0
    except Exception as e:
        log.error("Fatal error: %s", e)
        return 2
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
