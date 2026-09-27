/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

import pluginStyle from "./style.css?managed";

const logger = new Logger("DynamicThemeTwilight");
const RAD = Math.PI / 180;

const settings = definePluginSettings({
    latitude: {
        type: OptionType.NUMBER,
        description: "Your latitude in decimal degrees (east positive ignored; north positive)",
        default: 51.5
    },
    longitude: {
        type: OptionType.NUMBER,
        description: "Your longitude in decimal degrees (east positive)",
        default: -0.12
    },
    useSystemLocation: {
        type: OptionType.BOOLEAN,
        description: "Try to fetch your location from the browser on start",
        default: false
    },
    nightWarmth: {
        type: OptionType.SLIDER,
        description: "Maximum color temperature warmness at night",
        default: 100,
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: true
    },
    transitionMinutes: {
        type: OptionType.SLIDER,
        description: "How long the filter ramps in/out around sunrise and sunset",
        default: 60,
        markers: [15, 30, 60, 120, 240],
        stickToMarkers: true
    }
});

let geoTimer: ReturnType<typeof setInterval> | null = null;
let locationResolved = false;

interface SunTimes { sunrise: number; sunset: number; polarDay?: boolean; polarNight?: boolean; }

// Compact NOAA-style sunrise/sunset. Input longitude is east-positive; NOAA uses west-positive.
function computeSunTimes(date: Date, lat: number, lng: number): SunTimes {
    const dayOfYear = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000) + 1;
    const decl = 23.45 * Math.sin(RAD * (360 * (284 + dayOfYear) / 365.25));
    const cosH = -Math.tan(RAD * lat) * Math.tan(RAD * decl);
    if (cosH > 1) return { sunrise: 0, sunset: 24 * 60, polarDay: true };
    if (cosH < -1) return { sunrise: 24 * 60, sunset: 0, polarNight: true };
    const ha = Math.acos(cosH) / RAD; // degrees
    const lngW = -lng; // west positive for the formula
    const solarNoon = (720 - 4 * lngW) / 60; // hours
    const sunrise = solarNoon - (ha * 4) / 60;
    const sunset = solarNoon + (ha * 4) / 60;
    return { sunrise: sunrise * 60, sunset: sunset * 60 };
}

function minutesSinceMidnight(date: Date): number {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function currentWarmth(): number {
    const lat = settings.store.latitude;
    const lng = settings.store.longitude;
    const sun = computeSunTimes(new Date(), lat, lng);
    if (sun.polarDay) return 0;
    if (sun.polarNight) return settings.store.nightWarmth / 100;

    const now = minutesSinceMidnight(new Date());
    const trans = settings.store.transitionMinutes;

    function inWindow(start: number, end: number): boolean {
        if (start <= end) return now >= start && now < end;
        return now >= start || now < end; // wraps midnight
    }

    // Day = between sunrise and sunset
    if (inWindow(sun.sunrise, sun.sunset)) {
        const duskStart = sun.sunset - trans;
        if (now > duskStart) {
            const t = (now - duskStart) / trans;
            return (settings.store.nightWarmth / 100) * t;
        }
        const dawnEnd = sun.sunrise + trans;
        if (now < dawnEnd) {
            const t = (dawnEnd - now) / trans;
            return (settings.store.nightWarmth / 100) * t;
        }
        return 0;
    }
    return settings.store.nightWarmth / 100;
}

function applyFilter() {
    const warmth = currentWarmth();
    const app = document.querySelector(".app-1Yzh6") as HTMLElement | null;
    if (!app) return;
    if (warmth > 0) {
        const sepia = warmth;
        const hue = -15 * warmth;
        const contrast = 1 + 0.04 * warmth;
        const brightness = 1 + 0.03 * warmth;
        app.style.setProperty("--vc-twilight-filter", `sepia(${sepia}) hue-rotate(${hue}deg) contrast(${contrast}) brightness(${brightness})`);
    } else {
        app.style.setProperty("--vc-twilight-filter", "none");
    }
}

function fetchLocation() {
    if (!navigator.geolocation) { locationResolved = true; return; }
    navigator.geolocation.getCurrentPosition(
        pos => {
            settings.store.latitude = pos.coords.latitude;
            settings.store.longitude = pos.coords.longitude;
            locationResolved = true;
            applyFilter();
        },
        () => { locationResolved = true; },
        { enableHighAccuracy: false, timeout: 4000 }
    );
}

function nextTransit(date: Date, lat: number, lng: number) {
    const sun = computeSunTimes(date, lat, lng);
    const now = minutesSinceMidnight(date);
    const events = [
        { t: sun.sunrise, label: "sunrise" },
        { t: sun.sunset, label: "sunset" }
    ].filter(e => e.t > now).sort((a, b) => a.t - b.t);
    const next = events[0];
    if (!next) {
        const sun2 = computeSunTimes(new Date(date.getTime() + 86400000), lat, lng);
        return { label: sun2.sunrise <= sun2.sunset ? "sunrise" : "sunset", minutes: nextDayMinutes(sun2, date, true) };
    }
    return { label: next.label, minutes: next.t - now };
}

function nextDayMinutes(sun: SunTimes, ref: Date, advance: boolean) {
    const target = sun.sunrise <= sun.sunset ? sun.sunrise : sun.sunset;
    const now = minutesSinceMidnight(ref);
    return 24 * 60 - now + target;
}

function Dashboard() {
    const sun = computeSunTimes(new Date(), settings.store.latitude, settings.store.longitude);
    const nxt = nextTransit(new Date(), settings.store.latitude, settings.store.longitude);
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
    return (
        <section>
            <Paragraph>
                Shifts Discord's color temperature with the sun - warmer at night, neutral during the day - based on your sunrise/sunset.
            </Paragraph>
            <Button style={{ marginTop: 10 }} onClick={() => { fetchLocation(); }}>Fetch my location</Button>
            <Paragraph style={{ marginTop: 10, fontSize: 12 }}>
                Latitude: {settings.store.latitude}, Longitude: {settings.store.longitude}
            </Paragraph>
            {sun.polarDay ? <Paragraph>Polar day - no sunset.</Paragraph>
             : sun.polarNight ? <Paragraph>Polar night - no sunrise.</Paragraph>
             : (
                 <Paragraph>Sunrise {fmt(sun.sunrise)}, Sunset {fmt(sun.sunset)}. Next: {nxt.label} in {Math.round(nxt.minutes)} min.</Paragraph>
             )}
        </section>
    );
}

export default definePlugin({
    name: "DynamicThemeTwilight",
    description: "Shifts Discord's color temperature with the sun - warmer evenings, cooler days - using your sunrise/sunset times",
    tags: ["Appearance", "Utility"],
    authors: [Devs.tired55],
    settings,

    settingsAboutComponent() {
        return <Dashboard />;
    },

    start() {
        if (settings.store.useSystemLocation) fetchLocation();
        enableStyle(pluginStyle);
        applyFilter();
        geoTimer = setInterval(applyFilter, 120_000);
    },

    stop() {
        if (geoTimer) clearInterval(geoTimer);
        geoTimer = null;
        const app = document.querySelector(".app-1Yzh6") as HTMLElement | null;
        if (app) app.style.removeProperty("--vc-twilight-filter");
        disableStyle(pluginStyle);
    }
});
