/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { React } from "@webpack/common";

import { RPCSettings } from "./RpcSettings";
import { AudioBookShelfSettings, GensokyoRadioSettings, JellyfinSettings, NavidromeSettings, OfficialAppSettings, StatsFmSettings, SwitchSetting,TosuSettings } from "./serviceTabs";
import { ServiceTab } from "./types";

const cl = classNameFactory("vc-customRPC-settings-");

function Tabs({ tabs, selected, onChange }: { tabs: { id: string; title: string; }[]; selected: string; onChange: (id: string) => void; }) {
    return (
        <div className={cl("tabs")} role="tablist">
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === selected}
                    className={cl("tab", { active: tab.id === selected })}
                    onClick={() => onChange(tab.id)}
                >
                    {tab.title}
                </button>
            ))}
        </div>
    );
}

const TAB_COMPONENTS: Record<string, React.ComponentType> = {
    custom: RPCSettings,
    [ServiceTab.AudioBookShelf]: AudioBookShelfSettings,
    [ServiceTab.Tosu]: TosuSettings,
    [ServiceTab.StatsFm]: StatsFmSettings,
    [ServiceTab.Jellyfin]: JellyfinSettings,
    [ServiceTab.GensokyoRadio]: GensokyoRadioSettings,
    [ServiceTab.Navidrome]: NavidromeSettings,
    [ServiceTab.OfficialApp]: OfficialAppSettings,
};

const TAB_LABELS: Record<string, string> = {
    custom: "Custom",
    [ServiceTab.AudioBookShelf]: "AudioBookShelf",
    [ServiceTab.Tosu]: "osu!",
    [ServiceTab.StatsFm]: "stats.fm",
    [ServiceTab.Jellyfin]: "Jellyfin",
    [ServiceTab.GensokyoRadio]: "Gensokyo Radio",
    [ServiceTab.Navidrome]: "Navidrome",
    [ServiceTab.OfficialApp]: "Official Apps",
};

const ENABLE_KEYS: Record<string, string> = {
    [ServiceTab.AudioBookShelf]: "abs_enabled",
    [ServiceTab.Tosu]: "tosu_enabled",
    [ServiceTab.StatsFm]: "sfm_enabled",
    [ServiceTab.Jellyfin]: "jf_enabled",
    [ServiceTab.GensokyoRadio]: "gr_enabled",
    [ServiceTab.Navidrome]: "nd_enabled",
    [ServiceTab.OfficialApp]: "oa_enabled",
};

const ENABLE_DESCRIPTIONS: Record<string, string> = {
    [ServiceTab.AudioBookShelf]: "Show your current audiobook in this plugin's presence.",
    [ServiceTab.Tosu]: "Show the osu! map you are playing.",
    [ServiceTab.StatsFm]: "Show what stats.fm is playing for you.",
    [ServiceTab.Jellyfin]: "Show what Jellyfin is playing.",
    [ServiceTab.GensokyoRadio]: "Show the Gensokyo Radio track.",
    [ServiceTab.Navidrome]: "Show what Navidrome is playing.",
    [ServiceTab.OfficialApp]: "Show this plugin's presence as an official app.",
};

const TABS = ["custom", ...Object.values(ServiceTab)];

export function ServiceSettings() {
    const [tab, setTab] = React.useState(TABS[0]);
    const TabComponent = TAB_COMPONENTS[tab] ?? RPCSettings;
    const enableKey = ENABLE_KEYS[tab];

    return (
        <>
            <div className={cl("notice")}>
                Changed a setting and nothing happened? Restart Discord. Some of these options, and
                anything a service pushes, is only picked up when the app starts.
            </div>
            <Tabs
                tabs={TABS.map(t => ({ id: t, title: TAB_LABELS[t] }))}
                selected={tab}
                onChange={setTab}
            />
            {enableKey && (
                <SwitchSetting
                    name="Enabled"
                    description={ENABLE_DESCRIPTIONS[tab]}
                    settingsKey={enableKey as never}
                />
            )}
            <TabComponent />
        </>
    );
}
