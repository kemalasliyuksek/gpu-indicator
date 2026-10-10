// SPDX-License-Identifier: GPL-2.0-or-later
// Infers which GPU the focused application renders on from /proc and /sys.
// Independent of GNOME Shell so it can be exercised from gjs via tools/detect.js.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

export const Gpu = Object.freeze({INTEGRATED: 'integrated', NVIDIA: 'nvidia'});

const NVIDIA_PCI_DRIVER_DIR = '/sys/bus/pci/drivers/nvidia';
const PCI_ADDRESS = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f]$/;

// /dev/nvidiactl and the render node are also opened by processes that merely enumerate GPUs
// (Vulkan/EGL loaders, Electron) while rendering on the integrated GPU. A real context holds a
// device node such as /dev/nvidia0.
const NVIDIA_DEVICE_NODE = /^\/dev\/nvidia\d+$/;

// Upper bound for multi-process applications such as Firefox and Electron apps.
const MAX_TREE_SIZE = 256;

const ENUMERATE_BATCH = 64;

function isCancelled(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// Processes and their files can disappear between listing and reading; those reads are treated
// as empty. Cancellation is propagated so callers can stop.
async function readText(path, cancellable) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
        return new TextDecoder().decode(bytes);
    } catch (error) {
        if (isCancelled(error))
            throw error;
        return null;
    }
}

async function listDir(path, attributes, cancellable) {
    let enumerator;
    try {
        enumerator = await Gio.File.new_for_path(path).enumerate_children_async(attributes,
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (isCancelled(error))
            throw error;
        return [];
    }
    const infos = [];
    try {
        for (;;) {
            const batch = await enumerator.next_files_async(ENUMERATE_BATCH, GLib.PRIORITY_DEFAULT, cancellable);
            if (batch.length === 0)
                break;
            infos.push(...batch);
        }
    } catch (error) {
        if (isCancelled(error))
            throw error;
    } finally {
        enumerator.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
    }
    return infos;
}

async function listNames(path, cancellable) {
    const infos = await listDir(path, 'standard::name', cancellable);
    return infos.map(info => info.get_name());
}

export async function findDgpuPowerStatusPaths(cancellable = null) {
    const names = await listNames(NVIDIA_PCI_DRIVER_DIR, cancellable);
    return names
        .filter(name => PCI_ADDRESS.test(name))
        .map(name => `${NVIDIA_PCI_DRIVER_DIR}/${name}/power/runtime_status`);
}

// A runtime-suspended card has no users, so this settles the common case before any process
// scan. Without an NVIDIA card everything is on the integrated GPU.
export async function isDgpuAsleep(statusPaths, cancellable = null) {
    for (const path of statusPaths) {
        if ((await readText(path, cancellable))?.trim() !== 'suspended')
            return false;
    }
    return true;
}

async function childPids(pid, cancellable) {
    const children = [];
    for (const tid of await listNames(`/proc/${pid}/task`, cancellable)) {
        const text = await readText(`/proc/${pid}/task/${tid}/children`, cancellable);
        if (text)
            children.push(...text.trim().split(/\s+/).filter(Boolean).map(Number));
    }
    return children;
}

async function holdsNvidiaDevice(pid, cancellable) {
    const fds = await listDir(`/proc/${pid}/fd`, 'standard::symlink-target', cancellable);
    return fds.some(info => NVIDIA_DEVICE_NODE.test(info.get_symlink_target() ?? ''));
}

// Breadth-first over the process tree, stopping at the first process with an NVIDIA context.
export async function detectGpu(pid, dgpuStatusPaths, cancellable = null) {
    if (!pid || pid <= 0 || await isDgpuAsleep(dgpuStatusPaths, cancellable))
        return Gpu.INTEGRATED;
    const seen = new Set([pid]);
    const queue = [pid];
    while (queue.length > 0) {
        const current = queue.shift();
        if (await holdsNvidiaDevice(current, cancellable))
            return Gpu.NVIDIA;
        for (const child of await childPids(current, cancellable)) {
            if (!seen.has(child) && seen.size < MAX_TREE_SIZE) {
                seen.add(child);
                queue.push(child);
            }
        }
    }
    return Gpu.INTEGRATED;
}
