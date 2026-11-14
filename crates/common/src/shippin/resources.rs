//! How full things are: the disk under the server, and how close an organisation is to
//! its limits. Our own open code.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Disk {
    pub total: u64,
    pub free: u64,
}

/// Where the server keeps its own data inside the container.
pub const DATA_PATH: &str = "/var/lib/shippin.tech";

#[cfg(unix)]
pub fn disk(path: &str) -> Option<Disk> {
    let path = std::ffi::CString::new(path).ok()?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is a valid C string and `stats` has room for the structure the
    // call fills in. It is only read after the call reports success.
    let stats = unsafe {
        if libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) != 0 {
            return None;
        }
        stats.assume_init()
    };
    let unit = (stats.f_frsize as u64).max(1);
    Some(Disk {
        total: (stats.f_blocks as u64).saturating_mul(unit),
        free: (stats.f_bavail as u64).saturating_mul(unit),
    })
}

#[cfg(not(unix))]
pub fn disk(_path: &str) -> Option<Disk> {
    None
}

/// `none` when there is no limit, `fine`, `near` from 80 percent, `over` at the limit.
pub fn level(used: u64, limit: u64) -> &'static str {
    if limit == 0 {
        "none"
    } else if used >= limit {
        "over"
    } else if u128::from(used) * 10 >= u128::from(limit) * 8 {
        "near"
    } else {
        "fine"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_follow_the_limit() {
        assert_eq!(level(5, 0), "none");
        assert_eq!(level(79, 100), "fine");
        assert_eq!(level(80, 100), "near");
        assert_eq!(level(99, 100), "near");
        assert_eq!(level(100, 100), "over");
        assert_eq!(level(150, 100), "over");
        assert_eq!(level(u64::MAX, u64::MAX - 1), "over");
    }
}
