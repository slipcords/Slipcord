/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { DataStore } from "@api/index";
import { SlipcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { MessageJSON } from "@vencord/discord-types";
import { MessageType } from "@vencord/discord-types/enums";
import { RestAPI, UserStore } from "@webpack/common";

const logger = new Logger("AutoReact");

const ReactionType = {
    NORMAL: 0,
    SUPER: 1,
} as const;

interface AutoReactEntry {
    emoji: string;
    super: boolean;
    failures: number;
}

const STORE_KEY = "AutoReact_config";
const autoReacts = new Map<string, AutoReactEntry[]>();

const MAX_CONSECUTIVE_FAILURES = 3;

const CUSTOM_EMOJI_REGEX = /^<a?:(\w+):(\d+)>$/;

async function persist() {
    await DataStore.set(STORE_KEY, Object.fromEntries(autoReacts));
}

async function restore() {
    const data = await DataStore.get<Record<string, AutoReactEntry | AutoReactEntry[]>>(STORE_KEY);
    if (!data) return;
    autoReacts.clear();
    for (const [id, entry] of Object.entries(data)) {
        // older configs stored a single entry per user
        const entries = Array.isArray(entry) ? entry : [entry];
        autoReacts.set(id, entries.map(e => ({ ...e, failures: 0 })));
    }
}

function normalizeEmoji(input: string): { urlPart: string; display: string; } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const custom = CUSTOM_EMOJI_REGEX.exec(trimmed);
    if (custom) {
        const [, name, id] = custom;
        return { urlPart: `${name}:${id}`, display: trimmed };
    }

    return { urlPart: encodeURIComponent(trimmed), display: trimmed };
}

function resolveUser(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const byId = UserStore.getUser(trimmed);
    if (byId) return byId;

    const lower = trimmed.toLowerCase();
    const users = Object.values(UserStore.getUsers()) as any[];
    return (
        users.find(u => u.username?.toLowerCase() === lower) ??
        users.find(u => u.globalName?.toLowerCase() === lower) ??
        null
    );
}

