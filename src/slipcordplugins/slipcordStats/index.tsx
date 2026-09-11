/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import messageLoggerEnhanced from "@slipcordplugins/messageLoggerEnhanced";
import { db, initIDB } from "@slipcordplugins/messageLoggerEnhanced/db";
import { SlipcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelStore, UserStore } from "@webpack/common";

interface ChannelCount {
    total: number;
    mine: number;
    since?: number;
}

async function countChannel(channelId: string, myId: string): Promise<ChannelCount> {
    if (!db) await initIDB();
    const index = db!.transaction("messages", "readonly").store.index("by_channel_id");
    let total = 0;
    let mine = 0;
    let since: number | undefined;
    for await (const cursor of index.iterate(channelId)) {
        const { message } = cursor.value;
        total++;
        if (message.author?.id === myId) mine++;
        since ??= Date.parse(message.timestamp);
    }
    return { total, mine, since };
}

export default definePlugin({
    name: "SlipcordStats",
    description: "Shows message stats for the current server or DM, counted from your message log",
    tags: ["Commands", "Utility"],
    authors: [SlipcordDevs.thororen],
    enabledByDefault: true,
    commands: [
        {
            name: "stats",
            description: "Show message stats for this server or DM",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                if (!isPluginEnabled(messageLoggerEnhanced.name)) {
                    return sendBotMessage(ctx.channel.id, { content: "Enable the MessageLoggerEnhanced plugin to power /stats." });
                }

                const channelIds = ctx.guild
                    ? Object.keys(ChannelStore.getMutableGuildChannelsForGuild(ctx.guild.id))
                    : [ctx.channel.id];

                const counts = new Map<string, ChannelCount>();
                for (const id of channelIds) counts.set(id, await countChannel(id, UserStore.getCurrentUser()!.id));

                let total = 0;
                let mine = 0;
                let since: number | undefined;
                for (const c of counts.values()) {
                    total += c.total;
                    mine += c.mine;
                    since = since == null ? c.since : Math.min(since, c.since ?? Infinity);
                }

                if (total === 0) {
                    return sendBotMessage(ctx.channel.id, {
                        content: `${ctx.guild ? `**${ctx.guild.name}**` : "This DM"} has no logged messages yet. Messages count from when MessageLoggerEnhanced started logging.`
                    });
                }

                const top = [...counts.entries()]
                    .sort((a, b) => b[1].total - a[1].total)
                    .slice(0, 5)
                    .map(([id, c]) => `• ${ChannelStore.getChannel(id)?.name ?? id}: ${c.total.toLocaleString()}`)
                    .join("\n");

                const lines = [
                    `**${ctx.guild ? `stats for ${ctx.guild.name}` : "stats for this DM"}**${since ? ` (since ${new Date(since).toLocaleDateString()})` : ""}`,
                    `Messages logged: **${total.toLocaleString()}**`,
                    `Yours: ${mine.toLocaleString()} (${Math.round((mine / total) * 100)}%)`
                ];
                if (ctx.guild && top) lines.push(`\nMost active channels:\n${top}`);

                return sendBotMessage(ctx.channel.id, { content: lines.join("\n") });
            }
        }
    ]
});
