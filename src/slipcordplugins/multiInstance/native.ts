/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, ipcMain, type NativeImage, nativeImage, safeStorage, screen, type Session,session } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

export async function decryptToken(_: any, encryptedToken: string): Promise<string | null> {
    return decryptTokenSync(encryptedToken);
}

export async function encryptToken(_: any, token: string): Promise<string> {
    return encryptTokenSync(token);
}

function encryptTokenSync(token: string): string {
    const clean = (token || "").trim().replace(/^"+|"+$/g, "");
    if (!clean) return "";
    if (clean.startsWith("dQw4w9WgXcQ:")) return clean;
    try {
        if (safeStorage.isEncryptionAvailable()) {
            const buf = safeStorage.encryptString(clean);
            return "dQw4w9WgXcQ:" + buf.toString("base64");
        }
    } catch (e) {
        console.warn("[NightcordMI] encryptTokenSync failed:", e);
    }
    return clean;
}

function getUserIdFromToken(token: string): string {
    try {
        const part = token.split(".")[0];
        if (!part) return "";
        const decoded = Buffer.from(part, "base64").toString("utf-8");
        if (/^\d{17,20}$/.test(decoded)) return decoded;
    } catch {}
    return "";
}

function decryptTokenSync(token: string): string {
    if (!token || typeof token !== "string") return "";
    let clean = token.trim().replace(/^"+|"+$/g, "");
    if (clean.startsWith("dQw4w9WgXcQ:")) {
        try {
            if (safeStorage.isEncryptionAvailable()) {
                const raw = Buffer.from(clean.slice("dQw4w9WgXcQ:".length), "base64");
                clean = safeStorage.decryptString(raw);
            }
        } catch (e) {
            console.warn("[NightcordMI] decryptTokenSync failed:", e);
        }
    }
    return clean;
}

const openWindows = new Map<string, BrowserWindow>();
const openGroupedWindows = new Map<string, BrowserWindow>();
const pendingInstanceAuth = new Map<number, { token: string; userId: string; username: string; }>();

export function isMultiInstanceWin(win: BrowserWindow | null | undefined): boolean {
    if (!win || win.isDestroyed()) return false;
    if ((win as any).__isMultiInstance) return true;
    for (const w of openWindows.values()) {
        if (w === win) return true;
    }
    for (const w of openGroupedWindows.values()) {
        if (w === win) return true;
    }
    return false;
}

export async function getInstanceAuth(_: any): Promise<{ token: string; userId: string; username: string; } | null> {
    const senderId = _?.sender?.id;
    if (typeof senderId === "number") {
        return pendingInstanceAuth.get(senderId) ?? null;
    }
    return null;
}

function grantSessionMediaPermissions(ses: Session) {
    try {
        ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
            callback(true);
        });
        ses.setPermissionCheckHandler(() => true);
        if ("setDevicePermissionHandler" in ses) {
            (ses as any).setDevicePermissionHandler(() => true);
        }
    } catch { }
}

// ─────────────────────────────────────────────────────────────────────────────
// Réglages partagés (thème, audio, zoom, etc.) entre toutes les instances
//
// Chaque instance tourne dans sa propre session Electron (persist:nightcord-mi-{userId}),
// donc son localStorage est totalement vide au premier lancement : Discord démarre
// avec ses réglages par défaut (pas de device audio choisi, thème par défaut, etc.),
// ce qui donne l'impression d'une fenêtre "vide" tant que l'utilisateur n'a pas tout
// reconfiguré à la main.
//
// On capture donc le localStorage de la fenêtre qui déclenche l'ouverture (le plus
// souvent la fenêtre principale) et on le sauvegarde sur disque. Ce cache est ensuite
// injecté dans chaque nouvelle instance via le preload, mais UNIQUEMENT pour les clés
// qui n'existent pas encore dans le profil ciblé — on ne touche jamais à un réglage
// déjà personnalisé pour ne rien casser.
// ─────────────────────────────────────────────────────────────────────────────

const SHARED_SETTINGS_FILE = join(app.getPath("userData"), "nightcord-mi-shared-settings.json");

// Clés qu'on ne veut jamais copier d'une fenêtre à l'autre (identité du compte / session)
const SHARED_SETTINGS_BLOCKLIST = new Set([
    "token",
    "default_token",
    "multiaccount_tokens",
    "tokens",
    "user_id_cache",
    "MultiAccountStore",
    "AuthenticationStore",
    "UserProfileStore",
    "UserStore",
    "login_token",
    "email_cache"
]);

const DUMP_LOCAL_STORAGE_SCRIPT = `
(function() {
    try {
        const block = ["token", "default_token", "multiaccount_tokens", "tokens", "user_id_cache", "MultiAccountStore", "AuthenticationStore", "login_token"];
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || block.includes(k)) continue;
            out[k] = localStorage.getItem(k);
        }
        return JSON.stringify(out);
    } catch (e) {
        return "{}";
    }
})();
`;

