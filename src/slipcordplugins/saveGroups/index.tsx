/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { SlipcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy, findByProps, findStore, waitFor } from "@webpack";
import {
    Alerts,
    ChannelStore,
    FluxDispatcher,
    Menu,
    MessageStore,
    PrivateChannelSortStore,
    React,
    RestAPI,
    SelectedChannelStore,
    showToast,
    Toasts,
    UserStore
} from "@webpack/common";
import { NavigationRouter } from "@webpack/common/utils";

// Nightcord's autoTranslate helper, kept as an identity function since Slipcord has no translation layer
const t = (text: string) => text;

const DATA_STORE_SAVED_KEY = "Nightcord_SaveGroups_SavedEntries";
const DATA_STORE_KNOWN_KEY = "Nightcord_SaveGroups_KnownActiveEntries";
const LS_SAVED_SUMMARY_KEY = "Nightcord_SaveGroups_Summary";

const createChannelRecordFromServer = findByCodeLazy(".GUILD_TEXT]", "fromServer)");
const createMessageRecord = findByCodeLazy(".createFromServer(", ".isBlockedForMessage", "messageReference:");

export interface SavedGroupData {
    id: string;
    name: string;
    icon?: string | null;
    ownerId?: string;
    topic?: string;
    type: number; // 3 = GROUP_DM
    recipients?: any[];
    rawRecipients?: any[];
    lastMessageId?: string | null;
    kickedAt: number;
    savedMessages?: any[];
}

const settings = definePluginSettings({
    saveMessages: {
        type: OptionType.BOOLEAN,
        description: "Save loaded message history when a group is archived.",
        default: true
    },
    saveOnManualLeave: {
        type: OptionType.BOOLEAN,
        description: "Save group and message history when you leave a group voluntarily.",
        default: true
    },
    notifyOnSave: {
        type: OptionType.BOOLEAN,
        description: "Show a desktop notification when you are removed from a group and it gets saved.",
        default: true
    },
    dimOpacity: {
        type: OptionType.SLIDER,
        description: "Opacity of kicked groups in the Direct Messages sidebar.",
        default: 50,
        markers: [20, 35, 50, 65, 80],
        onChange: () => updateStyles()
    }
});

const savedGroups = new Map<string, SavedGroupData>();
const hydratedChannels = new Map<string, any>();
const knownActiveGroups = new Map<string, SavedGroupData>();
const manuallyDeletedGroupIds = new Set<string>();

let unpatchFluxDispatch: (() => void) | null = null;
let unpatchChannelStore: (() => void) | null = null;
let unpatchChannelStoreHasChannel: (() => void) | null = null;
let unpatchChannelStoreHasPrivate: (() => void) | null = null;
let unpatchChannelStoreIsPrivate: (() => void) | null = null;
let unpatchChannelStoreGetSorted: (() => void) | null = null;
let unpatchChannelStoreGetPrivate: (() => void) | null = null;
let unpatchChannelStoreGetMutablePrivate: (() => void) | null = null;
let unpatchPrivateChannelSortStore: (() => void) | null = null;
let unpatchFetchMessages: (() => void) | null = null;
let unpatchSendMessage: (() => void) | null = null;
let unpatchHTTPGet: (() => void) | null = null;
let unpatchRestGet: (() => void) | null = null;
const unpatchCloseMethods: (() => void)[] = [];

let channelStoreListener: (() => void) | null = null;
let sidebarObserver: MutationObserver | null = null;
let _domUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let _bannerTimers: ReturnType<typeof setTimeout>[] = [];
let _persistKnownTimer: ReturnType<typeof setTimeout> | undefined;

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function sanitizeForStorage(data: any): any {
    try {
        return JSON.parse(JSON.stringify(data, (_, value) => {
            if (typeof value === "function" || typeof value === "symbol") return undefined;
            if (typeof value === "bigint") return value.toString();
            if (value instanceof Node) return undefined;
            return value;
        }));
    } catch {
        return data;
    }
}

function hydrateChannelRecord(data: SavedGroupData): any {
    let baseRecord: any = null;

    try {
        if (typeof createChannelRecordFromServer === "function") {
            const rawRecipients = Array.isArray(data.rawRecipients) && data.rawRecipients.length > 0
                ? data.rawRecipients
                : Array.isArray(data.recipients)
                    ? data.recipients.map(r => {
                        if (typeof r === "object" && r !== null) return r;
                        const uid = String(r);
                        const user = UserStore.getUser(uid);
                        return {
                            id: uid,
                            username: user?.username || "User",
                            discriminator: user?.discriminator || "0000",
                            avatar: user?.avatar || null,
                            global_name: (user as any)?.globalName || (user as any)?.global_name || user?.username || "User"
                        };
                    })
                    : [];

            baseRecord = createChannelRecordFromServer({
                id: data.id,
                type: 3,
                name: data.name || "Group DM",
                icon: data.icon || null,
                owner_id: data.ownerId,
                ownerId: data.ownerId,
                topic: data.topic || "",
                recipients: rawRecipients,
                rawRecipients: rawRecipients,
                last_message_id: data.lastMessageId || null,
                lastMessageId: data.lastMessageId || null,
                is_spam: false,
                is_message_request: false,
                flags: 0,
            });
        }
    } catch {}

    if (!baseRecord) {
        baseRecord = {
            id: data.id,
            type: 3,
            name: data.name || "Group DM",
            icon: data.icon || null,
            ownerId: data.ownerId,
            topic: data.topic || "",
            recipients: data.recipients || [],
            rawRecipients: data.rawRecipients || [],
            lastMessageId: data.lastMessageId || null,
            flags: 0,
        };
    }

    baseRecord.isArchivedGroup = true;

    // Wrap in a defensive Proxy so that any Discord Channel method returns safe defaults without throwing
    return new Proxy(baseRecord, {
        get(target, prop, receiver) {
            if (prop in target) {
                const val = Reflect.get(target, prop, receiver);
                return typeof val === "function" ? val.bind(target) : val;
            }
            if (prop === "getIconURL") {
                return (size?: number) => {
                    if (target.icon) {
                        return `https://cdn.discordapp.com/channel-icons/${target.id}/${target.icon}.png?size=${size || 128}`;
                    }
                    return null;
                };
            }
            if (prop === "isGroupDM" || prop === "isMultiUserDM" || prop === "isPrivate") {
                return () => true;
            }
            if (prop === "isDM" || prop === "isSystemDM" || prop === "isThread" || prop === "isBroadcast" || prop === "isManaged") {
                return () => false;
            }
            if (prop === "getRecipientId") {
                return () => target.recipients?.[0]?.id || target.recipients?.[0] || "";
            }
            if (prop === "isOwner") {
                return (userId: string) => userId === target.ownerId;
            }
            if (typeof prop === "string" && prop.startsWith("is")) {
                return () => false;
            }
            if (typeof prop === "string" && prop.startsWith("has")) {
                return () => false;
            }
            return undefined;
        }
    });
}

