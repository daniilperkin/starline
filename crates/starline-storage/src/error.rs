/// Crate-wide result/error types. The CLI turns errors into protocol messages and the Tauri
/// layer will do the same, so string-y boxed errors are deliberate at this boundary.
pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;
