/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, GuildStore, MessageStore, SelectedGuildStore, useStateFromStores } from "@webpack/common";

const logger = new Logger("EmojiEvolutionTracker");

// Matches both animated <a:name:id> and static <:name:id> custom emoji
const CUSTOM_EMOJI = /<a?:([^:]+):(\d+)>/g;
// Matches sequences of one or more Unicode Extended_Pictographic code points
const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;

interface GuildUsage {
    total: number;
    byEmoji: Record<string, number>;
    // day-bucket (YYYY-MM-DD) -> count
    byDay: Record<string, number>;
    lastSeen: number;
}

type UsageStore = Record<string, GuildUsage>;

const STORAGE_KEY = "emojiEvolutionTracker";
let usage: UsageStore = {};

const settings = definePluginSettings({
    trackUnicode: {
        type: OptionType.BOOLEAN,
        description: "Track Unicode emoji in addition to custom server emoji",
        default: true
    },
    retentionDays: {
        type: OptionType.SLIDER,
        description: "How long emoji usage history is kept",
        default: 30,
        markers: [7, 14, 30, 60, 90],
        stickToMarkers: true
    },
    minCount: {
        type: OptionType.NUMBER,
        description: "Minimum uses for an emoji to appear in the leaderboard",
        default: 3,
        markers: [1, 3, 5, 10],
        componentProps: { step: 1 }
    }
});

function now() {
    return Date.now();
}

function dayBucket(ts: number) {
    return new Date(ts).toISOString().slice(0, 10);
}

function guildIdForMessage(msg: any): string {
    const channel = msg.channel_id ? ChannelStore.getChannel(msg.channel_id) : null;
    return channel?.guild_id ?? (msg.guild_id ?? "dm");
}

function ensure(guildId: string): GuildUsage {
    if (!usage[guildId]) {
        usage[guildId] = { total: 0, byEmoji: {}, byDay: {}, lastSeen: now() };
    }
    return usage[guildId];
}

function record(data: any) {
    const msg = data?.message ?? data;
    if (!msg) return;
    if (msg.author?.bot || msg.webhook_id) return;
    const guildId = guildIdForMessage(msg);
    const g = ensure(guildId);
    g.lastSeen = now();

    const text = msg.content ?? "";
    let total = 0;

    let m: RegExpExecArray | null;
    while ((m = CUSTOM_EMOJI.exec(text)) !== null) {
        const [, name, id] = m;
        const full = `<:${name}:${id}>`;
        g.byEmoji[full] = (g.byEmoji[full] ?? 0) + 1;
        total++;
    }

    if (settings.store.trackUnicode) {
        const matches = text.match(UNICODE_EMOJI);
        if (matches) {
            for (const u of matches) {
                g.byEmoji[u] = (g.byEmoji[u] ?? 0) + 1;
                total++;
            }
        }
    }

    if (total > 0) {
        g.total += total;
        const bucket = dayBucket(g.lastSeen);
        g.byDay[bucket] = (g.byDay[bucket] ?? 0) + total;
    }
}

function persist() {
    return DataStore.set(STORAGE_KEY, usage);
}

function prune() {
    const cutoff = now() - settings.store.retentionDays * 86400_000;
    for (const guildId of Object.keys(usage)) {
        const g = usage[guildId];
        const days = Object.keys(g.byDay).filter(d => new Date(d + "T00:00:00").getTime() >= cutoff);
        const next: Record<string, number> = {};
        for (const d of days) next[d] = g.byDay[d];
        g.byDay = next;
    }
}

function emojiLabel(code: string): string {
    const custom = /^<a?:([^:]+):\d+>$/.exec(code);
    return custom ? custom[1] : code;
}

function Dashboard() {
    useStateFromStores([MessageStore], () => SelectedGuildStore.getLastSelectedGuildId());
    prune();
    const guildId = SelectedGuildStore.getLastSelectedGuildId();
    const all = Object.keys(usage).filter(id => id !== "dm");

    const entries = Object.entries(usage)
        .map(([gid, g]) => {
            const name = gid === "dm" ? "Direct Messages" : (GuildStore.getGuild(gid)?.name ?? gid.slice(0, 6));
            return { gid, name, total: g.total, byEmoji: g.byEmoji };
        })
        .sort((a, b) => b.total - a.total);

    const topEmojis: Array<[string, number]> = [];
    for (const { byEmoji } of entries) {
        for (const [e, c] of Object.entries(byEmoji)) {
            topEmojis.push([e, c]);
        }
    }
    topEmojis.sort((a, b) => b[1] - a[1]);
    const top = topEmojis.slice(0, 10).filter(([, c]) => c >= settings.store.minCount);

    const recentDays: Array<[string, number]> = [];
    if (guildId && usage[guildId]) {
        const days = Object.entries(usage[guildId].byDay).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [d, c] of days) recentDays.push([d, c]);
    }

    return (
        <section>
            <Paragraph>
                Tracks emoji usage across your servers so you can see which emoji are on the rise and which are fading out.
            </Paragraph>
            {guildId && usage[guildId] && (
                <>
                    <Paragraph style={{ marginTop: 10 }}>
                        <strong>Emoji trend (last {settings.store.retentionDays} days) - #
                            {GuildStore.getGuild(guildId)?.name ?? guildId.slice(0, 6)}</strong>
                    </Paragraph>
                    {recentDays.length === 0
                        ? <Paragraph>No data yet.</Paragraph>
                        : recentDays.map(([d, c]) => (
                            <Paragraph key={d} style={{ marginTop: 8 }}>
                                {d} - {c} emoji used
                            </Paragraph>
                        ))}
                </>
            )}
            <Paragraph style={{ marginTop: 10 }}>
                <strong>Top emoji across all servers</strong>
            </Paragraph>
            {top.length === 0
                ? <Paragraph>No emoji tracked yet. Start chatting and check back!</Paragraph>
                    : top.map(([e, c]) => (
                        <Paragraph key={e} style={{ marginTop: 8 }}>
                            {emojiLabel(e)} - {c}×
                        </Paragraph>
                    ))}
        </section>
    );
}

export default definePlugin({
    name: "EmojiEvolutionTracker",
    description: "Tracks emoji usage over time to surface rising and declining emoji in your servers",
    tags: ["Emotes", "Fun"],
    authors: [Devs.tired55],
    settings,

    settingsAboutComponent() {
        return <Dashboard />;
    },

    start() {
        void DataStore.get<UsageStore>(STORAGE_KEY).then(d => { usage = d ?? {}; });
        FluxDispatcher.subscribe("MESSAGE_CREATE" as any, record);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE" as any, record);
        void persist();
    }
});