function getChannelMessagesSnapshot(channelId: string): any[] {
    try {
        const cache = MessageStore?.getMessages?.(channelId) as any;
        if (!cache) return [];
        let rawList: any[] = [];
        if (Array.isArray(cache)) rawList = cache;
        else if (typeof cache.toArray === "function") rawList = cache.toArray();
        else if (Array.isArray(cache._array)) rawList = cache._array;
        else if (typeof cache.values === "function") rawList = Array.from(cache.values());
        else if (typeof cache === "object") rawList = Object.values(cache);

        return rawList.map(msg => {
            if (!msg || typeof msg !== "object") return null;
            return {
                id: String(msg.id),
                channel_id: String(channelId),
                content: typeof msg.content === "string" ? msg.content : "",
                author: msg.author ? {
                    id: String(msg.author.id),
                    username: msg.author.username || "User",
                    discriminator: msg.author.discriminator || "0000",
                    avatar: msg.author.avatar || null,
                    global_name: msg.author.globalName || msg.author.global_name || msg.author.username,
                    bot: Boolean(msg.author.bot)
                } : undefined,
                timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
                edited_timestamp: msg.editedTimestamp ? new Date(msg.editedTimestamp).toISOString() : null,
                tts: Boolean(msg.tts),
                mention_everyone: Boolean(msg.mentionEveryone || msg.mention_everyone),
                mentions: Array.isArray(msg.mentions) ? msg.mentions.map((m: any) => ({
                    id: String(m.id || m),
                    username: m.username || "User",
                    discriminator: m.discriminator || "0000",
                    avatar: m.avatar || null,
                    global_name: m.globalName || m.global_name || m.username
                })) : [],
                mention_roles: Array.isArray(msg.mentionRoles || msg.mention_roles) ? (msg.mentionRoles || msg.mention_roles) : [],
                attachments: Array.isArray(msg.attachments) ? msg.attachments.map((a: any) => ({
                    id: String(a.id),
                    filename: a.filename || "file",
                    size: a.size || 0,
                    url: a.url || a.proxy_url || "",
                    proxy_url: a.proxy_url || a.url || "",
                    width: a.width,
                    height: a.height,
                    content_type: a.content_type
                })) : [],
                embeds: Array.isArray(msg.embeds) ? sanitizeForStorage(msg.embeds) : [],
                reactions: Array.isArray(msg.reactions) ? msg.reactions.map((r: any) => ({
                    count: r.count || 1,
                    emoji: r.emoji ? { id: r.emoji.id, name: r.emoji.name, animated: Boolean(r.emoji.animated) } : { name: "" },
                    me: Boolean(r.me)
                })) : [],
                pinned: Boolean(msg.pinned),
                type: Number(msg.type ?? 0),
                flags: Number(msg.flags ?? 0)
            };
        }).filter(Boolean);
    } catch {
        return [];
    }
}

function getDescendingMessages(messages: any[]): any[] {
    if (!Array.isArray(messages)) return [];
    return [...messages].sort((a, b) => {
        try {
            if (a.id && b.id && a.id !== b.id) {
                return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
            }
        } catch {}
        const tA = new Date(a.timestamp || 0).getTime();
        const tB = new Date(b.timestamp || 0).getTime();
        return tB - tA;
    });
}

function extractGroupSnapshot(ch: any): SavedGroupData {
    const messages = settings.store.saveMessages ? getChannelMessagesSnapshot(ch.id) : [];
    return {
        id: ch.id,
        name: ch.name || "Group DM",
        icon: ch.icon || null,
        ownerId: ch.ownerId,
        topic: ch.topic || "",
        type: 3,
        recipients: ch.recipients || [],
        rawRecipients: ch.rawRecipients || [],
        lastMessageId: ch.lastMessageId || ch.last_message_id || null,
        kickedAt: 0,
        savedMessages: messages
    };
}

function debouncedPersistKnownGroups() {
    if (_persistKnownTimer) return;
    _persistKnownTimer = setTimeout(async () => {
        _persistKnownTimer = undefined;
        try {
            const clean = sanitizeForStorage(Array.from(knownActiveGroups.values()));
            await DataStore.set(DATA_STORE_KNOWN_KEY, clean);
        } catch {}
    }, 2000);
}

function updateKnownActiveGroups() {
    try {
        const privateChannels = (ChannelStore as any)?.getMutablePrivateChannels?.() || {};
        const sortedList = (ChannelStore as any)?.getSortedPrivateChannels?.() || [];

        const allCandidates = [
            ...Object.values(privateChannels),
            ...(Array.isArray(sortedList) ? sortedList : [])
        ];

        let changed = false;
        for (const ch of allCandidates) {
            if (ch && (ch.type === 3 || ch.isGroupDM?.()) && !savedGroups.has(ch.id)) {
                if (!knownActiveGroups.has(ch.id)) {
                    knownActiveGroups.set(ch.id, extractGroupSnapshot(ch));
                    changed = true;
                } else {
                    const existing = knownActiveGroups.get(ch.id)!;
                    if (ch.name && ch.name !== existing.name) {
                        existing.name = ch.name;
                        changed = true;
                    }
                    if (ch.lastMessageId && ch.lastMessageId !== existing.lastMessageId) {
                        existing.lastMessageId = ch.lastMessageId;
                        changed = true;
                    }
                    if (ch.icon && ch.icon !== existing.icon) {
                        existing.icon = ch.icon;
                        changed = true;
                    }
                    if (settings.store.saveMessages) {
                        const currentMsgs = getChannelMessagesSnapshot(ch.id);
                        if (currentMsgs.length > (existing.savedMessages?.length || 0)) {
                            existing.savedMessages = currentMsgs;
                            changed = true;
                        }
                    }
                }
            }
        }

        if (changed) {
            debouncedPersistKnownGroups();
        }
    } catch {}
}

async function persistSavedGroups() {
    try {
        const clean = sanitizeForStorage(Array.from(savedGroups.values()));
        await DataStore.set(DATA_STORE_SAVED_KEY, clean);

        // Fallback summary in localStorage for channel existence
        try {
            const summary = Array.from(savedGroups.values()).map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon,
                type: 3,
                kickedAt: g.kickedAt,
                msgCount: g.savedMessages?.length || 0
            }));
            localStorage.setItem(LS_SAVED_SUMMARY_KEY, JSON.stringify(summary));
        } catch {}
    } catch (e) {
        console.error("[SaveGroups] Failed to save groups to DataStore:", e);
    }
}

