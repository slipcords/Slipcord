/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { saveFile } from "@utils/web";
import { Channel, Guild, RenderModalProps } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    EmojiStore,
    GuildChannelStore,
    GuildRoleStore,
    GuildStore,
    Menu,
    Modal,
    openModal,
    RestAPI,
    TextArea,
    Toasts,
    useMemo,
    useState
} from "@webpack/common";

const settings = definePluginSettings({
    includeRoles: {
        type: OptionType.BOOLEAN,
        description: "Include roles in backups",
        default: true,
        restartNeeded: false
    },
    includeChannels: {
        type: OptionType.BOOLEAN,
        description: "Include channels in backups",
        default: true,
        restartNeeded: false
    },
    includeEmojis: {
        type: OptionType.BOOLEAN,
        description: "Include emojis in backups",
        default: true,
        restartNeeded: false
    }
});

interface BackupRole {
    name: string;
    color: number;
    hoist: boolean;
    mentionable: boolean;
    permissions: string;
    position: number;
}

interface BackupChannel {
    id: string;
    name: string;
    type: number;
    parentId: string | null;
    position: number;
    topic: string | null;
    nsfw: boolean;
}

interface BackupEmoji {
    name: string;
    animated: boolean;
    url: string;
}

interface ServerBackup {
    version: string;
    timestamp: string;
    guild: {
        id: string;
        name: string;
        icon?: string;
    };
    roles?: BackupRole[];
    channels?: BackupChannel[];
    emojis?: BackupEmoji[];
}

const RESTORABLE_CHANNEL_TYPES = new Set<number>([
    ChannelType.GUILD_CATEGORY,
    ChannelType.GUILD_TEXT,
    ChannelType.GUILD_VOICE,
    ChannelType.GUILD_ANNOUNCEMENT,
    ChannelType.GUILD_FORUM,
    ChannelType.GUILD_MEDIA,
    ChannelType.GUILD_STAGE_VOICE
]);

/** The store wraps every entry as { channel, comparator }, and SELECTABLE also holds threads. */
function guildChannels(guildId: string): Channel[] {
    const { SELECTABLE, VOCAL } = GuildChannelStore.getChannels(guildId);

    return [...SELECTABLE, ...VOCAL]
        .map(entry => (entry as { channel?: Channel; }).channel)
        .filter((channel): channel is Channel => !!channel?.id && typeof channel.type === "number");
}

