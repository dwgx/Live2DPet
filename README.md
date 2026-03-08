# Live2DPet Enhanced — AI 桌面宠物增强版

**中文（默认）** | **[English](README.en.md)** | **[日本語](README.ja.md)** | **[Global Quick Start](QUICK_START_GLOBAL.md)**

![GitHub stars](https://img.shields.io/github/stars/dwgx/Live2DPet-Enhanced) ![License](https://img.shields.io/github/license/dwgx/Live2DPet-Enhanced) ![Last Commit](https://img.shields.io/github/last-commit/dwgx/Live2DPet-Enhanced)

> 这是 [Live2DPet](https://github.com/x380kkm/Live2DPet) 的增强版，目标很直接：让桌宠更聪明、更稳定、更像一个能长期陪你的 AI 伙伴。

这个项目是一个基于 Electron 的桌面宠物应用。角色可以常驻桌面，结合截屏和活动窗口信息理解你正在做什么，再用大模型生成对话。你可以点击、拖拽、互动；也可以启用语音输入和语音播报。

- 支持 Live2D 模型，也支持图片文件夹/GIF 作为角色
- 支持本地 Whisper 语音识别（STT）
- 支持 VOICEVOX 本地语音合成（TTS）
- 支持关键帧视觉记忆和本地记忆系统

> 性能与 Agent 化调优建议见：[AGENT_COMPANION_TUNING.md](AGENT_COMPANION_TUNING.md)

## 白话文快速指导（先跑起来）

1. 先下载发布版：去 Releases 拿 `Live2DPet.exe`，双击就能用。  
2. 要源码运行：在项目目录执行 `npm install` 然后 `node launch.js`。  
3. 首次打开先填 API：`base_url`、`api_key`、`model`。  
4. 选一个 Live2D 模型或图片模型，点「启动宠物」。  
5. 想看其他语言，直接点顶部语言导航，或打开 [Global Quick Start](QUICK_START_GLOBAL.md)。

## 使用前先看（隐私）

本应用会按你的设置定时截屏，并把图像发给你配置的 AI API 做分析。

- 截图默认不保存到本地磁盘
- 但截图内容会经过第三方 API 服务
- 如果屏幕上有敏感信息，请先关闭相关窗口或暂停功能

请只在你信任的 API 服务商和网络环境下使用。

<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Live2DPet Icon">
</p>

## 你能得到什么（白话版）

### 1. 更实用的记忆系统
- 记忆持久化到本地文件，重启后不丢
- 可调记忆容量、短期/长期检索数量
- 自动保存，基本不用手动管
- 能按相关性找回上下文，不容易“失忆”

### 2. 更顺手的模型显示
- Live2D 模型自动适配窗口大小
- 模型自动垂直居中，观感更稳定
- 仓库内提供了示例模型，可直接体验

### 3. 多语言文本更完整
- 中文、日文缺失翻译补齐
- 语音输入、记忆相关文案更完整

### 4. 本地 Whisper 语音识别
- 支持本地 STT，不依赖云端转写
- 支持 tiny/base/small/medium/large 多模型
- 支持自动连续识别
- 支持识别文本修复

### 5. 代码与稳定性改进
- 清理重复和无用代码
- 加强错误处理
- 做了一批性能优化

## 使用示例

<p align="center">
  <img src="assets/example-little-demon.png" width="60%" alt="Usage Example 1">
</p>
<p align="center">
  <img src="assets/example-kasukabe.jpg" width="60%" alt="Usage Example 2">
</p>
<p align="center">
  <img src="assets/example-kiritan.png" width="60%" alt="Usage Example 3">
</p>

<details>
<summary>模型借物说明</summary>

【Model】Little Demon<br>
Author：Cai Cat様

【Model】春日部つむぎ (公式)<br>
イラスト：春日部つくし様<br>
モデリング：米田らん様

【Model】東北きりたん ([水德式](https://www.bilibili.com/video/BV1B7dcY1EFU))<br>
イラスト：白白什么雨様<br>
配布：君临德雷克様

*本示例使用的模型素材为借物展示，版权归原作者所有。*

</details>

## 快速开始

### 方式一：直接下载（推荐）

从 [Releases](https://github.com/dwgx/Live2DPet-Enhanced/releases) 下载 `Live2DPet.exe`，双击运行即可。

### 方式二：从源码运行

```bash
git clone https://github.com/dwgx/Live2DPet-Enhanced.git
cd Live2DPet-Enhanced
npm install
node launch.js
```

> VSCode 终端建议用 `node launch.js`，不要用 `npx electron .`（可能遇到 `ELECTRON_RUN_AS_NODE` 冲突）。

## 第一次配置（建议按这个顺序）

### 1. 配置 API

启动后打开设置，在「API 设置」里填 API 地址、密钥和模型名称。

- 兼容 OpenAI 格式接口
- 可使用 OpenRouter 等聚合平台
- 建议选支持 Vision 的模型，这样截屏理解效果更好

翻译 API（用于 TTS 日语翻译）可用：
- OpenRouter `x-ai/grok-4-fast`

### 2. 导入模型

在「模型」标签页点击「选择模型文件夹」，选包含 `.model.json` 或 `.model3.json` 的目录。

程序会自动做这些事：
- 扫描参数并映射眼球/头部追踪
- 扫描表情和动作组
- 复制模型到用户数据目录

没有模型可先试官方示例：
[Live2D 官方示例](https://www.live2d.com/en/learn/sample/)

### 3. 配置 VOICEVOX（可选）

1. 在「TTS」页安装 VOICEVOX 组件（Core + ONNX Runtime + Open JTalk 辞书）
2. 下载并选择 VVM 语音模型
3. 点击「保存并重启」
4. 选择角色（Speaker）、风格（Style）并微调参数

支持 DirectML（GPU）加速。启用后，AI 回复可自动翻译成日语并播报。

<details>
<summary>VOICEVOX 手动安装（应用内安装失败时使用）</summary>

安装目录：
`C:\Users\你的用户名\AppData\Roaming\live2dpet\voicevox_core`

| 组件 | 必须 | 下载链接 |
|------|------|----------|
| VOICEVOX Core | 是 | [voicevox_core-windows-x64-0.16.3.zip](https://github.com/VOICEVOX/voicevox_core/releases/download/0.16.3/voicevox_core-windows-x64-0.16.3.zip) |
| ONNX Runtime (CPU) | 是 | [voicevox_onnxruntime-win-x64-1.17.3.tgz](https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-win-x64-1.17.3.tgz) |
| ONNX Runtime (GPU) | 否 | [voicevox_onnxruntime-win-x64-dml-1.17.3.tgz](https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-win-x64-dml-1.17.3.tgz) |
| Open JTalk 辞书 | 是 | [open_jtalk_dic_utf_8-1.11.tar.gz](https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz/download) |
| 默认语音模型 | 是 | [0.vvm](https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.16.3/0.vvm) |
| 其他语音模型 | 否 | [vvm](https://github.com/VOICEVOX/voicevox_vvm/releases/) |

参考目录结构：

```text
voicevox_core/
├── c_api/
│   └── voicevox_core-windows-x64-0.16.3/
│       └── lib/
│           └── voicevox_core.dll
├── voicevox_onnxruntime-win-x64-1.17.3/
│   └── lib/
│       └── voicevox_onnxruntime.dll
├── open_jtalk_dic_utf_8-1.11/
│   ├── sys.dic
│   └── ...
└── models/
    ├── 0.vvm
    └── ...
```

把对应文件解压到对应目录，`.vvm` 放到 `models/` 后重启应用。

</details>

### 4. 配置语音输入（可选）

在「语音输入」里：
- 选择 Whisper 本地识别
- 设置识别语言（中/英/日等）
- 选择模型大小
- 可开启自动连续识别
- 可开启识别文本修复

### 5. 配置记忆系统（可选）

在「记忆」里可以调：
- 是否启用记忆
- 最大记忆数
- 短期/长期检索数量
- 自动保存
- 是否包含相关记忆

### 6. 自定义角色人设

在「角色」页可新增角色卡，配置名称、性格、行为规则。
支持模板变量：`{{petName}}`、`{{userIdentity}}`。

### 7. 启动桌宠

在设置页底部点「启动宠物」，角色会出现在桌面右下角。

- 可拖拽移动
- Live2D 眼睛会跟随鼠标
- AI 会按设定节奏主动对话

## 图片模型说明

不想用 Live2D，也可以用图片文件夹：

1. 在「模型」里选择类型为「图片文件夹」
2. 选择包含 PNG/JPG/WebP 的目录
3. 给每张图标记用途：待机、说话、表情
4. 表情图填写表情名，供 AI 情绪系统匹配
5. 用裁剪缩放滑块调整显示比例

运行时会自动切图：说话切“说话图”，有情绪切“表情图”，空闲切“待机图”。

## 功能总览

- Live2D 桌面角色（透明无边框、置顶、眼睛跟随）
- 图片模型（待机/说话/表情自动切换）
- AI 视觉感知（定时截屏 + 活动窗口）
- 互动系统（点击/触摸/拖拽/划过/缩放）
- 关键帧视觉记忆（自动采样 + 代表帧选择）
- 增强记忆系统（本地持久化 + 检索）
- Whisper 本地语音识别
- VOICEVOX 本地语音合成
- 情绪系统与动作触发
- 音频状态机（TTS -> 默认音声 -> 静音自动降级）
- 模型热导入（参数自动映射、表情动作自动扫描）
- 多角色卡与人设模板

> 已弃置：智能增强文本管线（自动搜索、知识整理、知识获取、活动记忆、VLM 情景提取）在 v2.0 暂停使用，代码骨架保留。

<details>
<summary>项目架构（简版）</summary>

```text
Electron Main Process
├── main.js                 应用生命周期编排，模块注册
├── src/main/               主进程模块
│   ├── app-context.js
│   ├── config-manager.js
│   ├── crypto-utils.js
│   ├── validators.js
│   ├── window-manager.js
│   ├── character-manager.js
│   ├── tts-ipc.js
│   └── model-import.js
├── src/core/
│   ├── tts-service.js
│   ├── translation-service.js
│   └── enhance/
│       ├── enhancement-orchestrator.js
│       └── vlm-extractor.js

Renderer (3 windows)
├── Settings Window
├── Pet Window
└── Chat Bubble

Core Modules (renderer)
├── desktop-pet-system.js
├── message-session.js
├── emotion-system.js
├── audio-state-machine.js
├── ai-chat.js
└── prompt-builder.js
```

</details>

<details>
<summary>环境要求</summary>

- Windows 10/11
- Node.js >= 18（源码运行时）
- OpenAI 兼容 API Key
- VOICEVOX Core（可选）

</details>

<details>
<summary>测试</summary>

```bash
npm test
```

</details>

## 注意事项

- 隐私：截屏会发给你配置的 API，不会落盘
- 成本：视觉模型调用会产生费用，建议调大检测间隔
- 语音：使用 VOICEVOX 时请按协议标注 `VOICEVOX:キャラ名`

## 问题排查

如遇问题，建议在命令提示符（cmd）里带日志参数启动：

```bash
"你的文件夹地址\Live2DPet.exe" --enable-logging 2>&1
```

复现问题后，把关键日志附在 Issue 里。

### 已知问题

- 偶发截屏 warning 可忽略，不影响主要功能
- VVM 模型读取错误：
  到 `C:\Users\你的用户名\AppData\Roaming\live2dpet\voicevox_core` 删除损坏模型后重新下载

<details>
<summary>技术栈</summary>

- [Electron](https://www.electronjs.org/) — 桌面应用框架
- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/about/) + [PixiJS](https://pixijs.com/) + [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [VOICEVOX Core](https://github.com/VOICEVOX/voicevox_core) — 日语语音合成引擎
- [koffi](https://koffi.dev/) — Node.js FFI

</details>

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 原项目与致谢

本项目基于 [x380kkm/Live2DPet](https://github.com/x380kkm/Live2DPet) 增强开发。

感谢原作者 [@x380kkm](https://github.com/x380kkm) 的工作。

## License

MIT，见 [LICENSE](LICENSE)。

## 征集

- Live2D 模型：欢迎提交可合法分发的模型
- 应用图标：当前图标为开发者头像占位，欢迎投稿
- 内置角色卡：欢迎提交中/英/日三语版本

提交内置角色卡时请同步修改：
- `assets/prompts/<uuid>.json`（含 `i18n` 字段）
- `src/main/character-manager.js` 中 `ensureDefaultCharacters()`

<details>
<summary>内置角色卡列表</summary>

> 英语和日语版本为机翻，欢迎校对。

| 角色名 | 中文 | English | 日本語 | 备注 |
|--------|------|---------|--------|------|
| 后辈 / Kouhai / 後輩 | ✅ 原文 | ✅ 机翻 | ✅ 机翻 | 默认角色，毒舌后辈型桌宠 |

</details>

## 贡献

欢迎提交 Issue 和 Pull Request。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=dwgx/Live2DPet-Enhanced&type=Date)](https://star-history.com/#dwgx/Live2DPet-Enhanced&Date)
