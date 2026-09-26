/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, Toasts } from "@webpack/common";

const logger = new Logger("ThreadContinuationSuggester");

const STOPWORDS = new Set([
    "the", "and", "for", "that", "this", "with", "from", "have", "you", "are", "not",
    "but", "your", "was", "were", "they", "will", "have", "has", "had", "been", "its",
    "their", "what", "when", "where", "will", "would", "could", "should", "than", "then",
    "them", "them", "them", "about", "which", "there", "been"
]);

const settings = definePluginSettings({
    sensitivity: {
        type: OptionType.SLIDER,
        description: "How different a message must be from recent chat to trigger a suggestion (lower = more sensitive)",
        default: 25,
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: true
    },
    cooldownSeconds: {
        type: OptionType.SLIDER,
        description: "Minimum seconds between suggestions per channel",
        default: 300,
        markers: [30, 60, 120, 300, 600, 900],
        stickToMarkers: true
    },
    minMessages: {
        type: OptionType.NUMBER,
        description: "Minimum recent messages required before suggesting",
        default: 6
    },
    windowSize: {
        type: OptionType.NUMBER,
        description: "Number of recent messages compared against",
        default: 12
    }
});

interface RecentMessage {
    channelId: string;
    text: string;
}

const recent: Record<string, RecentMessage[]> = {};
const lastSuggested: Record<string, number> = {};

function tokenize(text: string): Set<string> {
    const words = text.toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(w => w.length > 4 && !STOPWORDS.has(w));
    return new Set(words);
}

function overlap(a: Set<string>, b: Set<string>): number {
    if (!b.size) return 1;
    let matches = 0;
    for (const w of a) if (b.has(w)) matches++;
    return matches / Math.max(a.size, 1);
}

function handleMessage(data: any) {
    const channelId = data?.channel_id ?? data?.channelId ?? data?.channel;
    if (!channelId || !data?.content) return;
    const text = typeof data.content === "string" ? data.content : "";
    const msg: RecentMessage = { channelId, text };

    const win = recent[channelId] ?? [];
    win.push(msg);
    if (win.length > settings.store.windowSize * 2) {
        win.splice(0, win.length - settings.store.windowSize);
    }
    recent[channelId] = win;

    if (win.length < settings.store.minMessages) return;

    const now = Date.now();
    if (now - (lastSuggested[channelId] ?? 0) < settings.store.cooldownSeconds * 1000) return;

    const toCompare = win.slice(-settings.store.windowSize - 1, -1);
    const prior = new Set<string>();
    for (const m of toCompare) tokenize(m.text).forEach(w => prior.add(w));

    const current = tokenize(text);
    const similarity = overlap(current, prior);

    if (similarity * 100 < settings.store.sensitivity) {
        lastSuggested[channelId] = now;
        const channel = ChannelStore.getChannel(channelId);
        const label = channel?.name ?? "this channel";
        Toasts.show({
            message: `Conversation topic shifted in #${label}. Consider continuing in a thread.`,
            type: "MESSAGE" as any,
            id: Toasts.genId()
        });
        logger.log(`Topic drift suggested in ${channelId} (similarity ${Math.round(similarity * 100)}%)`);
    }
}

export default definePlugin({
    name: "ThreadContinuationSuggester",
    description: "Detects when a conversation topic shifts and suggests starting a thread to keep discussions organized",
    tags: ["Chat", "Organisation"],
    authors: [Devs.tired55],
    settings,

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE" as any, handleMessage);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE" as any, handleMessage);
        for (const k of Object.keys(recent)) delete recent[k];
        for (const k of Object.keys(lastSuggested)) delete lastSuggested[k];
    }
});