export default definePlugin({
    name: "AutoReact",
    description: "automatically react to messages with a custom emoji, setup using /autoreact",
    tags: ["Reactions", "Utility"],
    authors: [SlipcordDevs.boss],

    commands: [
        {
            name: "autoreact",
            description: "Configure auto-reactions for users. Supports multiple emojis per user. No options to list the current config.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "user",
                    description: "User to auto-react to (defaults to you)",
                    type: ApplicationCommandOptionType.USER,
                    required: false,
                },
                {
                    name: "emoji",
                    description: "Emoji to add to the auto-reactions (unicode or custom <:name:id>). Omit to remove all auto-reactions for the user.",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
                {
                    name: "super",
                    description: "Use a Super (burst) reaction instead of a normal one",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false,
                },
            ],
            execute: async (args, ctx) => {
                const me = UserStore.getCurrentUser();

                const userArg = findOption<string | undefined>(args, "user");
                const emojiArg = findOption<string | undefined>(args, "emoji");
                const superArg = findOption<boolean | undefined>(args, "super");

                const hasAnyInput = userArg != null || emojiArg != null || superArg != null;
                if (!hasAnyInput) {
                    if (autoReacts.size === 0) {
                        sendBotMessage(ctx.channel.id, { content: "No auto-reactions configured." });
                        return;
                    }

                    const lines: string[] = [];
                    for (const [userId, entries] of autoReacts) {
                        const user = UserStore.getUser(userId);
                        const name = user?.username ?? userId;
                        for (const entry of entries) {
                            const kind = entry.super ? " (super)" : "";
                            lines.push(`${name} - ${entry.emoji}${kind}`);
                        }
                    }

                    sendBotMessage(ctx.channel.id, { content: lines.join("\n") + "\n" });
                    return;
                }

                const targetUser = userArg ? resolveUser(userArg) : me;
                if (!targetUser) {
                    sendBotMessage(ctx.channel.id, { content: "Could not resolve that user." });
                    return;
                }

                const targetId = targetUser.id;

                if (emojiArg == null) {
                    const existing = autoReacts.get(targetId);
                    if (existing?.length) {
                        autoReacts.delete(targetId);
                        await persist();
                        sendBotMessage(ctx.channel.id, {
                            content: `Removed ${existing.length} auto-reaction${existing.length === 1 ? "" : "s"} for **${targetUser.username}**.`,
                        });
                    } else {
                        sendBotMessage(ctx.channel.id, {
                            content: `**${targetUser.username}** has no auto-reaction configured.`,
                        });
                    }
                    return;
                }

                const normalized = normalizeEmoji(emojiArg);
                if (!normalized) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid emoji." });
                    return;
                }

                const useSuper = superArg ?? false;
                const entries = autoReacts.get(targetId) ?? [];
                const existingIndex = entries.findIndex(e => e.emoji === normalized.display);

                if (existingIndex !== -1) {
                    entries.splice(existingIndex, 1);
                    if (entries.length === 0) {
                        autoReacts.delete(targetId);
                    } else {
                        autoReacts.set(targetId, entries);
                    }
                    await persist();

                    sendBotMessage(ctx.channel.id, {
                        content: `Removed auto-reaction ${normalized.display} for **${targetUser.username}**. ` +
                            (entries.length === 0
                                ? "They have no auto-reactions left."
                                : `They still auto-react with ${entries.length} emoji${entries.length === 1 ? "" : "s"}.`),
                    });
                    return;
                }

                entries.push({ emoji: normalized.display, super: useSuper, failures: 0 });
                autoReacts.set(targetId, entries);
                await persist();

                sendBotMessage(ctx.channel.id, {
                    content:
                        `Added auto-reaction for **${targetUser.username}** with ${normalized.display}` +
                        (useSuper ? " (super reaction)" : "") +
                        `. They now auto-react with ${entries.length} emoji${entries.length === 1 ? "" : "s"}.`,
                });
            },
        },
    ],

    async start() {
        await restore();
    },

    flux: {
        async MESSAGE_CREATE(event: { message: MessageJSON; channelId: string; optimistic?: boolean; }) {
            const { message } = event;

            if (event.optimistic) return;

            const entries = autoReacts.get(message.author.id);
            if (!entries?.length) return;

            if (message.type !== MessageType.DEFAULT && message.type !== MessageType.REPLY) return;

            const authorName = message.author.username ?? message.author.id;

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (!entry) continue;

                const normalized = normalizeEmoji(entry.emoji);
                if (!normalized) continue;

                const reactionType = entry.super ? ReactionType.SUPER : ReactionType.NORMAL;
                const { channel_id: channelId, id: messageId } = message;

                try {
                    await RestAPI.put({
                        url: `/channels/${channelId}/messages/${messageId}/reactions/${normalized.urlPart}/@me`,
                        query: reactionType === ReactionType.NORMAL ? undefined : { type: reactionType },
                    });

                    if (entry.failures !== 0) {
                        entry.failures = 0;
                        await persist();
                    }

                    logger.info(
                        `Reacted to ${authorName}'s message ${messageId} with ${entry.emoji}` +
                        (entry.super ? " (Super Reaction)" : "")
                    );
                } catch (err: any) {
                    const status = err?.status;
                    const code = err?.body?.code;

                    const isHardFail =
                        status === 403 ||
                        status === 404 ||
                        code === 50013 ||
                        code === 50001 ||
                        code === 40002 ||
                        code === 10008 ||
                        code === 10065 ||
                        code === 50189;

                    if (isHardFail) {
                        entry.failures += 1;

                        logger.warn(
                            `AutoReact failure ${entry.failures}/${MAX_CONSECUTIVE_FAILURES} for ` +
                            `${authorName} with ${entry.emoji} (status=${status}, code=${code}).`
                        );

                        if (entry.failures >= MAX_CONSECUTIVE_FAILURES) {
                            entries.splice(i, 1);
                            i--;
                            if (entries.length === 0) autoReacts.delete(message.author.id);
                            await persist();
                            logger.warn(
                                `Removed auto-reaction ${entry.emoji} for ${authorName} after ` +
                                `${MAX_CONSECUTIVE_FAILURES} consecutive failures.`
                            );
                        } else {
                            await persist();
                        }
                    } else if (status === 429) {
                        logger.warn("Rate limited — reaction was not added.");
                    } else {
                        logger.error("Failed to add reaction:", err);
                    }
                }
            }
        },
    },
});
