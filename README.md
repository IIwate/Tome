# Tome

## PDF 支持（Windows）

本项目的 PDF 渲染由 Rust 端通过 `pdfium-render` 调用 PDFium 动态库完成，运行时需要 `pdfium.dll`。

### 放置位置

请将 `pdfium.dll` 放到以下任一位置（优先级从高到低）：
1. 应用可执行文件同目录
2. 应用可执行文件同目录下的 `resources/` 子目录（推荐：`Tome/src-tauri/resources/pdfium.dll`，打包时会随 `bundle.resources` 一起进入安装包）

### 获取方式

可从 `https://github.com/bblanchon/pdfium-binaries/releases` 下载 `pdfium-win-x64`，解压后将 `bin/pdfium.dll` 复制到上面的目录。

### 许可提示（非法律意见）

仓库根目录的 `LICENSE`（如有）通常用于声明**本项目**的许可；而 `pdfium.dll` 属于第三方组件，随应用分发时一般需要一并提供其对应的许可文本/声明（具体以该组件发布包内的 LICENSE 与 licenses/ 目录为准）。

