//! `/api/google/*`: the person's link to Google Drive.
//!
//! - `GET /api/google` says whether the link is available and connected.
//! - `POST /api/google/connect` returns the Google sign-in address.
//! - `GET /api/google/callback` is where Google sends the browser back.
//! - `POST /api/google/disconnect` forgets the link and revokes it at Google.
//! - `GET /api/google/files?folder=&search=&shared=&pageToken=` lists files.
//! - `GET /api/google/content/<id>?export=` returns a file's bytes.
//! - `POST /api/google/copy` puts a copy of one of the person's Drive files in Google.
//!
//! The work is in `common::google`. Tokens and the client secret never leave the server.

use crate::auth::authenticate::Authenticator;
use common::{
    Server,
    google::{self, GOOGLE, GoogleError},
};
use http_proto::{HttpRequest, HttpResponse, HttpSessionData, JsonResponse, ToHttpResponse};
use hyper::{Method, StatusCode, header::CONTENT_TYPE};
use jmap::blob::download::BlobDownload;
use serde_json::{Value, json};
use types::blob::BlobId;
use utils::url_params::UrlParams;

fn reply(status: StatusCode, value: Value) -> trc::Result<HttpResponse> {
    Ok(JsonResponse::with_status(status, value)
        .no_cache()
        .into_http_response())
}

fn refusal(err: GoogleError) -> trc::Result<HttpResponse> {
    match err {
        GoogleError::NotConfigured => reply(
            StatusCode::NOT_FOUND,
            json!({ "error": "notConfigured", "message": "The Google link is not set up on this server." }),
        ),
        GoogleError::NotConnected => reply(
            StatusCode::CONFLICT,
            json!({ "error": "notConnected", "message": "Connect your Google account first." }),
        ),
        GoogleError::Google(status, message) => reply(
            StatusCode::from_u16(status)
                .ok()
                .filter(|code| code.is_client_error() || code.is_server_error())
                .unwrap_or(StatusCode::BAD_GATEWAY),
            json!({ "error": "google", "message": message }),
        ),
        GoogleError::Internal(err) => Err(err),
    }
}

/// What the browser receives: only what the screen shows, never Google's own payload.
fn public_file(file: &Value) -> Value {
    json!({
        "id": file["id"],
        "name": file["name"],
        "type": file["mimeType"],
        "size": file["size"].as_str().and_then(|size| size.parse::<u64>().ok()),
        "modified": file["modifiedTime"],
        "webLink": file["webViewLink"],
        "exports": file["mimeType"].as_str().map(|mime| {
            google::export_formats(mime).iter().map(|format| format.0).collect::<Vec<_>>()
        }),
    })
}

pub trait GoogleApi: Sync + Send {
    fn handle_google_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> impl Future<Output = trc::Result<HttpResponse>> + Send;
}

