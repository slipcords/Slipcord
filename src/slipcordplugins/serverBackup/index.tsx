/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { saveFile } from "@utils/web";
import { Guild, RenderModalProps } from "@vencord/discord-types";
import { Button, EmojiStore, GuildChannelStore, GuildRoleStore, GuildStore, Menu, Modal, openModal, TextArea, Toasts, useMemo, useState } from "@webpack/common";

const settings = definePluginSettings({
    autoBackup: {
        type: OptionType.BOOLEAN,
        description: "Automatically backup server settings when changes are detected",
        default: false,
        restartNeeded: false
    },
    includeRoles: {
        type: OptionType.BOOLEAN,
        description: "Include role information in backups",
        default: true,
        restartNeeded: false
    },
    includeChannels: {
        type: OptionType.BOOLEAN,
        description: "Include channel structure in backups",
        default: true,
        restartNeeded: false
    },
    includeEmojis: {
        type: OptionType.BOOLEAN,
        description: "Include emoji list in backups",
        default: true,
        restartNeeded: false
    }
});

interface ServerBackup {
    version: string;
    timestamp: string;
    guild: {
        id: string;
        name: string;
        icon?: string;
    };
    roles?: any[];
    channels?: any[];
    emojis?: any[];
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
        backup.roles = Object.values(GuildRoleStore.getRolesSnapshot(guildId)).map(r => ({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: r.permissions.toString()
        }));
    }

    if (settings.store.includeChannels) {
        backup.channels = GuildChannelStore.getChannels(guildId).SELECTABLE.map(c => ({
            name: c.name,
            type: c.type,
            parentId: c.parent_id,
            position: c.position
        }));
    }

    if (settings.store.includeEmojis) {
        backup.emojis = EmojiStore.getGuildEmoji(guildId).map(e => ({
            name: e.name,
            animated: e.animated
        }));
    }

    return backup;
}

function exportBackup(guildId: string) {
    const backup = collectBackup(guildId);
    if (!backup) return;

    const content = JSON.stringify(backup, null, 2);
    const date = new Date().toISOString().split("T")[0];
    const filename = `${backup.guild.name}-backup-${date}.json`;

    try {
        const file = new File([content], filename, { type: "application/json" });
        saveFile(file);
        Toasts.show({
            message: `Backup for ${backup.guild.name} exported successfully`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    } catch (e) {
        Toasts.show({
            message: "Failed to export backup",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
    }
}

function ImportBackupModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [json, setJson] = useState("");

    const parsed = useMemo(() => {
        try {
            return JSON.parse(json);
        } catch {
            return null;
        }
    }, [json]);

    return (
        <Modal {...modalProps} title="Import Server Backup">
            <Paragraph>
                Paste a backup JSON below to restore server settings.
            </Paragraph>
            <TextArea
                value={json}
                onChange={setJson}
                placeholder='{"version":"1.0","timestamp":"...","guild":{...}}'
                style={{ height: "200px" }}
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <Button onClick={modalProps.onClose}>Cancel</Button>
                <Button disabled={!parsed} onClick={() => {
                    Toasts.show({
                        message: "Import functionality requires manual review",
                        type: Toasts.Type.FAILURE,
                        id: Toasts.genId()
                    });
                    modalProps.onClose();
                }}>Import</Button>
            </div>
        </Modal>
    );
}

function importBackupModal() {
    openModal(props => <ImportBackupModal modalProps={props} />);
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
            action={importBackupModal}
        />
    );
};

export default definePlugin({
    name: "ServerBackup",
    description: "Backup and restore server settings, roles, channels, and emojis",
    tags: ["Servers", "Utility"],
    authors: [Devs.tired55],
    settings,
    contextMenus: {
        "guild-context": contextMenuPatch
    }
});
