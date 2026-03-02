use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use tome_lib::commands::pdf;

static TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// 纯缓存逻辑（可注入 loader），用于在无 fixtures / 无 Pdfium 时也能覆盖核心缓存行为。
struct SingleEntryCache<K, V> {
    inner: Mutex<Option<(K, Arc<V>)>>,
    insert_count: AtomicUsize,
}

impl<K, V> SingleEntryCache<K, V> {
    fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            insert_count: AtomicUsize::new(0),
        }
    }

    fn insert_count(&self) -> usize {
        self.insert_count.load(Ordering::Relaxed)
    }

    fn clear(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = None;
        }
    }
}

impl<K: PartialEq, V> SingleEntryCache<K, V> {
    fn get_or_try_insert_with<E>(
        &self,
        key: K,
        load: impl FnOnce() -> Result<V, E>,
    ) -> Result<Arc<V>, E> {
        let guard = self.inner.lock().expect("锁获取失败");
        if let Some((cached_key, value)) = guard.as_ref() {
            if cached_key == &key {
                return Ok(value.clone());
            }
        }
        drop(guard);

        let loaded = Arc::new(load()?);

        let mut guard = self.inner.lock().expect("锁获取失败");
        if let Some((cached_key, value)) = guard.as_ref() {
            if cached_key == &key {
                return Ok(value.clone());
            }
        }

        self.insert_count.fetch_add(1, Ordering::Relaxed);
        *guard = Some((key, loaded.clone()));
        Ok(loaded)
    }
}

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

#[test]
fn cache_core_hit_does_not_reload() {
    let cache = SingleEntryCache::<PathBuf, usize>::new();
    let load_calls = AtomicUsize::new(0);

    let first = cache
        .get_or_try_insert_with(PathBuf::from("a.pdf"), || {
            load_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, &'static str>(1)
        })
        .expect("首次加载失败");

    let second = cache
        .get_or_try_insert_with(PathBuf::from("a.pdf"), || {
            load_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, &'static str>(2)
        })
        .expect("缓存命中失败");

    assert_eq!(cache.insert_count(), 1, "同 key 应只插入一次");
    assert_eq!(load_calls.load(Ordering::Relaxed), 1, "缓存命中不应再次触发 loader");
    assert!(Arc::ptr_eq(&first, &second), "缓存命中应复用同一对象");
    assert_eq!(*second, 1);
}

#[test]
fn cache_core_replace_on_key_change() {
    let cache = SingleEntryCache::<PathBuf, usize>::new();
    let load_calls = AtomicUsize::new(0);

    let a = cache
        .get_or_try_insert_with(PathBuf::from("a.pdf"), || {
            load_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, &'static str>(1)
        })
        .expect("首次加载失败");

    let b = cache
        .get_or_try_insert_with(PathBuf::from("b.pdf"), || {
            load_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, &'static str>(2)
        })
        .expect("替换加载失败");

    assert_eq!(cache.insert_count(), 2, "key 变化应触发替换插入");
    assert_eq!(load_calls.load(Ordering::Relaxed), 2);
    assert!(!Arc::ptr_eq(&a, &b));
    assert_eq!(*a, 1);
    assert_eq!(*b, 2);

    let a2 = cache
        .get_or_try_insert_with(PathBuf::from("a.pdf"), || {
            load_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, &'static str>(3)
        })
        .expect("二次替换加载失败");

    assert_eq!(cache.insert_count(), 3);
    assert_eq!(load_calls.load(Ordering::Relaxed), 3);
    assert_eq!(*a2, 3);
}

#[test]
fn cache_core_error_does_not_cache() {
    let cache = SingleEntryCache::<PathBuf, usize>::new();
    let load_calls = AtomicUsize::new(0);

    let err = cache
        .get_or_try_insert_with(PathBuf::from("a.pdf"), || {
            load_calls.fetch_add(1, Ordering::Relaxed);
            Err::<usize, &'static str>("boom")
        })
        .expect_err("预期 loader 失败应返回 Err");

    assert_eq!(err, "boom");
    assert_eq!(cache.insert_count(), 0, "loader 失败不应写入缓存");

    let ok = cache
        .get_or_try_insert_with(PathBuf::from("a.pdf"), || {
            load_calls.fetch_add(1, Ordering::Relaxed);
            Ok::<_, &'static str>(42)
        })
        .expect("loader 成功但返回 Err");

    assert_eq!(cache.insert_count(), 1);
    assert_eq!(load_calls.load(Ordering::Relaxed), 2);
    assert_eq!(*ok, 42);

    cache.clear();
    assert_eq!(cache.insert_count(), 1, "clear 不应影响计数语义");
}

