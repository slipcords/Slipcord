/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { saveFile } from "@utils/web";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, Menu, MessageStore } from "@webpack/common";

const settings = definePluginSettings({
    exportFormat: {
        type: OptionType.SELECT,
        description: "Format to export messages in",
        options: [
            { label: "Plain Text", value: "txt" },
            { label: "JSON", value: "json" }
        ],
        default: "txt",
        restartNeeded: false
    },
    includeAttachments: {
        type: OptionType.BOOLEAN,
        description: "Include attachment URLs in the export",
        default: true,
        restartNeeded: false
    },
    includeEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Include embed content in the export",
        default: true,
        restartNeeded: false
    },
    maxMessages: {
        type: OptionType.NUMBER,
        description: "Maximum number of messages to export (0 for unlimited)",
        default: 0,
        restartNeeded: false
    }
});

function formatTimestamp(timestamp: string | Date): string {
    return new Date(timestamp).toLocaleString();
}

function formatMessageTxt(message: Message): string {
    const { author } = message;
    const time = formatTimestamp(message.timestamp);
    let line = `[${time}] ${author.username}`;
    if (author.discriminator && author.discriminator !== "0") {
        line += `#${author.discriminator}`;
    }
    line += `: ${message.content || "(no content)"}`;

    if (settings.store.includeAttachments && message.attachments?.length) {
        line += "\n  Attachments:";
        message.attachments.forEach(a => {
            line += `\n    - ${a.filename}: ${a.url}`;
        });
    }

    if (settings.store.includeEmbeds && message.embeds?.length) {
        line += "\n  Embeds:";
        message.embeds.forEach(e => {
            if (e.rawTitle) line += `\n    Title: ${e.rawTitle}`;
            if (e.rawDescription) line += `\n    Description: ${e.rawDescription}`;
            if (e.url) line += `\n    URL: ${e.url}`;
        });
    }

    return line;
}

function exportAsTxt(messages: Message[]): string {
    return messages.map(formatMessageTxt).join("\n\n---\n\n");
}

function exportAsJson(messages: Message[]): string {
    return JSON.stringify(messages.map(m => ({
        id: m.id,
        timestamp: m.timestamp,
        author: {
            id: m.author.id,
            username: m.author.username,
            discriminator: m.author.discriminator
        },
        content: m.content,
        attachments: settings.store.includeAttachments ? (m.attachments || []) : [],
        embeds: settings.store.includeEmbeds ? (m.embeds || []) : []
    })), null, 2);
}

function exportChannel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;

    const messages = MessageStore.getMessages(channelId)?._array ?? [];

    const content = settings.store.exportFormat === "json"
        ? exportAsJson(messages)
        : exportAsTxt(messages);

    const channelName = channel.name || "DM";
    const date = new Date().toISOString().split("T")[0];
    const filename = `${channelName}-${date}.${settings.store.exportFormat}`;

    try {
        const file = new File([content], filename, { type: "text/plain" });
        saveFile(file);

        showNotification({
            title: "Export Complete",
            body: `Exported ${messages.length} messages from ${channelName}`,
            icon: "✅"
        });
    } catch (e) {
        showNotification({
            title: "Export Failed",
            body: "Could not export messages",
            icon: "❌"
        });
    }
}

function ExportIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
        </svg>
    );
}

const contextMenuPatch = (children: Array<any>, props: { channel: Channel; }) => {
    const { channel } = props;
    if (!channel) return;

    children.push(
        <Menu.MenuItem
            id="mass-export-channel"
            label="Export Messages"
            icon={ExportIcon}
            action={() => exportChannel(channel.id)}
        />
    );
};

export default definePlugin({
    name: "MassMessageExport",
    description: "Export all messages from a channel to a file",
    tags: ["Chat", "Utility"],
    authors: [Devs.tired55],
    settings,
    contextMenus: {
        "channel-context": contextMenuPatch
    }
});