async function archiveGroup(channelId: string, channelHint?: any) {
    if (manuallyDeletedGroupIds.has(channelId)) return;
    if (savedGroups.has(channelId)) {
        // If already saved, refresh messages if current store has more
        const existingSaved = savedGroups.get(channelId)!;
        if (settings.store.saveMessages) {
            const currentMsgs = getChannelMessagesSnapshot(channelId);
            if (currentMsgs.length > (existingSaved.savedMessages?.length || 0)) {
                existingSaved.savedMessages = currentMsgs;
                await persistSavedGroups();
            }
        }
        return;
    }

    let snapshot = knownActiveGroups.get(channelId);
    const existing = ChannelStore.getChannel(channelId) || channelHint;

    if (!snapshot && existing) {
        snapshot = extractGroupSnapshot(existing);
    }

    if (!snapshot) {
        snapshot = {
            id: channelId,
            name: existing?.name || channelHint?.name || "Group DM",
            icon: existing?.icon || channelHint?.icon || null,
            ownerId: existing?.ownerId || channelHint?.ownerId,
            topic: existing?.topic || channelHint?.topic || "",
            type: 3,
            recipients: existing?.recipients || channelHint?.recipients || [],
            rawRecipients: existing?.rawRecipients || channelHint?.rawRecipients || [],
            lastMessageId: existing?.lastMessageId || channelHint?.lastMessageId || null,
            kickedAt: Date.now(),
            savedMessages: settings.store.saveMessages ? getChannelMessagesSnapshot(channelId) : []
        };
    } else {
        snapshot.kickedAt = Date.now();
        if (settings.store.saveMessages) {
            const currentMsgs = getChannelMessagesSnapshot(channelId);
            if (currentMsgs.length > 0) {
                snapshot.savedMessages = currentMsgs;
            }
        }
    }

    knownActiveGroups.delete(channelId);
    savedGroups.set(channelId, snapshot);
    hydratedChannels.set(channelId, hydrateChannelRecord(snapshot));

    await persistSavedGroups();
    debouncedPersistKnownGroups();

    updateStyles();
    scanAndTagSidebarElements();

    try { (ChannelStore as any)?.emitChange?.(); } catch {}
    try { (PrivateChannelSortStore as any)?.emitChange?.(); } catch {}

    if (settings.store.notifyOnSave) {
        showNotification({
            title: t("Kicked from group"),
            body: `${snapshot.name} - ${t("Saved group to your DMs.")}`,
            icon: snapshot.icon ? `https://cdn.discordapp.com/channel-icons/${channelId}/${snapshot.icon}.png` : undefined
        });
    }

    const currentSelected = SelectedChannelStore?.getChannelId?.();
    if (currentSelected === channelId) {
        renderArchivedNoticeBanner(channelId);
        restoreSavedMessages(channelId);
    }
}

async function unarchiveGroup(channelId: string, realChannel?: any) {
    if (!savedGroups.has(channelId)) return;

    savedGroups.delete(channelId);
    hydratedChannels.delete(channelId);
    manuallyDeletedGroupIds.delete(channelId);

    const liveCh = realChannel || (ChannelStore as any)?._origGetChannel?.(channelId) || ChannelStore.getChannel(channelId);
    if (liveCh && !liveCh.isArchivedGroup) {
        knownActiveGroups.set(channelId, extractGroupSnapshot(liveCh));
    }

    await persistSavedGroups();
    debouncedPersistKnownGroups();

    updateStyles();
    removeArchivedNoticeBanner();

    document.querySelectorAll(
        `nav a[href*="/channels/@me/${channelId}"], [class*="privateChannels"] a[href*="/channels/@me/${channelId}"]`
    ).forEach(el => {
        el.classList.remove("vc-savegroups-kicked");
    });
    document.querySelectorAll(".vc-savegroups-badge").forEach(el => el.remove());

    try { (ChannelStore as any)?.emitChange?.(); } catch {}
    try { (PrivateChannelSortStore as any)?.emitChange?.(); } catch {}

    try {
        if (liveCh) {
            FluxDispatcher.dispatch({
                type: "CHANNEL_UPDATES",
                channels: [liveCh]
            });
        }
    } catch {}

    showToast(t("Re-added to group DM!"), Toasts.Type.SUCCESS);
}

function checkOfflineKicks() {
    try {
        const currentPrivate = (ChannelStore as any)?.getMutablePrivateChannels?.() || {};
        const currentSorted = (ChannelStore as any)?.getSortedPrivateChannels?.() || [];
        const currentIds = new Set([
            ...Object.keys(currentPrivate),
            ...((Array.isArray(currentSorted) ? currentSorted : []).map((c: any) => c?.id).filter(Boolean))
        ]);

        // Restore any group DMs user was re-added to while offline
        for (const [id] of Array.from(savedGroups.entries())) {
            if (currentIds.has(id)) {
                const realCh = currentPrivate[id] || (ChannelStore as any)?._origGetChannel?.(id);
                if (realCh && !(realCh as any).isArchivedGroup) {
                    unarchiveGroup(id, realCh);
                }
            }
        }

        if (knownActiveGroups.size === 0) return;
        for (const [id, knownData] of Array.from(knownActiveGroups.entries())) {
            if (!currentIds.has(id) && !savedGroups.has(id) && !manuallyDeletedGroupIds.has(id)) {
                archiveGroup(id, knownData);
            }
        }
    } catch {}
}

function updateStyles() {
    let styleEl = document.getElementById("vc-savegroups-dynamic-styles") as HTMLStyleElement | null;
    if (savedGroups.size === 0) {
        if (styleEl) styleEl.remove();
        return;
    }

    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "vc-savegroups-dynamic-styles";
        document.head.appendChild(styleEl);
    }

    const opacity = (settings.store.dimOpacity ?? 50) / 100;
    const hoverOpacity = Math.min(1, opacity + 0.3);

    const selectors = Array.from(savedGroups.keys()).map(id => `
        nav a[href*="/channels/@me/${id}"],
        [class*="privateChannels"] a[href*="/channels/@me/${id}"]
    `).join(",\n");

    const hoverSelectors = Array.from(savedGroups.keys()).map(id => `
        nav a[href*="/channels/@me/${id}"]:hover,
        [class*="privateChannels"] a[href*="/channels/@me/${id}"]:hover
    `).join(",\n");

    styleEl.textContent = `
        ${selectors} {
            opacity: ${opacity} !important;
            filter: grayscale(80%) !important;
            transition: opacity 0.2s ease, filter 0.2s ease !important;
        }
        ${hoverSelectors} {
            opacity: ${hoverOpacity} !important;
            filter: grayscale(30%) !important;
        }
    `;
}

function scanAndTagSidebarElements() {
    document.querySelectorAll(".vc-savegroups-badge").forEach(el => el.remove());

    if (savedGroups.size === 0) return;

    for (const [id] of savedGroups) {
        const elements = document.querySelectorAll(
            `nav a[href*="/channels/@me/${id}"], [class*="privateChannels"] a[href*="/channels/@me/${id}"]`
        );

        for (const el of Array.from(elements)) {
            if (!el.classList.contains("vc-savegroups-kicked")) {
                el.classList.add("vc-savegroups-kicked");
            }
        }
    }
}

function startSidebarObserver() {
    if (sidebarObserver) return;

    sidebarObserver = new MutationObserver(() => {
        if (_domUpdateTimer) return;
        _domUpdateTimer = setTimeout(() => {
            _domUpdateTimer = undefined;
            scanAndTagSidebarElements();
        }, 150);
    });

    const target = document.querySelector("nav[aria-label]") ||
        document.querySelector('[class*="privateChannels_"]') ||
        document.querySelector('[class*="sidebar_"]') ||
        document.body;

    sidebarObserver.observe(target, { childList: true, subtree: true });
    scanAndTagSidebarElements();
}

