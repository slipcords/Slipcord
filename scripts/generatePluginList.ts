/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import { readdirSync, writeFileSync } from "fs";
import { getEntryPoint, isPluginFile, parseDevs, parseSlipcordDevs, parseFile, PluginData } from "./utils";

(async () => {
    parseDevs();
    parseSlipcordDevs();

    const args = process.argv.slice(2);

    const slipcordFlag = args.includes("--slipcord");
    const vencordFlag = args.includes("--vencord");

    let dirs: string[];

    if (slipcordFlag) {
        dirs = ["src/slipcordplugins/_core", "src/slipcordplugins"];
    } else if (vencordFlag) {
        dirs = ["src/plugins", "src/plugins/_core"];
    } else {
        dirs = ["src/plugins", "src/plugins/_core", "src/slipcordplugins/_core", "src/slipcordplugins"];
    }

    const outputPath = args.find(a => !a.startsWith("--")) ?? null;

    const plugins = [] as PluginData[];

    await Promise.all(
        dirs.flatMap(dir =>
            readdirSync(dir, { withFileTypes: true })
                .filter(isPluginFile)
                .map(async dirent => {
                    const [data] = await parseFile(await getEntryPoint(dir, dirent));
                    plugins.sort().push(data);
                })
        )
    );

    const data = JSON.stringify(plugins);

    if (outputPath) {
        writeFileSync(outputPath, data);
    } else {
        console.log(data);
    }
})();
