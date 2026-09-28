/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { Switch } from "@components/Switch";
import { Button, Select, showToast, Text, TextInput, Toasts, useState } from "@webpack/common";

import { addOfficialApp, getOfficialApps, newId, OFFICIAL_APP_SOCKET_PREFIX, removeOfficialApp, updateOfficialApp } from ".";
import { getBlockedPresences, socketIdFor } from "./presence";
import { cl } from "./shared";
import { ACTIVITY_TYPE_LABELS } from "./types";
import { lookupOfficialApp, OFFICIAL_APPS, OfficialAppEntry, OfficialAppId } from "./types/officialApp";
import { usePresencesVersion } from "./usePresences";

function toDateTimeInput(ms: number) {
    if (!ms || !Number.isFinite(ms)) return "";

    const date = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeInput(value: string) {
    if (!value) return 0;
    return new Date(value).getTime();
}

function TimestampField({ label, value, onChange }: {
    label: string;
    value: number;
    onChange(ms: number): void;
}) {
    const [state, setState] = useState(() => toDateTimeInput(value));
    const [error, setError] = useState<string | null>(null);

    function commit(ms: number) {
        setState(toDateTimeInput(ms));
        setError(null);
        onChange(ms);
    }

    function handleChange(next: string) {
        if (!next) {
            commit(0);
            return;
        }

        const ms = fromDateTimeInput(next);
        if (!Number.isFinite(ms) || ms < 0) {
            setError("Must be a valid date and time.");
            return;
        }

        setState(next);
        setError(null);
        onChange(ms);
    }

    return (
        <div className={cl("single")}>
            <BaseText className={cl("label")} size="md" weight="medium">{label}</BaseText>
            <div className={cl("timestamp")}>
                <input type="datetime-local" value={state} onChange={e => handleChange(e.target.value)} />
                <Button onClick={() => commit(Date.now())}>Now</Button>
                <Button disabled={!value} onClick={() => commit(0)}>Clear</Button>
            </div>
            {error && <Text className={cl("error")} variant="text-sm/normal">{error}</Text>}
        </div>
    );
}

function OfficialAppFields({ entry }: { entry: OfficialAppEntry; }) {
    const app = lookupOfficialApp(entry.app);
    const blocked = getBlockedPresences().has(socketIdFor(OFFICIAL_APP_SOCKET_PREFIX, entry.id));

    function patch(changes: Partial<OfficialAppEntry>) {
        void updateOfficialApp(entry.id, current => ({ ...current, ...changes }));
    }

    return (
        <>
            <SettingsSection id="oa-app" name="App" description="Which app to show the presence as.">
                <Select
                    options={Object.entries(OFFICIAL_APPS).map(([value, a]) => ({ label: a.label, value }))}
                    isSelected={v => v === entry.app}
                    select={v => patch({ app: v as OfficialAppId })}
                    serialize={String}
                    closeOnSelect
                    maxVisibleItems={5}
                />
            </SettingsSection>

            {blocked && (
                <Text className={cl("error")} variant="text-sm/normal">
                    Hidden: the {app ? ACTIVITY_TYPE_LABELS[app.type] ?? "same" : "same"} slot is already used by another presence.
                </Text>
            )}

            <SettingsSection id="oa-title" name="Title" description="Title of the show or game.">
                <TextInput
                    type="text"
                    placeholder="Frieren: Beyond Journey's End"
                    value={entry.title}
                    onChange={title => patch({ title })}
                />
            </SettingsSection>

            <SettingsSection id="oa-subtitle" name="Subtitle" description="Episode or activity name.">
                <TextInput
                    type="text"
                    placeholder="Episode 12"
                    value={entry.subtitle}
                    onChange={subtitle => patch({ subtitle })}
                />
            </SettingsSection>

            <SettingsSection
                id="oa-timestamp-mode"
                name="Timer"
                description="What the presence counts time from."
            >
                <Select
                    options={[
                        { label: "Since I enabled it", value: "now" },
                        { label: "Custom", value: "custom" },
                        { label: "No timer", value: "none" },
                    ]}
                    isSelected={v => v === entry.timestampMode}
                    select={v => patch({ timestampMode: v as OfficialAppEntry["timestampMode"] })}
                    serialize={String}
                    closeOnSelect
                />
            </SettingsSection>

            {entry.timestampMode === "custom" && (
                <>
                    <TimestampField
                        label="Start"
                        value={entry.startTime}
                        onChange={startTime => patch({ startTime })}
                    />
                    <TimestampField
                        label="End"
                        value={entry.endTime}
                        onChange={endTime => patch({ endTime })}
                    />
                    <Text variant="text-sm/normal">
                        An end set here overrides the length in minutes. Leave both empty to count from now.
                    </Text>
                </>
            )}

            {entry.timestampMode === "now" && (
                <Text variant="text-sm/normal">
                    The progress bar is anchored, so editing other settings no longer restarts it.
                </Text>
            )}

            {entry.timestampMode !== "none" && (
                <SettingsSection
                    id="oa-duration"
                    name="Length In Minutes"
                    description="Episode or session length in minutes. Leave empty for a stopwatch."
                >
                    <TextInput
                        type="text"
                        placeholder="24"
                        value={entry.duration}
                        onChange={duration => patch({ duration })}
                    />
                </SettingsSection>
            )}

            <SettingsSection tag="label" inlineSetting id="oa-show-art" name="Show App Art" description="Show the app art next to the title.">
                <Switch checked={entry.showArt ?? app?.defaultArt ?? true} onChange={showArt => patch({ showArt })} />
            </SettingsSection>

            <SettingsSection
                id="oa-image"
                name="Custom Image"
                description="Your own image, as a direct link. Overrides the app art."
            >
                <TextInput
                    type="text"
                    placeholder="https://i.imgur.com/yourart.png"
                    value={entry.imageUrl}
                    onChange={imageUrl => patch({ imageUrl })}
                />
            </SettingsSection>
        </>
    );
}

function OfficialAppRow({ entry, selected, onSelect }: {
    entry: OfficialAppEntry;
    selected: boolean;
    onSelect(): void;
}) {
    const app = OFFICIAL_APPS[entry.app];
    const [enabled, setEnabled] = useState(entry.enabled);

    return (
        <div className={cl("profileRow", { selected })}>
            <Switch
                checked={enabled}
                onChange={v => {
                    setEnabled(v);
                    void updateOfficialApp(entry.id, current => ({ ...current, enabled: v }));
                }}
            />
            <button type="button" className={cl("profileSelect")} onClick={onSelect}>
                <span className={cl("profileName")}>{entry.title || "Untitled"}</span>
                <span className={cl("profileType")}>{app?.label ?? entry.app}</span>
            </button>
            <Button
                color={Button.Colors.RED}
                onClick={() => {
                    void removeOfficialApp(entry.id);
                    showToast(`Deleted ${entry.title || "presence"}.`, Toasts.Type.SUCCESS);
                }}
            >
                Delete
            </Button>
        </div>
    );
}

export function OfficialAppSettings() {
    usePresencesVersion();

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const entries = getOfficialApps();
    const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];

    return (
        <>
            <SettingsSection
                id="officialapp-settings"
                name=""
                description="Show what you are watching, playing or listening to as an official app, with a live progress bar. Add one entry per show, game or album."
            />

            {entries.map(entry => (
                <OfficialAppRow
                    key={entry.id}
                    entry={entry}
                    selected={entry.id === selected?.id}
                    onSelect={() => setSelectedId(entry.id)}
                />
            ))}

            <Button
                onClick={() => {
                    void addOfficialApp({
                        id: newId(),
                        enabled: true,
                        app: "crunchyroll",
                        title: "",
                        subtitle: "",
                        duration: "24",
                        showArt: true,
                        imageUrl: "",
                        timestampMode: "now",
                        startTime: 0,
                        endTime: 0,
                    } satisfies OfficialAppEntry);
                }}
            >
                Add Entry
            </Button>

            {selected && (
                <>
                    <div className={cl("divider")} />
                    <OfficialAppFields key={selected.id} entry={selected} />
                </>
            )}

            {entries.length === 0 && (
                <Text variant="text-sm/normal">No official app presences yet. Add one to get started.</Text>
            )}
        </>
    );
}
