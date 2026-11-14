use http_proto::HttpResponse;
use hyper::StatusCode;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub struct PortalFile {
    pub path: PathBuf,
    pub content_type: &'static str,
    pub cache: bool,
}

const RESERVED: &[&str] = &[
    "api",
    "jmap",
    "dav",
    "scim",
    "auth",
    "healthz",
    "metrics",
    "robots.txt",
    ".well-known",
    "autodiscover",
    "Autodiscover",
    "AutoDiscover",
    "form",
];

pub fn portal_may_serve(url_path: &str) -> bool {
    let first = url_path.trim_start_matches('/').split('/').next().unwrap_or("");
    !RESERVED.contains(&first)
}

pub const PORTAL_INSTALL: &str = "/usr/share/shippin.tech/portal";

pub fn first_portal_dir(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|path| path.join("200.html").is_file())
}

pub fn portal_dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let mut candidates = Vec::new();
        if let Some(dir) = std::env::var_os("shippin.tech_PORTAL_DIR") {
            candidates.push(PathBuf::from(dir));
        }
        candidates.push(PathBuf::from(PORTAL_INSTALL));
        candidates.push(PathBuf::from("ui/build"));
        first_portal_dir(candidates)
    })
    .as_deref()
}

pub fn resolve_portal(root: &Path, url_path: &str) -> Option<PortalFile> {
    if !portal_may_serve(url_path) {
        return None;
    }
    let relative = safe_relative(url_path)?;
    if url_path.trim_start_matches('/').is_empty() {
        return html_page(root, &root.join("index.html"));
    }
    let direct = root.join(&relative);
    if direct.is_file() {
        let html = is_html(&direct);
        return Some(PortalFile {
            content_type: content_type(&direct),
            cache: !html,
            path: direct,
        });
    }
    let name = relative.file_name().and_then(|name| name.to_str()).unwrap_or("");
    if name.contains('.') {
        return None;
    }
    html_page(root, &root.join("200.html"))
}

fn html_page(root: &Path, preferred: &Path) -> Option<PortalFile> {
    let path = if preferred.is_file() {
        preferred.to_path_buf()
    } else {
        let fallback = root.join("200.html");
        if fallback.is_file() {
            fallback
        } else {
            return None;
        }
    };
    Some(PortalFile {
        content_type: "text/html; charset=utf-8",
        cache: false,
        path,
    })
}

fn safe_relative(url_path: &str) -> Option<PathBuf> {
    let trimmed = url_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return Some(PathBuf::from("index.html"));
    }
    let mut out = PathBuf::new();
    for part in trimmed.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return None;
        }
        out.push(part);
    }
    if out.as_os_str().is_empty() {
        out.push("index.html");
    }
    Some(out)
}

fn is_html(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()) == Some("html")
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        Some("map") => "application/json",
        _ => "application/octet-stream",
    }
}

pub async fn portal_response(url_path: &str) -> Option<HttpResponse> {
    let root = portal_dir()?;
    let file = resolve_portal(root, url_path)?;
    let bytes = tokio::fs::read(&file.path).await.ok()?;
    let response = HttpResponse::new(StatusCode::OK)
        .with_content_type(file.content_type)
        .with_binary_body(bytes);
    Some(if file.cache {
        response.with_immutable_cache()
    } else {
        response.with_no_cache()
    })
}

#[cfg(test)]
mod portal_file {
    use super::{first_portal_dir, portal_may_serve, resolve_portal, PORTAL_INSTALL};
    use std::fs;

    #[test]
    fn portal_file_serves_pages_and_assets() {
        let root = std::env::temp_dir().join(format!("shippin-portal-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("_app")).unwrap();
        fs::write(root.join("200.html"), b"portal").unwrap();
        fs::write(root.join("_app/app.js"), b"script").unwrap();

        let page = resolve_portal(&root, "/portal/x:Domain").unwrap();
        assert_eq!(page.path, root.join("200.html"));
        assert!(!page.cache);

        let asset = resolve_portal(&root, "/_app/app.js").unwrap();
        assert_eq!(asset.path, root.join("_app/app.js"));
        assert!(asset.cache);
        assert_eq!(asset.content_type, "text/javascript; charset=utf-8");

        assert!(resolve_portal(&root, "/_app/missing.js").is_none());
        assert!(resolve_portal(&root, "/portal/../Cargo.toml").is_none());
        assert!(resolve_portal(&root, "/api/discover/a").is_none());
        assert!(resolve_portal(&root, "/jmap").is_none());
        // The built-in web app now owns /admin and /account.
        assert!(resolve_portal(&root, "/admin").is_some());
        assert!(resolve_portal(&root, "/account/security").is_some());
        assert!(portal_may_serve("/login"));
        assert!(!portal_may_serve("/jmap"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn portal_file_prefers_the_image_install() {
        let base = std::env::temp_dir().join(format!("shippin-portal-candidates-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let chosen = base.join("chosen");
        let install = base.join("install");
        let local = base.join("local");
        for dir in [&chosen, &install, &local] {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("200.html"), b"portal").unwrap();
        }

        let picked = first_portal_dir([chosen.clone(), install.clone(), local.clone()]).unwrap();
        assert_eq!(picked, chosen);
        let image = first_portal_dir([base.join("missing"), install.clone(), local.clone()]).unwrap();
        assert_eq!(image, install);
        let dev = first_portal_dir([base.join("missing"), base.join("also-missing"), local.clone()]).unwrap();
        assert_eq!(dev, local);
        assert!(first_portal_dir([base.join("missing")]).is_none());
        assert_eq!(PORTAL_INSTALL, "/usr/share/shippin.tech/portal");

        let _ = fs::remove_dir_all(&base);
    }
}
