# BATS：离线大厅与局部战斗研究

一个用 C# Android 容器与 JavaScript / WebGL 制作的个人学习项目。它探索本地资源加载、角色动作播放、技能演出时间轴与简化战斗逻辑。

**当前公开内容是从 0.8.0-preview 整理出的源码研究快照。它不包含原游戏素材，不是下载后即可游玩的完整游戏，也不代表已经完成原作战斗复刻。**

## 项目做到哪里

原私人环境已经制作过普通立绘与动态大厅、角色模型和基础动作预览，以及普通 1-1 第一场遭遇的战斗样片。样片包括四个前排、两个支援位、三张技能卡轮转、COST 消耗与回复、目标选择、技能演出及本地语音播放接口。

原来的开发记录仍明确保留以下缺口：原技能粒子与 Shader、完整伤害和命中规则、部分支援行为、镜头与动画混合，以及 ARM64 安卓真机验证。当前 HP、攻击、防御等仍有本地演示公式；不能把画面可播放等同于原规则已经还原。

## 此仓库包含什么

- `app/BATS/MainActivity.cs`：Android WebView 容器、目录授权和本地资源访问。
- `app/BATS/Assets/web/`：自写页面、播放器、骨骼动画采样、战场渲染和模拟逻辑。
- `tools/test_bats_config.mjs`：不依赖游戏素材的等级配置与存档边界检查。
- `docs/PROJECT.md`：项目说明、技术结构和下一步。
- `docs/ASSETS.md`：资源缺口及恢复边界。
- `THIRD_PARTY_NOTICES.md`：第三方依赖和许可证范围。

## 可以直接执行的检查

安装 Node.js 后，在仓库根目录执行：

```sh
node tools/test_bats_config.mjs
```

这只验证等级配置、损坏存档处理、未知角色及不可变更新，不是整场战斗验收。

## Android 构建说明

历史项目使用 .NET SDK 9.0.312，目标框架为 `net8.0-android`，最低 Android API 23。需要安装与项目匹配的 Android workload、Android SDK 和 JDK。本次整理移除了原电脑的固定 SDK 路径。

```sh
cd app/BATS
dotnet restore BATS.csproj
dotnet publish BATS.csproj -c Release
```

以上为项目构建入口，本次公开整理未重新构建 APK。即使编译成功，当前源码包也缺少画面所需数据和 Spine 运行库，不能直接复现私人环境中的大厅和战斗。详见 [资源说明](docs/ASSETS.md)。

## 许可

仓库内自写代码和新整理的说明采用 MIT，见 [LICENSE](LICENSE)。该许可不授予原游戏模型、贴图、声音、剧情、数据表或任何第三方运行库的权利。此仓库不附带原游戏 APK、提取素材、账号信息、网络抓包或签名密钥。

本项目为非官方个人研究，与原游戏权利方无隶属或背书关系。
