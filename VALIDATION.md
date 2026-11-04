# 手机端验收

日期：2026-11-04（Asia/Taipei）。作者：konshinhaoshin。

- 使用独立仓库自己的 `package.json` / `package-lock.json` 执行 `npm ci --ignore-scripts`，安装成功；没有引用原项目的工作区、插件或中继源码。
- `npm test`：6 / 6 通过，覆盖二维码链接校验、过期 / 不安全地址拒绝、对话流恢复与去重、工具结果投影、工作区路径和 ID 保留。
- `npm run test:ui`：3 / 3 通过，覆盖简洁连接面板、无效配对提示、明暗外观、横屏、桌面布局，以及用纯浏览器 WebSocket mock 验证配对和工作区搜索。
- `npm run android:build`：从独立仓库构建网页、同步 Capacitor、执行 Gradle `assembleDebug` 成功，生成 `dsh-mobile-0.2.0-debug.apk`。
- 构建环境：JDK 21、Android SDK Platform 35、Build Tools 35.0.0、Gradle Wrapper 8.11.1。
- 手机应用 ID：`moe.shelterhub.dsh`；版本：`0.2.0` / versionCode `2`；最低 Android 版本：8.0 / API 26。
- 保留原有手机功能代码；本次提交主要为拆分工程、独立依赖、构建脚本和自动打包配置。此次不重新操作用户手机或触发真实模型任务。

仓库包含可直接安装的调试 APK 和 SHA-256 校验值。未配置生产签名、商店发布或 iOS 签名包。GitHub Actions 已配置自动构建；本地构建通过不等于云端构建已运行通过。

仓库不包含后端、中继服务、DSH 插件实现、服务器配置或真实连接密钥。
