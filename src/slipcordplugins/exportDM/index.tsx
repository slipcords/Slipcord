/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { SlipcordDevs } from "@utils/constants";
import { Modals, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import {
    ChannelStore,
    Forms,
    GuildStore,
    IconUtils,
    MessageStore,
    React,
    SelectedChannelStore,
    useEffect,
    UserStore,
    useState
} from "@webpack/common";

const ModalRoot = (Modals as any).ModalRoot as React.FC<any>;
const ModalHeader = (Modals as any).ModalHeader as React.FC<any>;
const ModalContent = (Modals as any).ModalContent as React.FC<any>;
const ModalCloseButton = (Modals as any).ModalCloseButton as React.FC<any>;

// Nightcord's autoTranslate helper, kept as an identity function since Slipcord has no translation layer
const t = (text: string) => text;

function ExportIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" d="M13 16V5.41l3.3 3.3a1 1 0 1 0 1.4-1.42l-5-5a1 1 0 0 0-1.4 0l-5 5a1 1 0 0 0 1.4 1.42L11 5.4V16a1 1 0 1 0 2 0Z" />
            <path fill="currentColor" d="M4 15a1 1 0 0 1 1-1h2a1 1 0 1 0 0-2H5a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3h-2a1 1 0 1 0 0 2h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4Z" />
        </svg>
    );
}

type ExportFormat = "txt" | "json" | "html" | "csv" | "md";

interface RichMessage {
    id: string;
    timestamp: string;
    editedAt?: string;
    authorId: string;
    authorName: string;
    authorAvatar: string | null;
    content: string;
    attachments: Array<{ url: string; filename: string; size: number; contentType: string; }>;
    embeds: Array<{ title?: string; description?: string; url?: string; image?: string; type: string; }>;
    stickers: Array<{ name: string; id: string; }>;
    reactions: Array<{ emoji: string; count: number; }>;
    referencedMessage?: { id: string; authorName: string; content: string; };
    pinned: boolean;
    type: number;
    components: any[];
    deleted?: boolean;
}

function getToken(): string {
    try {
        const mod = (window as any).Vencord?.Webpack?.findByProps?.("getToken");
        return mod?.getToken?.() ?? "";
    } catch { return ""; }
}

async function getDeletedMessagesFromIDB(channelId: string): Promise<any[]> {
    try {
        const dbReq: IDBOpenDBRequest = indexedDB.open("MessageLoggerIDB", 1);
        const idb = await new Promise<IDBDatabase>((resolve, reject) => {
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
            dbReq.onupgradeneeded = () => {
                dbReq.result.close();
                reject(new Error("DB not initialized"));
            };
        });

        const tx = idb.transaction("messages", "readonly");
        const store = tx.objectStore("messages");
        const index = store.index("by_channel_id");
        const req = index.getAll(channelId);

        const records: any[] = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        idb.close();
        return records.filter(r => r.status === "DELETED" || r.status === "GHOST_PINGED");
    } catch {
        return [];
    }
}