function loadSharedSettings(): Record<string, string> {
    try {
        if (!existsSync(SHARED_SETTINGS_FILE)) return {};
        const raw = readFileSync(SHARED_SETTINGS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function saveSharedSettings(settings: Record<string, string>): void {
    try {
        writeFileSync(SHARED_SETTINGS_FILE, JSON.stringify(settings), "utf-8");
    } catch (e) {
        console.warn("[NightcordMI] Failed to save shared settings:", e);
    }
}

/**
 * Capture le localStorage de la fenêtre qui a déclenché l'action (event.sender)
 * et le fusionne avec le cache déjà présent sur disque. Ne lève jamais d'erreur :
 * en cas de souci on retombe simplement sur le cache existant.
 */
async function captureAndMergeSharedSettings(sourceEvent: any): Promise<Record<string, string>> {
    const existing = loadSharedSettings();
    try {
        const sourceWc = sourceEvent?.sender;
        if (!sourceWc || sourceWc.isDestroyed?.()) return existing;
        const dump = await sourceWc.executeJavaScript(DUMP_LOCAL_STORAGE_SCRIPT);
        const captured = JSON.parse(dump || "{}");
        const filtered: Record<string, string> = {};
        for (const [key, value] of Object.entries(captured)) {
            if (SHARED_SETTINGS_BLOCKLIST.has(key)) continue;
            if (typeof value === "string") filtered[key] = value;
        }
        const merged = { ...existing, ...filtered };
        saveSharedSettings(merged);
        return merged;
    } catch {
        return existing;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio Settings Sync (Krisp, volume, périphériques audio)
// ─────────────────────────────────────────────────────────────────────────────

const AUDIO_SETTINGS_FILE = join(app.getPath("userData"), "nightcord-mi-audio-settings.json");

export function saveMasterAudioSettings(_: any, settings: any): boolean {
    try {
        if (!settings || typeof settings !== "object") return false;
        writeFileSync(AUDIO_SETTINGS_FILE, JSON.stringify(settings), "utf-8");
        return true;
    } catch (e) {
        console.warn("[NightcordMI] Failed to save master audio settings:", e);
        return false;
    }
}

export function getMasterAudioSettings(): any {
    try {
        if (!existsSync(AUDIO_SETTINGS_FILE)) return null;
        const raw = readFileSync(AUDIO_SETTINGS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Accounts & Token Cache Sync across all instances
// ─────────────────────────────────────────────────────────────────────────────

const SHARED_ACCOUNTS_FILE = join(app.getPath("userData"), "nightcord-mi-accounts.json");
const SHARED_TOKEN_CACHE_FILE = join(app.getPath("userData"), "nightcord-mi-tokencache.json");

export interface SharedAccountData {
    id: string;
    token: string;
    username: string;
    avatar: string;
}

export async function getSharedAccounts(): Promise<SharedAccountData[]> {
    try {
        if (!existsSync(SHARED_ACCOUNTS_FILE)) return [];
        const raw = readFileSync(SHARED_ACCOUNTS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((acc: any) => ({
            id: String(acc.id || ""),
            token: decryptTokenSync(acc.token || ""),
            username: String(acc.username || ""),
            avatar: String(acc.avatar || ""),
        })).filter(acc => acc.id);
    } catch (e) {
        console.warn("[NightcordMI] getSharedAccounts error:", e);
        return [];
    }
}

export async function saveSharedAccounts(_: any, accounts: SharedAccountData[]): Promise<boolean> {
    try {
        if (!Array.isArray(accounts)) return false;
        const existing = await getSharedAccounts();
        const map = new Map<string, SharedAccountData>();
        for (const a of existing) {
            if (a.id) map.set(a.id, a);
        }
        for (const a of accounts) {
            if (!a || !a.id) continue;
            const prev = map.get(a.id);
            map.set(a.id, {
                id: a.id,
                username: a.username || prev?.username || "",
                avatar: a.avatar || prev?.avatar || "",
                token: a.token || prev?.token || "",
            });
        }
        const toSave = Array.from(map.values()).map(acc => ({
            id: acc.id,
            username: acc.username,
            avatar: acc.avatar,
            token: encryptTokenSync(acc.token),
        }));
        writeFileSync(SHARED_ACCOUNTS_FILE, JSON.stringify(toSave, null, 2), "utf-8");
        return true;
    } catch (e) {
        console.warn("[NightcordMI] saveSharedAccounts error:", e);
        return false;
    }
}

export async function getSharedTokenCache(): Promise<Record<string, string>> {
    try {
        if (!existsSync(SHARED_TOKEN_CACHE_FILE)) return {};
        const raw = readFileSync(SHARED_TOKEN_CACHE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const decrypted: Record<string, string> = {};
        for (const [id, tok] of Object.entries(parsed)) {
            if (typeof tok === "string" && tok) {
                decrypted[id] = decryptTokenSync(tok);
            }
        }
        return decrypted;
    } catch (e) {
        console.warn("[NightcordMI] getSharedTokenCache error:", e);
        return {};
    }
}

export async function saveSharedTokenCache(_: any, cache: Record<string, string>): Promise<boolean> {
    try {
        if (!cache || typeof cache !== "object") return false;
        const existing = await getSharedTokenCache();
        const merged = { ...existing, ...cache };
        const encrypted: Record<string, string> = {};
        for (const [id, tok] of Object.entries(merged)) {
            if (typeof tok === "string" && tok) {
                encrypted[id] = encryptTokenSync(tok);
            }
        }
        writeFileSync(SHARED_TOKEN_CACHE_FILE, JSON.stringify(encrypted, null, 2), "utf-8");
        return true;
    } catch (e) {
        console.warn("[NightcordMI] saveSharedTokenCache error:", e);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Intercepte les IPC de contrôle de fenêtre pour une instance multi.
//
// Discord natif utilise ipcMain.handle("DISCORD_WINDOW_CLOSE" | "DISCORD_WINDOW_MINIMIZE" | ...)
// Ces handlers sont enregistrés GLOBALEMENT par Discord sur ipcMain, donc ils
// attrapent tous les événements de toutes les fenêtres et appellent injectedGetWindow(key)
// qui retourne toujours la fenêtre principale.
//
// Pour contourner ça, on utilise webContents.ipc.handle sur le webContents
// de chaque fenêtre multi-instance — ces handlers sont LOCAUX à ce webContents
// et ont priorité sur les handlers globaux ipcMain pour ce sender.
// ─────────────────────────────────────────────────────────────────────────────

let isAppQuitting = false;
app.on("before-quit", () => {
    isAppQuitting = true;
});

function registerWindowControlIpc(win: BrowserWindow): () => void {
    const wc = win.webContents as any; // webContents.ipc existe depuis Electron 20

    // Canaux Discord natif (découverts dans _core_extracted/bundle.js)
    const CLOSE = "DISCORD_WINDOW_CLOSE";
    const MINIMIZE = "DISCORD_WINDOW_MINIMIZE";
    const MAXIMIZE = "DISCORD_WINDOW_MAXIMIZE";
    const RESTORE = "DISCORD_WINDOW_RESTORE";
    const FULLSCREEN = "DISCORD_WINDOW_TOGGLE_FULLSCREEN";

    // webContents.ipc.handle est prioritaire sur ipcMain.handle pour ce sender
    const handleClose = () => {
        if (!win.isDestroyed()) {
            (win as any)._userRequestedClose = true;
            win.close();
        }
    };
    const handleMinimize = () => { if (!win.isDestroyed()) win.minimize(); };
    const handleMaximize = () => {
        if (win.isDestroyed()) return;
        if (win.isMaximized()) win.unmaximize(); else win.maximize();
    };
    const handleRestore = () => { if (!win.isDestroyed()) win.restore(); };
    const handleFullscreen = () => { if (!win.isDestroyed()) win.setFullScreen(!win.isFullScreen()); };

    try {
        // webContents.ipc.handle (Electron 20+)
        wc.ipc.handle(CLOSE, handleClose);
        wc.ipc.handle(MINIMIZE, handleMinimize);
        wc.ipc.handle(MAXIMIZE, handleMaximize);
        wc.ipc.handle(RESTORE, handleRestore);
        wc.ipc.handle(FULLSCREEN, handleFullscreen);
    } catch {
        // Fallback : ipcMain.handle global avec filtre sur sender
        // (moins propre mais fonctionne sur Electron < 20)
        //
        // IMPORTANT: DISCORD_WINDOW_TOGGLE_FULLSCREEN est deja enregistre globalement
        // par le patcher principal. On ne le re-enregistre PAS ici pour eviter
        // "Attempted to register a second handler" qui crashe Discord au demarrage.
        const guardedHandle = (fn: () => void) => (event: Electron.IpcMainInvokeEvent) => {
            if (BrowserWindow.fromWebContents(event.sender) !== win) return;
            fn();
        };
        // removeHandler d'abord pour eviter le crash en cas de double appel
        ipcMain.removeHandler(CLOSE);
        ipcMain.removeHandler(MINIMIZE);
        ipcMain.removeHandler(MAXIMIZE);
        ipcMain.removeHandler(RESTORE);
        // NE PAS enregistrer FULLSCREEN - gere globalement par le patcher
        ipcMain.handle(CLOSE, guardedHandle(handleClose));
        ipcMain.handle(MINIMIZE, guardedHandle(handleMinimize));
        ipcMain.handle(MAXIMIZE, guardedHandle(handleMaximize));
        ipcMain.handle(RESTORE, guardedHandle(handleRestore));
        return () => {
            ipcMain.removeHandler(CLOSE);
            ipcMain.removeHandler(MINIMIZE);
            ipcMain.removeHandler(MAXIMIZE);
            ipcMain.removeHandler(RESTORE);
        };
    }

    // Retourne le nettoyage pour webContents.ipc
    return () => {
        try {
            wc.ipc.removeHandler(CLOSE);
            wc.ipc.removeHandler(MINIMIZE);
            wc.ipc.removeHandler(MAXIMIZE);
            wc.ipc.removeHandler(RESTORE);
            wc.ipc.removeHandler(FULLSCREEN);
        } catch { }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Intercepte les IPC de badge/notification Discord pour les instances multi.
//
// Discord natif émet APP_BADGE_SET (et DISCORD_APP_BADGE_SET / APP_SET_BADGE_COUNT)
// via ipcRenderer.send / invoke de façon globale vers ipcMain.
// Le handler global de Discord dans core.asar appelle injectedGetWindow() ou
// BrowserWindow.fromId(getMainWindowId()) qui cible TOUJOURS la fenêtre principale.
// Résultat : le badge rouge (ping) ou le nombre de notifications non lues
// d'une instance secondaire s'affiche sur l'icône de la fenêtre Discord principale,
// et y reste bloqué même après avoir fermé l'instance secondaire.
//
// Pour résoudre ce problème définitivement :
// 1. On intercepte globalement ipcMain.emit pour APP_BADGE_SET et canaux associés :
//    - Si le sender est une fenêtre multi-instance, on applique setOverlayIcon
//      et flashFrame directement sur CETTE fenêtre secondaire.
//    - On consomme l'événement (return true sans appeler les listeners globaux),
//      ce qui empêche le handler natif de Discord d'écraser le badge du compte principal.
//    - Si le sender est la fenêtre principale, l'événement passe normalement.
// 2. On intercepte ipcMain.handle pour DISCORD_WINDOW_FLASH_FRAME et
//    DISCORD_APP_SET_BADGE_COUNT afin que le clignotement / badge cible le bon sender.
// 3. À la fermeture d'une instance secondaire, on vérifie et restaure le badge
//    propre de la fenêtre principale afin qu'aucune notification fantôme ne persiste.
// ─────────────────────────────────────────────────────────────────────────────

const BADGE_IPC_CHANNELS = new Set([
    "APP_BADGE_SET",
    "DISCORD_APP_BADGE_SET",
    "APP_SET_BADGE_COUNT",
    "DISCORD_APP_SET_BADGE_COUNT",
    "DISCORD_SET_BADGE_COUNT",
    "SET_BADGE_COUNT",
    "DISCORD_APP_BADGE",
    "APP_BADGE",
    "BADGE_COUNT",
    "DISCORD_BADGE_COUNT",
    "VCD_SET_BADGE_COUNT"
]);

const FLASH_IPC_CHANNELS = new Set([
    "DISCORD_WINDOW_FLASH_FRAME",
    "WINDOW_FLASH_FRAME",
    "FLASH_FRAME"
]);

const NOTIFICATION_IPC_CHANNELS = new Set([
    "DISCORD_NOTIFICATION",
    "SEND_NOTIFICATION",
    "DISPATCH_NOTIFICATION"
]);

const badgeImageCache = new Map<number, NativeImage>();

function getBadgeImage(index: number): NativeImage | null {
    if (badgeImageCache.has(index)) {
        return badgeImageCache.get(index)!;
    }

    const candidates: string[] = [];

    // Candidat 1 : module core de Discord dans resourcesPath
    try {
        if (process.resourcesPath) {
            const appDir = join(process.resourcesPath, "..");
            candidates.push(
                join(appDir, "modules", "discord_desktop_core-1", "discord_desktop_core", "app", "images", "badges", `badge-${index}.ico`)
            );
        }
    } catch { }

    // Candidat 2 : recherche dans LOCALAPPDATA / Discord / app-*
    try {
        const localApp = process.env.LOCALAPPDATA;
        if (localApp) {
            const discordDir = join(localApp, "Discord");
            if (existsSync(discordDir)) {
                const entries = readdirSync(discordDir).filter(e => e.startsWith("app-")).sort().reverse();
                for (const entry of entries) {
                    candidates.push(
                        join(discordDir, entry, "modules", "discord_desktop_core-1", "discord_desktop_core", "app", "images", "badges", `badge-${index}.ico`)
                    );
                }
            }
        }
    } catch { }

    // Candidat 3 : static/badges de Nightcord (source ou bundled)
    try {
        candidates.push(
            join(__dirname, "..", "..", "static", "badges", `${index}.ico`),
            join(__dirname, "..", "static", "badges", `${index}.ico`),
            join(__dirname, "static", "badges", `${index}.ico`),
            join(app.getAppPath(), "static", "badges", `${index}.ico`)
        );
    } catch { }

    for (const candidate of candidates) {
        try {
            if (existsSync(candidate)) {
                const img = nativeImage.createFromPath(candidate);
                if (img && !img.isEmpty()) {
                    badgeImageCache.set(index, img);
                    return img;
                }
            }
        } catch { }
    }

    return null;
}

function getBadgeIndexAndDescription(count: number): { index: number | null; description: string; } {
    if (count === -1) {
        return { index: 11, description: "Unread messages" };
    }
    if (count <= 0) {
        return { index: null, description: "No Notifications" };
    }
    const clamped = Math.max(1, Math.min(count, 10));
    return { index: clamped, description: `${clamped} notification${clamped > 1 ? "s" : ""}` };
}

export function applyBadgeToWindow(win: BrowserWindow, count: number) {
    if (!win || win.isDestroyed()) return;
    try {
        (win as any).__currentBadgeCount = count;
        if (process.platform === "win32") {
            const { index, description } = getBadgeIndexAndDescription(count);
            if (index === null) {
                win.setOverlayIcon(null, description);
                win.flashFrame(false);
            } else {
                const img = getBadgeImage(index);
                win.setOverlayIcon(img, description);
                win.flashFrame(true);
            }
        }
    } catch (e) {
        console.warn("[NightcordMI] applyBadgeToWindow error:", e);
    }
}

export function refreshMainWindowBadge() {
    try {
        const allWins = BrowserWindow.getAllWindows();
        const mainWin = allWins.find(w => !w.isDestroyed() && !isMultiInstanceWin(w));
        if (mainWin && !mainWin.isDestroyed() && process.platform === "win32") {
            const title = mainWin.getTitle();
            const match = title.match(/^\((\d+)\)/);
            const count = match ? parseInt(match[1], 10) || 0 : 0;
            applyBadgeToWindow(mainWin, count);
        }
    } catch (e) {
        console.warn("[NightcordMI] refreshMainWindowBadge error:", e);
    }
}

let isGlobalBadgeHookInstalled = false;

function installGlobalBadgeIpcInterception() {
    if (isGlobalBadgeHookInstalled) return;
    isGlobalBadgeHookInstalled = true;

    // 1. Intercepte ipcMain.emit (pour les événements de type send comme APP_BADGE_SET)
    const origEmit = ipcMain.emit;
    ipcMain.emit = function (this: any, channel: string, event: any, ...args: any[]): boolean {
        if (BADGE_IPC_CHANNELS.has(channel)) {
            const senderWin = event?.sender && !event.sender.isDestroyed()
                ? BrowserWindow.fromWebContents(event.sender)
                : null;
            if (senderWin && isMultiInstanceWin(senderWin)) {
                const count = typeof args[0] === "number" ? args[0] : 0;
                applyBadgeToWindow(senderWin, count);
                // Consomme l'événement : empêche le handler global de Discord d'écraser la fenêtre principale !
                return true;
            }
        } else if (FLASH_IPC_CHANNELS.has(channel)) {
            const senderWin = event?.sender && !event.sender.isDestroyed()
                ? BrowserWindow.fromWebContents(event.sender)
                : null;
            if (senderWin && isMultiInstanceWin(senderWin)) {
                const flag = args[0] !== undefined ? Boolean(args[0]) : true;
                if (!senderWin.isDestroyed()) {
                    senderWin.flashFrame(flag);
                }
                return true;
            }
        }
        return origEmit.apply(this, [channel, event, ...args]);
    };

    // 2. Intercepte ipcMain.on (couche de protection pour les listeners enregistrés globalement)
    const origOn = ipcMain.on;
    ipcMain.on = function (this: any, channel: string, listener: any) {
        if (BADGE_IPC_CHANNELS.has(channel) || FLASH_IPC_CHANNELS.has(channel)) {
            const wrapped = function (this: any, event: Electron.IpcMainEvent, ...args: any[]) {
                const senderWin = event?.sender && !event.sender.isDestroyed()
                    ? BrowserWindow.fromWebContents(event.sender)
                    : null;
                if (senderWin && isMultiInstanceWin(senderWin)) {
                    // Ignore les fenêtres multi-instance dans les écouteurs globaux
                    return;
                }
                return listener.apply(this, [event, ...args]);
            };
            return origOn.call(this, channel, wrapped);
        }
        return origOn.apply(this, arguments as any);
    };

    // 3. Intercepte ipcMain.handle (pour les invocations comme DISCORD_WINDOW_FLASH_FRAME et DISCORD_APP_SET_BADGE_COUNT)
    const origHandle = ipcMain.handle;
    ipcMain.handle = function (this: any, channel: string, listener: any) {
        if (FLASH_IPC_CHANNELS.has(channel)) {
            return origHandle.call(this, channel, async (event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
                const senderWin = event?.sender && !event.sender.isDestroyed()
                    ? BrowserWindow.fromWebContents(event.sender)
                    : null;
                if (senderWin && isMultiInstanceWin(senderWin)) {
                    const flag = args[0] !== undefined ? Boolean(args[0]) : true;
                    if (!senderWin.isDestroyed()) {
                        senderWin.flashFrame(flag);
                    }
                    return;
                }
                return listener(event, ...args);
            });
        }
        if (BADGE_IPC_CHANNELS.has(channel)) {
            return origHandle.call(this, channel, async (event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
                const senderWin = event?.sender && !event.sender.isDestroyed()
                    ? BrowserWindow.fromWebContents(event.sender)
                    : null;
                if (senderWin && isMultiInstanceWin(senderWin)) {
                    const count = typeof args[0] === "number" ? args[0] : 0;
                    applyBadgeToWindow(senderWin, count);
                    return;
                }
                return listener(event, ...args);
            });
        }
        return origHandle.apply(this, arguments as any);
    };
}

installGlobalBadgeIpcInterception();

function registerNotificationIpc(win: BrowserWindow): () => void {
    if (win.isDestroyed()) return () => {};

    const cleanups: Array<() => void> = [];

    const handleBadge = (count?: number) => {
        if (win.isDestroyed()) return;
        const n = typeof count === "number" ? count : 0;
        applyBadgeToWindow(win, n);
    };

    const handleFlash = (flag = true) => {
        if (win.isDestroyed()) return;
        try {
            if (process.platform === "win32") {
                win.flashFrame(Boolean(flag));
            }
        } catch { }
    };

    // Si webContents.ipc existe
    try {
        const anyWc = win.webContents as any;
        if (anyWc.ipc && typeof anyWc.ipc.on === "function") {
            for (const ch of BADGE_IPC_CHANNELS) {
                const fn = (_e: any, count?: number) => handleBadge(count);
                anyWc.ipc.on(ch, fn);
                cleanups.push(() => { try { anyWc.ipc.removeListener(ch, fn); } catch { } });
            }
            for (const ch of FLASH_IPC_CHANNELS) {
                const fn = (_e: any, flag?: boolean) => handleFlash(flag);
                anyWc.ipc.on(ch, fn);
                cleanups.push(() => { try { anyWc.ipc.removeListener(ch, fn); } catch { } });
            }
        }
    } catch { }

    return () => {
        for (const fn of cleanups) {
            try { fn(); } catch { }
        }
        try {
            if (!win.isDestroyed() && process.platform === "win32") {
                win.setOverlayIcon(null, "");
                win.flashFrame(false);
            }
        } catch { }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Crée le script de préchargement qui injecte le token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensemble des chemins de preloads actuellement utilisés par une fenêtre MI ouverte.
 * Un fichier est dans cet ensemble tant que sa fenêtre est vivante.
 * On ne supprime QUE les fichiers absents de cet ensemble (= orphelins vrais).
 */
const activePreloads = new Set<string>();

function createTokenPreload(token: string, sharedSettings: Record<string, string> = {}, targetUserId = "", audioSettings?: any): string {
    const dir = join(app.getPath("userData"), "nightcord-mi-preloads");
    mkdirSync(dir, { recursive: true });

    // ── Nettoyage des preloads orphelins ────────────────────────────────────────
    // Supprime uniquement les fichiers token-preload-*.js qui ne sont PAS dans
    // activePreloads (= fenêtre MI fermée ou crash précédent).
    // On ne touche JAMAIS aux fichiers des fenêtres encore ouvertes, peu importe
    // leur âge — un utilisateur peut garder une fenêtre MI ouverte des heures.
    try {
        for (const f of readdirSync(dir)) {
            if (!/^token-preload-\d+\.js$/.test(f)) continue;
            const fullPath = join(dir, f);
            if (!activePreloads.has(fullPath)) {
                try { unlinkSync(fullPath); } catch {}
            }
        }
    } catch {}

    const cleanToken = decryptTokenSync(token);
    const encryptedToken = encryptTokenSync(cleanToken);
    const effectiveUid = targetUserId || getUserIdFromToken(cleanToken);

    const tokensMap: Record<string, string> = {};
    if (effectiveUid && encryptedToken) {
        tokensMap[effectiveUid] = encryptedToken;
    }

    const effectiveAudio = audioSettings || getMasterAudioSettings();
    let rawAudioStr = "";
    if (effectiveAudio) {
        if (typeof effectiveAudio.rawMediaEngineStore === "string" && effectiveAudio.rawMediaEngineStore.length > 5) {
            rawAudioStr = effectiveAudio.rawMediaEngineStore;
        } else if (effectiveAudio.fullState) {
            rawAudioStr = JSON.stringify(effectiveAudio.fullState);
        } else if (effectiveAudio.defaultSettings) {
            rawAudioStr = JSON.stringify({ default: effectiveAudio.defaultSettings });
        }
    }

    // Serialize values to JS string literals safe to embed via JSON.stringify
    const tokenLiteral = JSON.stringify(cleanToken);
    const settingsLiteral = JSON.stringify(JSON.stringify(sharedSettings ?? {}));
    const targetUserIdLiteral = JSON.stringify(effectiveUid ?? "");
    const tokensMapLiteral = JSON.stringify(JSON.stringify(tokensMap));
    const audioLiteral = JSON.stringify(rawAudioStr);

    // Inner script: runs in main world via webFrame.executeJavaScript.
    // Must be plain JavaScript — no TypeScript syntax, no template literals.
    const innerLines = [
        "(function() {",
        "  var RAW_TOKEN = " + tokenLiteral + ";",
        "  var SETTINGS_JSON = " + settingsLiteral + ";",
        "  var TARGET_UID = " + targetUserIdLiteral + ";",
        "  var TOKENS_JSON = " + tokensMapLiteral + ";",
        "  var RAW_AUDIO = " + audioLiteral + ";",
        "  var CONFLICT = ['token','default_token','multiaccount_tokens','tokens','user_id_cache','MultiAccountStore','AuthenticationStore','login_token'];",
        "  try {",
        "    var sh = JSON.parse(SETTINGS_JSON || '{}');",
        "    for (var k in sh) { if (CONFLICT.indexOf(k) >= 0) continue; if (k === 'MediaEngineStore' || localStorage.getItem(k) === null) localStorage.setItem(k, sh[k]); }",
        "  } catch(e) {}",
        "  if (RAW_AUDIO && RAW_AUDIO.length > 5) {",
        "    try { localStorage.setItem('MediaEngineStore', RAW_AUDIO); } catch(e) {}",
        "  }",
        "  if (RAW_TOKEN && RAW_TOKEN !== 'undefined') {",
        "    var qt = JSON.stringify(RAW_TOKEN);",
        "    try { localStorage.setItem('token', qt); } catch(e) {}",
        "    try { localStorage.setItem('default_token', qt); } catch(e) {}",
        "    if (TARGET_UID) {",
        "      try { localStorage.setItem('user_id_cache', JSON.stringify(TARGET_UID)); } catch(e) {}",
        "    }",
        "    if (TOKENS_JSON && TOKENS_JSON !== '{}') {",
        "      try { localStorage.setItem('tokens', TOKENS_JSON); } catch(e) {}",
        "      try { localStorage.setItem('multiaccount_tokens', TOKENS_JSON); } catch(e) {}",
        "    }",
        "    try {",
        "      var uid = localStorage.getItem('user_id_cache');",
        "      if (uid && TARGET_UID && uid.replace(/\"/g, '') !== TARGET_UID) {",
        "        localStorage.removeItem('AuthenticationStore');",
        "        localStorage.removeItem('MultiAccountStore');",
        "      }",
        "    } catch(e) {}",
        "  }",
        "  try { Object.defineProperty(window, '__nightcord_token', { value: RAW_TOKEN, writable: false, configurable: true }); } catch(e) {}",
        "  try { Object.defineProperty(window, '__nightcord_user_id', { value: TARGET_UID, writable: false, configurable: true }); } catch(e) {}",
        "  (function() {",
        "    var lastUI = 0;",
        "    window.addEventListener('pointerdown', function(e) { if (e.isTrusted) lastUI = Date.now(); }, true);",
        "    window.addEventListener('keydown', function(e) { if (e.isTrusted) lastUI = Date.now(); }, true);",
        "    function patchClose() {",
        "      var dn = window.DiscordNative;",
        "      if (dn && dn.window && dn.window.close && !dn.window._miPatched) {",
        "        var orig = dn.window.close;",
        "        dn.window.close = function() { if (Date.now() - lastUI < 2000) orig.apply(this, arguments); };",
        "        dn.window._miPatched = true;",
        "      }",
        "    }",
        "    patchClose();",
        "    document.addEventListener('DOMContentLoaded', patchClose);",
        "    setInterval(patchClose, 1000);",
        "  })();",
        "  console.log('[NightcordMI] token preload active');",
        "})();"
    ].join("\n");

    // The preload file runs in the isolated Node/Electron world.
    // innerLines is embedded as a JSON string literal so it is never misinterpreted.
    const innerLiteralForNode = JSON.stringify(innerLines);

    const script = [
        "// Nightcord MultiInstance — token preload",
        "(function() {",
        "  try {",
        "    var rawToken = " + tokenLiteral + ";",
        "    var targetUid = " + targetUserIdLiteral + ";",
        "    var tokensJson = " + tokensMapLiteral + ";",
        "    var rawAudio = " + audioLiteral + ";",
        "    if (rawAudio && rawAudio.length > 5 && typeof window !== 'undefined' && window.localStorage) {",
        "      try { window.localStorage.setItem('MediaEngineStore', rawAudio); } catch(e) {}",
        "    }",
        "    if (rawToken && rawToken !== 'undefined' && typeof window !== 'undefined' && window.localStorage) {",
        "      try {",
        "        var qt = JSON.stringify(rawToken);",
        "        window.localStorage.setItem('token', qt);",
        "        window.localStorage.setItem('default_token', qt);",
        "        if (targetUid) { window.localStorage.setItem('user_id_cache', JSON.stringify(targetUid)); }",
        "        if (tokensJson && tokensJson !== '{}') {",
        "          window.localStorage.setItem('tokens', tokensJson);",
        "          window.localStorage.setItem('multiaccount_tokens', tokensJson);",
        "        }",
        "      } catch(e) {}",
        "    }",
        "    var wf = null;",
        "    try { wf = require('electron').webFrame; } catch(e) {}",
        "    if (!wf) { try { wf = require('electron/renderer').webFrame; } catch(e) {} }",
        "    if (wf) {",
        "      wf.executeJavaScript(" + innerLiteralForNode + ")",
        "        .catch(function(err) { console.warn('[NightcordMI] mainWorld error:', err); });",
        "    }",
        "  } catch(e) { console.warn('[NightcordMI] preload error:', e); }",
        "})();"
    ].join("\n");

    const filePath = join(dir, "token-preload-" + Date.now() + ".js");
    writeFileSync(filePath, script, "utf-8");
    // Enregistre ce preload comme actif — sera retiré dans win.once("closed")
    activePreloads.add(filePath);
    return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ouvre une nouvelle fenêtre Discord isolée
// ─────────────────────────────────────────────────────────────────────────────

// Compteur d'icones detached : tourne de 1 a 5
let iconCounter = 1;

// Chemin vers le dossier d'icones detached (multi-instance-icons/ dans le dist)
function getDetachedIconDir(): string {
    // En production : {app_dir}/multi-instance-icons/
    // En dev : Desktop/lolll/
    const exeDir = join(process.execPath, "..");
    const prodDir = join(exeDir, "multi-instance-icons");
    if (existsSync(prodDir)) return prodDir;
    // Fallback dev : Desktop/lolll
    const desktopDir = join(app.getPath("desktop"), "lolll");
    if (existsSync(desktopDir)) return desktopDir;
    return prodDir;
}

export async function openInstanceWindow(
    _: any,
    token: string,
    userId: string,
    detached = false,
    username = "",
    domain = "discord.com",
    blockExternalTokenAccess = false,
    performanceMode = false,
    audioSettings?: any
): Promise<{ ok: boolean; error?: string; }> {
    try {
        const cleanTok = decryptTokenSync(token);
        token = cleanTok;
        // Fenetre deja ouverte -> focus
        const existing = openWindows.get(userId);
        if (existing && !existing.isDestroyed()) {
            existing.show();
            existing.focus();
            return { ok: true };
        }

        // ID unique par instance - Windows groupe les fenetres par AppUserModelId
        // En donnant un ID different a chaque fenetre, elles ne se regroupent pas
        const uniqueAppId = `nightcord.instance.${userId}.${Date.now()}`;

        // Icone : rotation 1→2→3→4→5→1→... depuis multi-instance-icons/
        let currentIconPath = "";
        const iconDir = getDetachedIconDir();
        currentIconPath = join(iconDir, `${iconCounter}.ico`);
        if (!existsSync(currentIconPath)) currentIconPath = "";
        iconCounter = iconCounter >= 5 ? 1 : iconCounter + 1;

        // Session Electron isolee par userId
        const savedPartition = `persist:nightcord-mi-${userId}`;
        if (blockExternalTokenAccess) {
            try {
                const savedSes = session.fromPartition(savedPartition, { cache: true });
                await savedSes.clearStorageData();
                await savedSes.clearCache();
            } catch {}
        }

        const partition = blockExternalTokenAccess
            ? `nightcord-mi-${userId}-${Date.now()}`
            : savedPartition;
        const ses = session.fromPartition(partition, { cache: !blockExternalTokenAccess });

        ses.webRequest.onBeforeRequest({ urls: ["*://*.discord.com/handoff*", "*://discord.com/handoff*"] }, (details, callback) => {
            callback({ cancel: true });
        });

        ses.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                const low = key.toLowerCase();
                if (low === "content-security-policy" || low === "permissions-policy" || low === "feature-policy") {
                    delete headers[key];
                }
            }
            callback({ responseHeaders: headers });
        });

        grantSessionMediaPermissions(ses);

        if (audioSettings) {
            saveMasterAudioSettings(null, audioSettings);
        }
        if (userId && token) {
            saveSharedAccounts(null, [{ id: userId, token, username: username || "", avatar: "" }]).catch(() => {});
            saveSharedTokenCache(null, { [userId]: token }).catch(() => {});
        }
        const effectiveAudio = audioSettings || getMasterAudioSettings();
        const sharedSettings = await captureAndMergeSharedSettings(_);
        const preloadPath = createTokenPreload(token, sharedSettings, userId, effectiveAudio);
        ses.setPreloads([preloadPath]);

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            parent: undefined,
            skipTaskbar: false,
            frame: false,
            transparent: false,
            titleBarStyle: "hidden",
            autoHideMenuBar: true,
            darkTheme: true,
            backgroundColor: "#313338",
            title: `Nightcord [${username || userId}]`,
            icon: currentIconPath || undefined,
            webPreferences: {
                preload: join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                session: ses,
                webSecurity: false,
                backgroundThrottling: performanceMode,
            },
        });

        (win as any).__isMultiInstance = true;
        (win as any).__instanceUserId = userId;

        // CRITIQUE : setAppDetails DOIT etre appele immediatement apres new BrowserWindow,
        // avant que la fenetre soit affichee. C'est ce qui empeche Windows de grouper
        // les fenetres ensemble dans la barre des taches.
        if (process.platform === "win32") {
            try {
                win.setAppDetails({
                    appId: uniqueAppId,
                    appIconPath: currentIconPath || undefined,
                    relaunchDisplayName: `Nightcord [${username || userId}]`,
                });
            } catch (err) {
                console.warn("[NightcordMI] setAppDetails failed:", err);
            }
        }

        const wc = win.webContents;
        const wcId = wc.id;
        openWindows.set(userId, win);
        pendingInstanceAuth.set(wcId, { token: cleanTok, userId, username });

        win.on("enter-html-full-screen", () => {
            if (!win.isDestroyed()) win.setFullScreen(true);
        });
        win.on("leave-html-full-screen", () => {
            if (!win.isDestroyed()) win.setFullScreen(false);
        });

        // Avant fermeture : désinscrit les service workers et coupe le gateway
        // pour stopper toutes les notifications push
        win.on("close", () => {
            if (win.isDestroyed() || wc.isDestroyed()) return;
            wc.executeJavaScript(`
                (async () => {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const r of regs) await r.unregister();
                    } catch(e) {}
                    try {
                        // Coupe la connexion gateway Discord
                        const ws = window.__NIGHTCORD_GW_WS__;
                        if (ws && ws.readyState <= 1) ws.close(4000, 'window_close');
                    } catch(e) {}
                })();
            `).catch(() => {});
        });

        // Enregistre les handlers IPC de contrôle de fenêtre (DISCORD_WINDOW_*) sur ce webContents
        // Doit être fait AVANT que Discord charge son JS (dom-ready)
        const cleanupIpc = registerWindowControlIpc(win);
        // Redirige les IPC de badge/notification vers CETTE fenêtre (pas la fenêtre principale)
        const cleanupNotifIpc = registerNotificationIpc(win);

        win.once("closed", () => {
            cleanupIpc();
            cleanupNotifIpc();
            openWindows.delete(userId);
            pendingInstanceAuth.delete(wcId);
            // Nettoie les service workers de la session pour couper définitivement les notifs
            ses.clearStorageData({ storages: ["serviceworkers"] }).catch(() => {});
            // Retire le preload de l'ensemble actif puis supprime le fichier
            activePreloads.delete(preloadPath);
            try { unlinkSync(preloadPath); } catch {}
            refreshMainWindowBadge();
        });

        // Flash et badge quand il y a des notifs
        wc.on("page-title-updated", (e, title) => {
            if (win.isDestroyed()) return;
            if (process.platform === "win32") {
                const match = title.match(/^\((\d+)\)/);
                if (match) {
                    const count = parseInt(match[1], 10) || 0;
                    applyBadgeToWindow(win, count);
                } else if (!title.startsWith("(")) {
                    if ((win as any).__currentBadgeCount === undefined || (win as any).__currentBadgeCount <= 0) {
                        applyBadgeToWindow(win, 0);
                    }
                }
            }
        });

        // Injection du token
        const effectiveUid = userId || getUserIdFromToken(cleanTok);
        const encryptedTok = encryptTokenSync(cleanTok);
        const tokensMap: Record<string, string> = {};
        if (effectiveUid && encryptedTok) tokensMap[effectiveUid] = encryptedTok;
        const safeTokenStr = JSON.stringify(cleanTok);
        const safeTargetId = JSON.stringify(effectiveUid || "");
        const safeTokensMapStr = JSON.stringify(JSON.stringify(tokensMap));
        const rawAudio = effectiveAudio?.rawMediaEngineStore || (effectiveAudio?.fullState ? JSON.stringify(effectiveAudio.fullState) : (effectiveAudio?.defaultSettings ? JSON.stringify({ default: effectiveAudio.defaultSettings }) : ""));
        const safeAudioStr = JSON.stringify(rawAudio || "");
        const injectJs = `(function(){
            try {
                const raw = ${safeTokenStr};
                if (!raw || raw === "undefined") return;
                const q = JSON.stringify(raw);
                localStorage.setItem("token", q);
                localStorage.setItem("default_token", q);
                const target = ${safeTargetId};
                if (target) {
                    localStorage.setItem("user_id_cache", JSON.stringify(target));
                }
                const tokensJson = ${safeTokensMapStr};
                if (tokensJson && tokensJson !== "{}") {
                    localStorage.setItem("tokens", tokensJson);
                    localStorage.setItem("multiaccount_tokens", tokensJson);
                }
                const rawAud = ${safeAudioStr};
                if (rawAud && rawAud.length > 5) {
                    try {
                        localStorage.setItem("MediaEngineStore", rawAud);
                    } catch(e) {}
                }
                const uid = localStorage.getItem("user_id_cache");
                if (uid && target && uid.replace(/"/g, "") !== target) {
                    localStorage.removeItem("AuthenticationStore");
                    localStorage.removeItem("MultiAccountStore");
                }
                const iframe = document.createElement("iframe");
                iframe.style.display = "none";
                document.body.appendChild(iframe);
                try {
                    iframe.contentWindow.localStorage.token = q;
                    iframe.contentWindow.localStorage.default_token = q;
                    if (target) iframe.contentWindow.localStorage.user_id_cache = JSON.stringify(target);
                    if (tokensJson && tokensJson !== "{}") {
                        iframe.contentWindow.localStorage.tokens = tokensJson;
                        iframe.contentWindow.localStorage.multiaccount_tokens = tokensJson;
                    }
                    if (rawAud && rawAud.length > 5) {
                        iframe.contentWindow.localStorage.MediaEngineStore = rawAud;
                    }
                } catch(e) {}
                document.body.removeChild(iframe);
            } catch(e) {}
        })();`;
        wc.on("dom-ready", () => wc.executeJavaScript(injectJs).catch(() => { }));
        wc.on("did-finish-load", () => wc.executeJavaScript(injectJs).catch(() => { }));
        wc.on("did-navigate", () => wc.executeJavaScript(injectJs).catch(() => { }));

        // Titre de la fenetre
        wc.on("page-title-updated", (e, title) => {
            const cleanTitle = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\[.*\]$/, "");
            win.setTitle(`${cleanTitle} [${username || userId}]`);
            e.preventDefault();
        });

        wc.on("will-navigate", (e, url) => {
            if (url.includes("/handoff")) {
                e.preventDefault();
                return;
            }
            if (!/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) e.preventDefault();
        });

        wc.setWindowOpenHandler(({ url }) => {
            if (url.includes("/handoff")) return { action: "deny" };
            if (url.startsWith("http")) require("electron").shell.openExternal(url);
            return { action: "deny" };
        });

        const validDomains = ["discord.com", "ptb.discord.com", "canary.discord.com"];
        const targetDomain = validDomains.includes(domain) ? domain : "discord.com";
        await win.loadURL(`https://${targetDomain}/channels/@me`);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fenetres « groupées » — meme groupe que Nightcord dans la barre des taches
// Principe : on ne touche PAS a setAppDetails => la fenetre herite de l'AppId
// du processus principal (com.nightcord.app), Windows la groupe automatiquement
// ─────────────────────────────────────────────────────────────────────────────

export async function openInstanceWindowGrouped(
    _: any,
    token: string,
    userId: string,
    username = "",
    domain = "discord.com",
    blockExternalTokenAccess = false,
    performanceMode = false,
    audioSettings?: any
): Promise<{ ok: boolean; error?: string; }> {
    try {
        const cleanTok = decryptTokenSync(token);
        token = cleanTok;
        // Focus si deja ouverte
        const existing = openGroupedWindows.get(userId);
        if (existing && !existing.isDestroyed()) {
            existing.show();
            existing.focus();
            return { ok: true };
        }

        // Session isolee par userId
        const savedPartition = `persist:nightcord-mi-${userId}`;
        if (blockExternalTokenAccess) {
            try {
                const savedSes = session.fromPartition(savedPartition, { cache: true });
                await savedSes.clearStorageData();
                await savedSes.clearCache();
            } catch {}
        }

        const partition = blockExternalTokenAccess
            ? `nightcord-mi-${userId}-${Date.now()}`
            : savedPartition;
        const ses = session.fromPartition(partition, { cache: !blockExternalTokenAccess });

        ses.webRequest.onBeforeRequest({ urls: ["*://*.discord.com/handoff*", "*://discord.com/handoff*"] }, (details, callback) => {
            callback({ cancel: true });
        });

        ses.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                const low = key.toLowerCase();
                if (low === "content-security-policy" || low === "permissions-policy" || low === "feature-policy") {
                    delete headers[key];
                }
            }
            callback({ responseHeaders: headers });
        });

        grantSessionMediaPermissions(ses);

        if (audioSettings) {
            saveMasterAudioSettings(null, audioSettings);
        }
        if (userId && token) {
            saveSharedAccounts(null, [{ id: userId, token, username: username || "", avatar: "" }]).catch(() => {});
            saveSharedTokenCache(null, { [userId]: token }).catch(() => {});
        }
        const effectiveAudio = audioSettings || getMasterAudioSettings();
        const sharedSettings = await captureAndMergeSharedSettings(_);
        const preloadPath = createTokenPreload(token, sharedSettings, userId, effectiveAudio);
        ses.setPreloads([preloadPath]);

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            parent: undefined,
            skipTaskbar: false,
            frame: false,
            transparent: false,
            titleBarStyle: "hidden",
            autoHideMenuBar: true,
            darkTheme: true,
            backgroundColor: "#313338",
            title: `Nightcord [${username || userId}]`,
            webPreferences: {
                preload: join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                session: ses,
                webSecurity: false,
                backgroundThrottling: performanceMode,
            },
        });

        (win as any).__isMultiInstance = true;
        (win as any).__instanceUserId = userId;

        const wc = win.webContents;
        const wcId = wc.id;
        openGroupedWindows.set(userId, win);
        pendingInstanceAuth.set(wcId, { token: cleanTok, userId, username });

        win.on("enter-html-full-screen", () => {
            if (!win.isDestroyed()) win.setFullScreen(true);
        });
        win.on("leave-html-full-screen", () => {
            if (!win.isDestroyed()) win.setFullScreen(false);
        });

        // Avant fermeture : désinscrit les service workers et coupe le gateway
        win.on("close", () => {
            if (win.isDestroyed() || wc.isDestroyed()) return;
            wc.executeJavaScript(`
                (async () => {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const r of regs) await r.unregister();
                    } catch(e) {}
                    try {
                        // Coupe la connexion gateway Discord
                        const ws = window.__NIGHTCORD_GW_WS__;
                        if (ws && ws.readyState <= 1) ws.close(4000, 'window_close');
                    } catch(e) {}
                })();
            `).catch(() => {});
        });

        // Enregistre les handlers IPC de contrôle de fenêtre pour cette instance groupée
        const cleanupIpc = registerWindowControlIpc(win);
        // Redirige les IPC de badge/notification vers CETTE fenêtre (pas la fenêtre principale)
        const cleanupNotifIpc = registerNotificationIpc(win);

        win.once("closed", () => {
            cleanupIpc();
            cleanupNotifIpc();
            openGroupedWindows.delete(userId);
            pendingInstanceAuth.delete(wcId);
            ses.clearStorageData({ storages: ["serviceworkers"] }).catch(() => {});
            activePreloads.delete(preloadPath);
            try { unlinkSync(preloadPath); } catch {}
            refreshMainWindowBadge();
        });

        wc.on("page-title-updated", (e, title) => {
            if (win.isDestroyed()) return;
            if (process.platform === "win32") {
                const match = title.match(/^\((\d+)\)/);
                if (match) {
                    const count = parseInt(match[1], 10) || 0;
                    applyBadgeToWindow(win, count);
                } else if (!title.startsWith("(")) {
                    if ((win as any).__currentBadgeCount === undefined || (win as any).__currentBadgeCount <= 0) {
                        applyBadgeToWindow(win, 0);
                    }
                }
            }
        });

        const effectiveUid = userId || getUserIdFromToken(cleanTok);
        const encryptedTok = encryptTokenSync(cleanTok);
        const tokensMap: Record<string, string> = {};
        if (effectiveUid && encryptedTok) tokensMap[effectiveUid] = encryptedTok;
        const safeTokenStr = JSON.stringify(cleanTok);
        const safeTargetId = JSON.stringify(effectiveUid || "");
        const safeTokensMapStr = JSON.stringify(JSON.stringify(tokensMap));
        const rawAudio = effectiveAudio?.rawMediaEngineStore || (effectiveAudio?.fullState ? JSON.stringify(effectiveAudio.fullState) : (effectiveAudio?.defaultSettings ? JSON.stringify({ default: effectiveAudio.defaultSettings }) : ""));
        const safeAudioStr = JSON.stringify(rawAudio || "");
        const injectJs = `(function(){
            try {
                const raw = ${safeTokenStr};
                if (!raw || raw === "undefined") return;
                const q = JSON.stringify(raw);
                localStorage.setItem("token", q);
                localStorage.setItem("default_token", q);
                const target = ${safeTargetId};
                if (target) {
                    localStorage.setItem("user_id_cache", JSON.stringify(target));
                }
                const tokensJson = ${safeTokensMapStr};
                if (tokensJson && tokensJson !== "{}") {
                    localStorage.setItem("tokens", tokensJson);
                    localStorage.setItem("multiaccount_tokens", tokensJson);
                }
                const rawAud = ${safeAudioStr};
                if (rawAud && rawAud.length > 5) {
                    try {
                        localStorage.setItem("MediaEngineStore", rawAud);
                    } catch(e) {}
                }
                const uid = localStorage.getItem("user_id_cache");
                if (uid && target && uid.replace(/"/g, "") !== target) {
                    localStorage.removeItem("AuthenticationStore");
                    localStorage.removeItem("MultiAccountStore");
                }
                const iframe = document.createElement("iframe");
                iframe.style.display = "none";
                document.body.appendChild(iframe);
                try {
                    iframe.contentWindow.localStorage.token = q;
                    iframe.contentWindow.localStorage.default_token = q;
                    if (target) iframe.contentWindow.localStorage.user_id_cache = JSON.stringify(target);
                    if (tokensJson && tokensJson !== "{}") {
                        iframe.contentWindow.localStorage.tokens = tokensJson;
                        iframe.contentWindow.localStorage.multiaccount_tokens = tokensJson;
                    }
                    if (rawAud && rawAud.length > 5) {
                        iframe.contentWindow.localStorage.MediaEngineStore = rawAud;
                    }
                } catch(e) {}
                document.body.removeChild(iframe);
            } catch(e) {}
        })();`;
        wc.on("dom-ready", () => wc.executeJavaScript(injectJs).catch(() => {}));
        wc.on("did-finish-load", () => wc.executeJavaScript(injectJs).catch(() => {}));
        wc.on("did-navigate", () => wc.executeJavaScript(injectJs).catch(() => {}));

        wc.on("page-title-updated", (e, title) => {
            const cleanTitle = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\[.*\]$/, "");
            win.setTitle(`${cleanTitle} [${username || userId}]`);
            e.preventDefault();
        });

        wc.on("will-navigate", (e, url) => {
            if (url.includes("/handoff")) {
                e.preventDefault();
                return;
            }
            if (!/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) e.preventDefault();
        });

        wc.setWindowOpenHandler(({ url }) => {
            if (url.includes("/handoff")) return { action: "deny" };
            if (url.startsWith("http")) require("electron").shell.openExternal(url);
            return { action: "deny" };
        });

        const validDomains = ["discord.com", "ptb.discord.com", "canary.discord.com"];
        const targetDomain = validDomains.includes(domain) ? domain : "discord.com";
        await win.loadURL(`https://${targetDomain}/channels/@me`);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Split screen : positionne les deux fenêtres côte à côte
// ─────────────────────────────────────────────────────────────────────────────

export async function arrangeSplit(_: any, userId: string): Promise<void> {
    try {
        const secondWin = openWindows.get(userId);
        if (!secondWin || secondWin.isDestroyed()) return;

        const allWins = BrowserWindow.getAllWindows();
        const mainWin = allWins.find(w => w !== secondWin && !w.isDestroyed());
        if (!mainWin) return;

        const display = screen.getDisplayMatching(mainWin.getBounds());
        const { x, y, width, height } = display.workArea;
        const half = Math.floor(width / 2);

        mainWin.setBounds({ x, y, width: half, height }, true);
        secondWin.setBounds({ x: x + half, y, width: width - half, height }, true);
        secondWin.show();
        secondWin.focus();
    } catch (e) {
        console.error("[NightcordMI] arrangeSplit error:", e);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Liste / ferme les instances
// ─────────────────────────────────────────────────────────────────────────────

export async function getOpenInstances(_: any): Promise<string[]> {
    return [...openWindows.entries(), ...openGroupedWindows.entries()]
        .filter(([, w]) => !w.isDestroyed())
        .map(([id]) => id);
}

export async function closeInstance(_: any, userId: string): Promise<void> {
    const win = openWindows.get(userId) || openGroupedWindows.get(userId);
    if (win && !win.isDestroyed()) {
        (win as any)._userRequestedClose = true;
        win.close();
    }
}
