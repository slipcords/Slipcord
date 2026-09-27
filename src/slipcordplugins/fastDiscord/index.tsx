/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * nightcord, a Discord client mod
 * Plugin: FastDiscord
 * Disabled by default. Once enabled, maximizes performance:
 * animations, media, cache, background FPS, and network
 * (presence/typing) are all optimized. Disabling restores everything to normal.
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { SlipcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { isObject } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findAll } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const log = new Logger("FastDiscord");

/* -------------------------------------------------------------------------- */
/*                              Spring / animations                           */
/* -------------------------------------------------------------------------- */

interface SpringModule {
    Globals: {
        assign(options: { skipAnimation: boolean; }): void;
    };
    Springs: object;
}

let springs: SpringModule[] = [];
let started = false;

const isSpringGlobals = (v: unknown): v is SpringModule["Globals"] =>
    isObject(v) && "assign" in v && typeof (v as any).assign === "function";

const isSpringModule = (v: unknown): v is SpringModule => {
    if (!isObject(v)) return false;
    const m = v as Partial<SpringModule>;
    return isSpringGlobals(m.Globals) && isObject(m.Springs);
};

function loadSprings() {
    springs = findAll(isSpringModule);
}

function applySpringSkip(skip: boolean) {
    for (const s of springs) {
        try { s.Globals.assign({ skipAnimation: skip }); } catch (err) { log.warn("spring skip failed", err); }
    }
}

/* -------------------------------------------------------------------------- */
/*                                  CSS layer                                 */
/* -------------------------------------------------------------------------- */

const CSS_ID = "fastdiscord-css";

function buildCss(): string {
    const s = settings.store;
    let css = "";

    css += `
body.fastdiscord-bg-mode * {
    animation-play-state: paused !important;
}
`;

    if (s.noAnimatedEmoji) {
        css += `
[class*="emoji"][class*="animated"],
img[class*="emoji"][src*="gif"] {
    animation: none !important;
}
`;
    }

    if (s.noStickers) {
        css += `
[class*="sticker"][class*="lottie"],
[class*="stickerAsset"][class*="animated"] {
    visibility: hidden !important;
}
`;
    }

    if (s.noActivities) {
        css += `
[class*="activity"],
[class*="activityText"],
[class*="Game"] {
    display: none !important;
}
`;
    }

    if (s.noSoundboardPreview) {
        css += `
[class*="soundboardEmoji"]:hover [class*="soundWave"],
[class*="soundboardEmoji"] [class*="soundWave"] {
    animation: none !important;
    opacity: 0 !important;
}
`;
    }

    if (s.reduceBlurEffects) {
        css += `
[class*="backdropFilter"],
[style*="backdrop-filter"] {
    backdrop-filter: none !important;
}
[class*="acrylic"] {
    background-color: var(--background-secondary) !important;
}
`;
    }

    if (s.disableHoverTransitions) {
        css += `
[class*="button_"],
[class*="clickable_"],
[class*="wrapper_"] {
    transition-duration: 0.001s !important;
}
`;
    }

    return css.trim();
}

function injectCss() {
    const css = buildCss();
    let el = document.getElementById(CSS_ID) as HTMLStyleElement | null;
    if (!css) { el?.remove(); return; }
    if (!el) { el = document.createElement("style"); el.id = CSS_ID; document.head?.appendChild(el); }
    el.textContent = css;
}

function removeCss() {
    document.getElementById(CSS_ID)?.remove();
    document.body.classList.remove("fastdiscord-bg-mode");
}

/* -------------------------------------------------------------------------- */
/*                          Cache cleaner (low-end mode)                      */
/*                                                                            */
/* IMPORTANT: We do NOT touch MessageStore._channelMessages directly because  */
/* MessageLoggerEnhanced monkey-patches MessageStore.getMessage and maintains  */
/* its own cache (combinedMessageCache). Deleting raw store entries bypasses   */
/* this patch → stale references → crash on DM load.                          */
/*                                                                            */
/* Instead, we only force the native GC, which is sufficient to free memory   */
/* without corrupting the internal state of the stores.                       */
/* -------------------------------------------------------------------------- */

let cacheCleanerInterval: ReturnType<typeof setInterval> | null = null;

function forceGC() {
    try {
        if (typeof (window as any).gc === "function") {
            if ("requestIdleCallback" in window) {
                (window as any).requestIdleCallback(() => {
                    try { (window as any).gc(); } catch { }
                }, { timeout: 2000 });
            } else {
                (window as any).gc();
            }
        }
    } catch { }
}

function cacheCleanIntervalMs(): number {
    return settings.store.lowEndMode ? 90 * 1000 : 5 * 60 * 1000;
}

function startCacheCleaner() {
    stopCacheCleaner();
    cacheCleanerInterval = setInterval(() => {
        if (!settings.store.limitMsgCache) return;
        forceGC();
    }, cacheCleanIntervalMs());
}

