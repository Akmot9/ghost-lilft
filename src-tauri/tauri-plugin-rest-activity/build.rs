const COMMANDS: &[&str] = &["start_activity", "update_activity", "end_activity"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .ios_path("ios")
    .build();
}
