/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { ipcMain } from "electron";
import { writeFileSync } from "original-fs";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { ASAR_FILE, serializeErrors } from "./common";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
// /releases/latest/download/<asset> always resolves to the current release's asset, so it
// stays valid when a rolling release replaces the asset we resolved earlier
const LATEST_DOWNLOAD_BASE = `https://github.com/${gitRemote}/releases/latest/download`;

const RELEASE_CACHE_TTL = 60_000;
const DOWNLOAD_ATTEMPTS = 3;
const RETRY_DELAY = 1200;
const MIN_ASAR_SIZE = 1_000_000;

interface ReleaseAsset {
    id: number;
    name: string;
    browser_download_url: string;
    size?: number;
}

interface ReleaseData {
    tag_name?: string;
    name?: string;
    assets?: ReleaseAsset[];
}

interface PendingUpdate {
    url: string;
    tag: string;
    hash: string | null;
}

let PendingUpdate: PendingUpdate | null = null;
/** why the last check could not confirm a release, surfaced instead of a misleading message */
let lastCheckError: string | null = null;
let cachedRelease: { data: ReleaseData; fetchedAt: number } | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            // "All API requests MUST include a valid User-Agent header.
            // Requests with no User-Agent header will be rejected."
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

function describeApiError(err: any): string {
    const message = String(err?.message ?? err);

    if (/\b403\b/.test(message) && /rate limit/i.test(message)) {
        return "GitHub's anonymous API rate limit is exhausted for your IP. Wait an hour, or install the update manually.";
    }
    if (/\b403\b/.test(message)) return "GitHub refused the API request (403). If this is a rate limit, wait an hour.";

    return message.split("\n")[0];
}

/** release names look like "Slipcord 1.2.3 abc1234", so the hash is the last whitespace separated token */
function getReleaseHash(releaseData: ReleaseData): string | null {
    const name = typeof releaseData.name === "string" && releaseData.name.trim()
        ? releaseData.name
        : (releaseData.tag_name ?? "");
    const last = name.trim().split(/\s+/).at(-1) ?? "";

    return /^[\da-f]{7,40}$/i.test(last) ? last : null;
}

function findAsset(releaseData: ReleaseData): ReleaseAsset | null {
    const assets = releaseData.assets ?? [];

    // exact name first, then any real asar (skipping the .LEGAL.txt companions)
    return assets.find(a => a?.name === ASAR_FILE)
        ?? assets.find(a => typeof a?.name === "string" && a.name.endsWith(".asar") && !a.name.includes("LEGAL"))
        ?? null;
}

async function getLatestRelease(force = false): Promise<ReleaseData> {
    if (!force && cachedRelease && Date.now() - cachedRelease.fetchedAt < RELEASE_CACHE_TTL) {
        return cachedRelease.data;
    }

    const data = await githubGet<ReleaseData>("/releases/latest");
    cachedRelease = { data, fetchedAt: Date.now() };
    return data;
}

function planUpdate(releaseData: ReleaseData): PendingUpdate | null {
    const hash = getReleaseHash(releaseData);
    if (!hash || hash === gitHash) return null;

    const asset = findAsset(releaseData);
    if (!asset) {
        lastCheckError = `Release ${releaseData.tag_name ?? ""} does not have a ${ASAR_FILE} asset yet.`.replace(/\s+/g, " ");
        return null;
    }

    return { url: asset.browser_download_url, tag: releaseData.tag_name ?? "", hash };
}

async function calculateGitChanges() {
    const isOutdated = await fetchUpdates();
    if (!isOutdated) return [];

    const data = await githubGet(`/compare/${gitHash}...HEAD`);

    return data.commits.map((c: any) => ({
        hash: c.sha,
        author: c.author?.login ?? c.commit?.author?.name ?? "Unknown Author",
        message: c.commit.message.split("\n")[0]
    }));
}

async function fetchUpdates() {
    lastCheckError = null;

    // Check for new release
    try {
        const plan = planUpdate(await getLatestRelease());
        if (plan) {
            PendingUpdate = plan;
            return true;
        }
    } catch (err) {
        lastCheckError = describeApiError(err);
    }

    // Fallback: check if there are commits ahead
    try {
        const compareData = await githubGet(`/compare/${gitHash}...HEAD`);
        if (compareData.commits.length > 0) {
            // Commits ahead but no release - mark as outdated but no PendingUpdate
            return true;
        }
    } catch (err) {
        if (!lastCheckError) lastCheckError = describeApiError(err);
    }

    return false;
}

function isAsarBuffer(data: Buffer): boolean {
    if (data.length < MIN_ASAR_SIZE) return false;

    // asar files are a 16 byte pickle header followed by a JSON file table
    if (data.readUInt32LE(0) !== 4) return false;

    return data.toString("utf8", 16, 24) === '{"files"';
}

async function downloadUpdate(initialPlan: PendingUpdate): Promise<Buffer> {
    let plan = initialPlan;
    let lastError: any;

    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        // the asset we resolved first, then the canonical latest-download url which stays
        // valid even after a rolling release replaces the asset object
        for (const url of [plan.url, `${LATEST_DOWNLOAD_BASE}/${ASAR_FILE}`]) {
            try {
                const data = await fetchBuffer(url);
                if (!isAsarBuffer(data)) throw new Error(`${url} did not return a valid asar archive`);
                return data;
            } catch (err: any) {
                lastError = err;
                // only 404/410 mean the asset moved; anything else will not fix itself on retry
                if (!/\b(404|410)\b/.test(String(err?.message))) throw new Error(describeApiError(err));
            }
        }

        if (attempt < DOWNLOAD_ATTEMPTS) {
            // the release assets are being replaced under us, so re-read the release and wait a moment
            await sleep(RETRY_DELAY * attempt);
            try {
                const fresh = planUpdate(await getLatestRelease(true));
                if (fresh) plan = fresh;
            } catch { /* keep the previous plan */ }
        }
    }

    throw new Error(
        `Could not download ${ASAR_FILE} after ${DOWNLOAD_ATTEMPTS} attempts: ${describeApiError(lastError)}. ` +
        "The release is probably mid-upload, try again in a minute."
    );
}

async function applyUpdates() {
    if (!PendingUpdate) {
        throw new Error(lastCheckError
            ? `Could not check for updates: ${lastCheckError}`
            : "No release available. Commits are ahead but no new release has been published yet.");
    }

    const data = await downloadUpdate(PendingUpdate);
    writeFileSync(__dirname, data, { flush: true });

    PendingUpdate = null;

    return true;
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
