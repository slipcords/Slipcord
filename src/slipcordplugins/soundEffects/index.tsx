/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AudioPlayerInterface, createAudioPlayer, playAudio } from "@api/AudioPlayer";
import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { SlipcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { ignoredKeys, packs } from "../keyboardSounds/packs";

const ARROW_KEYS = ["ArrowUp", "ArrowRight", "ArrowLeft", "ArrowDown"];

type SoundCategory = "backspaces" | "caps" | "enters" | "arrows" | "others";

const allSounds = {
    backspaces: [] as { playing: boolean; player: AudioPlayerInterface; }[],
    caps: [] as { playing: boolean; player: AudioPlayerInterface; }[],
    enters: [] as { playing: boolean; player: AudioPlayerInterface; }[],
    arrows: [] as { playing: boolean; player: AudioPlayerInterface; }[],
    others: [] as { playing: boolean; player: AudioPlayerInterface; }[],
};

let chosenPack: typeof packs[keyof typeof packs];
const keysPressed = new Set<string>();
let lastClickAt = 0;

function playRandom(soundsArray: { playing: boolean; player: AudioPlayerInterface; }[]) {
    if (!soundsArray.length) return;
    const available = soundsArray.filter(sound => !sound.playing);
    const chosen = available[Math.floor(Math.random() * available.length)] ?? soundsArray[Math.floor(Math.random() * soundsArray.length)];
    if (!chosen) return;
    chosen.playing = true;
    chosen.player.restart();
}

function clearSounds() {
    (Object.keys(allSounds) as SoundCategory[]).forEach(category => {
        allSounds[category].forEach(sound => sound.player.delete());
        allSounds[category] = [];
    });
}

function assignSounds(volume: number, pack: "operagx" | "osu") {
    clearSounds();
    chosenPack = packs[pack];
    if (!chosenPack) return;

    (Object.keys(allSounds) as SoundCategory[]).forEach(category => {
        const urls = chosenPack[category];
        if (!urls) return;

        for (let i = 0; i < 3; i++) {
            for (const url of urls) {
                const index = allSounds[category].length;
                allSounds[category].push({
                    playing: false,
                    player: createAudioPlayer(url, {
                        volume,
                        preload: true,
                        persistent: true,
                        onEnded: () => { allSounds[category][index].playing = false; }
                    })
                });
            }
        }
    });
}

const keyup = (e: KeyboardEvent) => keysPressed.delete(e.code);

const keydown = (e: KeyboardEvent) => {
    if (!settings.store.typingSounds || !chosenPack) return;
    if (ignoredKeys.includes(e.code) && !chosenPack.allowedIgnored?.includes(e.key)) return;
    if (keysPressed.has(e.code)) return;
    keysPressed.add(e.code);

    if (e.code === "Backspace") playRandom(allSounds.backspaces);
    else if (e.code === "CapsLock") playRandom(allSounds.caps);
    else if (e.code === "Enter") playRandom(allSounds.enters);
    else if (ARROW_KEYS.includes(e.code)) playRandom(allSounds.arrows);
    else playRandom(allSounds.others);
};

const click = (e: MouseEvent) => {
    if (!settings.store.clickSounds) return;
    if (e.detail === 0) return;
    if (!(e.target as Element | null)?.closest?.("button, a, [role='button']")) return;

    const now = Date.now();
    if (now - lastClickAt < 60) return;
    lastClickAt = now;

    playRandom(allSounds.others);
};

const onSend = () => {
    if (!settings.store.sendSound) return;
    playRandom(allSounds.enters.length ? allSounds.enters : allSounds.others);
};

function previewSound(category: "others" | "enters") {
    const pack = packs[settings.store.soundPack];
    const urls = (pack[category]?.length ? pack[category]! : pack.others);
    const url = urls[(Math.random() * urls.length) | 0];
    playAudio(url, { volume: settings.store.volume });
}

const settings = definePluginSettings({
    soundPack: {
        description: "Sound pack to use.",
        type: OptionType.SELECT,
        options: [
            { label: "OperaGX", value: "operagx" as "operagx", default: true },
            { label: "osu!", value: "osu" as "osu" }
        ],
        onChange: value => { assignSounds(settings.store.volume, value); }
    },
    volume: {
        description: "Volume of the sound effects.",
        type: OptionType.SLIDER,
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false,
        default: 100,
        onChange: value => { assignSounds(value, settings.store.soundPack); }
    },
    typingSounds: {
        description: "Play sounds when you type.",
        type: OptionType.BOOLEAN,
        default: true,
        restructure: false
    },
    clickSounds: {
        description: "Play sounds when you click buttons and links.",
        type: OptionType.BOOLEAN,
        default: true,
        restructure: false
    },
    sendSound: {
        description: "Play a sound when you send a message.",
        type: OptionType.BOOLEAN,
        default: true,
        restructure: false
    }
});

export default definePlugin({
    name: "SoundEffects",
    description: "Adds sound effects for typing, clicking and sending messages, with pre-selectable sound packs",
    tags: ["Fun"],
    authors: [SlipcordDevs.thororen],
    dependencies: ["AudioPlayerAPI"],
    settings,
    settingsAboutComponent: () => (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span>Preview the sounds of the selected pack:</span>
            <div style={{ display: "flex", gap: 8 }}>
                <Button size="small" onClick={() => previewSound("others")}>Typing</Button>
                <Button size="small" onClick={() => previewSound("others")}>Clicking</Button>
                <Button size="small" onClick={() => previewSound("enters")}>Sending</Button>
            </div>
        </div>
    ),
    start() {
        assignSounds(settings.store.volume, settings.store.soundPack);
        document.addEventListener("keyup", keyup);
        document.addEventListener("keydown", keydown);
        document.addEventListener("click", click);
        addMessagePreSendListener(onSend);
    },
    stop() {
        clearSounds();
        document.removeEventListener("keyup", keyup);
        document.removeEventListener("keydown", keydown);
        document.removeEventListener("click", click);
        removeMessagePreSendListener(onSend);
    }
});
