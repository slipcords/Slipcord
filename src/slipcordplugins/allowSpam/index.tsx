/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SlipcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "allowSpam",
    description: "removes the client-side rate limit on sending messages",
    authors: [SlipcordDevs.Superior],
    patches: [
        {
            find: "cancelQueueMetricTimers",
            replacement: {
                match: /this\.maxSize=[a-zA-Z]+,/,
                replace: "this.maxSize=Number.MAX_SAFE_INTEGER,"
            }
        }
    ]
});
