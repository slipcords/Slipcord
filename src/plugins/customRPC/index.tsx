/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
import { isTruthy } from "@utils/guards";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { Button, FluxDispatcher, React, UserStore } from "@webpack/common";

import { resolveImage } from "./assets";
import * as abs from "./services/audiobookshelf";
import * as gensokyoRadio from "./services/gensokyoRadio";
import * as jellyfin from "./services/jellyfin";
import * as navidrome from "./services/navidrome";
import * as officialApp from "./services/officialApp";
import { serviceSettings, setOnServiceChange } from "./services/settings";
import * as statsfm from "./services/statsfm";
import * as tosu from "./services/tosu";
import { ServiceSettings } from "./ServiceSettings";
import { ServiceTab } from "./types";

const useProfileThemeStyle = findByCodeLazy("profileThemeStyle:", "--profile-gradient-primary-color");
const ActivityView = findComponentByCodeLazy(".party?(0", "USER_PROFILE_ACTIVITY");

const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

async function getApplicationAsset(key: string): Promise<string | undefined> {
    return resolveImage(settings.store.appID, key);
}

export const enum TimestampMode {
    NONE,
    NOW,
    TIME,
    CUSTOM,
}

export interface RpcConfig {
    appID?: string;
    appName?: string;
    details?: string;
    detailsURL?: string;
    state?: string;
    stateURL?: string;
    type?: ActivityType;
    streamLink?: string;
    timestampMode?: TimestampMode;
    startTime?: number;
    endTime?: number;
    imageBig?: string;
    imageBigURL?: string;
    imageBigTooltip?: string;
    imageSmall?: string;
    imageSmallURL?: string;
    imageSmallTooltip?: string;
    buttonOneText?: string;
    buttonOneURL?: string;
    buttonTwoText?: string;
    buttonTwoURL?: string;
    partySize?: number;
    partyMaxSize?: number;
}

export const settings = definePluginSettings({
    config: {
        type: OptionType.COMPONENT,
        component: ServiceSettings
    },
    ...serviceSettings,
}).withPrivateSettings<RpcConfig>();

const services: Record<string, { start(): void; stop(): void; forceUpdate?(): void; }> = {
    [ServiceTab.AudioBookShelf]: abs,
    [ServiceTab.Tosu]: tosu,
    [ServiceTab.StatsFm]: statsfm,
    [ServiceTab.Jellyfin]: jellyfin,
    [ServiceTab.GensokyoRadio]: gensokyoRadio,
    [ServiceTab.Navidrome]: navidrome,
    [ServiceTab.OfficialApp]: officialApp,
};

