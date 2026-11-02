use crate::{
    imap::append::assert_append_message,
    utils::{
        account::Account,
        imap::{AssertResult, ImapConnection, Type},
        server::TestServerBuilder,
    },
};
use imap_proto::ResponseType;
use registry::{
    schema::{
        enums::{NetworkListenerProtocol, TenantStorageQuota},
        prelude::{ObjectType, SocketAddr},
        structs::{
            Account as AccountObject, BlobStore, CertificateManagement, ClusterListenerGroup,
            ClusterListenerGroupProperties, ClusterRole, ClusterTaskGroup, Coordinator,
            Credential, DkimManagement, DnsManagement, Domain, Imap, NatsCoordinator,
            NetworkListener, PasswordCredential, PublicStringOptional, PublicStringValue, S3Store,
            S3StoreCustomRegion, S3StoreRegion, SecretKeyOptional, SecretKeyValue, Tenant,
            UserAccount, UserRoles,
        },
    },
    types::{list::List, map::Map},
};
use serde_json::json;
use std::str::FromStr;
use store::registry::RegistryQuery;
use types::id::Id;
use utils::map::vec_map::VecMap;

const BODY: &str = "scale-body-from-node-a";
const TENANT_A_BODY: &str = "scale-body-tenant-a";

#[tokio::test(flavor = "multi_thread")]
#[ignore = "RUST_MIN_STACK=33554432 STORE=FoundationDb cargo test -p tests --features scale -- --ignored scale_two_nodes"]
pub async fn scale_two_nodes() {
    if std::env::var("STORE").ok().as_deref() != Some("FoundationDb") {
        panic!(
            "Set STORE=FoundationDb so both nodes share one cluster file. \
             Example: RUST_MIN_STACK=33554432 STORE=FoundationDb cargo test -p tests --features scale -- --ignored scale_two_nodes"
        );
    }

    crate::utils::containers::ensure_minio().await;
    crate::utils::containers::ensure_nats().await;

    let mut servers = Vec::with_capacity(2);
    let test = TestServerBuilder::new("scale_node_a")
        .await
        .with_object(Coordinator::Nats(NatsCoordinator {
            addresses: Map::new(vec!["127.0.0.1:4222".to_string()]),
            use_tls: false,
            ..Default::default()
        }))
        .await
        .with_object(BlobStore::S3(S3Store {
            access_key: PublicStringOptional::Value(PublicStringValue {
                value: "minioadmin".into(),
            }),
            bucket: "shippin.tech".into(),
            region: S3StoreRegion::Custom(S3StoreCustomRegion {
                custom_endpoint: "http://localhost:9000".into(),
                custom_region: "eu-central-1".into(),
            }),
            secret_key: SecretKeyOptional::Value(SecretKeyValue {
                secret: "minioadmin".into(),
            }),
            allow_invalid_certs: true,
            ..Default::default()
        }))
        .await
        .with_object(Imap {
            allow_plain_text_auth: true,
            ..Default::default()
        })
        .await
        .with_listener(NetworkListenerProtocol::Http, "http_0", 11000, true)
        .await
        .with_listener(NetworkListenerProtocol::Imap, "imap_0", 12000, false)
        .await
        .build()
        .await;

    let admin = test.account("admin");
    admin
        .create_user_account(
            "jdoe@example.com",
            "this is john's secret",
            "John's account",
            &[],
            vec![],
        )
        .await;
    let mut alice = create_tenant_user(
        &admin,
        "Tenant A",
        "tenant-a.test",
        "alice@tenant-a.test",
        "alice scale mailbox phrase",
    )
    .await;
    let mut bob = create_tenant_user(
        &admin,
        "Tenant B",
        "tenant-b.test",
        "bob@tenant-b.test",
        "bob scale mailbox phrase",
    )
    .await;
    admin.reload_settings().await;

    let mut listeners = vec![
        test.server
            .registry()
            .query::<Vec<Id>>(RegistryQuery::new(ObjectType::NetworkListener))
            .await
            .unwrap(),
    ];
    let http_listener_id = admin
        .registry_create_object(NetworkListener {
            name: "http_1".to_string(),
            bind: Map::new(vec![SocketAddr::from_str("127.0.0.1:11001").unwrap()]),
            protocol: NetworkListenerProtocol::Http,
            tls_implicit: true,
            use_tls: true,
            ..Default::default()
        })
        .await;
    let imap_listener_id = admin
        .registry_create_object(NetworkListener {
            name: "imap_1".to_string(),
            bind: Map::new(vec![SocketAddr::from_str("127.0.0.1:12001").unwrap()]),
            protocol: NetworkListenerProtocol::Imap,
            tls_implicit: false,
            use_tls: true,
            ..Default::default()
        })
        .await;
    listeners.push(vec![http_listener_id, imap_listener_id]);

    for (role_id, listener_ids) in listeners.into_iter().enumerate() {
        admin
            .registry_create_object(ClusterRole {
                name: format!("role_{role_id}"),
                listeners: ClusterListenerGroup::EnableSome(ClusterListenerGroupProperties {
                    listener_ids: Map::new(listener_ids),
                }),
                tasks: ClusterTaskGroup::EnableAll,
                description: None,
            })
            .await;
    }
    let node_a = test.server.registry().node_id();
    servers.push(test);

    let node_b = TestServerBuilder::new_with_role(
        "scale_node_b",
        "mail-b.example.com".to_string(),
        Some("role_1".to_string()),
        false,
    )
    .await
    .build_with_opts(false)
    .await;
    let node_b_id = node_b.server.registry().node_id();
    assert_ne!(
        node_a, node_b_id,
        "nodes that share FoundationDB must lease different ids"
    );
    servers.push(node_b);

    let message = format!("Subject: scale-node-a\r\n\r\n{BODY}\r\n");
    let mut writer = imap_client(0, "jdoe@example.com", "this is john's secret").await;
    let uid = assert_append_message(&mut writer, "INBOX", &message, ResponseType::Ok)
        .await
        .into_append_uid();
    servers[0].wait_for_tasks().await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let mut reader = imap_client(1, "jdoe@example.com", "this is john's secret").await;
    reader.send("SELECT INBOX").await;
    reader.assert_read(Type::Tagged, ResponseType::Ok).await;
    reader
        .send(&format!("UID FETCH {uid} (BODY.PEEK[TEXT])"))
        .await;
    reader
        .assert_read(Type::Tagged, ResponseType::Ok)
        .await
        .assert_contains(BODY);

    let tenant_message = format!("Subject: scale-tenant-a\r\n\r\n{TENANT_A_BODY}\r\n");
    let mut alice_writer = imap_client(0, "alice@tenant-a.test", "alice scale mailbox phrase").await;
    let tenant_uid =
        assert_append_message(&mut alice_writer, "INBOX", &tenant_message, ResponseType::Ok)
            .await
            .into_append_uid();
    servers[0].wait_for_tasks().await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let mut alice_reader = imap_client(1, "alice@tenant-a.test", "alice scale mailbox phrase").await;
    alice_reader.send("SELECT INBOX").await;
    alice_reader.assert_read(Type::Tagged, ResponseType::Ok).await;
    alice_reader
        .send(&format!("UID FETCH {tenant_uid} (BODY.PEEK[TEXT])"))
        .await;
    alice_reader
        .assert_read(Type::Tagged, ResponseType::Ok)
        .await
        .assert_contains(TENANT_A_BODY);

    let mut bob_reader = imap_client(1, "bob@tenant-b.test", "bob scale mailbox phrase").await;
    bob_reader.send("SELECT INBOX").await;
    bob_reader.assert_read(Type::Tagged, ResponseType::Ok).await;
    bob_reader
        .send(&format!("UID FETCH {tenant_uid} (BODY.PEEK[TEXT])"))
        .await;
    bob_reader
        .assert_read(Type::Tagged, ResponseType::Ok)
        .await
        .assert_not_contains(TENANT_A_BODY);

    for port in [11000, 11001] {
        assert_redirect(port, "/.well-known/jmap", "/jmap/session").await;
        assert_redirect(port, "/.well-known/caldav", "/dav/cal").await;
        assert_redirect(port, "/.well-known/carddav", "/dav/card").await;
    }

    alice.http_listener_port = 11001;
    let session = alice.jmap_session_object().await;
    for capability in [
        "urn:ietf:params:jmap:mail",
        "urn:ietf:params:jmap:calendars",
        "urn:ietf:params:jmap:contacts",
    ] {
        assert!(
            session
                .0
                .pointer(&format!("/capabilities/{capability}"))
                .is_some(),
            "node B session is missing {capability}: {}",
            session.0
        );
    }

    bob.http_listener_port = 11001;
    let denied = bob
        .jmap_method_calls(json!([
            [
                "Mailbox/get",
                { "accountId": alice.id_string() },
                "c0"
            ]
        ]))
        .await;
    assert_eq!(
        denied.error_type_at(0),
        Some("forbidden"),
        "tenant B read tenant A's mailbox: {}",
        denied.0
    );
}

