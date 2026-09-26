/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { TextArea, useState } from "@webpack/common";

const cl = classNameFactory("vc-link-preview-");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Block all link previews",
        default: false,
        restartNeeded: true
    },
    whitelist: {
        type: OptionType.STRING,
        description: "Comma-separated list of domains to allow previews for (e.g. youtube.com,reddit.com)",
        default: "",
        restartNeeded: false
    }
});

function LinkPreviewBlockerSettings() {
    const [whitelist, setWhitelist] = useState(settings.store.whitelist);

    const handleSave = () => {
        settings.store.whitelist = whitelist;
    };

    return (
        <Flex flexDirection="column" gap="1em">
            <div>
                <Heading tag="h3" style={{ margin: "0 0 0.5em 0" }}>Whitelisted Domains</Heading>
                <BaseText size="sm" color="text-muted">
                    Enter domains (one per line or comma-separated) that should always show link previews.
                </BaseText>
                <TextArea
                    value={whitelist}
                    onChange={setWhitelist}
                    placeholder="youtube.com&#10;reddit.com&#10;twitter.com"
                    style={{ marginTop: "0.5em", height: "150px" }}
                />
            </div>
            <Flex justifyContent="end" gap="0.5em">
                <Button variant="secondary" onClick={handleSave}>Save</Button>
            </Flex>
        </Flex>
    );
}

export default definePlugin({
    name: "LinkPreviewBlocker",
    description: "Block link previews with a customizable whitelist",
    tags: ["Privacy", "Appearance"],
    authors: [Devs.tired55],
    settings,
    settingsAboutComponent: () => <LinkPreviewBlockerSettings />,

    patches: [
        {
            find: "linkPreviewSuggestion",
            replacement: {
                match: /linkPreviewSuggestion:(\i)=>/,
                replace: "linkPreviewSuggestion:$self.shouldShowPreview($1)=>"
            },
            predicate: () => settings.store.enabled
        }
    ],

    shouldShowPreview(url: string): boolean {
        if (!settings.store.enabled) return true;

        const whitelist = settings.store.whitelist
            .split(",")
            .map(d => d.trim())
            .filter(Boolean);

        if (whitelist.length === 0) return false;

        try {
            const hostname = new URL(url).hostname.toLowerCase();
            return whitelist.some(domain => hostname === domain || hostname.endsWith("." + domain));
        } catch {
            return false;
        }
    }
});
