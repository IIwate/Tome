use serde::Serialize;
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct ScannedBook {
    pub path: String,
    pub filename: String,
    pub extension: String,
    pub size: u64,
}

#[tauri::command]
pub fn scan_books(root: String, extensions: Vec<String>) -> Result<Vec<ScannedBook>, String> {
    let exts: Vec<String> = extensions.iter().map(|e| e.to_lowercase()).collect();
    let mut books = Vec::new();

    for entry in WalkDir::new(&root)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if books.len() >= 10000 {
            break;
        }

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        if !exts.contains(&ext) {
            continue;
        }

        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

        books.push(ScannedBook {
            path: path.to_string_lossy().into_owned(),
            filename: path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string(),
            extension: ext,
            size,
        });
    }

    Ok(books)
}
