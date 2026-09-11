/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Settings, useSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { Link } from "@components/Link";
import { Notice } from "@components/Notice";
import {
    ChangelogEntry,
    formatTimestamp,
    getCommitsSinceLastSeen,
    getNewPlugins,
    getNewSettings,
    initializeChangelog,
    setLastSeenHash,
    updateKnownPlugins,
    updateKnownSettings,
} from "@components/settings/tabs/changelog/changelogManager";
import { PluginDependencyList } from "@components/settings/tabs/plugins";
import { PluginCard } from "@components/settings/tabs/plugins/PluginCard";
import { HashLink } from "@components/settings/tabs/updater/Components";
import { ChangeList } from "@utils/ChangeList";
import { classNameFactory } from "@utils/css";
import { useForceUpdater } from "@utils/react";
import { getRepo } from "@utils/updater";
import { RenderModalProps } from "@vencord/discord-types";
import { closeModal, Modal, openModal, Tooltip, useMemo } from "@webpack/common";
import { ReactNode } from "react";

import gitHash from "~git-hash";
import Plugins from "~plugins";

const cl = classNameFactory("vc-new-plugins-");

let hasSeen = false;

function getRepoSlug(repoOrUrl: string): string {
    try {
        const base = repoOrUrl.replace(/^git\+/, "");
        if (/^https?:\/\//i.test(base)) {
            const url = new URL(base);
            const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
            if (segments.length >= 2) return `${segments[0]}/${segments[1]}`;
        } else if (/^[^\s/]+\/[^\s/]+$/.test(base)) {
            return base;
        }
    } catch { }

    return "slipcords/Slipcord";
}

interface ModalComponentProps {
    modalProps: RenderModalProps;
    commits: ChangelogEntry[];
    newPlugins: string[];
    newSettings: Map<string, string[]>;
    repoSlug: string;
}

