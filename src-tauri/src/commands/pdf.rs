use base64::{engine::general_purpose, Engine as _};
use http::{header::{CACHE_CONTROL, CONTENT_TYPE}, Response, StatusCode};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};
use tauri_plugin_store::StoreExt;
use walkdir::WalkDir;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PdfFileMeta {
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CacheMeta {
    pub schema_version: u32,
    pub mtime_ms: u64,
    pub size: u64,
    pub jpeg_quality: u8,
    pub bucket_px: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum RenderPageResult {
    #[serde(rename = "file")]
    File {
        page_index: u32,
        width: u32,
        resource_url: String,
    },
    #[serde(rename = "data")]
    Data {
        page_index: u32,
        width: u32,
        data_url: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PdfCacheConfig {
    pub base_dir: String,
    pub effective_dir: String,
    pub using_default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PdfCacheValidateResult {
    pub effective_dir: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PdfCacheStats {
    pub effective_dir: String,
    pub file_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PdfCacheClearResult {
    pub effective_dir: String,
    pub removed_files: u64,
    pub removed_bytes: u64,
}

const MAX_RENDER_WIDTH: u32 = 2000;
const MAX_BOOKMARK_DEPTH: u32 = 50;
const JPEG_QUALITY_COVER: u8 = 85;
const JPEG_QUALITY_PAGE: u8 = 70;
const CACHE_SCHEMA_VERSION: u32 = 1;
const CACHE_BUCKET_PX: u32 = 64;
const CACHE_SETTINGS_FILE: &str = "settings.json";
const CACHE_SETTINGS_KEY: &str = "pdfCacheBaseDir";
const CACHE_SUBDIR: &str = "pdf_pages";
const CACHE_VERSION_SUBDIR: &str = "v1";
const CACHE_PROTOCOL_SCHEME: &str = "tome-cache";
#[cfg(not(any(target_os = "windows", target_os = "android")))]
const CACHE_PROTOCOL_HOST: &str = "localhost";

type PageLockKey = (PathBuf, u32, u32);

static PDFIUM: LazyLock<Result<Pdfium, String>> = LazyLock::new(init_pdfium_inner);
static PAGE_LOCKS: LazyLock<Mutex<HashMap<PageLockKey, Arc<StdMutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static CACHE_RESOURCE_REGISTRY: LazyLock<Mutex<HashMap<String, PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PAGE_RENDER_COUNT: AtomicUsize = AtomicUsize::new(0);

struct CachedDoc {
    path: PathBuf,
    document: Arc<StdMutex<PdfDocument<'static>>>,
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

pub fn pdf_cache_debug_render_count() -> usize {
    PAGE_RENDER_COUNT.load(Ordering::Relaxed)
}

pub fn pdf_cache_debug_reset_render_count() {
    PAGE_RENDER_COUNT.store(0, Ordering::Relaxed);
}

pub async fn render_pdf_page_with_cache_root_for_test(
    path: String,
    page_index: u32,
    width: u32,
    cache_root: Option<PathBuf>,
) -> Result<RenderPageResult, String> {
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
        render_pdf_page_cached_inner(cache_root, &canonical, page_index, width, |target_width| {
            let image = with_cached_document(&canonical, |document| {
                PAGE_RENDER_COUNT.fetch_add(1, Ordering::Relaxed);
                render_page_to_rgb_image(document, page_index, target_width)
            })?;
            encode_rgb_image_to_jpeg_bytes(&image, JPEG_QUALITY_PAGE)
        })
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
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
                    msg.push_str(&format!("- {}: {}\n", path.to_string_lossy(), err.trim()));
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
            let document = Arc::new(StdMutex::new(load_document(pdfium, path)?));

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

fn encode_rgb_image_to_jpeg_bytes(image: &image::RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut jpeg_bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, quality);
    encoder
        .encode_image(image)
        .map_err(|e| format!("JPEG 编码失败: {e}"))?;
    Ok(jpeg_bytes)
}

fn jpeg_bytes_to_data_url(bytes: &[u8]) -> String {
    let b64 = general_purpose::STANDARD.encode(bytes);
    format!("data:image/jpeg;base64,{b64}")
}

fn collect_bookmark_siblings(mut bookmark: Option<PdfBookmark>, depth: u32) -> Vec<PdfBookmarkNode> {
    let mut result = Vec::new();

    while let Some(node) = bookmark {
        let next = node.next_sibling();
        result.push(bookmark_to_node(node, depth));
        bookmark = next;
    }

    result
}

fn bookmark_to_node(bookmark: PdfBookmark, depth: u32) -> PdfBookmarkNode {
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

fn normalize_optional_dir(dir: &str) -> Option<String> {
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn load_custom_cache_base_dir<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    let store = app
        .store(CACHE_SETTINGS_FILE)
        .map_err(|e| format!("读取设置失败: {e}"))?;

    let value = store.get(CACHE_SETTINGS_KEY);
    Ok(value.and_then(|value| match value {
        Value::String(dir) => normalize_optional_dir(&dir),
        _ => None,
    }))
}

fn resolve_cache_root<R: Runtime>(app: &AppHandle<R>, custom_base: Option<&str>) -> Option<PathBuf> {
    let base_dir = custom_base
        .and_then(normalize_optional_dir)
        .or_else(|| load_custom_cache_base_dir(app).ok().flatten())
        .map(PathBuf::from)
        .or_else(|| app.path().app_cache_dir().ok());

    base_dir.map(|base| base.join(CACHE_SUBDIR).join(CACHE_VERSION_SUBDIR))
}

pub fn bucket_width(width: u32, bucket: u32) -> u32 {
    if width == 0 {
        return 0;
    }

    if bucket <= 1 {
        return width.min(MAX_RENDER_WIDTH);
    }

    let rounded = ((width.saturating_add(bucket - 1)) / bucket) * bucket;
    rounded.min(MAX_RENDER_WIDTH)
}

pub fn pdf_cache_dir(cache_root: &Path, pdf_path: &Path) -> PathBuf {
    cache_root.join(pdf_cache_key(pdf_path))
}

fn pdf_cache_key(pdf_path: &Path) -> String {
    let hash = blake3::hash(pdf_path.to_string_lossy().as_bytes())
        .to_hex()
        .to_string();
    hash[..32].to_string()
}

fn page_cache_path(cache_dir: &Path, page_index: u32, width: u32) -> PathBuf {
    cache_dir
        .join("pages")
        .join(format!("{page_index}_{width}.jpg"))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn cache_resource_key(doc_key: &str, page_index: u32, width: u32) -> String {
    format!("{doc_key}/{page_index}_{width}.jpg")
}

fn cache_resource_url(resource_key: &str) -> String {
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        format!("http://{}.localhost/{resource_key}", CACHE_PROTOCOL_SCHEME)
    }

    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        format!("{}://{}/{}", CACHE_PROTOCOL_SCHEME, CACHE_PROTOCOL_HOST, resource_key)
    }
}

fn remember_cache_resource(resource_key: &str, file_path: &Path) {
    if let Ok(mut registry) = CACHE_RESOURCE_REGISTRY.lock() {
        registry.insert(resource_key.to_string(), file_path.to_path_buf());
    }
}

fn lookup_cache_resource(resource_key: &str) -> Option<PathBuf> {
    CACHE_RESOURCE_REGISTRY
        .lock()
        .ok()
        .and_then(|registry| registry.get(resource_key).cloned())
        .filter(|path| path.is_file())
}

fn parse_cache_resource_key(resource_key: &str) -> Option<(String, u32, u32)> {
    let trimmed = resource_key.trim_start_matches('/');
    let (doc_key, file_name) = trimmed.split_once('/')?;
    if doc_key.len() != 32 || !doc_key.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }

    let file_name = file_name.strip_suffix(".jpg")?;
    let (page_index, width) = file_name.split_once('_')?;
    Some((
        doc_key.to_string(),
        page_index.parse().ok()?,
        width.parse().ok()?,
    ))
}

fn resolve_cache_resource_path<R: Runtime>(app: &AppHandle<R>, resource_key: &str) -> Option<PathBuf> {
    if let Some(path) = lookup_cache_resource(resource_key) {
        return Some(path);
    }

    let (doc_key, page_index, width) = parse_cache_resource_key(resource_key)?;
    let cache_root = resolve_cache_root(app, None)?;
    let file_path = cache_root
        .join(doc_key)
        .join("pages")
        .join(format!("{page_index}_{width}.jpg"));
    file_path.is_file().then_some(file_path)
}

fn build_cache_protocol_response(
    status: StatusCode,
    content_type: &'static str,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, content_type)
        .header(CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

pub fn handle_tome_cache_request<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let resource_key = request.uri().path().trim_start_matches('/');
    if resource_key.is_empty() {
        return build_cache_protocol_response(
            StatusCode::BAD_REQUEST,
            "text/plain; charset=utf-8",
            b"missing cache resource key".to_vec(),
        );
    }

    let Some(file_path) = resolve_cache_resource_path(ctx.app_handle(), resource_key) else {
        return build_cache_protocol_response(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            b"cache resource not found".to_vec(),
        );
    };

    match fs::read(&file_path) {
        Ok(bytes) => build_cache_protocol_response(StatusCode::OK, "image/jpeg", bytes),
        Err(err) if err.kind() == ErrorKind::NotFound => build_cache_protocol_response(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            b"cache file missing".to_vec(),
        ),
        Err(err) => build_cache_protocol_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain; charset=utf-8",
            format!("failed to read cache file: {err}").into_bytes(),
        ),
    }
}

fn file_modified_ms(metadata: &fs::Metadata) -> Result<u64, String> {
    let modified = metadata
        .modified()
        .map_err(|e| format!("读取文件修改时间失败: {e}"))?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("文件修改时间无效: {e}"))?;
    Ok(duration.as_millis() as u64)
}

fn pdf_file_meta(path: &Path) -> Result<PdfFileMeta, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("读取源 PDF 信息失败: {e}"))?;
    Ok(PdfFileMeta {
        mtime_ms: file_modified_ms(&metadata)?,
        size: metadata.len(),
    })
}

fn read_and_validate_meta(
    cache_dir: &Path,
    current_meta: &PdfFileMeta,
) -> Result<Option<CacheMeta>, String> {
    let meta_path = cache_dir.join("meta.json");
    let raw = match fs::read_to_string(&meta_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Ok(None),
    };

    let meta: CacheMeta = match serde_json::from_str(&raw) {
        Ok(meta) => meta,
        Err(_) => return Ok(None),
    };

    if meta.schema_version != CACHE_SCHEMA_VERSION
        || meta.mtime_ms != current_meta.mtime_ms
        || meta.size != current_meta.size
        || meta.jpeg_quality != JPEG_QUALITY_PAGE
        || meta.bucket_px != CACHE_BUCKET_PX
    {
        return Ok(None);
    }

    Ok(Some(meta))
}

fn try_read_page_cache(cache_dir: &Path, page_index: u32, bucketed_width: u32) -> Option<PathBuf> {
    let path = page_cache_path(cache_dir, page_index, bucketed_width);
    match fs::metadata(&path) {
        Ok(meta) if meta.is_file() && meta.len() > 0 => Some(path),
        _ => None,
    }
}

fn temp_write_path(dest: &Path) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    dest.with_extension(format!("{}.tmp", unique))
}

fn atomic_write_bytes(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    }

    let tmp = temp_write_path(dest);
    fs::write(&tmp, bytes).map_err(|e| format!("写入临时缓存文件失败: {e}"))?;

    if dest.exists() {
        fs::remove_file(dest).map_err(|e| format!("清理旧缓存文件失败: {e}"))?;
    }

    if let Err(err) = fs::rename(&tmp, dest) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("原子替换缓存文件失败: {err}"));
    }

    Ok(())
}

