# GPU Indicator

A GNOME Shell extension for hybrid graphics laptops. A small icon in the top bar shows
whether the focused application is rendering on the integrated GPU or on the NVIDIA GPU:

- chip icon: integrated GPU
- graphics card icon, green: NVIDIA GPU

It follows focus, so switching between windows updates the icon immediately.

## Requirements

- GNOME Shell 50
- An NVIDIA GPU driven by the `nvidia` kernel module (proprietary or open kernel modules)
  with runtime power management, so the card suspends when idle. `nouveau` is not supported.

Tested on one machine: ASUS ROG Strix G18, Ubuntu 26.04, AMD Radeon 610M and RTX 5060
Laptop GPU, NVIDIA driver 595, Wayland session.

## Installation

```
git clone https://github.com/kemalasliyuksek/gpu-indicator.git \
  ~/.local/share/gnome-shell/extensions/gpu-indicator@kemalasliyuksek.com
```

Log out and back in (on Wayland GNOME Shell only picks up new extensions at login), then:

```
gnome-extensions enable gpu-indicator@kemalasliyuksek.com
```

## How it works

A separate tray application cannot do this on Wayland: only the compositor knows which window
has focus. The extension runs inside GNOME Shell, takes the focused window's PID and decides
in two steps:

1. If the NVIDIA card is runtime suspended
   (`/sys/bus/pci/drivers/nvidia/*/power/runtime_status` is `suspended`), nothing is using it
   and the answer is the integrated GPU. This is a single file read.
2. Otherwise it walks the window's process tree (`/proc/<pid>/task/*/children`, which covers
   GPU helper processes of Firefox and Electron apps) and looks for an open NVIDIA device node
   such as `/dev/nvidia0`.

`/dev/nvidiactl` and `/dev/dri/renderD*` are deliberately ignored. Many applications open
them only while enumerating GPUs (Vulkan and EGL loaders do this) and then render on the
integrated GPU.

It runs on every focus change and every two seconds, which catches an application switching
GPU while focused. While the card is suspended each check costs one file read.

## Limitations

- The NVIDIA result is an inference, not a measurement. The NVIDIA driver does not report
  per-process engine usage through DRM fdinfo, so an application that holds an NVIDIA
  context while idle is still shown as NVIDIA.
- Only tested with the setup above. X11 sessions and Intel integrated GPUs have not been
  tried, although nothing in the detection depends on the integrated GPU vendor.

## Development

`gpu.js` does not depend on GNOME Shell and can be run directly:

```
gjs -m tools/detect.js <pid>
```

To see a window rendered on the NVIDIA GPU, start any GTK 4 application with PRIME render
offload:

```
__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia gnome-calculator
```

Shell log: `journalctl --user -f -o cat /usr/bin/gnome-shell`.

## About this project

The idea, design and decisions are mine. Most of the code was written with Claude Code;
I reviewed and tested every change on my own machine.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
