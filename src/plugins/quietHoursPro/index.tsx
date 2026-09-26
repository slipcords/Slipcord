/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { GuildStore, UserGuildSettingsStore, moment, Toasts } from "@webpack/common";

const logger = new Logger("QuietHoursPro");
const updateGuildNotificationSettings = findByPropsLazy("updateGuildNotificationSettings") as (guildId: string, settings: Record<string, any>) => void;

const USER_NOTIFICATION_NOTHING = 2;

const settings = definePluginSettings({
    startHour: {
        type: OptionType.SLIDER,
        description: "Hour of day (24h) quiet hours begin",
        default: 23,
        markers: [0, 6, 12, 18, 23],
        stickToMarkers: true
    },
    endHour: {
        type: OptionType.SLIDER,
        description: "Hour of day (24h) quiet hours end",
        default: 8,
        markers: [0, 6, 12, 18, 23],
        stickToMarkers: true
    },
    activeDays: {
        type: OptionType.SELECT,
        description: "Which days quiet hours apply to",
        default: "every",
        options: [
            { label: "Every day", value: "every" },
            { label: "Weekdays (Mon-Fri)", value: "weekdays" },
            { label: "Weekends (Sat-Sun)", value: "weekends" },
            { label: "Sunday only", value: "sun" },
            { label: "Monday only", value: "mon" },
            { label: "Tuesday only", value: "tue" },
            { label: "Wednesday only", value: "wed" },
            { label: "Thursday only", value: "thu" },
            { label: "Friday only", value: "fri" },
            { label: "Saturday only", value: "sat" }
        ]
    },
    muteMentionsToo: {
        type: OptionType.BOOLEAN,
        description: "Suppress @mentions and role pings during quiet hours",
        default: false
    },
    muteVoice: {
        type: OptionType.BOOLEAN,
        description: "Also mute voice channel activity notifications",
        default: true
    }
});

type SavedSettings = Record<string, Record<string, any>>;

let snapshot: SavedSettings = {};
let checkTimer: ReturnType<typeof setInterval> | null = null;

function dayMatches(day: number): boolean {
    const mode = settings.store.activeDays;
    if (mode === "every") return true;
    switch (mode) {
        case "weekdays": return day >= 1 && day <= 5;
        case "weekends": return day === 0 || day === 6;
        case "sun": return day === 0;
        case "mon": return day === 1;
        case "tue": return day === 2;
        case "wed": return day === 3;
        case "thu": return day === 4;
        case "fri": return day === 5;
        case "sat": return day === 6;
        default: return true;
    }
}

function computeIsQuiet(): boolean {
    const now = moment();
    if (!dayMatches(now.day())) return false;
    const hour = now.hour() + now.minute() / 60;
    const start = settings.store.startHour;
    const end = settings.store.endHour;
    if (start <= end) return hour >= start && hour < end;
    return hour >= start || hour < end;
}

const allGuildIds = (): string[] => Object.keys(GuildStore.getGuilds() ?? {});

function enterQuietHours() {
    snapshot = {};
    const all = UserGuildSettingsStore.getAllSettings()?.userGuildSettings ?? {};
    // Snapshot every guild we have settings for (incl. favorited)
    for (const guildId of Object.keys(all)) {
        snapshot[guildId] = { ...all[guildId] };
        try {
            updateGuildNotificationSettings(guildId, {
                muted: true,
                message_notifications: USER_NOTIFICATION_NOTHING,
                suppress_everyone: true,
                suppress_roles: settings.store.muteMentionsToo,
                mute_scheduled_events: settings.store.muteVoice,
                notify_highlights: 0
            });
        } catch (e) {
            logger.error(`Failed to mute guild ${guildId}:`, e);
        }
    }
    DataStore.set("quietHoursSnapshot", snapshot);
    Toasts.show({ message: "Quiet hours started - notifications muted", type: "MESSAGE" as any });
}

async function exitQuietHours() {
    const restored = await DataStore.get<SavedSettings>("quietHoursSnapshot").catch(() => snapshot);
    const source = restored ?? snapshot;
    for (const guildId of Object.keys(source)) {
        try {
            updateGuildNotificationSettings(guildId, source[guildId]);
        } catch (e) {
            logger.error(`Failed to restore guild ${guildId}:`, e);
        }
    }
    snapshot = {};
    Toasts.show({ message: "Quiet hours ended - notifications restored", type: "MESSAGE" as any });
}

function tick() {
    const nowQuiet = computeIsQuiet();
    if (nowQuiet && !snapshotStarted()) {
        enterQuietHours();
    } else if (!nowQuiet && snapshotStarted()) {
        exitQuietHours();
    }
}

function snapshotStarted(): boolean {
    return Object.keys(snapshot).length > 0;
}

export default definePlugin({
    name: "QuietHoursPro",
    description: "Schedule quiet hours that mute all servers and restore them afterwards, with per-day and mention controls",
    tags: ["Notifications", "Servers"],
    authors: [Devs.tired55],
    settings,

    start() {
        tick();
        checkTimer = setInterval(tick, 60000);
    },

    stop() {
        if (checkTimer) clearInterval(checkTimer);
        checkTimer = null;
        if (snapshotStarted()) void exitQuietHours();
        snapshot = {};
    }
});