fn atomic_write_jpeg(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_write_bytes(dest, bytes)
}

fn write_page_and_meta(
    cache_dir: &Path,
    page_index: u32,
    width: u32,
    jpeg_bytes: &[u8],
    meta: &CacheMeta,
) -> Result<PathBuf, String> {
    let page_path = page_cache_path(cache_dir, page_index, width);
    atomic_write_jpeg(&page_path, jpeg_bytes)?;

    let meta_path = cache_dir.join("meta.json");
    let meta_bytes = serde_json::to_vec_pretty(meta)
        .map_err(|e| format!("序列化缓存元数据失败: {e}"))?;
    atomic_write_bytes(&meta_path, &meta_bytes)?;

    Ok(page_path)
}

fn get_page_lock(key: PageLockKey) -> Result<Arc<StdMutex<()>>, String> {
    let mut locks = PAGE_LOCKS
        .lock()
        .map_err(|_| "PAGE_LOCKS 锁已被毒化".to_string())?;
    Ok(locks
        .entry(key)
        .or_insert_with(|| Arc::new(StdMutex::new(())))
        .clone())
}

fn collect_dir_stats(root: &Path) -> Result<(u64, u64), String> {
    if !root.exists() {
        return Ok((0, 0));
    }
    if !root.is_dir() {
        return Err("缓存路径不是目录".to_string());
    }

    let mut file_count = 0_u64;
    let mut total_bytes = 0_u64;

    for entry in WalkDir::new(root) {
        let entry = entry.map_err(|e| format!("遍历缓存目录失败: {e}"))?;
        if entry.file_type().is_file() {
            file_count += 1;
            total_bytes += entry
                .metadata()
                .map_err(|e| format!("读取缓存文件信息失败: {e}"))?
                .len();
        }
    }

    Ok((file_count, total_bytes))
}

