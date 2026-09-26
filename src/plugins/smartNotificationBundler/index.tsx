/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    bundleWindow: {
        type: OptionType.SLIDER,
        description: "Group notifications from the same channel received within this many seconds into a single toast",
        default: 5,
        markers: [0, 2, 5, 10, 15, 30],
        stickToMarkers: true
    },
    maxPerBundle: {
        type: OptionType.NUMBER,
        description: "Maximum notifications to bundle before showing them individually",
        default: 10
    }
});

interface QueuedNotification {
    channelId: string;
    type: string;
    title: string;
    body: string;
    icon: string;
    href: string;
    timestamp: number;
}

let pending: QueuedNotification[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function showNotification(n: QueuedNotification) {
    const channel = ChannelStore.getChannel(n.channelId);
    const label = channel?.name ?? n.title ?? "a channel";
    Toasts.show({
        body: `${n.body} - #${label}`,
        icon: n.icon,
        duration: 5
    });
}

function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!pending.length) return;

    const grouped = new Map<string, QueuedNotification[]>();
    for (const n of pending) {
        (grouped.get(n.channelId) ?? grouped.set(n.channelId, []).get(n.channelId)!).push(n);
    }

    pending = [];

    for (const [channelId, group] of grouped) {
        const channel = ChannelStore.getChannel(channelId);
        if (group.length === 1) {
            showNotification(group[0]);
        } else {
            const label = channel?.name ?? "a channel";
            Toasts.show({
                body: `${group.length} new messages in #${label}`,
                duration: 5
            });
        }
    }
}

function enqueue(data: any) {
    const n: QueuedNotification = {
        channelId: data.channel_id ?? data.channelId ?? "unknown",
        type: data.type ?? "DEFAULT",
        title: data.title ?? "",
        body: data.body ?? "",
        icon: data.icon ?? "",
        href: data.href ?? "",
        timestamp: Date.now()
    };

    pending.push(n);

    // If channel changed from the most recent, flush sooner
    if (pending.length > 1 && pending[pending.length - 2].channelId !== n.channelId) {
        if (flushTimer) clearTimeout(flushTimer);
    }

    if (pending.length >= settings.store.maxPerBundle) {
        flush();
        return;
    }

    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, settings.store.bundleWindow * 1000);
}

export default definePlugin({
    name: "SmartNotificationBundler",
    description: "Groups notifications from the same channel received within a short window into a single toast, reducing notification spam",
    tags: ["Notifications"],
    authors: [Devs.tired55],
    settings,

    start() {
        FluxDispatcher.subscribe("NOTIFICATION_CREATE" as any, enqueue);
    },

    stop() {
        FluxDispatcher.unsubscribe("NOTIFICATION_CREATE" as any, enqueue);
        flush();
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        pending = [];
    }
});
