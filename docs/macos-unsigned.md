# macOS 未签名安装与构建

DSH Remote 的 macOS 产物是**未签名、未公证**的 universal 构建（同时包含 Intel 与 Apple Silicon）。macOS 的 Gatekeeper 会因此拦截首次打开，需要手动放行。这不是应用损坏，而是 v1 有意不做 Apple Developer 签名/公证。

Windows 安装包同样未签名，首次运行会有 SmartScreen 提示。

## 1. 安装未签名 DMG

产物文件名形如 `DSH-Remote-0.1.1-mac-universal.dmg`。

1. 双击打开 DMG。
2. 把 **DSH Remote** 拖进 `/Applications`。
3. 首次打开任选一种方式放行：
   - **右键打开（推荐）**：在 Finder 中进入“应用程序”，按住 Control 点击（或右键）DSH Remote → “打开” → 在弹窗中再点“打开”。之后就可以正常双击启动。
   - **系统设置**：先双击一次应用，然后在“系统设置 → 隐私与安全性”页面底部找到被阻止的提示，点击“仍要打开”。
   - **终端清除隔离属性**：

     ```sh
     xattr -dr com.apple.quarantine "/Applications/DSH Remote.app"
     ```

     然后正常双击启动。

4. 如果提示“应用已损坏”或“无法验证开发者”，通常也是 quarantine 造成的，使用上面的 `xattr` 命令后重试。注意路径要指向真正的 `.app`（`/Applications/DSH Remote.app`）。
5. 使用 zip 包时同理：先解压，再对解压出的 `.app` 执行上述操作。

可选检查（出现“被拒绝”是未签名构建的正常结果）：

```sh
codesign -dv "/Applications/DSH Remote.app"   # 通常提示 code object is not signed at all
spctl -a -vv "/Applications/DSH Remote.app"    # 未签名时会被拒绝
```

本机构建出来的产物通常不带 quarantine 属性（该属性是下载传播的），因此本地构建、本地打开一般不会触发拦截。

## 2. 本地构建（需要 macOS）

要求：

- macOS 机器；
- Xcode Command Line Tools（`xcode-select --install`）；
- Node.js 22+ 与 npm。

步骤：

```sh
npm ci
npm run icons     # 可选：重建 build/ 下的图标；图标已提交
npm run dist:mac
```

`npm run dist:mac` 等价于 `npm run build && electron-builder --mac dmg zip --universal`，产出：

- `dist/DSH-Remote-0.1.1-mac-universal.dmg`
- `dist/DSH-Remote-0.1.1-mac-universal.zip`

说明：

- universal 构建会分别打包 x64 与 arm64，再用 `@electron/universal` 合并；第一次执行需要下载两份 Electron 运行时，比较慢。
- 构建配置在 [`electron-builder.yml`](../electron-builder.yml)：`identity: null`、`hardenedRuntime: false`、`gatekeeperAssess: false`、`notarize: false`，因此不会要求任何签名证书。
- `build/icon.icns` 是应用图标。托盘图标（`tray.png`、`trayTemplate.png`、`trayTemplate@2x.png`）通过 `extraResources` 复制到应用的 `Contents/Resources/build/`，供运行时读取。
- 如果构建在签名环节报错，先确认环境里没有设置 `CSC_LINK` / `CSC_KEY_PASSWORD`；CI 通过 `CSC_IDENTITY_AUTO_DISCOVERY=false` 显式关闭证书自动发现。

## 3. 使用 CI 构建

仓库的 [`.github/workflows/build.yml`](../.github/workflows/build.yml) 包含 `macos-latest` job：

1. `npm ci`
2. `npm run test:unit`
3. `npm run dist:mac`
4. 用 `actions/upload-artifact@v4` 上传 `dist/*.dmg` 与 `dist/*.zip`

该 job 不需要任何 Apple secrets，并设置了 `CSC_IDENTITY_AUTO_DISCOVERY=false`。在 GitHub Actions 的运行页面下载 `dsh-remote-macos-universal` artifact，解压后即可得到 DMG/zip；首次打开仍需按第 1 节放行。

如果 CI 的 macOS job 暂时失败（例如应用主流程还在开发中），不影响 Windows 构建；本地按第 2 节构建即可。

## 4. 以后启用签名与公证（不在 v1 范围内）

v1 明确不做签名/公证，也不承诺提供已签名的 macOS 产物。如果以后要正式分发，需要 Apple Developer Program 会员和 Developer ID 证书，主要改动如下：

1. 准备 Developer ID Application 证书（导出为 `.p12`）以及用于公证的 App Store Connect API key，或 Apple ID + app-specific password。
2. 在 CI 中注入 secrets：
   - `CSC_LINK`：`.p12` 的 base64 内容；
   - `CSC_KEY_PASSWORD`：`.p12` 密码；
   - 公证凭据：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，或 API key 形式的 `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`（具体名称以 electron-builder 版本文档为准）。
3. 修改 [`electron-builder.yml`](../electron-builder.yml)：
   - 去掉 `identity: null`（或设置为证书名）；
   - 设置 `hardenedRuntime: true`；
   - 将 `notarize` 设为 `true` 或带 `teamId` 的对象；
   - 按需提供 `build/entitlements.mac.plist`（当前未提供，因为未签名构建不需要）。
4. 在 CI 中让 electron-builder 读取上述 secrets（不要设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，或显式配置证书）。

在完成这些之前，请把 macOS 产物当作内部测试包，并按第 1 节手动放行。