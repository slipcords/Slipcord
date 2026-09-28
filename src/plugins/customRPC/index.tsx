/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Divider } from "@components/Divider";
import { ErrorCard } from "@components/ErrorCard";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { Button, FluxDispatcher, React, UserStore } from "@webpack/common";

import { buildOfficialAppActivity, buildProfileActivity } from "./activity";
import {
    anchorFor,
    clearAllDispatched,
    clearInactive,
    getOfficialApp,
    getOfficialApps,
    getProfile,
    getProfiles,
    loadPresences,
    markDispatched,
    Presence,
    presenceLogger,
    provideLegacySettings,
    registerLoop,
    resetAnchor,
    resolveClaims,
    setOfficialApps,
    setProfiles,
    stopLoops,
} from "./presence";
import * as abs from "./services/audiobookshelf";
import * as gensokyoRadio from "./services/gensokyoRadio";
import * as jellyfin from "./services/jellyfin";
import * as navidrome from "./services/navidrome";
import { serviceSettings, setOnServiceChange } from "./services/settings";
import * as statsfm from "./services/statsfm";
import * as tosu from "./services/tosu";
import { ServiceSettings } from "./ServiceSettings";
import { ACTIVITY_TYPE_LABELS, RpcProfile, ServiceTab, TimestampMode } from "./types";
import { OfficialAppEntry } from "./types/officialApp";

const useProfileThemeStyle = findByCodeLazy("profileThemeStyle:", "--profile-gradient-primary-color");
const ActivityView = findComponentByCodeLazy(".party?(0", "USER_PROFILE_ACTIVITY");

const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

export const settings = definePluginSettings({
    config: {
        type: OptionType.COMPONENT,
        component: ServiceSettings
    },
    ...serviceSettings,
}).withPrivateSettings<Record<string, any>>();

export type SettingsStore = typeof settings["store"];

const services: Record<string, { start(): void; stop(): void; forceUpdate?(): void; }> = {
    [ServiceTab.AudioBookShelf]: abs,
    [ServiceTab.Tosu]: tosu,
    [ServiceTab.StatsFm]: statsfm,
    [ServiceTab.Jellyfin]: jellyfin,
    [ServiceTab.GensokyoRadio]: gensokyoRadio,
    [ServiceTab.Navidrome]: navidrome,
};

const enableKeys: Record<string, keyof SettingsStore> = {
    [ServiceTab.AudioBookShelf]: "abs_enabled",
    [ServiceTab.Tosu]: "tosu_enabled",
    [ServiceTab.StatsFm]: "sfm_enabled",
    [ServiceTab.Jellyfin]: "jf_enabled",
    [ServiceTab.GensokyoRadio]: "gr_enabled",
    [ServiceTab.Navidrome]: "nd_enabled",
};

const activeServices = new Set<string>();

function syncServices() {
    for (const [id, service] of Object.entries(services)) {
        const shouldRun = !!settings.store[enableKeys[id]];
        const isRunning = activeServices.has(id);

        if (shouldRun && !isRunning) {
            service.start();
            activeServices.add(id);
        } else if (!shouldRun && isRunning) {
            service.stop();
            activeServices.delete(id);
        } else if (shouldRun && isRunning && service.forceUpdate) {
            service.forceUpdate();
        }
    }
}

function stopAllServices() {
    for (const id of activeServices) {
        services[id].stop();
    }
    activeServices.clear();
}

function dispatch(socketId: string, activity: Activity | null) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId });
}

/**
 * Rebuilds and dispatches every active presence. Each one owns its own socketId, so
 * several can be registered at the same time, and anything no longer active gets
 * cleared so a deleted presence doesn't linger.
 */
