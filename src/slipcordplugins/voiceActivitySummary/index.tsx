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
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, UserStore, useState, VoiceStateStore } from "@webpack/common";

const cl = classNameFactory("vc-voice-activity-");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable voice activity tracking",
        default: true,
        restartNeeded: false
    },
    trackInterval: {
        type: OptionType.SELECT,
        description: "How often to record speaking activity",
        options: [
            { label: "Every 10 seconds", value: 10 * 1000 },
            { label: "Every 30 seconds", value: 30 * 1000 },
            { label: "Every minute", value: 60 * 1000 }
        ],
        default: 30 * 1000,
        restartNeeded: false
    }
});

interface VoiceSession {
    userId: string;
    username: string;
    joinedAt: number;
    leftAt: number | null;
    spokeAt: number[];
}

const SESSION_KEY = "vc_voice_sessions";

function getSessions(): VoiceSession[] {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || "[]");
    } catch {
        return [];
    }
}

function saveSessions(sessions: VoiceSession[]) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
}

let activeSession: VoiceSession | null = null;
let voiceCheckTimer: NodeJS.Timeout | null = null;

function checkVoiceActivity() {
    const voiceStates = VoiceStateStore.getVoiceStates();
    const userId = UserStore.getCurrentUser().id;

    if (activeSession) {
        for (const [uid] of Object.entries(voiceStates)) {
            if (uid === userId) continue;
            const user = UserStore.getUser(uid);
            if (!user) continue;

            if (activeSession.userId === uid) {
                activeSession.spokeAt.push(Date.now());
            }
        }
    }
}

function startVoiceSession() {
    const voiceStates = VoiceStateStore.getVoiceStates();
    const userId = UserStore.getCurrentUser().id;
    const members: VoiceSession[] = [];

    for (const [uid] of Object.entries(voiceStates)) {
        if (uid === userId) continue;
        const user = UserStore.getUser(uid);
        if (!user) continue;

        members.push({
            userId: uid,
            username: user.username,
            joinedAt: Date.now(),
            leftAt: null,
            spokeAt: []
        });
    }

    if (members.length > 0) {
        activeSession = members[0];
    }
}

function stopVoiceSession() {
    if (activeSession) {
        activeSession.leftAt = Date.now();
        const sessions = getSessions();
        sessions.push(activeSession);
        saveSessions(sessions);
        activeSession = null;
    }
}

function VoiceActivitySummaryModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [sessions, setSessions] = useState(getSessions);

    const totalSpeaking = sessions.reduce((sum, s) => sum + s.spokeAt.length, 0);
    const totalDuration = sessions.reduce((sum, s) => sum + (s.leftAt ? s.leftAt - s.joinedAt : 0), 0);

    return (
        <Modal {...modalProps} title="Voice Activity Summary" size="large">
            <Flex flexDirection="column" gap="1em">
                <Flex justifyContent="space-between">
                    <div>
                        <BaseText weight="semibold">Total Sessions</BaseText>
                        <BaseText>{sessions.length}</BaseText>
                    </div>
                    <div>
                        <BaseText weight="semibold">Total Speaking Events</BaseText>
                        <BaseText>{totalSpeaking}</BaseText>
                    </div>
                    <div>
                        <BaseText weight="semibold">Total Duration</BaseText>
                        <BaseText>{Math.round(totalDuration / 60000)} min</BaseText>
                    </div>
                </Flex>
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                    {sessions.length === 0 ? (
                        <BaseText>No voice sessions recorded yet.</BaseText>
                    ) : (
                        sessions.slice().reverse().map(session => (
                            <div key={session.joinedAt} className={cl("session")}>
                                <BaseText weight="semibold">{session.username}</BaseText>
                                <BaseText size="sm">
                                    Joined: {new Date(session.joinedAt).toLocaleString()}
                                    {session.leftAt && ` - Left: ${new Date(session.leftAt).toLocaleString()}`}
                                </BaseText>
                                <BaseText size="sm">Spoke {session.spokeAt.length} time(s)</BaseText>
                            </div>
                        ))
                    )}
                </div>
                <Flex justifyContent="end" gap="0.5em">
                    <Button variant="secondary" onClick={() => {
                        localStorage.removeItem(SESSION_KEY);
                        setSessions([]);
                    }}>Clear All</Button>
                    <Button onClick={modalProps.onClose}>Close</Button>
                </Flex>
            </Flex>
        </Modal>
    );
}

function VoiceActivityIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
        </svg>
    );
}

const VoiceActivityButton: ChatBarButtonFactory = () => (
    <ChatBarButton tooltip="Voice Activity Summary" onClick={() => openModal(props => <VoiceActivitySummaryModal modalProps={props} />)}>
        <VoiceActivityIcon />
    </ChatBarButton>
);

export default definePlugin({
    name: "VoiceActivitySummary",
    description: "Tracks and summarizes voice activity in channels",
    tags: ["Voice", "Utility"],
    authors: [Devs.tired55],
    settings,
    chatbarButton: {
        icon: VoiceActivityIcon,
        render: VoiceActivityButton
    },

    start() {
        voiceCheckTimer = setInterval(checkVoiceActivity, settings.store.trackInterval);
    },

    stop() {
        if (voiceCheckTimer) {
            clearInterval(voiceCheckTimer);
            voiceCheckTimer = null;
        }
    }
});
