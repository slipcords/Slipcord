/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ImageIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, MessageStore, Modal, openModal, React, useState } from "@webpack/common";

const logger = new Logger("MediaGalleryView");

const settings = definePluginSettings({
    maxItems: {
        type: OptionType.NUMBER,
        description: "Maximum media items to render in the gallery",
        default: 120,
        markers: [30, 60, 120, 240, 480],
        componentProps: { step: 30 }
    },
    includeImages: {
        type: OptionType.BOOLEAN,
        description: "Include static image attachments",
        default: true
    },
    includeGifs: {
        type: OptionType.BOOLEAN,
        description: "Include GIF attachments",
        default: true
    },
    includeVideos: {
        type: OptionType.BOOLEAN,
        description: "Include video attachments (thumbnails)",
        default: true
    },
    sortByNewest: {
        type: OptionType.BOOLEAN,
        description: "Render newest media first",
        default: true
    }
});

function isImage(ct: string) { return ct?.startsWith("image/") && !ct?.includes("gif"); }
function isGif(ct: string, filename: string) { return ct?.includes("gif") || /\.gif$/i.test(filename); }
function isVideo(ct: string) { return ct?.startsWith("video/") || ct?.includes("quicktime") || ct?.includes("x-matroska"); }

function collectMedia(channelId: string): any[] {
    const out: any[] = [];
    const msgs = MessageStore.getMessages(channelId);
    if (!msgs) return out;
    msgs.some(msg => {
        const attachments = msg?.attachments ?? [];
        for (const att of attachments) {
            const ct = att.content_type ?? "";
            const ok = (settings.store.includeImages && isImage(ct))
                || (settings.store.includeGifs && isGif(ct, att.filename ?? ""))
                || (settings.store.includeVideos && isVideo(ct));
            if (ok && att.proxy_url) {
                out.push({ ...att, url: att.proxy_url, ts: msg?.timestamp ?? 0 });
            }
            if (out.length >= settings.store.maxItems) return true;
        }
        return false;
    });
    if (settings.store.sortByNewest) out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return out;
}

const GalleryButton: ChatBarButtonFactory = ({ channel }) => {
    const [loading, setLoading] = useState(false);
    if (!channel?.id || !ChannelStore.getChannel(channel.id)) return null;
    const mediaCount = collectMedia(channel.id).length;
    if (mediaCount === 0) return null;
    return (
        <ChatBarButton
            tooltip={`${mediaCount} media items - open gallery`}
            onClick={() => {
                setLoading(true);
                openModal((props: any) => <GalleryModal modalProps={props} channelId={channel.id} />);
                setLoading(false);
            }}
            buttonProps={{ style: { marginRight: 4 } }}
        >
            <span style={{ fontSize: 16 }}>🖼️</span>
        </ChatBarButton>
    );
};

function GalleryModal({ modalProps, channelId }: { modalProps: any; channelId: string; }) {
    const [media] = useState(() => collectMedia(channelId));
    const channel = ChannelStore.getChannel(channelId);
    return (
        <Modal
            {...modalProps}
            title={`Media gallery - ${channel ? `#${channel.name}` : channelId}`}
            actions={[{ text: "Close", variant: "primary", onClick: () => modalProps.onClose() }]}
        >
            <div className="vc-mgv-grid">
                {media.length === 0
                    ? <span style={{ padding: 8 }}>No media in cached messages.</span>
                    : media.map(item => (
                        <div key={item.id} className="vc-mgv-item">
                            {isVideo(item.content_type ?? "") || /\.mp4$/i.test(item.url)
                                ? <video src={item.url} className="vc-mgv-media" />
                                : <img src={item.url} className="vc-mgv-media" alt="" loading="lazy" />}
                        </div>
                        ))}
            </div>
        </Modal>
    );
}

export default definePlugin({
    name: "MediaGalleryView",
    description: "Browse all image, GIF and video attachments cached in the current channel as a gallery",
    tags: ["Media", "Chat"],
    authors: [Devs.tired55],
    settings,
    dependencies: ["ChatInputButtonAPI"],

    chatBarButton: {
        icon: ImageIcon,
        render: GalleryButton
    }
});