export async function setRpc(disable?: boolean) {
    const { active, blocked } = resolveClaims();

    if (disable) {
        for (const presence of active) dispatch(presence.socketId, null);
        clearAllDispatched();
        return;
    }

    await Promise.all(active.map(async presence => {
        if (presence.kind === "profile") {
            const profile = getProfile(presence.id);
            if (!profile) return;

            const activity = await buildProfileActivity(presence, profile.config) ?? null;
            dispatch(presence.socketId, activity);
            markDispatched(presence.socketId);
            return;
        }

        const entry = getOfficialApp(presence.id);
        if (!entry) return;

        const activity = await buildOfficialAppActivity(presence, entry);
        dispatch(presence.socketId, activity);
        markDispatched(presence.socketId);
    }));

    for (const presence of blocked.values()) {
        // Discord only renders one activity per type, so this one would never be seen.
        // Clear it so a presence that used to be shown disappears when it gets blocked.
        dispatch(presence.socketId, null);
        presenceLogger.warn(`${presence.name} is hidden: another presence already uses the ${ACTIVITY_TYPE_LABELS[presence.type]} slot`);
    }

    clearInactive(new Set(active.map(presence => presence.socketId)));
}

/**
 * Keeps looping timestamps moving. Each looping presence gets its own interval, so
 * one presence finishing its loop doesn't disturb the others.
 */
function startLoops() {
    stopLoops();

    for (const presence of resolveClaims().active) {
        if (presence.kind !== "profile") continue;

        const profile = getProfile(presence.id);
        if (!profile) continue;

        const { timestampMode, timestampLoop, startTime, endTime } = profile.config;
        if (timestampMode !== TimestampMode.CUSTOM || !timestampLoop || !startTime || !endTime) continue;

        const duration = endTime - startTime;
        if (duration <= 0) continue;

        // anchor before the first rebuild so the progress bar starts where we expect
        anchorFor(presence, TimestampMode.CUSTOM);
        registerLoop(presence, TimestampMode.CUSTOM, duration, () => setRpc());
    }
}

/** Applies an edit to one presence and pushes it out, restarting loops if needed. */
export async function updateProfile(id: string, mutate: (profile: RpcProfile) => RpcProfile) {
    const profiles = getProfiles();
    const index = profiles.findIndex(profile => profile.id === id);
    if (index === -1) return;

    const updated = [...profiles];
    updated[index] = mutate(profiles[index]);
    await setProfiles(updated);

    startLoops();
    await setRpc();
}

export async function updateOfficialApp(id: string, mutate: (entry: OfficialAppEntry) => OfficialAppEntry) {
    const entries = getOfficialApps();
    const index = entries.findIndex(entry => entry.id === id);
    if (index === -1) return;

    const updated = [...entries];
    updated[index] = mutate(entries[index]);
    await setOfficialApps(updated);

    await setRpc();
}

export async function addProfile(profile: RpcProfile) {
    await setProfiles([...getProfiles(), profile]);
    startLoops();
    await setRpc();
}

export async function removeProfile(id: string) {
    await setProfiles(getProfiles().filter(profile => profile.id !== id));
    startLoops();
    await setRpc();
}

export async function addOfficialApp(entry: OfficialAppEntry) {
    await setOfficialApps([...getOfficialApps(), entry]);
    await setRpc();
}

export async function removeOfficialApp(id: string) {
    await setOfficialApps(getOfficialApps().filter(entry => entry.id !== id));
    await setRpc();
}

/** Re-anchors a presence, so "Since Discord open" counts from this moment. */
export function restartTimer(presence: Presence) {
    const profile = getProfile(presence.id);
    resetAnchor(presence, profile?.config.timestampMode ?? TimestampMode.NOW);
    setRpc();
}

export { getBlockedPresences, getOfficialApps, getProfiles, newId, OFFICIAL_APP_SOCKET_PREFIX, PROFILE_SOCKET_PREFIX, setOfficialApps, setProfiles } from "./presence";
export type { RpcConfig, RpcProfile } from "./types";
export { TimestampMode } from "./types";

