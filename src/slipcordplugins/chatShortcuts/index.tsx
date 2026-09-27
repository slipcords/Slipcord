/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { SlipcordDevs } from "@utils/constants";
import { getCurrentChannel, insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { MessageJSON } from "@vencord/discord-types";
import { MessageType } from "@vencord/discord-types/enums";
import { findByPropsLazy } from "@webpack";
import { MessageStore, React, TextInput, UserStore, useState } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

let lastPingedUserId: string | null = null;
let channelLastMessages: Record<string, string> = {};

function getKeyName(event: KeyboardEvent): string | null {
    const { key } = event;
    if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
    if (key === " ") return "Space";
    if (key === "Escape") return "Esc";
    if (key.length === 1) return key.toUpperCase();
    return key;
}

function normalizeKey(key: string): string {
    return key
        .trim()
        .split("+")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const lower = part.toLowerCase();
            switch (lower) {
                case "control":
                case "ctrl":
                    return "Ctrl";
                case "shift":
                    return "Shift";
                case "alt":
                    return "Alt";
                case "meta":
                case "cmd":
                case "command":
                    return "Meta";
                case "space":
                    return "Space";
                case "escape":
                case "esc":
                    return "Esc";
                default:
                    return part.length === 1 ? part.toUpperCase() : part;
            }
        })
        .join("+");
}

function eventToCombination(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");

    let { key } = event;
    if (key === " ") key = "Space";
    else if (key === "Escape") key = "Esc";
    else if (key.length === 1) key = key.toUpperCase();

    parts.push(key);
    return parts.join("+");
}

function KeyInput({ value, onChange }: { value: string; onChange(value: string): void; }) {
    const [listening, setListening] = useState(false);

    function handleKeyDown(event: React.KeyboardEvent) {
        event.preventDefault();
        event.stopPropagation();

        const parts: string[] = [];
        if (event.ctrlKey) parts.push("Ctrl");
        if (event.altKey) parts.push("Alt");
        if (event.shiftKey) parts.push("Shift");
        if (event.metaKey) parts.push("Meta");

        const key = getKeyName(event.nativeEvent);
        if (!key) return;

        parts.push(key);
        onChange(parts.join("+"));
        setListening(false);
    }

    return (
        <TextInput
            placeholder="Click and press a key combination..."
            value={listening ? "Press a key..." : value}
            onKeyDown={handleKeyDown}
            onFocus={() => setListening(true)}
            onBlur={() => setListening(false)}
            readOnly
            spellCheck={false}
        />
    );
}

const settings = definePluginSettings({
    quickPasteEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Quick Paste: re-inserts the last message you sent in the current channel into the chat input when the keybind is pressed.",
        default: true,
    },
    quickPasteKeybind: {
        type: OptionType.COMPONENT,
        component: () => {
            const { quickPasteKeybindValue } = settings.use(["quickPasteKeybindValue"]);
            return <KeyInput value={quickPasteKeybindValue} onChange={v => { settings.store.quickPasteKeybindValue = v; }} />;
        },
    },
    quickPasteKeybindValue: {
        type: OptionType.CUSTOM,
        description: "Stored keybind for this shortcut",
        default: "Ctrl+L",
    },
    quickLastMentionEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Quick Last Mention: re-inserts the last user you mentioned into the chat input when the keybind is pressed.",
        default: true,
    },
    quickLastMentionKeybind: {
        type: OptionType.COMPONENT,
        component: () => {
            const { quickLastMentionKeybindValue } = settings.use(["quickLastMentionKeybindValue"]);
            return <KeyInput value={quickLastMentionKeybindValue} onChange={v => { settings.store.quickLastMentionKeybindValue = v; }} />;
        },
    },
    quickLastMentionKeybindValue: {
        type: OptionType.CUSTOM,
        description: "Stored keybind for this shortcut",
        default: "Ctrl+M",
    },
    deleteLastMessageEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Delete Last Message: deletes your most recent message you sent in the current channel when the keybind is pressed. Press repeatedly to keep deleting your messages.",
        default: true,
    },
    deleteLastMessageKeybind: {
        type: OptionType.COMPONENT,
        component: () => {
            const { deleteLastMessageKeybindValue } = settings.use(["deleteLastMessageKeybindValue"]);
            return <KeyInput value={deleteLastMessageKeybindValue} onChange={v => { settings.store.deleteLastMessageKeybindValue = v; }} />;
        },
    },
    deleteLastMessageKeybindValue: {
        type: OptionType.CUSTOM,
        description: "Stored keybind for this shortcut",
        default: "Delete",
    },
});

function isIgnoredTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
    if (target.isContentEditable && target.getAttribute("role") !== "textbox") return true;
    return false;
}

function findLastOwnMessageId(channelId: string): string | null {
    const me = UserStore.getCurrentUser();
    if (!me) return null;

    const messages = MessageStore.getMessages(channelId) as any;
    if (!messages) return null;

    const all = typeof messages.toArray === "function"
        ? messages.toArray()
        : Array.from(messages._array ?? messages.array ?? []);

    for (let i = all.length - 1; i >= 0; i--) {
        const msg = all[i];
        if (!msg || msg.author?.id !== me.id) continue;
        if (msg.type !== MessageType.DEFAULT && msg.type !== MessageType.REPLY) continue;
        if (msg.deleted) continue;
        return msg.id;
    }

    return null;
}

function onKeyDown(e: KeyboardEvent): void {
    if (isIgnoredTarget(e.target)) return;

    const combination = eventToCombination(e);

    if (settings.store.quickPasteEnabled) {
        const configured = normalizeKey(settings.store.quickPasteKeybindValue);
        if (combination === configured) {
            const channel = getCurrentChannel();
            if (channel) {
                const text = channelLastMessages[channel.id];
                if (text) {
                    e.preventDefault();
                    e.stopPropagation();
                    insertTextIntoChatInputBox(text);
                    return;
                }
            }
        }
    }

    if (settings.store.quickLastMentionEnabled) {
        const configured = normalizeKey(settings.store.quickLastMentionKeybindValue);
        if (combination === configured && lastPingedUserId) {
            e.preventDefault();
            e.stopPropagation();
            insertTextIntoChatInputBox(`<@${lastPingedUserId}> `);
            return;
        }
    }

    if (settings.store.deleteLastMessageEnabled) {
        const configured = normalizeKey(settings.store.deleteLastMessageKeybindValue);
        if (combination === configured) {
            const channel = getCurrentChannel();
            if (channel) {
                const messageId = findLastOwnMessageId(channel.id);
                if (messageId) {
                    e.preventDefault();
                    e.stopPropagation();
                    MessageActions.deleteMessage(channel.id, messageId);
                    return;
                }
            }
        }
    }
}

export default definePlugin({
    name: "ChatShortcuts",
    description: "A collection of customizable chat shortcuts, each triggered by its own keybind.",
    tags: ["Chat", "Shortcuts", "Utility"],
    authors: [SlipcordDevs.boss],
    settings,

    start() {
        channelLastMessages = {};
        lastPingedUserId = null;
        document.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        channelLastMessages = {};
        lastPingedUserId = null;
    },

    flux: {
        MESSAGE_CREATE(event: { message: MessageJSON; channelId: string; optimistic?: boolean; }) {
            if (event.optimistic) return;

            const { message } = event;
            const me = UserStore.getCurrentUser();
            if (!me || message.author.id !== me.id) return;

            if (message.type === MessageType.DEFAULT && message.mentions?.length) {
                const lastMention = message.mentions[message.mentions.length - 1];
                lastPingedUserId = lastMention.id;
            }

            const content = message.content?.trim();
            if (content) channelLastMessages[message.channel_id] = content;
        },
    },
});
