/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Modal, openModal, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("vc-typing-history-");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable typing indicator history",
        default: true,
        restartNeeded: false
    },
    maxEntries: {
        type: OptionType.NUMBER,
        description: "Maximum number of typing events to store",
        default: 100,
        restartNeeded: false
    }
});

interface TypingEvent {
    channelId: string;
    userId: string;
    username: string;
    timestamp: number;
}

const HISTORY_KEY = "vc_typing_history";

function getHistory(): TypingEvent[] {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
        return [];
    }
}

function saveHistory(events: TypingEvent[]) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(events));
}

function TypingHistoryIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.59l3.7 3.7-1.41 1.42L11 13.41V6h2v6.59z" />
        </svg>
    );
}

function recordTypingEvent(channelId: string, userId: string, username: string) {
    const history = getHistory();
    const event: TypingEvent = {
        channelId,
        userId,
        username,
        timestamp: Date.now()
    };
    history.push(event);
    if (history.length > settings.store.maxEntries) {
        history.shift();
    }
    saveHistory(history);
}

function TypingHistoryModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [history, setHistory] = useState(getHistory);

    const channelHistory = history.reduce((acc, event) => {
        if (!acc[event.channelId]) {
            acc[event.channelId] = [];
        }
        acc[event.channelId].push(event);
        return acc;
    }, {} as Record<string, TypingEvent[]>);

    return (
        <Modal {...modalProps} title="Typing History" size="large">
            <Flex flexDirection="column" gap="1em">
                <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                    {Object.keys(channelHistory).length === 0 ? (
                        <BaseText>No typing events recorded yet.</BaseText>
                    ) : (
                        Object.entries(channelHistory).map(([channelId, events]) => (
                            <div key={channelId} className={cl("channel-group")}>
                                <Heading tag="h3" style={{ margin: "0 0 0.5em 0" }}>
                                    {ChannelStore.getChannel(channelId)?.name ?? channelId}
                                </Heading>
                                {events.slice().reverse().map((event, i) => (
                                    <div key={i} className={cl("event")}>
                                        <BaseText weight="semibold">{event.username}</BaseText>
                                        <BaseText size="sm" color="text-muted">
                                            {new Date(event.timestamp).toLocaleString()}
                                        </BaseText>
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
                <Flex justifyContent="end" gap="0.5em">
                    <Button variant="secondary" onClick={() => {
                        localStorage.removeItem(HISTORY_KEY);
                        setHistory([]);
                    }}>Clear All</Button>
                    <Button onClick={modalProps.onClose}>Close</Button>
                </Flex>
            </Flex>
        </Modal>
    );
}

const TypingHistoryButton: ChatBarButtonFactory = () => (
    <ChatBarButton tooltip="Typing History" onClick={() => openModal(props => <TypingHistoryModal modalProps={props} />)}>
        <TypingHistoryIcon />
    </ChatBarButton>
);

export default definePlugin({
    name: "TypingIndicatorHistory",
    description: "Tracks who typed and when in your channels",
    tags: ["Chat", "Utility"],
    authors: [Devs.tired55],
    settings,
    chatbarButton: {
        icon: TypingHistoryIcon,
        render: TypingHistoryButton
    },

    flux: {
        TYPING_START({ channelId, userId }) {
            if (!settings.store.enabled) return;
            const user = UserStore.getUser(userId);
            if (user) {
                recordTypingEvent(channelId, userId, user.username);
            }
        }
    }
});
