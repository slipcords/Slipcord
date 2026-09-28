/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { SlipcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

const API = "https://api2.deadbyqueue.com";
const TIMEOUT_MS = 10_000;

interface QueueSide {
    time: string;
}

interface QueueRegion {
    killer?: QueueSide;
    survivor?: QueueSide;
}

interface QueuesResponse {
    lastupdated: string;
    queues: Record<string, Record<string, QueueRegion>>;
}

const MODES = {
    normal: "live",
    live: "live",
    event: "live-event",
    "live-event": "live-event",
    ptb: "ptb",
    "ptb-event": "ptb-event"
} as const;

const MODE_NAMES: Record<string, string> = {
    "live": "Normal",
    "live-event": "Event",
    "ptb": "Public Test Build",
    "ptb-event": "Public Test Build (event)"
};

const REGIONS = {
    "us-east-1": "USA, Virginia",
    "us-east-2": "USA, Ohio",
    "us-west-1": "USA, California",
    "us-west-2": "USA, Oregon",
    "ca-central-1": "Canada, Montreal",
    "eu-west-1": "Europe, Dublin",
    "eu-west-2": "Europe, London",
    "eu-central-1": "Europe, Frankfurt",
    "ap-south-1": "Asia Pacific, Mumbai",
    "ap-east-1": "Asia Pacific, Hong Kong",
    "ap-northeast-1": "Asia Pacific, Tokyo",
    "ap-northeast-2": "Asia Pacific, Seoul",
    "ap-southeast-1": "Asia Pacific, Singapore",
    "ap-southeast-2": "Asia Pacific, Sydney",
    "sa-east-1": "South America, Sao Paulo"
} as const;

const DEFAULT_REGION = "eu-west-1";
const DEFAULT_MODE = "live";

function formatQueueTime(side: QueueSide | undefined): string {
    if (!side) return "Offline";
    if (side.time === "x") return "Dead queue";

    const seconds = parseInt(side.time, 10);
    if (Number.isNaN(seconds)) return "Unknown";

    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return minutes > 0 ? `${minutes}:${rest.toString().padStart(2, "0")}` : `${rest}s`;
}

export default definePlugin({
    name: "DeadByQueueTimes",
    description: "Run /dbdq to check Dead by Daylight queue times for a region and mode.",
    authors: [SlipcordDevs.boss],
    tags: ["Commands", "Utility", "Fun"],
    searchTerms: ["dbd", "dead by daylight", "queue"],
    commands: [
        {
            name: "dbdq",
            description: "Show Dead by Daylight queue times for a region and mode.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "region",
                    description: "Region to check, defaults to Europe (Dublin)",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
                {
                    name: "mode",
                    description: "Game mode, defaults to Normal",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
            ],
            execute: async (_, ctx) => {
                const regionArg = findOption<string>(_, "region")?.trim().toLowerCase();
                const modeArg = findOption<string>(_, "mode")?.trim().toLowerCase();

                const region = regionArg && regionArg in REGIONS ? regionArg : DEFAULT_REGION;
                const modeKey = modeArg && modeArg in MODES ? MODES[modeArg as keyof typeof MODES] : DEFAULT_MODE;

                const regionNames = Object.keys(REGIONS) as (keyof typeof REGIONS)[];
                if (regionArg && !(regionArg in REGIONS)) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Unknown region "${regionArg}". Try one of: ${regionNames.join(", ")}.`,
                    });
                    return;
                }

                const modeNames = Object.keys(MODES);
                if (modeArg && !(modeArg in MODES)) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Unknown mode "${modeArg}". Try one of: ${modeNames.join(", ")}.`,
                    });
                    return;
                }

                sendBotMessage(ctx.channel.id, { content: "Fetching queue times..." });

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

                let data: QueuesResponse;
                try {
                    const res = await fetch(`${API}/queues`, {
                        headers: { Accept: "application/json" },
                        signal: controller.signal
                    });
                    if (!res.ok)
                        throw new Error(`HTTP ${res.status}`);
                    data = await res.json();
                } catch (err) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Could not reach Dead by Queue. ${err instanceof Error && err.name === "AbortError" ? "The request timed out." : "Try again in a moment."}`,
                    });
                    return;
                } finally {
                    clearTimeout(timeout);
                }

                const modeQueues = data.queues[modeKey];
                if (!modeQueues) {
                    sendBotMessage(ctx.channel.id, {
                        content: `${MODE_NAMES[modeKey] ?? modeKey} queues are not being reported right now.`,
                    });
                    return;
                }

                const entry = modeQueues[region];
                if (!entry) {
                    sendBotMessage(ctx.channel.id, {
                        content: `${REGIONS[region]} is offline in ${MODE_NAMES[modeKey] ?? modeKey} mode.`,
                    });
                    return;
                }

                sendBotMessage(ctx.channel.id, {
                    content: [
                        `**${MODE_NAMES[modeKey] ?? modeKey} queues in ${REGIONS[region]}**`,
                        `Killer: ${formatQueueTime(entry.killer)}`,
                        `Survivor: ${formatQueueTime(entry.survivor)}`,
                        `-# Updated ${data.lastupdated} UTC`
                    ].join("\n")
                });
            },
        },
    ],
});
