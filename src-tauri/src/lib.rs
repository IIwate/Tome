pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::scan::scan_books,
            commands::reader::read_file_bytes,
            commands::reader::read_txt_file,
            commands::reader::stat_file,
            commands::reader::delete_book_file,
            commands::pdf::extract_pdf_meta,
            commands::pdf::get_pdf_info,
            commands::pdf::render_pdf_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
