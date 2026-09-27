/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IconUtils } from "@webpack/common";

export interface TranscriptMessage {
    id: string;
    timestamp: string;
    editedAt?: string;
    authorId: string;
    authorName: string;
    authorAvatar: string | null;
    authorBot?: boolean;
    content: string;
    attachments: Array<{ url: string; filename: string; size: number; contentType: string; }>;
    embeds: Array<{
        title?: string;
        description?: string;
        url?: string;
        image?: string;
        thumbnail?: string;
        color?: number | string;
        author?: { name?: string; iconUrl?: string; url?: string; };
        footer?: { text?: string; iconUrl?: string; };
        fields?: Array<{ name: string; value: string; inline?: boolean; }>;
        type?: string;
    }>;
    stickers: Array<{ name: string; id: string; formatType?: number; }>;
    reactions: Array<{ emoji: string; count: number; }>;
    referencedMessage?: { id: string; authorName: string; content: string; };
    pinned: boolean;
    type: number;
    components: any[];
    deleted?: boolean;
}

export interface TranscriptChannelInfo {
    id: string;
    name: string;
    type?: number;
    icon?: string | null;
    avatar?: string | null;
    recipientId?: string;
    recipientCount?: number;
}

function escapeHtml(str: string): string {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseMarkdown(text: string): string {
    if (!text) return "";
    let s = escapeHtml(text);

    // Codeblocks (```lang ... ```)
    s = s.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<div class="dht-codeblock-wrapper"><div class="dht-codeblock-header">${lang ? `<span>${lang}</span>` : ""}</div><pre><code class="dht-codeblock">${code}</code></pre></div>`;
    });

    // Inline code (`...`)
    s = s.replace(/`([^`\n]+)`/g, '<code class="dht-inline-code">$1</code>');

    // Spoilers (||...||)
    s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dht-spoiler" onclick="this.classList.toggle(\'dht-spoiler--revealed\')">$1</span>');

    // Blockquotes (> ... or >>> ...)
    s = s.replace(/^>>>\s+([\s\S]*)$/gm, '<blockquote class="dht-blockquote">$1</blockquote>');
    s = s.replace(/^>\s+(.*)$/gm, '<blockquote class="dht-blockquote">$1</blockquote>');

    // Headers (#, ##, ###)
    s = s.replace(/^### (.*$)/gm, '<h3 class="dht-heading-3">$1</h3>');
    s = s.replace(/^## (.*$)/gm, '<h2 class="dht-heading-2">$1</h2>');
    s = s.replace(/^# (.*$)/gm, '<h1 class="dht-heading-1">$1</h1>');

    // Subtext (-# text)
    s = s.replace(/^-# (.*$)/gm, '<small class="dht-subtext">$1</small>');

    // Bold + Italic (***...***)
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");

    // Bold (**...**)
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // Underline (__...__)
    s = s.replace(/__([^_]+)__/g, "<u>$1</u>");

    // Italic (*...* or _..._)
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/_([^_]+)_/g, "<em>$1</em>");

    // Strikethrough (~~...~~)
    s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");

    // Custom emojis (<:name:id> or <a:name:id>)
    s = s.replace(/&lt;(a?):([a-zA-Z0-9_]+):([0-9]+)&gt;/g, (_, animated, name, id) => {
        const ext = animated ? "gif" : "webp";
        return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48&quality=lossless" alt=":${name}:" title=":${name}:" class="dht-emoji" loading="lazy">`;
    });

    // Discord timestamps (<t:1234567890:R>)
    s = s.replace(/&lt;t:([0-9]+)(?::([a-zA-Z]))?&gt;/g, (_, unix, style) => {
        const date = new Date(parseInt(unix, 10) * 1000);
        return `<span class="dht-timestamp" title="${date.toUTCString()}">${date.toLocaleString()}</span>`;
    });

    // User/Role/Channel mentions (<@id>, <@!id>, <@&id>, <#id>)
    s = s.replace(/&lt;@!?([0-9]+)&gt;/g, '<span class="dht-mention">@user</span>');
    s = s.replace(/&lt;@&amp;([0-9]+)&gt;/g, '<span class="dht-mention">@role</span>');
    s = s.replace(/&lt;#([0-9]+)&gt;/g, '<span class="dht-mention dht-mention--channel">#channel</span>');

    // URLs to clickable links
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="dht-link">$1</a>');

    // Line breaks
    s = s.replace(/\n/g, "<br>");

    return s;
}

function getMediaType(url: string, ct: string): "image" | "video" | "audio" | "file" {
    if (ct.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url)) return "image";
    if (ct.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url)) return "video";
    if (ct.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a|aac)(\?|$)/i.test(url)) return "audio";
    return "file";
}

export function generateDiscordHtmlTranscript(messages: TranscriptMessage[], channel: TranscriptChannelInfo): string {
    const channelName = channel.name || "Direct Message";
    const exportDate = new Date().toLocaleString();
    const totalMessages = messages.length;

    let channelAvatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
    if (channel.avatar) {
        channelAvatarUrl = IconUtils.getUserAvatarURL({ id: channel.recipientId, avatar: channel.avatar } as any, false, 64);
    } else if (channel.icon) {
        channelAvatarUrl = `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.png?size=64`;
    }

    // Render message rows with Discord group clustering (within 5 minutes from same author)
    let messageRowsHtml = "";
    let lastAuthorId: string | null = null;
    let lastTimestamp: number = 0;

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const msgTime = new Date(msg.timestamp).getTime();
        const isConsecutive = lastAuthorId === msg.authorId && (msgTime - lastTimestamp < 5 * 60 * 1000) && !msg.referencedMessage && !msg.deleted;

        const avatarUrl = msg.authorAvatar
            ? IconUtils.getUserAvatarURL({ id: msg.authorId, avatar: msg.authorAvatar } as any, false, 48)
            : IconUtils.getDefaultAvatarURL(msg.authorId);

        const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const fullDateStr = new Date(msg.timestamp).toLocaleString();

        const editedHtml = msg.editedAt ? `<span class="dht-edited" title="${new Date(msg.editedAt).toLocaleString()}">(modifié)</span>` : "";
        const deletedHtml = msg.deleted ? "<span class=\"dht-deleted-tag\" title=\"Message supprimé\">(supprimé)</span>" : "";
        const pinHtml = msg.pinned ? "<span class=\"dht-pin-badge\" title=\"Message épinglé\">📌</span>" : "";

        // Reply Reference
        let replyHtml = "";
        if (msg.referencedMessage) {
            replyHtml = `
                <div class="dht-reply-container" onclick="scrollToMessage('${msg.referencedMessage.id}')">
                    <div class="dht-reply-spine"></div>
                    <span class="dht-reply-author">${escapeHtml(msg.referencedMessage.authorName)}</span>
                    <span class="dht-reply-content">${msg.referencedMessage.content ? parseMarkdown(msg.referencedMessage.content.slice(0, 120)) : "<em>Message d'origine</em>"}</span>
                </div>
            `;
        }

        // Attachments
        let attachmentsHtml = "";
        if (msg.attachments && msg.attachments.length > 0) {
            attachmentsHtml = "<div class=\"dht-attachments\">" + msg.attachments.map(att => {
                const mediaType = getMediaType(att.url, att.contentType);
                if (mediaType === "image") {
                    return `
                        <div class="dht-attachment-image-wrapper">
                            <img src="${att.url}" alt="${escapeHtml(att.filename)}" class="dht-attachment-image" loading="lazy" onclick="openLightbox('${att.url}')">
                        </div>
                    `;
                }
                if (mediaType === "video") {
                    return `
                        <div class="dht-attachment-video-wrapper">
                            <video src="${att.url}" controls preload="metadata" class="dht-attachment-video"></video>
                        </div>
                    `;
                }
                if (mediaType === "audio") {
                    return `
                        <div class="dht-attachment-audio-wrapper">
                            <div class="dht-audio-label">🎵 ${escapeHtml(att.filename)}</div>
                            <audio src="${att.url}" controls class="dht-attachment-audio"></audio>
                        </div>
                    `;
                }
                return `
                    <div class="dht-attachment-file">
                        <svg class="dht-file-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
                        <div class="dht-file-info">
                            <a href="${att.url}" target="_blank" rel="noopener" class="dht-file-name">${escapeHtml(att.filename)}</a>
                            <span class="dht-file-size">${formatSize(att.size)}</span>
                        </div>
                        <a href="${att.url}" download="${escapeHtml(att.filename)}" target="_blank" class="dht-file-download-btn">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        </a>
                    </div>
                `;
            }).join("") + "</div>";
        }

        // Embeds
        let embedsHtml = "";
        if (msg.embeds && msg.embeds.length > 0) {
            embedsHtml = "<div class=\"dht-embeds\">" + msg.embeds.map(emb => {
                const colorHex = emb.color
                    ? (typeof emb.color === "number" ? `#${emb.color.toString(16).padStart(6, "0")}` : emb.color)
                    : "#5865F2";

                let authorSection = "";
                if (emb.author?.name) {
                    authorSection = `
                        <div class="dht-embed-author">
                            ${emb.author.iconUrl ? `<img src="${emb.author.iconUrl}" class="dht-embed-author-icon" loading="lazy">` : ""}
                            ${emb.author.url ? `<a href="${emb.author.url}" target="_blank" class="dht-embed-author-link">${escapeHtml(emb.author.name)}</a>` : `<span>${escapeHtml(emb.author.name)}</span>`}
                        </div>
                    `;
                }

                let titleSection = "";
                if (emb.title) {
                    titleSection = emb.url
                        ? `<a href="${emb.url}" target="_blank" class="dht-embed-title dht-link">${escapeHtml(emb.title)}</a>`
                        : `<div class="dht-embed-title">${escapeHtml(emb.title)}</div>`;
                }

                const descSection = emb.description ? `<div class="dht-embed-description">${parseMarkdown(emb.description)}</div>` : "";

                let fieldsSection = "";
                if (emb.fields && emb.fields.length > 0) {
                    fieldsSection = "<div class=\"dht-embed-fields\">" + emb.fields.map(f => `
                        <div class="dht-embed-field ${f.inline ? "dht-embed-field--inline" : ""}">
                            <div class="dht-embed-field-name">${escapeHtml(f.name)}</div>
                            <div class="dht-embed-field-value">${parseMarkdown(f.value)}</div>
                        </div>
                    `).join("") + "</div>";
                }

                const imageSection = emb.image ? `<img src="${emb.image}" class="dht-embed-image" loading="lazy" onclick="openLightbox('${emb.image}')">` : "";
                const thumbSection = emb.thumbnail ? `<img src="${emb.thumbnail}" class="dht-embed-thumbnail" loading="lazy">` : "";

                let footerSection = "";
                if (emb.footer?.text) {
                    footerSection = `
                        <div class="dht-embed-footer">
                            ${emb.footer.iconUrl ? `<img src="${emb.footer.iconUrl}" class="dht-embed-footer-icon" loading="lazy">` : ""}
                            <span>${escapeHtml(emb.footer.text)}</span>
                        </div>
                    `;
                }

                return `
                    <div class="dht-embed" style="border-left-color: ${colorHex}">
                        <div class="dht-embed-grid">
                            <div class="dht-embed-main">
                                ${authorSection}
                                ${titleSection}
                                ${descSection}
                                ${fieldsSection}
                                ${imageSection}
                                ${footerSection}
                            </div>
                            ${thumbSection}
                        </div>
                    </div>
                `;
            }).join("") + "</div>";
        }

        // Stickers
        let stickersHtml = "";
        if (msg.stickers && msg.stickers.length > 0) {
            stickersHtml = "<div class=\"dht-stickers\">" + msg.stickers.map(st => `
                <div class="dht-sticker-wrapper">
                    <img src="https://media.discordapp.net/stickers/${st.id}.png?size=160" alt="${escapeHtml(st.name)}" title="${escapeHtml(st.name)}" class="dht-sticker" loading="lazy">
                </div>
            `).join("") + "</div>";
        }

        // Reactions
        let reactionsHtml = "";
        if (msg.reactions && msg.reactions.length > 0) {
            reactionsHtml = "<div class=\"dht-reactions\">" + msg.reactions.map(r => `
                <div class="dht-reaction-badge">
                    <span class="dht-reaction-emoji">${r.emoji}</span>
                    <span class="dht-reaction-count">${r.count}</span>
                </div>
            `).join("") + "</div>";
        }

        const contentHtml = msg.content ? `<div class="dht-message-content">${parseMarkdown(msg.content)}</div>` : "";
        const rowClass = `dht-message ${isConsecutive ? "dht-message--consecutive" : "dht-message--initial"} ${msg.deleted ? "dht-message--deleted" : ""}`;

        if (!isConsecutive) {
            messageRowsHtml += `
                <div id="msg-${msg.id}" class="${rowClass}" data-author="${escapeHtml(msg.authorName.toLowerCase())}" data-content="${escapeHtml((msg.content || "").toLowerCase())}">
                    ${replyHtml}
                    <div class="dht-message-header">
                        <img src="${avatarUrl}" alt="${escapeHtml(msg.authorName)}" class="dht-avatar" loading="lazy">
                        <span class="dht-author-name">${escapeHtml(msg.authorName)}</span>
                        ${msg.authorBot ? "<span class=\"dht-bot-badge\">BOT</span>" : ""}
                        <span class="dht-timestamp" title="${fullDateStr}">${timeStr}</span>
                        ${editedHtml}
                        ${deletedHtml}
                        ${pinHtml}
                    </div>
                    <div class="dht-message-body">
                        ${contentHtml}
                        ${attachmentsHtml}
                        ${embedsHtml}
                        ${stickersHtml}
                        ${reactionsHtml}
                    </div>
                </div>
            `;
        } else {
            messageRowsHtml += `
                <div id="msg-${msg.id}" class="${rowClass}" data-author="${escapeHtml(msg.authorName.toLowerCase())}" data-content="${escapeHtml((msg.content || "").toLowerCase())}">
                    <span class="dht-timestamp-compact" title="${fullDateStr}">${timeStr}</span>
                    <div class="dht-message-body">
                        ${contentHtml}
                        ${editedHtml}
                        ${deletedHtml}
                        ${attachmentsHtml}
                        ${embedsHtml}
                        ${stickersHtml}
                        ${reactionsHtml}
                    </div>
                </div>
            `;
        }

        lastAuthorId = msg.authorId;
        lastTimestamp = msgTime;
    }

    return `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript — ${escapeHtml(channelName)}</title>
    <style>
        :root {
            --bg-primary: #313338;
            --bg-secondary: #2b2d31;
            --bg-tertiary: #1e1f22;
            --bg-accent: #35373c;
            --text-normal: #dbdee1;
            --text-muted: #949ba4;
            --text-header: #f2f3f5;
            --interactive-hover: #ffffff;
            --interactive-normal: #b5bac1;
            --brand-color: #5865f2;
            --brand-color-hover: #4752c4;
            --border-subtle: rgba(255, 255, 255, 0.08);
            --mention-bg: rgba(88, 101, 242, 0.15);
            --mention-hover: rgba(88, 101, 242, 0.25);
            --deleted-bg: rgba(242, 63, 67, 0.08);
            --deleted-border: #f23f43;
            --font-main: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
            --code-font: "Consolas", "Courier New", Courier, monospace;
        }

        [data-theme="midnight"] {
            --bg-primary: #111214;
            --bg-secondary: #0c0d0e;
            --bg-tertiary: #060607;
            --bg-accent: #1e1f22;
            --text-normal: #dbdee1;
            --text-muted: #80848e;
            --text-header: #ffffff;
            --border-subtle: rgba(255, 255, 255, 0.05);
        }

        [data-theme="light"] {
            --bg-primary: #ffffff;
            --bg-secondary: #f2f3f5;
            --bg-tertiary: #e3e5e8;
            --bg-accent: #d7d9dc;
            --text-normal: #313338;
            --text-muted: #5c5e66;
            --text-header: #060607;
            --border-subtle: rgba(0, 0, 0, 0.08);
            --mention-bg: rgba(88, 101, 242, 0.12);
            --mention-hover: rgba(88, 101, 242, 0.2);
            --deleted-bg: rgba(242, 63, 67, 0.06);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--font-main);
            background-color: var(--bg-primary);
            color: var(--text-normal);
            font-size: 15px;
            line-height: 1.375rem;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }

        /* Top Header Bar */
        .dht-header {
            position: sticky;
            top: 0;
            z-index: 100;
            background-color: var(--bg-secondary);
            border-bottom: 1px solid var(--border-subtle);
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            gap: 16px;
        }
        .dht-channel-info {
            display: flex;
            align-items: center;
            gap: 14px;
            min-width: 0;
        }
        .dht-channel-avatar {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
            border: 2px solid var(--border-subtle);
        }
        .dht-channel-meta h1 {
            font-size: 18px;
            font-weight: 700;
            color: var(--text-header);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .dht-channel-meta p {
            font-size: 12px;
            color: var(--text-muted);
        }

        .dht-controls {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
        }
        .dht-search-box {
            position: relative;
            display: flex;
            align-items: center;
        }
        .dht-search-input {
            background-color: var(--bg-tertiary);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            padding: 6px 12px 6px 30px;
            color: var(--text-normal);
            font-size: 13px;
            width: 200px;
            transition: all 0.2s ease;
            outline: none;
        }
        .dht-search-input:focus {
            width: 260px;
            border-color: var(--brand-color);
        }
        .dht-search-icon {
            position: absolute;
            left: 8px;
            width: 14px;
            height: 14px;
            color: var(--text-muted);
            pointer-events: none;
        }
        .dht-theme-btn {
            background-color: var(--bg-tertiary);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-normal);
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s ease;
        }
        .dht-theme-btn:hover {
            background-color: var(--bg-accent);
            color: var(--interactive-hover);
        }

        /* Message Container */
        .dht-chat-container {
            flex: 1;
            max-width: 1000px;
            width: 100%;
            margin: 0 auto;
            padding: 20px 16px 60px;
        }

        /* Message Row */
        .dht-message {
            position: relative;
            padding: 2px 16px 2px 64px;
            border-radius: 4px;
            transition: background-color 0.1s ease;
        }
        .dht-message:hover {
            background-color: rgba(255, 255, 255, 0.03);
        }
        .dht-message--initial {
            margin-top: 18px;
        }
        .dht-message--consecutive {
            margin-top: 0;
            padding-top: 1px;
            padding-bottom: 1px;
        }
        .dht-message--deleted {
            background-color: var(--deleted-bg) !important;
            border-left: 3px solid var(--deleted-border);
        }
        .dht-message.highlight {
            animation: dhtHighlightAnim 2s ease-out;
        }
        @keyframes dhtHighlightAnim {
            0% { background-color: rgba(88, 101, 242, 0.4); }
            100% { background-color: transparent; }
        }

        .dht-message-header {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 2px;
        }
        .dht-avatar {
            position: absolute;
            left: 14px;
            top: 2px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            object-fit: cover;
        }
        .dht-author-name {
            font-size: 15px;
            font-weight: 600;
            color: var(--text-header);
            cursor: pointer;
        }
        .dht-author-name:hover {
            text-decoration: underline;
        }
        .dht-bot-badge {
            background-color: var(--brand-color);
            color: #ffffff;
            font-size: 10px;
            font-weight: 700;
            border-radius: 3px;
            padding: 1px 4px;
            text-transform: uppercase;
        }
        .dht-timestamp {
            font-size: 11px;
            color: var(--text-muted);
        }
        .dht-timestamp-compact {
            position: absolute;
            left: 0;
            width: 54px;
            text-align: right;
            font-size: 11px;
            color: var(--text-muted);
            opacity: 0;
            user-select: none;
        }
        .dht-message:hover .dht-timestamp-compact {
            opacity: 1;
        }

        .dht-edited, .dht-deleted-tag {
            font-size: 10px;
            color: var(--text-muted);
            margin-left: 4px;
        }
        .dht-deleted-tag {
            color: var(--deleted-border);
            font-weight: 600;
        }
        .dht-pin-badge {
            font-size: 12px;
            margin-left: 4px;
        }

        /* Replies */
        .dht-reply-container {
            position: relative;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 4px;
            cursor: pointer;
            user-select: none;
            padding-left: 4px;
        }
        .dht-reply-container:hover .dht-reply-content {
            color: var(--interactive-hover);
            text-decoration: underline;
        }
        .dht-reply-spine {
            position: absolute;
            left: -28px;
            top: 6px;
            width: 22px;
            height: 12px;
            border-left: 2px solid var(--border-subtle);
            border-top: 2px solid var(--border-subtle);
            border-top-left-radius: 6px;
        }
        .dht-reply-author {
            font-weight: 600;
            color: var(--text-normal);
        }
        .dht-reply-content {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 450px;
        }

        /* Message Body & Typography */
        .dht-message-body {
            font-size: 15px;
            word-break: break-word;
        }
        .dht-message-content {
            margin-bottom: 4px;
        }
        .dht-link {
            color: #00a8fc;
            text-decoration: none;
        }
        .dht-link:hover {
            text-decoration: underline;
        }
        .dht-mention {
            background-color: var(--mention-bg);
            color: #c9cdfb;
            border-radius: 3px;
            padding: 0 4px;
            font-weight: 500;
        }
        .dht-mention:hover {
            background-color: var(--mention-hover);
        }
        .dht-spoiler {
            background-color: var(--bg-tertiary);
            color: transparent;
            border-radius: 3px;
            padding: 0 4px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .dht-spoiler--revealed {
            background-color: rgba(255,255,255,0.08);
            color: var(--text-normal);
        }
        .dht-blockquote {
            border-left: 4px solid var(--border-subtle);
            padding-left: 12px;
            margin: 4px 0;
            color: var(--text-muted);
        }
        .dht-heading-1 { font-size: 20px; font-weight: 700; margin: 8px 0 4px; color: var(--text-header); }
        .dht-heading-2 { font-size: 17px; font-weight: 700; margin: 6px 0 4px; color: var(--text-header); }
        .dht-heading-3 { font-size: 15px; font-weight: 700; margin: 4px 0 2px; color: var(--text-header); }
        .dht-subtext { font-size: 12px; color: var(--text-muted); display: block; margin: 2px 0; }
        .dht-inline-code {
            background-color: var(--bg-secondary);
            font-family: var(--code-font);
            font-size: 13px;
            padding: 2px 5px;
            border-radius: 3px;
            border: 1px solid var(--border-subtle);
        }
        .dht-codeblock-wrapper {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            margin: 6px 0;
            overflow: hidden;
        }
        .dht-codeblock-header {
            background-color: var(--bg-tertiary);
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
        }
        .dht-codeblock {
            font-family: var(--code-font);
            font-size: 13px;
            display: block;
            padding: 10px;
            overflow-x: auto;
            line-height: 1.4;
        }
        .dht-emoji {
            width: 22px;
            height: 22px;
            vertical-align: -5px;
            display: inline-block;
        }

        /* Attachments */
        .dht-attachments {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 6px;
        }
        .dht-attachment-image-wrapper {
            max-width: 480px;
            max-height: 350px;
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
        }
        .dht-attachment-image {
            width: 100%;
            height: auto;
            max-height: 350px;
            object-fit: cover;
            border-radius: 8px;
            display: block;
        }
        .dht-attachment-video-wrapper {
            max-width: 520px;
            border-radius: 8px;
            overflow: hidden;
        }
        .dht-attachment-video {
            width: 100%;
            max-height: 380px;
            border-radius: 8px;
            display: block;
        }
        .dht-attachment-audio-wrapper {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 10px 14px;
            max-width: 400px;
        }
        .dht-audio-label {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--text-header);
        }
        .dht-attachment-audio {
            width: 100%;
            height: 36px;
        }
        .dht-attachment-file {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 10px 14px;
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 400px;
        }
        .dht-file-icon {
            color: var(--brand-color);
            flex-shrink: 0;
        }
        .dht-file-info {
            flex: 1;
            min-width: 0;
        }
        .dht-file-name {
            display: block;
            font-size: 14px;
            font-weight: 600;
            color: #00a8fc;
            text-decoration: none;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .dht-file-name:hover {
            text-decoration: underline;
        }
        .dht-file-size {
            font-size: 11px;
            color: var(--text-muted);
        }
        .dht-file-download-btn {
            color: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 6px;
            border-radius: 4px;
            transition: all 0.15s ease;
        }
        .dht-file-download-btn:hover {
            color: var(--interactive-hover);
            background-color: var(--bg-accent);
        }

        /* Embeds */
        .dht-embeds {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 6px;
        }
        .dht-embed {
            background-color: var(--bg-secondary);
            border-left: 4px solid var(--brand-color);
            border-radius: 0 8px 8px 0;
            padding: 12px 16px;
            max-width: 520px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .dht-embed-grid {
            display: flex;
            gap: 16px;
            justify-content: space-between;
        }
        .dht-embed-main {
            flex: 1;
            min-width: 0;
        }
        .dht-embed-author {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--text-header);
        }
        .dht-embed-author-icon {
            width: 22px;
            height: 22px;
            border-radius: 50%;
        }
        .dht-embed-author-link {
            color: var(--text-header);
            text-decoration: none;
        }
        .dht-embed-author-link:hover {
            text-decoration: underline;
        }
        .dht-embed-title {
            font-size: 15px;
            font-weight: 700;
            color: var(--text-header);
            margin-bottom: 6px;
        }
        .dht-embed-description {
            font-size: 14px;
            color: var(--text-normal);
            line-height: 1.4;
            margin-bottom: 8px;
        }
        .dht-embed-fields {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 8px;
        }
        .dht-embed-field {
            flex: 1 1 100%;
        }
        .dht-embed-field--inline {
            flex: 1 1 calc(33.3% - 10px);
            min-width: 120px;
        }
        .dht-embed-field-name {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-header);
            margin-bottom: 2px;
        }
        .dht-embed-field-value {
            font-size: 13px;
            color: var(--text-normal);
        }
        .dht-embed-image {
            max-width: 100%;
            border-radius: 6px;
            margin-top: 8px;
            cursor: pointer;
        }
        .dht-embed-thumbnail {
            max-width: 80px;
            max-height: 80px;
            border-radius: 6px;
            object-fit: cover;
            flex-shrink: 0;
        }
        .dht-embed-footer {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 8px;
        }
        .dht-embed-footer-icon {
            width: 18px;
            height: 18px;
            border-radius: 50%;
        }

        /* Stickers & Reactions */
        .dht-stickers { margin-top: 6px; }
        .dht-sticker { width: 140px; height: 140px; }
        .dht-reactions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 6px;
        }
        .dht-reaction-badge {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            padding: 3px 8px;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 600;
            color: var(--text-normal);
        }

        /* Lightbox Modal */
        .dht-lightbox {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 1000;
            background: rgba(0, 0, 0, 0.85);
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
        }
        .dht-lightbox.active {
            display: flex;
        }
        .dht-lightbox img {
            max-width: 90vw;
            max-height: 90vh;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }

        /* Floating Scroll Controls */
        .dht-scroll-nav {
            position: fixed;
            bottom: 24px;
            right: 24px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            z-index: 90;
        }
        .dht-scroll-btn {
            background-color: var(--bg-secondary);
            color: var(--text-normal);
            border: 1px solid var(--border-subtle);
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: all 0.15s ease;
        }
        .dht-scroll-btn:hover {
            background-color: var(--brand-color);
            color: #ffffff;
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <!-- Top Header -->
    <header class="dht-header">
        <div class="dht-channel-info">
            <img src="${channelAvatarUrl}" alt="${escapeHtml(channelName)}" class="dht-channel-avatar">
            <div class="dht-channel-meta">
                <h1>${escapeHtml(channelName)}</h1>
                <p>Exporté le ${exportDate} · <strong>${totalMessages}</strong> messages</p>
            </div>
        </div>
        <div class="dht-controls">
            <div class="dht-search-box">
                <svg class="dht-search-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z"/></svg>
                <input type="text" id="dhtSearchInput" class="dht-search-input" placeholder="Filtrer les messages..." oninput="filterMessages(this.value)">
            </div>
            <button class="dht-theme-btn" onclick="cycleTheme()">🎨 Thème</button>
        </div>
    </header>

    <!-- Chat Messages -->
    <main class="dht-chat-container" id="dhtChatContainer">
        ${messageRowsHtml}
    </main>

    <!-- Lightbox for Image Zoom -->
    <div id="dhtLightbox" class="dht-lightbox" onclick="closeLightbox()">
        <img id="dhtLightboxImg" src="" alt="Aperçu">
    </div>

    <!-- Scroll Floating Navigation -->
    <div class="dht-scroll-nav">
        <button class="dht-scroll-btn" title="Haut de page" onclick="window.scrollTo({top: 0, behavior: 'smooth'})">▲</button>
        <button class="dht-scroll-btn" title="Bas de page" onclick="window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'})">▼</button>
    </div>

    <script>
        // Scroll & highlight referenced message
        function scrollToMessage(msgId) {
            const el = document.getElementById('msg-' + msgId);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.remove('highlight');
                void el.offsetWidth;
                el.classList.add('highlight');
            }
        }

        // Live Search Filter
        function filterMessages(query) {
            const q = query.trim().toLowerCase();
            const msgs = document.querySelectorAll('.dht-message');
            msgs.forEach(m => {
                const author = m.getAttribute('data-author') || '';
                const content = m.getAttribute('data-content') || '';
                if (!q || author.includes(q) || content.includes(q)) {
                    m.style.display = '';
                } else {
                    m.style.display = 'none';
                }
            });
        }

        // Theme Switcher (Dark -> Midnight -> Light -> Dark)
        const themes = ['dark', 'midnight', 'light'];
        let currentThemeIdx = 0;
        function cycleTheme() {
            currentThemeIdx = (currentThemeIdx + 1) % themes.length;
            document.documentElement.setAttribute('data-theme', themes[currentThemeIdx]);
        }

        // Lightbox
        function openLightbox(url) {
            const box = document.getElementById('dhtLightbox');
            const img = document.getElementById('dhtLightboxImg');
            img.src = url;
            box.classList.add('active');
        }
        function closeLightbox() {
            document.getElementById('dhtLightbox').classList.remove('active');
        }
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeLightbox();
        });
    </script>
</body>
</html>`;
}
