/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import pluginStyle from "./style.css?managed";

const settings = definePluginSettings({
    idleDelay: {
        type: OptionType.NUMBER,
        description: "Seconds of inactivity before the app blurs, hiding message content from onlookers",
        default: 15,
        markers: [5, 10, 15, 30, 60],
        componentProps: { step: 5 }
    },
    blurRadius: {
        type: OptionType.SLIDER,
        description: "CSS blur radius applied to the app surface while peeking",
        default: 8,
        markers: [0, 4, 8, 12, 20],
        stickToMarkers: true
    },
    blurOnWindowBlur: {
        type: OptionType.BOOLEAN,
        description: "Also blur when the window loses focus (not just after idle)",
        default: true
    },
    showUnreadBadge: {
        type: OptionType.BOOLEAN,
        description: "Keep a visible unread count badge while content is blurred",
        default: true
    }
});

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let blurred = false;

function applyBlur() {
    if (blurred) return;
    blurred = true;
    enableStyle(pluginStyle);
}

function clearBlur() {
    if (!blurred) return;
    blurred = false;
    disableStyle(pluginStyle);
    resetIdle();
}

function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(applyBlur, settings.store.idleDelay * 1000);
}

function setupStyleVars() {
    // Vencord managed styles support runtime CSS vars
    try {
        const appRoot = document.querySelector(".app-1Yzh6") ?? document.body;
        appRoot.setAttribute("data-tired55-peek-blur", String(settings.store.blurRadius));
    } catch { }
}

const bound = {
    onFocus() { clearBlur(); },
    onBlur() { if (settings.store.blurOnWindowBlur) applyBlur(); else resetIdle(); },
    onMouseMove() { if (blurred) clearBlur(); else resetIdle(); },
    onVisibility() {
        if (document.hidden) { if (settings.store.blurOnWindowBlur) applyBlur(); }
        else { clearBlur(); }
    }
};

export default definePlugin({
    name: "PrivacyPeekMode",
    description: "Blurs the Discord surface after a period of inactivity or when the window loses focus, revealing only unread indicators",
    tags: ["Privacy", "Utility"],
    authors: [Devs.tired55],
    settings,

    start() {
        setupStyleVars();
        window.addEventListener("focus", bound.onFocus);
        window.addEventListener("blur", bound.onBlur);
        window.addEventListener("mousemove", bound.onMouseMove);
        document.addEventListener("visibilitychange", bound.onVisibility);
        resetIdle();
    },

    stop() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        window.removeEventListener("focus", bound.onFocus);
        window.removeEventListener("blur", bound.onBlur);
        window.removeEventListener("mousemove", bound.onMouseMove);
        document.removeEventListener("visibilitychange", bound.onVisibility);
        disableStyle(pluginStyle);
        blurred = false;
    }
});