function restoreSavedMessages(channelId: string) {
    const saved = savedGroups.get(channelId);
    if (!saved) return;

    try {
        const rawMsgs = saved.savedMessages || [];
        if (rawMsgs.length === 0) return;

        const descMsgs = getDescendingMessages(rawMsgs);
        const messageRecords = descMsgs.map((msg: any) => {
            if (typeof createMessageRecord === "function") {
                try {
                    const record = createMessageRecord(msg);
                    if (record) return record;
                } catch {}
            }
            return msg;
        });

        // 1. Dispatch LOAD_MESSAGES_SUCCESS to populate Discord's MessageStore
        FluxDispatcher.dispatch({
            type: "LOAD_MESSAGES_SUCCESS",
            channelId,
            messages: messageRecords,
            isBefore: false,
            isAfter: false,
            hasMoreBefore: false,
            hasMoreAfter: false,
            limit: Math.max(100, messageRecords.length),
        });

        // 2. Also emit change on MessageStore so React immediately re-renders
        try {
            (MessageStore as any)?.emitChange?.();
        } catch {}
    } catch (err) {
        console.error("[SaveGroups] Failed to restore saved messages:", err);
    }
}

function removeArchivedNoticeBanner() {
    _bannerTimers.forEach(clearTimeout);
    _bannerTimers = [];
    const el = document.getElementById("vc-savegroups-chat-banner");
    if (el) el.remove();
}

function renderArchivedNoticeBanner(channelId: string) {
    removeArchivedNoticeBanner();
    if (!savedGroups.has(channelId)) return;

    const group = savedGroups.get(channelId);
    if (!group) return;

    const banner = document.createElement("div");
    banner.id = "vc-savegroups-chat-banner";
    banner.className = "vc-savegroups-banner";

    const leftDiv = document.createElement("div");
    leftDiv.className = "vc-savegroups-banner-left";

    leftDiv.innerHTML = `
        <svg class="vc-savegroups-banner-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="21 8 21 3 21 3 8"></polyline>
            <rect x="1" y="3" width="22" height="5"></rect>
            <line x1="10" y1="12" x2="14" y2="12"></line>
        </svg>
        <div>
            <div class="vc-savegroups-banner-title">${escapeHtml(t("Archived Group"))} - ${escapeHtml(group.name || "Group DM")}</div>
            <div class="vc-savegroups-banner-subtitle">${escapeHtml(t("This group is archived. You were removed from this group. New messages and calls are disabled."))}</div>
        </div>
    `;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "vc-savegroups-banner-btn";
    deleteBtn.textContent = t("Delete Saved Group");
    deleteBtn.onclick = () => {
        confirmDeleteSavedGroup(channelId);
    };

    banner.appendChild(leftDiv);
    banner.appendChild(deleteBtn);

    const tryAttach = () => {
        const chatContent = document.querySelector('[class*="chatContent"]') ||
            document.querySelector('[class*="messagesWrapper"]')?.parentElement ||
            document.querySelector('[class*="content_"][class*="chat"]');
        if (chatContent && !document.getElementById("vc-savegroups-chat-banner")) {
            chatContent.prepend(banner);
            return true;
        }
        return false;
    };

    if (!tryAttach()) {
        const timer = setTimeout(tryAttach, 200);
        _bannerTimers.push(timer);
        const retryTimer = setTimeout(tryAttach, 600);
        _bannerTimers.push(retryTimer);
    }
}

function confirmDeleteSavedGroup(channelId: string) {
    const group = savedGroups.get(channelId);
    const name = group?.name || "Group DM";

    Alerts.show({
        title: t("Delete Saved Group"),
        confirmText: t("Delete"),
        cancelText: t("Cancel"),
        confirmColor: "brand-danger",
        body: (
            <div style={{ color: "var(--text-normal, #dbdee1)", fontSize: "14px", lineHeight: "1.4" }}>
                {t("Are you sure you want to permanently delete this saved group from your messages?")}
                <div style={{ marginTop: "8px", fontWeight: "bold", color: "var(--header-primary, #ffffff)" }}>
                    {name}
                </div>
            </div>
        ),
        onConfirm: () => {
            deleteSavedGroup(channelId);
        }
    });
}

async function deleteSavedGroup(channelId: string) {
    manuallyDeletedGroupIds.add(channelId);
    savedGroups.delete(channelId);
    hydratedChannels.delete(channelId);
    knownActiveGroups.delete(channelId);

    await persistSavedGroups();
    debouncedPersistKnownGroups();

    updateStyles();
    removeArchivedNoticeBanner();

    if (SelectedChannelStore.getChannelId() === channelId) {
        NavigationRouter.transitionTo("/channels/@me");
    }

    try { (ChannelStore as any)?.emitChange?.(); } catch {}
    try { (PrivateChannelSortStore as any)?.emitChange?.(); } catch {}

    // Dispatch a native CHANNEL_DELETE so Discord stores clean up their state cleanly
    try {
        FluxDispatcher.dispatch({
            type: "CHANNEL_DELETE",
            channel: { id: channelId, type: 3 }
        });
    } catch {}

    showToast(t("Saved group removed"), Toasts.Type.SUCCESS);
}

async function backupGroupNow(channel: any) {
    const channelId = channel.id;
    const messages = settings.store.saveMessages ? getChannelMessagesSnapshot(channelId) : [];
    const groupData: SavedGroupData = {
        id: channelId,
        name: channel.name || "Group DM",
        icon: channel.icon,
        ownerId: channel.ownerId,
        topic: channel.topic,
        type: 3,
        recipients: channel.recipients,
        rawRecipients: channel.rawRecipients,
        lastMessageId: channel.lastMessageId,
        kickedAt: Date.now(),
        savedMessages: messages
    };

    savedGroups.set(channelId, groupData);
    hydratedChannels.set(channelId, hydrateChannelRecord(groupData));
    await persistSavedGroups();
    updateStyles();
    scanAndTagSidebarElements();

    try { (ChannelStore as any)?.emitChange?.(); } catch {}
    try { (PrivateChannelSortStore as any)?.emitChange?.(); } catch {}

    showToast(t("Group backed up successfully"), Toasts.Type.SUCCESS);
}

function handleChannelSelect(channelId: string) {
    if (!channelId) {
        removeArchivedNoticeBanner();
        return;
    }

    if (savedGroups.has(channelId)) {
        renderArchivedNoticeBanner(channelId);
        // Dispatch multiple times to guarantee MessageStore has messages ready as React mounts
        restoreSavedMessages(channelId);
        setTimeout(() => restoreSavedMessages(channelId), 50);
        setTimeout(() => restoreSavedMessages(channelId), 150);
        setTimeout(() => restoreSavedMessages(channelId), 350);
        setTimeout(() => restoreSavedMessages(channelId), 700);
    } else {
        removeArchivedNoticeBanner();
    }
}

