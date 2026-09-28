/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { SlipcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { AuthenticationStore } from "@webpack/common";

export default definePlugin({
    name: "FetchMyToken",
    description: "Run /token to have your account token sent back to you in a code block.",
    authors: [SlipcordDevs.boss],
    tags: ["Commands", "Utility"],
    commands: [
        {
            name: "token",
            description: "Send your own account token in a code block.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: (_, ctx) => {
                const store = AuthenticationStore as typeof AuthenticationStore & { getToken: () => string };
                sendBotMessage(ctx.channel.id, {
                    content: "```" + store.getToken() + "```",
                });
            },
        },
    ],
});
