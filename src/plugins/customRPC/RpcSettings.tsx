/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./settings.css";

import { isPluginEnabled } from "@api/PluginManager";
import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { resolveError } from "@components/settings/tabs/plugins/components/Common";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import { ActivityType } from "@vencord/discord-types/enums";
import { Button, Select, showToast, Text, TextInput, Toasts, useState } from "@webpack/common";

import {
    addProfile,
    getBlockedPresences,
    getProfiles,
    newId,
    removeProfile,
    restartTimer,
    setRpc,
    updateProfile,
} from ".";
import { PROFILE_SOCKET_PREFIX, socketIdFor } from "./presence";
import { ACTIVITY_TYPE_LABELS, CLAIMABLE_TYPES, RpcConfig, RpcProfile, TIMESTAMP_MODE_OPTIONS, TimestampMode } from "./types";
import { usePresencesVersion } from "./usePresences";

const cl = classNameFactory("vc-customRPC-settings-");

type ConfigKey = keyof RpcConfig;

const makeValidator = (maxLength: number, isRequired = false) => (value: string) => {
    if (isRequired && !value) return "This field is required.";
    if (value.length > maxLength) return `Must be not longer than ${maxLength} characters.`;
    return true;
};

const maxLength128 = makeValidator(128);

function isAppIdValid(value: string) {
    if (!/^\d{16,21}$/.test(value)) return "Must be a valid Discord ID.";
    return true;
}

