/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { onPresencesChanged } from "./presence";

/**
 * Re-renders when presences are added, edited or removed. The lists live outside the
 * settings store, so components have to subscribe to them explicitly.
 */
export function usePresencesVersion() {
    const [version, setVersion] = useState(0);

    useEffect(() => onPresencesChanged(() => setVersion(v => v + 1)), []);

    return version;
}
