# OpsTools

基于 `Tauri + Rust` 的跨平台运维工具（Windows / macOS），采用左侧菜单 + 右侧主面板布局，界面为圆角矩形白色磨砂玻璃风格。

当前内置功能：
- `Kubeconfig 快速切换`
  - 支持导入本地 kubeconfig 文件
  - 支持直接粘贴 kubeconfig YAML 导入
  - 提供 kubeconfig 列表（导入项和粘贴项统一管理）
  - 导入时可选配置名；不填时默认使用 context 名称
  - 支持一键切换、移除、恢复默认路径
- `Hosts 快速切换`
  - 配置模板保存/加载/删除
  - 预览差异、应用到系统 hosts、最近备份回滚
- `加密转换`
  - Base64 编码/解码
  - URL 编码/解码
  - Hex 编码/解码
  - AES-GCM 加密/解密

## 目录结构

```text
ui/                    # 前端静态页面
src-tauri/             # Tauri + Rust 后端
  capabilities/
  src/
    main.rs
    kubeconfig.rs
    hosts.rs
    storage.rs
```

## 环境要求

- Rust（建议 stable）：`rustc`、`cargo`
- Node.js（仅当你需要使用 `cargo tauri` CLI 时）
- Windows 打包需要：
  - Visual Studio 2022 Build Tools（或 VS 2019+）
  - 勾选 `Desktop development with C++`（确保有 `link.exe`）
- macOS 打包需要：
  - Xcode Command Line Tools：`xcode-select --install`

## 开发运行

项目前端是静态目录（`ui/`），可直接通过 Tauri 启动。

### Windows（PowerShell）

如果新终端偶发找不到 `cargo`，先临时补 PATH：

```powershell
$env:PATH = "C:\Users\yingj\.cargo\bin;" + $env:PATH
```

然后在项目根目录运行：

```powershell
cargo run --manifest-path .\src-tauri\Cargo.toml
```

### macOS（zsh/bash）

```bash
cargo run --manifest-path ./src-tauri/Cargo.toml
```

## 构建与打包

> 当前 `src-tauri/tauri.conf.json` 中 `bundle.active` 默认为 `false`。如果要生成安装包，请先改为 `true`。

### 方式 A：直接 Rust 构建（仅二进制）

生成可执行文件，不生成安装包：

```powershell
cargo build --release --manifest-path .\src-tauri\Cargo.toml
```

产物位置：
- Windows: `src-tauri\target\release\opstools.exe`
- macOS: `src-tauri/target/release/opstools`

### 方式 B：Tauri 打包（推荐）

1. 安装 Tauri CLI（若未安装）：

```powershell
cargo install tauri-cli
```

2. 在项目根目录执行：

```powershell
cargo tauri build
```

macOS 同命令：

```bash
cargo tauri build
```

常见产物目录：
- `src-tauri/target/release/bundle/`

Windows 常见格式：
- `.msi` / `.exe`（取决于配置）

macOS 常见格式：
- `.app` / `.dmg`（取决于配置）

## 常见问题

### 1) `link.exe not found`

这是 Windows C++ 工具链缺失导致。安装 Visual Studio Build Tools，并勾选 `Desktop development with C++` 后重试。

### 2) `icons/icon.ico not found`

Tauri Windows 资源打包需要图标。请确保文件存在：
- `src-tauri/icons/icon.ico`

### 3) 终端里 `cargo` 找不到

通常是终端会话没有继承 Rust 环境变量。Windows 先执行：

```powershell
$env:PATH = "C:\Users\yingj\.cargo\bin;" + $env:PATH
```

## 权限说明

- `kubeconfig` 切换需要对 kubeconfig 文件有读写权限。
- `hosts` 应用和回滚需要系统级权限：
  - Windows：建议管理员身份运行。
  - macOS：需要具备写 hosts 文件权限（通常需要 sudo / root）。

## 数据存储

应用会在本机应用数据目录创建 `opstools` 数据目录，保存：
- hosts 配置模板
- kubeconfig 列表与导入文件
- kubeconfig / hosts 备份文件