pub fn validate_cache_root(root: &Path) -> Result<(), String> {
    if root.exists() && !root.is_dir() {
        return Err("缓存路径不是目录".to_string());
    }

    fs::create_dir_all(root).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let probe_path = root.join(".probe");
    atomic_write_bytes(&probe_path, b"ok")?;
    fs::remove_file(&probe_path).map_err(|e| format!("清理缓存探针文件失败: {e}"))?;
    Ok(())
}

pub fn clear_cache_root(root: &Path) -> Result<(u64, u64), String> {
    if root.exists() && !root.is_dir() {
        return Err("缓存路径不是目录".to_string());
    }

    let (file_count, total_bytes) = collect_dir_stats(root)?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(|e| format!("清理缓存目录失败: {e}"))?;
    }

    Ok((file_count, total_bytes))
}

fn render_pdf_page_cached_inner<F>(
    cache_root: Option<PathBuf>,
    pdf_path: &Path,
    page_index: u32,
    width: u32,
    render_fn: F,
) -> Result<RenderPageResult, String>
where
    F: Fn(u32) -> Result<Vec<u8>, String>,
{
    if width == 0 {
        return Err("width 必须大于 0".to_string());
    }

    if width > MAX_RENDER_WIDTH {
        return Err(format!(
            "width 过大: {width}，最大允许 {MAX_RENDER_WIDTH}"
        ));
    }

    if let Some(cache_root) = cache_root {
        let source_meta = pdf_file_meta(pdf_path)?;
        let bucketed_width = bucket_width(width, CACHE_BUCKET_PX);
        let doc_key = pdf_cache_key(pdf_path);
        let resource_key = cache_resource_key(&doc_key, page_index, bucketed_width);
        let cache_dir = pdf_cache_dir(&cache_root, pdf_path);
        let page_lock = get_page_lock((cache_dir.clone(), page_index, bucketed_width))?;
        let _guard = page_lock
            .lock()
            .map_err(|_| "页面缓存锁已被毒化".to_string())?;

        if read_and_validate_meta(&cache_dir, &source_meta)?.is_none() {
            let _ = fs::remove_dir_all(&cache_dir);
        }

        if let Some(file_path) = try_read_page_cache(&cache_dir, page_index, bucketed_width) {
            remember_cache_resource(&resource_key, &file_path);
            return Ok(RenderPageResult::File {
                page_index,
                width: bucketed_width,
                resource_url: cache_resource_url(&resource_key),
            });
        }

        let jpeg_bytes = render_fn(bucketed_width)?;
        let cache_meta = CacheMeta {
            schema_version: CACHE_SCHEMA_VERSION,
            mtime_ms: source_meta.mtime_ms,
            size: source_meta.size,
            jpeg_quality: JPEG_QUALITY_PAGE,
            bucket_px: CACHE_BUCKET_PX,
        };

        return match write_page_and_meta(
            &cache_dir,
            page_index,
            bucketed_width,
            &jpeg_bytes,
            &cache_meta,
        ) {
            Ok(file_path) => {
                remember_cache_resource(&resource_key, &file_path);
                Ok(RenderPageResult::File {
                    page_index,
                    width: bucketed_width,
                    resource_url: cache_resource_url(&resource_key),
                })
            }
            Err(_) => Ok(RenderPageResult::Data {
                page_index,
                width: bucketed_width,
                data_url: jpeg_bytes_to_data_url(&jpeg_bytes),
            }),
        };
    }

    let jpeg_bytes = render_fn(width)?;
    Ok(RenderPageResult::Data {
        page_index,
        width,
        data_url: jpeg_bytes_to_data_url(&jpeg_bytes),
    })
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
            .map(|image| encode_rgb_image_to_jpeg_bytes(image, JPEG_QUALITY_COVER))
            .transpose()?
            .map(|bytes| jpeg_bytes_to_data_url(&bytes))
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
pub async fn render_pdf_page(
    app: AppHandle,
    path: String,
    page_index: u32,
    width: u32,
) -> Result<RenderPageResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = validate_book_path(&path)?;
        let cache_root = resolve_cache_root(&app_handle, None);
        render_pdf_page_cached_inner(cache_root, &canonical, page_index, width, |target_width| {
            let image = with_cached_document(&canonical, |document| {
                PAGE_RENDER_COUNT.fetch_add(1, Ordering::Relaxed);
                render_page_to_rgb_image(document, page_index, target_width)
            })?;
            encode_rgb_image_to_jpeg_bytes(&image, JPEG_QUALITY_PAGE)
        })
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
}

