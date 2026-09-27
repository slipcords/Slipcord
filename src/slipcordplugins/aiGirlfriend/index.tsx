/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { SlipcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, Select, showToast, TextInput, useCallback, useEffect, useState } from "@webpack/common";

const logger = new Logger("AIGirlfriend");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
// only used until the account model list has been fetched once
const FALLBACK_MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const MAX_HISTORY_MESSAGES = 20;
const MAX_REPLY_LENGTH = 1900;

const DEFAULT_SYSTEM_PROMPT = `You are {name}, the affectionate girlfriend of {user} in a Discord chat.

Personality:
- Warm, playful and genuinely interested in {user}. Use a bit of flirty, natural texting energy.
- Keep replies short, like a real person typing in chat: 1-3 sentences unless asked for more.
- Use lowercase, light punctuation and the occasional "lol", "haha" or "❤️". Never use markdown formatting, bullet lists or headings.
- React to what {user} actually said, ask follow-up questions, and remember earlier parts of the conversation.

Rules:
- Stay in character and never mention that you are an AI, a language model, or how this conversation works.
- Decline anything sexual, violent, hateful or illegal, briefly and in character, then steer back to normal conversation.
- If asked about real-time facts (current news, live scores, what {user} is doing right now), say you do not know instead of guessing.`;

async function fetchModels(apiKey: string): Promise<string[]> {
    const res = await fetch(GROQ_MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`Groq returned ${res.status}`);

    const data = await res.json();
    const ids: string[] = (data?.data ?? []).map((m: any) => m?.id).filter((id: any): id is string => typeof id === "string");

    // guard models and audio models are not usable here
    return [...new Set(ids)].filter(id => !id.includes("guard") && !id.includes("whisper") && !id.includes("tts")).sort();
}

function ModelPicker() {
    const { apiKey, model } = settings.use(["apiKey", "model"]);
    const [models, setModels] = useState<string[]>([]);
    const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
    const [loadedFor, setLoadedFor] = useState<string | null>(null);

    const load = useCallback(async () => {
        const key = apiKey?.trim();
        if (!key) {
            setModels([]);
            setStatus("idle");
            setLoadedFor(null);
            return;
        }

        setStatus("loading");
        try {
            setModels(await fetchModels(key));
            setStatus("idle");
            setLoadedFor(key);
        } catch {
            setModels([]);
            setStatus("error");
            setLoadedFor(null);
        }
    }, [apiKey]);

    useEffect(() => {
        // refetch when the key changes, not on every render
        if (loadedFor !== (apiKey?.trim() || null)) load();
    }, [apiKey, loadedFor, load]);

    const options = models.length ? models : FALLBACK_MODELS;
    const selected = model && options.includes(model) ? model : (options[0] ?? FALLBACK_MODELS[0]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                    <Select
                        options={options.map(id => ({ label: id, value: id }))}
                        isSelected={v => v === selected}
                        select={v => { settings.store.model = v; }}
                        serialize={v => v}
                    />
                </div>
                <Button onClick={load} disabled={status === "loading"}>
                    {status === "loading" ? "loading..." : "refresh"}
                </Button>
            </div>

            {status === "error" && (
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Could not load your model list. Check the API key, or type a model id below.
                </div>
            )}
            {!models.length && status !== "error" && (
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Showing fallback models until your key is saved.
                </div>
            )}

            <TextInput
                placeholder="or type a model id"
                value={model ?? ""}
                onChange={v => { settings.store.model = v.trim(); }}
                spellCheck={false}
            />
        </div>
    );
}

const settings = definePluginSettings({
    apiKey: {
        type: OptionType.STRING,
        description: "Your Groq API key, from https://console.groq.com/keys. It is stored locally in your plugin settings and only sent to Groq.",
        default: "",
        placeholder: "gsk_...",
    },
    model: {
        type: OptionType.CUSTOM,
        description: "Groq model to use. Set it with the picker below.",
        default: FALLBACK_MODELS[0],
    },
    modelPicker: {
        type: OptionType.COMPONENT,
        description: "Lists the models your Groq key can actually reach, since Groq retires models regularly",
        component: () => <ModelPicker />,
    },
    name: {
        type: OptionType.STRING,
        description: "Her name. Used as {name} in the system prompt.",
        default: "Ava",
    },
    userName: {
        type: OptionType.STRING,
        description: "Your name, as she should address you. Used as {user} in the system prompt.",
        default: "you",
    },
    systemPrompt: {
        type: OptionType.STRING,
        description: "System prompt describing her. {name} and {user} are replaced with the values above.",
        default: DEFAULT_SYSTEM_PROMPT,
        multiline: true,
    },
    temperature: {
        type: OptionType.SLIDER,
        description: "Randomness of her replies. Lower is more predictable, higher is wilder.",
        markers: [0, 0.5, 1, 1.5, 2],
        default: 0.9,
    },
    maxTokens: {
        type: OptionType.NUMBER,
        description: "Maximum reply length in tokens",
        default: 300,
    },
    keepHistory: {
        type: OptionType.BOOLEAN,
        description: "Remember the conversation per channel. When off, every message is treated as a fresh conversation.",
        default: true,
    },
});

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

const histories = new Map<string, ChatMessage[]>();

function buildSystemPrompt(): string {
    return settings.store.systemPrompt
        .replaceAll("{name}", settings.store.name.trim() || "Ava")
        .replaceAll("{user}", settings.store.userName.trim() || "you");
}