function patchFluxDispatcher() {
    if (!FluxDispatcher || (FluxDispatcher as any).__nightcordSaveGroupsPatched) return;
    (FluxDispatcher as any).__nightcordSaveGroupsPatched = true;

    const origDispatch = FluxDispatcher.dispatch;
    FluxDispatcher.dispatch = function(action: any) {
        if (!action) return origDispatch.apply(this, arguments as any);

        const { type } = action;

        if (type === "CHANNEL_CREATE") {
            const ch = action.channel;
            const channelId = ch?.id || action.channelId;
            if (channelId && savedGroups.has(channelId)) {
                const currentUserId = UserStore.getCurrentUser()?.id;
                const isRecipient = !currentUserId || ch?.recipients?.some((r: any) => (typeof r === "string" ? r : r?.id) === currentUserId);
                if (isRecipient || ch?.type === 3) {
                    unarchiveGroup(channelId, ch);
                }
            }
        }

        if (type === "CHANNEL_RECIPIENT_ADD") {
            const channelId = action.channelId || action.channel?.id;
            const currentUserId = UserStore.getCurrentUser()?.id;
            const addedUserId = action.user?.id || action.userId;
            if (channelId && savedGroups.has(channelId)) {
                if (!currentUserId || addedUserId === currentUserId) {
                    unarchiveGroup(channelId, action.channel);
                }
            }
        }

        if (type === "CHANNEL_UPDATES") {
            const { channels } = action;
            if (Array.isArray(channels)) {
                const currentUserId = UserStore.getCurrentUser()?.id;
                for (const ch of channels) {
                    if (ch?.id && savedGroups.has(ch.id)) {
                        const isRecipient = !currentUserId || ch?.recipients?.some((r: any) => (typeof r === "string" ? r : r?.id) === currentUserId);
                        if (isRecipient) {
                            unarchiveGroup(ch.id, ch);
                        }
                    }
                }
            }
        }

        if (type === "CONNECTION_OPEN") {
            const privateChannels = action.privateChannels || action.initialGuildChannels || [];
            if (Array.isArray(privateChannels)) {
                for (const pc of privateChannels) {
                    if (pc?.id && savedGroups.has(pc.id)) {
                        unarchiveGroup(pc.id, pc);
                    }
                }
            }
            updateKnownActiveGroups();
            checkOfflineKicks();
        }

        if (type === "MESSAGE_CREATE") {
            const channelId = action.channelId || action.message?.channel_id;
            if (channelId && savedGroups.has(channelId) && !action.optimistic) {
                unarchiveGroup(channelId);
            }
        }

        if (type === "CHANNEL_DELETE") {
            const channelId = action.channel?.id || action.channelId || action.id;
            if (channelId) {
                if (manuallyDeletedGroupIds.has(channelId)) {
                    manuallyDeletedGroupIds.delete(channelId);
                    return origDispatch.apply(this, arguments as any);
                }

                const isKnown = knownActiveGroups.has(channelId);
                const ch = ChannelStore.getChannel(channelId);
                const isGroup = isKnown || ch?.type === 3 || ch?.isGroupDM?.() || action.channel?.type === 3 || savedGroups.has(channelId);

                if (isGroup) {
                    archiveGroup(channelId, action.channel);
                    // Swallowing CHANNEL_DELETE keeps the group DM right in the user's DMs!
                    return Promise.resolve();
                }
            }
        }

        if (type === "CHANNEL_RECIPIENT_REMOVE") {
            const currentUserId = UserStore.getCurrentUser()?.id;
            const removedUserId = action.user?.id || action.userId;
            const channelId = action.channelId || action.channel?.id;
            if (currentUserId && removedUserId === currentUserId && channelId) {
                if (!manuallyDeletedGroupIds.has(channelId)) {
                    archiveGroup(channelId, action.channel);
                    return Promise.resolve();
                }
            }
        }

        return origDispatch.apply(this, arguments as any);
    };

    unpatchFluxDispatch = () => {
        FluxDispatcher.dispatch = origDispatch;
        delete (FluxDispatcher as any).__nightcordSaveGroupsPatched;
    };
}

function patchManualLeaveTracking() {
    try {
        const patchCloseMod = (mod: any) => {
            if (!mod) return;
            const closeMethods = ["closePrivateChannel", "closeChannel", "deletePrivateChannel", "closeDM"];

            for (const method of closeMethods) {
                if (typeof mod[method] === "function" && !mod[method].__nightcordSaveGroupsTracked) {
                    const origFn = mod[method];
                    mod[method] = function(channelId: string, ...args: any[]) {
                        if (channelId) {
                            const ch = ChannelStore.getChannel(channelId);
                            const isGroup = ch?.type === 3 || ch?.isGroupDM?.() || knownActiveGroups.has(channelId);

                            if (isGroup && !savedGroups.has(channelId) && settings.store.saveOnManualLeave) {
                                // User is voluntarily leaving a group DM:
                                // Archive immediately while messages are still in memory!
                                archiveGroup(channelId, ch);
                            }
                        }
                        return origFn.apply(this, [channelId, ...args]);
                    };
                    mod[method].__nightcordSaveGroupsTracked = true;
                    unpatchCloseMethods.push(() => {
                        mod[method] = origFn;
                        delete mod[method].__nightcordSaveGroupsTracked;
                    });
                }
            }
        };

        const actionMods = [
            findByProps("closePrivateChannel"),
            findByProps("openPrivateChannel")
        ].filter(Boolean) as any[];

        actionMods.forEach(patchCloseMod);
        waitFor(["closePrivateChannel"], patchCloseMod);
    } catch {}
}