function collectBackup(guildId: string): ServerBackup | null {
    const guild = GuildStore.getGuild(guildId) as Guild | undefined;
    if (!guild) return null;

    const backup: ServerBackup = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        guild: {
            id: guild.id,
            name: guild.name,
            icon: guild.icon ?? undefined
        }
    };

    if (settings.store.includeRoles) {
        backup.roles = Object.values(GuildRoleStore.getRolesSnapshot(guildId))
            // @everyone shares the guild id and cannot be recreated
            .filter(r => r.id !== guildId)
            .sort((a, b) => a.position - b.position)
            .map(r => ({
                name: r.name,
                color: r.color,
                hoist: r.hoist,
                mentionable: r.mentionable,
                permissions: r.permissions.toString(),
                position: r.position
            }));
    }

    if (settings.store.includeChannels) {
        const seen = new Set<string>();

        backup.channels = guildChannels(guildId)
            .filter(c => {
                if (seen.has(c.id) || !RESTORABLE_CHANNEL_TYPES.has(c.type)) return false;
                seen.add(c.id);
                return true;
            })
            .sort((a, b) => a.position - b.position)
            .map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                parentId: c.parent_id ?? null,
                position: c.position,
                topic: c.topic ?? null,
                nsfw: c.nsfw ?? false
            }));
    }

    if (settings.store.includeEmojis) {
        backup.emojis = EmojiStore.getGuildEmoji(guildId).map(e => ({
            name: e.name ?? "",
            animated: !!e.animated,
            url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`
        }));
    }

    return backup;
}

function exportBackup(guildId: string) {
    const backup = collectBackup(guildId);
    if (!backup) {
        Toasts.show({
            message: "Could not read that server, is it still loaded?",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
        return;
    }

    const content = JSON.stringify(backup, null, 2);
    const date = new Date().toISOString().split("T")[0];
    const filename = `${backup.guild.name.replace(/[^\w\s-]/g, "")}-backup-${date}.json`;

    saveFile(new File([content], filename, { type: "application/json" }));
    Toasts.show({
        message: `Backup for ${backup.guild.name} exported successfully`,
        type: Toasts.Type.SUCCESS,
        id: Toasts.genId()
    });
}

interface RestoreReport {
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
}

function newReport(): RestoreReport {
    return { created: 0, updated: 0, skipped: 0, errors: [] };
}

function describeError(e: unknown): string {
    const data = (e as { body?: { message?: string; }; })?.body;
    const message = data?.message ?? (e as Error)?.message ?? String(e);
    return message.charAt(0).toUpperCase() + message.slice(1);
}

async function restoreRoles(guildId: string, roles: BackupRole[], report: RestoreReport) {
    const existing = Object.values(GuildRoleStore.getRolesSnapshot(guildId)).filter(r => r.id !== guildId);
    const created: { id: string; position: number; }[] = [];

    for (const role of roles) {
        const match = existing.find(r => r.name === role.name);

        try {
            const body = {
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                mentionable: role.mentionable,
                permissions: role.permissions
            };

            if (match) {
                await RestAPI.patch({ url: `/guilds/${guildId}/roles/${match.id}`, body });
                report.updated++;
            } else {
                const result = await RestAPI.post({ url: `/guilds/${guildId}/roles`, body });
                created.push({ id: result.id, position: role.position });
                report.created++;
            }
        } catch (e) {
            report.errors.push(`Role "${role.name}": ${describeError(e)}`);
        }
    }

    if (created.length) {
        const everyone = GuildRoleStore.getRolesSnapshot(guildId)[guildId];
        const positions = [
            { id: guildId, position: everyone?.position ?? 0 },
            ...created.sort((a, b) => b.position - a.position)
        ];

        try {
            await RestAPI.patch({ url: `/guilds/${guildId}/roles`, body: positions });
        } catch (e) {
            report.errors.push(`Role positions: ${describeError(e)}`);
        }
    }
}

async function restoreChannels(guildId: string, channels: BackupChannel[], report: RestoreReport) {
    // Categories have to exist before anything can be parented to them
    const ordered = [
        ...channels.filter(c => c.type === ChannelType.GUILD_CATEGORY),
        ...channels.filter(c => c.type !== ChannelType.GUILD_CATEGORY)
    ];

    // Old parent id -> new category id, so children land in the right place
    const parentMap = new Map<string, string | null>();

    for (const channel of ordered) {
        const parentId = channel.parentId ? parentMap.get(channel.parentId) ?? null : null;

        const existing = guildChannels(guildId)
            .find(c => c.name === channel.name && c.type === channel.type && (c.parent_id ?? null) === parentId);

        try {
            const body: Record<string, unknown> = {
                name: channel.name,
                type: channel.type,
                position: channel.position
            };

            if (parentId) body.parent_id = parentId;
            if (channel.topic !== null) body.topic = channel.topic;
            if (channel.nsfw) body.nsfw = true;

            if (existing) {
                await RestAPI.patch({ url: `/channels/${existing.id}`, body });
                parentMap.set(channel.id, existing.id);
                report.updated++;
            } else {
                const result = await RestAPI.post({ url: `/guilds/${guildId}/channels`, body });
                parentMap.set(channel.id, result.id);
                report.created++;
            }
        } catch (e) {
            report.errors.push(`Channel "${channel.name}": ${describeError(e)}`);
        }
    }
}

async function restoreEmojis(guildId: string, emojis: BackupEmoji[], report: RestoreReport) {
    const existing = new Set(EmojiStore.getGuildEmoji(guildId).map(e => e.name));

    for (const emoji of emojis) {
        if (existing.has(emoji.name)) {
            report.skipped++;
            continue;
        }

        try {
            const response = await fetch(emoji.url);
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

            const blob = await response.blob();
            const image = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });

            await RestAPI.post({
                url: `/guilds/${guildId}/emojis`,
                body: { name: emoji.name, image }
            });

            report.created++;
        } catch (e) {
            report.errors.push(`Emoji "${emoji.name}": ${describeError(e)}`);
        }
    }
}

async function restoreBackup(guildId: string, backup: ServerBackup, report: RestoreReport) {
    if (backup.roles?.length && settings.store.includeRoles) {
        await restoreRoles(guildId, backup.roles, report);
    }

    if (backup.channels?.length && settings.store.includeChannels) {
        await restoreChannels(guildId, backup.channels, report);
    }

    if (backup.emojis?.length && settings.store.includeEmojis) {
        await restoreEmojis(guildId, backup.emojis, report);
    }
}

function isServerBackup(value: unknown): value is ServerBackup {
    if (!value || typeof value !== "object") return false;

    const backup = value as Partial<ServerBackup>;
    if (!backup.guild || typeof backup.guild !== "object") return false;
    if (typeof backup.guild.id !== "string" || typeof backup.guild.name !== "string") return false;

    return [backup.roles, backup.channels, backup.emojis].every(part =>
        part === undefined || (Array.isArray(part) && part.every(entry => entry && typeof entry === "object"))
    );
}

function ReportModal({ modalProps, report, guildName }: { modalProps: RenderModalProps; report: RestoreReport; guildName: string; }) {
    return (
        <Modal {...modalProps} title="Restore finished" size="md">
            <Paragraph>
                Restored into <strong>{guildName}</strong>: {report.created} created, {report.updated} updated
                {report.skipped > 0 && `, ${report.skipped} skipped`}.
            </Paragraph>

            {report.errors.length > 0 && (
                <>
                    <Paragraph>
                        {report.errors.length} item{report.errors.length === 1 ? "" : "s"} could not be restored.
                        You most likely need Manage Roles, Manage Channels and Manage Guild Expressions.
                    </Paragraph>
                    <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                        {report.errors.map((error, i) => (
                            <div key={i} style={{ fontSize: "12px", opacity: 0.8 }}>{error}</div>
                        ))}
                    </div>
                </>
            )}
        </Modal>
    );
}

function ImportBackupModal({ modalProps, guild }: { modalProps: RenderModalProps; guild: Guild; }) {
    const [json, setJson] = useState("");
    const [busy, setBusy] = useState(false);

    const parsed = useMemo<ServerBackup | null>(() => {
        try {
            const value = JSON.parse(json);
            return isServerBackup(value) ? value : null;
        } catch {
            return null;
        }
    }, [json]);

    async function handleImport() {
        if (!parsed) return;

        setBusy(true);
        const report = newReport();

        try {
            await restoreBackup(guild.id, parsed, report);
        } catch (e) {
            report.errors.push(`Restore failed: ${describeError(e)}`);
        }

        setBusy(false);
        modalProps.onClose();
        openModal(props => <ReportModal modalProps={props} report={report} guildName={guild.name} />);
    }

    return (
        <Modal {...modalProps} title="Import Server Backup">
            <Paragraph>
                Paste a backup JSON below. Roles and channels that already exist under the same name are
                updated instead of duplicated, and emojis that already exist are skipped.
            </Paragraph>
            <TextArea
                value={json}
                onChange={setJson}
                placeholder='{"version":"1.0","timestamp":"...","guild":{...}}'
                style={{ height: "200px" }}
            />
            {json.length > 0 && !parsed && (
                <Paragraph>That is not a backup file.</Paragraph>
            )}
            <Flex justifyContent="end" gap="0.5em" style={{ marginTop: "12px" }}>
                <Button variant="secondary" onClick={modalProps.onClose} disabled={busy}>Cancel</Button>
                <Button disabled={!parsed || busy} onClick={handleImport}>
                    {busy ? "Restoring..." : "Import"}
                </Button>
            </Flex>
        </Modal>
    );
}

function BackupIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21,18V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V6A2,2 0 0,1 5,4H19A2,2 0 0,1 21,6V8H11V18H21Z" />
        </svg>
    );
}

const contextMenuPatch = (children: Array<any>, props: { guild: Guild; }) => {
    const { guild } = props;
    if (!guild) return;

    children.push(
        <Menu.MenuItem
            id="server-backup-export"
            label="Export Backup"
            icon={BackupIcon}
            action={() => exportBackup(guild.id)}
        />,
        <Menu.MenuItem
            id="server-backup-import"
            label="Import Backup"
            icon={BackupIcon}
            action={() => openModal(props => <ImportBackupModal modalProps={props} guild={guild} />)}
        />
    );
};

export default definePlugin({
    name: "ServerBackup",
    description: "Backup and restore server roles, channels and emojis",
    tags: ["Servers", "Utility"],
    authors: [Devs.tired55],
    settings,
    contextMenus: {
        "guild-context": contextMenuPatch
    }
});