function stopCacheCleaner() {
    if (cacheCleanerInterval !== null) {
        clearInterval(cacheCleanerInterval);
        cacheCleanerInterval = null;
    }
}

/* -------------------------------------------------------------------------- */
/*                       Safe Background Throttling                           */
/* -------------------------------------------------------------------------- */

let bgFpsActive = false;

function onVisibilityChange() {
    if (document.hidden) {
        document.body.classList.add("fastdiscord-bg-mode");
    } else if (document.hasFocus()) {
        document.body.classList.remove("fastdiscord-bg-mode");
    }
}

function onWindowBlur() {
    document.body.classList.add("fastdiscord-bg-mode");
}

function onWindowFocus() {
    if (!document.hidden) {
        document.body.classList.remove("fastdiscord-bg-mode");
    }
}

function applyBgFpsPatch(enable: boolean) {
    if (enable && !bgFpsActive) {
        bgFpsActive = true;
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);
        if (document.hidden || !document.hasFocus()) {
            document.body.classList.add("fastdiscord-bg-mode");
        }
    } else if (!enable && bgFpsActive) {
        bgFpsActive = false;
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        document.body.classList.remove("fastdiscord-bg-mode");
    }
}

/* -------------------------------------------------------------------------- */
/*                  Network: debounce presence updates                         */
/* -------------------------------------------------------------------------- */

const PRESENCE_DISPATCH_TYPES = new Set([
    "LOCAL_ACTIVITY_UPDATE",
    "RUNNING_GAMES_CHANGE",
]);

let origFluxDispatch: ((event: any) => unknown) | null = null;
const pendingPresenceDispatch = new Map<string, { event: any; timer: ReturnType<typeof setTimeout>; }>();

function presenceDebounceMs(): number {
    return 8000;
}

function flushPresenceDispatch(type: string) {
    const pending = pendingPresenceDispatch.get(type);
    if (!pending) return;
    pendingPresenceDispatch.delete(type);
    try {
        origFluxDispatch?.call(FluxDispatcher, pending.event);
    } catch (err) {
        log.warn("flush presence dispatch failed", err);
    }
}

function patchedDispatch(event: any) {
    if (!settings.store.throttlePresence || !event || !PRESENCE_DISPATCH_TYPES.has(event.type)) {
        return origFluxDispatch?.call(FluxDispatcher, event);
    }

    // Never throttle activity clearance (stopping/pausing track, disabling rich presence, removing activity)
    if (event.type === "LOCAL_ACTIVITY_UPDATE" && !event.activity) {
        const existing = pendingPresenceDispatch.get(event.type);
        if (existing) {
            clearTimeout(existing.timer);
            pendingPresenceDispatch.delete(event.type);
        }
        return origFluxDispatch?.call(FluxDispatcher, event);
    }

    const existing = pendingPresenceDispatch.get(event.type);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => flushPresenceDispatch(event.type), presenceDebounceMs());
    pendingPresenceDispatch.set(event.type, { event, timer });
}

function applyPresenceThrottle(enable: boolean) {
    if (enable && !origFluxDispatch) {
        origFluxDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);
        (FluxDispatcher as any).dispatch = patchedDispatch;
    } else if (!enable && origFluxDispatch) {
        for (const type of Array.from(pendingPresenceDispatch.keys())) {
            const pending = pendingPresenceDispatch.get(type)!;
            clearTimeout(pending.timer);
            try { origFluxDispatch.call(FluxDispatcher, pending.event); } catch { }
        }
        pendingPresenceDispatch.clear();
        (FluxDispatcher as any).dispatch = origFluxDispatch;
        origFluxDispatch = null;
    }
}

/* -------------------------------------------------------------------------- */
/*                                  Settings                                  */
/* -------------------------------------------------------------------------- */