async function fetchAllMessages(channelId: string, token: string, onProgress: (n: number) => void): Promise<RichMessage[]> {
    const messageMap = new Map<string, RichMessage>();
    let beforeId: string | null = null;
    let count = 0;

    while (true) {
        const url = `https://discord.com/api/v9/channels/${channelId}/messages?limit=100${beforeId ? `&before=${beforeId}` : ""}`;
        const res = await fetch(url, { headers: { Authorization: token } });
        if (!res.ok) break;
        const batch: any[] = await res.json();
        if (!batch.length) break;

        for (const m of batch) {
            messageMap.set(m.id, {
                id: m.id,
                timestamp: m.timestamp,
                editedAt: m.edited_timestamp ?? undefined,
                authorId: m.author.id,
                authorName: m.author.global_name ?? m.author.username,
                authorAvatar: m.author.avatar ?? null,
                content: m.content ?? "",
                attachments: (m.attachments ?? []).map((a: any) => ({
                    url: a.url, filename: a.filename, size: a.size,
                    contentType: a.content_type ?? "application/octet-stream",
                })),
                embeds: (m.embeds ?? []).map((e: any) => ({
                    title: e.title, description: e.description, url: e.url,
                    image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
                })),
                stickers: (m.sticker_items ?? []).map((s: any) => ({ name: s.name, id: s.id })),
                reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji.name ?? r.emoji.id, count: r.count })),
                referencedMessage: m.referenced_message ? {
                    id: m.referenced_message.id,
                    authorName: m.referenced_message.author?.username ?? "Inconnu",
                    content: m.referenced_message.content?.slice(0, 100) ?? "",
                } : undefined,
                pinned: m.pinned ?? false,
                type: m.type ?? 0,
                components: m.components ?? [],
                deleted: false
            });
        }

        count += batch.length;
        onProgress(count);
        if (batch.length < 100) break;
        beforeId = batch[batch.length - 1].id;
        await new Promise(r => setTimeout(r, 250));
    }

    try {
        const cached = MessageStore.getMessages?.(channelId) as any;
        if (cached) {
            const raw = Array.isArray(cached) ? cached : (cached._array ?? (typeof cached.toArray === "function" ? cached.toArray() : Object.values(cached)));
            for (const m of raw) {
                if (m && (m.deleted || m.state === "DELETED" || m.mlDeleted)) {
                    messageMap.set(m.id, {
                        id: m.id,
                        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : (m.timestamp || new Date().toISOString()),
                        editedAt: m.editedTimestamp instanceof Date ? m.editedTimestamp.toISOString() : (m.editedTimestamp || m.edited_timestamp),
                        authorId: m.author?.id,
                        authorName: m.author?.globalName ?? m.author?.username ?? "Inconnu",
                        authorAvatar: m.author?.avatar ?? null,
                        content: m.content ?? "",
                        attachments: (m.attachments ?? []).map((a: any) => ({
                            url: a.url, filename: a.filename, size: a.size,
                            contentType: a.content_type ?? "application/octet-stream",
                        })),
                        embeds: (m.embeds ?? []).map((e: any) => ({
                            title: e.title, description: e.description, url: e.url,
                            image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
                        })),
                        stickers: (m.sticker_items ?? m.stickers ?? []).map((s: any) => ({ name: s.name, id: s.id })),
                        reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji?.name ?? r.emoji?.id, count: r.count })),
                        referencedMessage: m.messageReference ? {
                            id: m.messageReference.message_id || m.messageReference.id || "0",
                            authorName: "Inconnu",
                            content: ""
                        } : undefined,
                        pinned: m.pinned ?? false,
                        type: m.type ?? 0,
                        components: m.components ?? [],
                        deleted: true
                    });
                }
            }
        }
    } catch (e) {
        console.error("[ExportDM] Error fetching cached messages:", e);
    }

    try {
        const idbRecords = await getDeletedMessagesFromIDB(channelId);
        for (const record of idbRecords) {
            const m = record.message;
            if (!m || messageMap.has(record.message_id)) continue;

            messageMap.set(record.message_id, {
                id: record.message_id,
                timestamp: m.timestamp ?? new Date().toISOString(),
                editedAt: m.edited_timestamp ?? undefined,
                authorId: m.author?.id ?? "0",
                authorName: m.author?.global_name ?? m.author?.globalName ?? m.author?.username ?? "Inconnu",
                authorAvatar: m.author?.avatar ?? null,
                content: m.content ?? "",
                attachments: (m.attachments ?? []).map((a: any) => ({
                    url: a.url ?? a.oldUrl ?? "", filename: a.filename ?? "file", size: a.size ?? 0,
                    contentType: a.content_type ?? "application/octet-stream",
                })),
                embeds: (m.embeds ?? []).map((e: any) => ({
                    title: e.title, description: e.description, url: e.url,
                    image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
                })),
                stickers: (m.sticker_items ?? m.stickerItems ?? []).map((s: any) => ({ name: s.name, id: s.id })),
                reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji?.name ?? r.emoji?.id, count: r.count })),
                referencedMessage: m.referenced_message ? {
                    id: m.referenced_message.id ?? m.referenced_message.message_id ?? "0",
                    authorName: m.referenced_message.author?.username ?? "Inconnu",
                    content: (m.referenced_message.content ?? "").slice(0, 100),
                } : undefined,
                pinned: m.pinned ?? false,
                type: m.type ?? 0,
                components: m.components ?? [],
                deleted: true
            });
        }
    } catch (e) {
        console.error("[ExportDM] Error fetching deleted messages from IDB:", e);
    }

    return Array.from(messageMap.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function getMediaType(url: string, ct: string): "image" | "video" | "audio" | "file" {
    if (ct.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url)) return "image";
    if (ct.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url)) return "video";
    if (ct.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a)(\?|$)/i.test(url)) return "audio";
    return "file";
}

