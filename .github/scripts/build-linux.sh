#!/bin/sh
# Build and test the Linux binary inside a container (run from the repo root):
# - manylinux_2_28 (AlmaLinux 8, glibc 2.28 like Node 24): gcc-toolset links
#   the newer parts of libstdc++ statically, so the binary needs only the
#   system libstdc++ of RHEL 8.
# - Alpine (musl): node, compiler and libstdc++ from apk.
set -eu

if [ -f /etc/alpine-release ]; then
  apk add --no-cache build-base cmake python3 linux-headers
else
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64) arch=arm64 ;;
    *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
  esac
  # Official Node 24 build (requires glibc 2.28), checksum verified.
  base=https://nodejs.org/dist/latest-v24.x
  sums=$(curl -fsSL "$base/SHASUMS256.txt")
  file=$(echo "$sums" | awk -v suffix="linux-$arch.tar.gz" 'substr($2, length($2) - length(suffix) + 1) == suffix { print $2 }')
  curl -fsSLO "$base/$file"
  echo "$sums" | grep " $file\$" | sha256sum -c -
  tar -xzf "$file" -C /opt
  rm "$file"
  export PATH="/opt/${file%.tar.gz}/bin:$PATH"
fi

echo "node $(node --version), $(gcc --version | head -1), $(cmake --version | head -1)"

npm install
npm run generate-ffi-headers
npm run build

cd tests
npm install
npm test
# Again as in Electron, where external buffers are not allowed.
NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 npm test
