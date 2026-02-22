use crate::storage;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
const KUBECONFIG_SEPARATOR: char = ';';

#[cfg(not(target_os = "windows"))]
const KUBECONFIG_SEPARATOR: char = ':';

const OVERRIDE_FILE_NAME: &str = "selected-kubeconfig-path.txt";
const IMPORTS_DIR_NAME: &str = "imports";
const LIST_FILE_NAME: &str = "list.json";
const LIST_LIMIT: usize = 200;

#[derive(Debug, Serialize)]
pub struct KubeContextItem {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
pub struct KubeContextSummary {
    pub kubeconfig_path: String,
    pub current_context: Option<String>,
    pub contexts: Vec<KubeContextItem>,
}

#[derive(Debug, Serialize)]
pub struct KubeconfigListItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub updated_at: u64,
    pub exists: bool,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct KubeconfigListEntry {
    id: String,
    name: String,
    path: String,
    created_at: u64,
    updated_at: u64,
}

#[tauri::command]
pub fn list_kube_contexts() -> Result<KubeContextSummary, String> {
    let kubeconfig_path = resolve_kubeconfig_path()?;
    read_summary_by_path(&kubeconfig_path)
}

#[tauri::command]
pub fn switch_kube_context(target: String) -> Result<KubeContextSummary, String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("context cannot be empty".to_string());
    }

    let kubeconfig_path = resolve_kubeconfig_path()?;
    let raw = storage::read_text(&kubeconfig_path)?;
    let mut value: Value = serde_yaml::from_str(&raw).map_err(|err| {
        format!(
            "failed to parse kubeconfig {}: {err}",
            kubeconfig_path.display()
        )
    })?;

    let summary = build_summary_from_value(&value, &kubeconfig_path)?;
    let exists = summary.contexts.iter().any(|item| item.name == target);
    if !exists {
        return Err(format!("context not found: {target}"));
    }

    let root = value
        .as_mapping_mut()
        .ok_or_else(|| "invalid kubeconfig root, expected YAML mapping".to_string())?;
    root.insert(
        Value::String("current-context".to_string()),
        Value::String(target.to_string()),
    );

    storage::create_backup("kubeconfig", "kubeconfig", &raw)?;

    let serialized = serde_yaml::to_string(&value).map_err(|err| {
        format!(
            "failed to serialize kubeconfig {}: {err}",
            kubeconfig_path.display()
        )
    })?;
    storage::write_text(&kubeconfig_path, &serialized)?;
    touch_kubeconfig_item_by_path(&kubeconfig_path)?;

    read_summary_by_path(&kubeconfig_path)
}

#[tauri::command]
pub fn import_kubeconfig_content(
    file_name: String,
    content: String,
    config_name: Option<String>,
) -> Result<KubeContextSummary, String> {
    let normalized_content = normalize_kubeconfig_content(&content);
    if normalized_content.trim().is_empty() {
        return Err("kubeconfig file is empty".to_string());
    }

    let parsed_value: Value = serde_yaml::from_str(&normalized_content)
        .map_err(|err| format!("failed to parse imported kubeconfig: {err}"))?;
    let resolved_name = resolve_import_name(config_name.as_deref(), &parsed_value, &file_name);

    let import_path = create_imported_kubeconfig_path(&file_name, &resolved_name)?;
    storage::write_text(&import_path, &normalized_content)?;
    save_kubeconfig_override(&import_path)?;
    upsert_kubeconfig_item(&resolved_name, &import_path)?;

    read_summary_by_path(&import_path)
}

#[tauri::command]
pub fn clear_kubeconfig_override() -> Result<KubeContextSummary, String> {
    clear_kubeconfig_override_file()?;
    list_kube_contexts()
}

#[tauri::command]
pub fn list_kubeconfig_items() -> Result<Vec<KubeconfigListItem>, String> {
    let mut entries = load_kubeconfig_items()?;
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let current_path = resolve_kubeconfig_path()
        .ok()
        .map(|path| path_to_string(&canonicalize_or_original(&path)));

    let items = entries
        .into_iter()
        .map(|entry| {
            let exists = Path::new(&entry.path).is_file();
            let is_current = current_path
                .as_ref()
                .map(|current| is_same_path(current, &entry.path))
                .unwrap_or(false);

            KubeconfigListItem {
                id: entry.id,
                name: sanitize_display_name(&entry.name),
                path: entry.path,
                updated_at: entry.updated_at,
                exists,
                is_current,
            }
        })
        .collect::<Vec<KubeconfigListItem>>();

    Ok(items)
}

