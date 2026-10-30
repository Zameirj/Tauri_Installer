//! Plain-text activity log, one file per day:
//!   C:\temp\CasewareInstaller_<yyyy-mm-dd>.log
//! Each line is a short, readable step. Never write download codes, passwords, emails or
//! signed links here.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

const LOG_DIR: &str = r"C:\temp";

pub fn path() -> PathBuf {
    let day = chrono::Local::now().format("%Y-%m-%d");
    PathBuf::from(LOG_DIR).join(format!("CasewareInstaller_{day}.log"))
}

/// Append one line. Logging must never break the installer, so failures are only reported to stderr.
pub fn write(message: &str) {
    let result = (|| -> std::io::Result<()> {
        fs::create_dir_all(LOG_DIR)?;
        let mut f = OpenOptions::new().create(true).append(true).open(path())?;
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        writeln!(f, "{now}  {message}")
    })();
    if let Err(e) = result {
        eprintln!("could not write log: {e}");
    }
}