impl GoogleApi for Server {
    async fn handle_google_request(
        &self,
        req: &HttpRequest,
        session: &HttpSessionData,
        path: &[&str],
        body: Option<Vec<u8>>,
    ) -> trc::Result<HttpResponse> {
        let params = UrlParams::new(req.uri().query());

        // Google's redirect carries no credentials; the state says who it is for.
        if matches!(path, ["callback"]) && req.method() == Method::GET {
            let target = match (params.get("state"), params.get("code"), params.get("error")) {
                (Some(state), Some(code), None) => {
                    match google::finish_connect(self, state, code).await {
                        Ok(_) => "/files?view=google&connected=1".to_string(),
                        Err(GoogleError::Internal(err)) => return Err(err),
                        Err(_) => "/files?view=google&failed=1".to_string(),
                    }
                }
                _ => "/files?view=google&failed=1".to_string(),
            };
            return Ok(HttpResponse::redirect(target));
        }

        let (_in_flight, access_token) = self.authenticate_headers(req, session).await?;
        let account_id = access_token.account_id();

        match (path, req.method()) {
            ([] | [""], &Method::GET) => {
                let available = GOOGLE.is_some();
                let account = if available {
                    google::load_account(self, account_id).await?
                } else {
                    None
                };
                reply(
                    StatusCode::OK,
                    json!({
                        "available": available,
                        "connected": account.is_some(),
                        "email": account.map(|account| account.email),
                    }),
                )
            }
            (["connect"], &Method::POST) => match google::begin_connect(self, account_id).await {
                Ok(url) => reply(StatusCode::OK, json!({ "url": url })),
                Err(err) => refusal(err),
            },
            (["disconnect"], &Method::POST) => match google::disconnect(self, account_id).await {
                Ok(()) => reply(StatusCode::OK, json!({ "connected": false })),
                Err(err) => refusal(err),
            },
            (["files"], &Method::GET) => {
                match google::list_files(
                    self,
                    account_id,
                    params.get("folder"),
                    params.get("search"),
                    params.get("shared").is_some_and(|value| value == "1"),
                    params.get("pageToken"),
                )
                .await
                {
                    Ok(listing) => reply(
                        StatusCode::OK,
                        json!({
                            "files": listing["files"].as_array().map(|files| files.iter().map(public_file).collect::<Vec<_>>()).unwrap_or_default(),
                            "nextPage": listing["nextPageToken"],
                        }),
                    ),
                    Err(err) => refusal(err),
                }
            }
            (["info", id], &Method::GET) => match google::file_info(self, account_id, id).await {
                Ok(file) => reply(StatusCode::OK, public_file(&file)),
                Err(err) => refusal(err),
            },
            (["content", id], &Method::GET) => {
                let info = match google::file_info(self, account_id, id).await {
                    Ok(info) => info,
                    Err(err) => return refusal(err),
                };
                let mime = info["mimeType"]
                    .as_str()
                    .unwrap_or("application/octet-stream");
                if mime == google::FOLDER_TYPE {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "folder", "message": "A folder has no content to fetch." }),
                    );
                }
                match google::file_content(self, account_id, id, mime, params.get("export")).await {
                    Ok((bytes, content_type, extension)) => Ok(HttpResponse::new(StatusCode::OK)
                        .with_no_cache()
                        .with_header(CONTENT_TYPE, content_type)
                        .with_header("X-File-Extension", extension.to_string())
                        .with_binary_body(bytes)),
                    Err(err) => refusal(err),
                }
            }
            (["copy"], &Method::POST) => {
                let body = body
                    .as_deref()
                    .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
                    .unwrap_or(Value::Null);
                let (Some(blob), Some(name)) = (body["blobId"].as_str(), body["name"].as_str())
                else {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalid", "message": "Send blobId and name." }),
                    );
                };
                let Some(blob_id) = BlobId::from_base32(blob) else {
                    return reply(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "invalid", "message": "That is not a file of yours." }),
                    );
                };
                let Some(bytes) = self.blob_download(&blob_id, &access_token).await? else {
                    return reply(
                        StatusCode::FORBIDDEN,
                        json!({ "error": "forbidden", "message": "You do not have access to that file." }),
                    );
                };
                match google::upload_file(
                    self,
                    account_id,
                    name,
                    body["type"]
                        .as_str()
                        .filter(|value| !value.is_empty())
                        .unwrap_or("application/octet-stream"),
                    body["parent"].as_str(),
                    &bytes,
                )
                .await
                {
                    Ok(file) => reply(StatusCode::OK, public_file(&file)),
                    Err(err) => refusal(err),
                }
            }
            _ => Err(trc::ResourceEvent::NotFound.into_err()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_browser_only_gets_what_the_screen_shows() {
        let shown = public_file(&json!({
            "id": "1",
            "name": "Budget",
            "mimeType": "application/vnd.google-apps.spreadsheet",
            "modifiedTime": "2026-11-10T00:00:00Z",
            "webViewLink": "https://docs.google.com/x",
            "owners": [{ "emailAddress": "someone@example.org" }],
            "size": "12"
        }));
        assert_eq!(shown["size"], 12);
        assert_eq!(shown["exports"], json!(["xlsx", "pdf"]));
        assert!(shown.get("owners").is_none());
    }
}