#[tauri::command]
pub fn select_kubeconfig_item(id: String) -> Result<KubeContextSummary, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("kubeconfig item id cannot be empty".to_string());
    }

    let mut entries = load_kubeconfig_items()?;
    let Some(index) = entries.iter().position(|entry| entry.id == id) else {
        return Err(format!("kubeconfig item not found: {id}"));
    };

    let path = PathBuf::from(&entries[index].path);
    if !path.exists() || !path.is_file() {
        return Err(format!("kubeconfig does not exist: {}", path.display()));
    }

    save_kubeconfig_override(&path)?;
    entries[index].updated_at = now_unix_secs();
    save_kubeconfig_items(&entries)?;

    read_summary_by_path(&path)
}

#[tauri::command]
pub fn remove_kubeconfig_item(id: String) -> Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Ok(());
    }

    let mut entries = load_kubeconfig_items()?;
    let Some(index) = entries.iter().position(|entry| entry.id == id) else {
        return Ok(());
    };

    let removed_path = entries.remove(index).path;
    save_kubeconfig_items(&entries)?;

    if let Some(override_path) = load_kubeconfig_override()? {
        let removed_normalized = path_to_string(&canonicalize_or_original(Path::new(&removed_path)));
        let override_normalized = path_to_string(&canonicalize_or_original(&override_path));
        if is_same_path(&removed_normalized, &override_normalized) {
            clear_kubeconfig_override_file()?;
        }
    }

    Ok(())
}

fn read_summary_by_path(path: &Path) -> Result<KubeContextSummary, String> {
    if !path.exists() {
        return Err(format!("kubeconfig does not exist: {}", path.display()));
    }

    let raw = storage::read_text(path)?;
    let value: Value = serde_yaml::from_str(&raw)
        .map_err(|err| format!("failed to parse kubeconfig {}: {err}", path.display()))?;

    build_summary_from_value(&value, path)
}

fn resolve_kubeconfig_path() -> Result<PathBuf, String> {
    if let Some(override_path) = load_kubeconfig_override()? {
        if override_path.exists() {
            return Ok(override_path);
        }
        clear_kubeconfig_override_file()?;
    }

    if let Ok(raw_paths) = env::var("KUBECONFIG") {
        let candidates = raw_paths
            .split(KUBECONFIG_SEPARATOR)
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(PathBuf::from)
            .collect::<Vec<PathBuf>>();

        if let Some(existing) = candidates.iter().find(|path| path.exists()) {
            return Ok(existing.clone());
        }

        if let Some(first) = candidates.into_iter().next() {
            return Ok(first);
        }
    }

    let home = dirs::home_dir().ok_or_else(|| "failed to locate user home directory".to_string())?;
    Ok(home.join(".kube").join("config"))
}

fn create_imported_kubeconfig_path(file_name: &str, config_name: &str) -> Result<PathBuf, String> {
    let base = sanitize_file_stem(if config_name.trim().is_empty() {
        file_name
    } else {
        config_name
    });
    let file_name = format!("{base}-{}.yaml", storage::unix_ts_millis());
    let dir = kubeconfig_dir()?.join(IMPORTS_DIR_NAME);
    storage::ensure_dir(&dir)?;
    Ok(dir.join(file_name))
}

fn resolve_import_name(requested_name: Option<&str>, value: &Value, file_name: &str) -> String {
    if let Some(name) = requested_name {
        let normalized = sanitize_display_name(name);
        if !normalized.is_empty() {
            return normalized;
        }
    }

    if let Some(context_name) = infer_context_name(value) {
        let normalized = sanitize_display_name(&context_name);
        if !normalized.is_empty() {
            return normalized;
        }
    }

    sanitize_display_name(
        Path::new(file_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("kubeconfig"),
    )
}

fn infer_context_name(value: &Value) -> Option<String> {
    let root = value.as_mapping()?;

    if let Some(current) = mapping_get(root, "current-context").and_then(Value::as_str) {
        let current = current.trim();
        if !current.is_empty() {
            return Some(current.to_string());
        }
    }

    let contexts = mapping_get(root, "contexts")?.as_sequence()?;
    let first = contexts.first()?;
    let first_map = first.as_mapping()?;
    let name = mapping_get(first_map, "name")?.as_str()?.trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn normalize_kubeconfig_content(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    if normalized.ends_with('\n') {
        normalized
    } else {
        format!("{normalized}\n")
    }
}

fn sanitize_file_stem(raw: &str) -> String {
    let mut sanitized = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    while sanitized.contains("__") {
        sanitized = sanitized.replace("__", "_");
    }
    sanitized = sanitized.trim_matches('_').to_string();

    if sanitized.is_empty() {
        "kubeconfig".to_string()
    } else {
        sanitized
    }
}

fn sanitize_display_name(raw: &str) -> String {
    let mut name = raw
        .trim()
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>();

    if name.chars().count() > 64 {
        name = name.chars().take(64).collect::<String>();
    }
    if name.is_empty() {
        "kubeconfig".to_string()
    } else {
        name
    }
}

fn now_unix_secs() -> u64 {
    (storage::unix_ts_millis() / 1000) as u64
}

fn kubeconfig_dir() -> Result<PathBuf, String> {
    let dir = storage::app_root()?.join("kubeconfig");
    storage::ensure_dir(&dir)?;
    Ok(dir)
}

fn override_path_file() -> Result<PathBuf, String> {
    Ok(kubeconfig_dir()?.join(OVERRIDE_FILE_NAME))
}

fn list_path_file() -> Result<PathBuf, String> {
    Ok(kubeconfig_dir()?.join(LIST_FILE_NAME))
}

fn load_kubeconfig_override() -> Result<Option<PathBuf>, String> {
    let path = override_path_file()?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = storage::read_text(&path)?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(Some(PathBuf::from(trimmed)))
}

fn save_kubeconfig_override(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("selected file does not exist: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("selected path is not a file: {}", path.display()));
    }

    let normalized = canonicalize_or_original(path);
    storage::write_text(&override_path_file()?, &path_to_string(&normalized))
}

fn clear_kubeconfig_override_file() -> Result<(), String> {
    let path = override_path_file()?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|err| format!("failed to clear kubeconfig override {}: {err}", path.display()))?;
    }
    Ok(())
}

