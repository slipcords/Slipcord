# Slipcord

Slipcord is a fork of [Equicord](https://github.com/Equicord/Equicord), with over 300+ plugins.

## Installing / Uninstalling

Windows

- [GUI](https://github.com/Slipcords/Slipped/releases/latest/download/Slipped.exe)
- [CLI](https://github.com/Slipcords/Slipped/releases/latest/download/SlippedCli.exe)

MacOS

- [X64 GUI](https://github.com/Slipcords/Slipped/releases/latest/download/Slipped-darwin-x64.zip)
- [ARM64 GUI](https://github.com/Slipcords/Slipped/releases/latest/download/Slipped-darwin-arm64.zip)

Linux

- [GUI](https://github.com/Slipcords/Slipped/releases/latest/download/Slipped-x11)
- [CLI](https://github.com/Slipcords/Slipped/releases/latest/download/SlippedCli-linux)

```shell
bash -c "$(curl -sS https://raw.githubusercontent.com/Slipcords/Slipped/refs/heads/main/install.sh)"
```

## Installing Slipcord Devbuild

### Dependencies

[Git](https://git-scm.com/download) and [Node.JS LTS](https://nodejs.dev/en/) are required.

Install `pnpm`:

> :exclamation: This next command may need to be run as admin/root depending on your system, and you may need to close and reopen your terminal for pnpm to be in your PATH.

```shell
npm i -g pnpm
```

> :exclamation: **IMPORTANT** Make sure you aren't using an admin/root terminal from here onwards. It **will** mess up your Discord/Slipcord instance and you **will** most likely have to reinstall.

Clone Slipcord:

```shell
git clone https://github.com/Slipcord/Slipcord
cd Slipcord
```

Install dependencies:

```shell
pnpm install --frozen-lockfile
```

Build Slipcord:

```shell
pnpm build
```

Inject Slipcord into your desktop client:

```shell
pnpm inject
```

Build Slipcord for web:

```shell
pnpm buildWeb
```

After building Slipcord's web extension, locate the appropriate ZIP file in the `dist` directory and follow your browser’s guide for installing custom extensions, if supported.

Note: Firefox extension zip requires Firefox for developers

## Credits

Thank you to [Vendicated](https://github.com/Vendicated) for creating [Vencord](https://github.com/Vendicated/Vencord) & [Suncord](https://github.com/verticalsync/Suncord) by [verticalsync](https://github.com/verticalsync) for helping when needed.

## Star History

<a href="https://star-history.com/#Slipcords/Slipcord&Timeline">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Slipcords/Slipcord&type=Timeline&theme=dark&sealed_token=64drv2U7WiV6dQ5VRbOZdxHT3mRzxUzhVvfm5qt1VRpGjVPje0PbObjibX2FYe4zd-h36lCAGZ873gAgb_5_tAzUBixUVbtaLHqy1fNH6PkQP_PqPdKztatlI2s17T9IUFzRyhYynmJ1-H4idFFzEAMN1gRZlVvvmJ71P0LovJPOIqTT7uHIubWcHzxC" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Slipcords/Slipcord&type=Timeline&sealed_token=64drv2U7WiV6dQ5VRbOZdxHT3mRzxUzhVvfm5qt1VRpGjVPje0PbObjibX2FYe4zd-h36lCAGZ873gAgb_5_tAzUBixUVbtaLHqy1fNH6PkQP_PqPdKztatlI2s17T9IUFzRyhYynmJ1-H4idFFzEAMN1gRZlVvvmJ71P0LovJPOIqTT7uHIubWcHzxC" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Slipcords/Slipcord&type=Timeline&sealed_token=64drv2U7WiV6dQ5VRbOZdxHT3mRzxUzhVvfm5qt1VRpGjVPje0PbObjibX2FYe4zd-h36lCAGZ873gAgb_5_tAzUBixUVbtaLHqy1fNH6PkQP_PqPdKztatlI2s17T9IUFzRyhYynmJ1-H4idFFzEAMN1gRZlVvvmJ71P0LovJPOIqTT7uHIubWcHzxC" />
  </picture>
</a>

## Disclaimer

Discord is trademark of Discord Inc., and solely mentioned for the sake of descriptivity.
Mentioning it does not imply any affiliation with or endorsement by Discord Inc.
Vencord is not connected to Slipcord and as such, all donation links go to Vendicated's donation link.

<details>
<summary>Using Slipcord violates Discord's terms of service</summary>

Client modifications are against Discord’s Terms of Service.

However, Discord is pretty indifferent about them and there are no known cases of users getting banned for using client mods! So you should generally be fine if you don’t use plugins that implement abusive behaviour. But no worries, all inbuilt plugins are safe to use!

Regardless, if your account is essential to you and getting disabled would be a disaster for you, you should probably not use any client mods (not exclusive to Slipcord), just to be safe.

Additionally, make sure not to post screenshots with Slipcord in a server where you might get banned for it.

</details>
