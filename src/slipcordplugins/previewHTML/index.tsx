/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { definePluginSettings } from "@api/Settings";
import { SlipcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

// Nightcord's autoTranslate helper, kept as an identity function since Slipcord has no translation layer
const t = (text: string) => text;

// ── Settings ───────────────────────────────────────────────────────────────────

export const settings = definePluginSettings({
    autoExpand: {
        type: OptionType.BOOLEAN,
        description: "Automatically expand HTML previews (off by default)",
        default: false,
    },
    defaultScale: {
        type: OptionType.SELECT,
        description: "Default HTML preview zoom scale",
        options: [
            { label: "100% (Native 1:1 Responsive)", value: 1.0, default: true },
            { label: "75% (Comfortable)", value: 0.75 },
            { label: "50% (Full Desktop Miniature)", value: 0.5 },
        ],
        default: 1.0,
    },
    defaultHeight: {
        type: OptionType.SELECT,
        description: "Default HTML frame height",
        options: [
            { label: "Compact (300px)", value: 300 },
            { label: "Medium (420px)", value: 420, default: true },
            { label: "Large (560px)", value: 560 },
        ],
        default: 420,
    },
    maxPreviewsPerMessage: {
        type: OptionType.SELECT,
        description: "Maximum HTML previews to display per message",
        options: [
            { label: "MAX (All HTML)", value: 0, default: true },
            { label: "1 preview", value: 1 },
            { label: "2 previews", value: 2 },
            { label: "3 previews", value: 3 },
            { label: "5 previews", value: 5 },
        ],
        default: 0,
    },
    allowScripts: {
        type: OptionType.BOOLEAN,
        description: "Allow interactive JavaScript execution inside the HTML preview sandbox",
        default: true,
    },
});

interface HtmlItem {
    url: string;
    name: string;
    size?: string;
}

function formatBytes(bytes?: number): string {
    if (!bytes || isNaN(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
}

function extractHtmlItems(message: any): HtmlItem[] {
    const items: HtmlItem[] = [];
    const seenUrls = new Set<string>();

    // 1. Check attachments
    if (Array.isArray(message?.attachments)) {
        for (const att of message.attachments) {
            const filename = (att.filename || "").toLowerCase();
            const contentType = (att.content_type || "").toLowerCase();
            if (filename.endsWith(".html") || filename.endsWith(".htm") || contentType === "text/html") {
                const url = att.url || att.proxy_url;
                if (url && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    items.push({
                        url,
                        name: att.filename || "page.html",
                        size: formatBytes(att.size),
                    });
                }
            }
        }
    }

    // 2. Check message content URLs
    const content = message?.content || "";
    const urlRegex = /https?:\/\/[^\s<>"`{}|\\^]+/gi;
    const matches = content.match(urlRegex) || [];

    for (let rawUrl of matches) {
        rawUrl = rawUrl.replace(/[.,!?;:)>\]]+$/, "");
        try {
            const parsed = new URL(rawUrl);
            const path = parsed.pathname.toLowerCase();
            if (path.endsWith(".html") || path.endsWith(".htm")) {
                if (!seenUrls.has(rawUrl)) {
                    seenUrls.add(rawUrl);
                    const name = decodeURIComponent(parsed.pathname.split("/").pop() || "page.html");
                    items.push({
                        url: rawUrl,
                        name,
                    });
                }
            }
        } catch { }
    }

    const limit = Number(settings.store.maxPreviewsPerMessage);
    return (limit && limit > 0) ? items.slice(0, limit) : items;
}

function injectScrollbarStyle(rawHtml: string): string {
    const scrollbarStyle = `
<style id="nightcord-preview-scrollbar">
    html, body {
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    }
    ::-webkit-scrollbar {
        width: 8px !important;
        height: 8px !important;
        background: transparent !important;
    }
    ::-webkit-scrollbar-track {
        background: transparent !important;
    }
    ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2) !important;
        border-radius: 4px !important;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.35) !important;
    }
    ::-webkit-scrollbar-corner {
        background: transparent !important;
    }
</style>
`;
    if (rawHtml.includes("</head>")) {
        return rawHtml.replace("</head>", `${scrollbarStyle}</head>`);
    } else if (rawHtml.includes("<body")) {
        return `${scrollbarStyle}${rawHtml}`;
    }
    return `${scrollbarStyle}${rawHtml}`;
}

// ── Single HTML Preview Card ──────────────────────────────────────────────────

function HtmlCard({ item }: { item: HtmlItem; }) {
    const [isExpanded, setIsExpanded] = React.useState(settings.store.autoExpand);
    const [heightMode, setHeightMode] = React.useState<"normal" | "tall">("normal");
    const [scaleMode, setScaleMode] = React.useState<number>(Number(settings.store.defaultScale) || 1.0);
    const [isLoading, setIsLoading] = React.useState(false);
    const [htmlDoc, setHtmlDoc] = React.useState<string | null>(null);
    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
    const [reloadKey, setReloadKey] = React.useState(0);

    const baseHeight = Number(settings.store.defaultHeight) || 420;
    const currentHeight = heightMode === "tall" ? baseHeight + 200 : baseHeight;

    const isScaled = scaleMode < 1.0;
    const virtualWidth = isScaled ? Math.round(620 / scaleMode) : "100%";
    const virtualHeight = isScaled ? Math.round(currentHeight / scaleMode) : "100%";

    const sandboxFlags = settings.store.allowScripts
        ? "allow-scripts allow-forms allow-same-origin allow-popups"
        : "allow-forms allow-same-origin";

    React.useEffect(() => {
        if (!isExpanded) return;
        let active = true;
        setIsLoading(true);
        setErrorMsg(null);

        (async () => {
            const urlsToTry = [
                item.url,
                item.url.replace("cdn.discordapp.com", "media.discordapp.net"),
            ];

            let text: string | null = null;

            // Try 1: fetch
            for (const u of urlsToTry) {
                try {
                    const res = await fetch(u, { mode: "cors", credentials: "omit" });
                    if (res.ok) {
                        text = await res.text();
                        break;
                    }
                } catch { }
            }

            // Try 2: XHR
            if (!text) {
                for (const u of urlsToTry) {
                    try {
                        text = await new Promise<string>((resolve, reject) => {
                            const xhr = new XMLHttpRequest();
                            xhr.open("GET", u, true);
                            xhr.responseType = "text";
                            xhr.onload = () => {
                                if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
                                else reject(new Error(`XHR ${xhr.status}`));
                            };
                            xhr.onerror = () => reject(new Error("XHR Error"));
                            xhr.send();
                        });
                        break;
                    } catch { }
                }
            }

            if (!active) return;
            if (text !== null) {
                setHtmlDoc(injectScrollbarStyle(text));
                setIsLoading(false);
            } else {
                setErrorMsg("Failed to load HTML content");
                setIsLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [isExpanded, item.url, reloadKey]);

    const handleToggle = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsExpanded(!isExpanded);
    };

    const cycleScale = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (scaleMode <= 0.5) setScaleMode(0.75);
        else if (scaleMode <= 0.75) setScaleMode(1.0);
        else setScaleMode(0.5);
    };

    return (
        <div
            className={`phtml-card ${isExpanded ? "phtml-card-expanded" : "phtml-card-collapsed"}`}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            {/* Header */}
            <div
                className="phtml-header"
                onClick={handleToggle}
                title={isExpanded ? t("Click to collapse preview") : t("Click to preview HTML")}
            >
                <div className="phtml-header-left">
                    <span className="phtml-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="16 18 22 12 16 6" />
                            <polyline points="8 6 2 12 8 18" />
                        </svg>
                        HTML
                    </span>
                    <span className="phtml-filename">{item.name}</span>
                    {item.size && <span className="phtml-size">({item.size})</span>}
                    {!isExpanded && (
                        <span className="phtml-expand-hint">{t("Click to preview")}</span>
                    )}
                </div>

                <div className="phtml-controls" onClick={e => e.stopPropagation()}>
                    {/* Zoom / Scale Toggle */}
                    {isExpanded && (
                        <button
                            className="phtml-btn phtml-scale-badge"
                            onClick={cycleScale}
                            title={`${t("Scale")}: ${Math.round(scaleMode * 100)}% — ${t("Click to change zoom")}`}
                        >
                            <span>{Math.round(scaleMode * 100)}%</span>
                        </button>
                    )}

                    {/* Expand/Shrink Height */}
                    {isExpanded && (
                        <button
                            className={`phtml-btn ${heightMode === "tall" ? "phtml-btn-active" : ""}`}
                            onClick={e => {
                                e.stopPropagation();
                                setHeightMode(heightMode === "normal" ? "tall" : "normal");
                            }}
                            title={heightMode === "normal" ? t("Expand height") : t("Shrink height")}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                {heightMode === "normal" ? (
                                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                                ) : (
                                    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14L3 21" />
                                )}
                            </svg>
                        </button>
                    )}

                    {/* Refresh */}
                    {isExpanded && (
                        <button
                            className="phtml-btn"
                            onClick={e => {
                                e.stopPropagation();
                                setReloadKey(k => k + 1);
                            }}
                            title={t("Reload preview")}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                            </svg>
                        </button>
                    )}

                    {/* Open in external browser */}
                    <button
                        className="phtml-btn"
                        onClick={e => {
                            e.stopPropagation();
                            window.open(item.url, "_blank", "noopener,noreferrer");
                        }}
                        title={t("Open in external browser")}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                    </button>

                    {/* Toggle Chevron */}
                    <button
                        className="phtml-btn"
                        onClick={handleToggle}
                        title={isExpanded ? t("Collapse") : t("Expand")}
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            style={{
                                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                transition: "transform 0.2s ease"
                            }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Viewport */}
            {isExpanded && (
                <div className="phtml-viewport-wrapper" style={{ height: `${currentHeight}px` }}>
                    {isLoading && (
                        <div className="phtml-loading-overlay">
                            <div className="phtml-spinner" />
                            <span>{t("Loading HTML preview...")}</span>
                        </div>
                    )}
                    {errorMsg && (
                        <div className="phtml-loading-overlay" style={{ color: "var(--status-danger, #ed4245)" }}>
                            <span>{errorMsg}</span>
                        </div>
                    )}
                    {htmlDoc !== null && (
                        <div
                            className="phtml-scaler"
                            style={{
                                width: typeof virtualWidth === "number" ? `${virtualWidth}px` : virtualWidth,
                                height: typeof virtualHeight === "number" ? `${virtualHeight}px` : virtualHeight,
                                transform: isScaled ? `scale(${scaleMode})` : "none",
                                transformOrigin: "0 0",
                            }}
                        >
                            <iframe
                                key={reloadKey}
                                className="phtml-iframe"
                                srcDoc={htmlDoc}
                                sandbox={sandboxFlags}
                                loading="lazy"
                                title={item.name}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Message Accessory Component ────────────────────────────────────────────────

function HtmlPreviewAccessory({ message }: { message: any; }) {
    const items = React.useMemo(() => {
        return extractHtmlItems(message);
    }, [message?.content, message?.attachments]);

    if (!items || items.length === 0) return null;

    return (
        <div className="phtml-container" onClick={e => e.stopPropagation()}>
            {items.map(item => (
                <HtmlCard key={item.url} item={item} />
            ))}
        </div>
    );
}

// ── Plugin Definition ──────────────────────────────────────────────────────────

const ACCESSORY_ID = "nightcord-html-preview";

export default definePlugin({
    name: "PreviewHTML",
    description: "Displays a live, interactive and sandboxed preview of HTML files and pages directly below links and attachments in chat.",
    authors: [SlipcordDevs.nightcord],
    settings,

    start() {
        addMessageAccessory(ACCESSORY_ID, props => (
            <HtmlPreviewAccessory message={props.message} />
        ));
    },

    stop() {
        removeMessageAccessory(ACCESSORY_ID);
    },
});
