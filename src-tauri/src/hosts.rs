use crate::storage;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::io::Error;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize)]
pub struct HostsProfileMeta {
    pub name: String,
    pub updated_at: u64,
}

#[derive(Debug, Serialize)]
pub struct HostsDiffPreview {
    pub additions: Vec<String>,
    pub removals: Vec<String>,
}

#[tauri::command]
pub fn list_hosts_profiles() -> Result<Vec<HostsProfileMeta>, String> {
    let dir = profiles_dir()?;
    let entries =
        fs::read_dir(&dir).map_err(|err| format!("读取目录失败 {}: {err}", dir.display()))?;

    let mut profiles = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取目录项失败 {}: {err}", dir.display()))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("hosts") {
            continue;
        }

        let Some(name) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };

        let updated_at = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or_default();

        profiles.push(HostsProfileMeta {
            name: name.to_string(),
            updated_at,
        });
    }

    profiles.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(profiles)
}

#[tauri::command]
pub fn load_hosts_profile(name: String) -> Result<String, String> {
    let path = profile_path(&name)?;
    storage::read_text(&path)
}

#[tauri::command]
pub fn save_hosts_profile(name: String, content: String) -> Result<(), String> {
    let safe_name = sanitize_profile_name(&name)?;
    let path = profiles_dir()?.join(format!("{safe_name}.hosts"));
    storage::write_text(&path, &normalize_hosts_content(&content))
}

#[tauri::command]
pub fn delete_hosts_profile(name: String) -> Result<(), String> {
    let path = profile_path(&name)?;
    if !path.exists() {
        return Err(format!("配置不存在: {}", path.display()));
    }

    fs::remove_file(&path).map_err(|err| format!("删除配置失败 {}: {err}", path.display()))
}

#[tauri::command]
pub fn apply_hosts_profile(name: String) -> Result<String, String> {
    let safe_name = sanitize_profile_name(&name)?;
    let profile_path = profiles_dir()?.join(format!("{safe_name}.hosts"));
    let desired = storage::read_text(&profile_path)?;

    let hosts_path = system_hosts_path();
    let current = fs::read_to_string(&hosts_path)
        .map_err(|err| format_hosts_access_error(&hosts_path, "读取", err))?;

    let backup = storage::create_backup("hosts", "hosts", &current)?;

    fs::write(&hosts_path, normalize_hosts_content(&desired))
        .map_err(|err| format_hosts_access_error(&hosts_path, "写入", err))?;

    Ok(format!(
        "已应用配置 {safe_name}，备份文件: {}",
        backup.display()
    ))
}

#[tauri::command]
pub fn read_hosts_file() -> Result<String, String> {
    let hosts_path = system_hosts_path();
    fs::read_to_string(&hosts_path).map_err(|err| format_hosts_access_error(&hosts_path, "读取", err))
}

#[tauri::command]
pub fn list_hosts_backups() -> Result<Vec<String>, String> {
    let dir = backup_dir()?;
    let entries =
        fs::read_dir(&dir).map_err(|err| format!("读取目录失败 {}: {err}", dir.display()))?;

    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取目录项失败 {}: {err}", dir.display()))?;
        if !entry.path().is_file() {
            continue;
        }

        backups.push(entry.file_name().to_string_lossy().to_string());
    }

    backups.sort_by(|a, b| b.cmp(a));
    Ok(backups)
}

#[tauri::command]
pub fn restore_latest_hosts_backup() -> Result<String, String> {
    let backups = list_hosts_backups()?;
    let latest_name = backups
        .first()
        .ok_or_else(|| "没有可回滚的 hosts 备份".to_string())?
        .to_string();

    let backup_path = backup_dir()?.join(&latest_name);
    let backup_content = storage::read_text(&backup_path)?;

    let hosts_path = system_hosts_path();
    fs::write(&hosts_path, backup_content)
        .map_err(|err| format_hosts_access_error(&hosts_path, "写入", err))?;

    Ok(format!("已恢复备份 {latest_name}"))
}

#[tauri::command]
pub fn preview_hosts_profile_diff(name: String) -> Result<HostsDiffPreview, String> {
    let desired = load_hosts_profile(name)?;
    let current = read_hosts_file()?;

    let current_set = normalized_lines(&current).into_iter().collect::<BTreeSet<String>>();
    let desired_set = normalized_lines(&desired).into_iter().collect::<BTreeSet<String>>();

    let additions = desired_set
        .difference(&current_set)
        .cloned()
        .collect::<Vec<String>>();
    let removals = current_set
        .difference(&desired_set)
        .cloned()
        .collect::<Vec<String>>();

    Ok(HostsDiffPreview { additions, removals })
}

fn normalized_lines(content: &str) -> Vec<String> {
    content
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.to_string())
        .collect::<Vec<String>>()
}

fn normalize_hosts_content(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    if normalized.ends_with('\n') {
        normalized
    } else {
        format!("{normalized}\n")
    }
}

fn sanitize_profile_name(name: &str) -> Result<String, String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err("配置名不能为空".to_string());
    }

    if normalized.len() > 64 {
        return Err("配置名过长，最多 64 个字符".to_string());
    }

    let valid = normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if !valid {
        return Err("配置名仅支持字母、数字、-、_".to_string());
    }

    Ok(normalized.to_string())
}

fn profile_path(name: &str) -> Result<PathBuf, String> {
    let safe_name = sanitize_profile_name(name)?;
    Ok(profiles_dir()?.join(format!("{safe_name}.hosts")))
}

fn profiles_dir() -> Result<PathBuf, String> {
    let dir = storage::app_root()?.join("hosts").join("profiles");
    storage::ensure_dir(&dir)?;
    Ok(dir)
}

fn backup_dir() -> Result<PathBuf, String> {
    let dir = storage::app_root()?.join("backups").join("hosts");
    storage::ensure_dir(&dir)?;
    Ok(dir)
}

#[cfg(target_os = "windows")]
fn system_hosts_path() -> PathBuf {
    PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts")
}

#[cfg(not(target_os = "windows"))]
fn system_hosts_path() -> PathBuf {
    PathBuf::from("/etc/hosts")
}

fn format_hosts_access_error(path: &Path, action: &str, error: Error) -> String {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        format!(
            "{action} hosts 文件失败 {}。请以管理员权限运行应用。",
            path.display()
        )
    } else {
        format!("{action} hosts 文件失败 {}: {error}", path.display())
    }
}
