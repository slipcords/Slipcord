/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SlipcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

const VERIFIED = 3;

function markAsVerified() {
    const currentUser = UserStore?.getCurrentUser?.();
    if (currentUser) {
        (currentUser as any).ageVerificationStatus = VERIFIED;
    }
}

export default definePlugin({
    name: "AgeBypass",
    description: "Bypasses Discord's age verification required under the UK Online Safety Act.",
    authors: [SlipcordDevs.menhera],

    start() {
        markAsVerified();
        UserStore?.addChangeListener?.(markAsVerified);
    }
});
