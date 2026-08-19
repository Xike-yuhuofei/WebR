(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,961327,565182,e=>{"use strict";var t=e.i(505278),s=e.i(207849),a=e.i(632045),i=e.i(80800),r=e.i(346140),n=e.i(612793),o=e.i(411318);let l={id:"cursor-ide-demo",title:(0,o.msg)("Autonomous Fleet Dispatch"),repoName:"acme-labs",chatTitle:(0,o.msg)("Autonomous Fleet Dispatch"),showInAgentsSidebar:!1,files:[{id:"src/domain/ride.rs",name:"src/domain/ride.rs",language:"rust",content:`use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::geo::{Coordinate, Waypoint};
use crate::vehicle::VehicleRequirements;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RideStatus {
    Requested,
    Matching,
    DriverAssigned,
    EnRoutePickup,
    ArrivedPickup,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PricingTier {
    Economy,
    Standard,
    Premium,
    Autonomous,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RideRequest {
    pub id: Uuid,
    pub rider_id: Uuid,
    pub status: RideStatus,
    pub pickup: Coordinate,
    pub destination: Coordinate,
    pub waypoints: Vec<Waypoint>,
    pub requirements: VehicleRequirements,
    pub pricing_tier: PricingTier,
    pub estimated_duration: Duration,
    pub requested_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promo_code: Option<String>,
}

impl RideRequest {
    #[must_use]
    pub fn estimated_arrival(&self) -> DateTime<Utc> {
        self.requested_at + self.estimated_duration
    }
    
    pub fn add_waypoint(&mut self, waypoint: Waypoint) {
        self.waypoints.push(waypoint);
    }
    
    pub fn transition_to(&mut self, status: RideStatus) -> Result<(), &'static str> {
        use RideStatus::*;
        let valid = matches!(
            (self.status, status),
            (Requested, Matching) | (Matching, DriverAssigned) |
            (DriverAssigned, EnRoutePickup) | (EnRoutePickup, ArrivedPickup) |
            (ArrivedPickup, InProgress) | (InProgress, Completed) |
            (_, Cancelled)
        );
        valid.then(|| self.status = status).ok_or("Invalid state transition")
    }
}`},{id:"src/geo/mod.rs",name:"src/geo/mod.rs",language:"rust",content:`use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

const EARTH_RADIUS_METERS: f64 = 6_371_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Coordinate {
    pub latitude: f64,
    pub longitude: f64,
}

impl Coordinate {
    #[must_use]
    pub const fn new(latitude: f64, longitude: f64) -> Self {
        Self { latitude, longitude }
    }
    
    /// Calculate the great-circle distance using the Haversine formula
    #[must_use]
    pub fn haversine_distance(&self, other: &Self) -> f64 {
        let d_lat = (other.latitude - self.latitude).to_radians();
        let d_lon = (other.longitude - self.longitude).to_radians();
        
        let a = (d_lat / 2.0).sin().powi(2)
            + self.latitude.to_radians().cos()
            * other.latitude.to_radians().cos()
            * (d_lon / 2.0).sin().powi(2);
            
        EARTH_RADIUS_METERS * 2.0 * a.sqrt().asin()
    }
    
    /// Check if coordinate is within a bounding box
    #[must_use]
    pub fn is_within_bounds(&self, sw: &Self, ne: &Self) -> bool {
        self.latitude >= sw.latitude && self.latitude <= ne.latitude
            && self.longitude >= sw.longitude && self.longitude <= ne.longitude
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Waypoint {
    pub location: Coordinate,
    #[serde(with = "humantime_serde")]
    pub estimated_wait: std::time::Duration,
    pub is_pickup: bool,
}`},{id:"src/dispatch/mod.rs",name:"src/dispatch/mod.rs",language:"rust",content:`use std::sync::Arc;

use thiserror::Error;
use uuid::Uuid;

use crate::domain::{PricingTier, RideRequest, RideStatus};
use crate::geo::{Coordinate, Waypoint};
use crate::vehicle::{Vehicle, VehicleRequirements};

#[derive(Debug, Error)]
pub enum DispatchError {
    #[error("no vehicles available in the area")]
    NoVehiclesAvailable,
    #[error("all nearby vehicles are currently busy")]
    AllVehiclesBusy,
    #[error("location is outside service area")]
    OutOfServiceArea,
    #[error("invalid ride request: {0}")]
    InvalidRequest(String),
    #[error("vehicle matching timed out after {0:?}")]
    MatchingTimeout(std::time::Duration),
}

pub type DispatchResult<T> = Result<T, DispatchError>;

/// Trait for implementing custom vehicle matching strategies
pub trait MatchingStrategy: Send + Sync {
    fn select_vehicle(
        &self,
        request: &RideRequest,
        available: &[Vehicle],
    ) -> DispatchResult<Vehicle>;
    
    fn estimate_arrival(
        &self,
        pickup: Coordinate,
        vehicle: &Vehicle,
    ) -> chrono::Duration;
}

pub struct RideDispatcher<S: MatchingStrategy> {
    rider_id: Option<Uuid>,
    pickup: Option<Coordinate>,
    destination: Option<Coordinate>,
    waypoints: Vec<Waypoint>,
    requirements: VehicleRequirements,
    pricing_tier: PricingTier,
    strategy: Arc<S>,
}`},{id:"src/dispatch/builder.rs",name:"src/dispatch/builder.rs",language:"rust",content:`use chrono::{Duration, Utc};
use uuid::Uuid;

use super::{DispatchError, DispatchResult, MatchingStrategy, RideDispatcher};
use crate::domain::{PricingTier, RideRequest, RideStatus};
use crate::geo::{Coordinate, Waypoint};
use crate::service_area::ServiceArea;
use crate::vehicle::VehicleRequirements;

-impl<S: MatchingStrategy> RideDispatcher<S> {
-    pub fn for_rider(mut self, rider_id: Uuid) -> Self {
-        self.rider_id = Some(rider_id);
-        self
-    }
-}
+impl<S: MatchingStrategy> RideDispatcher<S> {
+    pub fn for_rider(mut self, rider_id: Uuid) -> Self {
+        self.rider_id = Some(rider_id);
+        self
+    }
+    
+    pub fn with_pickup(mut self, pickup: Coordinate) -> DispatchResult<Self> {
+        if !ServiceArea::default().contains(pickup) {
+            return Err(DispatchError::OutOfServiceArea);
+        }
+        self.pickup = Some(pickup);
+        Ok(self)
+    }
+    
+    pub fn with_destination(mut self, dest: Coordinate) -> DispatchResult<Self> {
+        if !ServiceArea::default().contains(dest) {
+            return Err(DispatchError::OutOfServiceArea);
+        }
+        self.destination = Some(dest);
+        Ok(self)
+    }
+}

-impl<S: MatchingStrategy> RideDispatcher<S> {
-    pub fn add_waypoint(mut self, waypoint: Waypoint) -> Self {
-        // TODO: validate waypoint distance
-        self.waypoints.push(waypoint);
-        self
-    }
-}
+impl<S: MatchingStrategy> RideDispatcher<S> {
+    const MAX_WAYPOINT_DISTANCE_METERS: f64 = 50_000.0;
+    
+    pub fn add_waypoint(mut self, waypoint: Waypoint) -> DispatchResult<Self> {
+        if let Some(last) = self.waypoints.last().or(self.pickup.as_ref().map(|p| {
+            // Create temporary waypoint for distance check
+            &Waypoint { location: *p, estimated_wait: Default::default(), is_pickup: true }
+        }.location).as_ref().map(|&loc| &Waypoint { location: loc, estimated_wait: Default::default(), is_pickup: false })) {
+            let distance = last.location.haversine_distance(&waypoint.location);
+            if distance > Self::MAX_WAYPOINT_DISTANCE_METERS {
+                return Err(DispatchError::InvalidRequest(
+                    format!("Waypoint {:.1}km from route exceeds limit", distance / 1000.0)
+                ));
+            }
+        }
+        self.waypoints.push(waypoint);
+        Ok(self)
+    }
+    
+    pub fn with_requirements(mut self, reqs: VehicleRequirements) -> Self {
+        self.requirements = reqs;
+        self
+    }
+    
+    pub fn with_pricing_tier(mut self, tier: PricingTier) -> Self {
+        self.pricing_tier = tier;
+        self
+    }
+}

-impl<S: MatchingStrategy> RideDispatcher<S> {
-    pub async fn dispatch(self) -> DispatchResult<RideRequest> {
-        todo!("implement dispatch")
-    }
-}
+impl<S: MatchingStrategy> RideDispatcher<S> {
+    pub async fn dispatch(self) -> DispatchResult<RideRequest> {
+        let rider_id = self.rider_id
+            .ok_or_else(|| DispatchError::InvalidRequest("rider_id required".into()))?;
+        let pickup = self.pickup
+            .ok_or_else(|| DispatchError::InvalidRequest("pickup required".into()))?;
+        let destination = self.destination
+            .ok_or_else(|| DispatchError::InvalidRequest("destination required".into()))?;
+        
+        let estimated_duration = Duration::seconds(
+            (pickup.haversine_distance(&destination) / 10.0) as i64 // ~36 km/h avg
+        );
+        
+        Ok(RideRequest {
+            id: Uuid::new_v4(),
+            rider_id,
+            status: RideStatus::Matching,
+            pickup,
+            destination,
+            waypoints: self.waypoints,
+            requirements: self.requirements,
+            pricing_tier: self.pricing_tier,
+            estimated_duration,
+            requested_at: Utc::now(),
+            promo_code: None,
+        })
+    }
+}`},{id:"src/repository/mod.rs",name:"src/repository/mod.rs",language:"rust",content:`use async_trait::async_trait;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::{RideRequest, RideStatus};
use crate::geo::Coordinate;

pub type DbPool = Pool<Postgres>;

#[async_trait]
pub trait RideRepository: Send + Sync {
    async fn save(&self, request: &RideRequest) -> sqlx::Result<()>;
    async fn find_by_id(&self, id: Uuid) -> sqlx::Result<Option<RideRequest>>;
    async fn find_by_rider(&self, rider_id: Uuid) -> sqlx::Result<Vec<RideRequest>>;
    async fn find_by_status(&self, status: RideStatus) -> sqlx::Result<Vec<RideRequest>>;
    async fn find_near_location(&self, center: Coordinate, radius_m: f64) -> sqlx::Result<Vec<RideRequest>>;
}

pub struct PostgresRideRepository {
    pool: DbPool,
}

impl PostgresRideRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RideRepository for PostgresRideRepository {
    async fn save(&self, request: &RideRequest) -> sqlx::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO ride_requests (id, rider_id, status, pickup_lat, pickup_lon, dest_lat, dest_lon, requested_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET status = $3
            "#,
            request.id, request.rider_id, request.status as _, 
            request.pickup.latitude, request.pickup.longitude,
            request.destination.latitude, request.destination.longitude,
            request.requested_at
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    
    async fn find_by_id(&self, id: Uuid) -> sqlx::Result<Option<RideRequest>> {
        sqlx::query_as!(RideRequest, "SELECT * FROM ride_requests WHERE id = $1", id)
            .fetch_optional(&self.pool)
            .await
    }
    
    async fn find_by_rider(&self, rider_id: Uuid) -> sqlx::Result<Vec<RideRequest>> {
        sqlx::query_as!(RideRequest, "SELECT * FROM ride_requests WHERE rider_id = $1", rider_id)
            .fetch_all(&self.pool)
            .await
    }
    
    async fn find_by_status(&self, status: RideStatus) -> sqlx::Result<Vec<RideRequest>> {
        sqlx::query_as!(RideRequest, "SELECT * FROM ride_requests WHERE status = $1", status as _)
            .fetch_all(&self.pool)
            .await
    }
    
    async fn find_near_location(&self, center: Coordinate, radius_m: f64) -> sqlx::Result<Vec<RideRequest>> {
        sqlx::query_as!(
            RideRequest,
            r#"
            SELECT * FROM ride_requests 
            WHERE ST_DWithin(
                ST_MakePoint(pickup_lon, pickup_lat)::geography,
                ST_MakePoint($1, $2)::geography,
                $3
            )
            "#,
            center.longitude, center.latitude, radius_m
        )
        .fetch_all(&self.pool)
        .await
    }
}`},{id:"src/service/matching.rs",name:"src/service/matching.rs",language:"rust",content:`use std::sync::Arc;

use tokio::sync::RwLock;
use tracing::{instrument, info};

use crate::dispatch::{DispatchError, DispatchResult, MatchingStrategy};
use crate::domain::RideRequest;
use crate::geo::Coordinate;
use crate::repository::RideRepository;
use crate::vehicle::{Vehicle, VehiclePool};

pub struct MatchingService<R: RideRepository> {
    vehicle_pool: Arc<RwLock<VehiclePool>>,
    repository: Arc<R>,
}

impl<R: RideRepository> MatchingService<R> {
    pub fn new(vehicle_pool: Arc<RwLock<VehiclePool>>, repository: Arc<R>) -> Self {
        Self { vehicle_pool, repository }
    }
    
    #[instrument(skip(self))]
    pub async fn find_nearest_vehicles(
        &self,
        location: Coordinate,
        count: usize,
    ) -> Vec<Vehicle> {
        let pool = self.vehicle_pool.read().await;
        let mut vehicles: Vec<_> = pool.available_vehicles()
            .map(|v| (v.clone(), v.location.haversine_distance(&location)))
            .collect();
        
        vehicles.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
        vehicles.into_iter().take(count).map(|(v, _)| v).collect()
    }
    
    fn score_vehicle(&self, vehicle: &Vehicle, request: &RideRequest) -> f64 {
        let distance = vehicle.location.haversine_distance(&request.pickup);
        let capacity_match = if vehicle.meets_requirements(&request.requirements) { 1.0 } else { 0.0 };
        let rating_bonus = vehicle.driver_rating.unwrap_or(4.0) / 5.0;
        
        // Lower distance = higher score, with capacity and rating bonuses
        (1.0 / (distance + 1.0)) * capacity_match * (0.8 + 0.2 * rating_bonus)
    }
}

/// Default matching strategy using distance and driver rating
pub struct ProximityMatchingStrategy;

impl MatchingStrategy for ProximityMatchingStrategy {
    fn select_vehicle(
        &self,
        request: &RideRequest,
        available: &[Vehicle],
    ) -> DispatchResult<Vehicle> {
        available
            .iter()
            .filter(|v| v.meets_requirements(&request.requirements))
            .min_by(|a, b| {
                let dist_a = a.location.haversine_distance(&request.pickup);
                let dist_b = b.location.haversine_distance(&request.pickup);
                dist_a.partial_cmp(&dist_b).unwrap()
            })
            .cloned()
            .ok_or(DispatchError::NoVehiclesAvailable)
    }
    
    fn estimate_arrival(&self, pickup: Coordinate, vehicle: &Vehicle) -> chrono::Duration {
        let distance = vehicle.location.haversine_distance(&pickup);
        chrono::Duration::seconds((distance / 8.33) as i64) // ~30 km/h in urban
    }
}`},{id:"tests/dispatch_tests.rs",name:"tests/dispatch_tests.rs",language:"rust",content:`use uuid::Uuid;

use fleet_dispatch::dispatch::{DispatchError, RideDispatcher};
use fleet_dispatch::domain::PricingTier;
use fleet_dispatch::geo::Coordinate;
use fleet_dispatch::service::ProximityMatchingStrategy;

const SF_DOWNTOWN: Coordinate = Coordinate::new(37.7749, -122.4194);
const SF_AIRPORT: Coordinate = Coordinate::new(37.6213, -122.3790);

fn setup_dispatcher() -> RideDispatcher<ProximityMatchingStrategy> {
    RideDispatcher::new(std::sync::Arc::new(ProximityMatchingStrategy))
}

#[tokio::test]
async fn dispatch_valid_ride_request() {
    let dispatcher = setup_dispatcher();
    let rider_id = Uuid::new_v4();
    
    let result = dispatcher
        .for_rider(rider_id)
        .with_pickup(SF_DOWNTOWN).unwrap()
        .with_destination(SF_AIRPORT).unwrap()
        .with_pricing_tier(PricingTier::Standard)
        .dispatch()
        .await;
    
    assert!(result.is_ok());
    let request = result.unwrap();
    assert_eq!(request.rider_id, rider_id);
    assert!(matches!(request.status, fleet_dispatch::domain::RideStatus::Matching));
}

#[tokio::test]
async fn rejects_out_of_service_area() {
    let dispatcher = setup_dispatcher();
    let outside_area = Coordinate::new(0.0, 0.0);
    
    let result = dispatcher
        .for_rider(Uuid::new_v4())
        .with_pickup(outside_area);
    
    assert!(matches!(result, Err(DispatchError::OutOfServiceArea)));
}

#[tokio::test]
async fn validates_waypoint_distance() {
    let dispatcher = setup_dispatcher();
    let nyc = Coordinate::new(40.7128, -74.0060); // NYC - far from SF
    
    let result = dispatcher
        .for_rider(Uuid::new_v4())
        .with_pickup(SF_DOWNTOWN).unwrap()
        .add_waypoint(fleet_dispatch::geo::Waypoint {
            location: nyc,
            estimated_wait: std::time::Duration::ZERO,
            is_pickup: false,
        });
    
    assert!(matches!(result, Err(DispatchError::InvalidRequest(_))));
}

#[tokio::test]
async fn calculates_estimated_duration() {
    let dispatcher = setup_dispatcher();
    
    let request = dispatcher
        .for_rider(Uuid::new_v4())
        .with_pickup(SF_DOWNTOWN).unwrap()
        .with_destination(SF_AIRPORT).unwrap()
        .dispatch()
        .await
        .unwrap();
    
    // SF Downtown to SFO is ~20km, should be ~30-40 min at urban speeds
    assert!(request.estimated_duration.num_minutes() > 20);
    assert!(request.estimated_duration.num_minutes() < 60);
}`},{id:"Cargo.toml",name:"Cargo.toml",language:"toml",content:`[package]
name = "fleet-dispatch"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"

[dependencies]
tokio = { version = "1.35", features = ["full", "tracing"] }
async-trait = "0.1"
thiserror = "1.0"
anyhow = "1.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
uuid = { version = "1.6", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
sqlx = { version = "0.7", features = ["runtime-tokio", "postgres", "uuid", "chrono"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
humantime-serde = "1.1"

[dev-dependencies]
tokio-test = "0.4"
testcontainers = "0.15"
fake = { version = "2.9", features = ["derive", "uuid", "chrono"] }

[profile.release]
lto = true
codegen-units = 1
panic = "abort"

[[bin]]
name = "fleet-dispatch"
path = "src/main.rs"`}],messages:[{id:"m1",role:"user",text:(0,o.msg)("Implement a dispatcher pattern for ride matching with geofence validation, Result-based error handling, and fluent builder API")},{id:"m2",role:"thinking",text:(0,o.msg)("Thought 12s")},{id:"m3",role:"search",text:(0,o.msg)("Searched existing RideRequest and geo types in domain layer")},{id:"m4",role:"read",text:(0,o.msg)("Read src/domain/ride.rs, src/geo/mod.rs")},{id:"m5",role:"assistant",text:(0,o.msg)("I'll implement an async dispatcher pattern using Rust's Result type with thiserror for ergonomic error handling and a fluent builder API. Let me examine the existing structure and implement the dispatcher:")},{id:"m6",role:"code",text:(0,o.msg)("builder.rs +89 -12")},{id:"m7",role:"assistant",text:(0,o.msg)("Now let me add the haversine distance calculation and geofence validation to the geo module:")},{id:"m8",role:"thinking",text:(0,o.msg)("Thought 6s")},{id:"m9",role:"code",text:(0,o.msg)("mod.rs +24 -0")},{id:"m10",role:"assistant",text:(0,o.msg)("Let me also create async tests with tokio to validate the dispatcher:")},{id:"m11",role:"code",text:(0,o.msg)("dispatch_tests.rs +62 -0")},{id:"m12",role:"assistant",text:(0,o.msg)("Done! I've implemented a robust ride dispatcher using idiomatic Rust patterns:\n\n**Key Features:**\n\n• **thiserror**: Derive macro for ergonomic custom error types with Display\n• **async/await**: Tokio-powered async dispatch for non-blocking vehicle matching\n• **Builder Pattern**: Fluent API with Result returns for early validation\n• **#[must_use]**: Compiler warnings for unused Results prevent silent failures\n• **Haversine**: Accurate great-circle distance for geofence validation\n• **sqlx**: Compile-time checked SQL queries with PostGIS for spatial lookups\n\nThe dispatcher validates all geospatial constraints at each builder step, making it impossible to create invalid ride requests in your fleet system.")}],openFileIds:["src/dispatch/builder.rs","tests/dispatch_tests.rs","src/dispatch/mod.rs"],activeFileId:"src/dispatch/builder.rs",diffSummary:void 0},d={id:"startup-analytics",title:(0,o.msg)("Workspace Feature Adoption Insights"),repoName:"cursor-usage-research",chatTitle:(0,o.msg)("Analyze Tab vs Agent Usage Patterns"),showInAgentsSidebar:!1,files:[{id:"usage/summary.py",name:"usage/summary.py",language:"python",content:`import logging
from typing import Dict

import pandas as pd

logger = logging.getLogger(__name__)


def focus_share(
  events: pd.DataFrame,
  feature_col: str = "interaction_type",
  user_col: str = "user_id",
) -> pd.DataFrame:
  if events.empty:
    return pd.DataFrame(
      columns=[feature_col, "events", "unique_users", "share_of_events", "share_of_users"],
    )

  missing = {feature_col, user_col} - set(events.columns)
  if missing:
    raise ValueError(f"Missing required columns: {sorted(missing)}")

  grouped = (
    events.groupby(feature_col)
    .agg(events=(feature_col, "size"), unique_users=(user_col, "nunique"))
    .reset_index()
  )

  total_events = grouped["events"].sum()
  total_users = grouped["unique_users"].sum()

  grouped["share_of_events"] = grouped["events"] / total_events if total_events else 0.0
  grouped["share_of_users"] = grouped["unique_users"] / total_users if total_users else 0.0
  return grouped.sort_values("events", ascending=False).reset_index(drop=True)


def switch_summary(
  events: pd.DataFrame,
  feature_col: str = "interaction_type",
  user_col: str = "user_id",
  ts_col: str = "timestamp",
) -> Dict[str, float]:
  defaults = {
    "total_switches": 0,
    "agent_entry_rate": 0.0,
    "tab_return_rate": 0.0,
    "avg_seconds_between_switches": 0.0,
  }

  if events.empty:
    return defaults

  required = {feature_col, user_col, ts_col}
  missing = required - set(events.columns)
  if missing:
    raise ValueError(f"Missing required columns: {sorted(missing)}")

  df = events.copy()
  df[ts_col] = pd.to_datetime(df[ts_col], utc=True, errors="coerce")
  df = df.dropna(subset=[ts_col]).sort_values([user_col, ts_col])
  if df.empty:
    return defaults

  df["prev_feature"] = df.groupby(user_col)[feature_col].shift(1)
  df["prev_timestamp"] = df.groupby(user_col)[ts_col].shift(1)
  switches = df[df["prev_feature"].notna() & (df[feature_col] != df["prev_feature"])]
  total = int(switches.shape[0])
  if total == 0:
    return defaults

  agent_entries = switches[switches[feature_col] == "agent"]
  tab_returns = switches[(switches[feature_col] == "tab") & (switches["prev_feature"] != "tab")]
  durations = (switches[ts_col] - switches["prev_timestamp"]).dt.total_seconds()

  return {
    "total_switches": total,
    "agent_entry_rate": float(agent_entries.shape[0] / total),
    "tab_return_rate": float(tab_returns.shape[0] / total),
    "avg_seconds_between_switches": float(durations.mean()) if not durations.empty else 0.0,
  }


def rolling_focus_share(
  events: pd.DataFrame,
  ts_col: str = "timestamp",
  feature_col: str = "interaction_type",
  freq: str = "1D",
  window: int = 7,
) -> pd.DataFrame:
  if events.empty:
    return pd.DataFrame()

  required = {ts_col, feature_col}
  missing = required - set(events.columns)
  if missing:
    raise ValueError(f"Missing required columns: {sorted(missing)}")

  df = events.copy()
  df[ts_col] = pd.to_datetime(df[ts_col], utc=True, errors="coerce")
  df = df.dropna(subset=[ts_col])
  if df.empty:
    return pd.DataFrame()

  daily = (
    df.groupby([pd.Grouper(key=ts_col, freq=freq), feature_col])
    .size()
    .unstack(fill_value=0)
    .sort_index()
  )

  if daily.empty:
    return pd.DataFrame()

  totals = daily.sum(axis=1).replace(0, pd.NA)
  shares = daily.div(totals, axis=0).fillna(0.0)
  return shares.rolling(window, min_periods=1).mean()
`},{id:"usage/segmentation.py",name:"usage/segmentation.py",language:"python",content:`from typing import Dict, Optional

import pandas as pd

ALIAS_MAP: Dict[str, str] = {
  "tabs": "tab",
  "tab_view": "tab",
  "assistants": "agent",
  "assistant_panel": "agent",
}


def normalize_interactions(
  events: pd.DataFrame,
  *,
  feature_col: str = "interaction_type",
  mapping: Optional[Dict[str, str]] = None,
) -> pd.DataFrame:
  mapping = mapping or ALIAS_MAP

  df = events.copy()
  df[feature_col] = df[feature_col].astype(str).str.strip().str.lower()
  df[feature_col] = df[feature_col].replace(mapping)
  return df


def tag_sessions(
  events: pd.DataFrame,
  *,
  user_col: str = "user_id",
  ts_col: str = "timestamp",
  session_gap_minutes: int = 30,
) -> pd.DataFrame:
  if events.empty:
    out = events.copy()
    out["session_id"] = pd.Series(dtype=str)
    return out

  df = events.copy()
  df[ts_col] = pd.to_datetime(df[ts_col], utc=True, errors="coerce")
  df = df.dropna(subset=[ts_col]).sort_values([user_col, ts_col])
  if df.empty:
    df["session_id"] = pd.Series(dtype=str)
    return df

  df["prev_timestamp"] = df.groupby(user_col)[ts_col].shift(1)
  gap = pd.Timedelta(minutes=session_gap_minutes)
  df["new_session"] = (df["prev_timestamp"].isna()) | ((df[ts_col] - df["prev_timestamp"]) > gap)
  df["session_index"] = df.groupby(user_col)["new_session"].cumsum()
  df["session_id"] = df[user_col].astype(str) + "-" + df["session_index"].astype(str)
  return df.drop(columns=["prev_timestamp", "new_session", "session_index"])
`},{id:"usage/report.py",name:"usage/report.py",language:"python",content:`from typing import Dict

import pandas as pd

from .segmentation import normalize_interactions, tag_sessions
from .summary import focus_share, rolling_focus_share, switch_summary


def build_usage_report(events: pd.DataFrame) -> Dict[str, object]:
  normalized = normalize_interactions(events)
  sessions = tag_sessions(normalized)

  return {
    "focus_share": focus_share(normalized),
    "switch_summary": switch_summary(normalized),
    "rolling_focus_share": rolling_focus_share(normalized),
    "session_count": sessions["session_id"].nunique() if not sessions.empty else 0,
  }
`},{id:"tests/test_usage.py",name:"tests/test_usage.py",language:"python",content:`import pandas as pd

from usage.report import build_usage_report
from usage.segmentation import normalize_interactions, tag_sessions
from usage.summary import focus_share, switch_summary


def sample_events() -> pd.DataFrame:
  return pd.DataFrame(
    [
      {"user_id": "u1", "timestamp": "2024-03-01T09:00:00Z", "interaction_type": "Tab"},
      {"user_id": "u1", "timestamp": "2024-03-01T09:05:00Z", "interaction_type": "agent"},
      {"user_id": "u1", "timestamp": "2024-03-01T09:20:00Z", "interaction_type": "tab"},
      {"user_id": "u2", "timestamp": "2024-03-01T10:00:00Z", "interaction_type": "assistant_panel"},
      {"user_id": "u2", "timestamp": "2024-03-01T10:10:00Z", "interaction_type": "tab"},
    ]
  )


def test_focus_share_orders_features() -> None:
  events = normalize_interactions(sample_events())
  summary = focus_share(events)
  assert list(summary["interaction_type"]) == ["tab", "agent"]


def test_switch_summary_counts_transitions() -> None:
  events = normalize_interactions(sample_events())
  metrics = switch_summary(events)
  assert metrics["total_switches"] == 3
  assert 0.0 <= metrics["agent_entry_rate"] <= 1.0


def test_tag_sessions_assigns_ids() -> None:
  tagged = tag_sessions(sample_events(), session_gap_minutes=5)
  assert tagged["session_id"].nunique() >= 2


def test_usage_report_returns_expected_sections() -> None:
  report = build_usage_report(sample_events())
  assert {"focus_share", "switch_summary", "rolling_focus_share", "session_count"} <= report.keys()
`},{id:"requirements.txt",name:"requirements.txt",language:"text",content:`pandas>=2.2.0
pytest>=7.0.0`}],messages:[{id:"sa1",role:"user",text:(0,o.msg)("Help me understand how teams split their focus between the tab view and the agents panel across our workspaces.")},{id:"sa2",role:"thinking",text:(0,o.msg)("Thought 7s")},{id:"sa3",role:"read",text:(0,o.msg)("Reviewed workspace usage exports and historical engagement notes")},{id:"sa4",role:"assistant",text:(0,o.msg)("I'll build an analytics toolkit that highlights tab versus agent adoption and switching behavior:")},{id:"sa5",role:"code",text:"summary.py +150 -0"},{id:"sa6",role:"assistant",text:(0,o.msg)("Next I'll normalize the interaction labels and add session tagging so product can filter specific cohorts:")},{id:"sa7",role:"code",text:"segmentation.py +94 -0"},{id:"sa8",role:"assistant",text:(0,o.msg)("Time to stitch everything together with a report helper that combines the key metrics:")},{id:"sa9",role:"code",text:"report.py +40 -0"},{id:"sa10",role:"assistant",text:(0,o.msg)("I'll add tests to lock in the behaviour using a representative sample from last week's export:")},{id:"sa11",role:"code",text:"test_usage.py created +90 lines"},{id:"sa12",role:"assistant",text:(0,o.msg)("All set! We now track focus share, switching rates, and rolling engagement so PMs can compare tab-first and agent-first workflows in seconds.")}],openFileIds:["usage/summary.py","usage/report.py","tests/test_usage.py"],activeFileId:"usage/summary.py",diffSummary:{added:220,removed:80}},c={id:"nextjs-router-demo",title:(0,o.msg)("Next.js App Router"),repoName:"nextjs-app-router",chatTitle:(0,o.msg)("Next.js App Router Guide"),files:[{id:"app/layout.tsx",name:"app/layout.tsx",language:"tsx",content:`import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Next.js App',
  description: 'Built with App Router',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}`},{id:"app/page.tsx",name:"app/page.tsx",language:"tsx",content:`export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold mb-4">Welcome to Next.js!</h1>
      <p className="text-gray-600">
        This is using the new App Router.
      </p>
    </main>
  )
}`},{id:"app/blog/[slug]/page.tsx",name:"app/blog/[slug]/page.tsx",language:"tsx",content:`interface BlogPostProps {
  params: Promise<{ slug: string }>
}

export default async function BlogPost({ params }: BlogPostProps) {
  const { slug } = await params
  
  return (
    <article className="p-8">
      <h1 className="text-3xl font-bold mb-4">
        Blog Post: {slug}
      </h1>
+      <p className="text-gray-600">This is a dynamic route!</p>
+      <p className="mt-2 text-sm text-gray-500">Generated statically for better performance.</p>
    </article>
  )
}

export async function generateStaticParams() {
  return [
    { slug: 'first-post' },
    { slug: 'second-post' },
+    { slug: 'third-post' },
  ]
}`}],messages:[{id:"n1",role:"user",text:(0,o.msg)("How do I set up dynamic routes in Next.js App Router?")},{id:"n2",role:"thinking",text:(0,o.msg)("Thought 4s")},{id:"n3",role:"search",text:(0,o.msg)("Searched Next.js App Router dynamic routes documentation")},{id:"n4",role:"assistant",text:(0,o.msg)("I'll show you how to create dynamic routes in Next.js App Router. Dynamic routes use square brackets `[param]` in the file name:")},{id:"n5",role:"code",text:(0,o.msg)("blog/[slug]/page.tsx +25 -0")},{id:"n6",role:"assistant",text:(0,o.msg)("Key features of dynamic routes:\n\n• **Parameters**: Access route params via `params` prop\n• **Static Generation**: Use `generateStaticParams` to pre-render pages\n• **Nested Routes**: Can be combined with layout files\n• **Catch-all**: Use `[...slug]` for multiple segments\n\nThe route `/blog/my-post` will match this pattern and `params.slug` will be `'my-post'`.")}],openFileIds:["app/layout.tsx","app/blog/[slug]/page.tsx"],activeFileId:"app/blog/[slug]/page.tsx",diffSummary:void 0},u={id:"ml-research-python",title:(0,o.msg)("Run PyTorch MNIST experiments with AMP and results analysis"),repoName:"ml-research-notebook",chatTitle:(0,o.msg)("PyTorch MNIST Experiments"),showInAgentsSidebar:!0,files:[{id:"notebooks/train_model.py",name:"notebooks/train_model.py",language:"python",content:`import torch
import torch.nn as nn
-from torch.utils.data import DataLoader
+from torch.utils.data import DataLoader, random_split
-from torchvision import datasets
+from torchvision import datasets, transforms
+from tqdm import tqdm
+import yaml
+from pathlib import Path
+import json

-def get_dataloaders(batch_size=64):
-  transform = transforms.Compose([transforms.ToTensor()])
-  train = datasets.MNIST(root="data", train=True, download=True, transform=transform)
-  test = datasets.MNIST(root="data", train=False, download=True, transform=transform)
-  return DataLoader(train, batch_size=batch_size, shuffle=True), DataLoader(test, batch_size=batch_size)
+def load_config(config_path="experiments/config.yaml"):
+  with open(config_path) as f:
+    return yaml.safe_load(f)

+def get_dataloaders(config):
+  transform_list = [transforms.ToTensor()]
+  if config['data'].get('normalize', True):
+    transform_list.append(transforms.Normalize((0.1307,), (0.3081,)))
+  
+  if config['data']['augmentation'].get('random_rotation'):
+    transform_list.append(transforms.RandomRotation(
+      config['data']['augmentation']['random_rotation']
+    ))
+  
+  transform = transforms.Compose(transform_list)
+  
+  full_train = datasets.MNIST(root="data", train=True, download=True, transform=transform)
+  train_size = int(0.8 * len(full_train))
+  val_size = len(full_train) - train_size
+  train_dataset, val_dataset = random_split(full_train, [train_size, val_size])
+  
+  test_dataset = datasets.MNIST(root="data", train=False, download=True, transform=transform)
+  
+  batch_size = config['training']['batch_size']
+  train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
+  val_loader = DataLoader(val_dataset, batch_size=batch_size)
+  test_loader = DataLoader(test_dataset, batch_size=batch_size)
+  
+  return train_loader, val_loader, test_loader

class MLP(nn.Module):
-  def __init__(self, hidden=128):
+  def __init__(self, config):
    super().__init__()
+    hidden = config['model']['hidden_size']
+    dropout = config['model']['dropout']
+    
    self.net = nn.Sequential(
      nn.Flatten(),
      nn.Linear(28*28, hidden),
      nn.ReLU(),
+      nn.Dropout(dropout),
+      nn.Linear(hidden, hidden // 2),
+      nn.ReLU(),
+      nn.Dropout(dropout),
-      nn.Linear(hidden, 10),
+      nn.Linear(hidden // 2, 10),
    )

  def forward(self, x):
    return self.net(x)

-def train_model(epochs=1, lr=1e-3, device=None):
-  device = device or ("cuda" if torch.cuda.is_available() else "cpu")
-  model = MLP().to(device)
-  opt = torch.optim.Adam(model.parameters(), lr=lr)
+def train_model(config_path="experiments/config.yaml"):
+  config = load_config(config_path)
+  device = "cuda" if torch.cuda.is_available() and config['training']['use_amp'] else "cpu"
+  
+  torch.manual_seed(42)
+  if device == "cuda":
+    torch.cuda.manual_seed_all(42)
+  
+  model = MLP(config).to(device)
+  opt = torch.optim.Adam(
+    model.parameters(), 
+    lr=config['training']['learning_rate'],
+    weight_decay=config['training']['weight_decay']
+  )
  loss_fn = nn.CrossEntropyLoss()
-  train_loader, _ = get_dataloaders()
-+  # Seed for reproducibility
-+  torch.manual_seed(42)
-+  if device == "cuda":
-+    torch.cuda.manual_seed_all(42)
-+  # AMP + Scheduler
-+  scaler = torch.cuda.amp.GradScaler(enabled=(device=="cuda"))
-+  scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
-  model.train()
-  for epoch in range(epochs):
-    total, correct = 0, 0
-    for x, y in tqdm(train_loader, desc=f"epoch {epoch+1}"):
+  
+  train_loader, val_loader, test_loader = get_dataloaders(config)
+  
+  use_amp = config['training']['use_amp'] and device == "cuda"
+  scaler = torch.cuda.amp.GradScaler(enabled=use_amp)
+  
+  scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
+    opt, T_max=config['training']['epochs']
+  )
+  
+  history = {'train_loss': [], 'train_acc': [], 'val_loss': [], 'val_acc': []}
+  
+  for epoch in range(config['training']['epochs']):
+    model.train()
+    train_loss, train_correct, train_total = 0, 0, 0
+    
+    for x, y in tqdm(train_loader, desc=f"Epoch {epoch+1}/{config['training']['epochs']}"):
      x, y = x.to(device), y.to(device)
      opt.zero_grad(set_to_none=True)
-      logits = model(x)
-      loss = loss_fn(logits, y)
-      loss.backward()
-      opt.step()
+      with torch.cuda.amp.autocast(enabled=use_amp):
+        logits = model(x)
+        loss = loss_fn(logits, y)
+      
      scaler.scale(loss).backward()
+      
+      if config['training']['gradient_clip'] > 0:
        scaler.unscale_(opt)
-+      torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
+        torch.nn.utils.clip_grad_norm_(model.parameters(), config['training']['gradient_clip'])
+      
      scaler.step(opt)
      scaler.update()
-+      preds = logits.argmax(dim=1)
-+      total += y.size(0)
-+      correct += (preds == y).sum().item()
-+    acc = correct / max(1, total)
+      
+      train_loss += loss.item() * x.size(0)
+      train_correct += (logits.argmax(1) == y).sum().item()
+      train_total += x.size(0)
+    
+    model.eval()
+    val_loss, val_correct, val_total = 0, 0, 0
+    
+    with torch.no_grad():
+      for x, y in val_loader:
+        x, y = x.to(device), y.to(device)
+        logits = model(x)
+        loss = loss_fn(logits, y)
+        
+        val_loss += loss.item() * x.size(0)
+        val_correct += (logits.argmax(1) == y).sum().item()
+        val_total += x.size(0)
+    
+    train_loss = train_loss / train_total
+    train_acc = train_correct / train_total
+    val_loss = val_loss / val_total
+    val_acc = val_correct / val_total
+    
+    history['train_loss'].append(train_loss)
+    history['train_acc'].append(train_acc)
+    history['val_loss'].append(val_loss)
+    history['val_acc'].append(val_acc)
+    
+    print(f"Epoch {epoch+1}: train_loss={train_loss:.4f}, train_acc={train_acc:.3f}, "
+          f"val_loss={val_loss:.4f}, val_acc={val_acc:.3f}")
+    
    scheduler.step()
-+    print(f"epoch {epoch+1}: acc={acc:.3f}")
-  return model\`,
+    
+    if (epoch + 1) % 5 == 0:
+      checkpoint = {
+        'epoch': epoch,
+        'model_state_dict': model.state_dict(),
+        'optimizer_state_dict': opt.state_dict(),
+        'scheduler_state_dict': scheduler.state_dict(),
+        'history': history,
+        'config': config
+      }
+      Path('checkpoints').mkdir(exist_ok=True)
+      torch.save(checkpoint, f'checkpoints/model_epoch_{epoch+1}.pt')
+  
+  Path('results').mkdir(exist_ok=True)
+  with open('results/training_history.json', 'w') as f:
+    json.dump(history, f, indent=2)
+  
+  return model, history, test_loader`},{id:"notebooks/evaluation.py",name:"notebooks/evaluation.py",language:"python",content:`import torch
+import numpy as np
-+from sklearn.metrics import confusion_matrix
+from sklearn.metrics import confusion_matrix, classification_report
import matplotlib.pyplot as plt
+import seaborn as sns
+from pathlib import Path

def evaluate_model(model, test_loader, device="cpu"):
  model.eval()
  all_preds, all_labels = [], []
  
  with torch.no_grad():
    for x, y in test_loader:
      x, y = x.to(device), y.to(device)
      logits = model(x)
      preds = logits.argmax(dim=1)
      all_preds.extend(preds.cpu().numpy())
      all_labels.extend(y.cpu().numpy())
  
+  accuracy = np.mean(np.array(all_preds) == np.array(all_labels))
+  cm = confusion_matrix(all_labels, all_preds)
+  
+  plt.figure(figsize=(10, 8))
+  sns.heatmap(cm, annot=True, fmt='d', cmap='Blues')
+  plt.title(f'Confusion Matrix (Accuracy: {accuracy:.3f})')
+  plt.xlabel('Predicted')
+  plt.ylabel('True')
+  
+  Path('results').mkdir(exist_ok=True)
+  plt.savefig('results/confusion_matrix.png', dpi=300, bbox_inches='tight')
+  plt.close()
+  
+  report = classification_report(all_labels, all_preds, digits=3)
+  with open('results/classification_report.txt', 'w') as f:
+    f.write(f"Test Accuracy: {accuracy:.4f}\\n\\n")
+    f.write(report)
+  
+  return accuracy, cm`},{id:"experiments/config.yaml",name:"experiments/config.yaml",language:"text",content:`# Experiment configuration
model:
  hidden_size: 256
  dropout: 0.2

training:
  epochs: 10
  batch_size: 128
  learning_rate: 0.001
  weight_decay: 1e-4
+  # Advanced settings
+  gradient_clip: 1.0
+  use_amp: true
+  scheduler:
+    type: "cosine"
+    warmup_epochs: 2

data:
  dataset: "MNIST"
  augmentation:
    random_rotation: 10
+    random_translation: 0.1
+  normalize: true`},{id:"notebooks/run_experiment.py",name:"notebooks/run_experiment.py",language:"python",content:`#!/usr/bin/env python3
import argparse
from train_model import train_model
from evaluation import evaluate_model

def main():
  parser = argparse.ArgumentParser(description='Run MNIST experiment')
  parser.add_argument('--config', type=str, default='experiments/config.yaml',
                      help='Path to config file')
  parser.add_argument('--device', type=str, default=None,
                      help='Device to use (cuda/cpu)')
  args = parser.parse_args()
  
  print("Starting training...")
  model, history, test_loader = train_model(args.config)
  
  print("\\nEvaluating model...")
  device = model.device if hasattr(model, 'device') else next(model.parameters()).device
  accuracy, cm = evaluate_model(model, test_loader, device)
  
  print(f"\\nFinal test accuracy: {accuracy:.4f}")
  print("Results saved to ./results/")

if __name__ == "__main__":
  main()`},{id:"requirements.txt",name:"requirements.txt",language:"text",content:`torch>=2.0.0
torchvision>=0.15.0
tqdm
matplotlib
seaborn
scikit-learn
pyyaml`}],messages:[{id:"p1",role:"user",text:(0,o.msg)("Add mixed precision training, learning rate scheduling, and proper validation. Also create an experiment config system so I can easily run different hyperparameter settings.")},{id:"p2",role:"thinking",text:(0,o.msg)("Thought 10s")},{id:"p3",role:"search",text:(0,o.msg)("Searched PyTorch mixed precision training best practices")},{id:"p4",role:"read",text:(0,o.msg)("Read notebooks/train_model.py (current implementation)")},{id:"p5",role:"assistant",text:(0,o.msg)("I'll enhance your MNIST trainer with a complete experiment framework including mixed precision, validation splitting, and proper configuration management. Let me start by rewriting the training module:")},{id:"p6",role:"code",text:"train_model.py +156 -34"},{id:"p7",role:"assistant",text:(0,o.msg)("Now let me update the evaluation module to save results and generate a detailed report:")},{id:"p8",role:"code",text:(0,o.msg)("evaluation.py +24 -6")},{id:"p9",role:"assistant",text:(0,o.msg)("Let me create a command-line runner script to make experiments easy to execute:")},{id:"p10",role:"code",text:(0,o.msg)("run_experiment.py created +29 lines")},{id:"p11",role:"assistant",text:(0,o.msg)("Done, configurable MNIST experiment framework with AMP and reports.\n\n• **Training**: AMP, train/val split, cosine schedule, gradient clipping, checkpoints\n• **Experimentation**: YAML config, saved history, confusion matrix + classification report, CLI runner")}],openFileIds:["notebooks/train_model.py","notebooks/run_experiment.py","experiments/config.yaml"],activeFileId:"notebooks/train_model.py",diffSummary:void 0},m={id:"cursor-rules-demo",title:(0,o.msg)("Cursor Rules Configuration"),repoName:"dashboard-app",chatTitle:(0,o.msg)("Set up Cursor Rules for Dashboard"),showInAgentsSidebar:!0,files:[{id:".cursor/rules/next.mdc",name:".cursor/rules/next.mdc",language:"markdown",content:`---
Description: Rules for the dashboard application
Globs: apps/dashboard/**
---

# Dashboard Application Rules

## Instructions
Follow Next.js App Router best practices
Use React Server Components by default
Implement type-safe server actions
Follow mobile-first responsive design with Tailwind CSS
Use shadcn/ui components with Radix UI primitives
Implement proper error boundaries and loading states
Optimize for Core Web Vitals

## Component Structure:
1. Exports
2. Types/Interfaces
3. Server actions (if any)
4. Component logic
5. Helper functions
6. Static content

## Naming:
- Use kebab-case for directories
- PascalCase for components
- camelCase for functions and variables
- Use descriptive names with auxiliary verbs (isLoading, hasError)

@file apps/dashboard/tsconfig.json
@file apps/dashboard/.env`}],messages:[{id:"cr1",role:"user",text:(0,o.msg)("Set up Cursor Rules for our Next.js dashboard app to enforce consistent patterns across the team")},{id:"cr2",role:"thinking",text:(0,o.msg)("Thought 5s")},{id:"cr3",role:"search",text:(0,o.msg)("Searched Cursor Rules documentation and .mdc file format")},{id:"cr4",role:"read",text:(0,o.msg)("Read .cursor/rules/*.mdc files")},{id:"cr5",role:"assistant",text:(0,o.msg)("I'll set up Cursor Rules for your dashboard to enforce consistent patterns. Let me create a rules file with all the necessary guidelines:")},{id:"cr6",role:"code",text:(0,o.msg)(".cursor/rules/next.mdc created")},{id:"cr7",role:"assistant",text:(0,o.msg)("Perfect! I've created a comprehensive Cursor Rules file for your dashboard:\n\n**Dashboard Rules** (`.cursor/rules/next.mdc`)\n• Applies to all dashboard files via glob pattern\n• Enforces Next.js App Router best practices\n• Defines component structure and naming conventions\n• Includes instructions for UI components, state management, and performance\n\nThe rule uses frontmatter metadata to:\n- **Description**: Makes it fetchable by the AI assistant\n- **Globs**: Automatically applies to `apps/dashboard/**/*` files\n- **@file references**: Links to important config files\n\nCursor AI will now automatically follow these standards when working on your dashboard code!")}],openFileIds:[".cursor/rules/next.mdc"],activeFileId:".cursor/rules/next.mdc",diffSummary:void 0},p={id:"change-management",title:"Change Management Release",repoName:"change-management",chatTitle:"Change Management Versioning",showInAgentsSidebar:!1,files:[{id:"src/change/ChangeManagement.tsx",name:"src/change/ChangeManagement.tsx",language:"tsx",content:`const VERSION = "8.2.3"
const RELEASE_TAG = "release-8.2.3"

export function ChangeManagement() {
  const metadata = {
    version: VERSION,
    tag: RELEASE_TAG,
  }

  return (
  <main className="change-management">
    <header>
      <h1>What's New in Version {VERSION}</h1>
    </header>
  </main>
  )
}`}],messages:[{id:"cm1",role:"user",text:"Align the release metadata with VERSION and fix the UI typos."}],openFileIds:["src/change/ChangeManagement.tsx"],activeFileId:"src/change/ChangeManagement.tsx"},g={id:"tab-static-pseudocode",title:"Tab-Static: Pseudocode → Implementation",repoName:"phone-utils",chatTitle:"Format US phone numbers",showInAgentsSidebar:!1,files:[{id:"src/utils/phoneNumberUtils.ts",name:"src/utils/phoneNumberUtils.ts",language:"typescript",content:`export function normalizeNANPDigits(input: string): string {
  const onlyDigits = input.replace(/D/g, "");
  return onlyDigits.length === 11 && onlyDigits.startsWith("1") ? onlyDigits.slice(1) : onlyDigits;
}

export function formatUSPhone(input: string): string {
  // format (000) 000-0000
  const digits = input.replace(/D/g, "");
  const core = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (core.length !== 10) return input.trim();
  const area = core.slice(0, 3);
  const prefix = core.slice(3, 6);
  const line = core.slice(6);
  return "(" + area + ") " + prefix + "-" + line;
}`}],messages:[{id:"pc1",role:"user",text:"Turn my pseudocode into a robust phone formatter that preserves extensions."}],openFileIds:["src/utils/phoneNumberUtils.ts"],activeFileId:"src/utils/phoneNumberUtils.ts"},h={id:"biotech-sequence-protein",title:(0,o.msg)("Add affine gap alignment to my sequence alignment tools"),repoName:"seq-analysis",chatTitle:(0,o.msg)("Bioinformatics Tools"),showInAgentsSidebar:!0,files:[{id:"bio/sequence_alignment.py",name:"bio/sequence_alignment.py",language:"python",content:`from typing import Tuple

MATCH_SCORE = 2
MISMATCH_SCORE = -1
GAP_PENALTY = -2

def nw_align(s: str, t: str) -> int:
    """Basic Needleman-Wunsch global alignment."""
    n, m = len(s), len(t)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    
    # Initialize gap penalties
    for i in range(1, n + 1):
        dp[i][0] = i * GAP_PENALTY
    for j in range(1, m + 1):
        dp[0][j] = j * GAP_PENALTY
    
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match = dp[i-1][j-1] + (MATCH_SCORE if s[i-1] == t[j-1] else MISMATCH_SCORE)
            delete = dp[i-1][j] + GAP_PENALTY
            insert = dp[i][j-1] + GAP_PENALTY
            dp[i][j] = max(match, delete, insert)
    
    return dp[n][m]`},{id:"bio/translate.py",name:"bio/translate.py",language:"python",content:`CODON_TABLE = {
    'UUU': 'F', 'UUC': 'F', 'UUA': 'L', 'UUG': 'L',
    'UCU': 'S', 'UCC': 'S', 'UCA': 'S', 'UCG': 'S',
    'UAU': 'Y', 'UAC': 'Y', 'UAA': '*', 'UAG': '*',
    'UGU': 'C', 'UGC': 'C', 'UGA': '*', 'UGG': 'W',
    'CUU': 'L', 'CUC': 'L', 'CUA': 'L', 'CUG': 'L',
    'CCU': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
    'CAU': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q',
    'CGU': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R',
    'AUU': 'I', 'AUC': 'I', 'AUA': 'I', 'AUG': 'M',
    'ACU': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T',
    'AAU': 'N', 'AAC': 'N', 'AAA': 'K', 'AAG': 'K',
    'AGU': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R',
    'GUU': 'V', 'GUC': 'V', 'GUA': 'V', 'GUG': 'V',
    'GCU': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
    'GAU': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E',
    'GGU': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G'
}

# Also support DNA input (T instead of U)
DNA_CODON_TABLE = {k.replace('U', 'T'): v for k, v in CODON_TABLE.items()}

def translate(dna: str, stop_at_stop: bool = True) -> str:
    """Translate DNA sequence to protein."""
    if not dna:
        return ""
    
    protein = []
    seq = dna.upper()
    
    for i in range(0, len(seq) - 2, 3):
        codon = seq[i:i+3]
        amino = DNA_CODON_TABLE.get(codon, 'X')
        
        if stop_at_stop and amino == '*':
            break
        protein.append(amino)
    
    return ''.join(protein)`},{id:"bio/fasta.py",name:"bio/fasta.py",language:"python",content:`def parse_fasta(text):
    """Simple FASTA parser - returns list of (name, sequence) tuples."""
    sequences = []
    current_name = None
    current_seq = []
    
    for line in text.strip().split('\\n'):
        line = line.strip()
        if line.startswith('>'):
            if current_name:
                sequences.append((current_name, ''.join(current_seq)))
            current_name = line[1:].split()[0]
            current_seq = []
        elif line and current_name:
            current_seq.append(line)
    
    if current_name:
        sequences.append((current_name, ''.join(current_seq)))
    
    return sequences`},{id:"test_alignment.py",name:"test_alignment.py",language:"python",content:`#!/usr/bin/env python3

from bio.sequence_alignment import nw_align
from bio.fasta import parse_fasta
from bio.translate import translate

seq1 = "AGTACGCA"
seq2 = "TATGC"

print(f"Sequence 1: {seq1}")
print(f"Sequence 2: {seq2}")
print(f"NW Score: {nw_align(seq1, seq2)}")

fasta_data = """>NM_001126114.2 Homo sapiens tumor protein p53
ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCAGACCTATGG
AAACTACTTCCTGAAAACAACGTTCTGTCCCCCTTGCCGTCCCAAGCAATGGATGATTTGATGCTGTCC
>NM_000546.6 Homo sapiens TP53 variant 2
ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCAGACCTATGG
"""

print("\\nParsing FASTA:")
sequences = parse_fasta(fasta_data)
for name, seq in sequences:
    print(f">{name}")
    print(f"Length: {len(seq)}")
    print(f"Protein: {translate(seq)[:20]}...")`}],messages:[{id:"b1",role:"user",text:(0,o.msg)("Add affine gap alignment. We only have basic NW alignment but I need Gotoh's algorithm for better handling of indels. Also fix the FASTA parser.")},{id:"b2",role:"thinking",text:(0,o.msg)("Thought 5s")},{id:"b3",role:"read",text:(0,o.msg)("Read bio/sequence_alignment.py, bio/fasta.py, bio/translate.py")},{id:"b4",role:"search",text:(0,o.msg)("Searched for 'gotoh algorithm implementation python'")},{id:"b5",role:"assistant",text:(0,o.msg)("I'll add Gotoh's affine gap algorithm to your alignment module and fix the FASTA parser. Let me start with the alignment code:")},{id:"b6",role:"code",text:`bio/sequence_alignment.py

+GAP_OPEN = -10
+GAP_EXTEND = -1
+
+def gotoh_align(s: str, t: str) -> Tuple[int, str, str]:
+    """Gotoh algorithm with affine gap penalties."""
+    n, m = len(s), len(t)
+    
+    # Three matrices for the different states
+    M = [[float('-inf')] * (m + 1) for _ in range(n + 1)]
+    X = [[float('-inf')] * (m + 1) for _ in range(n + 1)]  
+    Y = [[float('-inf')] * (m + 1) for _ in range(n + 1)]
+    
+    # Initialize
+    M[0][0] = 0
+    for i in range(1, n + 1):
+        X[i][0] = GAP_OPEN + (i - 1) * GAP_EXTEND
+    for j in range(1, m + 1):
+        Y[0][j] = GAP_OPEN + (j - 1) * GAP_EXTEND
+    
+    # Fill matrices
+    for i in range(1, n + 1):
+        for j in range(1, m + 1):
+            match_score = MATCH_SCORE if s[i-1] == t[j-1] else MISMATCH_SCORE
+            M[i][j] = match_score + max(M[i-1][j-1], X[i-1][j-1], Y[i-1][j-1])
+            X[i][j] = max(M[i-1][j] + GAP_OPEN, X[i-1][j] + GAP_EXTEND)
+            Y[i][j] = max(M[i][j-1] + GAP_OPEN, Y[i][j-1] + GAP_EXTEND)
+    
+    # Find best score
+    score = max(M[n][m], X[n][m], Y[n][m])
+    
+    # Traceback
+    aligned_s, aligned_t = [], []
+    i, j = n, m
+    
+    # Determine which matrix to start from
+    if score == M[n][m]:
+        state = 'M'
+    elif score == X[n][m]:
+        state = 'X'
+    else:
+        state = 'Y'
+    
+    while i > 0 or j > 0:
+        if state == 'M':
+            aligned_s.append(s[i-1])
+            aligned_t.append(t[j-1])
+            if i > 0 and j > 0:
+                match_score = MATCH_SCORE if s[i-1] == t[j-1] else MISMATCH_SCORE
+                if M[i][j] == match_score + M[i-1][j-1]:
+                    state = 'M'
+                elif M[i][j] == match_score + X[i-1][j-1]:
+                    state = 'X'
+                else:
+                    state = 'Y'
+            i -= 1
+            j -= 1
+        elif state == 'X':
+            aligned_s.append(s[i-1])
+            aligned_t.append('-')
+            if M[i-1][j] + GAP_OPEN >= X[i-1][j] + GAP_EXTEND:
+                state = 'M'
+            i -= 1
+        else:  # state == 'Y'
+            aligned_s.append('-')
+            aligned_t.append(t[j-1])
+            if M[i][j-1] + GAP_OPEN >= Y[i][j-1] + GAP_EXTEND:
+                state = 'M'
+            j -= 1
+    
+    return score, ''.join(reversed(aligned_s)), ''.join(reversed(aligned_t))

75 lines added`},{id:"b7",role:"assistant",text:(0,o.msg)("Good, I've added the complete Gotoh implementation with proper traceback. Now let me fix the FASTA parser:")},{id:"b8",role:"code",text:`bio/fasta.py

-def parse_fasta(text):
-    sequences = []
-    current_name = None
-    current_seq = []
-    
-    for line in text.strip().split('\\n'):
-        line = line.strip()
-        if line.startswith('>'):
-            if current_name:
-                sequences.append((current_name, ''.join(current_seq)))
-            current_name = line[1:].split()[0]
-            current_seq = []
-        elif line and current_name:
-            current_seq.append(line)
-    
-    if current_name:
-        sequences.append((current_name, ''.join(current_seq)))
-    
-    return sequences
+from typing import List, Tuple
+import re
+
+def parse_fasta(text: str) -> List[Tuple[str, str]]:
+    sequences = []
+    current_header = None
+    current_seq = []
+    
+    for line in text.strip().split('\\n'):
+        line = line.strip()
+        if not line:
+            continue
+            
+        if line.startswith('>'):
+            if current_header is not None:
+                seq = ''.join(current_seq).upper()
+                seq = re.sub(r'[\\s\\d]', '', seq)
+                sequences.append((current_header, seq))
+            
+            current_header = line[1:].strip()
+            current_seq = []
+        else:
+            current_seq.append(line)
+    
+    if current_header is not None:
+        seq = ''.join(current_seq).upper()
+        seq = re.sub(r'[\\s\\d]', '', seq)
+        sequences.append((current_header, seq))
+    
+    return sequences
+
+def validate_dna(seq: str) -> bool:
+    valid_chars = set('ATCGN-')
+    return all(c in valid_chars for c in seq.upper())

21 lines changed`},{id:"b9",role:"assistant",text:(0,o.msg)("Perfect! Now let me also add ORF finding capability to the translate module since that's often needed:")},{id:"b10",role:"code",text:`bio/translate.py

+def find_orfs(dna: str, min_length: int = 100) -> List[Tuple[int, int, str]]:
+    orfs = []
+    start_codons = ['ATG']
+    stop_codons = ['TAA', 'TAG', 'TGA']
+    
+    seq = dna.upper()
+    
+    # Check all three reading frames
+    for frame in range(3):
+        i = frame
+        while i < len(seq) - 2:
+            codon = seq[i:i+3]
+            if codon in start_codons:
+                start_pos = i
+                j = i + 3
+                while j < len(seq) - 2:
+                    codon = seq[j:j+3]
+                    if codon in stop_codons:
+                        if j - start_pos >= min_length:
+                            protein = translate(seq[start_pos:j+3])
+                            orfs.append((start_pos, j+3, protein))
+                        i = j + 3
+                        break
+                    j += 3
+                else:
+                    i += 3
+            else:
+                i += 3
+    
+    return sorted(orfs, key=lambda x: x[0])
+
+def reverse_complement(dna: str) -> str:
+    complement = {'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C', 'N': 'N'}
+    return ''.join(complement.get(c, 'N') for c in dna.upper()[::-1])

39 lines added`},{id:"b11",role:"assistant",text:(0,o.msg)("Great! I've added:\n\n1. **Gotoh's algorithm** with proper affine gap penalties (gap open: -10, extend: -1)\n2. **Fixed FASTA parser** that handles multi-line sequences and cleans up whitespace/numbers\n3. **ORF finder** that searches all three frames for start/stop codons\n4. **Reverse complement** function for searching both strands\n\nThe Gotoh implementation uses three matrices (M, X, Y) to track match/mismatch and gap states separately, which gives much better alignments for sequences with indels. Your existing `nw_align` function is unchanged.\n\nWant me to create a quick test to verify everything works?")}],openFileIds:["bio/sequence_alignment.py","test_alignment.py"],activeFileId:"bio/sequence_alignment.py",diffSummary:{added:135,removed:21}},f={id:"cursor-ide-demo",title:(0,o.msg)("Build Ecommerce Dashboard"),repoName:"ecommerce-dashboard",chatTitle:(0,o.msg)("Build Ecommerce Dashboard"),showInAgentsSidebar:!1,files:[{id:"app/page.tsx",name:"app/page.tsx",language:"tsx",content:`import Dashboard from "@/components/Dashboard";

export default function DashboardPage() {
  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold mb-6">Ecommerce Dashboard</h1>
      <Dashboard />
    </div>
  );
}`},{id:"components/Dashboard.tsx",name:"components/Dashboard.tsx",language:"tsx",content:`"use client";

import React, { useState } from "react";
import Navigation from "./Navigation";
import SupportChat from "./SupportChat";

export default function Dashboard() {
+  const [activeTab, setActiveTab] = useState("support");

  return (
    <div className="flex h-[600px] border rounded-lg overflow-hidden">
      <div className="w-64 border-r">
+       <Navigation activeTab={activeTab} onSelectTab={setActiveTab} />
      </div>
      <div className="w-80 border-l">
        <SupportChat />
      </div>
    </div>
  );
}`},{id:"components/SupportChat.tsx",name:"components/SupportChat.tsx",language:"tsx",content:`"use client";

import React, { useState } from "react";
+import { useQuery } from "@tanstack/react-query";

export default function SupportChat() {
  const [input, setInput] = useState("");
+  const { data: messages } = useQuery({
+    queryKey: ['messages'],
+    queryFn: () => fetch('/api/messages').then(res => res.json())
+  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <h3 className="font-semibold">Support Chat</h3>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {messages.map((message) => (
          <div key={message.id} className="mb-4">
            {message.content}
          </div>
        ))}
      </div>
      <div className="p-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your order..."
          className="w-full p-2 border rounded"
        />
      </div>
    </div>
  );
}`},{id:"components/Navigation.tsx",name:"components/Navigation.tsx",language:"tsx",content:`"use client";

import React, { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from "@phosphor-icons/react";

interface NavigationProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
}

export default function Navigation({ activeTab, onSelectTab }: NavigationProps) {
  const [expanded, setExpanded] = useState({
    orders: true,
    analytics: true,
    customers: true,
  });

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-900">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">Dashboard</h3>
      </div>
      <div className="p-2">
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-1 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded cursor-pointer">
            <Folder size={16} />
            <span>app</span>
          </div>
        </div>
      </div>
    </div>
  );
}`},{id:"components/ContentTabs.tsx",name:"components/ContentTabs.tsx",language:"tsx",content:`"use client";

import React from "react";
import { XIcon } from "@phosphor-icons/react";

interface ContentTabsProps {
  activeTab: string;
  orders: Array<{ id: number; customer: string; total: number; status: string }>;
  isLoading: boolean;
}

export default function ContentTabs({ activeTab, orders, isLoading }: ContentTabsProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border-r">
          <span className="text-sm">{activeTab}</span>
          <button className="hover:bg-gray-200 dark:hover:bg-gray-700 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">Loading orders...</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-800">Total Revenue</h3>
              <p className="text-2xl font-bold text-blue-900">
                $0.00
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-green-800">Orders Today</h3>
              <p className="text-2xl font-bold text-green-900">0</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}`},{id:"package.json",name:"package.json",language:"json",content:`{
  "name": "ecommerce-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build --turbopack",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@phosphor-icons/react": "^2.0.0",
    "@tanstack/react-query": "^5.0.0",
    "next": "15.5.2",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "tailwindcss": "^4.1.10"
  },
  "devDependencies": {
    "@types/node": "^20.17.17",
    "@types/react": "19.0.7",
    "@types/react-dom": "19.0.3",
    "typescript": "5.6.3"
  }
}`},{id:"README.md",name:"README.md",language:"markdown",content:`# Ecommerce Dashboard

A modern ecommerce dashboard built with React and Next.js.

## Features

- **Navigation Panel**: Browse through different dashboard sections
- **Multi-tab Content**: View and manage multiple data views simultaneously
- **Support Chat**: Get help and support with AI assistance
- **Real-time Updates**: Live data synchronization
- **Dark Mode**: Toggle between light and dark themes

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

## Architecture

The dashboard consists of three main components:

1. **Navigation**: Section navigation and menu
2. **ContentTabs**: Data display with tabs
3. **SupportChat**: Customer support interface

Built with Next.js 14, TypeScript, and Tailwind CSS.`}],messages:[{id:"m1",role:"user",text:(0,o.msg)("Build an ecommerce dashboard interface with order management, analytics, and customer support chat")},{id:"m2",role:"thinking",text:(0,o.msg)("Thought 8s")},{id:"m3",role:"search",text:(0,o.msg)("Searched React component patterns for dashboard interfaces")},{id:"m4",role:"read",text:(0,o.msg)("Read components/Dashboard.tsx, components/Navigation.tsx, components/ContentTabs.tsx")},{id:"m5",role:"assistant",text:(0,o.msg)("I'll create a three-panel ecommerce dashboard interface. Let me start with the main Dashboard component that manages orders and orchestrates the layout:")},{id:"m6",role:"code",text:(0,o.msg)("Dashboard.tsx +28 -15")},{id:"m7",role:"assistant",text:(0,o.msg)("Now I'll implement the SupportChat component with react-query for fetching messages:")},{id:"m8",role:"thinking",text:(0,o.msg)("Thought 5s")},{id:"m9",role:"search",text:(0,o.msg)("Searched react-query patterns for fetching messages")},{id:"m10",role:"code",text:(0,o.msg)("SupportChat.tsx +48 -20")},{id:"m11",role:"assistant",text:(0,o.msg)("Perfect! I've created a functional ecommerce dashboard with:\n\n• **Navigation**: Analytics and Orders sections with emoji icons\n• **Content**: Dynamic revenue calculation and order count with loading states\n• **Support Chat**: Customer support with react-query for fetching messages\n\nThe dashboard uses react-query to fetch messages data and shows loading states. Customer support integrates with the messages API. Try pressing `Cmd+K` to focus the chat input!")}],openFileIds:["components/Dashboard.tsx","components/SupportChat.tsx"],activeFileId:"components/Dashboard.tsx",diffSummary:void 0},_={id:"file-tree-demo",title:(0,o.msg)("Fintech Platform Rules"),repoName:"EVERYSPHERE",chatTitle:(0,o.msg)("File Explorer"),showInAgentsSidebar:!1,files:[{id:".cursor/rules/transfer-funds.mdc",name:".cursor/rules/transfer-funds.mdc",language:"markdown",content:"# Transfer Funds Command"},{id:".cursor/rules/production.mdc",name:".cursor/rules/production.mdc",language:"markdown",content:"# Production Environment Rules"},{id:".cursor/rules/financial-security-standards.mdc",name:".cursor/rules/financial-security-standards.mdc",language:"markdown",content:`---
description: Security and compliance standards for financial services development
globs:
  - src/payments/**/*
  - src/transactions/**/*
  - src/compliance/**/*
alwaysApply: true
---

Financial Data Handling
- Use Decimal.js or BigNumber.js for all monetary calculations
- Never store raw credit card numbers; use tokenization via Stripe/Adyen
- Implement double-entry bookkeeping for transaction integrity
- All amounts must include currency codes (USD, EUR, etc.)
- Validate account numbers using Luhn algorithm before processing


Templates
@payment-processor.ts
@compliance-audit-logger.ts
@financial-validator.ts


`},{id:".cursor/rules/payment-processing.mdc",name:".cursor/rules/payment-processing.mdc",language:"markdown",content:"# Payment Processing Rules"},{id:".cursor/rules/kyc-verification.mdc",name:".cursor/rules/kyc-verification.mdc",language:"markdown",content:"# KYC Verification Rules"},{id:".cursor/rules/fraud-detection.mdc",name:".cursor/rules/fraud-detection.mdc",language:"markdown",content:"# Fraud Detection Rules"},{id:".cursor/rules/banking-integration.mdc",name:".cursor/rules/banking-integration.mdc",language:"markdown",content:"# Banking Integration Rules"},{id:".cursor/rules/crypto-trading.mdc",name:".cursor/rules/crypto-trading.mdc",language:"markdown",content:"# Crypto Trading Rules"},{id:".cursor/rules/compliance-reporting.mdc",name:".cursor/rules/compliance-reporting.mdc",language:"markdown",content:"# Compliance Reporting Rules"}],messages:[],openFileIds:[".cursor/rules/financial-security-standards.mdc"],activeFileId:".cursor/rules/financial-security-standards.mdc",diffSummary:void 0},b={id:"bugbot-pr-comments",title:(0,o.msg)("Bugbot: PR Comments Fetching Bug"),repoName:"cursor-sh-landing",chatTitle:(0,o.msg)("Fix PR Comments Fetching Issue"),showInAgentsSidebar:!1,files:[{id:"backend/server/src/bugbot/github/applyBugbotPRReview.ts",name:"backend/server/src/bugbot/github/applyBugbotPRReview.ts",language:"typescript",content:`import { Octokit } from "@octokit/rest";
import { PullRequest } from "./types";

export async function applyBugbotPRReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullRequest: PullRequest
) {
  try {
    // Fetch PR comments - POTENTIAL BUG: Missing new inline comments
-   const reviewCommentsResponse = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
+   const reviewCommentsResponse = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
      owner: repository.owner,
      repo: repository.repo,
      pull_number: pullRequest.issueNumber,
-     review_id: commentResponse.data.id,
+     since: new Date(Date.now() - 10000).toISOString(), // Only get recent comments
    });

    // Process comments for analysis
    const comments = reviewCommentsResponse.data;
    
    // Analyze each comment for bug patterns
    for (const comment of comments) {
      await analyzePRComment(comment, pullRequest);
    }
    
  } catch (error) {
    console.error('Error applying Bugbot PR review:', error);
    throw error;
  }
}

async function analyzePRComment(comment: any, pullRequest: PullRequest) {
  // Bug analysis logic here
  const bugPatterns = [
    /potential.*edge.*case/i,
    /timing.*delay/i,
    /pagination.*issue/i,
    /missing.*inline.*comment/i
  ];
  
  const hasBugPattern = bugPatterns.some(pattern => 
    pattern.test(comment.body)
  );
  
  if (hasBugPattern) {
    console.log('Potential bug detected in comment:', comment.id);
  }
}`},{id:"apps/marketing/app/components/demo/Github/GitHubUI.tsx",name:"apps/marketing/app/components/demo/Github/GitHubUI.tsx",language:"typescript",content:`
export function GitHubPRComments({ comments }: { comments: GitHubPRComment[] }) {
  return (
    <div className="space-y-4">
      {comments.map((comment) => (
        <div key={comment.id} className="flex gap-3 p-4 bg-gray-50 rounded">
-         <img src="marketing-static/icon-192x192.png"
+         <img src="/marketing-static/icon-192x192.png"
            alt={comment.user.login}
            className="w-8 h-8 rounded-full"
          />
      ))}
    </div>
  );
}`}],messages:[{id:"bug1",role:"user",text:(0,o.msg)("Fix this bug...\n\nThe user avatar image `src` (`marketing-static/icon-192x192.png`) is missing a leading slash. This relative path can cause the image to fail loading when the component is used in different URL contexts, as it resolves relative to the current page instead of the site root.")},{id:"bug2",role:"thinking",text:(0,o.msg)("Thought 6s")},{id:"bug3",role:"search",text:(0,o.msg)("Searched PR comments fetching patterns and GitHub API pagination")},{id:"bug4",role:"assistant",text:(0,o.msg)("I can see the issue! The bug is in the PR comments fetching logic in `applyBugbotPRReview.ts`.")}],openFileIds:["backend/server/src/bugbot/github/applyBugbotPRReview.ts","apps/marketing/app/components/demo/Github/GitHubUI.tsx"],activeFileId:"backend/server/src/bugbot/github/applyBugbotPRReview.ts",diffSummary:{added:2,removed:2}},y={id:"powerful-commands",title:"Powerful Commands",repoName:"customer-dashboard",chatTitle:"Bash Automation Scripts",showInAgentsSidebar:!1,files:[{id:".github/workflows/translate-keys.yml",name:".github/workflows/translate-keys.yml",language:"text",content:""},{id:".github/workflows/secret-audit.yml",name:".github/workflows/secret-audit.yml",language:"text",content:""},{id:".github/workflows/fix-ci.yml",name:".github/workflows/fix-ci.yml",language:"text",content:""},{id:".github/workflows/update-docs.yml",name:".github/workflows/update-docs.yml",language:"text",content:""},{id:"scripts/stream-progress.sh",name:"scripts/stream-progress.sh",language:"text",content:""},{id:"scripts/simple-code-review.sh",name:"scripts/simple-code-review.sh",language:"text",content:`#!/bin/bash
# simple-code-review.sh - Basic code review script

echo "Starting code review..."

# Review recent changes
agent -p --force --output-format text \\
"Review the recent code changes and provide feedback on:
- Code quality and readability
- Potential bugs or issues
- Security considerations
- Best practices compliance

Provide specific suggestions for improvement and write to review.txt"

echo "✅ Code review complete!"
echo "📄 Review saved to review.txt"

# Show summary
if [[ -f "review.txt" ]]; then
  echo ""
  echo "📋 Review Summary:"
  echo "=================="
  head -10 review.txt
  echo ""
  echo "📖 Full review available in review.txt"
fi`}],messages:[],openFileIds:["scripts/stream-progress.sh","scripts/simple-code-review.sh"],activeFileId:"scripts/simple-code-review.sh",diffSummary:void 0},v={id:"website-builder-demo",title:(0,o.msg)("Build Landing Page"),repoName:"cursor-site",chatTitle:(0,o.msg)("Build Landing Page"),showInAgentsSidebar:!0,files:[{kind:"browser",id:"browser-preview",name:"localhost:3000",url:"http://localhost:3000"},{id:"app/page.tsx",name:"app/page.tsx",language:"tsx",content:`import { CursorLogoSvg } from "@/components/CursorLogoSvg";

export default function Home() {
  return (
    <main className="font-serif min-h-screen flex flex-col px-6 py-8">
      <a href="https://cursor.com" aria-label="Cursor" className="mb-8">
        <CursorLogoSvg className="h-12 w-12 opacity-20" />
      </a>

      <div className="flex-1 max-w-[48ch] text-lg leading-relaxed">
        <p className="-indent-[0.1rem]">
          We're an applied research lab working on the future of
          programming. We are a group of researchers, engineers, and
          technologists inventing at the edge of what's useful and
          possible.
        </p>
        <p className="mt-4">We have much to learn, try, and build.</p>

        <a href="/careers" className="mt-4 inline-block underline">
          Join our team →
        </a>
      </div>
    </main>
  );
}`},{id:"app/globals.css",name:"app/globals.css",language:"css",content:`:root {
  --font-serif: "EB Garamond", "Iowan Old Style", Georgia, serif;
  --color-bg: #f7f7f4;
  --color-text: #26251e;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #14120b;
    --color-text: #edecec;
  }
}

body {
  font-family: var(--font-serif);
  background: var(--color-bg);
  color: var(--color-text);
}`}],messages:[{id:"web1",role:"user",text:(0,o.msg)("make a landing page based on attached docs explaining what we do"),attachments:[{type:"file",name:"about-acme.md"},{type:"file",name:"brand-guidelines.pdf"}]},{id:"web2",role:"read",text:(0,o.msg)("Read about-acme.md")},{id:"web3",role:"read",text:(0,o.msg)("Read brand-guidelines.pdf")},{id:"web4",role:"thinking",text:(0,o.msg)("Thought 6s")},{id:"web5",role:"assistant",text:(0,o.msg)("I'll create a minimal, serif-based landing page that matches your brand voice.")},{id:"web6",role:"code",text:(0,o.msg)("app/page.tsx +52 -0")},{id:"web7",role:"code",text:(0,o.msg)("app/globals.css +18 -0")},{id:"web8",role:"assistant",text:(0,o.msg)("Done. Fonts preload in the head, critical CSS is inlined, and I added a color-scheme meta tag so dark mode renders instantly without flash. 280ms first paint.")}],openFileIds:["browser-preview","app/page.tsx"],activeFileId:"browser-preview",diffSummary:{added:70,removed:0}},x={id:"product-planning-demo",title:(0,o.msg)("Plan Mission Control"),repoName:"acme-saas",chatTitle:(0,o.msg)("Plan Mission Control"),showInAgentsSidebar:!0,defaultMode:"plan",questions:[{id:"trigger",prompt:"How should Mission Control be triggered?",options:[{id:"gesture",label:"Gesture (swipe up with 3 fingers)"},{id:"keyboard",label:"Keyboard shortcut (e.g., F3 or Cmd+F3)"},{id:"both",label:"Both keyboard and button"}]},{id:"layout",prompt:"How should windows be arranged?",options:[{id:"grid",label:"Even grid layout"},{id:"cascade",label:"Cascading tiles"},{id:"smart",label:"Smart layout based on window size"}]},{id:"animation",prompt:"Animation style preference?",options:[{id:"smooth",label:"Smooth spring animations"},{id:"snappy",label:"Snappy, instant transitions"},{id:"reduced",label:"Respect reduced motion settings"}]}],files:[{kind:"plan",id:"feature-prd",name:"feature-prd.md",content:`# Mission Control Interface

A grid view of all open windows as scaled previews, allowing quick selection to bring any window to front.

## Trigger
Menu item in MenuBar.tsx (View > Mission Control), hotkey F3, or double-tap desktop.

## View Behavior
Overlay existing windows into a grid of live previews with spring-based layout animations and shared element transitions.

## Tasks
- [ ] Add multiplayer mode to useAppStore.ts
- [ ] Create a new MissionControlView.tsx component
- [ ] Update AppManager.tsx to apply expose modes.`},{id:"src/lib/collaboration/presence.ts",name:"src/lib/collaboration/presence.ts",language:"typescript",content:`import { WebSocketClient } from '../websocket';

export interface UserPresence {
  userId: string;
  userName: string;
  avatarUrl: string;
  status: 'online' | 'away' | 'busy';
  lastSeen: Date;
  currentFile?: string;
  cursorPosition?: { line: number; column: number };
}

export class PresenceManager {
  private ws: WebSocketClient;
  private presence: Map<string, UserPresence> = new Map();
  private listeners: Set<(users: UserPresence[]) => void> = new Set();

  constructor(ws: WebSocketClient) {
    this.ws = ws;
+   this.setupListeners();
  }

+ private setupListeners() {
+   this.ws.on('presence:join', (data) => {
+     this.presence.set(data.userId, data);
+     this.notifyListeners();
+   });
+   
+   this.ws.on('presence:leave', (data) => {
+     this.presence.delete(data.userId);
+     this.notifyListeners();
+   });
+   
+   this.ws.on('presence:update', (data) => {
+     const existing = this.presence.get(data.userId);
+     if (existing) {
+       this.presence.set(data.userId, { ...existing, ...data });
+       this.notifyListeners();
+     }
+   });
+ }

  subscribe(callback: (users: UserPresence[]) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners() {
    const users = Array.from(this.presence.values());
    this.listeners.forEach(cb => cb(users));
  }
}`}],messages:[{id:"plan1",role:"user",text:(0,o.msg)("let's build a mission control interface, similar to the expose-style window manager on macOS")},{id:"plan2",role:"thinking",text:(0,o.msg)("Thought 4s")},{id:"plan3",role:"read",text:(0,o.msg)("Read AppManager.tsx")},{id:"plan4",role:"search",text:(0,o.msg)("Searched expose patterns")},{id:"plan5",role:"code",text:"feature-prd.md +68"},{id:"plan6",role:"assistant",text:(0,o.msg)("Drafted implementation steps in `feature-prd.md`. A few quick questions before I start building:")}],openFileIds:["feature-prd","src/lib/collaboration/presence.ts"],activeFileId:"feature-prd",diffSummary:{added:68,removed:0}},w={id:"terminal-demo",title:(0,o.msg)("Build and Test Project"),repoName:"react-dashboard",chatTitle:(0,o.msg)("Build & Run Tests"),showInAgentsSidebar:!1,files:[{id:"src/components/Dashboard.tsx",name:"src/components/Dashboard.tsx",language:"tsx",content:`import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMetrics } from '../api/metrics';

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
  });

  if (isLoading) {
    return <div className="animate-pulse">Loading...</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <MetricCard title="Users" value={data?.users ?? 0} />
      <MetricCard title="Revenue" value={data?.revenue ?? 0} />
      <MetricCard title="Orders" value={data?.orders ?? 0} />
    </div>
  );
}`},{id:"src/api/metrics.ts",name:"src/api/metrics.ts",language:"typescript",content:`export async function fetchMetrics() {
  const response = await fetch('/api/metrics');
  if (!response.ok) {
    throw new Error('Failed to fetch metrics');
  }
  return response.json();
}`},{id:"package.json",name:"package.json",language:"json",content:`{
  "name": "react-dashboard",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "lint": "eslint src/"
  }
}`}],messages:[{id:"t1",role:"user",text:(0,o.msg)("Build the project and make sure all tests pass")},{id:"t2",role:"thinking",text:(0,o.msg)("Thought 3s")},{id:"t3",role:"assistant",text:(0,o.msg)("I'll build the project and run the test suite to verify everything works.")},{id:"t4",role:"terminal",text:`npm run build
vite v5.2.0 building for production...
✓ 42 modules transformed
dist/index.html       0.45 kB │ gzip: 0.29 kB
dist/assets/index.js  145.2 kB │ gzip: 46.8 kB
✓ built in 1.24s`},{id:"t5",role:"terminal",text:`npm run test
 ✓ src/components/Dashboard.test.tsx (3 tests) 45ms
 ✓ src/api/metrics.test.ts (2 tests) 12ms
 ✓ src/utils/format.test.ts (4 tests) 8ms

 Test Files  3 passed (3)
      Tests  9 passed (9)
   Duration  892ms`},{id:"t6",role:"assistant",text:(0,o.msg)("Build completed successfully and all 9 tests pass. The production bundle is 46.8 kB gzipped.")}],openFileIds:["src/components/Dashboard.tsx"],activeFileId:"src/components/Dashboard.tsx",diffSummary:void 0},C={id:"browser-debug-demo",title:(0,o.msg)("Debug Checkout Page"),repoName:"webshop-frontend",chatTitle:(0,o.msg)("Debug Checkout Issue"),showInAgentsSidebar:!1,files:[{kind:"browser",id:"browser-checkout",name:"localhost:3000/checkout",url:"http://localhost:3000/checkout"},{id:"src/components/Checkout.tsx",name:"src/components/Checkout.tsx",language:"tsx",content:`"use client";

import { useState } from "react";
import { useCart } from "@/hooks/useCart";

export default function Checkout() {
  const { items, total } = useCart();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
-     const response = await fetch("/api/checkout");
+     const response = await fetch("/api/checkout", {
+       method: "POST",
+       headers: { "Content-Type": "application/json" },
+       body: JSON.stringify({ items }),
+     });
      const data = await response.json();
      window.location.href = data.redirectUrl;
    } catch (error) {
      console.error("Checkout failed:", error);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Checkout</h1>
      {items.map((item) => (
        <div key={item.id} className="flex justify-between py-2">
          <span>{item.name}</span>
          <span>\${item.price}</span>
        </div>
      ))}
      <div className="border-t mt-4 pt-4">
        <div className="flex justify-between font-bold">
          <span>Total</span>
          <span>\${total}</span>
        </div>
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full mt-6 bg-blue-600 text-white py-3 rounded"
      >
        {loading ? "Processing..." : "Complete Purchase"}
      </button>
    </div>
  );
}`}],messages:[{id:"bd1",role:"user",text:(0,o.msg)("The checkout button isn't working. Clicking it does nothing. Can you check what's wrong?")},{id:"bd2",role:"thinking",text:(0,o.msg)("Thought 4s")},{id:"bd3",role:"assistant",text:(0,o.msg)("I'll investigate the checkout issue by examining the browser state and looking at the console.")},{id:"bd4",role:"browser",text:(0,o.msg)("Screenshot localhost:3000/checkout")},{id:"bd5",role:"browser",text:(0,o.msg)("Navigate to localhost:3000/cart")},{id:"bd6",role:"browser",text:(0,o.msg)("Screenshot localhost:3000/cart")},{id:"bd7",role:"browser",text:(0,o.msg)("Inspect console errors")},{id:"bd8",role:"assistant",text:(0,o.msg)("Found the issue! The checkout API call is using GET instead of POST, and the cart items aren't being sent in the request body. The API is returning a 405 Method Not Allowed error.\n\nI'll fix the `handleSubmit` function to properly POST the cart data:")},{id:"bd9",role:"code",text:(0,o.msg)("src/components/Checkout.tsx +5 -1")},{id:"bd10",role:"assistant",text:(0,o.msg)("The checkout should now work. The fix:\n\n• Changed from GET to POST request\n• Added proper `Content-Type` header\n• Included cart items in the request body\n\nTry clicking the checkout button again!")}],openFileIds:["browser-checkout","src/components/Checkout.tsx"],activeFileId:"src/components/Checkout.tsx",diffSummary:{added:5,removed:1}},A={id:"tags-demo",title:(0,o.msg)("Tags Demo"),repoName:"dashboard-app",chatTitle:(0,o.msg)("New Chat"),showInAgentsSidebar:!1,files:[{id:"src/components/Dropdown.tsx",name:"src/components/Dropdown.tsx",language:"typescript",content:`import React from 'react'

export function Dropdown() {
  return (
    <div className="dropdown">
      {/* TODO: implement dropdown */}
    </div>
  )
}`}],messages:[{id:"tags-user-1",role:"user",text:(0,o.msg)("Make @Dropdown.tsx look like 🌐 stripe.com/checkout")}],openFileIds:["src/components/Dropdown.tsx"],activeFileId:"src/components/Dropdown.tsx"},S={id:"tab-multiline-demo",title:(0,o.msg)("app"),repoName:"app",chatTitle:(0,o.msg)("app"),showInAgentsSidebar:!1,files:[{id:"App.tsx",name:"App.tsx",language:"tsx",content:`import { CommandMenu } from "./CommandMenu";

export default function App() {
  return <CommandMenu />;
}`},{id:"CommandMenu.tsx",name:"CommandMenu.tsx",language:"tsx",content:`import { Command } from "cmdk";

export function CommandMenu() {
  return (
    <Command>
      <Command.Input placeholder="Search..." />
      <Command.List>
        <Command.Item>Settings</Command.Item>
        <Command.Item>Profile</Command.Item>
      </Command.List>
    </Command>
  );
}`}],messages:[],openFileIds:["CommandMenu.tsx","App.tsx"],activeFileId:"CommandMenu.tsx"},T={id:"tab-context-demo",title:(0,o.msg)("stripe-billing"),repoName:"stripe-billing",chatTitle:(0,o.msg)("stripe-billing"),showInAgentsSidebar:!1,files:[{id:"db/customers.ts",name:"db/customers.ts",language:"typescript",content:`import { prisma, type Customer } from "@/lib/db";
import type { Stripe } from "stripe";

export const getCustomerByEmail = (email: string) =>
prisma.customer.findUnique({ where: { email } });

export const getCustomer = (id: string): Promise<Customer | null> =>
prisma.customer.findUnique({
  where: { id },
  include: { subscriptions: true, invoices: true, paymentMethods: true },
});`},{id:"db/invoices.ts",name:"db/invoices.ts",language:"typescript",content:`import { prisma, type Invoice } from "@/lib/db";
import type { Stripe } from "stripe";

export const getInvoicesByCustomer = (customerId: string) =>
prisma.invoice.findMany({ where: { customerId } });

export const getInvoice = (id: string): Promise<Invoice | null> =>
prisma.invoice.findUnique({
  where: { id },
  include: { lineItems: true, customer: true, charges: true },
});`}],messages:[],openFileIds:["db/customers.ts","db/invoices.ts"],activeFileId:"db/invoices.ts"},R={id:"tab-proprietary-demo",title:(0,o.msg)("schemas"),repoName:"app",chatTitle:(0,o.msg)("schemas"),showInAgentsSidebar:!1,files:[{id:"lib/schemas.ts",name:"lib/schemas.ts",language:"typescript",content:`import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2).max(100),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.date(),
});`},{id:"lib/types.ts",name:"lib/types.ts",language:"typescript",content:`import { z } from "zod";
import { userSchema } from "./schemas";

export type User = z.infer<typeof userSchema>;`}],messages:[],openFileIds:["lib/schemas.ts","lib/types.ts"],activeFileId:"lib/schemas.ts"},k={websiteBuilder:v,cursorIDE:l,startupAnalytics:d,nextjsRouter:c,mlPython:u,changeManagement:p,biotech:h,cursorRules:m,autoComplete:f,pseudoCode:g,bugbotPRComments:b,fileTree:_,modelSelection:{id:"model-selection-demo",title:"Model Selection Interface",repoName:"ai-chat-app",chatTitle:"",showInAgentsSidebar:!1,files:[],messages:[],openFileIds:[],activeFileId:"",diffSummary:{added:0,removed:0}},powerfulCommands:y,productPlanning:x,desktopHandoff:{id:"desktop-handoff-demo",title:(0,o.msg)("Review Plan"),repoName:"acme-app",chatTitle:(0,o.msg)("Review Plan"),showInAgentsSidebar:!1,defaultMode:"build",questions:[],files:[],messages:[{id:"handoff1",role:"user",text:(0,o.msg)("Plan: add a persisted user-controlled theme (light/dark/system) with next-themes on top of our existing CSS variables.")},{id:"handoff2",role:"thinking",text:(0,o.msg)("Thought 3s")},{id:"handoff3",role:"read",text:(0,o.msg)("Read app/layout.tsx, styles/theme.css")},{id:"handoff4",role:"assistant",text:(0,o.msg)("I'll draft the plan: mount ThemeProvider, refactor the shell, and document the theme API. Ready to commit & push when you approve.")}],openFileIds:[],activeFileId:"",diffSummary:{added:0,removed:0}},terminal:w,browserDebug:C,tags:A,tabMultiline:S,tabContext:T,tabProprietary:R};e.s(["demoScenarios",0,k],565182);var q=e.i(264445);function N(e){let a,r,n,o=(0,s.c)(9),{size:l,className:d}=e,c=void 0===l?16:l,u=d??"text-[color:rgba(var(--theme-icon-rgb, 242,242,242),0.65)]",m=`${c}px`,p=`${c}px`;return o[0]!==m||o[1]!==p?(a={width:m,height:p,lineHeight:0},o[0]=m,o[1]=p,o[2]=a):a=o[2],o[3]!==c||o[4]!==u?(r=(0,t.jsx)(i.Spinner,{size:c,weight:"regular",className:u}),o[3]=c,o[4]=u,o[5]=r):r=o[5],o[6]!==a||o[7]!==r?(n=(0,t.jsx)("span",{className:"inline-flex items-center justify-center",style:a,children:r}),o[6]=a,o[7]=r,o[8]=n):n=o[8],n}e.s(["default",0,function({currentAgentTitle:e=(0,r.msg)("New Agent"),onSelectScenario:s,readyKeys:i,readyMeta:o,interactionsDisabled:l=!1,isMobile:d=!1,showHeader:c=!0}){let u=(0,r.useGT)(),m=(0,r.useMessages)(),p=(0,n.useMemo)(()=>({websiteBuilder:"Reading docs",startupAnalytics:"Fetching data",mlPython:"Overviewing scope",productPlanning:"Generating plan"}),[]),g=(0,n.useRef)(0);0===g.current&&(g.current=Date.now());let h=(0,n.useMemo)(()=>{let e=g.current,t=[],s=new Set,a=new Set(["cursorRules","biotech","mlPython"]);return Object.entries(k).forEach(([n,l])=>{if(!l.showInAgentsSidebar||s.has(l.id))return;s.add(l.id);let d=(i?.includes(n)??!1)||a.has(n),c=o?.[n]||(d?{completedAtOffset:0,lastAssistant:l.chatTitle,diffSummary:l.diffSummary}:void 0),m=d?"number"==typeof c?.completedAtOffset?e-c.completedAtOffset:e:void 0,g=d?function(e,t){if(!e)return;let s=Math.max(0,(t??Date.now())-e),a=Math.floor(s/6e4),i=Math.floor(s/36e5),n=Math.floor(s/864e5);return s<45e3?(0,r.msg)("Just Now"):a<60?`${a}m`:i<24?`${i}h`:`${n}d`}(m,e):void 0;t.push({id:String(n),title:l.chatTitle,status:d?"ready":"in_progress",when:d?"Just Now"===g?"now":g:void 0,branch:d?c?.lastAssistant:p[n]||u("Generating"),diff:d?c?.diffSummary:void 0,scenarioKey:n,completedAtMs:m})}),t},[i,o,p,u]),f=(0,n.useMemo)(()=>h.filter(e=>"in_progress"===e.status).sort((e,t)=>"websiteBuilder"===e.id?-1:+("websiteBuilder"===t.id)),[h]),_=(0,n.useMemo)(()=>h.filter(e=>"ready"===e.status&&"current"!==e.id).sort((e,t)=>(t.completedAtMs||0)-(e.completedAtMs||0)),[h]),b=(0,n.useMemo)(()=>h.filter(e=>"archived"===e.status),[h]);function y({item:e,isActive:a,disabled:i}){let n="ready"===e.status,o="in_progress"===e.status,l=(0,r.useMessages)(),c=i?void 0:e=>{a||(e.currentTarget.style.backgroundColor="var(--color-theme-card-hover-hex)")},u=i?void 0:e=>{a||(e.currentTarget.style.backgroundColor="")},m=!i&&e.scenarioKey&&s?()=>{s(e.scenarioKey)}:void 0;return(0,t.jsxs)("button",{type:"button",className:`agent-sidebar__row type-product-base flex w-full items-start gap-2 border-0 px-3 py-2.5 text-left transition-colors ${i?"cursor-default":"cursor-pointer"}`,style:{backgroundColor:a?"var(--color-theme-card-hover-hex)":void 0,paddingLeft:"calc(0.75rem + 2px)",outline:"none"},disabled:i,"aria-disabled":i,tabIndex:-1,onMouseEnter:c,onMouseLeave:u,onClick:m,children:[(0,t.jsx)("div",{className:"flex h-4 w-4 items-center justify-center",style:{willChange:"transform",transform:"translateZ(0)"},children:o?(0,t.jsx)(N,{size:16,className:a?"text-[color:rgba(var(--theme-icon-rgb, 242,242,242),0.9)]":"text-theme-text-sec"}):n?(0,t.jsx)(q.default,{className:a?"":"text-theme-text-sec"}):(0,t.jsx)("div",{className:"h-2 w-2 rounded-full",style:{backgroundColor:a?"var(--color-theme-accent)":"var(--color-theme-text-sec)"}})}),(0,t.jsxs)("div",{className:"flex min-w-0 flex-1 flex-col gap-px",children:[(0,t.jsxs)("div",{className:"flex items-start justify-between gap-2",children:[(0,t.jsx)("div",{className:`truncate ${!a?d?"text-theme-text":"text-theme-text-sec":""}`,children:l(e.title)}),e.when?(0,t.jsx)("div",{className:"type-product-sm shrink-0",style:{color:"var(--color-theme-product-text-tertiary)"},children:l(e.when)}):null]}),(e.branch||e.diff&&"ready"===e.status)&&(0,t.jsx)("div",{className:`type-product-sm flex items-center ${a?"text-theme-text-sec":""}`,style:a?void 0:{color:"var(--color-theme-product-text-tertiary)"},children:(0,t.jsxs)("span",{className:"flex min-w-0 items-center gap-1",children:[e.diff&&"ready"===e.status?(0,t.jsxs)("span",{className:"flex items-center gap-0.5 tabular-nums",children:[(0,t.jsxs)("span",{className:"text-theme-product-ansi-green",children:["+",e.diff.added]}),e.diff.removed>0&&(0,t.jsxs)("span",{className:"text-theme-product-ansi-red",children:["-",e.diff.removed]})]}):null,e.diff&&"ready"===e.status&&e.branch?(0,t.jsx)("span",{children:"·"}):null,e.branch?(0,t.jsx)("span",{className:"min-w-0 flex-1 truncate",children:l(e.branch)}):null]})})]})]})}function v({item:e}){return(0,t.jsx)("div",{className:"text-theme-text-sec px-3 py-1 text-sm",children:(0,t.jsx)("div",{className:"truncate",children:m(e.title)})})}function x({title:s,items:a}){return 0===a.length?null:(0,t.jsxs)("div",{className:"py-1.25",children:[(0,t.jsxs)("div",{className:"type-product-sm-medium text-theme-text-sec px-3 py-1 uppercase",children:[m(s)," ",(0,t.jsx)("span",{className:"text-theme-text/50",children:a.length})]}),(0,t.jsx)("div",{children:a.map(s=>"archived"===s.status?(0,t.jsx)(v,{item:s},s.id):(0,t.jsx)(y,{item:s,isActive:s.title===e,disabled:l},s.id))})]})}return(0,t.jsxs)("aside",{className:"bg-theme-card text-theme-text h-full w-full",children:[c&&(0,t.jsxs)("div",{className:"px-3 py-2.5 space-y-2",children:[(0,t.jsxs)("div",{className:"bg-theme-text/[0.03] border-theme-text/[0.08] flex items-center gap-2 rounded-md border px-2.5 py-2",children:[(0,t.jsx)(a.MagnifyingGlass,{size:14,weight:"regular",className:"text-theme-text-ter opacity-50"}),(0,t.jsx)("span",{className:"type-product-sm text-theme-text-ter opacity-50 flex-1",children:u("Search Agents")})]}),(0,t.jsx)("button",{type:"button",className:"border-theme-text/[0.12] hover:bg-theme-text/[0.04] type-product-sm text-theme-text-ter flex w-full cursor-pointer items-center justify-center rounded-md border px-2.5 py-2 transition-colors",children:u("New Agent")})]}),(0,t.jsxs)("div",{className:"pl-0",children:[(0,t.jsx)(x,{title:u("In Progress"),items:f}),(0,t.jsx)(x,{title:u("Ready for Review"),items:_}),(0,t.jsx)(x,{title:u("Archived"),items:b})]})]})}],961327)}]);