/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { IconComponent } from "@utils/types";
import definePlugin, { OptionType } from "@utils/types";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ClockIcon } from "@components/Icons";
import { FluxDispatcher, MessageActions, UserStore } from "@webpack/common";

const logger = new Logger("MessageRecall");

const settings = definePluginSettings({
    delaySeconds: {
        type: OptionType.NUMBER,
        description: "How long before a recallable message deletes itself",
        default: 10,
        markers: [3, 5, 10, 15, 30, 60],
        componentProps: { step: 1 }
    },
    autoRecall: {
        type: OptionType.BOOLEAN,
        description: "Automatically recall every message you send (ignore the toggle)",
        default: false
    },
    confirmOnSend: {
        type: OptionType.BOOLEAN,
        description: "Ask before sending a recallable message",
        default: false
    },
    showTimer: {
        type: OptionType.BOOLEAN,
        description: "Show a toast counting down to deletion",
        default: true
    }
});

let recallNext = false;
let pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

const RecallIcon: IconComponent = ({ width = 18, height = 18 }) => <ClockIcon width={width} height={height} />;

const RecallButton: ChatBarButtonFactory = ({ channel }) => {
    const active = recallNext;
    return (
        <ChatBarButton
            tooltip={active ? "Recall mode: on (next message deletes itself)" : "Send a recallable message"}
            onClick={() => {
                recallNext = !recallNext;
                const label = recallNext ? "ON" : "OFF";
                logger.log(`Recall mode ${label}`);
            }}
            buttonProps={{ style: { opacity: active ? 1 : 0.5 } }}
        >
            <RecallIcon />
        </ChatBarButton>
    );
};

function scheduleDelete(messageId: string, channelId: string) {
    if (pendingDeletes.has(messageId)) return;
    const timer = setTimeout(async () => {
        try {
            (MessageActions as any).deleteMessage(channelId, messageId);
            pendingDeletes.delete(messageId);
            logger.log(`Recalled message ${messageId}`);
        } catch (e) {
            logger.error("Failed to recall message:", e);
        }
    }, settings.store.delaySeconds * 1000);
    pendingDeletes.set(messageId, timer);

    if (settings.store.showTimer) {
        let remaining = settings.store.delaySeconds;
        const countdown = setInterval(() => {
            remaining--;
            if (remaining <= 0) { clearInterval(countdown); }
        }, 1000);
    }
}

export default definePlugin({
    name: "MessageRecall",
    description: "Send messages that automatically delete themselves after a short countdown",
    tags: ["Chat", "Fun"],
    authors: [Devs.tired55],
    settings,
    dependencies: ["ChatInputButtonAPI"],

    chatBarButton: {
        icon: RecallIcon,
        render: RecallButton
    },

    flux: {
        MESSAGE_CREATE({ message }: any) {
            const me = UserStore.getCurrentUser()?.id;
            if (!message || message.author?.id !== me) return;
            if (settings.store.autoRecall || recallNext) {
                recallNext = false;
                scheduleDelete(message.id, message.channel_id);
            }
        }
    },

    start() {
        recallNext = false;
    },

    stop() {
        for (const timer of pendingDeletes.values()) clearTimeout(timer);
        pendingDeletes.clear();
        recallNext = false;
    }
});
