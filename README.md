# DSH App

**作者：konshinhaoshin**

DeepSeek Harness 手机客户端，采用简约蓝白界面。Android 优先，共用 React / TypeScript 界面和 iOS 连接协议代码。

## 安装 Android App

下载 [DSH Android v0.4.0 APK](releases/v0.4.0/dsh-mobile-0.4.0-debug.apk)，在手机上安装。支持 **Android 8.0 及以上**。

这是可直接安装的调试签名 APK，尚未配置商店发布签名。自行构建时应保留相同签名密钥，才能覆盖更新同签名的旧版本。

## 连接 DSH

1. 电脑端安装 [DSH App Plugin](https://github.com/KonshinHaoshin/dsh-app-plugin)。
2. 电脑 DSH 打开「设置 → 手机连接」，启用局域网或配置公网连接，并生成二维码。
3. 手机打开「连接 → 扫一扫」完成配对。也可使用配对链接或展开手动连接。

支持局域网直连和公网 WSS；默认公网服务地址为 `https://dshapi.shelterhub.moe`。公网连接仍需电脑插件已配置并连接中继。仓库不包含配对密钥或中继认证信息。

## 连接多台电脑

在「连接」面板点击「添加电脑 · 扫一扫」，依次扫描各台电脑的二维码。已添加的电脑会保留连接，点击列表项即可切换当前工作台；页面顶部始终显示正在操作的电脑。

- 各电脑的会话、工作区、草稿、模型和审批分别保存，切换时不会互相覆盖。
- 连接列表显示在线状态和待审批数量；电脑可以重命名、单独断开、重新连接或移除。
- 多台电脑可使用同一公网中继，每台电脑应使用独立的设备 ID；新安装的配套插件会自动生成。
- 以服务地址和设备 ID 区分连接，名称相同或不同服务使用相同设备 ID 时仍保留独立记录。
- Android 自动迁移旧版连接，并使用 Keystore 的 AES-GCM 密钥加密保存配对信息；设备列表同步写入原生存储。重启 App 后会重新连接已启用的电脑。

App 在前台可同时保持多条连接。Android 息屏或系统挂起 App 时，连接恢复受系统生命周期约束，目前没有后台保活服务或推送。

## 功能

- 查看和续接电脑上的会话，流式接收回复和执行记录。
- 搜索工作区、查看完整目录路径，按工作区筛选和新建会话。
- 切换模型与推理强度、停止任务、一次性工具审批和历史分页。
- 通过 Android 原生相机扫码；浏览器版本使用网页相机识别。
- 网络恢复后重新订阅状态；不会自动重发改变状态的操作。
- 浅色 / 深色界面，适配手机和横屏。
- 手动检查更新、查看新版说明和下载 Android 安装包。

推理强度位于输入框下方模型名称右侧。选项由电脑 DSH 返回，不固定写死档位；不支持推理强度的模型会隐藏该入口。打开会话时读取当前设置，电脑上的后续修改也会同步；新会话可以在首次发送前选择强度。

## 检查更新

打开手机「连接」面板，点击底部的「检查更新」。发现新版本后显示版本说明和「下载更新」；点击后使用系统浏览器下载 APK，按 Android 提示安装。无可用更新、网络错误和超时会明确显示，可以重试。检查更新不要求先连接 DSH。

更新信息来自此仓库 `main` 分支的 `update.json`，下载指向本仓库固定版本标签下的 APK。不会在后台静默下载安装或加载远端 JavaScript。

Android 配对密钥保存在应用私有存储中，由 Android Keystore 加密；原生调用参数日志已关闭。浏览器和当前 iOS 共用代码仍使用每个连接独立的 `sessionStorage` 凭据，新会话可能需要重新扫码。`localStorage` 中的设备列表不包含密钥。局域网 WS 为明文，仅适用于可信私人网络；公网使用 WSS，目前没有端到端加密和后台推送。

## 本地开发

需要 Node.js **22.18+**。

```sh
git clone https://github.com/KonshinHaoshin/dsh-app.git
cd dsh-app
npm ci
npm run dev
```

开发服务器默认端口为 `5178`。通过浏览器连接电脑插件时，需在插件 `allowedOrigins` 中加入实际开发页面来源。手机原生 App 默认来源已受支持。

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

界面测试通过浏览器内 WebSocket mock 验证配对和工作区，不启动后端或调用真实模型。

## 构建 Android APK

安装 **JDK 21**、**Android SDK Platform 35**、**Build Tools 35.0.0**，设置 `JAVA_HOME` 和 `ANDROID_HOME`，然后执行：

```sh
npm ci
npm run android:build
```

输出：

```text
artifacts/dsh-mobile-0.4.0-debug.apk
```

脚本依次构建网页、同步 Capacitor 原生依赖、执行 Gradle `assembleDebug`。为避免 exFAT / 外接磁盘的 AppleDouble 元数据影响 Android 资源解析，Gradle 在系统临时目录中运行，成功后自动清理。

也可用 Android Studio 打开原生工程：

```sh
npm run android:sync
npm run android:open
```

仓库包含 Gradle Wrapper，无需单独安装 Gradle。`android/local.properties`、签名文件、构建缓存和 `node_modules` 不提交。

发布新更新时，同步修改 `package.json` 版本和 Android 的 `versionName` / `versionCode`，填写 `release-notes.md`，然后运行：

```sh
npm run android:release
```

该命令构建 APK，并生成 `releases/v<版本>/`、`SHA256SUMS` 和 `update.json`。提交这些文件、创建对应 `v<版本>` 标签后，一起推送即可供手机检查。用于覆盖升级的 APK 必须沿用同一签名；GitHub 临时 runner 自行生成的调试签名与本机签名不同，Actions 产物用于构建验证。

## GitHub 自动打包

推送到 `main`、提交 PR，或在仓库 **Actions → Android APK → Run workflow** 手动运行，会检查手机源码、运行界面测试并打包 Android APK。构建成功后可从该次运行的 `dsh-android-debug` Artifact 下载。

## iOS

目前提供共用的手机界面、协议和 Capacitor 配置，尚未创建或验收 iOS 签名包。需要 macOS / Xcode，可在本地执行：

```sh
npx cap add ios
npm run ios:sync
npx cap open ios
```

在 Xcode 中设置签名；扫码需添加 `NSCameraUsageDescription`，局域网连接需配置本地网络权限和适当 ATS 例外。iPhone 实机运行仍需单独验证。

## 仓库范围

```text
src/          手机界面、二维码配对、WebSocket 连接与会话投影
public/       App 静态资源
android/      Android 原生工程及 Gradle Wrapper
scripts/      Capacitor 同步和 APK 构建
tests/        手机端单元测试与浏览器界面测试
releases/     可安装 APK 与 SHA-256 校验值
```

此仓库只提交手机端。电脑插件位于独立的 [dsh-app-plugin 仓库](https://github.com/KonshinHaoshin/dsh-app-plugin)；后端、中继服务和服务器部署配置不包含在这里。

Copyright © 2026 konshinhaoshin.
