/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings,Settings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic theme rotation",
        default: false,
        restartNeeded: false
    },
    rotationInterval: {
        type: OptionType.SELECT,
        description: "How often to switch themes",
        options: [
            { label: "Every hour", value: 60 * 60 * 1000 },
            { label: "Every 3 hours", value: 3 * 60 * 60 * 1000 },
            { label: "Every 6 hours", value: 6 * 60 * 60 * 1000 },
            { label: "Every 12 hours", value: 12 * 60 * 60 * 1000 },
            { label: "Every day", value: 24 * 60 * 60 * 1000 }
        ],
        default: 6 * 60 * 60 * 1000,
        restartNeeded: false
    },
    rotationMode: {
        type: OptionType.SELECT,
        description: "How to pick the next theme",
        options: [
            { label: "Random", value: "random" },
            { label: "Sequential", value: "sequential" }
        ],
        default: "random",
        restartNeeded: false
    }
});

let rotationTimer: NodeJS.Timeout | null = null;
let themeIndex = 0;
let availableThemes: string[] = [];

async function refreshAvailableThemes() {
    try {
        availableThemes = (await VencordNative.themes.getThemesList()).map(theme => theme.fileName);
    } catch (e) {
        console.error("[ThemeRotator] Could not list themes", e);
        availableThemes = [];
    }
}

function pickNextTheme(currentTheme: string, mode: string): string | null {
    const themes = availableThemes.length ? availableThemes : [...Settings.enabledThemes];
    if (themes.length < 2) return null;

    if (mode === "sequential") {
        const currentIndex = themes.indexOf(currentTheme);
        themeIndex = (currentIndex + 1) % themes.length;
        return themes[themeIndex];
    }

    let next: string;
    do {
        next = themes[Math.floor(Math.random() * themes.length)];
    } while (next === currentTheme && themes.length > 1);
    return next;
}

function scheduleNextRotation() {
    if (rotationTimer) clearTimeout(rotationTimer);
    rotationTimer = setTimeout(rotateTheme, settings.store.rotationInterval);
}

function rotateTheme() {
    const currentTheme = Settings.enabledThemes[0] ?? "";
    const nextTheme = pickNextTheme(currentTheme, settings.store.rotationMode ?? "random");
    if (nextTheme) {
        Settings.enabledThemes = [nextTheme];
    }
    scheduleNextRotation();
}

export default definePlugin({
    name: "ThemeRotator",
    description: "Automatically cycles through your enabled themes on a schedule",
    tags: ["Appearance", "Customisation"],
    authors: [Devs.tired55],
    settings,

    async start() {
        if (!settings.store.enabled) return;
        await refreshAvailableThemes();
        scheduleNextRotation();
    },

    stop() {
        if (rotationTimer) {
            clearTimeout(rotationTimer);
            rotationTimer = null;
        }
    }
});
