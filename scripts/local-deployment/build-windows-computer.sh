#!/usr/bin/env bash
set -euo pipefail
app_root=$(realpath -- "${1:?Pass the Linux application checkout with installed dependencies}")
out_dir=$(realpath -m -- "${2:?Pass the Windows-visible output directory in WSL notation}")
work_dir=$(realpath -m -- "${3:?Pass a private build scratch directory}")
mkdir -p "$work_dir" "$out_dir"
node_version=$(node -p 'process.versions.node')
archive="node-v${node_version}-win-x64.zip"
curl -fsSL --retry 2 --connect-timeout 15 --max-time 180 "https://nodejs.org/dist/v${node_version}/${archive}" -o "$work_dir/$archive"
curl -fsSL --retry 2 --connect-timeout 15 --max-time 60 "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$work_dir/SHASUMS256.txt"
# GNU tar in Linux cannot extract the Windows ZIP. Populate the official
# builder's cache with Python before calling the unmodified native builder.
python3 - "$work_dir" "$archive" <<'PY'
from pathlib import Path
import hashlib, sys, zipfile
root, name = Path(sys.argv[1]), sys.argv[2]
expected = next(line.split()[0] for line in (root / 'SHASUMS256.txt').read_text().splitlines() if line.split()[-1] == name)
if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
    raise SystemExit('Official Node archive checksum mismatch')
with zipfile.ZipFile(root / name) as archive:
    archive.extractall(root)
PY
cd "$app_root/packages/computer"
node scripts/native/build.mjs --platform win32 --arch x64 --node-version "$node_version" --out-dir "$out_dir" --work-dir "$work_dir"
