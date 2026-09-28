/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { Activity } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";
import { FluxDispatcher } from "@webpack/common";

import { CLAIMABLE_TYPES, RpcProfile, TimestampMode } from "./types";
import { lookupOfficialApp, OFFICIAL_APPS, OfficialApp, OfficialAppEntry, OfficialAppId } from "./types/officialApp";

const logger = new Logger("CustomRPC:Presence");

const PROFILES_KEY = "CustomRPC_profiles";
const OFFICIAL_APPS_KEY = "CustomRPC_officialApps";
const MIGRATED_KEY = "CustomRPC_profilesMigrated";
const ART_DEFAULT_KEY = "CustomRPC_officialAppArtDefaults";

export const PROFILE_SOCKET_PREFIX = "CustomRPC_";
export const OFFICIAL_APP_SOCKET_PREFIX = "RichPresence_OfficialApp_";

export function socketIdFor(prefix: string, id: string) {
    return `${prefix}${id}`;
}

/* ------------------------------------------------------------------ *
 * Everything below is a single source of truth for the presences the
 * plugin shows. Custom profiles and official app entries are both just
 * "presences" that claim an activity type, which is what lets several
 * of them run at once without two of them fighting over the same type.
 * ------------------------------------------------------------------ */

export type PresenceKind = "profile" | "officialApp";

export interface Presence {
    kind: PresenceKind;
    id: string;
    name: string;
    enabled: boolean;
    type: ActivityType;
    socketId: string;
}

let profiles: RpcProfile[] = [];
let officialApps: OfficialAppEntry[] = [];
let loaded = false;

const listeners = new Set<() => void>();