#[test]
fn render_page_returns_jpeg_data_url() {
    let _guard = TEST_LOCK.lock().expect("锁获取失败");

    let fixture = match find_fixture_pdf() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: tests/fixtures 下没有 PDF");
            return;
        }
    };

    let path = fixture.to_string_lossy().into_owned();
    let result = block_on(pdf::render_pdf_page(path, 0, 300));

    match result {
        Ok(data_url) => assert!(data_url.starts_with("data:image/jpeg;base64,")),
        Err(err) if is_pdfium_missing_error(&err) => {
            eprintln!("SKIP: Pdfium 不可用: {err}");
        }
        Err(err) => panic!("渲染失败: {err}"),
    }
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
    let result = block_on(pdf::render_pdf_page(path, u32::MAX, 300));

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
    let err = block_on(pdf::render_pdf_page(
        "does-not-matter.pdf".to_string(),
        0,
        0,
    ))
    .expect_err("预期 width=0 应返回 Err");

    assert!(err.contains("width 必须大于 0"));
}

#[test]
fn render_page_width_too_large_returns_err() {
    let err = block_on(pdf::render_pdf_page(
        "does-not-matter.pdf".to_string(),
        0,
        2001,
    ))
    .expect_err("预期 width 过大应返回 Err");

    assert!(err.contains("width 过大"));
}

#[test]
fn cache_same_path_does_not_reopen_document() {
    let _guard = TEST_LOCK.lock().expect("锁获取失败");

    let fixture = match find_fixture_pdf() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: tests/fixtures 下没有 PDF");
            return;
        }
    };

    pdf::pdf_debug_clear_doc_cache();
    pdf::pdf_debug_reset_open_count();

    let path = fixture.to_string_lossy().into_owned();
    let first = block_on(pdf::render_pdf_page(path.clone(), 0, 300));
    match first {
        Ok(_) => {}
        Err(err) if is_pdfium_missing_error(&err) => {
            eprintln!("SKIP: Pdfium 不可用: {err}");
            return;
        }
        Err(err) => panic!("首次渲染失败: {err}"),
    }

    let opened_after_first = pdf::pdf_debug_open_count();

    let second = block_on(pdf::render_pdf_page(path, 0, 300));
    match second {
        Ok(_) => {}
        Err(err) if is_pdfium_missing_error(&err) => {
            eprintln!("SKIP: Pdfium 不可用: {err}");
            return;
        }
        Err(err) => panic!("二次渲染失败: {err}"),
    }

    let opened_after_second = pdf::pdf_debug_open_count();
    assert_eq!(
        opened_after_second, opened_after_first,
        "同路径连续渲染应复用文档缓存"
    );
}

#[test]
#[ignore]
fn render_performance_baseline() {
    let _guard = TEST_LOCK.lock().expect("锁获取失败");

    let fixture = match find_fixture_pdf() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: tests/fixtures 下没有 PDF");
            return;
        }
    };

    let path = fixture.to_string_lossy().into_owned();

    pdf::pdf_debug_clear_doc_cache();
    pdf::pdf_debug_reset_open_count();

    let start = Instant::now();
    let first = block_on(pdf::render_pdf_page(path.clone(), 0, 300));
    let first_cost = start.elapsed();

    match first {
        Ok(_) => {}
        Err(err) if is_pdfium_missing_error(&err) => {
            eprintln!("SKIP: Pdfium 不可用: {err}");
            return;
        }
        Err(err) => panic!("首次渲染失败: {err}"),
    }

    let start = Instant::now();
    let second = block_on(pdf::render_pdf_page(path, 0, 300));
    let second_cost = start.elapsed();

    match second {
        Ok(_) => {}
        Err(err) => panic!("二次渲染失败: {err}"),
    }

    eprintln!(
        "render performance: first={:?}, second={:?}, opened={}",
        first_cost,
        second_cost,
        pdf::pdf_debug_open_count()
    );
}