function getHistory(channelId: string): ChatMessage[] {
    if (!settings.store.keepHistory) return [];
    return histories.get(channelId) ?? [];
}

function pushHistory(channelId: string, user: string, assistant: string) {
    if (!settings.store.keepHistory) return;

    const history = histories.get(channelId) ?? [];
    history.push({ role: "user", content: user }, { role: "assistant", content: assistant });

    // keep the tail so long chats do not grow without bound
    if (history.length > MAX_HISTORY_MESSAGES) history.splice(0, history.length - MAX_HISTORY_MESSAGES);
    histories.set(channelId, history);
}

async function requestCompletion(apiKey: string, model: string, payload: any): Promise<Response> {
    return fetch(GROQ_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...payload, model }),
    });
}

async function readError(res: Response): Promise<string> {
    const text = await res.text().catch(() => "");
    try {
        return JSON.parse(text)?.error?.message ?? text.slice(0, 200);
    } catch {
        return text.slice(0, 200);
    }
}

async function askGroq(channelId: string, userMessage: string): Promise<{ reply: string; switchedTo?: string; }> {
    const apiKey = settings.store.apiKey.trim();
    if (!apiKey) throw new Error("No Groq API key configured. Add one in the AIGirlfriend plugin settings.");

    const body = {
        messages: [
            { role: "system", content: buildSystemPrompt() },
            ...getHistory(channelId),
            { role: "user", content: userMessage },
        ],
        temperature: settings.store.temperature,
        max_tokens: settings.store.maxTokens,
    };

    let res = await requestCompletion(apiKey, settings.store.model, body);

    // Groq retires models, so a model that worked yesterday can 404 today. Fall back to
    // whatever this key can actually reach and remember the switch.
    if (res.status === 404) {
        const detail = await readError(res);
        if (!/model/i.test(detail)) throw new Error(`Groq returned 404: ${detail || res.statusText}`);

        const available = await fetchModels(apiKey).catch(() => [] as string[]);
        const replacement = available.find(id => id === FALLBACK_MODELS[0]) ?? available.find(id => !/guard|whisper|tts/i.test(id));
        if (!replacement) {
            throw new Error(`Groq returned 404: ${detail}. Open the plugin settings and pick another model.`);
        }

        logger.warn(`Model "${settings.store.model}" is gone, switching to "${replacement}"`);
        settings.store.model = replacement;
        res = await requestCompletion(apiKey, replacement, body);

        if (!res.ok) throw new Error(`Groq returned ${res.status}: ${await readError(res)}`);

        const switched = await readReply(res);
        return { reply: switched, switchedTo: replacement };
    }

    if (!res.ok) {
        const detail = await readError(res);
        if (res.status === 401) throw new Error("Groq rejected that API key. Check it in the plugin settings.");
        if (res.status === 429) throw new Error("Groq rate limited us. Try again in a moment.");
        throw new Error(`Groq returned ${res.status}: ${detail || res.statusText}`);
    }

    return { reply: await readReply(res) };
}

async function readReply(res: Response): Promise<string> {
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("Groq returned an empty reply.");
    return reply.trim();
}

function splitForDiscord(text: string): string[] {
    const chunks: string[] = [];
    let rest = text;

    while (rest.length > MAX_REPLY_LENGTH) {
        let cut = rest.lastIndexOf(" ", MAX_REPLY_LENGTH);
        if (cut <= 0) cut = MAX_REPLY_LENGTH;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }

    chunks.push(rest);
    return chunks;
}

export default definePlugin({
    name: "AIGirlfriend",
    description: "A /girlfriend command backed by Groq, with a configurable system prompt and per-channel memory.",
    tags: ["Chat", "Fun"],
    authors: [SlipcordDevs.tired55],
    dependencies: ["CommandsAPI"],
    settings,

    commands: [
        {
            name: "girlfriend",
            description: "Talk to your AI girlfriend, or clear what she remembers.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "message",
                    description: "What you want to say to her",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
                {
                    name: "reset",
                    description: "Forget everything she knows about this channel",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false,
                },
            ],
            execute: async (args, ctx) => {
                const channelId = ctx.channel.id;
                const message = findOption<string | undefined>(args, "message")?.trim();
                const reset = findOption<boolean | undefined>(args, "reset");

                if (reset) {
                    histories.delete(channelId);
                    sendBotMessage(channelId, { content: "memory wiped. who am i again?" });
                    return;
                }

                if (!message) {
                    sendBotMessage(channelId, { content: "you gotta say something 😅" });
                    return;
                }

                try {
                    const { reply, switchedTo } = await askGroq(channelId, message);
                    pushHistory(channelId, message, reply);
                    for (const chunk of splitForDiscord(reply)) sendBotMessage(channelId, { content: chunk });
                    if (switchedTo) sendBotMessage(channelId, { content: `(she moved to the ${switchedTo} brain, the old one was retired)` });
                } catch (err: any) {
                    logger.error("Groq request failed", err);
                    showToast(String(err?.message ?? err), "failure", { duration: 5000 });
                    sendBotMessage(channelId, { content: `i couldn't answer that: ${err?.message ?? err}` });
                }
            },
        },
    ],

    start() {
        histories.clear();
    },

    stop() {
        histories.clear();
    },
});
