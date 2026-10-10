// SPDX-License-Identifier: GPL-2.0-or-later
// Infers which GPU the focused application renders on from /proc and /sys.
// Independent of GNOME Shell so it can be exercised from gjs via tools/detect.js.
import GLib from 'gi://GLib';

export const Gpu = Object.freeze({INTEGRATED: 'integrated', NVIDIA: 'nvidia'});

const NVIDIA_PCI_DRIVER_DIR = '/sys/bus/pci/drivers/nvidia';
const PCI_ADDRESS = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f]$/;

// /dev/nvidiactl and the render node are also opened by processes that merely enumerate GPUs
// (Vulkan/EGL loaders, Electron) while rendering on the integrated GPU. A real context holds a
// device node such as /dev/nvidia0.
const NVIDIA_DEVICE_NODE = /^\/dev\/nvidia\d+$/;

// Upper bound for multi-process applications such as Firefox and Electron apps.
const MAX_TREE_SIZE = 256;

function readText(path) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

function listDir(path) {
    let dir;
    try {
        dir = GLib.Dir.open(path, 0);
    } catch {
        return [];
    }
    const names = [];
    for (let name = dir.read_name(); name !== null; name = dir.read_name())
        names.push(name);
    dir.close();
    return names;
}

export function findDgpuPowerStatusPaths() {
    return listDir(NVIDIA_PCI_DRIVER_DIR)
        .filter(name => PCI_ADDRESS.test(name))
        .map(name => `${NVIDIA_PCI_DRIVER_DIR}/${name}/power/runtime_status`);
}

// A runtime-suspended card has no users, so this single file read settles the common case
// before any process scan. Without an NVIDIA card everything is on the integrated GPU.
export function isDgpuAsleep(statusPaths) {
    return statusPaths.every(path => readText(path)?.trim() === 'suspended');
}

function childPids(pid) {
    const children = [];
    for (const tid of listDir(`/proc/${pid}/task`)) {
        const text = readText(`/proc/${pid}/task/${tid}/children`);
        if (text)
            children.push(...text.trim().split(/\s+/).filter(Boolean).map(Number));
    }
    return children;
}

function processTree(rootPid) {
    const seen = new Set([rootPid]);
    const queue = [rootPid];
    while (queue.length > 0 && seen.size < MAX_TREE_SIZE) {
        for (const child of childPids(queue.shift())) {
            if (!seen.has(child)) {
                seen.add(child);
                queue.push(child);
            }
        }
    }
    return seen;
}

function holdsNvidiaDevice(pid) {
    const fdDir = `/proc/${pid}/fd`;
    return listDir(fdDir).some(fd => {
        try {
            return NVIDIA_DEVICE_NODE.test(GLib.file_read_link(`${fdDir}/${fd}`));
        } catch {
            return false;
        }
    });
}

export function detectGpu(pid, dgpuStatusPaths) {
    if (!pid || pid <= 0 || isDgpuAsleep(dgpuStatusPaths))
        return Gpu.INTEGRATED;
    for (const p of processTree(pid)) {
        if (holdsNvidiaDevice(p))
            return Gpu.NVIDIA;
    }
    return Gpu.INTEGRATED;
}
