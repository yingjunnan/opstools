use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn app_root() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "无法定位本地数据目录".to_string())?;

    let root = base.join("opstools");
    ensure_dir(&root)?;
    Ok(root)
}

pub fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| format!("创建目录失败 {}: {err}", path.display()))
}

pub fn unix_ts_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

pub fn create_backup(category: &str, basename: &str, content: &str) -> Result<PathBuf, String> {
    let backup_dir = app_root()?.join("backups").join(category);
    ensure_dir(&backup_dir)?;

    let backup_path = backup_dir.join(format!("{basename}-{}.bak", unix_ts_millis()));
    fs::write(&backup_path, content)
        .map_err(|err| format!("写入备份失败 {}: {err}", backup_path.display()))?;

    Ok(backup_path)
}

pub fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|err| format!("读取文件失败 {}: {err}", path.display()))
}

pub fn write_text(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }

    fs::write(path, content).map_err(|err| format!("写入文件失败 {}: {err}", path.display()))
}
