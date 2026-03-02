use base64::{engine::general_purpose, Engine as _};
use pdfium_render::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use super::reader::validate_book_path;

#[derive(Serialize)]
pub struct PdfMeta {
    pub title: String,
    pub author: String,
    pub cover_base64: String,
}

#[derive(Serialize)]
pub struct PdfBookmarkNode {
    pub title: String,
    pub page_index: u32,
    pub children: Vec<PdfBookmarkNode>,
}

#[derive(Serialize)]
pub struct PdfInfo {
    pub page_count: u32,
    pub bookmarks: Vec<PdfBookmarkNode>,
}

const MAX_RENDER_WIDTH: u32 = 2000;
const MAX_BOOKMARK_DEPTH: u32 = 50;
const JPEG_QUALITY_COVER: u8 = 85;
const JPEG_QUALITY_PAGE: u8 = 70;

static PDFIUM: LazyLock<Result<Pdfium, String>> = LazyLock::new(init_pdfium_inner);

struct CachedDoc {
    path: PathBuf,
    document: Arc<Mutex<PdfDocument<'static>>>,
}

static DOC_CACHE: LazyLock<Mutex<Option<CachedDoc>>> = LazyLock::new(|| Mutex::new(None));
static DOC_OPEN_COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn pdf_debug_open_count() -> usize {
    DOC_OPEN_COUNT.load(Ordering::Relaxed)
}

pub fn pdf_debug_reset_open_count() {
    DOC_OPEN_COUNT.store(0, Ordering::Relaxed);
}

pub fn pdf_debug_clear_doc_cache() {
    if let Ok(mut cache) = DOC_CACHE.lock() {
        *cache = None;
    }
}

fn get_pdfium() -> Result<&'static Pdfium, String> {
    match &*PDFIUM {
        Ok(pdfium) => Ok(pdfium),
        Err(err) => Err(err.clone()),
    }
}

fn init_pdfium_inner() -> Result<Pdfium, String> {
    let mut attempts: Vec<(PathBuf, String)> = Vec::new();
    let mut current_exe_error: Option<String> = None;

    let exe_dir = match std::env::current_exe() {
        Ok(path) => path.parent().map(|p| p.to_path_buf()),
        Err(e) => {
            current_exe_error = Some(e.to_string());
            None
        }
    };

    if let Some(dir) = exe_dir {
        for candidate_dir in [dir.clone(), dir.join("resources")] {
            let lib_path = Pdfium::pdfium_platform_library_name_at_path(&candidate_dir);

            match Pdfium::bind_to_library(&lib_path) {
                Ok(bindings) => return Ok(Pdfium::new(bindings)),
                Err(e) => attempts.push((lib_path, e.to_string())),
            }
        }
    }

    match Pdfium::bind_to_system_library() {
        Ok(bindings) => Ok(Pdfium::new(bindings)),
        Err(e) => {
            let mut msg = String::from("无法加载 Pdfium 动态库。");

            if let Some(exe_err) = current_exe_error {
                msg.push_str(&format!("current_exe 失败: {exe_err}\n"));
            }

            if !attempts.is_empty() {
                msg.push_str("已尝试路径:\n");
                for (path, err) in attempts {
                    msg.push_str(&format!(
                        "- {}: {}\n",
                        path.to_string_lossy(),
                        err.trim()
                    ));
                }
            }

            msg.push_str(&format!("system: {e}"));
            Err(msg)
        }
    }
}

fn load_document<'a>(pdfium: &'a Pdfium, path: &Path) -> Result<PdfDocument<'a>, String> {
    pdfium
        .load_pdf_from_file(path, None)
        .map_err(|e| format!("打开 PDF 失败: {e}"))
}

fn with_cached_document<T, F>(path: &Path, f: F) -> Result<T, String>
where
    F: FnOnce(&PdfDocument) -> Result<T, String>,
{
    let document = {
        let cache = DOC_CACHE
            .lock()
            .map_err(|_| "DOC_CACHE 锁已被毒化".to_string())?;

        if let Some(cached) = cache.as_ref().filter(|cached| cached.path.as_path() == path) {
            cached.document.clone()
        } else {
            drop(cache);

            let pdfium = get_pdfium()?;
            let document = Arc::new(Mutex::new(load_document(pdfium, path)?));

            let mut cache = DOC_CACHE
                .lock()
                .map_err(|_| "DOC_CACHE 锁已被毒化".to_string())?;

            if let Some(cached) = cache.as_ref().filter(|cached| cached.path.as_path() == path) {
                cached.document.clone()
            } else {
                DOC_OPEN_COUNT.fetch_add(1, Ordering::Relaxed);
                *cache = Some(CachedDoc {
                    path: path.to_path_buf(),
                    document: document.clone(),
                });
                document
            }
        }
    };

    let document = document
        .lock()
        .map_err(|_| "PDF 文档锁已被毒化".to_string())?;

    f(&document)
}

