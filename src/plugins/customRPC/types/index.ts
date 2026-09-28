/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ActivityType } from "@vencord/discord-types/enums";

export enum ServiceTab {
    AudioBookShelf = "audiobookshelf",
    Tosu = "tosu",
    StatsFm = "statsfm",
    Jellyfin = "jellyfin",
    GensokyoRadio = "gensokyoRadio",
    Navidrome = "navidrome",
    OfficialApp = "officialApp",
}

export const enum NameFormat {
    StatusName = "status-name",
    ArtistFirst = "artist-first",
    SongFirst = "song-first",
    ArtistOnly = "artist",
    SongOnly = "song",
    AlbumName = "album",
}

export const enum TimestampMode {
    NONE,
    NOW,
    TIME,
    CUSTOM,
}

export const TIMESTAMP_MODE_OPTIONS = [
    { label: "None", value: TimestampMode.NONE, default: true },
    { label: "Since Discord open", value: TimestampMode.NOW },
    { label: "Same as your current time (not reset after 24h)", value: TimestampMode.TIME },
    { label: "Custom", value: TimestampMode.CUSTOM },
];

export const ACTIVITY_TYPE_LABELS: Record<number, string> = {
    [ActivityType.PLAYING]: "Playing",
    [ActivityType.STREAMING]: "Streaming",
    [ActivityType.LISTENING]: "Listening",
    [ActivityType.WATCHING]: "Watching",
    [ActivityType.COMPETING]: "Competing",
};

/** The activity types a custom presence is allowed to claim, one slot each. */
export const CLAIMABLE_TYPES: ActivityType[] = [
    ActivityType.PLAYING,
    ActivityType.STREAMING,
    ActivityType.LISTENING,
    ActivityType.WATCHING,
    ActivityType.COMPETING,
];

export interface RpcConfig {
    appID?: string;
    appName?: string;
    details?: string;
    detailsURL?: string;
    state?: string;
    stateURL?: string;
    type?: ActivityType;
    streamLink?: string;
    timestampMode?: TimestampMode;
    startTime?: number;
    endTime?: number;
    timestampLoop?: boolean;
    imageBig?: string;
    imageBigURL?: string;
    imageBigTooltip?: string;
    imageSmall?: string;
    imageSmallURL?: string;
    imageSmallTooltip?: string;
    buttonOneText?: string;
    buttonOneURL?: string;
    buttonTwoText?: string;
    buttonTwoURL?: string;
    partySize?: number;
    partyMaxSize?: number;
}

/** A custom presence. Several can be active at once, as long as no two share an activity type. */
export interface RpcProfile {
    id: string;
    name: string;
    enabled: boolean;
    config: RpcConfig;
}
