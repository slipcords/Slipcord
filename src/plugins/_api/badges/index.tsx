/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import "./fixDiscordBadgePadding.css";

import { _getBadges, BadgePosition, BadgeUserArgs, ProfileBadge } from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { CopyIcon, LinkIcon } from "@components/Icons";
import { openContributorModal } from "@components/settings/tabs";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { shouldShowContributorBadge, shouldShowSlipcordContributorBadge } from "@utils/misc";
import definePlugin from "@utils/types";
import { ContextMenuApi, Menu, Toasts, UserStore } from "@webpack/common";

import Plugins, { PluginMeta } from "~plugins";

import { SlipcordDonorModal, SlipcordTranslatorModal, VencordDonorModal } from "./modals";

const CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1092089799109775453.png?size=64";
const SLIPCORD_CONTRIBUTOR_BADGE = "https://raw.githubusercontent.com/slipcords/Slipper/main/build/icon.png";
const USERPLUGIN_CONTRIBUTOR_BADGE = "https://equicord.org/assets/icons/misc/userplugin.png";

const ContributorBadge: ProfileBadge = {
    id: "vencord_contributor_badge",
    description: "Vencord Contributor",
    iconSrc: CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId))
};

const SlipcordContributorBadge: ProfileBadge = {
    id: "slipcord_contributor_badge",
    description: "Slipcord Contributor",
    iconSrc: SLIPCORD_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowSlipcordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const UserPluginContributorBadge: ProfileBadge = {
    id: "user_plugin_contributor_badge",
    description: "User Plugin Contributor",
    iconSrc: USERPLUGIN_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        if (!IS_DEV) return false;
        const allPlugins = Object.values(Plugins);
        return allPlugins.some(p => {
            const pluginMeta = PluginMeta[p.name];
            return pluginMeta?.userPlugin && p.authors.some(a => a.id.toString() === userId);
        });
    },
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

let DonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let SlipcordDonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let CustomBadgeData: CustomBadgeFile = { badges: {}, users: {} };

const CUSTOM_BADGES_URL = "https://raw.githubusercontent.com/slipcords/Slipcord/main/badges.json";
// Custom badge `icon` paths are written relative to the repo root in badges.json
const CUSTOM_BADGE_ICON_BASE = "https://raw.githubusercontent.com/slipcords/Slipcord/main/";

interface CustomBadgeDef {
    label: string;
    description?: string;
    /** Required. Path in the repo, e.g. "badges/dev.png". Resolved against CUSTOM_BADGE_ICON_BASE */
    icon: string;
    /** Opened when the badge is clicked */
    link?: string;
}

interface CustomBadgeFile {
    badges: Record<string, CustomBadgeDef>;
    /** userId -> badge ids, or inline definitions for badges not in the catalog */
    users: Record<string, Array<string | CustomBadgeDef>>;
}

async function loadBadges(url: string, noCache = false) {
    const init = {} as RequestInit;
    if (noCache) init.cache = "no-cache";

    return await fetch(url, init).then(r => r.json());
}

/**
 * Reads the custom badge file out of this repo. Badges can be plain ids
 * (looked up in the catalog) or inline definitions, so a badge can be given
 * to someone without adding it to the catalog first.
 */
function parseCustomBadgeFile(raw: unknown): CustomBadgeFile {
    const file: CustomBadgeFile = { badges: {}, users: {} };
    if (!raw || typeof raw !== "object") return file;

    const data = raw as Partial<CustomBadgeFile>;
    if (data.badges && typeof data.badges === "object") file.badges = data.badges;
    if (data.users && typeof data.users === "object") file.users = data.users;
    return file;
}

async function loadAllBadges(noCache = false) {
    // Each source is loaded independently: one host being down should not stop
    // the others from loading, which is what used to happen when these were
    // awaited in sequence and a dead host rejected the whole function.
    const [vencord, slipcord, custom] = await Promise.allSettled([
        loadBadges("https://badges.vencord.dev/badges.json", noCache),
        loadBadges("https://badge.equicord.org/badges.json", noCache),
        loadBadges(CUSTOM_BADGES_URL, noCache),
    ]);

    if (vencord.status === "fulfilled") DonorBadges = vencord.value;
    else new Logger("BadgeAPI").error("Failed to load Vencord badges", vencord.reason);

    if (slipcord.status === "fulfilled") SlipcordDonorBadges = slipcord.value;
    else new Logger("BadgeAPI").error("Failed to load Slipcord donor badges", slipcord.reason);

    if (custom.status === "fulfilled") CustomBadgeData = parseCustomBadgeFile(custom.value);
    else new Logger("BadgeAPI").error("Failed to load custom badges", custom.reason);
}

let intervalId: any;

export function BadgeContextMenu({ badge }: { badge: Omit<ProfileBadge, "id"> & BadgeUserArgs; }) {
    return (
        <Menu.Menu
            navId="vc-badge-context"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Badge Options"
        >
            {badge.description && (
                <Menu.MenuItem
                    id="vc-badge-copy-name"
                    label="Copy Badge Name"
                    action={() => copyWithToast(badge.description!)}
                    leadingAccessory={{ type: "icon", icon: CopyIcon }}
                />
            )}
            {badge.iconSrc && (
                <Menu.MenuItem
                    id="vc-badge-copy-link"
                    label="Copy Badge Image Link"
                    action={() => copyWithToast(badge.iconSrc!)}
                    leadingAccessory={{ type: "icon", icon: LinkIcon }}
                />
            )}
        </Menu.Menu>
    );
}

export default definePlugin({
    name: "BadgeAPI",
    description: "API to add badges to users",
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun],
    required: true,
    patches: [
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            replacement: [
                {
                    match: /alt:" ","aria-hidden":!0,src:.{0,50}(\i).iconSrc/,
                    replace: "...$1.props,$&"
                },
                // Path with 2026-04-badge-discovery OFF
                {
                    match: /(?<=forceOpen:.{0,40}?ariaHidden:!0,)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                // Path with 2026-04-badge-discovery ON
                {
                    match: /(?<=fallbackIconSrc:.{0,50}?)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                // handle onClick and onContextMenu
                {
                    match: /href:(\i)\.link/,
                    replace: "...$self.getBadgeMouseEventHandlers($1),$&"
                }
            ]
        },
        {
            find: "getLegacyUsername(){",
            replacement: {
                match: /getBadges\(\)\{.{0,100}?return\[/,
                replace: "$&...$self.getBadges(this),"
            }
        }
    ],

    // for access from the console or other plugins
    get DonorBadges() {
        return DonorBadges;
    },

    get SlipcordDonorBadges() {
        return SlipcordDonorBadges;
    },

    toolboxActions: {
        async "Refetch Badges"() {
            await loadAllBadges(true);
            Toasts.show({
                id: Toasts.genId(),
                message: "Successfully refetched badges!",
                type: Toasts.Type.SUCCESS
            });
        }
    },

    userProfileBadges: [ContributorBadge, SlipcordContributorBadge, UserPluginContributorBadge],

    async start() {
        await loadAllBadges();
        clearInterval(intervalId);
        intervalId = setInterval(loadAllBadges, 1000 * 60 * 30); // 30 minutes
    },

    async stop() {
        clearInterval(intervalId);
    },

    getBadges(profile: { userId: string; guildId: string; }) {
        if (!profile) return [];

        try {
            return _getBadges(profile);
        } catch (e) {
            new Logger("BadgeAPI#getBadges").error(e);
            return [];
        }
    },

    renderBadgeComponent: ErrorBoundary.wrap((badge: ProfileBadge & BadgeUserArgs) => {
        const Component = badge.component!;
        return <Component {...badge} />;
    }, { noop: true }),

    getBadgeMouseEventHandlers(badge: ProfileBadge & BadgeUserArgs) {
        const handlers = {} as Record<string, (e: React.MouseEvent) => void>;

        if (!badge) return handlers; // sanity check

        const { onClick, onContextMenu } = badge;

        if (onClick) handlers.onClick = e => onClick(e, badge);
        if (onContextMenu) handlers.onContextMenu = e => onContextMenu(e, badge);

        return handlers;
    },

    getDonorBadges(userId: string) {
        return DonorBadges[userId]?.map((badge, idx) => ({
            id: `vencord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)" // The image is a bit too big compared to default badges
                }
            },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick() {
                return VencordDonorModal();
            },
        } satisfies ProfileBadge));
    },

    getSlipcordDonorBadges(userId: string) {
        return SlipcordDonorBadges[userId]?.map((badge, idx) => ({
            id: `slipcord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)" // The image is a bit too big compared to default badges
                }
            },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick() {
                return badge.tooltip === "Slipcord Translator" ? SlipcordTranslatorModal() : SlipcordDonorModal();
            },
        } satisfies ProfileBadge));
    },

    /**
     * Custom badges read from badges.json in this repo. To give someone a badge,
     * add its id to their array in `users`, or pass a whole definition inline.
     */
    getCustomBadges(userId: string) {
        const ids = CustomBadgeData.users[userId];
        if (!Array.isArray(ids) || ids.length === 0) return [];

        const badges: ProfileBadge[] = [];
        for (const entry of ids) {
            // An entry is either a catalog id, or an inline definition object
            const def: CustomBadgeDef | undefined = typeof entry === "string"
                ? CustomBadgeData.badges[entry]
                : entry;
            if (!def?.label || !def.icon) continue;

            const onClick = def.link
                ? () => VencordNative.native.openExternal(def.link!)
                : undefined;

            const badge: ProfileBadge = {
                id: `slipcord_custom_badge_${def.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
                description: def.description ?? def.label,
                position: BadgePosition.START,
                iconSrc: def.icon.startsWith("http")
                    ? def.icon
                    : CUSTOM_BADGE_ICON_BASE + def.icon,
                onClick,
                onContextMenu(event, props) {
                    ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={props} />);
                },
                props: {
                    style: {
                        borderRadius: "50%",
                        transform: "scale(0.9)"
                    }
                }
            };

            badges.push(badge);
        }
        return badges;
    }
});
