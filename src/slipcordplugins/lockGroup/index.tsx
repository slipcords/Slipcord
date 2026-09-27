/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { SlipcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";

// Nightcord's autoTranslate helper, kept as an identity function since Slipcord has no translation layer
const t = (text: string) => text;

const lockedGroups = new Set<string>();

const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications on action",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (detailed logs)",
        default: false
    }
});

function log(_message: string, _level: "info" | "warn" | "error" = "info") {
    // Silent in production
}

function debugLog(_message: string) {
    // Silent in production
}

function interceptAddMember(originalMethod: any) {
    return function (this: any, ...args: any[]) {
        const [requestData] = args;
        if (requestData?.url?.match(/^\/channels\/\d+\/recipients\/\d+$/)) {
            const urlParts = requestData.url.split("/");
            const channelId = urlParts[2];
            const targetUserId = urlParts[4];

            if (lockedGroups.has(channelId)) {
                const channel = ChannelStore.getChannel(channelId);
                const currentUserId = UserStore.getCurrentUser()?.id;

                if (channel && channel.type === 3 && channel.ownerId === currentUserId) {
                    debugLog("Owner authorized to add members");
                    return originalMethod.apply(this, args);
                }

                if (channel && channel.type === 3) {
                    const channelName = channel.name || t("Unnamed Group");
                    log(`Unauthorized add detected in "${channelName}" - Auto-kick scheduled`);

                    setTimeout(async () => {
                        try {
                            await RestAPI.del({ url: `/channels/${channelId}/recipients/${targetUserId}` });
                            log(`User ${targetUserId} automatically kicked from locked group`);
                            if (settings.store.showNotifications) {
                                showNotification({
                                    title: `🔒 ${t("LockGroup - Auto-kick")}`,
                                    body: t("Unauthorized member removed from locked group \"{name}\"").replace("{name}", channelName),
                                    icon: undefined
                                });
                            }
                        } catch (error) {
                            log(`Error during auto-kick: ${error}`, "error");
                        }
                    }, 100);

                    if (settings.store.showNotifications) {
                        showNotification({
                            title: `🔒 ${t("LockGroup - Unauthorized Addition")}`,
                            body: t("Unauthorized addition detected in \"{name}\" - Auto-kicking...").replace("{name}", channelName),
                            icon: undefined
                        });
                    }
                }
            }
        }
        return originalMethod.apply(this, args);
    };
}

function toggleGroupLock(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    const currentUserId = UserStore.getCurrentUser()?.id;

    if (!channel || channel.type !== 3 || !currentUserId) return;

    const channelName = channel.name || t("Unnamed Group");

    if (channel.ownerId !== currentUserId) {
        if (settings.store.showNotifications) {
            showNotification({
                title: `❌ ${t("LockGroup")}`,
                body: t("Only the group owner can lock/unlock the group"),
                icon: undefined
            });
        }
        return;
    }

    const isCurrentlyLocked = lockedGroups.has(channelId);

    if (isCurrentlyLocked) {
        lockedGroups.delete(channelId);
        log(`Group "${channelName}" unlocked`);
        if (settings.store.showNotifications) {
            showNotification({
                title: `🔓 ${t("LockGroup")}`,
                body: t("Group \"{name}\" unlocked - Member additions allowed").replace("{name}", channelName),
                icon: undefined
            });
        }
    } else {
        lockedGroups.add(channelId);
        log(`Group "${channelName}" locked`);
        if (settings.store.showNotifications) {
            showNotification({
                title: `🔒 ${t("LockGroup")}`,
                body: t("Group \"{name}\" locked - Member additions blocked").replace("{name}", channelName),
                icon: undefined
            });
        }
    }
}

const LockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z" />
    </svg>
);

const UnlockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z" />
    </svg>
);

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel || channel.type !== 3) return;

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (channel.ownerId !== currentUserId) return;

    const isLocked = lockedGroups.has(channel.id);
    const group = findGroupChildrenByChildId("leave-channel", children);

    if (group) {
        const menuItems: any[] = [<Menu.MenuSeparator key="separator" />];

        if (!isLocked) {
            menuItems.push(
                <Menu.MenuItem
                    key="lock-group"
                    id="vc-lock-group"
                    label={t("Lock Group")}
                    color="danger"
                    action={() => toggleGroupLock(channel.id)}
                    icon={LockIcon}
                />
            );
        } else {
            menuItems.push(
                <Menu.MenuItem
                    key="unlock-group"
                    id="vc-unlock-group"
                    label={t("Unlock Group")}
                    color="brand"
                    action={() => toggleGroupLock(channel.id)}
                    icon={UnlockIcon}
                />
            );
        }

        group.push(...menuItems);
    }
};

let originalPutMethod: any = null;

export default definePlugin({
    name: "LockGroup",
    enabledByDefault: true,
    description: "Lock/unlock groups via the context menu (prevents adding members)",
    authors: [SlipcordDevs.Bash],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch,
        "channel-context": GroupContextMenuPatch
    },

    flux: {
        MESSAGE_CREATE(event: { message: any; }) {
            const { message } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;

            if (message && message.type === 1) {
                const channelId = message.channel_id;
                if (lockedGroups.has(channelId)) {
                    const channel = ChannelStore.getChannel(channelId);
                    if (channel && channel.type === 3 && channel.ownerId === currentUserId) {
                        const channelName = channel.name || t("Unnamed Group");
                        const addedUserId = message.mentions?.[0]?.id;
                        const addedByUserId = message.author?.id;

                        if (addedByUserId === currentUserId) {
                            debugLog("Added by owner - Allowed");
                            return;
                        }

                        if (addedUserId && addedByUserId !== currentUserId) {
                            setTimeout(async () => {
                                try {
                                    await RestAPI.del({ url: `/channels/${channelId}/recipients/${addedUserId}` });
                                    log(`Security kick performed for ${addedUserId}`);
                                } catch (error) {
                                    debugLog(`Security kick error: ${error}`);
                                }
                            }, 150);

                            if (settings.store.showNotifications) {
                                showNotification({
                                    title: `🔒 ${t("LockGroup - Unauthorized Addition")}`,
                                    body: t("Unauthorized member added to \"{name}\" and was removed").replace("{name}", channelName),
                                    icon: undefined
                                });
                            }
                        }
                    }
                }
            }
        }
    },

    start() {
        log("Plugin LockGroup started");
        if (RestAPI && RestAPI.put) {
            originalPutMethod = RestAPI.put;
            RestAPI.put = interceptAddMember(originalPutMethod);
        }
    },

    stop() {
        log("Plugin LockGroup stopped");
        if (originalPutMethod && RestAPI) {
            RestAPI.put = originalPutMethod;
            originalPutMethod = null;
        }
        lockedGroups.clear();
    }
});
