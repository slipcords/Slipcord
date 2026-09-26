/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { React, useState } from "@webpack/common";

const cl = classNameFactory("vc-auto-delete-");

const settings = definePluginSettings({
    deleteAfter: {
        type: OptionType.SELECT,
        description: "How long to wait before deleting the message",
        options: [
            { label: "5s", value: 5000 },
            { label: "10s", value: 10000 },
            { label: "30s", value: 30000 },
            { label: "1 min", value: 60000 },
            { label: "5 min", value: 5 * 60000 },
            { label: "10 min", value: 10 * 60000 }
        ],
        default: 10000,
        restartNeeded: false
    }
});

const pendingTimers = new Map<string, NodeJS.Timeout>();

function AutoDeleteIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
    );
}

const AutoDeleteButton: ChatBarButtonFactory = () => {
    const [isActive, setIsActive] = useState(false);

    return (
        <ChatBarButton
            tooltip={isActive ? "Auto-delete active" : "Auto-delete next message"}
            onClick={() => setIsActive(!isActive)}
        >
            <AutoDeleteIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AutoDeleteMessages",
    description: "Set a timer to auto-delete your next message after sending",
    tags: ["Chat", "Utility"],
    authors: [Devs.tired55],
    settings,
    chatbarButton: {
        icon: AutoDeleteIcon,
        render: AutoDeleteButton
    }
});