#[tauri::command]
pub fn pdf_cache_get_config(app: AppHandle) -> Result<PdfCacheConfig, String> {
    let base_dir = load_custom_cache_base_dir(&app)?.unwrap_or_default();
    let effective_dir = resolve_cache_root(&app, None)
        .ok_or_else(|| "无法解析 PDF 缓存目录".to_string())?;

    Ok(PdfCacheConfig {
        base_dir: base_dir.clone(),
        effective_dir: path_to_string(&effective_dir),
        using_default: base_dir.is_empty(),
    })
}

#[tauri::command]
pub async fn pdf_cache_validate_dir(
    app: AppHandle,
    dir: String,
) -> Result<PdfCacheValidateResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let effective_dir = resolve_cache_root(&app_handle, Some(&dir))
            .ok_or_else(|| "无法解析 PDF 缓存目录".to_string())?;
        validate_cache_root(&effective_dir)?;
        Ok(PdfCacheValidateResult {
            effective_dir: path_to_string(&effective_dir),
        })
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
}

#[tauri::command]
pub async fn pdf_cache_get_stats(app: AppHandle) -> Result<PdfCacheStats, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let effective_dir = resolve_cache_root(&app_handle, None)
            .ok_or_else(|| "无法解析 PDF 缓存目录".to_string())?;
        let (file_count, total_bytes) = collect_dir_stats(&effective_dir)?;
        Ok(PdfCacheStats {
            effective_dir: path_to_string(&effective_dir),
            file_count,
            total_bytes,
        })
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
}

