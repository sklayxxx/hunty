// UI вшивается в бинарник (include_dir) — пересобираем, когда меняются файлы интерфейса
fn main() {
    println!("cargo:rerun-if-changed=../../ui");
    println!("cargo:rerun-if-changed=../../src-tauri/icons/128x128@2x.png");
}
