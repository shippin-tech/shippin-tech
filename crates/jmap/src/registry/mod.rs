

use common::Server;
use registry::schema::prelude::ObjectType;

pub mod get;
pub mod mapping;
pub mod query;
pub mod set;

pub trait EnterpriseRegistry {
    fn assert_enterprise_object(&self, object_type: ObjectType) -> trc::Result<()>;
}

impl EnterpriseRegistry for Server {
    fn assert_enterprise_object(&self, object_type: ObjectType) -> trc::Result<()> {
        if !matches!(
            object_type,
            ObjectType::MaskedEmail
                | ObjectType::ArchivedItem
                | ObjectType::Metric
                | ObjectType::Trace
        ) {
            return Ok(());
        }

    
        #[cfg(feature = "enterprise")]
        if self.is_enterprise_edition() {
            return Ok(());
        }
        

        Err(trc::JmapEvent::Forbidden.into_err().details(concat!(
            "Not available yet: this shippin.tech feature is being rebuilt ",
            "as our own code (RELEASE.md, section F)."
        )))
    }
}