function patchChannelStore() {
    const channelStoreAny = ChannelStore as any;
    if (!channelStoreAny) return;

    const origGetChannel = ChannelStore.getChannel;
    channelStoreAny._origGetChannel = origGetChannel;
    ChannelStore.getChannel = function(id: string) {
        if (id && savedGroups.has(id)) {
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (currentUserId) {
                const realCh = origGetChannel.apply(this, arguments as any);
                if (realCh && !(realCh as any).isArchivedGroup) {
                    const recipients: any[] = realCh.recipients ?? [];
                    const isRecipient = recipients.some(
                        (r: any) => (typeof r === "string" ? r : r?.id) === currentUserId
                    );
                    if (isRecipient) {
                        unarchiveGroup(id, realCh);
                        return realCh;
                    }
                }
            }
            let hydrated = hydratedChannels.get(id);
            if (!hydrated && savedGroups.has(id)) {
                hydrated = hydrateChannelRecord(savedGroups.get(id)!);
                hydratedChannels.set(id, hydrated);
            }
            return hydrated;
        }
        return origGetChannel.apply(this, arguments as any);
    };
    unpatchChannelStore = () => {
        ChannelStore.getChannel = origGetChannel;
        delete channelStoreAny._origGetChannel;
    };

    if (typeof channelStoreAny.hasChannel === "function") {
        const origHas = channelStoreAny.hasChannel;
        channelStoreAny.hasChannel = function(id: string) {
            if (id && savedGroups.has(id)) return true;
            return origHas.apply(this, arguments as any);
        };
        unpatchChannelStoreHasChannel = () => { channelStoreAny.hasChannel = origHas; };
    }

    if (typeof channelStoreAny.hasPrivateChannel === "function") {
        const origHasPriv = channelStoreAny.hasPrivateChannel;
        channelStoreAny.hasPrivateChannel = function(id: string) {
            if (id && savedGroups.has(id)) return true;
            return origHasPriv.apply(this, arguments as any);
        };
        unpatchChannelStoreHasPrivate = () => { channelStoreAny.hasPrivateChannel = origHasPriv; };
    }

    if (typeof channelStoreAny.isPrivate === "function") {
        const origIsPriv = channelStoreAny.isPrivate;
        channelStoreAny.isPrivate = function(id: string) {
            if (id && savedGroups.has(id)) return true;
            return origIsPriv.apply(this, arguments as any);
        };
        unpatchChannelStoreIsPrivate = () => { channelStoreAny.isPrivate = origIsPriv; };
    }

    if (typeof channelStoreAny.getMutablePrivateChannels === "function") {
        const origGetMut = channelStoreAny.getMutablePrivateChannels;
        channelStoreAny.getMutablePrivateChannels = function() {
            const chs = origGetMut.apply(this, arguments as any) || {};
            if (savedGroups.size === 0) return chs;
            const res = { ...chs };
            for (const [id] of savedGroups) {
                if (!res[id]) {
                    let hydrated = hydratedChannels.get(id);
                    if (!hydrated) {
                        hydrated = hydrateChannelRecord(savedGroups.get(id)!);
                        hydratedChannels.set(id, hydrated);
                    }
                    if (hydrated) res[id] = hydrated;
                }
            }
            return res;
        };
        unpatchChannelStoreGetMutablePrivate = () => { channelStoreAny.getMutablePrivateChannels = origGetMut; };
    }

    if (typeof channelStoreAny.getPrivateChannels === "function") {
        const origGetPriv = channelStoreAny.getPrivateChannels;
        channelStoreAny.getPrivateChannels = function() {
            const chs = origGetPriv.apply(this, arguments as any) || {};
            if (savedGroups.size === 0) return chs;
            const res = { ...chs };
            for (const [id] of savedGroups) {
                if (!res[id]) {
                    let hydrated = hydratedChannels.get(id);
                    if (!hydrated) {
                        hydrated = hydrateChannelRecord(savedGroups.get(id)!);
                        hydratedChannels.set(id, hydrated);
                    }
                    if (hydrated) res[id] = hydrated;
                }
            }
            return res;
        };
        unpatchChannelStoreGetPrivate = () => { channelStoreAny.getPrivateChannels = origGetPriv; };
    }

    if (typeof channelStoreAny.getSortedPrivateChannels === "function") {
        const origGetSorted = channelStoreAny.getSortedPrivateChannels;
        channelStoreAny.getSortedPrivateChannels = function() {
            const list = origGetSorted.apply(this, arguments as any);
            if (!list || !Array.isArray(list) || savedGroups.size === 0) return list;
            const result = [...list];
            const existingIds = new Set(result.map((c: any) => c?.id).filter(Boolean));
            for (const [id] of savedGroups) {
                if (!existingIds.has(id)) {
                    let hydrated = hydratedChannels.get(id);
                    if (!hydrated) {
                        hydrated = hydrateChannelRecord(savedGroups.get(id)!);
                        hydratedChannels.set(id, hydrated);
                    }
                    if (hydrated) result.push(hydrated);
                }
            }
            return result;
        };
        unpatchChannelStoreGetSorted = () => { channelStoreAny.getSortedPrivateChannels = origGetSorted; };
    }
}

function patchPrivateChannelSortStore(sortStore: any) {
    if (!sortStore || (sortStore as any).__nightcordSaveGroupsPatched) return;
    (sortStore as any).__nightcordSaveGroupsPatched = true;

    const sortUnpatches: (() => void)[] = [];
    const patchSortFn = (fnName: string) => {
        if (typeof sortStore[fnName] === "function") {
            const orig = sortStore[fnName];
            const isObjectArray = fnName === "getSortedPrivateChannels";

            sortStore[fnName] = function(...args: any[]) {
                const list: any = orig.apply(this, args);
                if (!list || !Array.isArray(list) || savedGroups.size === 0) return list;

                const result = [...list];
                const existingIds = new Set(result.map((item: any) => typeof item === "string" ? item : item?.id));

                for (const [id] of savedGroups) {
                    if (!existingIds.has(id)) {
                        existingIds.add(id);
                        if (isObjectArray) {
                            let hydrated = hydratedChannels.get(id);
                            if (!hydrated) {
                                hydrated = hydrateChannelRecord(savedGroups.get(id)!);
                                hydratedChannels.set(id, hydrated);
                            }
                            if (hydrated) result.push(hydrated);
                        } else {
                            result.push(id);
                        }
                    }
                }
                return result;
            };

            sortUnpatches.push(() => {
                sortStore[fnName] = orig;
                delete (sortStore as any).__nightcordSaveGroupsPatched;
            });
        }
    };

    ["getPrivateChannelIds", "getSortedPrivateChannels", "getSortedPrivateChannelIds"].forEach(patchSortFn);
    unpatchPrivateChannelSortStore = () => {
        sortUnpatches.forEach(fn => fn());
        sortUnpatches.length = 0;
    };
}

