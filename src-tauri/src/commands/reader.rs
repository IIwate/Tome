use regex::Regex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::LazyLock;

const ALLOWED_EXTENSIONS: &[&str] = &["txt", "epub"];

/// 校验文件路径：规范化 + 扩展名白名单
fn validate_book_path(path: &str) -> Result<PathBuf, String> {
    let canonical = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("路径无效: {e}"))?;

    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("不支持的文件类型: .{ext}"));
    }

    Ok(canonical)
}

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
    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return (text, "UTF-8".to_string());
    }

    // 3. chardetng 检测
    let sample_size = bytes.len().min(8192);
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(&bytes[..sample_size], sample_size == bytes.len());
    let encoding = detector.guess(None, false);

    let (cow, _used, had_errors) = encoding.decode(bytes);

    // 低置信度或解码错误时回退 GB18030
    if had_errors && encoding.name() != "gb18030" {
        let gb = encoding_rs::GB18030;
        let (gb_cow, _, gb_errors) = gb.decode(bytes);
        if !gb_errors {
            return (gb_cow.into_owned(), "GB18030".to_string());
        }
    }

    (cow.into_owned(), encoding.name().to_string())
}

/// 构建 UTF-8 字节偏移 → UTF-16 码元索引映射（单次线性遍历）
fn build_byte_to_utf16_map(text: &str) -> Vec<usize> {
    let mut map = vec![0usize; text.len() + 1];
    let mut u16_offset = 0;
    for (byte_idx, ch) in text.char_indices() {
        map[byte_idx] = u16_offset;
        u16_offset += ch.len_utf16();
    }
    map[text.len()] = u16_offset;
    map
}

/// 章节正则拆分
fn split_chapters(text: &str, fallback_title: &str) -> Vec<Chapter> {
    let byte_to_u16 = build_byte_to_utf16_map(text);

    for pattern in CHAPTER_PATTERNS.iter() {
        let chapters: Vec<Chapter> = pattern
            .find_iter(text)
            .map(|m| Chapter {
                title: m.as_str().trim().to_string(),
                start_offset: byte_to_u16[m.start()],
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
    let canonical = validate_book_path(&path)?;
    std::fs::read(&canonical).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stat_file(path: String) -> Result<u64, String> {
    let canonical = validate_book_path(&path)?;
    let metadata = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

#[tauri::command]
pub fn delete_book_file(path: String) -> Result<(), String> {
    let canonical = validate_book_path(&path)?;
    std::fs::remove_file(&canonical).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_txt_file(path: String) -> Result<TxtContent, String> {
    let canonical = validate_book_path(&path)?;
    let bytes = std::fs::read(&canonical).map_err(|e| e.to_string())?;
    let (text, encoding) = detect_and_decode(&bytes);

    let filename = canonical
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_and_decode_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("你好".as_bytes());

        let (text, encoding) = detect_and_decode(&bytes);
        assert!(text.contains("你好"));
        assert_eq!(encoding, "UTF-8");
    }

    #[test]
    fn detect_and_decode_pure_utf8() {
        let input = "hello 世界";
        let (text, encoding) = detect_and_decode(input.as_bytes());
        assert_eq!(text, input);
        assert_eq!(encoding, "UTF-8");
    }

    #[test]
    fn detect_and_decode_gbk() {
        let (gbk_bytes, _, had_errors) = encoding_rs::GBK.encode("你好，世界");
        assert!(!had_errors);

        let (text, encoding) = detect_and_decode(gbk_bytes.as_ref());
        assert!(text.contains("你好"));
        assert!(!encoding.is_empty());
    }

    #[test]
    fn detect_and_decode_empty() {
        let (text, encoding) = detect_and_decode(&[]);
        assert_eq!(text, "");
        assert_eq!(encoding, "UTF-8");
    }

    #[test]
    fn split_chapters_chinese() {
        let text = "第一章 开始\n内容\n第二章 结束";
        let chapters = split_chapters(text, "回退标题");

        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "第一章 开始");
        assert_eq!(chapters[1].title, "第二章 结束");
        assert!(chapters[0].start_offset < chapters[1].start_offset);
    }

    #[test]
    fn split_chapters_english() {
        let text = "Chapter 1 Begin\ntext\nChapter 2 End";
        let chapters = split_chapters(text, "fallback");

        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "Chapter 1 Begin");
        assert_eq!(chapters[1].title, "Chapter 2 End");
    }

    #[test]
    fn split_chapters_volume() {
        let text = "卷一 起源\n...\n卷二 发展";
        let chapters = split_chapters(text, "fallback");

        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "卷一 起源");
        assert_eq!(chapters[1].title, "卷二 发展");
    }

    #[test]
    fn split_chapters_fallback() {
        let text = "这是一段没有章节标记的正文。";
        let chapters = split_chapters(text, "默认标题");

        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].title, "默认标题");
        assert_eq!(chapters[0].start_offset, 0);
    }

    #[test]
    fn split_chapters_utf16_offsets_with_emoji() {
        let text = "第一章 你好🌍\n第二章 世界";
        let chapters = split_chapters(text, "fallback");

        assert_eq!(chapters.len(), 2);
        let second_byte_offset = text.find("第二章").expect("应找到第二章");
        let expected_u16 = text[..second_byte_offset].encode_utf16().count();
        assert_eq!(chapters[1].start_offset, expected_u16);
    }

    #[test]
    fn byte_to_utf16_map_ascii() {
        let map = build_byte_to_utf16_map("abc");
        assert_eq!(map[0], 0);
        assert_eq!(map[1], 1);
        assert_eq!(map[2], 2);
        assert_eq!(map[3], 3);
    }

    #[test]
    fn byte_to_utf16_map_cjk() {
        let map = build_byte_to_utf16_map("你好");
        assert_eq!(map[0], 0);
        assert_eq!(map[3], 1);
        assert_eq!(map[6], 2);
    }

    #[test]
    fn byte_to_utf16_map_surrogate_pair() {
        let map = build_byte_to_utf16_map("a𝄞b");
        assert_eq!(map[0], 0);
        assert_eq!(map[1], 1);
        assert_eq!(map[5], 3);
        assert_eq!(map[6], 4);
    }
}