function NewPluginsModal({ modalProps, commits, newPlugins, newSettings, repoSlug }: ModalComponentProps) {
    const settings = useSettings();
    const changes = useMemo(() => new ChangeList<string>(), []);
    const forceUpdate = useForceUpdater();

    const depMap = useMemo(() => {
        const o = {} as Record<string, string[]>;
        for (const plugin in Plugins) {
            const deps = Plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);

    const sortedPlugins = useMemo(() => {
        const mapPlugins = (array: string[]) => array.map(pn => Plugins[pn]).sort((a, b) => a.name.localeCompare(b.name));
        return [
            ...mapPlugins(newPlugins.filter(pn => Plugins[pn])),
            ...mapPlugins([...newSettings.keys()].filter(pn => !newPlugins.includes(pn) && Plugins[pn]))
        ];
    }, []);

    const onRestartNeeded = (name: string) => {
        changes.handleChange(name);
        forceUpdate();
    };

    const pluginCards: ReactNode[] = [];
    const requiredPluginCards: ReactNode[] = [];

    for (const p of sortedPlugins) {
        if (p.hidden) continue;

        const isRequired = p.required || depMap[p.name]?.some(d => settings.plugins[d].enabled);

        if (isRequired) {
            const tooltipText = p.required
                ? "This plugin is required for Slipcord to function."
                : <PluginDependencyList deps={depMap[p.name]?.filter(d => settings.plugins[d].enabled)} />;

            requiredPluginCards.push(
                <Tooltip text={tooltipText} key={p.name}>
                    {({ onMouseLeave, onMouseEnter }) => (
                        <PluginCard
                            onMouseLeave={onMouseLeave}
                            onMouseEnter={onMouseEnter}
                            onRestartNeeded={onRestartNeeded}
                            disabled={true}
                            plugin={p}
                            isNew={newPlugins.includes(p.name)}
                        />
                    )}
                </Tooltip>
            );
        } else {
            pluginCards.push(
                <PluginCard
                    onRestartNeeded={onRestartNeeded}
                    disabled={false}
                    plugin={p}
                    key={p.name}
                    isNew={newPlugins.includes(p.name)}
                />
            );
        }
    }

    const totalCount = pluginCards.length + requiredPluginCards.length;
    const hasContent = commits.length > 0 || totalCount > 0;

    const handleContinue = async () => {
        await Promise.all([updateKnownPlugins(), updateKnownSettings(), setLastSeenHash(gitHash)]);
        if (changes.hasChanges) {
            location.reload();
        } else {
            modalProps.onClose();
        }
    };

    return (
        <Modal
            {...modalProps}
            size="md"
            title={
                <div className={cl("header")}>
                    <div className={cl("logo")}>S</div>
                    <div className={cl("header-content")}>
                        <BaseText size="lg" weight="semibold" className={cl("title")}>
                            What's new in Slipcord
                        </BaseText>
                        <code className={cl("build")}>{gitHash.slice(0, 7)}</code>
                    </div>
                </div>
            }
            subtitle={
                <>
                    <BaseText size="sm" className={cl("description")}>
                        Here's what changed since your last update.
                    </BaseText>
                    <br />
                    <Notice.Info className={cl("notice")}>
                        Slipcord is Open Source Software. If you enjoy using it, consider supporting us <Link href="https://github.com/sponsors/thororen1234" target="_blank" rel="noopener noreferrer">here</Link>.
                    </Notice.Info>
                </>
            }
            actions={[
                {
                    text: "Don't show this again",
                    onClick: () => {
                        Settings.plugins.NewPluginsManager.enabled = !settings?.plugins?.NewPluginsManager?.enabled;
                    },
                    variant: "secondary"
                },
                {
                    text: changes.hasChanges ? "Restart" : "Continue",
                    onClick: handleContinue,
                    variant: "primary"
                }
            ]}
        >
            <div className={cl("summary")}>
                <div className={cl("chip")}>
                    <span className={cl("chip-count")}>{commits.length}</span>
                    <span className={cl("chip-label")}>Changes</span>
                </div>
                <div className={cl("chip")}>
                    <span className={cl("chip-count")}>{newPlugins.length}</span>
                    <span className={cl("chip-label")}>New plugins</span>
                </div>
                <div className={cl("chip")}>
                    <span className={cl("chip-count")}>{newSettings.size}</span>
                    <span className={cl("chip-label")}>New settings</span>
                </div>
            </div>

            <div className={cl("content")}>
                {commits.length > 0 && (
                    <section>
                        <div className={cl("section-title")}>Recent changes</div>
                        <div className={cl("commits")}>
                            {commits.map(commit => (
                                <div className={cl("commit")} key={commit.hash}>
                                    <code className={cl("commit-hash")}>
                                        <HashLink repo={`https://github.com/${repoSlug}`} hash={commit.hash} />
                                    </code>
                                    <span className={cl("commit-msg")}>{commit.message}</span>
                                    <span className={cl("commit-meta")}>
                                        {commit.author}{commit.timestamp ? ` · ${formatTimestamp(commit.timestamp)}` : ""}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {totalCount > 0 && (
                    <section>
                        <div className={cl("section-title")}>New plugins and settings</div>
                        <div className={cl("grid")}>
                            {pluginCards}
                            {requiredPluginCards}
                        </div>
                    </section>
                )}

                {newSettings.size > 0 && (
                    <div className={cl("settings")}>
                        {[...newSettings.entries()].map(([plugin, settingNames]) => (
                            <span className={cl("setting-chip")} key={plugin}>
                                <strong>{Plugins[plugin]?.name ?? plugin}:</strong> {settingNames.join(", ")}
                            </span>
                        ))}
                    </div>
                )}

                {!hasContent && (
                    <span className={cl("empty")}>
                        Slipcord will let you know here whenever something new drops. You're all caught up!
                    </span>
                )}
            </div>
        </Modal>
    );
}

export async function openNewPluginsModal() {
    try {
        await initializeChangelog();
    } catch { }

    const [newPlugins, newSettings, repoRaw] = await Promise.all([
        getNewPlugins().catch(() => []),
        getNewSettings().catch(() => new Map<string, string[]>()),
        (async () => {
            try {
                return await getRepo();
            } catch {
                return "";
            }
        })()
    ]);

    const repoSlug = getRepoSlug(repoRaw || "https://github.com/slipcords/Slipcord");
    const commits = await getCommitsSinceLastSeen(`https://github.com/${repoSlug}`).catch(() => []);

    if ((commits.length > 0 || newPlugins.length > 0 || newSettings.size > 0) && !hasSeen) {
        hasSeen = true;
        const modalKey = openModal(modalProps => (
            <ErrorBoundary noop onError={() => closeModal(modalKey)}>
                <NewPluginsModal
                    modalProps={modalProps}
                    commits={commits}
                    newPlugins={newPlugins}
                    newSettings={newSettings}
                    repoSlug={repoSlug}
                />
            </ErrorBoundary>
        ));
    }
}