export function onPresencesChanged(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

function emitChange() {
    for (const fn of listeners) fn();
}

/** Socket ids we have dispatched an activity for, so we know what to clear on removal. */
const dispatched = new Set<string>();

export function newId() {
    return Math.random().toString(36).slice(2, 10);
}

function normalizeProfile(profile: Partial<RpcProfile> & { id: string }): RpcProfile {
    return {
        id: profile.id,
        name: typeof profile.name === "string" && profile.name.trim() ? profile.name : "Custom",
        enabled: profile.enabled !== false,
        config: profile.config ?? {},
    };
}

function normalizeOfficialApp(entry: Partial<OfficialAppEntry> & { id: string }): OfficialAppEntry {
    const app = (typeof entry.app === "string" && entry.app in OFFICIAL_APPS
        ? entry.app
        : "crunchyroll") as OfficialAppId;

    return {
        id: entry.id,
        enabled: entry.enabled !== false,
        app,
        title: typeof entry.title === "string" ? entry.title : "",
        subtitle: typeof entry.subtitle === "string" ? entry.subtitle : "",
        duration: typeof entry.duration === "string" ? entry.duration : "24",
        // unset falls back to the app's own default
        showArt: entry.showArt ?? (OFFICIAL_APPS[app] as OfficialApp | undefined)?.defaultArt ?? true,
        imageUrl: typeof entry.imageUrl === "string" ? entry.imageUrl : "",
        timestampMode: entry.timestampMode ?? "now",
        startTime: typeof entry.startTime === "number" ? entry.startTime : 0,
        endTime: typeof entry.endTime === "number" ? entry.endTime : 0,
    };
}

/**
 * The plugin used to keep a single custom presence spread across the plugin settings
 * store. Turn that into one profile so the settings people already have keep working.
 */
function migrateLegacyProfile(): RpcProfile | null {
    const store = legacySettings?.store;
    if (!store) return null;

    if (!store.appName && !store.appID) return null;

    const config: RpcProfile["config"] = {};
    for (const [key, value] of Object.entries(store)) {
        if (key === "config" || key === "name" || key === "enabled" || key === "id") continue;
        if (value === undefined || value === null || value === "") continue;
        (config as Record<string, unknown>)[key] = value;
    }

    logger.info("Migrated the existing custom presence into a profile");

    return { id: newId(), name: "Custom", enabled: true, config };
}

function migrateLegacyOfficialApp(): OfficialAppEntry[] {
    const store = legacySettings?.store;
    if (!store) return [];

    if (!store.oa_title) return [];

    logger.info("Migrated the existing official app presence into an entry");

    return [{
        id: newId(),
        enabled: true,
        app: (typeof store.oa_app === "string" && store.oa_app in OFFICIAL_APPS ? store.oa_app : "crunchyroll") as OfficialAppId,
        title: store.oa_title,
        subtitle: store.oa_subtitle ?? "",
        duration: store.oa_duration ?? "24",
        showArt: store.oa_showArt !== false,
        imageUrl: store.oa_imageUrl ?? "",
        timestampMode: "now",
        startTime: 0,
        endTime: 0,
    }];
}

let legacySettings: { store: Record<string, any> } | null = null;

/** The plugin settings store, injected by the plugin so this module stays free of a cycle. */
export function provideLegacySettings(store: { store: Record<string, any> }) {
    legacySettings = store;
}

export async function loadPresences() {
    if (loaded) return;

    const [storedProfiles, storedApps, migrated] = await Promise.all([
        DataStore.get<RpcProfile[]>(PROFILES_KEY),
        DataStore.get<OfficialAppEntry[]>(OFFICIAL_APPS_KEY),
        DataStore.get<boolean>(MIGRATED_KEY),
    ]);

    if (!migrated) {
        // first run after the update: pull the old single-presence settings across
        profiles = [migrateLegacyProfile()].filter(Boolean) as RpcProfile[];
        officialApps = migrateLegacyOfficialApp();
        await DataStore.set(MIGRATED_KEY, true);
        await DataStore.set(PROFILES_KEY, profiles);
        await DataStore.set(OFFICIAL_APPS_KEY, officialApps);
    } else {
        profiles = (storedProfiles ?? []).map(normalizeProfile);
        officialApps = (storedApps ?? []).map(normalizeOfficialApp);
    }

    // One-time: entries saved before the Meta Quest art default existed carry an explicit
    // showArt: true, so clear it and let the app default (off for Quest) apply.
    if (!await DataStore.get<boolean>(ART_DEFAULT_KEY)) {
        await DataStore.set(ART_DEFAULT_KEY, true);

        const patched = officialApps.map(entry =>
            entry.app === "quest" && entry.showArt ? { ...entry, showArt: undefined } : entry
        );
        if (patched.some((entry, i) => entry !== officialApps[i])) {
            officialApps = patched;
            await DataStore.set(OFFICIAL_APPS_KEY, officialApps);
            logger.info("Cleared the Meta Horizon artwork from Meta Quest presences");
        }
    }

    loaded = true;
}

export function getProfiles() {
    return profiles;
}

export function getOfficialApps() {
    return officialApps;
}

export async function setProfiles(next: RpcProfile[]) {
    profiles = next.map(normalizeProfile);
    await DataStore.set(PROFILES_KEY, profiles);
    emitChange();
}

export async function setOfficialApps(next: OfficialAppEntry[]) {
    officialApps = next.map(normalizeOfficialApp);
    await DataStore.set(OFFICIAL_APPS_KEY, officialApps);
    emitChange();
}

export function getProfile(id: string) {
    return profiles.find(profile => profile.id === id);
}

export function getOfficialApp(id: string) {
    return officialApps.find(entry => entry.id === id);
}

/* ------------------------------------------------------------------ *
 * Type arbitration
 * ------------------------------------------------------------------ */

function typeOfProfile(profile: RpcProfile): ActivityType {
    const { type } = profile.config;
    return CLAIMABLE_TYPES.includes(type as ActivityType) ? type as ActivityType : ActivityType.PLAYING;
}

function typeOfOfficialApp(entry: OfficialAppEntry): ActivityType {
    return lookupOfficialApp(entry.app)?.type ?? ActivityType.WATCHING;
}

/**
 * Discord shows a single activity of each type, so two presences claiming the same
 * type would leave one of them silently invisible. The first one in list order wins
 * and the rest are reported as blocked, which the settings UI surfaces.
 */
export function resolveClaims(): { active: Presence[]; blocked: Map<string, Presence> } {
    const active: Presence[] = [];
    const blocked = new Map<string, Presence>();
    const claimed = new Map<ActivityType, string>();

    const candidates: Presence[] = [
        ...profiles.map(profile => ({
            kind: "profile" as const,
            id: profile.id,
            name: profile.name,
            enabled: profile.enabled,
            type: typeOfProfile(profile),
            socketId: socketIdFor(PROFILE_SOCKET_PREFIX, profile.id),
        })),
        ...officialApps.map(entry => ({
            kind: "officialApp" as const,
            id: entry.id,
            name: OFFICIAL_APPS[entry.app]?.label ?? entry.app,
            enabled: entry.enabled,
            type: typeOfOfficialApp(entry),
            socketId: socketIdFor(OFFICIAL_APP_SOCKET_PREFIX, entry.id),
        })),
    ];

    for (const presence of candidates) {
        if (!presence.enabled) continue;

        const owner = claimed.get(presence.type);
        if (owner !== undefined) {
            blocked.set(presence.socketId, presence);
            continue;
        }

        claimed.set(presence.type, presence.socketId);
        active.push(presence);
    }

    return { active, blocked };
}

export function getBlockedPresences() {
    return resolveClaims().blocked;
}

/* ------------------------------------------------------------------ *
 * Timestamps
 * ------------------------------------------------------------------ */

/**
 * "Since Discord open" has to stay put, so the anchor is captured once instead of on
 * every rebuild. Changing the mode re-anchors, so switching to it means since you switched.
 */
const anchors = new Map<string, string>();
const anchorTimes = new Map<string, number>();
const loopIntervals = new Map<string, ReturnType<typeof setInterval>>();

export function anchorFor(presence: Presence, mode: TimestampMode | string) {
    const key = `${presence.socketId}:${mode}`;
    if (anchors.get(presence.socketId) !== key) {
        anchors.set(presence.socketId, key);
        anchorTimes.set(presence.socketId, Date.now());
    }
    return anchorTimes.get(presence.socketId)!;
}

export function resetAnchor(presence: Presence, mode: TimestampMode | string) {
    anchors.set(presence.socketId, `${presence.socketId}:${mode}`);
    anchorTimes.set(presence.socketId, Date.now());
}

export function resetAnchors() {
    anchors.clear();
    anchorTimes.clear();
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

function setActivity(socketId: string, activity: Activity | null) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId });
}

