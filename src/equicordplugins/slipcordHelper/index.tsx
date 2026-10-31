/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { Devs, EquicordDevs, GUILD_ID, SUPPORT_CHANNEL_ID, SUPPORT_CHANNEL_IDS, VC_SUPPORT_CHANNEL_IDS } from "@utils/constants";
import { isAnyPluginDev } from "@utils/misc";
import definePlugin from "@utils/types";
import { Alerts, NavigationRouter, UserStore } from "@webpack/common";

import { PluginButtons } from "./pluginButtons";
import { PluginCards } from "./pluginCards";

let clicked = false;

export default definePlugin({
    name: "SlipcordHelper",
    description: "Used to provide support, fix discord caused crashes, and other misc features.",
    tags: ["Utility"],
    dependencies: ["MessageAccessoriesAPI"],
    authors: [
        Devs.thororen,
        Devs.nyx,
        EquicordDevs.Naibuu,
        EquicordDevs.keircn,
        Devs.SerStars,
        EquicordDevs.mart,
        EquicordDevs.omaw,
        Devs.Samwich,
        Devs.AutumnVN,
        EquicordDevs.auggeeo
    ],
    required: true,
    patches: [
        // Fixes Unknown Resolution/FPS Crashing
        {
            find: "Unknown resolution:",
            replacement: [
                {
                    match: /throw Error\(`Unknown resolution: \$\{(\i)\}`\)/,
                    replace: "return $1;"
                },
                {
                    match: /throw Error\(`Unknown frame rate: \$\{(\i)\}`\)/,
                    replace: "return $1;"
                }
            ]
        },
        // Fix a race condition
        {
            find: ".completeOperation(",
            replacement: {
                match: /(?<=this\.nextId\(\);)(\i\(\i\)),(.{0,200}reject:\i\}\))/,
                replace: "$2,$1"
            }
        },
        // Catch IndexedDB if it fails to open
        {
            find: "discarding speculative database",
            replacement: {
                match: /await \i\(\i\)(?=;.{0,15}this\.databases)/,
                replace: "$&.catch(()=>null)"
            }
        },
        {
            find: ".USE_OSX_NATIVE_TRAFFIC_LIGHTS",
            replacement: {
                match: /case \i\.\i\.WINDOWS:/,
                replace: 'case "WEB":'
            },
            predicate: () => Settings.winNativeTitleBar,
        },
        {
            find: '"refresh-title-bar-small"',
            replacement: [
                {
                    match: /\i===\i\.PlatformTypes\.WINDOWS/g,
                    replace: "false"
                },
                {
                    match: /\i===\i\.PlatformTypes\.WEB/g,
                    replace: "true"
                }
            ],
            predicate: () => Settings.winNativeTitleBar,
        },
        // gif-picker context menu doesnt get full context so give it
        {
            find: "renderEmptyFavorite",
            replacement: {
                match: /(?<=handleContextMenu.{0,150})(?=link:(\i)\.url)/,
                replace: "...$1,"
            }
        }
    ],
    renderMessageAccessory(props) {
        return (
            <>
                <PluginButtons message={props.message} />
                <PluginCards message={props.message} />
            </>
        );
    },
    flux: {
        async CHANNEL_SELECT({ channelId }) {
            const isSupportChannel = SUPPORT_CHANNEL_IDS.includes(channelId);
            if (!isSupportChannel) return;

            const selfId = UserStore.getCurrentUser()?.id;
            if (!selfId || isAnyPluginDev(selfId)) return;
            if (VC_SUPPORT_CHANNEL_IDS.includes(channelId) && !clicked) {
                return Alerts.show({
                    title: "Vencord Support Channel Warning",
                    body: "Before asking for help. Check updates and if this issue is actually caused by Slipcord!",
                    confirmText: "Slipcord Support",
                    onConfirm() {
                        NavigationRouter.transitionTo(`/channels/${GUILD_ID}/${SUPPORT_CHANNEL_ID}`);
                    },
                    cancelText: "Okay continue",
                    onCancel() {
                        clicked = true;
                    },
                });
            }
        },
    }
});