export default definePlugin({
    name: "CustomRPC",
    description: "Add fully customisable Rich Presences (Game statuses) to your Discord profile. Run as many as you like at once, as long as each one uses a different activity type, or let a service like AudioBookShelf, osu!, stats.fm, Jellyfin, Navidrome or Gensokyo Radio drive one for you",
    tags: ["Activity", "Customisation"],
    authors: [Devs.captain, Devs.AutumnVN, Devs.nin0dev],
    dependencies: ["UserSettingsAPI"],
    // This plugin's patch is not important for functionality, so don't require a restart
    requiresRestart: false,
    settings,

    async start() {
        provideLegacySettings(settings);
        await loadPresences();

        startLoops();
        await setRpc();
        syncServices();
        setOnServiceChange(syncServices);
    },
    stop() {
        clearAllDispatched();
        stopLoops();
        stopAllServices();
        setOnServiceChange(null);
    },

    // Discord hides buttons on your own Rich Presence for some reason. This patch disables that behaviour
    patches: [
        {
            find: ".USER_PROFILE_ACTIVITY_BUTTONS),",
            replacement: {
                match: /.getId\(\)===\i.id/,
                replace: "$& && false"
            },
        }
    ],

    settingsAboutComponent: () => {
        const [activity] = useAwaiter(async () => {
            for (const presence of resolveClaims().active) {
                if (presence.kind !== "profile") continue;
                const profile = getProfile(presence.id);
                if (!profile) continue;
                const built = await buildProfileActivity(presence, profile.config);
                if (built) return built;
            }
            return undefined;
        }, { fallbackValue: undefined, deps: [JSON.stringify(getProfiles())] });
        const gameActivityEnabled = ShowCurrentGame.useSetting();
        const { profileThemeStyle } = useProfileThemeStyle({});

        return (
            <>
                {!gameActivityEnabled && (
                    <ErrorCard
                        className={classes(Margins.top16, Margins.bottom16)}
                        style={{ padding: "1em" }}
                    >
                        <Heading>Notice</Heading>
                        <Paragraph>Activity Sharing isn't enabled, people won't be able to see your custom rich presence!</Paragraph>

                        <Button
                            color={Button.Colors.TRANSPARENT}
                            className={Margins.top8}
                            onClick={() => ShowCurrentGame.updateSetting(true)}
                        >
                            Enable
                        </Button>
                    </ErrorCard>
                )}

                <Flex flexDirection="column" gap=".5em" className={Margins.top16}>
                    <Paragraph>
                        Go to the <Link href="https://discord.com/developers/applications">Discord Developer Portal</Link> to create an application and
                        get the application ID.
                    </Paragraph>
                    <Paragraph>
                        Upload images in the Rich Presence tab to get the image keys, or paste a direct
                        image link instead - a Discord attachment link, Imgur or Tenor all work.
                    </Paragraph>
                    <Paragraph>
                        Add as many presences as you want and run them all at the same time. Discord
                        only shows one of each activity type, so two presences set to Playing would
                        fight over the same slot and the second one stays hidden.
                    </Paragraph>
                    <Paragraph>
                        Prefer the service tabs for things you actually play on: AudioBookShelf, osu!, stats.fm, Jellyfin, Navidrome and Gensokyo Radio all drive this same presence.
                    </Paragraph>
                    <Paragraph>
                        You can't see your own buttons on your profile, but everyone else can see it fine.
                    </Paragraph>
                    <Paragraph>
                        Some weird unicode text ("fonts" 𝖑𝖎𝖐𝖊 𝖙𝖍𝖎𝖘) may cause the rich presence to not show up, try using normal letters instead.
                    </Paragraph>
                </Flex>

                <Divider className={Margins.top8} />

                <div style={{ width: "284px", ...profileThemeStyle, marginTop: 8, borderRadius: 8, background: "var(--background-mod-muted)" }}>
                    {activity && <ActivityView
                        activity={activity}
                        user={UserStore.getCurrentUser()}
                        currentUser={UserStore.getCurrentUser()}
                    />}
                </div>
            </>
        );
    }
});