fn render_page_to_rgb_image(
    document: &PdfDocument,
    page_index: u32,
    width: u32,
) -> Result<image::RgbImage, String> {
    if width == 0 {
        return Err("width 必须大于 0".to_string());
    }

    if width > MAX_RENDER_WIDTH {
        return Err(format!(
            "width 过大: {width}，最大允许 {MAX_RENDER_WIDTH}"
        ));
    }

    let page_index_usize =
        usize::try_from(page_index).map_err(|_| "page_index 超出范围".to_string())?;

    let page_count = document.pages().len() as usize;
    if page_index_usize >= page_count {
        return Err(format!(
            "page_index 超出范围: {page_index}，总页数 {page_count}"
        ));
    }

    let page_index = u16::try_from(page_index).map_err(|_| "page_index 超出范围".to_string())?;
    let target_width = i32::try_from(width).map_err(|_| "width 超出范围".to_string())?;

    let page = document
        .pages()
        .get(page_index)
        .map_err(|e| format!("读取页面失败: {e}"))?;

    let bitmap = page
        .render_with_config(&PdfRenderConfig::new().set_target_width(target_width))
        .map_err(|e| format!("渲染页面失败: {e}"))?;

    Ok(bitmap.as_image().into_rgb8())
}

fn encode_rgb_image_to_jpeg_data_url(image: &image::RgbImage, quality: u8) -> Result<String, String> {
    let mut jpeg_bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, quality);
    encoder
        .encode_image(image)
        .map_err(|e| format!("JPEG 编码失败: {e}"))?;

    let b64 = general_purpose::STANDARD.encode(jpeg_bytes);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

fn collect_bookmark_siblings<'a>(
    mut bookmark: Option<PdfBookmark<'a>>,
    depth: u32,
) -> Vec<PdfBookmarkNode> {
    let mut result = Vec::new();

    while let Some(node) = bookmark {
        let next = node.next_sibling();
        result.push(bookmark_to_node(node, depth));
        bookmark = next;
    }

    result
}

fn bookmark_to_node<'a>(bookmark: PdfBookmark<'a>, depth: u32) -> PdfBookmarkNode {
    let title = bookmark
        .title()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "未命名".to_string());

    let page_index = bookmark
        .destination()
        .and_then(|d| d.page_index().ok())
        .map(|i| i as u32)
        .unwrap_or(0);

    let children = if depth >= MAX_BOOKMARK_DEPTH {
        Vec::new()
    } else {
        collect_bookmark_siblings(bookmark.first_child(), depth + 1)
    };

    PdfBookmarkNode {
        title,
        page_index,
        children,
    }
}

#[tauri::command]
pub async fn extract_pdf_meta(path: String) -> Result<PdfMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = validate_book_path(&path)?;

        let filename = canonical
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未知")
            .to_string();

        let (title, author, cover_image) = with_cached_document(&canonical, |document| {
            let metadata = document.metadata();

            let title = metadata
                .get(PdfDocumentMetadataTagType::Title)
                .map(|t| t.value().trim().to_string())
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| filename.clone());

            let author = metadata
                .get(PdfDocumentMetadataTagType::Author)
                .map(|t| t.value().trim().to_string())
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| "未知作者".to_string());

            let page_count = document.pages().len();
            let cover_image = if page_count == 0 {
                None
            } else {
                Some(render_page_to_rgb_image(document, 0, 300)?)
            };

            Ok((title, author, cover_image))
        })?;

        let cover_base64 = cover_image
            .as_ref()
            .map(|image| encode_rgb_image_to_jpeg_data_url(image, JPEG_QUALITY_COVER))
            .transpose()?
            .unwrap_or_default();

        Ok(PdfMeta {
            title,
            author,
            cover_base64,
        })
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
}

#[tauri::command]
pub async fn get_pdf_info(path: String) -> Result<PdfInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = validate_book_path(&path)?;
        with_cached_document(&canonical, |document| {
            let page_count = document.pages().len() as u32;
            let bookmarks = collect_bookmark_siblings(document.bookmarks().root(), 1);
            Ok(PdfInfo {
                page_count,
                bookmarks,
            })
        })
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
}

#[tauri::command]
pub async fn render_pdf_page(path: String, page_index: u32, width: u32) -> Result<String, String> {
    if width == 0 {
        return Err("width 必须大于 0".to_string());
    }

    if width > MAX_RENDER_WIDTH {
        return Err(format!(
            "width 过大: {width}，最大允许 {MAX_RENDER_WIDTH}"
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let canonical = validate_book_path(&path)?;
        let image = with_cached_document(&canonical, |document| {
            render_page_to_rgb_image(document, page_index, width)
        })?;
        encode_rgb_image_to_jpeg_data_url(&image, JPEG_QUALITY_PAGE)
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
}
