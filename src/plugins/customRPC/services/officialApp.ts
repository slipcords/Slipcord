/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityStatusDisplayType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

import { settings } from "..";
import { resolveImage } from "../assets";
import { OFFICIAL_APPS, OfficialApp, OfficialAppId } from "../types/officialApp";

const SOCKET_ID = "RichPresence_OfficialApp";
const logger = new Logger("RichPresence:OfficialApp");

function setActivity(activity: Activity | null) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
}

async function getArt(app: OfficialApp): Promise<string | undefined> {
    const custom = settings.store.oa_imageUrl.trim();
    if (custom) return resolveImage(app.applicationId, custom);
    if (app.asset.startsWith("mp:")) return app.asset;
    try {
        return (await ApplicationAssetUtils.fetchAssetIds(app.applicationId, [app.asset]))[0];
    } catch (e) {
        logger.warn(`Art lookup failed for ${app.label}`, e);
    }
}

async function getActivity(): Promise<Activity | null> {
    const app: OfficialApp = OFFICIAL_APPS[settings.store.oa_app as OfficialAppId] ?? OFFICIAL_APPS.crunchyroll;
    const title = settings.store.oa_title.trim();
    if (!title) return null;

    const duration = Number(settings.store.oa_duration) * 60_000;
    const start = Date.now();
    const activity: Activity = {
        application_id: app.applicationId,
        name: app.label,
        details: title,
        type: app.type,
        flags: ActivityFlags.INSTANCE,
        status_display_type: ActivityStatusDisplayType.DETAILS,
        timestamps: duration > 0 ? { start, end: start + duration } : { start },
    };

    if (settings.store.oa_subtitle.trim()) activity.state = settings.store.oa_subtitle.trim();
    if (app.platform) activity.platform = app.platform;

    const art = settings.store.oa_showArt ? await getArt(app) : undefined;
    if (art) activity.assets = { large_image: art, large_text: title };

    return activity;
}

export async function start() {
    try {
        setActivity(await getActivity());
    } catch (e) {
        logger.error("Failed to build presence", e);
        setActivity(null);
    }
}

export const forceUpdate = start;

export function stop() {
    setActivity(null);
}