function patchNetworkLayer() {
    // 1. Intercept RestAPI.get (imported directly from @webpack/common)
    if (RestAPI && typeof RestAPI.get === "function" && !(RestAPI.get as any).__nightcordSaveGroupsPatched) {
        const origRestGet = RestAPI.get;
        RestAPI.get = function(opts: any) {
            const url = typeof opts === "string" ? opts : opts?.url;
            if (url && typeof url === "string") {
                for (const [id, savedGroup] of savedGroups) {
                    if (url.includes(`/channels/${id}/messages`)) {
                        const descMsgs = getDescendingMessages(savedGroup.savedMessages || []);
                        return Promise.resolve({
                            ok: true,
                            status: 200,
                            body: descMsgs,
                            text: JSON.stringify(descMsgs),
                            headers: {}
                        });
                    }
                    if (url.includes(`/channels/${id}`)) {
                        const groupObj = {
                            id: savedGroup.id,
                            type: 3,
                            name: savedGroup.name || "Group DM",
                            icon: savedGroup.icon || null,
                            owner_id: savedGroup.ownerId,
                            ownerId: savedGroup.ownerId,
                            topic: savedGroup.topic || "",
                            recipients: savedGroup.recipients || [],
                            rawRecipients: savedGroup.rawRecipients || [],
                            last_message_id: savedGroup.lastMessageId || null,
                            lastMessageId: savedGroup.lastMessageId || null,
                        };
                        return Promise.resolve({
                            ok: true,
                            status: 200,
                            body: groupObj,
                            text: JSON.stringify(groupObj),
                            headers: {}
                        });
                    }
                }
            }
            return origRestGet.apply(this, arguments as any);
        };
        (RestAPI.get as any).__nightcordSaveGroupsPatched = true;
        unpatchRestGet = () => {
            RestAPI.get = origRestGet;
            delete (RestAPI.get as any).__nightcordSaveGroupsPatched;
        };
    }

    // 2. Intercept MessageActions.fetchMessages & sendMessage with waitFor for lazy-loaded webpack chunks
    const patchMessageActions = (MessageActions: any) => {
        if (!MessageActions || (MessageActions as any).__nightcordSaveGroupsPatched) return;
        (MessageActions as any).__nightcordSaveGroupsPatched = true;

        if (typeof MessageActions.fetchMessages === "function") {
            const origFetch = MessageActions.fetchMessages;
            MessageActions.fetchMessages = function(opts: any) {
                const channelId = typeof opts === "string" ? opts : opts?.channelId;
                if (channelId && savedGroups.has(channelId)) {
                    restoreSavedMessages(channelId);
                    return Promise.resolve({ ok: true });
                }
                return origFetch.apply(this, arguments as any);
            };
            unpatchFetchMessages = () => {
                MessageActions.fetchMessages = origFetch;
                delete (MessageActions as any).__nightcordSaveGroupsPatched;
            };
        }

        if (typeof MessageActions.sendMessage === "function") {
            const origSend = MessageActions.sendMessage;
            MessageActions.sendMessage = function(channelId: string, ...args: any[]) {
                if (channelId && savedGroups.has(channelId)) {
                    showToast(t("Cannot send messages in an archived group."), Toasts.Type.FAILURE);
                    return Promise.resolve({ ok: false });
                }
                return origSend.apply(this, [channelId, ...args]);
            };
            unpatchSendMessage = () => {
                MessageActions.sendMessage = origSend;
                delete (MessageActions as any).__nightcordSaveGroupsPatched;
            };
        }
    };

    const existingMessageActions = (findByProps("fetchMessages", "sendMessage") || findByProps("sendMessage")) as any;
    if (existingMessageActions) {
        patchMessageActions(existingMessageActions);
    }
    waitFor(["fetchMessages"], (mod: any) => {
        patchMessageActions(mod);
    });

    // 3. Intercept HTTP.get with waitFor
    const patchHTTP = (HTTP: any) => {
        if (!HTTP || !HTTP.get || (HTTP.get as any).__nightcordSaveGroupsPatched) return;
        (HTTP.get as any).__nightcordSaveGroupsPatched = true;

        const origGet = HTTP.get;
        HTTP.get = function(opts: any) {
            const url = typeof opts === "string" ? opts : opts?.url;
            if (url && typeof url === "string") {
                for (const [id, savedGroup] of savedGroups) {
                    if (url.includes(`/channels/${id}/messages`)) {
                        const descMsgs = getDescendingMessages(savedGroup.savedMessages || []);
                        return Promise.resolve({
                            ok: true,
                            status: 200,
                            body: descMsgs,
                            text: JSON.stringify(descMsgs),
                            headers: {}
                        });
                    }
                    if (url.includes(`/channels/${id}`)) {
                        const groupObj = {
                            id: savedGroup.id,
                            type: 3,
                            name: savedGroup.name || "Group DM",
                            icon: savedGroup.icon || null,
                            owner_id: savedGroup.ownerId,
                            ownerId: savedGroup.ownerId,
                            topic: savedGroup.topic || "",
                            recipients: savedGroup.recipients || [],
                            rawRecipients: savedGroup.rawRecipients || [],
                            last_message_id: savedGroup.lastMessageId || null,
                            lastMessageId: savedGroup.lastMessageId || null,
                        };
                        return Promise.resolve({
                            ok: true,
                            status: 200,
                            body: groupObj,
                            text: JSON.stringify(groupObj),
                            headers: {}
                        });
                    }
                }
            }
            return origGet.apply(this, arguments as any);
        };
        unpatchHTTPGet = () => {
            HTTP.get = origGet;
            delete (HTTP.get as any).__nightcordSaveGroupsPatched;
        };
    };

    const existingHTTP = (findByProps("get", "post", "put", "del") || findByProps("get", "post")) as any;
    if (existingHTTP) {
        patchHTTP(existingHTTP);
    }
    waitFor(["get", "post"], (mod: any) => {
        patchHTTP(mod);
    });
}

const ContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { channel?: any; } = {}) => {
    const { channel } = ctx;
    if (!channel) return;

    const channelId = channel.id;
    if (savedGroups.has(channelId)) {
        children.unshift(
            <Menu.MenuGroup key="vc-savegroups-actions">
                <Menu.MenuItem
                    key="delete-saved-group"
                    id="vc-delete-saved-group"
                    label={t("Delete Saved Group")}
                    color="danger"
                    action={() => confirmDeleteSavedGroup(channelId)}
                />
                <Menu.MenuSeparator key="separator-savegroups" />
            </Menu.MenuGroup>
        );
    } else if (channel.type === 3 || channel.isGroupDM?.()) {
        children.unshift(
            <Menu.MenuGroup key="vc-savegroups-backup">
                <Menu.MenuItem
                    key="backup-group-now"
                    id="vc-backup-group-now"
                    label={t("Backup Group Now")}
                    action={() => backupGroupNow(channel)}
                />
                <Menu.MenuSeparator key="separator-savegroups-backup" />
            </Menu.MenuGroup>
        );
    }
};

