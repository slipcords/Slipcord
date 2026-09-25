/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OptionType } from "@utils/types";

import { NameFormat } from "../types";
import { OFFICIAL_APPS } from "../types/officialApp";

export let onServiceChange: (() => void) | null = null;
export function setOnServiceChange(fn: (() => void) | null) { onServiceChange = fn; }

/** Settings for the services hosted by this plugin, spread into its own store. */
export const serviceSettings = {
    // Per-service enable toggles
    abs_enabled: {
        description: "Enable AudioBookShelf presence.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    tosu_enabled: {
        description: "Enable osu! (tosu) presence.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    sfm_enabled: {
        description: "Enable stats.fm presence.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    jf_enabled: {
        description: "Enable Jellyfin presence.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    gr_enabled: {
        description: "Enable Gensokyo Radio presence.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    nd_enabled: {
        description: "Enable Navidrome presence.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    oa_enabled: {
        description: "Enable official app presence.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    // AudioBookShelf
    abs_serverUrl: {
        description: "AudioBookShelf server URL.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    abs_username: {
        description: "AudioBookShelf username.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    abs_password: {
        description: "AudioBookShelf password.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },

    // stats.fm
    sfm_username: {
        description: "Stats.fm username.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    sfm_shareUsername: {
        description: "Show link to stats.fm profile.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
    },
    sfm_shareSong: {
        description: "Show link to song on stats.fm.",
        type: OptionType.BOOLEAN as const,
        default: true,
        hidden: true,
    },
    sfm_hideWithSpotify: {
        description: "Hide stats.fm presence if Spotify is running.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
    },
    sfm_hideWithExternalRPC: {
        description: "Hide stats.fm presence if an external RPC is running.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
    },
    sfm_statusName: {
        description: "Custom status text.",
        type: OptionType.STRING as const,
        default: "Stats.fm",
        hidden: true,
    },
    sfm_nameFormat: {
        description: "Name format.",
        type: OptionType.SELECT as const,
        options: [
            { label: "Use custom status name", value: NameFormat.StatusName, default: true },
            { label: "Use format 'artist - song'", value: NameFormat.ArtistFirst },
            { label: "Use format 'song - artist'", value: NameFormat.SongFirst },
            { label: "Use artist name only", value: NameFormat.ArtistOnly },
            { label: "Use song name only", value: NameFormat.SongOnly },
            { label: "Use album name", value: NameFormat.AlbumName },
        ],
        hidden: true,
    },
    sfm_useListeningStatus: {
        description: "Show listening status.",
        type: OptionType.BOOLEAN as const,
        default: true,
        hidden: true,
    },
    sfm_missingArt: {
        description: "Fallback when art is missing.",
        type: OptionType.SELECT as const,
        options: [
            { label: "Use large Stats.fm logo", value: "StatsFmLogo", default: true },
            { label: "Use generic placeholder", value: "placeholder" },
        ],
        hidden: true,
    },
    sfm_showLogo: {
        description: "Show Stats.fm logo next to album art.",
        type: OptionType.BOOLEAN as const,
        default: true,
        hidden: true,
    },
    sfm_alwaysHideArt: {
        description: "Disable downloading album art.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
    },

    // Jellyfin
    jf_serverUrl: {
        description: "Jellyfin server URL.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    jf_apiKey: {
        description: "Jellyfin API key.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    jf_userId: {
        description: "Jellyfin user ID.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    jf_nameDisplay: {
        description: "Name display format.",
        type: OptionType.SELECT as const,
        options: [
            { label: "Series/Movie Name", value: "default", default: true },
            { label: "Series - Episode/Track/Movie Name", value: "full" },
            { label: "Custom", value: "custom" },
        ],
        hidden: true,
    },
    jf_customName: {
        description: "Custom name template.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    jf_coverType: {
        description: "Cover type for TV shows.",
        type: OptionType.SELECT as const,
        options: [
            { label: "Series Cover", value: "series", default: true },
            { label: "Episode Cover", value: "episode" },
        ],
        hidden: true,
    },
    jf_episodeFormat: {
        description: "Episode number format.",
        type: OptionType.SELECT as const,
        options: [
            { label: "S01E01", value: "long", default: true },
            { label: "1x01", value: "short" },
            { label: "Season 1 Episode 1", value: "fulltext" },
        ],
        hidden: true,
    },
    jf_showEpisodeName: {
        description: "Show episode name after season/episode info.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
    },
    jf_overrideType: {
        description: "Override rich presence type.",
        type: OptionType.SELECT as const,
        options: [
            { label: "Off", value: "off", default: true },
            { label: "Listening", value: "2" },
            { label: "Playing", value: "0" },
            { label: "Streaming", value: "1" },
            { label: "Watching", value: "3" },
        ],
        hidden: true,
    },
    jf_showPausedState: {
        description: "Show presence when media is paused.",
        type: OptionType.BOOLEAN as const,
        default: true,
        hidden: true,
    },
    jf_privacyMode: {
        description: "Hide media details.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
    },

    // Gensokyo Radio
    gr_refreshInterval: {
        description: "Refresh interval in seconds.",
        type: OptionType.SLIDER as const,
        markers: [1, 2, 2.5, 3, 5, 10, 15],
        default: 15,
        hidden: true,
    },

    // Navidrome
    nd_serverUrl: {
        description: "Navidrome Server URL (e.g. https://navidrome.example.com)",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },

    nd_username: {
        description: "Navidrome Username",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    nd_password: {
        description: "Navidrome Password",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    nd_clientId: {
        description: "Optional Discord Application Client ID",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    nd_showSmallImage: {
        description: "Show Navidrome logo in bottom right of album art.",
        type: OptionType.BOOLEAN as const,
        default: false,
        hidden: true,
    },
    nd_showAlbum: {
        description: "Show album name in presence.",
        type: OptionType.BOOLEAN as const,
        default: true,
        hidden: true,
    },
    nd_albumArtMode: {
        description: "How to fetch album art.",
        type: OptionType.SELECT as const,
        options: [
            { label: "None", value: "none", default: true },
            { label: "Navidrome Instance (Exposes Server URL to Discord, no auth sent)", value: "instance" },
            { label: "Last.fm API (Sends track metadata to Last.fm)", value: "lastfm" },
        ],
        hidden: true,
    },
    nd_lastfmApiKey: {
        description: "Optional Last.fm API Key",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    nd_refreshInterval: {
        description: "Refresh interval in seconds.",
        type: OptionType.SLIDER as const,
        markers: [1, 2, 5, 10, 15],
        default: 10,
        hidden: true,
    },
    nd_activityType: {
        type: OptionType.SELECT as const,
        description: "Which type of activity",
        options: [
            { label: "Listening", value: 2, default: true },
            { label: "Playing (Fixes hidden lines)", value: 0 },
            { label: "Watching", value: 3 }
        ],
        hidden: true,
    },
    nd_nameString: {
        type: OptionType.STRING as const,
        description: "Activity name format string",
        default: "Navidrome",
        hidden: true,
    },
    nd_detailsString: {
        type: OptionType.STRING as const,
        description: "Activity details format string",
        default: "{song}",
        hidden: true,
    },
    nd_stateString: {
        type: OptionType.STRING as const,
        description: "Activity state format string",
        default: "{artist}",
        hidden: true,
    },
    nd_largeTextString: {
        type: OptionType.STRING as const,
        description: "Activity large text format string",
        default: "{album}",
        hidden: true,
    },
    nd_statusDisplayType: {
        description: "Show the track / artist name in the member list",
        type: OptionType.SELECT as const,
        options: [
            {
                label: "Don't show (shows generic listening message)",
                value: "off"
            },
            {
                label: "Show artist name",
                value: "artist",
                default: true
            },
            {
                label: "Show track name",
                value: "track"
            }
        ],
        hidden: true,
    },
    nd_hideOnPause: {
        description: "Hide Rich Presence when music is paused",
        type: OptionType.BOOLEAN as const,
        default: true,
        hidden: true,
    },

    // Official app
    oa_app: {
        description: "Which app to show the presence as.",
        type: OptionType.SELECT as const,
        options: Object.entries(OFFICIAL_APPS).map(([value, app]) => ({
            label: app.label,
            value,
            default: value === "crunchyroll",
        })),
        default: "crunchyroll",
        hidden: true,
    },
    oa_title: {
        description: "Title of the show or game.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    oa_subtitle: {
        description: "Episode or activity name.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
    oa_duration: {
        description: "Episode or session length in minutes.",
        type: OptionType.STRING as const,
        default: "24",
        hidden: true,
    },
    oa_showArt: {
        description: "Show the app art next to the title.",
        type: OptionType.BOOLEAN as const,
        default: true,
        hidden: true,
    },
    oa_imageUrl: {
        description: "Your own image, as a direct link. Overrides the app art.",
        type: OptionType.STRING as const,
        default: "",
        hidden: true,
    },
};
