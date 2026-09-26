/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Toasts, UserStore, useState } from "@webpack/common";

const logger = new Logger("ReactionPredictionGame");

const settings = definePluginSettings({
    autoPredict: {
        type: OptionType.BOOLEAN,
        description: "Predict the reaction you will give to new messages",
        default: true
    },
    predictSentiment: {
        type: OptionType.BOOLEAN,
        description: "Base predictions on message sentiment instead of reaction history",
        default: true
    },
    predictionExpirySeconds: {
        type: OptionType.NUMBER,
        description: "How long a prediction stays valid before expiring",
        default: 120,
        markers: [30, 60, 120, 300, 600],
        componentProps: { step: 30 }
    },
    toastOnMatch: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when a reaction matches the prediction",
        default: true
    },
    resetStatsOnClear: {
        type: OptionType.BOOLEAN,
        description: "(No-op) keep reset button for future stats UI",
        default: true
    }
});

type PredictionMap = Record<string, { emoji: string; ts: number }>;
type Stats = { attempts: number; hits: number; };

const STORAGE_KEY = "reactionPredictionStats";
const PREDICTION_KEY = "reactionPredictionPending";
let pending: PredictionMap = {};
let stats: Stats = { attempts: 0, hits: 0 };
let pruneTimer: ReturnType<typeof setInterval> | null = null;

const POSITIVE = ["👍", "😊", "😄", "🎉", "🔥", "😍", "🥰"];
const NEGATIVE = ["😢", "😠", "😡", "😞", "😕", "😭"];
const NEUTRAL = ["🤔", "👀", "🤷", "🤷‍♂️", "💯"];

function sentimentEmoji(text: string): string {
    const lower = (text ?? "").toLowerCase();
    let pos = 0, neg = 0;
    for (const w of ["good", "great", "love", "awesome", "amazing", "congrats", "congratulations", "success", "happy", "lmao", "lol", "nice", "pog"]) {
        if (lower.includes(w)) pos++;
    }
    for (const w of ["bad", "terrible", "awful", "hate", "annoying", "stupid", "idiot", "worst", "fail", "sad", "cringe", "cope", "mald", "seethe"]) {
        if (lower.includes(w)) neg++;
    }
    if (pos > neg) return POSITIVE[Math.floor(Math.random() * POSITIVE.length)];
    if (neg > pos) return NEGATIVE[Math.floor(Math.random() * NEGATIVE.length)];
    return NEUTRAL[Math.floor(Math.random() * NEUTRAL.length)];
}

function predictEmoji(message: any): string {
    if (settings.store.predictSentiment) return sentimentEmoji(message?.content);
    // Fallback: most common emoji the user used recently (stored)
    const recent = Object.values(pending);
    if (!recent.length) return "👍";
    const counts: Record<string, number> = {};
    for (const r of recent) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
    let best = "👍", bestCount = 0;
    for (const [e, c] of Object.entries(counts)) {
        if (c > bestCount) { bestCount = c; best = e; }
    }
    return best;
}

function handleCreate(data: any) {
    const msg = data?.message ?? data;
    if (!msg || settings.store.autoPredict === false) return;
    const me = UserStore.getCurrentUser()?.id;
    if (!me || msg.author?.id === me) return; // only predict for others' messages
    if (!msg.content && !msg.attachments?.length) return;
    pending[msg.id] = { emoji: predictEmoji(msg), ts: Date.now() };
}

function handleReactionAdd(data: any) {
    const me = UserStore.getCurrentUser()?.id;
    const userId = data?.user_id ?? data?.userId;
    if (userId !== me) return;
    const msgId = data?.message_id ?? data?.messageId;
    const pred = pending[msgId];
    if (!pred) return;
    stats.attempts++;
    const reactedEmoji = normalizeReaction(data?.emoji?.name ?? data?.emoji, data?.emoji?.id);
    const match = reactedEmoji === pred.emoji;
    if (match) stats.hits++;
    if (settings.store.toastOnMatch && match) {
        Toasts.show({ message: `Prediction hit ${pred.emoji}!`, type: "MESSAGE" as any });
    } else if (!match && settings.store.toastOnMatch && Math.random() < 0.15) {
        Toasts.show({ message: `Missed prediction: you reacted ${reactedEmoji}`, type: "MESSAGE" as any });
    }
    void persistStats();
    delete pending[msgId];
}

function normalizeReaction(emoji: any, id?: string): string {
    if (!emoji && !id) return "👍";
    if (typeof emoji === "string") {
        const m = /^<a?:(\w+):(\d+)>$/.exec(emoji);
        if (m) return m[1];
        return emoji;
    }
    if (emoji?.name) return emoji.name;
    return id ?? "👍";
}

function prunePredictions() {
    const cutoff = Date.now() - settings.store.predictionExpirySeconds * 1000;
    for (const id of Object.keys(pending)) {
        if (pending[id].ts < cutoff) delete pending[id];
    }
}

async function persistStats() {
    await DataStore.set(STORAGE_KEY, stats);
    await DataStore.set(PREDICTION_KEY, pending);
}

function Dashboard() {
    const rate = stats.attempts ? Math.round((stats.hits / stats.attempts) * 100) : 0;
    const [, setTick] = useState(0);
    return (
        <section>
            <Paragraph>
                Predicts which reaction you will give to new messages and scores how often you match the prediction.
            </Paragraph>
            <Paragraph style={{ marginTop: 10 }}>
                Accuracy: {stats.hits} / {stats.attempts} ({rate}%)
            </Paragraph>
            <Button style={{ marginTop: 10 }} onClick={async () => {
                stats = { attempts: 0, hits: 0 };
                pending = {};
                await DataStore.del(STORAGE_KEY);
                await DataStore.del(PREDICTION_KEY);
                setTick(t => t + 1);
            }}>
                Reset stats
            </Button>
        </section>
    );
}

export default definePlugin({
    name: "ReactionPredictionGame",
    description: "Tries to predict the emoji reaction you will give to new messages and scores your accuracy",
    tags: ["Reactions", "Fun"],
    authors: [Devs.tired55],
    settings,

    settingsAboutComponent() {
        return <Dashboard />;
    },

    start() {
        void DataStore.get<Stats>(STORAGE_KEY).then(d => { if (d) stats = d; });
        void DataStore.get<PredictionMap>(PREDICTION_KEY).then(d => { if (d) pending = d; });
        FluxDispatcher.subscribe("MESSAGE_CREATE" as any, handleCreate);
        FluxDispatcher.subscribe("MESSAGE_REACTION_ADD" as any, handleReactionAdd);
        pruneTimer = setInterval(prunePredictions, 30_000);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE" as any, handleCreate);
        FluxDispatcher.unsubscribe("MESSAGE_REACTION_ADD" as any, handleReactionAdd);
        if (pruneTimer) clearInterval(pruneTimer);
        pruneTimer = null;
        void persistStats();
    }
});
