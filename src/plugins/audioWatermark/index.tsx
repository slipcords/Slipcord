/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { SelectedChannelStore, SelectedGuildStore, UserStore, VoiceStateStore, useMemo } from "@webpack/common";

const logger = new Logger("AudioWatermark");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Generate and log a rotating voice watermark token while in voice chat",
        default: true
    },
    tokenRotationMinutes: {
        type: OptionType.SLIDER,
        description: "How often the watermark token rotates",
        default: 5,
        markers: [1, 2, 5, 10, 15, 30],
        stickToMarkers: true
    },
    playReferenceTone: {
        type: OptionType.BOOLEAN,
        description: "Play a subtle local reference tone to verify watermark audibility (client-side only)",
        default: false
    },
    toneFrequency: {
        type: OptionType.SLIDER,
        description: "Reference tone frequency in Hz",
        default: 18000,
        markers: [1000, 5000, 12000, 18000, 20000],
        stickToMarkers: true
    },
    toneVolume: {
        type: OptionType.SLIDER,
        description: "Reference tone volume (percent)",
        default: 5,
        markers: [0, 2, 5, 10, 25],
        stickToMarkers: true
    }
});

interface TokenRecord { token: string; channelId: string; issued: number; }

const STORAGE_KEY = "audioWatermarkLog";
let log: TokenRecord[] = [];
let tokenTimer: ReturnType<typeof setInterval> | null = null;
let currentToken: string | null = null;
let audioCtx: AudioContext | null = null;

function currentTokenValue(): string {
    const me = UserStore.getCurrentUser()?.id ?? "anon";
    const guild = SelectedGuildStore.getLastSelectedGuildId() ?? "noguild";
    const channel = SelectedChannelStore.getLastSelectedChannelId() ?? "noch";
    const bucket = Math.floor(Date.now() / (settings.store.tokenRotationMinutes * 60_000));
    return `${guild.slice(-4)}-${channel.slice(-4)}-${me.slice(-4)}-${bucket.toString(36)}`.toUpperCase();
}

function refreshToken() {
    if (!settings.store.enabled) return;
    const inVoice = !!voiceChannelOfCurrentUser();
    if (!inVoice) { currentToken = null; return; }
    const token = currentTokenValue();
    currentToken = token;
    const entry: TokenRecord = { token, channelId: voiceChannelOfCurrentUser()!, issued: Date.now() };
    log.unshift(entry);
    if (log.length > 100) log.pop();
    void DataStore.set(STORAGE_KEY, log);
    logger.log(`Voice watermark token issued: ${token}`);
}

function voiceChannelOfCurrentUser(): string | null {
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return null;
    const guild = SelectedGuildStore.getLastSelectedGuildId();
    if (!guild) return null;
    const state = VoiceStateStore.getVoiceState(guild, me);
    return state?.channelId ?? null;
}

function playTone() {
    if (audioCtx) { try { audioCtx.close(); } catch { } audioCtx = null; }
    audioCtx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = settings.store.toneFrequency;
    gain.gain.value = settings.store.toneVolume / 100;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    setTimeout(() => { try { osc.stop(); } catch { } }, 300);
}

function Dashboard() {
    useMemo(() => void 0, [log.length]);
    const inVoice = voiceChannelOfCurrentUser();
    const me = UserStore.getCurrentUser();
    const token = useMemo(() => (inVoice && settings.store.enabled ? currentTokenValue() : null), [inVoice, log.length]);

    return (
        <section>
            <Paragraph>
                Generates a rotating voice watermark token while you're in a voice channel and keeps a local log of issued tokens. A reference tone test is available to verify audibility.
            </Paragraph>
            <Paragraph style={{ marginTop: 10 }}>
                <strong>Status:</strong> {inVoice ? `In voice (#${inVoice.slice(0, 6)})` : "Not in voice"}
            </Paragraph>
            <Paragraph style={{ marginTop: 8 }}>
                <strong>Active token:</strong> {token ?? "-"}
            </Paragraph>
            <Button className={settings.store.enabled ? undefined : "disabled"} onClick={playTone}>Play reference tone</Button>
            <Paragraph style={{ marginTop: 10, fontSize: 11 }}>
                {me?.username ? `User: ${me.username}` : ""} Token rotates every {settings.store.tokenRotationMinutes} min.
            </Paragraph>
            <Paragraph style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
                Note: True outbound-audio watermarking requires native audio injection, which client mods cannot perform. This provides a verifiable token log and a local reference tone for workflows that pair a client token with an out-of-band tone.
            </Paragraph>
        </section>
    );
}

export default definePlugin({
    name: "AudioWatermark",
    description: "Issues a rotating voice-channel watermark token log and a reference tone for authenticity verification",
    tags: ["Voice", "Privacy"],
    authors: [Devs.tired55],
    settings,

    settingsAboutComponent() {
        return <Dashboard />;
    },

    start() {
        void DataStore.get<TokenRecord[]>(STORAGE_KEY).then(d => { log = d ?? []; });
        refreshToken();
        tokenTimer = setInterval(refreshToken, 30_000);
    },

    stop() {
        if (tokenTimer) clearInterval(tokenTimer);
        tokenTimer = null;
        currentToken = null;
        if (audioCtx) { try { audioCtx.close(); } catch { } audioCtx = null; }
    }
});
