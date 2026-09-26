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
import { ChannelStore, FluxDispatcher, MessageStore, SelectedChannelStore, useStateFromStores } from "@webpack/common";

const logger = new Logger("SentimentMoodMeter");

const POSITIVE_WORDS = new Set([
    "good", "great", "love", "awesome", "amazing", "fantastic", "happy", "excited",
    "thanks", "thank", "appreciate", "welcome", "congrats", "congratulations", "success",
    "perfect", "nice", "cool", "best", "gg", "ggwp", "pog", "poggers", "based", "fire", "lit"
]);

const NEGATIVE_WORDS = new Set([
    "bad", "terrible", "awful", "hate", "angry", "frustrated", "annoying", "stupid",
    "idiot", "dumb", "worst", "fail", "loser", "cringe", "sad", "cope", "mald",
    "seethe", "mad", "rage", "upset", "disappointed", "trash", "sucks"
]);

const settings = definePluginSettings({
    windowSize: {
        type: OptionType.NUMBER,
        description: "Number of recent messages scored per channel",
        default: 50,
        markers: [10, 25, 50, 100, 200],
        componentProps: { step: 10 }
    },
    decayHours: {
        type: OptionType.SLIDER,
        description: "Ignore messages older than this many hours",
        default: 6,
        markers: [1, 2, 6, 12, 24],
        stickToMarkers: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Skip messages from bots and webhooks",
        default: true
    }
});

interface MoodEntry { score: number; ts: number; authorId: string; content: string; }
type MoodStore = Record<string, MoodEntry[]>;

const STORAGE_KEY = "sentimentMoodMeter";
let moodData: MoodStore = {};

function tokenize(text: string): string[] {
    return (text ?? "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
}

function scoreMessage(content: string): number {
    let score = 0;
    for (const t of tokenize(content)) {
        if (POSITIVE_WORDS.has(t)) score += 1;
        else if (NEGATIVE_WORDS.has(t)) score -= 1;
    }
    return score;
}

function prune(channelId: string) {
    const cutoff = Date.now() - settings.store.decayHours * 3600_000;
    const arr = moodData[channelId];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].ts >= cutoff) { if (i > 0) arr.splice(0, i); break; }
    }
    if (arr && arr.length > settings.store.windowSize) {
        moodData[channelId] = arr.slice(arr.length - settings.store.windowSize);
    }
}

function record(data: any) {
    const msg = data?.message ?? data;
    if (!msg) return;
    if (settings.store.ignoreBots && (msg.author?.bot || msg.webhook_id)) return;
    const channelId = msg.channel_id;
    if (!channelId) return;
    prune(channelId);
    const s = scoreMessage(msg.content ?? "");
    if (!s) return;
    const arr = moodData[channelId] = moodData[channelId] ?? [];
    arr.push({ score: s, ts: Date.now(), authorId: msg.author?.id ?? "", content: msg.content ?? "" });
    void persist();
}

function persist() {
    return DataStore.set(STORAGE_KEY, moodData);
}

function moodForChannel(channelId: string) {
    prune(channelId);
    const arr = moodData[channelId] ?? [];
    if (!arr.length) return { avg: 0, count: 0, label: "neutral", emoji: "😐" };
    const avg = arr.reduce((a, e) => a + e.score, 0) / arr.length;
    let label = "neutral", emoji = "😐";
    if (avg > 0.25) { label = "positive"; emoji = "😊"; }
    else if (avg < -0.25) { label = "negative"; emoji = "😠"; }
    return { avg, count: arr.length, label, emoji };
}

function MoodMeter() {
    // Re-render whenever the message cache changes so the dashboard stays fresh
    useStateFromStores([MessageStore], () => SelectedChannelStore.getLastSelectedChannelId());
    const channelId = SelectedChannelStore.getLastSelectedChannelId();
    const mood = channelId ? moodForChannel(channelId) : { avg: 0, count: 0, label: "no channel selected", emoji: "-" };
    const channelName = channelId ? (ChannelStore.getChannel(channelId)?.name ?? channelId) : "-";

    const top = Object.entries(moodData)
        .map(([cid, entries]) => ({ cid, ...moodForChannel(cid) }))
        .filter(m => m.count > 0)
        .sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg))
        .slice(0, 6);

    return (
        <section>
            <Paragraph>
                Scores messages for simple positive/negative sentiment and tracks a per-channel mood.
            </Paragraph>
            <Paragraph style={{ marginTop: 10 }}>
                Current channel: <strong>{"#" + channelName}</strong> - {mood.emoji} {mood.label} ({mood.count} scored, avg {mood.avg.toFixed(2)})
            </Paragraph>
            <Paragraph style={{ marginTop: 10 }}>
                <strong>Most polarized channels</strong>
            </Paragraph>
            {top.map(m => {
                const ch = ChannelStore.getChannel(m.cid);
                return (
                    <Paragraph key={m.cid} style={{ marginTop: 8 }}>
                        {m.emoji} #{ch?.name ?? m.cid.slice(0, 6)} - {m.label} ({m.count})
                    </Paragraph>
                );
            })}
        </section>
    );
}

export default definePlugin({
    name: "SentimentMoodMeter",
    description: "Scores message sentiment to track per-channel mood and surfaces the most polarized conversations",
    tags: ["Chat", "Fun"],
    authors: [Devs.tired55],
    settings,

    settingsAboutComponent() {
        return <MoodMeter />;
    },

    start() {
        void DataStore.get<MoodStore>(STORAGE_KEY).then(d => { moodData = d ?? {}; });
        FluxDispatcher.subscribe("MESSAGE_CREATE" as any, record);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE" as any, record);
        void persist();
    }
});