const enableKeys: Record<string, keyof SettingsStore> = {
    [ServiceTab.AudioBookShelf]: "abs_enabled",
    [ServiceTab.Tosu]: "tosu_enabled",
    [ServiceTab.StatsFm]: "sfm_enabled",
    [ServiceTab.Jellyfin]: "jf_enabled",
    [ServiceTab.GensokyoRadio]: "gr_enabled",
    [ServiceTab.Navidrome]: "nd_enabled",
    [ServiceTab.OfficialApp]: "oa_enabled",
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

export type SettingsStore = typeof settings["store"];

async function createActivity(): Promise<Activity | undefined> {
    const {
        appID,
        appName,
        details,
        detailsURL,
        state,
        stateURL,
        type,
        streamLink,
        startTime,
        endTime,
        imageBig,
        imageBigURL,
        imageBigTooltip,
        imageSmall,
        imageSmallURL,
        imageSmallTooltip,
        buttonOneText,
        buttonOneURL,
        buttonTwoText,
        buttonTwoURL,
        partyMaxSize,
        partySize,
        timestampMode
    } = settings.store;

    if (!appName) return;

    const activity: Activity = {
        application_id: appID || "0",
        name: appName,
        state,
        details,
        type: type ?? ActivityType.PLAYING,
        flags: 1 << 0,
    };

    if (type === ActivityType.STREAMING) activity.url = streamLink;

    switch (timestampMode) {
        case TimestampMode.NOW:
            activity.timestamps = {
                start: Date.now()
            };
            break;
        case TimestampMode.TIME:
            activity.timestamps = {
                start: Date.now() - (new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds()) * 1000
            };
            break;
        case TimestampMode.CUSTOM:
            if (startTime || endTime) {
                activity.timestamps = {};
                if (startTime && endTime && endTime > startTime) {
                    const anchor = getLoopAnchor();
                    activity.timestamps.start = anchor;
                    activity.timestamps.end = anchor + (endTime - startTime);
                } else {
                    if (startTime) activity.timestamps.start = startTime;
                    if (endTime) activity.timestamps.end = endTime;
                }
            }
            break;
        case TimestampMode.NONE:
        default:
            break;
    }

    if (detailsURL) {
        activity.details_url = detailsURL;
    }

    if (stateURL) {
        activity.state_url = stateURL;
    }

    if (buttonOneText) {
        activity.buttons = [
            buttonOneText,
            buttonTwoText
        ].filter(isTruthy);

        activity.metadata = {
            button_urls: [
                buttonOneURL,
                buttonTwoURL
            ].filter(isTruthy)
        };
    }

    if (imageBig) {
        activity.assets = {
            large_image: await getApplicationAsset(imageBig),
            large_text: imageBigTooltip || undefined,
            large_url: imageBigURL || undefined
        };
    }

    if (imageSmall) {
        activity.assets = {
            ...activity.assets,
            small_image: await getApplicationAsset(imageSmall),
            small_text: imageSmallTooltip || undefined,
            small_url: imageSmallURL || undefined
        };
    }

    if (partyMaxSize && partySize) {
        activity.party = {
            size: [partySize, partyMaxSize]
        };
    }

    for (const k in activity) {
        if (k === "type") continue;
        const v = activity[k];
        if (!v || v.length === 0)
            delete activity[k];
    }

    return activity;
}

export async function setRpc(disable?: boolean) {
    const activity: Activity | undefined = await createActivity();

    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: !disable ? activity : null,
        socketId: "CustomRPC",
    });
}

let loopInterval: ReturnType<typeof setInterval> | undefined;
let loopAnchor = 0;

function getLoopAnchor() {
    return loopAnchor;
}

function startTimestampLoop() {
    const { timestampMode, startTime, endTime } = settings.store;
    if (timestampMode !== TimestampMode.CUSTOM || !startTime || !endTime) return;
    const duration = endTime - startTime;
    if (duration <= 0) return;

    stopTimestampLoop();
    loopAnchor = Date.now();

    loopInterval = setInterval(() => {

        if (Date.now() >= loopAnchor + duration) {
            loopAnchor = Date.now();
            setRpc();
        }
    }, 1000);
}

function stopTimestampLoop() {
    if (loopInterval !== undefined) {
        clearInterval(loopInterval);
        loopInterval = undefined;
    }
    loopAnchor = 0;
}

export default definePlugin({
    name: "CustomRPC",
    description: "Add a fully customisable Rich Presence (Game status) to your Discord profile, or let a service like AudioBookShelf, osu!, stats.fm, Jellyfin, Navidrome, Gensokyo Radio or an official app drive it for you",
    tags: ["Activity", "Customisation"],
    authors: [Devs.captain, Devs.AutumnVN, Devs.nin0dev],
    dependencies: ["UserSettingsAPI"],
    // This plugin's patch is not important for functionality, so don't require a restart
    requiresRestart: false,
    settings,

    start() {
        startTimestampLoop();
        setRpc();
        syncServices();
        setOnServiceChange(syncServices);
    },
    stop() {
        setRpc(true);
        stopTimestampLoop();
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
        const [activity] = useAwaiter(createActivity, { fallbackValue: undefined, deps: Object.values(settings.store) });
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
                        Prefer the service tabs for things you actually play on: AudioBookShelf, osu!, stats.fm, Jellyfin, Navidrome, Gensokyo Radio and official apps all drive this same presence.
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
