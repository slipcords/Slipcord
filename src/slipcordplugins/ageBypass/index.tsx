/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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
    authors: [{ name: "Menhera.st Team", id: 1325012503419420734n }],

    start() {
        markAsVerified();
        UserStore?.addChangeListener?.(markAsVerified);
    }
});