#[tauri::command]
pub async fn pdf_cache_clear(app: AppHandle) -> Result<PdfCacheClearResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let effective_dir = resolve_cache_root(&app_handle, None)
            .ok_or_else(|| "无法解析 PDF 缓存目录".to_string())?;
        let (removed_files, removed_bytes) = clear_cache_root(&effective_dir)?;
        Ok(PdfCacheClearResult {
            effective_dir: path_to_string(&effective_dir),
            removed_files,
            removed_bytes,
        })
    })
    .await
    .map_err(|e| format!("阻塞任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::thread;
    use std::time::Duration;

    fn unique_temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "tome-pdf-cache-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn sample_jpeg_bytes() -> Vec<u8> {
        let image = image::RgbImage::from_fn(2, 2, |x, y| {
            if (x + y) % 2 == 0 {
                image::Rgb([255, 255, 255])
            } else {
                image::Rgb([32, 64, 128])
            }
        });
        encode_rgb_image_to_jpeg_bytes(&image, JPEG_QUALITY_PAGE).expect("JPEG 编码失败")
    }

    fn write_source_file(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("创建测试目录失败");
        }
        fs::write(path, bytes).expect("写入测试源文件失败");
    }

    #[test]
    fn bucket_width_rounds_up() {
        assert_eq!(bucket_width(1, 64), 64);
        assert_eq!(bucket_width(64, 64), 64);
        assert_eq!(bucket_width(65, 64), 128);
        assert_eq!(bucket_width(127, 64), 128);
        assert_eq!(bucket_width(128, 64), 128);
        assert_eq!(bucket_width(1999, 64), 2000);
        assert_eq!(bucket_width(2000, 64), 2000);
    }

    #[test]
    fn pdf_cache_dir_is_stable_and_namespaced() {
        let root = PathBuf::from("C:/cache-root");
        let first = pdf_cache_dir(&root, Path::new("C:/books/demo.pdf"));
        let second = pdf_cache_dir(&root, Path::new("C:/books/demo.pdf"));
        let third = pdf_cache_dir(&root, Path::new("C:/books/other.pdf"));

        assert_eq!(first, second);
        assert_ne!(first, third);
        assert!(first.starts_with(&root));
        assert_eq!(
            first.file_name().unwrap().to_string_lossy().len(),
            32,
            "目录名应为 32 位 hex"
        );
    }

    #[test]
    fn read_and_validate_meta_handles_miss_and_hit() {
        let dir = unique_temp_path("meta");
        let current = PdfFileMeta {
            mtime_ms: 12,
            size: 34,
        };

        assert_eq!(read_and_validate_meta(&dir, &current).unwrap(), None);

        fs::create_dir_all(&dir).expect("创建目录失败");
        fs::write(dir.join("meta.json"), b"not-json").expect("写入 meta 失败");
        assert_eq!(read_and_validate_meta(&dir, &current).unwrap(), None);

        let meta = CacheMeta {
            schema_version: CACHE_SCHEMA_VERSION,
            mtime_ms: current.mtime_ms,
            size: current.size,
            jpeg_quality: JPEG_QUALITY_PAGE,
            bucket_px: CACHE_BUCKET_PX,
        };
        fs::write(
            dir.join("meta.json"),
            serde_json::to_vec(&meta).expect("序列化 meta 失败"),
        )
        .expect("写入 meta 失败");
        assert_eq!(read_and_validate_meta(&dir, &current).unwrap(), Some(meta));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_jpeg_creates_and_updates_file() {
        let dir = unique_temp_path("atomic");
        let dest = dir.join("pages/0_832.jpg");

        atomic_write_jpeg(&dest, b"one").expect("首次写入失败");
        assert_eq!(fs::read(&dest).expect("读取文件失败"), b"one");

        atomic_write_jpeg(&dest, b"two").expect("覆盖写入失败");
        assert_eq!(fs::read(&dest).expect("读取文件失败"), b"two");

        let tmp_count = WalkDir::new(&dir)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.file_type().is_file()
                    && entry
                        .path()
                        .extension()
                        .map(|ext| ext.to_string_lossy().contains("tmp"))
                        .unwrap_or(false)
            })
            .count();
        assert_eq!(tmp_count, 0, "不应残留临时文件");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn jpeg_bytes_to_data_url_round_trip() {
        let bytes = sample_jpeg_bytes();
        let data_url = jpeg_bytes_to_data_url(&bytes);
        assert!(data_url.starts_with("data:image/jpeg;base64,"));

        let b64 = data_url
            .strip_prefix("data:image/jpeg;base64,")
            .expect("data url 前缀错误");
        let decoded = general_purpose::STANDARD
            .decode(b64)
            .expect("base64 解码失败");
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn render_cached_inner_hits_disk_cache() {
        let root = unique_temp_path("render-hit");
        let pdf_path = root.join("source.pdf");
        write_source_file(&pdf_path, b"hello");
        let render_count = AtomicUsize::new(0);

        let first = render_pdf_page_cached_inner(Some(root.clone()), &pdf_path, 0, 800, |_| {
            render_count.fetch_add(1, Ordering::Relaxed);
            Ok(sample_jpeg_bytes())
        })
        .expect("首次渲染失败");
        let second = render_pdf_page_cached_inner(Some(root.clone()), &pdf_path, 0, 832, |_| {
            render_count.fetch_add(1, Ordering::Relaxed);
            Ok(sample_jpeg_bytes())
        })
        .expect("二次渲染失败");

        assert_eq!(render_count.load(Ordering::Relaxed), 1, "相同桶宽应命中缓存");
        match (first, second) {
            (
                RenderPageResult::File { resource_url: a, width: aw, .. },
                RenderPageResult::File { resource_url: b, width: bw, .. },
            ) => {
                assert_eq!(aw, 832);
                assert_eq!(bw, 832);
                assert_eq!(a, b);
                assert!(a.contains("0_832.jpg"));
            }
            other => panic!("预期 file 结果，实际为 {other:?}"),
        }

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn render_cached_inner_invalidates_when_source_changes() {
        let root = unique_temp_path("render-invalidate");
        let pdf_path = root.join("source.pdf");
        write_source_file(&pdf_path, b"hello");
        let render_count = AtomicUsize::new(0);

        render_pdf_page_cached_inner(Some(root.clone()), &pdf_path, 0, 800, |_| {
            render_count.fetch_add(1, Ordering::Relaxed);
            Ok(sample_jpeg_bytes())
        })
        .expect("首次渲染失败");

        thread::sleep(Duration::from_millis(20));
        write_source_file(&pdf_path, b"hello-world");

        render_pdf_page_cached_inner(Some(root.clone()), &pdf_path, 0, 800, |_| {
            render_count.fetch_add(1, Ordering::Relaxed);
            Ok(sample_jpeg_bytes())
        })
        .expect("变更后渲染失败");

        assert_eq!(render_count.load(Ordering::Relaxed), 2, "源文件变更后应重渲染");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn render_cached_inner_falls_back_to_data_when_cache_unavailable() {
        let root = unique_temp_path("render-data");
        let pdf_path = root.join("source.pdf");
        write_source_file(&pdf_path, b"hello");

        let root_as_file = root.join("cache-as-file");
        fs::create_dir_all(&root).expect("创建目录失败");
        fs::write(&root_as_file, b"not-a-dir").expect("写入文件失败");

        let result = render_pdf_page_cached_inner(Some(root_as_file), &pdf_path, 0, 800, |_| {
            Ok(sample_jpeg_bytes())
        })
        .expect("降级渲染失败");

        match result {
            RenderPageResult::Data { data_url, .. } => {
                assert!(data_url.starts_with("data:image/jpeg;base64,"));
            }
            other => panic!("预期 data 结果，实际为 {other:?}"),
        }

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_and_clear_cache_root_work() {
        let root = unique_temp_path("validate-clear");
        validate_cache_root(&root).expect("校验缓存目录失败");

        let file = root.join("pages/0_832.jpg");
        atomic_write_jpeg(&file, b"hello").expect("写入缓存文件失败");
        let (files, bytes) = collect_dir_stats(&root).expect("统计缓存失败");
        assert!(files >= 1);
        assert!(bytes >= 5);

        let (removed_files, removed_bytes) = clear_cache_root(&root).expect("清理缓存失败");
        assert_eq!(removed_files, files);
        assert_eq!(removed_bytes, bytes);
        assert!(!root.exists());
    }
}