function isStreamLinkValid(value: string) {
    if (value && !/^https?:\/\//.test(value)) return "Streaming link must be a valid URL.";
    if (value.length > 512) return "Streaming link must be not longer than 512 characters.";
    return true;
}

function isUrlValid(value: string) {
    if (value && !/^https?:\/\/.+/.test(value)) return "Must be a valid URL.";
    return true;
}

function isImageKeyValid(value: string) {
    if (/https?:\/\/(?!i\.)?imgur\.com\//.test(value)) return "Imgur link must be a direct link to the image (e.g. https://i.imgur.com/...). Right click the image and click 'Copy image address'";
    if (/https?:\/\/(?!media\.)?tenor\.com\//.test(value)) return "Tenor link must be a direct link to the image (e.g. https://media.tenor.com/...). Right click the GIF and click 'Copy image address'";
    return true;
}

function parseNumber(value: string) {
    return value ? parseInt(value, 10) : 0;
}

function isNumberValid(value: number) {
    if (isNaN(value)) return "Must be a number.";
    if (value < 0) return "Must be a positive number.";
    return true;
}

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

interface EditContext {
    profile: RpcProfile;
    set(patch: Partial<RpcConfig>): Promise<void>;
    restart(): void;
}

function TextField({ label, configKey, context, isValid, transform, disabled, placeholder }: {
    label: string;
    configKey: ConfigKey;
    context: EditContext;
    isValid?(value: string): true | string;
    transform?(value: string): unknown;
    disabled?: boolean;
    placeholder?: string;
}) {
    const [state, setState] = useState(() => (context.profile.config[configKey] as string) ?? "");
    const [error, setError] = useState<string | null>(null);

    function handleChange(newValue: string) {
        if (transform) newValue = transform(newValue) as string;

        const valid = isValid?.(newValue) ?? true;
        setState(newValue);
        setError(resolveError(valid));

        if (valid === true) void context.set({ [configKey]: newValue } as Partial<RpcConfig>);
    }

    return (
        <div className={cl("single", { disabled })}>
            <Heading tag="h5">{label}</Heading>
            <TextInput
                type="text"
                placeholder={placeholder ?? "Enter a value"}
                value={state}
                onChange={handleChange}
                disabled={disabled}
            />
            {error && <Text className={cl("error")} variant="text-sm/normal">{error}</Text>}
        </div>
    );
}

function SelectField({ label, configKey, context, options, disabled }: {
    label: string;
    configKey: ConfigKey;
    context: EditContext;
    options: { label: string; value: unknown; }[];
    disabled?: boolean;
}) {
    return (
        <div className={cl("single", { disabled })}>
            <Heading tag="h5">{label}</Heading>
            <Select
                placeholder={"Select an option"}
                options={options}
                maxVisibleItems={5}
                closeOnSelect={true}
                select={v => void context.set({ [configKey]: v } as Partial<RpcConfig>)}
                isSelected={v => v === context.profile.config[configKey]}
                serialize={v => String(v)}
                isDisabled={disabled}
            />
        </div>
    );
}

function ToggleField({ label, configKey, context, disabled }: {
    label: string;
    configKey: ConfigKey;
    context: EditContext;
    disabled?: boolean;
}) {
    const [value, setValue] = useState(() => Boolean(context.profile.config[configKey]));

    return (
        <div className={cl("single", { disabled })}>
            <Heading tag="h5">{label}</Heading>
            <Switch
                checked={value}
                disabled={disabled}
                onChange={v => {
                    setValue(v);
                    void context.set({ [configKey]: v } as Partial<RpcConfig>);
                }}
            />
        </div>
    );
}

function PairField({ data }: { data: [React.ReactElement, React.ReactElement]; }) {
    return (
        <div className={cl("pair")}>
            {data[0]}
            {data[1]}
        </div>
    );
}

function TimestampField({ label, configKey, context, disabled }: {
    label: string;
    configKey: ConfigKey;
    context: EditContext;
    disabled?: boolean;
}) {
    const [state, setState] = useState(() => toDateTimeInput(Number(context.profile.config[configKey] ?? 0)));
    const [error, setError] = useState<string | null>(null);

    function commit(ms: number) {
        setState(toDateTimeInput(ms));
        setError(null);
        void context.set({ [configKey]: ms } as Partial<RpcConfig>);
    }

    function handleChange(value: string) {
        if (!value) {
            commit(0);
            return;
        }

        const ms = fromDateTimeInput(value);
        if (!Number.isFinite(ms) || ms < 0) {
            setError("Must be a valid date and time.");
            return;
        }

        setState(value);
        setError(null);
        void context.set({ [configKey]: ms } as Partial<RpcConfig>);
    }

    return (
        <div className={cl("single", { disabled })}>
            <Heading tag="h5">{label}</Heading>
            <div className={cl("timestamp")}>
                <input
                    type="datetime-local"
                    value={state}
                    disabled={disabled}
                    onChange={e => handleChange(e.target.value)}
                />
                <Button disabled={disabled} onClick={() => commit(Date.now())}>Now</Button>
                <Button disabled={disabled || !Number(context.profile.config[configKey] ?? 0)} onClick={() => commit(0)}>Clear</Button>
            </div>
            {error && <Text className={cl("error")} variant="text-sm/normal">{error}</Text>}
        </div>
    );
}

function ProfileFields({ profile }: { profile: RpcProfile; }) {
    const { config } = profile;
    const type = config.type ?? ActivityType.PLAYING;
    const timestampMode = config.timestampMode ?? TimestampMode.NONE;

    const context: EditContext = {
        profile,
        set: patch => updateProfile(profile.id, current => ({
            ...current,
            config: { ...current.config, ...patch },
        })),
        restart: () => restartTimer({
            kind: "profile",
            id: profile.id,
            name: profile.name,
            enabled: profile.enabled,
            type: type as ActivityType,
            socketId: socketIdFor(PROFILE_SOCKET_PREFIX, profile.id),
        }),
    };

    return (
        <>
            <SelectField
                label="Activity Type"
                configKey="type"
                context={context}
                options={CLAIMABLE_TYPES.map(value => ({
                    label: ACTIVITY_TYPE_LABELS[value],
                    value,
                }))}
            />

            <PairField data={[
                <TextField key="appID" label="Application ID" configKey="appID" context={context} isValid={isAppIdValid} />,
                <TextField key="appName" label="Application Name" configKey="appName" context={context} isValid={makeValidator(128, true)} />,
            ]} />

            <PairField data={[
                <TextField key="details" label="Detail (line 1)" configKey="details" context={context} isValid={maxLength128} />,
                <TextField key="detailsURL" label="Detail URL" configKey="detailsURL" context={context} isValid={isUrlValid} />,
            ]} />

            <PairField data={[
                <TextField key="state" label="State (line 2)" configKey="state" context={context} isValid={maxLength128} />,
                <TextField key="stateURL" label="State URL" configKey="stateURL" context={context} isValid={isUrlValid} />,
            ]} />

            <TextField
                label="Stream Link (only if activity type is Streaming)"
                configKey="streamLink"
                context={context}
                isValid={isStreamLinkValid}
                disabled={type !== ActivityType.STREAMING}
            />

            <PairField data={[
                <TextField
                    key="partySize"
                    label="Party Size"
                    configKey="partySize"
                    context={context}
                    transform={v => String(parseNumber(v))}
                    isValid={v => isNumberValid(parseNumber(v))}
                    disabled={type !== ActivityType.PLAYING}
                />,
                <TextField
                    key="partyMaxSize"
                    label="Maximum Party Size"
                    configKey="partyMaxSize"
                    context={context}
                    transform={v => String(parseNumber(v))}
                    isValid={v => isNumberValid(parseNumber(v))}
                    disabled={type !== ActivityType.PLAYING}
                />,
            ]} />

            <Divider />

            <PairField data={[
                <TextField key="imageBig" label="Large Image URL/Key" configKey="imageBig" context={context} isValid={isImageKeyValid} />,
                <TextField key="imageBigTooltip" label="Large Image Text" configKey="imageBigTooltip" context={context} isValid={maxLength128} />,
            ]} />
            <TextField label="Large Image clickable URL" configKey="imageBigURL" context={context} isValid={isUrlValid} />

            <PairField data={[
                <TextField key="imageSmall" label="Small Image URL/Key" configKey="imageSmall" context={context} isValid={isImageKeyValid} />,
                <TextField key="imageSmallTooltip" label="Small Image Text" configKey="imageSmallTooltip" context={context} isValid={maxLength128} />,
            ]} />
            <TextField label="Small Image clickable URL" configKey="imageSmallURL" context={context} isValid={isUrlValid} />

            <Divider />

            <PairField data={[
                <TextField key="buttonOneText" label="Button1 Text" configKey="buttonOneText" context={context} isValid={makeValidator(31)} />,
                <TextField key="buttonOneURL" label="Button1 URL" configKey="buttonOneURL" context={context} isValid={isUrlValid} />,
            ]} />
            <PairField data={[
                <TextField key="buttonTwoText" label="Button2 Text" configKey="buttonTwoText" context={context} isValid={makeValidator(31)} />,
                <TextField key="buttonTwoURL" label="Button2 URL" configKey="buttonTwoURL" context={context} isValid={isUrlValid} />,
            ]} />

            <Divider />

            <SelectField
                label="Timestamp Mode"
                configKey="timestampMode"
                context={context}
                options={TIMESTAMP_MODE_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
            />

            {timestampMode === TimestampMode.NOW && (
                <div className={cl("single")}>
                    <Text variant="text-sm/normal">Counting from when you switched to this mode.</Text>
                    <Button onClick={context.restart}>Restart Timer</Button>
                </div>
            )}

            {timestampMode === TimestampMode.CUSTOM && (
                <>
                    <TimestampField label="Start" configKey="startTime" context={context} />
                    <TimestampField label="End" configKey="endTime" context={context} />
                    <ToggleField
                        label="Repeat the start and end times over and over"
                        configKey="timestampLoop"
                        context={context}
                        disabled={!config.startTime || !config.endTime}
                    />
                </>
            )}

            {timestampMode === TimestampMode.TIME && (
                <Text variant="text-sm/normal">Counts from the start of today, so it does not reset at midnight.</Text>
            )}
        </>
    );
}

function ProfileRow({ profile, selected, onSelect }: { profile: RpcProfile; selected: boolean; onSelect(): void; }) {
    const blocked = getBlockedPresences().has(socketIdFor(PROFILE_SOCKET_PREFIX, profile.id));
    const [enabled, setEnabled] = useState(profile.enabled);

    const type = (profile.config.type ?? ActivityType.PLAYING) as ActivityType;
    const typeLabel = ACTIVITY_TYPE_LABELS[type] ?? String(type);

    return (
        <div className={cl("profileRow", { selected })}>
            <Switch
                checked={enabled}
                onChange={v => {
                    setEnabled(v);
                    void updateProfile(profile.id, current => ({ ...current, enabled: v }));
                }}
            />
            <button type="button" className={cl("profileSelect")} onClick={onSelect}>
                <span className={cl("profileName")}>{profile.name}</span>
                <span className={cl("profileType")}>{typeLabel}</span>
            </button>
            {blocked && <Text className={cl("error")} variant="text-sm/normal">Hidden: {typeLabel} already in use</Text>}
            <Button
                color={Button.Colors.RED}
                onClick={() => {
                    void removeProfile(profile.id);
                    showToast(`Deleted ${profile.name}.`, Toasts.Type.SUCCESS);
                }}
            >
                Delete
            </Button>
        </div>
    );
}

export function RPCSettings() {
    usePresencesVersion();

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const profiles = getProfiles();

    const selected = profiles.find(profile => profile.id === selectedId) ?? profiles[0];

    return (
        <div className={cl("root")}>
            <Heading tag="h5">Presences</Heading>
            <Text variant="text-sm/normal">
                Each presence is shown on its own socket, so you can run several at once.
                Discord only renders one activity of each type, so two presences with the
                same activity type can't both be visible.
            </Text>

            {profiles.map(profile => (
                <ProfileRow
                    key={profile.id}
                    profile={profile}
                    selected={profile.id === selected?.id}
                    onSelect={() => setSelectedId(profile.id)}
                />
            ))}

            <Button
                onClick={() => {
                    void addProfile({ id: newId(), name: `Custom ${profiles.length + 1}`, enabled: true, config: { type: ActivityType.PLAYING } });
                }}
            >
                Add Presence
            </Button>

            {selected && (
                <>
                    <Divider />
                    <TextInput
                        type="text"
                        label="Name"
                        placeholder="Presence name"
                        value={selected.name}
                        onChange={name => void updateProfile(selected.id, current => ({
                            ...current,
                            name: name || "Custom",
                        }))}
                    />
                    <ProfileFields key={selected.id} profile={selected} />
                </>
            )}

            {!isPluginEnabled("CustomRPC") && (
                <Text className={cl("error")} variant="text-sm/normal">
                    CustomRPC is disabled, so nothing will be shown until you enable the plugin.
                </Text>
            )}
        </div>
    );
}

export { setRpc };
