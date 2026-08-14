# Agent Note: dsh 桌面壳是 web sidecar 之上的 Electron 窗口

Status: implemented

[English](2026-08-14-dsh-desktop-electron-shell.md) | 中文

## 问题

web 应用的运行形态——一个 loopback HTTP 服务器(host webserver 加 SPA 静态服务),浏览器通过 `/api` 上的 Typert RPC 通信——已经满足桌面程序的全部要求,只差它住在浏览器标签页里。把它包装成可分发的桌面程序,不能分叉客户端、不能削弱 loopback 信任栅栏、也不能依赖用户机器上的 Node 和 pnpm。

## 决策

`apps/desktop`(`@deepseek-ai/dsh-desktop`,private)是与 `apps/cli`、`apps/web` 平级的第三个产品 app,不是 cordis 插件。Electron 主进程把 dsh CLI 作为 sidecar 拉起——`node <dsh> --profile web --port 0`,运行在 `extraResources` 里捆绑的独立 Node 二进制之下,绝不用 Electron 自带的 Node(其版本跟随 Electron 而非仓库 engines 区间 `^22.19 || >=24`)。就绪信号复用 web 应用现有的 stdout 行 `dsh web: http://127.0.0.1:<port>`(插件 settlement 之后打印),从分块 stdout 中解析;OS 分配的端口不出现在任何其他地方,因此没有新增健康端点。渲染进程就是未修改的 SPA origin,Electron 沙箱保持开启;离开该 origin 的导航交给系统浏览器。退出时在 `will-quit` 杀掉进程树(POSIX 进程组信号,Windows `taskkill /T /F`)。

staging 组装(`scripts/assemble-staging.mjs`)部署 `apps/desktop/deploy-root`——一个由 `scripts/generate-deploy-root.mjs` 生成的纯依赖清单:以 dsh CLI 的完整依赖面为种子,沿 workspace 依赖与 peer 边求传递闭包。这个生成清单是关键负载:在使用注入 workspace 包的 pnpm deploy 里,单个被注入条目不会链接它以 workspace 协议声明的依赖与 peer,因此被启动 profile 引用的每个 workspace 包都必须是 deploy root 的**直接**依赖。部署出的闭包携带全部构建好的 `lib/` 和 SPA `dist/`(运行时经 web-app bundle 里的 `require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')` 定位),在用户机器上以纯 Node 运行,不依赖任何 pnpm 状态。独立 Node 二进制从 engines 线的镜像下载,落在 `resources/node` 下,与打包平台一一对应。`pnpm-workspace.yaml` 将 `@electron/get` 覆盖到 ≥3.1.0,因为 electron-builder 26.15.3 调用了 3.0.0 缺失的 API,而发布年龄策略否则会把范围钉在 3.0.0。

不改变任何 session 事件、模型输入或 web transcript:这个壳只是既有应用外围的窗口和进程,因此快照 harness 不受影响;覆盖面是对纯逻辑(握手解析、退出规划、路径解析)的单测,加上组装脚本里的 staging 闭包冒烟。

## 考虑过的替代方案

**把 host 跑进 Electron 主进程。** 否决:harness 要求 engines 区间、严格 ESM 和 native addon;把它的启动耦合到 Electron 内嵌 Node 和打包模块布局,会让每次 Electron 升级都变成一次 harness 兼容性事件,而用户毫无所得。

**Tauri。** 暂不采用:安装包仍需为 sidecar 捆绑 Node,体积优势大体抵消,仓库却多了 Rust 工具链和 CI 目标,Linux 的 webkitgtk WebView 也给 WebSocket 下行流增加一个兼容性变量。

**无头纯静态离线客户端。** 否决:浏览器信任栅栏和 Typert RPC 都假设本地 host 进程存在;去掉它意味着一个新的带远程鉴权的后端,那是另一个产品。