const settings = definePluginSettings({
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: "Disable spring animations in the UI (buttons, modals, transitions)",
        default: true,
        disabled: () => isPluginEnabled("DisableAnimations"),
        onChange(val: boolean) {
            if (!started) return;
            if (val && springs.length === 0) loadSprings();
            applySpringSkip(val);
        }
    },
    disableTypingDots: {
        type: OptionType.BOOLEAN,
        description: "Hide the \"X is typing...\" dots on screen (visual only)",
        default: true,
        disabled: () => isPluginEnabled("NoTypingAnimation"),
        restartNeeded: false
    },
    noGifAvatars: {
        type: OptionType.BOOLEAN,
        description: "Block animated GIF avatars in lists and messages (via CSS)",
        default: true,
        onChange() { if (started) injectCss(); }
    },
    noAnimatedEmoji: {
        type: OptionType.BOOLEAN,
        description: "Disable Discord emoji animations",
        default: false,
        onChange() { if (started) injectCss(); }
    },
    noStickers: {
        type: OptionType.BOOLEAN,
        description: "Prevent Lottie animated stickers from autoplaying",
        default: false,
        restartNeeded: false
    },
    noActivities: {
        type: OptionType.BOOLEAN,
        description: "Hide the Activities section (games, Spotify, etc.) in the members panel",
        default: false,
        onChange() { if (started) injectCss(); }
    },
    noVideoAutoplay: {
        type: OptionType.BOOLEAN,
        description: "Block autoplay of embedded videos in messages",
        default: false,
        restartNeeded: false
    },
    noSoundboardPreview: {
        type: OptionType.BOOLEAN,
        description: "Disable soundboard audio preview on hover",
        default: true,
        restartNeeded: false
    },
    reduceBlurEffects: {
        type: OptionType.BOOLEAN,
        description: "Disable expensive blur effects (backdrop-filter) for better performance",
        default: true,
        onChange() { if (started) injectCss(); }
    },
    disableHoverTransitions: {
        type: OptionType.BOOLEAN,
        description: "Make all CSS hover transitions instant",
        default: false,
        onChange() { if (started) injectCss(); }
    },
    limitMsgCache: {
        type: OptionType.BOOLEAN,
        description: "Periodically call the native GC to free message memory",
        default: true,
        onChange(v: boolean) { if (!started) return; if (!v) stopCacheCleaner(); else startCacheCleaner(); }
    },
    reduceFpsBackground: {
        type: OptionType.BOOLEAN,
        description: "Limit app rendering to a few FPS when the window is in the background",
        default: true,
        onChange(v: boolean) { if (started) applyBgFpsPatch(v); }
    },
    throttlePresence: {
        type: OptionType.BOOLEAN,
        description: "Reduce how often presence/activity updates (game, Spotify) are sent to the server, saving network requests. Your status will be less up-to-date for others.",
        default: false,
        onChange(v: boolean) { if (started) applyPresenceThrottle(v); }
    },
    lowEndMode: {
        type: OptionType.BOOLEAN,
        description: "Low-end PC mode: more frequent GC and lower background FPS",
        default: false,
        onChange(_v: boolean) {
            if (!started) return;
            if (settings.store.limitMsgCache) startCacheCleaner();
            if (bgFpsActive) { applyBgFpsPatch(false); applyBgFpsPatch(true); }
        }
    },
});

/* -------------------------------------------------------------------------- */
/*                                   Plugin                                   */
/* -------------------------------------------------------------------------- */

export default definePlugin({
    name: "FastDiscord",
    description: "Maximizes app smoothness and responsiveness: animations, media, memory cache, background FPS, and network (presence) are all optimized. Disabled by default; everything returns to normal once disabled.",
    authors: [SlipcordDevs.Snayz],
    tags: ["Utility", "Appearance"],
    searchTerms: ["performance", "optimization", "lag", "fps", "ram", "memory", "low-end", "fluide", "rapide", "latence"],
    settings,

    patches: [
        // Disable "X is typing..." dots — patch targeting only the animation
        {
            find: "dotCycle",
            predicate: () => settings.store.disableTypingDots && !isPluginEnabled("NoTypingAnimation"),
            replacement: {
                match: /focused:(\i)/g,
                replace: (_, focused) => `_focused:${focused}=false`
            }
        },
        // Disable video autoplay — strict regex to avoid touching other modules
        {
            find: "autoplay:!0",
            predicate: () => settings.store.noVideoAutoplay,
            replacement: {
                match: /autoplay:!0/g,
                replace: "autoplay:!1"
            }
        },
        // Static avatars instead of GIF
        {
            find: /getUserAvatarURL.{0,80}animated/,
            predicate: () => settings.store.noGifAvatars,
            replacement: {
                match: /(animated\s*(?:&&|=).*?)(true)/,
                replace: (_, pre) => `${pre}false`
            }
        },
        // Disable soundboard preview on hover
        {
            find: "soundboard_sound_hover",
            predicate: () => settings.store.noSoundboardPreview,
            replacement: {
                match: /onMouseEnter:\s*\(\)\s*=>\s*\{[^}]*play[^}]*\}/,
                replace: "onMouseEnter:()=>{}"
            }
        },
        // Disable animated Lottie stickers
        {
            find: /StickerType\.STANDARD/,
            predicate: () => settings.store.noStickers,
            replacement: {
                match: /shouldAnimate:!0/g,
                replace: "shouldAnimate:!1"
            }
        },
    ],

    start() {
        started = true;

        if (settings.store.disableSpringAnimations && !isPluginEnabled("DisableAnimations")) {
            loadSprings();
            applySpringSkip(true);
        }

        injectCss();

        if (settings.store.limitMsgCache) startCacheCleaner();
        if (settings.store.reduceFpsBackground) applyBgFpsPatch(true);
        if (settings.store.throttlePresence) applyPresenceThrottle(true);

        log.info("FastDiscord enabled: applying optimizations.");
    },

    stop() {
        started = false;

        if (springs.length !== 0 && !isPluginEnabled("DisableAnimations")) {
            applySpringSkip(false);
        }
        springs = [];

        removeCss();
        stopCacheCleaner();
        applyBgFpsPatch(false);
        applyPresenceThrottle(false);

        log.info("FastDiscord disabled: everything restored to normal.");
    }
});
