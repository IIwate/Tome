pub mod scan;
pub mod reader;

pub use scan::scan_books;
pub use reader::{read_file_bytes, read_txt_file, stat_file};
