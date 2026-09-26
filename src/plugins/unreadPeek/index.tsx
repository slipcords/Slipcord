/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu, MessageStore, Modal, ReadStateStore, openModal, React, Toasts, UserStore } from "@webpack/common";

const cl = classNameFactory("vc-unreadpeek-");
const currentUserId = () => UserStore.getCurrentUser()?.id;

const settings = definePluginSettings({
    maxMessages: {
        type: OptionType.NUMBER,
        description: "Maximum unread messages to show in the peek",
        default: 25,
        markers: [5, 10, 25, 50, 100],
        componentProps: { step: 5 }
    },
    includeMentionsOnly: {
        type: OptionType.BOOLEAN,
        description: "Only include messages that mention you",
        default: false
    }
});

function getUnreads(channelId: string): any[] {
    const msgStore = MessageStore.getMessages(channelId);
    const out: any[] = [];
    const limit = settings.store.maxMessages;
    const oldestUnread = ReadStateStore.getOldestUnreadMessageId(channelId);
    const me = currentUserId();

    if (!oldestUnread) {
        // No tracked unread marker - show the most recent cached messages
        const buf: any[] = [];
        msgStore.some(msg => {
            buf.unshift(msg);
            return buf.length >= limit;
        });
        return buf;
    }

    let started = false;
    msgStore.some(msg => {
        if (!started && BigInt(msg.id) >= BigInt(oldestUnread)) started = true;
        if (!started) return false;
        if (settings.store.includeMentionsOnly && me && !isMentioned(msg, me)) return false;
        out.push(msg);
        return out.length >= limit;
    });
    return out;
}

function isMentioned(msg: any, userId: string): boolean {
    const mentions = (msg.mentions ?? []).map((m: any) => m?.id ?? m).concat(msg.mention_user_ids ?? []);
    return mentions.includes(userId);
}

const PeekModal = ({ modalProps, channelId }: { modalProps: any; channelId: string; }) => {
    const messages = getUnreads(channelId) as any[];
    const channel = ChannelStore.getChannel(channelId);
    const list = messages.length
        ? messages
        : [{ id: "empty", content: "No cached unread messages found. Open the channel to load them." }];

    return (
        <Modal
            {...modalProps}
            title={`Unreads in ${channel ? `#${channel.name}` : channelId}`}
            actions={[{ text: "Mark channel read", variant: "primary", onClick: () => { Toasts.show({ message: "Navigate to the channel to mark it read", type: "MESSAGE" as any }); modalProps.onClose(); } }]}
        >
            <div className={cl("list")}>
                {list.map(msg => (
                    <div key={msg.id} className={cl("row")}>
                        {msg.id !== "empty" && msg.author?.avatar &&
                            <img className={cl("avatar")} src={`https://${window.GLOBAL_ENV?.CDN_HOST ?? "cdn.discordapp.com"}/avatars/${msg.author.id}/${msg.author.avatar}.png?size=40`} alt="" />}
                        <div className={cl("content")}>
                            {msg.id !== "empty" && msg.author?.username &&
                                <span className={cl("author")}>{msg.author.username}</span>}
                            <span className={cl("text")}>{msg.id === "empty" ? msg.content : (msg.content || (msg.attachments?.[0]?.url ? "[attachment]" : "[embed]"))}</span>
                        </div>
                    </div>
                ))}
            </div>
        </Modal>
    );
};

const channelContextMenuPatch: any = (children: any[], { channel }: any) => {
    if (!channel?.id) return;
    const group: any[] = children;
    group.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-unread-peek"
                label="Peek Unreads"
                action={() => openModal((props: any) => <PeekModal modalProps={props} channelId={channel.id} />)}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "UnreadPeek",
    description: "Right-click a channel to peek at cached unread messages without leaving your current view",
    tags: ["Chat", "Utility"],
    authors: [Devs.tired55],
    settings,
    contextMenus: {
        channel: channelContextMenuPatch
    }
});
