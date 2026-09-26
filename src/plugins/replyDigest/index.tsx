/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, RelationshipStore, Toasts, UserStore, moment } from "@webpack/common";

const logger = new Logger("ReplyDigest");

interface DigestEntry {
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: number;
}

const settings = definePluginSettings({
    digestTime: {
        type: OptionType.STRING,
        description: "Daily time (HH:MM, 24h) to deliver the digest",
        default: "09:00"
    },
    awayThresholdSeconds: {
        type: OptionType.NUMBER,
        description: "Seconds of inactivity before messages are considered 'missed'",
        default: 300,
        markers: [30, 60, 300, 600, 1800],
        componentProps: { step: 30 }
    },
    maxEntries: {
        type: OptionType.NUMBER,
        description: "Maximum entries to keep per delivery",
        default: 40,
        markers: [10, 20, 40, 80, 160],
        componentProps: { step: 10 }
    },
    dmOnly: {
        type: OptionType.BOOLEAN,
        description: "Only digest replies from direct messages",
        default: false
    },
    showEmptyNotice: {
        type: OptionType.BOOLEAN,
        description: "Notify even when the digest is empty",
        default: false
    }
});

const STORAGE_KEY = "replyDigestPending";
let pending: DigestEntry[] = [];
let lastActive = Date.now();
let checkTimer: ReturnType<typeof setInterval> | null = null;
let currentDigestDay = moment().format("YYYY-MM-DD");

function isAway(): boolean {
    return Date.now() - lastActive > settings.store.awayThresholdSeconds * 1000;
}

function isMentioned(msg: any, me: string): boolean {
    if (!msg) return false;
    const mentions = (msg.mentions ?? []).map((m: any) => m?.id ?? m).concat(msg.mention_user_ids ?? []);
    if (mentions.includes(me)) return true;
    if (new RegExp(`@?${me}\\b`).test(msg.content ?? "")) return true;
    return false;
}

function record(msg: any) {
    const me = UserStore.getCurrentUser()?.id;
    if (!msg || !me) return;
    if (!isMentioned(msg, me)) return;
    if (!isAway()) return;
    if (settings.store.dmOnly && (!msg.channel_id || !(ChannelStore.getChannel(msg.channel_id)?.isDM?.()))) return;

    const channel = ChannelStore.getChannel(msg.channel_id);
    pending.push({
        channelId: msg.channel_id,
        channelName: channel?.name ?? UserStore.getUser(channel?.recipients?.[0])?.username ?? channel?.id ?? "DM",
        authorId: msg.author?.id ?? "",
        authorName: msg.author?.username ?? "unknown",
        content: msg.content ?? "",
        timestamp: Date.now()
    });
    if (pending.length > settings.store.maxEntries) pending.shift();
    void DataStore.set(STORAGE_KEY, pending);
}

function deliverDigest() {
    if (!pending.length) {
        if (settings.store.showEmptyNotice) Toasts.show({ message: "Reply digest: no missed @-mentions today", type: "MESSAGE" as any });
        return;
    }
    const byChannel = new Map<string, DigestEntry[]>();
    for (const e of pending) {
        (byChannel.get(e.channelName) ?? byChannel.set(e.channelName, []).get(e.channelName)!).push(e);
    }
    const lines = Array.from(byChannel.entries()).map(([name, entries]) => {
        const authors = [...new Set(entries.map(e => e.authorName))].join(", ");
        const sample = entries[0].content.length > 80 ? entries[0].content.slice(0, 80) + "…" : entries[0].content;
        return `#${name} - ${entries.length} reply/ies from ${authors}: "${sample}"`;
    });
    Toasts.show({
        message: "Reply digest",
        type: "MESSAGE" as any,
        options: { component: lines.join("\n\n") } as any
    });
    logger.log(`Delivered digest of ${pending.length} mentions across ${byChannel.size} conversations`);
    pending = [];
    void DataStore.set(STORAGE_KEY, pending);
}

function maybeDeliver() {
    const now = moment();
    const today = now.format("YYYY-MM-DD");
    if (today !== currentDigestDay) {
        deliverDigest();
        currentDigestDay = today;
        return true;
    }
    const [h, m] = now.format("HH:mm").split(":").map(Number);
    const [dh, dm] = settings.store.digestTime.split(":").map(Number);
    if (h === dh && m === dm) {
        deliverDigest();
        return true;
    }
    return false;
}

export default definePlugin({
    name: "ReplyDigest",
    description: "Delivers a daily digest of @-mentions you missed while away or offline, grouped by conversation",
    tags: ["Notifications", "Organisation"],
    authors: [Devs.tired55],
    settings,

    start() {
        void DataStore.get<DigestEntry[]>(STORAGE_KEY).then(d => { pending = d ?? []; });
        FluxDispatcher.subscribe("MESSAGE_CREATE" as any, record);

        const resetActivity = () => { lastActive = Date.now(); };
        window.addEventListener("focus", resetActivity);
        window.addEventListener("mousemove", resetActivity);
        document.addEventListener("visibilitychange", resetActivity);

        checkTimer = setInterval(() => {
            if (maybeDeliver()) return;
        }, 60000);
        maybeDeliver();

        (this as any).__cleanup = () => {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE" as any, record);
            window.removeEventListener("focus", resetActivity);
            window.removeEventListener("mousemove", resetActivity);
            document.removeEventListener("visibilitychange", resetActivity);
        };
    },

    stop() {
        if (checkTimer) clearInterval(checkTimer);
        (this as any).__cleanup?.();
        void DataStore.set(STORAGE_KEY, pending);
    }
});
