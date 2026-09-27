/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, SelectedChannelStore } from "@webpack/common";

import pluginStyle from "./style.css?managed";

const logger = new Logger("ReactionChainAnimator");

const settings = definePluginSettings({
    chainLength: {
        type: OptionType.NUMBER,
        description: "Maximum emoji in a single reaction chain animation",
        default: 6,
        markers: [1, 3, 6, 10, 15],
        componentProps: { step: 1 }
    },
    animationDuration: {
        type: OptionType.SLIDER,
        description: "How long a reaction chain stays visible (ms)",
        default: 1400,
        markers: [600, 1000, 1400, 2000, 3000],
        stickToMarkers: true
    },
    onlyInCurrentChannel: {
        type: OptionType.BOOLEAN,
        description: "Only animate reactions in the channel you are viewing",
        default: true
    }
});

let overlay: HTMLDivElement | null = null;

function getOverlay() {
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "vc-rca-overlay";
        document.body.appendChild(overlay);
    }
    return overlay;
}

function findMessageNode(msgId: string): HTMLElement | null {
    const candidates = [
        `[data-message-id="${msgId}"]`,
        `li[data-list-item-id*="${msgId}"]`,
        `[data-slate-editor][data-key*="${msgId}"]`,
        `[id*="chat-messages-${msgId}"]`
    ];
    for (const sel of candidates) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) return el;
    }
    return null;
}

function spawnChain(messageId: string, emoji: string, count: number, x: number, y: number) {
    const root = getOverlay();
    const burst = document.createElement("div");
    burst.className = "vc-rca-burst";
    burst.style.left = `${x}px`;
    burst.style.top = `${y}px`;
    const n = Math.min(count, settings.store.chainLength);
    for (let i = 0; i < n; i++) {
        const span = document.createElement("span");
        span.className = "vc-rca-pop";
        span.style.animationDelay = `${(i * 80)}ms`;
        span.textContent = emoji || "✨";
        burst.appendChild(span);
    }
    root.appendChild(burst);
    setTimeout(() => { try { burst.remove(); } catch { } }, settings.store.animationDuration + 400);
}

function handleReactionAdd(data: any) {
    const channelId = data?.channel_id;
    const msgId = data?.message_id;
    if (!channelId || !msgId) return;
    if (settings.store.onlyInCurrentChannel && channelId !== SelectedChannelStore.getLastSelectedChannelId()) return;

    const emoji = data?.emoji?.name ?? data?.emoji ?? "✨";
    const count = data?.count ?? 1;
    const node = findMessageNode(msgId);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    spawnChain(msgId, emoji, count, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

export default definePlugin({
    name: "ReactionChainAnimator",
    description: "Animates incoming reactions as growing emoji chains anchored to each message",
    tags: ["Reactions", "Fun"],
    authors: [Devs.tired55],
    settings,

    start() {
        enableStyle(pluginStyle);
        FluxDispatcher.subscribe("MESSAGE_REACTION_ADD" as any, handleReactionAdd);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_REACTION_ADD" as any, handleReactionAdd);
        if (overlay) { overlay.remove(); overlay = null; }
        disableStyle(pluginStyle);
    }
});