fn load_kubeconfig_items() -> Result<Vec<KubeconfigListEntry>, String> {
    let path = list_path_file()?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = storage::read_text(&path)?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<KubeconfigListEntry>>(&raw)
        .map_err(|err| format!("failed to parse kubeconfig list {}: {err}", path.display()))
}

fn save_kubeconfig_items(entries: &[KubeconfigListEntry]) -> Result<(), String> {
    let path = list_path_file()?;
    let serialized = serde_json::to_string_pretty(entries)
        .map_err(|err| format!("failed to serialize kubeconfig list: {err}"))?;
    storage::write_text(&path, &serialized)
}

fn generate_entry_id(entries: &[KubeconfigListEntry]) -> String {
    let base = format!("kcfg-{}", storage::unix_ts_millis());
    if entries.iter().all(|entry| entry.id != base) {
        return base;
    }

    let mut index = 1usize;
    loop {
        let candidate = format!("{base}-{index}");
        if entries.iter().all(|entry| entry.id != candidate) {
            return candidate;
        }
        index += 1;
    }
}

fn upsert_kubeconfig_item(name: &str, path: &Path) -> Result<(), String> {
    let now = now_unix_secs();
    let normalized_path = path_to_string(&canonicalize_or_original(path));
    let safe_name = sanitize_display_name(name);

    let mut entries = load_kubeconfig_items()?;
    if let Some(entry) = entries
        .iter_mut()
        .find(|entry| is_same_path(&entry.path, &normalized_path))
    {
        entry.name = safe_name;
        entry.updated_at = now;
    } else {
        entries.push(KubeconfigListEntry {
            id: generate_entry_id(&entries),
            name: safe_name,
            path: normalized_path,
            created_at: now,
            updated_at: now,
        });
    }

    if entries.len() > LIST_LIMIT {
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        entries.truncate(LIST_LIMIT);
    }

    save_kubeconfig_items(&entries)
}

fn touch_kubeconfig_item_by_path(path: &Path) -> Result<(), String> {
    let normalized_path = path_to_string(&canonicalize_or_original(path));
    let mut entries = load_kubeconfig_items()?;
    if let Some(entry) = entries
        .iter_mut()
        .find(|entry| is_same_path(&entry.path, &normalized_path))
    {
        entry.updated_at = now_unix_secs();
        save_kubeconfig_items(&entries)?;
    }
    Ok(())
}

fn canonicalize_or_original(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn is_same_path(left: &str, right: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        left.eq_ignore_ascii_case(right)
    }

    #[cfg(not(target_os = "windows"))]
    {
        left == right
    }
}

fn build_summary_from_value(value: &Value, path: &Path) -> Result<KubeContextSummary, String> {
    let root = value
        .as_mapping()
        .ok_or_else(|| "invalid kubeconfig root, expected YAML mapping".to_string())?;

    let current_context = mapping_get(root, "current-context")
        .and_then(Value::as_str)
        .map(|value| value.to_string());

    let contexts = mapping_get(root, "contexts")
        .and_then(Value::as_sequence)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let item_map = item.as_mapping()?;
                    let name = mapping_get(item_map, "name")?.as_str()?;
                    Some(KubeContextItem {
                        name: name.to_string(),
                        is_current: current_context.as_deref() == Some(name),
                    })
                })
                .collect::<Vec<KubeContextItem>>()
        })
        .unwrap_or_default();

    Ok(KubeContextSummary {
        kubeconfig_path: path.display().to_string(),
        current_context,
        contexts,
    })
}

fn mapping_get<'a>(mapping: &'a Mapping, key: &str) -> Option<&'a Value> {
    mapping.get(&Value::String(key.to_string()))
}
