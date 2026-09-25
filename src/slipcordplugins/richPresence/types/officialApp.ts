/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ActivityPlatform } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";

export interface OfficialApp {
    label: string;
    applicationId: string;
    asset: string;
    type: ActivityType;
    platform?: ActivityPlatform;
}

export const OFFICIAL_APPS = {
    crunchyroll: {
        label: "Crunchyroll",
        applicationId: "981509069309354054",
        asset: "crunchyroll",
        type: ActivityType.WATCHING,
    },
    playstation: {
        label: "PlayStation",
        applicationId: "1470539864909943067",
        asset: "playstation",
        type: ActivityType.PLAYING,
        platform: "playstation",
    },
    xbox: {
        label: "Xbox",
        applicationId: "622174530214821906",
        asset: "xbox",
        type: ActivityType.PLAYING,
        platform: "xbox",
    },
    quest: {
        label: "Meta Quest",
        applicationId: "1417273808645259344",
        asset: "meta",
        type: ActivityType.PLAYING,
        platform: "android",
    },
    roblox: {
        label: "Roblox",
        applicationId: "1005469189907173486",
        asset: "mp:external/4w8kO92Edbe7QjUPQwwm64bFF6mgWZ6ogZQMiftq95Q/https/tr.rbxcdn.com/180DAY-b7317d44fd85c141d154cede4aacf4b0/128/128/Image/Png/noFilter",
        type: ActivityType.PLAYING,
        platform: "desktop",
    },
    twitch: {
        label: "Twitch",
        applicationId: "111299001912",
        asset: "twitch",
        type: ActivityType.STREAMING,
        platform: "web",
    },
    youtube: {
        label: "YouTube",
        applicationId: "111299001912",
        asset: "youtube",
        type: ActivityType.WATCHING,
        platform: "web",
    },
    spotify: {
        label: "Spotify",
        applicationId: "3201606009684",
        asset: "spotify",
        type: ActivityType.LISTENING,
        platform: "desktop",
    },
} satisfies Record<string, OfficialApp>;

export type OfficialAppId = keyof typeof OFFICIAL_APPS;