function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTxt(messages: RichMessage[], channelName: string): string {
    const lines = [`=== ${t("Export DMs")} — ${channelName} ===`, `${t("Exported on")} ${new Date().toLocaleString()}`, `${t("Total:")} ${messages.length} ${t("messages")}`, ""];
    for (const m of messages) {
        const d = new Date(m.timestamp).toLocaleString();
        if (m.referencedMessage) lines.push(`  > [${m.referencedMessage.authorName}]: ${m.referencedMessage.content}`);
        lines.push(`[${d}]${m.editedAt ? ` ${t("(edited)")}` : ""} ${m.authorName}: ${m.content}`);
        for (const a of m.attachments) lines.push(`  [${getMediaType(a.url, a.contentType).toUpperCase()}] ${a.filename} (${formatSize(a.size)}) — ${a.url}`);
        for (const e of m.embeds) { if (e.url) lines.push(`  [LIEN] ${e.title ?? "Embed"}: ${e.url}`); }
        for (const s of m.stickers) lines.push(`  [STICKER] ${s.name}`);
        if (m.reactions.length) lines.push(`  ${m.reactions.map(r => `${r.emoji} x${r.count}`).join(" ")}`);
    }
    return lines.join("\n");
}

function buildJson(messages: RichMessage[], channelName: string): string {
    return JSON.stringify({ channel: channelName, exported: new Date().toISOString(), count: messages.length, messages }, null, 2);
}

function buildCsv(messages: RichMessage[]): string {
    const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [["ID", "Timestamp", "EditedAt", "AuthorID", "AuthorName", "Content", "Attachments", "Embeds", "Stickers", "Reactions", "ReplyTo", "Pinned"]];
    for (const m of messages) {
        rows.push([m.id, m.timestamp, m.editedAt ?? "", m.authorId, m.authorName, m.content,
        m.attachments.map(a => a.url).join("|"), m.embeds.map(e => e.url ?? e.title ?? "").join("|"),
        m.stickers.map(s => s.name).join("|"), m.reactions.map(r => `${r.emoji}:${r.count}`).join("|"),
        m.referencedMessage?.id ?? "", m.pinned ? "yes" : "no"]);
    }
    return rows.map(r => r.map(esc).join(",")).join("\n");
}

function buildMd(messages: RichMessage[], channelName: string): string {
    const lines = [`# ${t("Export DMs")} — ${channelName}`, `> ${t("Exported on")} ${new Date().toLocaleString()} · **${messages.length} ${t("messages")}**`, ""];
    for (const m of messages) {
        const d = new Date(m.timestamp).toLocaleString();
        if (m.referencedMessage) lines.push(`> **${m.referencedMessage.authorName}**: ${m.referencedMessage.content}`);
        lines.push(`**${m.authorName}** — *${d}*${m.editedAt ? ` ${t("(edited)")}` : ""}${m.pinned ? ` ${t("[pinned]")}` : ""}`);
        if (m.content) lines.push(m.content);
        for (const a of m.attachments) lines.push(`[${a.filename}](${a.url}) *(${formatSize(a.size)})*`);
        for (const e of m.embeds) { if (e.url) lines.push(`[${e.title ?? "Lien"}](${e.url})`); }
        for (const s of m.stickers) lines.push(`*Sticker: ${s.name}*`);
        if (m.reactions.length) lines.push(m.reactions.map(r => `${r.emoji} \`${r.count}\``).join(" "));
        lines.push("");
    }
    return lines.join("\n");
}

