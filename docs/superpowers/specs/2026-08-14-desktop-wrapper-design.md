# dsh 桌面端设计(Electron 壳 + sidecar)

日期:2026-08-14
状态:已批准(用户确认目标场景、平台、技术选型)

## 目标与范围

把 `dsh web`(本地 Node HTTP 服务器 + React SPA)包装成可分发给最终用户的桌面安装包:

- **目标场景**:分发给最终用户,安装包自带运行时,用户无需安装 Node/pnpm。
- **目标平台**:Windows(x64,NSIS 安装器)+ Linux(x64,AppImage/deb)。
- **技术选型**:Electron 壳 + `dsh web` sidecar 子进程(用户从 Electron/Tauri/纯静态三方案中选定)。

不在范围内:macOS、自动更新、代码签名。

## 架构

新增 workspace 包 `apps/desktop`(`@deepseek-ai/dsh-desktop`,`private: true`),与 `apps/web`、`apps/cli` 平级,是第三个产品运行形态,不是 cordis 插件。组成:

- **Electron 主进程**(纯 TS):进程编排、窗口生命周期、sidecar 管理。
- **渲染进程**:不新写前端,加载 sidecar 服务的 `apps/web` SPA dist。
- **sidecar 运行时**:捆绑满足 `^22.19 || >=24` 的独立 Node 二进制放 `extraResources`;不用 Electron 内置 Node(版本随 Electron 走,不满足 engines 且不可控)。
- **sidecar 载荷**:构建好的 dsh CLI 产物的生产安装 + SPA dist。

## 启动 / 握手 / 退出

1. 主进程取单实例锁。
2. spawn `<捆绑node> <resources>/dsh-web --profile web --port 0`。
3. 解析 stdout 的就绪行 `dsh web: http://127.0.0.1:<port>`(`packages/bundle/web-app/src/index.ts` 的 `printUrl`)取得实际端口——这是现有契约,零改动。
4. `BrowserWindow.loadURL("http://127.0.0.1:<port>")`;带超时,失败渲染本地错误页并附 sidecar 日志。
5. 退出:`will-quit` 杀进程树(Windows `taskkill /T /F`;POSIX `detached` 进程组 + SIGTERM→SIGKILL),参考 `packages/subprocess` 本地进程树 provider。

## 安全

- 渲染进程仅加载 loopback URL;`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 浏览器信任栅栏(loopback / DNS-rebinding 防御)原样生效,不添加 `--trusted-host` 豁免。
- `DEEPSEEK_API_KEY` 经既有 env/.env credentials 能力从用户环境读取,安装包内零凭据。

## 构建与发布

- `electron-builder`:Windows NSIS x64、Linux AppImage + deb x64。
- staging 组装:先 `pnpm build` 与 `apps/web` 构建,再把 dsh 生产安装进 staging 目录,连同 SPA dist 一起进 `extraResources`。
- GitHub Actions:合并到 `dev` 分支触发,构建并发布到 GitHub Releases;版本号跟随仓库版本。

## 测试

- 单测:stdout 握手行解析、进程树清理参数构造。
- keyless smoke:xvfb 下启动打包壳 → 断言窗口加载 loopback URL → 退出后无残留 sidecar 进程。
- 不新增模型可见输入,web transcript 不变,不涉及 session 事件或快照变化。

## 仓库契合

- Agent Note 随实现 PR;`apps/cli/README` 运行形态表加 desktop 一行;`docs/architecture.md` 不变(未动 agent-loop/插件面)。