/**
 * Clears presences that are no longer active, so disabling or deleting one actually
 * removes it instead of leaving a stale presence behind.
 */
export function clearInactive(activeSocketIds: Set<string>) {
    for (const socketId of [...dispatched]) {
        if (activeSocketIds.has(socketId)) continue;
        setActivity(socketId, null);
        dispatched.delete(socketId);
    }
}

export function markDispatched(socketId: string) {
    dispatched.add(socketId);
}

export function clearAllDispatched() {
    for (const socketId of [...dispatched]) {
        setActivity(socketId, null);
    }
    dispatched.clear();
    resetAnchors();
}

export function stopLoops() {
    for (const interval of loopIntervals.values()) clearInterval(interval);
    loopIntervals.clear();
}

export function registerLoop(presence: Presence, mode: TimestampMode | string, duration: number, onTick: () => void) {
    stopLoop(presence.socketId);
    const anchor = anchorFor(presence, mode);

    const interval = setInterval(() => {
        if (Date.now() >= anchor + duration) {
            anchorTimes.set(presence.socketId, Date.now());
            onTick();
        }
    }, 1000);

    loopIntervals.set(presence.socketId, interval);
}

export function stopLoop(socketId: string) {
    const interval = loopIntervals.get(socketId);
    if (interval === undefined) return;
    clearInterval(interval);
    loopIntervals.delete(socketId);
}

export { logger as presenceLogger };
