/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isTruthy } from "@utils/guards";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils } from "@webpack/common";

import { resolveImage } from "./assets";
import { anchorFor, Presence } from "./presence";
import { RpcConfig, TimestampMode } from "./types";
import { hasOwnName, lookupOfficialApp, OfficialApp, OfficialAppEntry } from "./types/officialApp";

/** Drops empty values Discord would reject, without touching nested objects. */
function prune(activity: Activity): Activity {
    for (const key in activity) {
        if (key === "type") continue;
        const value = activity[key];
        if (value === undefined || value === null || value === "") delete activity[key];
        else if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) delete activity[key];
    }
    return activity;
}

/** Timestamp of the start of today, so a session that began at 9am does not restart at midnight. */
function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function buildTimestamps(
    presence: Presence,
    { timestampMode, startTime, endTime, timestampLoop }: RpcConfig,
): Activity["timestamps"] {
    switch (timestampMode) {
        case TimestampMode.NOW:
            return { start: anchorFor(presence, TimestampMode.NOW) };
        case TimestampMode.TIME:
            return { start: startOfToday() };
        case TimestampMode.CUSTOM: {
            if (!startTime && !endTime) return undefined;

            if (startTime && endTime && endTime > startTime && timestampLoop) {
                const anchor = anchorFor(presence, TimestampMode.CUSTOM);
                return { start: anchor, end: anchor + (endTime - startTime) };
            }

            const timestamps: { start?: number; end?: number; } = {};
            if (startTime) timestamps.start = startTime;
            if (endTime) timestamps.end = endTime;
            return timestamps;
        }
        default:
            return undefined;
    }
}

export async function buildProfileActivity(presence: Presence, config: RpcConfig): Promise<Activity | undefined> {
    if (!config.appName) return undefined;

    const activity: Activity = {
        application_id: config.appID || "0",
        name: config.appName,
        state: config.state,
        details: config.details,
        type: config.type ?? ActivityType.PLAYING,
        flags: ActivityFlags.INSTANCE,
    };

    if (config.type === ActivityType.STREAMING) activity.url = config.streamLink;

    const timestamps = buildTimestamps(presence, config);
    if (timestamps) activity.timestamps = timestamps;

    if (config.detailsURL) activity.details_url = config.detailsURL;
    if (config.stateURL) activity.state_url = config.stateURL;

    if (config.buttonOneText) {
        activity.buttons = [config.buttonOneText, config.buttonTwoText].filter(isTruthy);
        activity.metadata = {
            button_urls: [config.buttonOneURL, config.buttonTwoURL].filter(isTruthy)
        };
    }

    if (config.imageBig) {
        activity.assets = {
            large_image: await resolveImage(config.appID, config.imageBig),
            large_text: config.imageBigTooltip || undefined,
            large_url: config.imageBigURL || undefined
        };
    }

    if (config.imageSmall) {
        activity.assets = {
            ...activity.assets,
            small_image: await resolveImage(config.appID, config.imageSmall),
            small_text: config.imageSmallTooltip || undefined,
            small_url: config.imageSmallURL || undefined
        };
    }

    if (config.partyMaxSize && config.partySize) {
        activity.party = { size: [config.partySize, config.partyMaxSize] };
    }

    return prune(activity);
}

/** Mirrors the shape a real Spotify listening activity uses: listen-along flags, a sync id and secrets. */
const SPOTIFY_SYNC_ID = "09xhawlPUifhftf8zuie7w";

function buildSpotifyExtras(activity: Activity, title: string, subtitle: string) {
    const sid = SPOTIFY_SYNC_ID;
    const spotifyId = `spotify:${sid}`;

    // PLAY | SYNC, which is what makes the "Listen Along" button appear
    activity.flags = ActivityFlags.PLAY | ActivityFlags.SYNC;
    activity.id = spotifyId;
    activity.sync_id = sid;
    activity.session_id = spotifyId;
    activity.party = { id: spotifyId, size: [1, 1] };
    activity.metadata = {
        context_uri: `spotify:track:${sid}`,
        album_id: sid,
        artist_ids: [sid],
        track_id: sid,
    };
    activity.secrets = { join: spotifyId, spectate: spotifyId, match: spotifyId };

    // the title is already shown as details, so keep the hover text off it
    if (subtitle) activity.assets = { ...activity.assets, large_text: subtitle };
    else if (title) activity.assets = { ...activity.assets, large_text: title };
}

export async function buildOfficialAppActivity(
    presence: Presence,
    entry: OfficialAppEntry,
): Promise<Activity | null> {
    const app: OfficialApp | undefined = lookupOfficialApp(entry.app);
    if (!app) return null;

    const title = entry.title.trim();
    if (!title) return null;

    const duration = Number(entry.duration) * 60_000;

    // "No timer" means no timestamps, not no presence
    const timestamps = buildOfficialAppTimestamps(presence, entry, duration);

    const ownName = hasOwnName(app, entry.name);

    const activity: Activity = {
        name: entry.name?.trim() || app.label,
        details: title,
        type: app.type,
        flags: ActivityFlags.INSTANCE,
    };

    // everything the app owns is only ours to send while we are its registered id
    if (!ownName) activity.application_id = app.applicationId;
    if (!ownName && app.platform) activity.platform = app.platform;

    if (timestamps) activity.timestamps = timestamps;

    if (entry.subtitle.trim()) activity.state = entry.subtitle.trim();

    if (entry.showArt || (ownName && entry.imageUrl.trim())) {
        const art = await resolveArt(entry, ownName ? undefined : app.applicationId, ownName ? undefined : app.asset);
        if (art) activity.assets = { large_image: art, large_text: title };
    }

    if (entry.app === "spotify") buildSpotifyExtras(activity, title, entry.subtitle.trim());

    return prune(activity);
}

function buildOfficialAppTimestamps(
    presence: Presence,
    entry: OfficialAppEntry,
    duration: number,
): Activity["timestamps"] {
    if (entry.timestampMode === "none") return undefined;

    if (entry.timestampMode === "custom") {
        const { startTime, endTime } = entry;

        // an explicit end always wins, otherwise the length in minutes gives us a
        // progress bar, and with neither we just count up from the start
        if (endTime) {
            return startTime ? { start: startTime, end: endTime } : { end: endTime };
        }

        if (startTime) {
            return duration > 0 ? { start: startTime, end: startTime + duration } : { start: startTime };
        }
    }

    // no usable custom range, so fall back to counting from the anchor
    const start = anchorFor(presence, "now");
    return duration > 0 ? { start, end: start + duration } : { start };
}

async function resolveArt(entry: OfficialAppEntry, applicationId: string | undefined, asset: string | undefined) {
    const custom = entry.imageUrl.trim();
    if (custom) return resolveImage(applicationId, custom);
    if (!asset) return undefined;
    if (asset.startsWith("mp:")) return asset;

    try {
        return (await ApplicationAssetUtils.fetchAssetIds(applicationId, [asset]))[0];
    } catch {
        return undefined;
    }
}
