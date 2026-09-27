/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { openNewPluginsModal } from "./NewPluginsModal";

export default definePlugin({
    name: "NewPluginsManager",
    description: "Notifies you about new updates to Slipcord, including new plugins, settings and changes",
    tags: ["Utility"],
    authors: [Devs.Sqaaakoi],
    enabledByDefault: true,
    flux: {
        async POST_CONNECTION_OPEN() {
            await openNewPluginsModal();
        }
    },
    openNewPluginsModal
});
