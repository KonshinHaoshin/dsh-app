# 手机端验收

日期：2026-11-04（Asia/Taipei）。作者：konshinhaoshin。版本：0.3.0。

- TypeScript 检查与 Vite 生产构建成功。
- `npm test`：11 / 11 通过，覆盖二维码校验、会话恢复、工作区、推理元数据/默认值、模型切换时清理不支持的强度、投影同步，以及更新版本比较、下载来源校验和网络错误。
- `npm run test:ui`：8 / 8 通过。除原有手机布局、配对与工作区外，验证完整推理设置请求、电脑端选择事件同步、失败保留旧值、新会话先设置强度再发送，以及发现更新、下载入口、最新版本和失败重试。
- 真实桌面 DSH 的 `session/modelCatalog`：读取到 154 个模型，其中 135 个提供推理强度元数据；手机按 Host 返回的档位生成选项，不扩展插件权限或修改后端。
- `npm run android:release`：从独立仓库构建网页、同步 Capacitor、执行 Gradle `assembleDebug` 成功，生成 APK、SHA-256 校验值和更新清单。
- 新旧 APK 的签名证书相同；Pixel 3 通过 USB 覆盖安装成功，versionName 为 `0.3.0`、versionCode 为 `3`。原生版本信息与外部浏览器插件已在手机 WebView 中注册。
- 应用 ID：`moe.shelterhub.dsh`；最低 Android：8.0 / API 26。构建环境：JDK 21、SDK Platform 35、Build Tools 35.0.0、Gradle Wrapper 8.11.1。

更新采用手动检查并交由系统浏览器下载 APK，随后由用户按系统提示安装；不静默安装。清单来自公开仓库，不包含配对密钥或中继认证信息。

推理设置变更的请求与失败恢复通过协议模拟验收；本次没有向真实模型发送任务。iOS 保留共用代码，未创建或验收签名安装包。仓库仍不包含后端、中继服务或 DSH 插件实现。
