/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, RenderModalProps } from "@vencord/discord-types";
import { Menu, Modal, openModal, TextArea, useState } from "@webpack/common";

const cl = classNameFactory("vc-message-scheduler-");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable message scheduling",
        default: true,
        restartNeeded: false
    }
});

interface ScheduledMessage {
    id: string;
    channelId: string;
    content: string;
    scheduledFor: number;
    createdAt: number;
}

const SCHEDULE_KEY = "vc_scheduled_messages";

function getScheduledMessages(): ScheduledMessage[] {
    try {
        return JSON.parse(localStorage.getItem(SCHEDULE_KEY) || "[]");
    } catch {
        return [];
    }
}

function saveScheduledMessages(messages: ScheduledMessage[]) {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(messages));
}

let schedulerTimer: NodeJS.Timeout | null = null;

function checkScheduledMessages() {
    const messages = getScheduledMessages();
    const now = Date.now();

    for (const msg of messages) {
        if (msg.scheduledFor <= now) {
            sendMessage(msg.channelId, { content: msg.content });
            const remaining = messages.filter(m => m.id !== msg.id);
            saveScheduledMessages(remaining);
        }
    }
}

function scheduleNext() {
    if (schedulerTimer) clearTimeout(schedulerTimer);
    const messages = getScheduledMessages();
    if (messages.length === 0) return;

    const next = Math.min(...messages.map(m => m.scheduledFor));
    const delay = Math.max(0, next - Date.now());
    schedulerTimer = setTimeout(checkScheduledMessages, delay);
}

function ScheduleIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2-1h4v8h-4V1zm4 11.5c-.3 0-.5-.1-.7-.3l-2.5-2.5c-.4-.4-.4-1 0-1.4s1-.4 1.4 0l1.8 1.8 3.2-3.2c.4-.4 1-.4 1.4 0s.4 1 0 1.4l-4 4c-.2.2-.4.3-.7.3z" />
        </svg>
    );
}

function ScheduleMessageModal({ channelId, modalProps }: { channelId: string; modalProps: RenderModalProps; }) {
    const [content, setContent] = useState("");
    const [scheduledTime, setScheduledTime] = useState("");
    const [error, setError] = useState("");

    const handleSchedule = () => {
        if (!content.trim()) {
            setError("Message content is required");
            return;
        }
        if (!scheduledTime) {
            setError("Please select a time");
            return;
        }

        const scheduledDate = new Date(scheduledTime);
        if (isNaN(scheduledDate.getTime())) {
            setError("Invalid date/time");
            return;
        }

        const messages = getScheduledMessages();
        const newMsg: ScheduledMessage = {
            id: `sched_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            channelId,
            content: content.trim(),
            scheduledFor: scheduledDate.getTime(),
            createdAt: Date.now()
        };
        messages.push(newMsg);
        saveScheduledMessages(messages);
        scheduleNext();

        setError("");
        setContent("");
        setScheduledTime("");
    };

    return (
        <Modal {...modalProps} title="Schedule Message">
            <Flex flexDirection="column" gap="1em">
                <div>
                    <BaseText weight="semibold">Message Content</BaseText>
                    <TextArea
                        value={content}
                        onChange={setContent}
                        placeholder="Type your message..."
                        style={{ marginTop: "0.5em" }}
                    />
                </div>
                <div>
                    <BaseText weight="semibold">When to send</BaseText>
                    <input
                        type="datetime-local"
                        value={scheduledTime}
                        onChange={e => setScheduledTime(e.target.value)}
                        style={{ marginTop: "0.5em", width: "100%" }}
                    />
                </div>
                {error && <BaseText color="text-feedback-critical">{error}</BaseText>}
                <Flex justifyContent="end" gap="0.5em">
                    <Button variant="secondary" onClick={() => {
                        openModal(props => <ScheduledMessagesModal modalProps={props} />);
                    }}>View Scheduled</Button>
                    <Button onClick={handleSchedule}>Schedule</Button>
                </Flex>
            </Flex>
        </Modal>
    );
}

function ScheduledMessagesModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [messages, setMessages] = useState(getScheduledMessages());

    const deleteMessage = (id: string) => {
        const next = getScheduledMessages().filter(m => m.id !== id);
        saveScheduledMessages(next);
        setMessages(next);
    };

    return (
        <Modal {...modalProps} title="Scheduled Messages" size="md">
            <Flex flexDirection="column" gap="0.5em">
                {messages.length === 0
                    ? <BaseText color="text-muted">Nothing scheduled.</BaseText>
                    : messages.map(message => (
                        <Flex key={message.id} justifyContent="space-between" alignItems="center" gap="1em">
                            <div>
                                <BaseText>{message.content}</BaseText>
                                <BaseText size="sm" color="text-muted">
                                    {new Date(message.scheduledFor).toLocaleString()}
                                </BaseText>
                            </div>
                            <Button variant="dangerSecondary" size="small" onClick={() => deleteMessage(message.id)}>
                                Delete
                            </Button>
                        </Flex>
                    ))}
            </Flex>
        </Modal>
    );
}

const contextMenuPatch = (children: Array<any>, props: { channel: Channel; }) => {
    const { channel } = props;
    if (!channel) return;

    children.push(
        <Menu.MenuItem
            id="schedule-message"
            label="Schedule Message"
            icon={ScheduleIcon}
            action={() => openModal(props => <ScheduleMessageModal channelId={channel.id} modalProps={props} />)}
        />
    );
};

export default definePlugin({
    name: "MessageScheduler",
    description: "Schedule messages to be sent at a future date and time",
    tags: ["Chat", "Utility"],
    authors: [Devs.tired55],
    settings,
    contextMenus: {
        "channel-context": contextMenuPatch
    },
    start() {
        scheduleNext();
    },
    stop() {
        if (schedulerTimer) {
            clearTimeout(schedulerTimer);
            schedulerTimer = null;
        }
    }
});