import { generateDiscordHtmlTranscript } from "./discordHtmlTranscript";

function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
            <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
        </svg>
    );
}

function GroupAvatarIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
    );
}

function ExportDMModal({ rootProps }: { rootProps: any; }) {
    const [channels, setChannels] = useState<any[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [format, setFormat] = useState<ExportFormat>("html");
    const [status, setStatus] = useState<"idle" | "fetching" | "done" | "error">("idle");
    const [progress, setProgress] = useState("");
    const [includeMedia, setIncludeMedia] = useState(true);
    const [includeEmbeds, setIncludeEmbeds] = useState(true);
    const [includeReactions, setIncludeReactions] = useState(true);
    const [search, setSearch] = useState("");

    useEffect(() => {
        try {
            const raw = ChannelStore.getSortedPrivateChannels?.() ?? {};
            const dms = (Array.isArray(raw) ? raw : Object.values(raw))
                .filter((c: any) => c.type === 1 || c.type === 3)
                .map((c: any) => {
                    let name = c.name ?? "";
                    let avatar: string | null = null;
                    let userId: string | undefined;

                    if (c.type === 1 && c.recipients?.length) {
                        const user = UserStore.getUser?.(c.recipients[0]);
                        name = user?.globalName ?? user?.username ?? c.recipients[0];
                        avatar = user?.avatar ?? null;
                        userId = c.recipients[0];
                    } else if (c.type === 3) {
                        if (!name && c.recipients?.length) {
                            const recipientNames = c.recipients
                                .map((id: string) => {
                                    const u = UserStore.getUser?.(id);
                                    return u?.globalName ?? u?.username ?? null;
                                })
                                .filter(Boolean);
                            if (recipientNames.length > 0) {
                                name = recipientNames.join(", ");
                            }
                        }
                        if (!name) name = `Group DM (${(c.recipients?.length ?? 0) + 1})`;
                    }

                    return {
                        id: c.id,
                        type: c.type,
                        name,
                        icon: c.icon ?? null,
                        recipientId: userId,
                        avatar,
                        guildId: null,
                        recipientCount: c.recipients?.length ?? 0,
                        rawChannel: c
                    };
                });

            const guildChannels: any[] = [];
            const seen = new Set<string>();
            for (const guild of Object.values(GuildStore.getGuilds?.() ?? {})) {
                if (!guild?.name) continue;

                const guildName = guild.name;
                for (const channelId of Object.keys((ChannelStore as any).getChannels?.(guild?.id) ?? {})) {
                    const channel = ChannelStore.getChannel?.(channelId) as any;
                    // 0 = guild text, 5 = announcement, 10/12 = threads
                    if (channel?.type !== 0 && channel?.type !== 5 && channel?.type !== 10 && channel?.type !== 12) continue;
                    // list threads, but only the ones with a parent that is itself listed
                    if (channel?.type === 10 && channel?.parent_id) continue;
                    seen.add(channel.id);

                    guildChannels.push({
                        id: channel.id,
                        type: channel.type,
                        name: `${guildName} / ${channel.name ?? channel.id}`,
                        icon: channel.icon ?? null,
                        recipientId: undefined,
                        avatar: null,
                        guildId: guild.id,
                        recipientCount: 0,
                        rawChannel: channel
                    });
                }
            }

            // make sure the channel currently open is always exportable
            const current = ChannelStore.getChannel?.(SelectedChannelStore.getChannelId?.() as string);
            if (current && !dms.some(c => c.id === current.id) && !guildChannels.some(c => c.id === current.id)) {
                guildChannels.unshift({
                    id: current.id,
                    type: current.type,
                    name: `Current / ${current.name ?? current.id}`,
                    icon: current.icon ?? null,
                    recipientId: undefined,
                    avatar: null,
                    guildId: current.guild_id ?? null,
                    recipientCount: 0,
                    rawChannel: current
                });
            }

            setChannels([...dms, ...guildChannels]);
        } catch (e) { console.error("[ExportDM]", e); }
    }, []);

    async function doExport() {
        if (selected.size === 0) return;
        const token = getToken();
        if (!token) { setStatus("error"); setProgress(t("Token not found")); return; }

        setStatus("fetching");
        const sel = channels.filter(c => selected.has(c.id));

        for (let i = 0; i < sel.length; i++) {
            const ch = sel[i];
            const prefix = `[${i + 1}/${selected.size}] ${ch.name}: `;

            let msgs = await fetchAllMessages(ch.id, token, n => setProgress(`${prefix}${t("Fetching:")} ${n} ${t("messages")}...`));
            if (!includeMedia) msgs = msgs.map(m => ({ ...m, attachments: [] }));
            if (!includeEmbeds) msgs = msgs.map(m => ({ ...m, embeds: [] }));
            if (!includeReactions) msgs = msgs.map(m => ({ ...m, reactions: [] }));

            setProgress(`${prefix}${msgs.length} ${t("messages")} — ${t("generating file...")}`);
            const safeName = ch.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "channel";
            const date = new Date().toISOString().slice(0, 10);

            let content: string; let ext: string; let mime: string;
            switch (format) {
                case "json": content = buildJson(msgs, ch.name); ext = "json"; mime = "application/json"; break;
                case "csv": content = buildCsv(msgs); ext = "csv"; mime = "text/csv"; break;
                case "md": content = buildMd(msgs, ch.name); ext = "md"; mime = "text/markdown"; break;
                case "txt": content = buildTxt(msgs, ch.name); ext = "txt"; mime = "text/plain"; break;
                default: content = generateDiscordHtmlTranscript(msgs as any, ch); ext = "html"; mime = "text/html"; break;
            }

            downloadFile(content, `export_${safeName}_${date}.${ext}`, mime);
        }

        setStatus("done");
        setProgress(`${selected.size} ${t("channels exported")}`);
    }

    const toggleSelected = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const FORMATS: Array<{ key: ExportFormat; label: string; desc: string; }> = [
        { key: "html", label: t("HTML"), desc: t("Web page with images/videos") },
        { key: "txt", label: t("TXT"), desc: t("Plain text") },
        { key: "md", label: t("MD"), desc: t("Markdown") },
        { key: "json", label: t("JSON"), desc: t("Full structured") },
        { key: "csv", label: t("CSV"), desc: t("Spreadsheet") },
    ];

    function getChAvatar(c: any) {
        if (c.type === 1 && c.recipientId && c.avatar) {
            return IconUtils.getUserAvatarURL({ id: c.recipientId, avatar: c.avatar } as any, false, 32);
        }
        if (c.type === 3 && (c.icon || c.rawChannel)) {
            return IconUtils.getChannelIconURL?.(c.rawChannel ?? c);
        }
        return null;
    }

    const filtered = search.trim()
        ? channels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
        : channels;

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#fff" }}>
                    <ExportIcon width={16} height={16} /> {t("Export Messages")}
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="edm-content">

                <div className="edm-search-bar">
                    <SearchIcon />
                    <input
                        className="edm-search-input"
                        type="text"
                        placeholder={t("Search for a channel, server or DM...")}
                        value={search}
                        onChange={e => setSearch(e.currentTarget.value)}
                        autoFocus
                    />
                    {search && (
                        <button className="edm-search-clear" onClick={() => setSearch("")}>✕</button>
                    )}
                </div>

                <Forms.FormTitle tag="h5" className="edm-label">{t("CHOOSE A CHANNEL")}</Forms.FormTitle>
                <div className="edm-channel-list">
                    {filtered.length === 0 && (
                        <div className="edm-empty">
                            {search ? `${t("No results for")} "${search}"` : t("No channels found")}
                        </div>
                    )}
                    {filtered.map(c => {
                        const av = getChAvatar(c);
                        const isSel = selected.has(c.id);
                        return (
                            <div key={c.id}
                                className={`edm-channel-row ${isSel ? "edm-channel-row--selected" : ""}`}
                                onClick={() => toggleSelected(c.id)}>
                                {av
                                    ? <img src={av} className="edm-avatar" alt="" />
                                    : c.type === 3
                                        ? <div className="edm-avatar-placeholder edm-avatar-group"><GroupAvatarIcon /></div>
                                        : <div className="edm-avatar-placeholder">{c.name?.[0] ?? "?"}</div>
                                }
                                <div className="edm-channel-info">
                                    <span className="edm-channel-name">{c.name}</span>
                                    {c.type === 3 && (
                                        <span className="edm-group-tag">
                                            {t("Group")} · {c.recipientCount + 1}
                                        </span>
                                    )}
                                </div>
                                {isSel && <span className="edm-check">✓</span>}
                            </div>
                        );
                    })}
                </div>

                <div className="edm-options-row">
                    <label className="edm-option">
                        <input type="checkbox" checked={includeMedia} onChange={e => setIncludeMedia(e.target.checked)} />
                        <span>{t("Images / Videos / Audio")}</span>
                    </label>
                    <label className="edm-option">
                        <input type="checkbox" checked={includeEmbeds} onChange={e => setIncludeEmbeds(e.target.checked)} />
                        <span>{t("Links / Embeds")}</span>
                    </label>
                    <label className="edm-option">
                        <input type="checkbox" checked={includeReactions} onChange={e => setIncludeReactions(e.target.checked)} />
                        <span>{t("Reactions")}</span>
                    </label>
                </div>

                <Forms.FormTitle tag="h5" className="edm-label">{t("EXPORT FORMAT")}</Forms.FormTitle>
                <div className="edm-format-row">
                    {FORMATS.map(f => (
                        <button key={f.key}
                            className={`edm-format-btn ${format === f.key ? "edm-format-btn--active" : ""}`}
                            onClick={() => setFormat(f.key)}
                            title={f.desc}>
                            <span className="edm-fmt-key">{f.label}</span>
                            <span className="edm-fmt-desc">{f.desc}</span>
                        </button>
                    ))}
                </div>

                {status !== "idle" && (
                    <div className={`edm-status edm-status--${status}`}>{progress}</div>
                )}

                <button className="edm-export-btn"
                    onClick={doExport}
                    disabled={selected.size === 0 || status === "fetching"}>
                    {status === "fetching" ? t("Exporting...") : t("Export")}
                </button>
            </ModalContent>
        </ModalRoot>
    );
}

function ExportButton() {
    return (
        <HeaderBarButton
            icon={ExportIcon}
            tooltip={t("Export Messages")}
            onClick={() => openModal(props => <ExportDMModal rootProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "ExportMessages",
    enabledByDefault: true,
    description: "Exports any channel or DM with messages, images, videos, audio, links, embeds, stickers and reactions in TXT/JSON/CSV/MD/HTML.",
    authors: [SlipcordDevs.nightcord],
    dependencies: ["HeaderBarAPI"],

    headerBarButton: {
        icon: ExportIcon,
        render: () => <ExportButton />
    },

    start() { addHeaderBarButton("nightcord-export-dm", () => <ExportButton />, 4); },
    stop() { removeHeaderBarButton("nightcord-export-dm"); },
});