export default definePlugin({
    name: "SaveGroups",
    description: "Bypasses group DM removal by keeping kicked groups in your direct messages in read-only mode.",
    authors: [SlipcordDevs.nightcord],
    enabledByDefault: false,
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "channel-context": ContextMenuPatch,
        "gdm-context": ContextMenuPatch
    },

    flux: {
        CHANNEL_CREATE(action: any) {
            const channelId = action?.channel?.id || action?.channelId;
            if (channelId && savedGroups.has(channelId)) {
                unarchiveGroup(channelId, action?.channel);
            }
            updateKnownActiveGroups();
        },
        CHANNEL_UPDATES(action: any) {
            const channels = action?.channels;
            if (Array.isArray(channels)) {
                for (const ch of channels) {
                    if (ch?.id && savedGroups.has(ch.id)) {
                        unarchiveGroup(ch.id, ch);
                    }
                }
            }
            updateKnownActiveGroups();
        },
        CONNECTION_OPEN(action: any) {
            const privateChannels = action?.privateChannels || action?.initialGuildChannels || [];
            if (Array.isArray(privateChannels)) {
                for (const pc of privateChannels) {
                    if (pc?.id && savedGroups.has(pc.id)) {
                        unarchiveGroup(pc.id, pc);
                    }
                }
            }
            updateKnownActiveGroups();
            checkOfflineKicks();
        },
        CHANNEL_SELECT(event: { channelId: string; }) {
            const cid = event?.channelId;
            handleChannelSelect(cid);

            // Continuously update active group message snapshot while user views it
            if (cid && knownActiveGroups.has(cid)) {
                setTimeout(() => {
                    if (SelectedChannelStore.getChannelId() === cid) {
                        const msgs = getChannelMessagesSnapshot(cid);
                        if (msgs.length > 0) {
                            const grp = knownActiveGroups.get(cid);
                            if (grp && msgs.length >= (grp.savedMessages?.length || 0)) {
                                grp.savedMessages = msgs;
                                debouncedPersistKnownGroups();
                            }
                        }
                    }
                }, 1200);
            }
        },
        MESSAGE_CREATE(event: { channelId: string; message: any; }) {
            const channelId = event?.channelId;
            if (!channelId) return;

            if (savedGroups.has(channelId)) {
                unarchiveGroup(channelId);
            }

            if (knownActiveGroups.has(channelId)) {
                const group = knownActiveGroups.get(channelId)!;
                if (event.message?.id) {
                    group.lastMessageId = event.message.id;
                }
            }
        }
    },

    async start() {
        try {
            const entries = await DataStore.get<SavedGroupData[]>(DATA_STORE_SAVED_KEY);
            if (Array.isArray(entries)) {
                for (const data of entries) {
                    if (data?.id) {
                        savedGroups.set(data.id, data);
                        hydratedChannels.set(data.id, hydrateChannelRecord(data));
                    }
                }
            }
        } catch (e) {
            console.error("[SaveGroups] Failed to load saved groups from DataStore:", e);
        }

        // Check fallback summary if savedGroups was empty
        if (savedGroups.size === 0) {
            try {
                const rawSummary = localStorage.getItem(LS_SAVED_SUMMARY_KEY);
                if (rawSummary) {
                    const parsed = JSON.parse(rawSummary);
                    if (Array.isArray(parsed)) {
                        for (const item of parsed) {
                            if (item?.id && !savedGroups.has(item.id)) {
                                savedGroups.set(item.id, {
                                    id: item.id,
                                    name: item.name || "Group DM",
                                    icon: item.icon,
                                    type: 3,
                                    kickedAt: item.kickedAt || 0,
                                    savedMessages: []
                                });
                                hydratedChannels.set(item.id, hydrateChannelRecord(savedGroups.get(item.id)!));
                            }
                        }
                    }
                }
            } catch {}
        }

        try {
            const known = await DataStore.get<SavedGroupData[]>(DATA_STORE_KNOWN_KEY);
            if (Array.isArray(known)) {
                for (const data of known) {
                    if (data?.id && !savedGroups.has(data.id)) {
                        knownActiveGroups.set(data.id, data);
                    }
                }
            }
        } catch {}

        patchFluxDispatcher();
        patchManualLeaveTracking();
        patchChannelStore();

        const existingSortStore = PrivateChannelSortStore || (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
        if (existingSortStore) {
            patchPrivateChannelSortStore(existingSortStore);
        }
        waitFor(["getPrivateChannelIds"], (store: any) => {
            patchPrivateChannelSortStore(store);
        });

        patchNetworkLayer();
        updateStyles();
        startSidebarObserver();

        try {
            channelStoreListener = () => {
                updateKnownActiveGroups();
                scanAndTagSidebarElements();
            };
            (ChannelStore as any)?.addChangeListener?.(channelStoreListener);
        } catch {}

        updateKnownActiveGroups();
        checkOfflineKicks();

        const currentChannelId = SelectedChannelStore?.getChannelId?.();
        if (currentChannelId && savedGroups.has(currentChannelId)) {
            renderArchivedNoticeBanner(currentChannelId);
            restoreSavedMessages(currentChannelId);
            setTimeout(() => restoreSavedMessages(currentChannelId), 100);
            setTimeout(() => restoreSavedMessages(currentChannelId), 300);
            setTimeout(() => restoreSavedMessages(currentChannelId), 800);
        }

        try { (ChannelStore as any)?.emitChange?.(); } catch {}
        try { existingSortStore?.emitChange?.(); } catch {}
    },

    stop() {
        if (unpatchFluxDispatch) {
            unpatchFluxDispatch();
            unpatchFluxDispatch = null;
        }

        unpatchCloseMethods.forEach(fn => fn());
        unpatchCloseMethods.length = 0;

        if (channelStoreListener) {
            try { (ChannelStore as any)?.removeChangeListener?.(channelStoreListener); } catch {}
            channelStoreListener = null;
        }

        if (unpatchChannelStore) {
            unpatchChannelStore();
            unpatchChannelStore = null;
        }
        if (unpatchChannelStoreHasChannel) {
            unpatchChannelStoreHasChannel();
            unpatchChannelStoreHasChannel = null;
        }
        if (unpatchChannelStoreHasPrivate) {
            unpatchChannelStoreHasPrivate();
            unpatchChannelStoreHasPrivate = null;
        }
        if (unpatchChannelStoreIsPrivate) {
            unpatchChannelStoreIsPrivate();
            unpatchChannelStoreIsPrivate = null;
        }
        if (unpatchChannelStoreGetSorted) {
            unpatchChannelStoreGetSorted();
            unpatchChannelStoreGetSorted = null;
        }
        if (unpatchChannelStoreGetMutablePrivate) {
            unpatchChannelStoreGetMutablePrivate();
            unpatchChannelStoreGetMutablePrivate = null;
        }
        if (unpatchChannelStoreGetPrivate) {
            unpatchChannelStoreGetPrivate();
            unpatchChannelStoreGetPrivate = null;
        }

        if (unpatchPrivateChannelSortStore) {
            unpatchPrivateChannelSortStore();
            unpatchPrivateChannelSortStore = null;
        }

        if (unpatchFetchMessages) {
            unpatchFetchMessages();
            unpatchFetchMessages = null;
        }
        if (unpatchSendMessage) {
            unpatchSendMessage();
            unpatchSendMessage = null;
        }
        if (unpatchHTTPGet) {
            unpatchHTTPGet();
            unpatchHTTPGet = null;
        }
        if (unpatchRestGet) {
            unpatchRestGet();
            unpatchRestGet = null;
        }

        if (sidebarObserver) {
            sidebarObserver.disconnect();
            sidebarObserver = null;
        }
        if (_domUpdateTimer) {
            clearTimeout(_domUpdateTimer);
            _domUpdateTimer = undefined;
        }
        if (_persistKnownTimer) {
            clearTimeout(_persistKnownTimer);
            _persistKnownTimer = undefined;
        }

        document.querySelectorAll(".vc-savegroups-kicked").forEach(el => {
            el.classList.remove("vc-savegroups-kicked");
        });
        document.querySelectorAll(".vc-savegroups-badge").forEach(el => {
            el.remove();
        });

        removeArchivedNoticeBanner();

        const styleEl = document.getElementById("vc-savegroups-dynamic-styles");
        if (styleEl) styleEl.remove();

        const sortStore = PrivateChannelSortStore || (findStore("PrivateChannelSortStore") || findByProps("getPrivateChannelIds")) as any;
        try { (ChannelStore as any)?.emitChange?.(); } catch {}
        try { sortStore?.emitChange?.(); } catch {}
    }
});
