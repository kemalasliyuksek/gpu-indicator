// SPDX-License-Identifier: GPL-2.0-or-later
// Runs detection without GNOME Shell: gjs -m tools/detect.js <pid>
import {detectGpu, findDgpuPowerStatusPaths, isDgpuAsleep} from '../gpu.js';

const pid = Number(ARGV[0]);
const paths = findDgpuPowerStatusPaths();
print(`dGPU status files: ${paths.join(', ') || '(none)'}`);
print(`dGPU asleep: ${isDgpuAsleep(paths)}`);
print(`pid ${pid}: ${detectGpu(pid, paths)}`);
