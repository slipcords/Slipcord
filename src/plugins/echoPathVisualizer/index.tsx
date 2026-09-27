/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildMemberStore, Modal, openModal, SelectedChannelStore, SelectedGuildStore, Toasts, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

const logger = new Logger("EchoPathVisualizer");

const settings = definePluginSettings({
    showMicrophoneState: {
        type: OptionType.BOOLEAN,
        description: "Show whether each member's microphone is muted",
        default: true
    },
    hideFullyDeafened: {
        type: OptionType.BOOLEAN,
        description: "Hide members who cannot hear or be heard (deafened/muted)",
        default: false
    }
});

interface Row {
    userId: string;
    displayName: string;
    youHear: boolean;
    theyHear: boolean;
    selfMute: boolean;
    selfDeaf: boolean;
    muted: boolean;
    deaf: boolean;
    suppressed: boolean;
}

function buildRows(): Row[] | null {
    const me = UserStore.getCurrentUser()?.id ?? null;
    if (!me) return null;
    const guildId = SelectedGuildStore.getLastSelectedGuildId();
    if (!guildId) return null;
    const myState = VoiceStateStore.getVoiceState(guildId, me);
    if (!myState?.channelId) return null;
    const { channelId } = myState;
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId);

    const rows: Row[] = [];
    for (const [userId, state] of Object.entries(states)) {
        const member: any = GuildMemberStore.getMember(guildId, userId);
        const displayName = member?.nick ?? member?.user?.globalName ?? member?.user?.username ?? userId.slice(0, 6);
        const youHear = !myState.selfDeaf && !myState.deaf && !state.mute && !state.deaf;
        const theyHear = !myState.selfMute && !myState.suppress && !state.deaf;
        rows.push({
            userId,
            displayName,
            youHear,
            theyHear,
            selfMute: state.selfMute,
            selfDeaf: state.selfDeaf,
            muted: state.mute,
            deaf: state.deaf,
            suppressed: state.suppress
        });
    }
    return rows;
}

function EchoMapModal({ modalProps }: { modalProps: any; }) {
    const [rows, setRows] = useState<Row[] | null>(null);

    const refresh = () => {
        const built = buildRows();
        if (settings.store.hideFullyDeafened && built) {
            setRows(built.filter(r => r.youHear || r.theyHear));
        } else {
            setRows(built);
        }
    };
    useStateFromStores([VoiceStateStore], () => { refresh(); });
    if (!rows) refresh();

    const me = UserStore.getCurrentUser()?.id ?? "";
    const channel = SelectedChannelStore.getLastSelectedChannelId();
    const channelName = channel ? (ChannelStore.getChannel(channel)?.name ?? channel) : "voice";

    return (
        <Modal
            {...modalProps}
            title={`Echo path - ${channelName}`}
            actions={[{ text: "Refresh", variant: "primary", onClick: refresh, disabled: !rows?.length }]}
        >
            {!rows
                ? <Paragraph>You must be in a voice channel to view the echo map.</Paragraph>
                : rows.length === 0
                    ? <Paragraph>No members in your voice channel.</Paragraph>
                    : (
                        <table className="vc-echo-table">
                            <thead>
                                <tr>
                                    <th>Member</th>
                                    <th>You hear them</th>
                                    <th>They hear you</th>
                                    {settings.store.showMicrophoneState && <>
                                        <th>Mic mute</th><th>Deafened</th><th>Suppressed</th>
                                    </>}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.userId}>
                                        <td>{r.userId === me ? "You" : r.displayName}</td>
                                        <td>{r.youHear ? "yes" : "no"}</td>
                                        <td>{r.theyHear ? "yes" : "no"}</td>
                                        {settings.store.showMicrophoneState && <>
                                            <td>{r.selfMute || r.muted ? "muted" : "open"}</td>
                                            <td>{r.selfDeaf || r.deaf ? "deafened" : "open"}</td>
                                            <td>{r.suppressed ? "suppressed" : "-"}</td>
                                        </>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
        </Modal>
    );
}

function Dashboard() {
    return (
        <section>
            <Paragraph>
                Visualizes who can hear whom in your current voice channel - useful for debugging audio routing, muted/deafened states, and push-to-talk suppression.
            </Paragraph>
            <Button style={{ marginTop: 10 }} onClick={() => {
                const rows = buildRows();
                if (!rows) { Toasts.show({ message: "Join a voice channel, then open the echo map", type: "MESSAGE" as any }); return; }
                openModal((props: any) => <EchoMapModal modalProps={props} />);
            }}>
                Show Echo Map
            </Button>
        </section>
    );
}

export default definePlugin({
    name: "EchoPathVisualizer",
    description: "Shows who can hear whom in your voice channel at a glance",
    tags: ["Voice", "Utility"],
    authors: [Devs.tired55],
    settings,

    settingsAboutComponent() {
        return <Dashboard />;
    }
});
