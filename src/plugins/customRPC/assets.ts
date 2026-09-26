/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationAssetUtils, RestAPI } from "@webpack/common";

/** Discord's own media hosts, whose urls can be rewritten into an `mp:` path directly. */
const DISCORD_CDN = /^https?:\/\/(cdn|media)\.discordapp\.(com|net)\//i;

/** external_asset_path values are stable for a given app + url, so resolve each one once. */
const externalAssetCache = new Map<string, string>();

async function resolveExternalAsset(appId: string, url: string): Promise<string | undefined> {
    const cacheKey = `${appId}|${url}`;
    const cached = externalAssetCache.get(cacheKey);
    if (cached) return cached;

    try {
        const response = await RestAPI.post({
            url: `/api/v9/applications/${appId}/external-assets`,
            body: { urls: [url] }
        });

        const asset = response?.assets?.[0] ?? response?.[0];
        const path = asset?.external_asset_path;
        if (typeof path !== "string" || !path) return undefined;

        externalAssetCache.set(cacheKey, path);
        return path;
    } catch (e) {
        console.error(`[CustomRPC] Could not resolve image ${url}`, e);
        return undefined;
    }
}

/**
 * Turns whatever the user typed into a value Discord accepts as an activity
 * asset. Discord does not render raw urls in `large_image`/`small_image`, so an
 * external image has to be handed over as a media proxy path. A bare key is
 * looked up among the application's uploaded assets, and a url that is already
 * an `mp:` path is used as-is.
 */
export async function resolveImage(appId: string | undefined, value: string): Promise<string | undefined> {
    const image = value.trim();
    if (!image) return undefined;
    if (image.startsWith("mp:")) return image;

    if (!/^https?:\/\//i.test(image)) {
        if (!appId) return undefined;
        return (await ApplicationAssetUtils.fetchAssetIds(appId, [image]))[0];
    }

    if (DISCORD_CDN.test(image)) return `mp:${image.replace(DISCORD_CDN, "")}`;
    if (!appId) return undefined;

    return resolveExternalAsset(appId, image);
}
