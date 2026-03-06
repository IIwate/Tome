use std::future::Future;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use tome_lib::commands::pdf::{self, RenderPageResult};

static TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn find_fixture_pdf() -> Option<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures");
    let mut best: Option<(u64, PathBuf)> = None;

    let entries = std::fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        if ext != "pdf" {
            continue;
        }

        let size = entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
        match &best {
            Some((best_size, _)) if size >= *best_size => {}
            _ => best = Some((size, path)),
        }
    }

    best.map(|(_, path)| path)
}

fn is_pdfium_missing_error(err: &str) -> bool {
    err.contains("无法加载 Pdfium 动态库")
}

fn block_on<T>(fut: impl Future<Output = T>) -> T {
    tauri::async_runtime::block_on(fut)
}

fn unique_cache_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "tome-pdf-cache-it-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}

#[test]
fn render_page_returns_resource_url_and_hits_disk_cache() {
    let _guard = TEST_LOCK.lock().expect("锁获取失败");

    let fixture = match find_fixture_pdf() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: tests/fixtures 下没有 PDF");
            return;
        }
    };

    let cache_root = unique_cache_root();
    pdf::pdf_debug_clear_doc_cache();
    pdf::pdf_debug_reset_open_count();
    pdf::pdf_cache_debug_reset_render_count();

    let path = fixture.to_string_lossy().into_owned();
    let first = block_on(pdf::render_pdf_page_with_cache_root_for_test(
        path.clone(),
        0,
        800,
        Some(cache_root.clone()),
    ));

    let first_url = match first {
        Ok(RenderPageResult::File {
            resource_url, width, ..
        }) => {
            assert_eq!(width, 832);
            assert!(resource_url.contains("0_832.jpg"));
            let cache_dir = pdf::pdf_cache_dir(&cache_root, &fixture);
            assert!(cache_dir.join("pages").join("0_832.jpg").is_file());
            resource_url
        }
        Ok(other) => panic!("预期 file 结果，实际为 {other:?}"),
        Err(err) if is_pdfium_missing_error(&err) => {
            eprintln!("SKIP: Pdfium 不可用: {err}");
            let _ = std::fs::remove_dir_all(&cache_root);
            return;
        }
        Err(err) => panic!("首次渲染失败: {err}"),
    };

    let second = block_on(pdf::render_pdf_page_with_cache_root_for_test(
        path,
        0,
        832,
        Some(cache_root.clone()),
    ));

    match second {
        Ok(RenderPageResult::File {
            resource_url, width, ..
        }) => {
            assert_eq!(width, 832);
            assert_eq!(resource_url, first_url);
        }
        Ok(other) => panic!("预期 file 结果，实际为 {other:?}"),
        Err(err) if is_pdfium_missing_error(&err) => {
            eprintln!("SKIP: Pdfium 不可用: {err}");
            let _ = std::fs::remove_dir_all(&cache_root);
            return;
        }
        Err(err) => panic!("二次渲染失败: {err}"),
    }

    assert_eq!(pdf::pdf_cache_debug_render_count(), 1, "命中磁盘缓存后不应再次渲染");
    assert_eq!(pdf::pdf_debug_open_count(), 1, "同路径应复用文档缓存");

    let _ = std::fs::remove_dir_all(&cache_root);
}

#[test]
fn render_page_out_of_range_returns_err() {
    let _guard = TEST_LOCK.lock().expect("锁获取失败");

    let fixture = match find_fixture_pdf() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: tests/fixtures 下没有 PDF");
            return;
        }
    };

    let path = fixture.to_string_lossy().into_owned();
    let result = block_on(pdf::render_pdf_page_with_cache_root_for_test(
        path,
        u32::MAX,
        300,
        Some(unique_cache_root()),
    ));

    match result {
        Ok(_) => panic!("预期应失败，但返回了 Ok"),
        Err(err) if is_pdfium_missing_error(&err) => {
            eprintln!("SKIP: Pdfium 不可用: {err}");
        }
        Err(_) => {}
    }
}

#[test]
fn render_page_width_zero_returns_err() {
    let err = block_on(pdf::render_pdf_page_with_cache_root_for_test(
        "does-not-matter.pdf".to_string(),
        0,
        0,
        Some(unique_cache_root()),
    ))
    .expect_err("预期 width=0 应返回 Err");

    assert!(err.contains("width 必须大于 0"));
}

#[test]
fn render_page_width_too_large_returns_err() {
    let err = block_on(pdf::render_pdf_page_with_cache_root_for_test(
        "does-not-matter.pdf".to_string(),
        0,
        2001,
        Some(unique_cache_root()),
    ))
    .expect_err("预期 width 过大应返回 Err");

    assert!(err.contains("width 过大"));
}
