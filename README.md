# OpsTools

基于 `Tauri + Rust` 的跨平台运维工具（Windows / macOS），当前实现：

- `kubeconfig` 本地 context 快速切换
  - 支持导入本地 kubeconfig 文件并切换为当前工作文件
  - 支持直接粘贴 kubeconfig YAML 内容导入
  - 提供 kubeconfig 列表，导入/粘贴项都会进入列表并可一键切换
  - 导入时支持可选配置名；不填写时默认使用 context 名称
  - 支持恢复到系统默认 kubeconfig 路径
- `hosts` 配置模板管理、应用、差异预览、最近备份回滚
- `加密转换` 菜单
  - Base64 编码/解码
  - URL 编码/解码
  - Hex 编码/解码
  - AES-GCM 加密/解密

## 目录结构

```text
ui/                    # 静态前端页面（左右布局 + 玻璃磨砂风格）
src-tauri/             # Tauri + Rust 后端
  capabilities/
  src/
    main.rs
    kubeconfig.rs
    hosts.rs
    storage.rs
```

## 运行方式

1. 确认 Rust 已安装（`rustc`、`cargo` 可用）
2. 在项目根目录执行：

```powershell
$env:PATH = "C:\Users\yingj\.cargo\bin;" + $env:PATH
cargo run --manifest-path .\src-tauri\Cargo.toml
```

## 权限说明

- `kubeconfig` 切换需要可写 kubeconfig 文件。
- `hosts` 应用和回滚需要管理员权限：
  - Windows: 建议以管理员身份启动应用
  - macOS: 建议使用具备 root 权限的方式启动

## 数据存储

应用会在本机本地数据目录下创建 `opstools` 目录，保存：

- hosts 配置模板
- kubeconfig 列表与导入文件
- kubeconfig / hosts 备份文件
