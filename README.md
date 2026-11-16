# Pi Desktop

**本地运行，直连你配置的模型服务，不向 Pi Desktop 项目方上传模型调用日志。**

Pi Desktop 是基于 [Pi Coding Agent](https://github.com/earendil-works/pi) 的本地桌面客户端，提供简洁的对话界面、工具执行过程和代码变更审阅能力。无需接入项目方托管的模型网关，也无需注册 Pi Desktop 账号。

项目通过 Pi 的 RPC 协议连接模型与编码工具，使用 Node.js 提供本地服务，并通过 AppKit 和 WKWebView 封装 macOS 桌面窗口。

## 隐私设计

- **无需项目方中转**：模型请求由本机 Pi 引擎发送至你配置的服务地址，不经过 Pi Desktop 项目方的服务器。
- **不收集调用日志**：当前客户端未集成分析、遥测或崩溃上报 SDK，不向项目方上传提示词、回复、工具结果或模型调用日志。
- **会话保存在本地**：认证、设置、会话记录和工作目录列表由本机保存，无内置云端同步。
- **配置由你掌控**：使用自己的模型账号和服务地址。若配置了第三方代理或网关，请求将经过该服务，其日志策略需要单独确认。

### 数据边界

“本地客户端不收集日志”不代表云端模型服务商无法看到请求。使用远程模型时，服务商仍会接收提示词、对话上下文，以及任务过程中发送的代码片段或工具结果；是否留存、如何使用这些数据，取决于该服务商的政策和账户设置。

Pi 引擎、用户安装的扩展、MCP 服务及被调用的工具可能有各自的网络访问和日志行为，需要按实际配置检查。本机文件也可能受到操作系统备份或同步软件的影响。

本项目的隐私承诺限定于当前 Pi Desktop 客户端自身的行为，不保证所有第三方都无法获取模型调用数据。若要求模型请求完全不出本机，需要另行配置并验证本地模型和工具链；本项目尚未验证这一部署方式。

> 当前为早期版本，已在 macOS 上验证。桌面应用尚未打包为包含全部运行依赖的独立安装包。

## 功能

- **对话与任务**：发送消息、流式展示回复、停止运行中的任务。
- **工具执行**：展示工具调用、执行状态及结果。
- **项目与会话**：切换本地工作目录、浏览历史任务、刷新后恢复当前会话。
- **模型设置**：选择模型和推理级别，遵循 Pi 的模型及认证配置。
- **代码审阅**：浏览项目文件、查看 Git 变更与 Diff。
- **界面外观**：支持深色和浅色主题，使用实色下拉菜单。

## 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | 22.19 或更高版本 |
| Git | 用于获取源码及查看代码变更 |
| Pi Coding Agent | 已构建并完成模型认证；当前集成使用 1.4.0 验证 |
| macOS | 原生桌面窗口要求 macOS 13 或更高版本 |
| Xcode Command Line Tools | 构建原生窗口时需要，包含 Swift 编译器 |

前端与本地服务不需要安装额外的 npm 依赖。Pi 引擎的构建依赖需要单独安装。

## 快速开始

### 1. 获取并构建 Pi

推荐将 Pi 与本项目放在同一父目录下：

```bash
mkdir pi-workspace
cd pi-workspace

git clone https://github.com/earendil-works/pi.git
cd pi
npm install --ignore-scripts
npm run build
```

通过构建后的 Pi CLI 配置模型与认证：

```bash
node packages/coding-agent/dist/bundle/cli.js
```

模型与认证的使用方法请参阅 [Pi 官方文档](https://github.com/earendil-works/pi#readme)。

### 2. 获取并启动 Pi Desktop

从 `pi` 目录返回父目录，然后获取本项目：

```bash
cd ..
git clone https://github.com/junpengyu/pi-desktop.git
cd pi-desktop
npm start
```

浏览器打开 **<http://127.0.0.1:4317>**。

默认目录结构如下：

```text
pi-workspace/
├── pi/
└── pi-desktop/
```

如果 Pi 位于其他目录，通过 `PI_CLI_PATH` 指定构建后的 CLI 文件：

```bash
PI_CLI_PATH=/absolute/path/to/pi/packages/coding-agent/dist/bundle/cli.js npm start
```

### 3. 构建 macOS 桌面应用

仅使用浏览器界面时，可以跳过本步骤。

安装 Xcode Command Line Tools（尚未安装时执行）：

```bash
xcode-select --install
```

在 `pi-desktop` 目录构建并打开应用：

```bash
npm run build:app
npm run open:app
```

生成的 `Pi Desktop.app` 位于项目根目录。应用默认读取旁边的 `server.mjs`，因此需要保留源码、Node.js 和 Pi 引擎。若要从“应用程序”目录启动，可创建软链接；不要只移动生成的应用包。

## 使用方式

1. 在左下角选择本地项目目录，或添加新的项目文件夹。
2. 确认模型已配置，界面状态显示“已就绪”。
3. 输入任务后按 `Enter` 发送；使用 `Shift + Enter` 换行。
4. 在对话中查看回复与工具执行过程，通过 `Diff` 按钮查看文件和代码变更。
5. 从左侧任务列表打开历史会话，或点击新建任务按钮开始新任务。

模型首次返回内容前可能需要等待。界面会显示连接、发送、等待回复及错误状态；发送失败时保留输入内容。

## 配置

### 环境变量

| 变量 | 用途 | 默认行为 |
| --- | --- | --- |
| `PI_CLI_PATH` | Pi CLI 入口文件的绝对路径 | 使用相邻 `pi` 目录下的 `packages/coding-agent/dist/bundle/cli.js` |
| `PI_DESKTOP_PORT` | 本地服务端口 | `4317`；原生窗口当前固定连接此端口 |
| `PI_DESKTOP_HOST` | 本地服务监听地址 | `127.0.0.1` |
| `PI_DESKTOP_DIR` | 原生启动器读取的源码目录 | 生成的 `.app` 所在目录 |
| `PI_NODE_BIN` | 原生启动器使用的 Node.js 可执行文件 | 自动查找 nvm、Homebrew 和 PATH 中的 Node.js |

环境变量需要由启动进程继承。本项目不会自动加载 `.env` 文件。自动找到的 Node.js 也需符合版本要求。

### 本地数据

| 路径 | 内容 |
| --- | --- |
| `~/.pi/agent/auth.json` | 由 Pi 管理的模型认证信息 |
| `~/.pi/agent/settings.json` | Pi 设置及默认模型 |
| `~/.pi/agent/sessions/` | Pi 会话记录 |
| `~/.pi/agent/desktop-workspaces.json` | 桌面客户端工作目录列表 |

这些数据保存在用户目录，不属于项目源码。请勿将认证文件、环境变量文件或私人会话提交到仓库。

## 开发

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm start` | 启动本地 HTTP 服务 |
| `npm run build:app` | 编译 macOS 启动器并生成应用包 |
| `npm run open:app` | 打开已生成的 macOS 应用 |

### 目录结构

```text
pi-desktop/
├── public/
│   ├── index.html          # 页面结构
│   ├── style.css           # 布局与主题
│   └── app.js              # 会话、事件流和界面交互
├── server.mjs              # HTTP API、SSE 和 Pi RPC 进程管理
├── macos-app.swift         # AppKit / WKWebView 桌面启动器
├── build-macos-app.sh      # macOS 应用构建脚本
├── package.json
└── README.md
```

### 运行机制

浏览器或 WKWebView 通过 HTTP API 向本地服务提交命令；本地服务管理 `pi --mode rpc` 子进程，通过 JSONL 交换命令与事件，再通过 SSE 将流式事件推送至界面。

### 验证

基础语法与构建检查：

```bash
node --check server.mjs
node --check public/app.js
bash -n build-macos-app.sh
npm run build:app
```

当前已人工及自动交互验证的流程包括：

- 使用 GLM-5.3 发送消息并接收回复。
- 深色和浅色主题下的实色目录菜单。
- 工作目录切换及刷新后恢复会话。
- 发送失败后的输入保留、错误提示和重新连接。

其他模型的可用性取决于 Pi 的认证配置、服务商和网络环境。

## 已知限制

- 原生桌面窗口仅支持 macOS，尚无独立的 Windows 或 Linux 桌面安装包。
- 生成的 `.app` 依赖源码目录及外部运行环境，未提供签名、公证或自动更新。
- 原生启动器当前固定连接 `127.0.0.1:4317`；自定义端口适用于浏览器模式。
- Git 文件状态和 Diff 的文本解析对复杂重命名、特殊字符路径等场景仍有限制。
- 本地服务具备读取文件与执行命令的能力，尚未实现远程访问认证，应保持仅本机使用。

## 贡献

欢迎通过 Issue 反馈问题，或提交 Pull Request。报告问题时请说明 macOS、Node.js 与 Pi 版本、复现步骤，以及不含敏感信息的日志或截图。

提交代码前，请完成相关语法检查和构建验证，并实际检查受影响的界面流程。

## 项目关系与许可

本项目是独立的 Pi RPC 客户端，不隶属于 OpenAI Codex 或 WorkBuddy。

本项目采用 [MIT 许可证](LICENSE)，允许自由使用、修改、商用与再分发，保留版权和许可声明即可。

Pi 引擎由 [earendil-works/pi](https://github.com/earendil-works/pi) 维护，本仓库不包含其源码；Pi 的使用与分发遵循上游许可。
