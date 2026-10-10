// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {Gpu, detectGpu, findDgpuPowerStatusPaths} from './gpu.js';

// The GPU can change without a focus change (a game starting, an app waking the dGPU later);
// polling catches that. While the card sleeps each poll is a single file read.
const POLL_INTERVAL_SECONDS = 2;

// The theme gives .system-status-icon inside a panel button 6px padding and 4px margin on each
// side. AppIndicator icons reset this; without the reset the icon sits ~20px wider than its
// neighbours.
const BASE_ICON_STYLE = 'padding: 0; margin: 0;';

// Symbolic icons are tinted by the CSS color. The integrated GPU keeps the panel colour; NVIDIA
// is highlighted because it is the state that costs battery and heat.
const ICON_STYLES = {
    [Gpu.INTEGRATED]: BASE_ICON_STYLE,
    [Gpu.NVIDIA]: `${BASE_ICON_STYLE} color: #76b900;`,
};

const ACCESSIBLE_NAMES = {
    [Gpu.INTEGRATED]: 'Focused application is using the integrated GPU',
    [Gpu.NVIDIA]: 'Focused application is using the NVIDIA GPU',
};

export default class GpuIndicatorExtension extends Extension {
    enable() {
        const iconDir = this.dir.get_child('icons');
        this._icons = {
            [Gpu.INTEGRATED]: Gio.FileIcon.new(iconDir.get_child('gpu-integrated-symbolic.svg')),
            [Gpu.NVIDIA]: Gio.FileIcon.new(iconDir.get_child('gpu-nvidia-symbolic.svg')),
        };
        this._cancellable = new Gio.Cancellable();
        this._dgpuStatusPaths = null;
        this._current = null;
        this._busy = false;
        this._refreshPending = false;

        this._button = new PanelMenu.Button(0.0, this.metadata.name, true);
        // An indicator without a menu: not reactive, so no hover highlight. The padding matches
        // Ubuntu AppIndicator's compact mode so it lines up with neighbouring icons.
        this._button.reactive = false;
        this._button.can_focus = false;
        this._button.style = '-natural-hpadding: 10px;';
        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this._button.add_child(this._icon);
        Main.panel.addToStatusArea(this.uuid, this._button);

        this._focusHandlerId = global.display.connect('notify::focus-window', () => this._refresh());
        this._pollSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this._refresh();
    }

    disable() {
        this._cancellable.cancel();
        global.display.disconnect(this._focusHandlerId);
        GLib.source_remove(this._pollSourceId);
        this._icon.destroy();
        this._button.destroy();
        this._cancellable = null;
        this._button = null;
        this._icon = null;
        this._icons = null;
        this._dgpuStatusPaths = null;
        this._current = null;
    }

    // Detection is asynchronous; at most one runs at a time and a request arriving meanwhile is
    // coalesced into a single follow-up run.
    _refresh() {
        if (this._busy) {
            this._refreshPending = true;
            return;
        }
        this._busy = true;
        const cancellable = this._cancellable;
        this._update(cancellable).catch(error => {
            if (!cancellable.is_cancelled())
                console.error(`${this.metadata.name}: ${error}`);
        }).finally(() => {
            if (cancellable.is_cancelled())
                return;
            this._busy = false;
            if (this._refreshPending) {
                this._refreshPending = false;
                this._refresh();
            }
        });
    }

    async _update(cancellable) {
        this._dgpuStatusPaths ??= await findDgpuPowerStatusPaths(cancellable);
        const pid = global.display.focus_window?.get_pid() ?? 0;
        const gpu = await detectGpu(pid, this._dgpuStatusPaths, cancellable);
        if (cancellable.is_cancelled() || gpu === this._current)
            return;
        this._current = gpu;
        this._icon.gicon = this._icons[gpu];
        this._icon.style = ICON_STYLES[gpu];
        this._button.accessible_name = ACCESSIBLE_NAMES[gpu];
    }
}
