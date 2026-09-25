/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationAssetUtils } from "@webpack/common";

/**
 * Turns whatever the user typed into a value Discord accepts as an activity
 * asset. A URL is passed straight through, since the client proxies it; a bare
 * key is looked up among the application's uploaded assets.
 */
export async function resolveImage(appId: string | undefined, value: string): Promise<string | undefined> {
    const image = value.trim();
    if (!image) return undefined;
    if (/^https?:\/\//i.test(image)) return image;
    if (!appId) return undefined;

    return (await ApplicationAssetUtils.fetchAssetIds(appId, [image]))[0];
}
