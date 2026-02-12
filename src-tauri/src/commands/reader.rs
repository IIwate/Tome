use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

#[derive(Serialize)]
pub struct Chapter {
    pub title: String,
    pub start_offset: usize,
}

#[derive(Serialize)]
pub struct TxtContent {
    pub text: String,
    pub chapters: Vec<Chapter>,
    pub encoding: String,
}

static CHAPTER_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?m)^第[零一二三四五六七八九十百千万\d]+[章节回卷集部篇].*").unwrap(),
        Regex::new(r"(?mi)^Chapter\s+\d+.*").unwrap(),
        Regex::new(r"(?m)^卷[零一二三四五六七八九十百千万\d]+.*").unwrap(),
    ]
});

/// 编码检测级联策略：UTF-8 BOM → UTF-8 → chardetng → GB18030 兜底
fn detect_and_decode(bytes: &[u8]) -> (String, String) {
    // 1. UTF-8 BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "UTF-8".to_string(),
        );
    }

    // 2. 尝试纯 UTF-8
    if std::str::from_utf8(bytes).is_ok() {
        return (
            unsafe { String::from_utf8_unchecked(bytes.to_vec()) },
            "UTF-8".to_string(),
        );
    }

    // 3. chardetng 检测
    let sample_size = bytes.len().min(8192);
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(&bytes[..sample_size], sample_size == bytes.len());
    let encoding = detector.guess(None, false);

    let (cow, _used, _had_errors) = encoding.decode(bytes);
    (cow.into_owned(), encoding.name().to_string())
}

/// 章节正则拆分
fn split_chapters(text: &str, fallback_title: &str) -> Vec<Chapter> {
    for pattern in CHAPTER_PATTERNS.iter() {
        let chapters: Vec<Chapter> = pattern
            .find_iter(text)
            .map(|m| Chapter {
                title: m.as_str().trim().to_string(),
                start_offset: m.start(),
            })
            .collect();

        if !chapters.is_empty() {
            return chapters;
        }
    }

    // 无匹配：整篇作为单章节
    vec![Chapter {
        title: fallback_title.to_string(),
        start_offset: 0,
    }]
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stat_file(path: String) -> Result<u64, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

#[tauri::command]
pub fn read_txt_file(path: String) -> Result<TxtContent, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (text, encoding) = detect_and_decode(&bytes);

    let filename = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未知")
        .to_string();

    let chapters = split_chapters(&text, &filename);

    Ok(TxtContent {
        text,
        chapters,
        encoding,
    })
}
