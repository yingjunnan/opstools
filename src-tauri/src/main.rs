#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hosts;
mod kubeconfig;
mod storage;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            kubeconfig::list_kube_contexts,
            kubeconfig::switch_kube_context,
            kubeconfig::import_kubeconfig_content,
            kubeconfig::clear_kubeconfig_override,
            kubeconfig::list_kubeconfig_items,
            kubeconfig::select_kubeconfig_item,
            kubeconfig::remove_kubeconfig_item,
            hosts::list_hosts_profiles,
            hosts::load_hosts_profile,
            hosts::save_hosts_profile,
            hosts::delete_hosts_profile,
            hosts::apply_hosts_profile,
            hosts::read_hosts_file,
            hosts::list_hosts_backups,
            hosts::restore_latest_hosts_backup,
            hosts::preview_hosts_profile_diff,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run opstools");
}