async fn create_tenant_user(
    admin: &Account,
    tenant_name: &'static str,
    domain_name: &str,
    email: &'static str,
    secret: &'static str,
) -> Account {
    let tenant_id = admin
        .registry_create_object(Tenant {
            name: tenant_name.to_string(),
            quotas: VecMap::from_iter([
                (TenantStorageQuota::MaxAccounts, 4),
                (TenantStorageQuota::MaxDomains, 2),
            ]),
            ..Default::default()
        })
        .await;
    let domain_id = admin
        .registry_create_object(Domain {
            name: domain_name.to_string(),
            member_tenant_id: Some(tenant_id),
            certificate_management: CertificateManagement::Manual,
            dns_management: DnsManagement::Manual,
            dkim_management: DkimManagement::Manual,
            ..Default::default()
        })
        .await;
    let (local_part, _) = email.split_once('@').unwrap();
    let account_id = admin
        .registry_create_object(AccountObject::User(UserAccount {
            name: local_part.to_string(),
            domain_id,
            member_tenant_id: Some(tenant_id),
            roles: UserRoles::User,
            description: Some(tenant_name.to_string()),
            credentials: List::from_iter([Credential::Password(PasswordCredential {
                secret: secret.to_string(),
                ..Default::default()
            })]),
            ..Default::default()
        }))
        .await;
    let mut account = Account::new(email, secret, &[], tenant_name, account_id);
    account.http_listener_port = 11000;
    account
}

async fn assert_redirect(port: u16, path: &str, location: &str) {
    let response = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap()
        .get(format!("https://127.0.0.1:{port}{path}"))
        .send()
        .await
        .unwrap_or_else(|err| panic!("GET {path} on {port} failed: {err}"));
    assert_eq!(
        response.status(),
        reqwest::StatusCode::TEMPORARY_REDIRECT,
        "{path} on {port}"
    );
    let header = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    assert!(
        header.contains(location),
        "{path} on {port} redirected to {header}"
    );
}

async fn imap_client(node_id: u32, user: &str, secret: &str) -> ImapConnection {
    let mut conn = ImapConnection::connect_to(b"A1 ", format!("127.0.0.1:1200{node_id}")).await;
    conn.assert_read(Type::Untagged, ResponseType::Ok).await;
    conn.authenticate(user, secret).await;
    conn
}
