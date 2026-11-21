#!/usr/bin/env bash
# Pass a USB webcam (V4L2 device) from the Proxmox host into an LXC.
# Run ON THE PROXMOX HOST as root:
#
#   ./setup-lxc-camera.sh <ctid> [/dev/videoN] [container-gid]
#
#   ctid           — the dashboard container's ID (e.g. 105)
#   /dev/videoN    — host device node (default: /dev/video0)
#   container-gid  — gid that should own the device INSIDE the container
#                    (default: 44 = "video" on Debian/Ubuntu)
#
# Proxmox VE 8.1+ uses native device passthrough (`pct set --devN`), which
# works for privileged and unprivileged containers and handles uid/gid
# mapping. Older versions fall back to raw lxc.* cgroup + bind-mount lines.
# The container must be restarted for the device to appear.
set -euo pipefail

CTID="${1:-}"
DEV="${2:-/dev/video0}"
CGID="${3:-44}"

die() { echo "error: $*" >&2; exit 1; }

[[ -n "$CTID" ]] || die "usage: $0 <ctid> [/dev/videoN] [container-gid]"
[[ $EUID -eq 0 ]] || die "run as root on the Proxmox host"
command -v pct >/dev/null || die "pct not found — run this on the Proxmox host, not in the container"
pct config "$CTID" >/dev/null 2>&1 || die "container $CTID not found"
[[ -c "$DEV" ]] || die "$DEV is not a character device on this host (try: ls -l /dev/video* ; v4l2-ctl --list-devices)"

CONF="/etc/pve/lxc/${CTID}.conf"
MAJOR=$((16#$(stat -c %t "$DEV")))
MINOR=$((16#$(stat -c %T "$DEV")))
echo "host device: $DEV (char $MAJOR:$MINOR)"

if grep -Eq "^dev[0-9]+:.*(path=)?${DEV}([,[:space:]]|$)" "$CONF" \
   || grep -Fq "lxc.mount.entry: ${DEV} " "$CONF"; then
  echo "$DEV is already passed through to CT $CTID — nothing to do."
  exit 0
fi

PVE_VER="$(pveversion | sed -n 's#^pve-manager/\([0-9]*\)\.\([0-9]*\).*#\1 \2#p')"
read -r PVE_MAJOR PVE_MINOR <<<"${PVE_VER:-0 0}"

if (( PVE_MAJOR > 8 || (PVE_MAJOR == 8 && PVE_MINOR >= 1) )); then
  IDX=0
  while grep -q "^dev${IDX}:" "$CONF"; do IDX=$((IDX + 1)); done
  echo "Proxmox ${PVE_MAJOR}.${PVE_MINOR}: adding dev${IDX} (native passthrough, gid=${CGID} in container)"
  pct set "$CTID" "--dev${IDX}" "path=${DEV},gid=${CGID},mode=0660"
else
  echo "Proxmox ${PVE_MAJOR}.${PVE_MINOR}: using legacy lxc.* entries"
  if pct config "$CTID" | grep -q '^unprivileged: 1'; then
    echo "warning: unprivileged CT on PVE < 8.1 — the device will show up owned by nobody:nogroup."
    echo "         Fix on the host with: chmod 0666 $DEV (or a udev rule), or upgrade to PVE 8.1+."
  fi
  NAME="${DEV#/dev/}"
  cat >>"$CONF" <<CONF
lxc.cgroup2.devices.allow: c ${MAJOR}:* rwm
lxc.mount.entry: ${DEV} dev/${NAME} none bind,optional,create=file
CONF
fi

echo
echo "Done. Restart the container to pick it up:"
echo "  pct reboot $CTID"
echo "Then inside the container:"
echo "  ls -l $DEV                       # should exist, group 'video'"
echo "  usermod -aG video dashboard       # let the dashboard service read it"
echo "  systemctl restart homelab-dashboard"
