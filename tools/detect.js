// SPDX-License-Identifier: GPL-2.0-or-later
// Runs detection without GNOME Shell: gjs -m tools/detect.js <pid>
import {detectGpu, findDgpuPowerStatusPaths, isDgpuAsleep} from '../gpu.js';

const pid = Number(ARGV[0]);
const paths = await findDgpuPowerStatusPaths();
print(`dGPU status files: ${paths.join(', ') || '(none)'}`);
print(`dGPU asleep: ${await isDgpuAsleep(paths)}`);
print(`pid ${pid}: ${await detectGpu(pid, paths)}`);
