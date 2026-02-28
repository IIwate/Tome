# PDFium 动态库放置说明

本目录用于放置 PDFium 动态库（Windows x64：`pdfium.dll`）。

下载方式（示例）：
- 从 `https://github.com/bblanchon/pdfium-binaries/releases` 下载 `pdfium-win-x64` 对应产物
- 解压后将 `pdfium.dll` 放到本目录：`Tome/src-tauri/resources/pdfium.dll`

注意：
- 本项目的 PDF 渲染命令会优先尝试从“可执行文件同目录”及其 `resources/` 子目录加载该 DLL；如加载失败会回退到系统库搜索。
- `tauri.conf.json` 已配置 `bundle.resources` 包含本目录，走打包流程时会将该目录内文件一并打入安装包。

