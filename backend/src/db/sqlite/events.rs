//! SQLite implementation of `EventRepo`.
//!
//! Two read paths into the same table:
//!   * `amounts_for_pace[_many]` — minimal `(amount, start_at)` projection,
//!     filtered to `status='accepted'` AND `subscription_id` matches. Both
//!     non-recurring rows and the expanded instances of recurring series
//!     contribute. Per-instance status overrides come from `event_exceptions`.
//!   * `list_for_subscription` / `list_in_range` / `fetch` — full rows for the
//!     API. `list_in_range` additionally expands recurring series and overlays
//!     exceptions.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::types::Json;
use sqlx::SqlitePool;

use crate::db::repo::{
    EventExceptionRow, EventRepo, EventRow, EventStatus, EventWithSubscriptionRow, EventWrite,
};
use crate::domain::lifecycle::UsageInput;
use crate::domain::recurrence::{expand_range, RecurrenceRule};
use crate::error::AppError;

const EVENT_COLUMNS: &str = "id, title, start_at, end_at, status, subscription_id, \
                              amount, notes, recurrence_rule, created_at, updated_at";

pub struct SqliteEventRepo {
    pool: SqlitePool,
}

impl SqliteEventRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EventRepo for SqliteEventRepo {
    async fn any_for_subscription(
        &self,
        group_id: &str,
        subscription_id: &str,
    ) -> Result<bool, AppError> {
        let row: Option<(i64,)> = sqlx::query_as(
            r#"SELECT 1 FROM events
               WHERE subscription_id = ?1 AND group_id = ?2 LIMIT 1"#,
        )
        .bind(subscription_id)
        .bind(group_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some())
    }

    async fn amounts_for_pace(
        &self,
        group_id: &str,
        subscription_id: &str,
    ) -> Result<Vec<UsageInput>, AppError> {
        let direct: Vec<(f64, DateTime<Utc>)> = sqlx::query_as(
            r#"
            SELECT amount, start_at
            FROM events
            WHERE subscription_id = ?1
              AND group_id = ?2
              AND status = 'accepted'
              AND amount IS NOT NULL
              AND recurrence_rule IS NULL
            "#,
        )
        .bind(subscription_id)
        .bind(group_id)
        .fetch_all(&self.pool)
        .await?;

        let mut out: Vec<UsageInput> = direct
            .into_iter()
            .map(|(amount, created_at)| UsageInput { amount, created_at })
            .collect();

        let parents =
            fetch_series_roots_for_subscription(&self.pool, group_id, subscription_id).await?;
        if parents.is_empty() {
            return Ok(out);
        }
        let parent_ids: Vec<String> = parents.iter().map(|p| p.id.clone()).collect();
        let exceptions = self.list_exceptions_for_parents(group_id, &parent_ids).await?;
        let by_parent = group_exceptions(exceptions);
        let now = Utc::now();
        for p in parents {
            let amount = match p.amount {
                Some(a) => a,
                None => continue,
            };
            let rule = match &p.recurrence_rule {
                Some(r) => &r.0,
                None => continue,
            };
            let starts = expand_range(p.start_at, rule, p.start_at, now);
            let exc_for_parent = by_parent.get(&p.id);
            for inst in starts {
                let inst_date = inst.date_naive();
                let effective_status = exc_for_parent
                    .and_then(|m| m.get(&inst_date))
                    .copied()
                    .unwrap_or(p.status);
                if effective_status == EventStatus::Accepted {
                    out.push(UsageInput {
                        amount,
                        created_at: inst,
                    });
                }
            }
        }
        Ok(out)
    }

    async fn amounts_for_pace_many(
        &self,
        group_id: &str,
        subscription_ids: &[String],
    ) -> Result<HashMap<String, Vec<UsageInput>>, AppError> {
        let mut out: HashMap<String, Vec<UsageInput>> =
            HashMap::with_capacity(subscription_ids.len());
        for id in subscription_ids {
            out.insert(id.clone(), Vec::new());
        }
        if subscription_ids.is_empty() {
            return Ok(out);
        }

        let placeholders = std::iter::repeat_n("?", subscription_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        // Placeholder positions: group_id first, then the IN list.
        let sql = format!(
            "SELECT subscription_id, amount, start_at \
             FROM events \
             WHERE status = 'accepted' \
               AND amount IS NOT NULL \
               AND recurrence_rule IS NULL \
               AND group_id = ? \
               AND subscription_id IN ({placeholders})"
        );
        let mut q = sqlx::query_as::<_, (String, f64, DateTime<Utc>)>(&sql).bind(group_id);
        for id in subscription_ids {
            q = q.bind(id);
        }
        for (sid, amount, created_at) in q.fetch_all(&self.pool).await? {
            out.entry(sid)
                .or_default()
                .push(UsageInput { amount, created_at });
        }

        let parents =
            fetch_series_roots_for_subscriptions(&self.pool, group_id, subscription_ids).await?;
        if parents.is_empty() {
            return Ok(out);
        }
        let parent_ids: Vec<String> = parents.iter().map(|p| p.id.clone()).collect();
        let exceptions = self.list_exceptions_for_parents(group_id, &parent_ids).await?;
        let by_parent = group_exceptions(exceptions);
        let now = Utc::now();
        for p in parents {
            let (amount, sid, rule) = match (
                p.amount,
                p.subscription_id.as_ref(),
                p.recurrence_rule.as_ref(),
            ) {
                (Some(a), Some(sid), Some(r)) => (a, sid.clone(), &r.0),
                _ => continue,
            };
            let starts = expand_range(p.start_at, rule, p.start_at, now);
            let exc_for_parent = by_parent.get(&p.id);
            let bucket = out.entry(sid).or_default();
            for inst in starts {
                let inst_date = inst.date_naive();
                let effective_status = exc_for_parent
                    .and_then(|m| m.get(&inst_date))
                    .copied()
                    .unwrap_or(p.status);
                if effective_status == EventStatus::Accepted {
                    bucket.push(UsageInput {
                        amount,
                        created_at: inst,
                    });
                }
            }
        }
        Ok(out)
    }

    async fn list_for_subscription(
        &self,
        group_id: &str,
        subscription_id: &str,
    ) -> Result<Vec<EventRow>, AppError> {
        let sql = format!(
            "SELECT {EVENT_COLUMNS} FROM events \
             WHERE subscription_id = ?1 AND group_id = ?2 \
             ORDER BY start_at DESC, id DESC"
        );
        let rows = sqlx::query_as::<_, EventRow>(&sql)
            .bind(subscription_id)
            .bind(group_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    /// Calendar range query. Left-joins `subscriptions` so each row carries
    /// the (optional) parent's name and tracking_mode in one round trip.
    async fn list_in_range(
        &self,
        group_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<EventWithSubscriptionRow>, AppError> {
        let non_recurring = sqlx::query_as::<_, EventWithSubscriptionRow>(
            r#"
            SELECT e.id              AS id,
                   e.title           AS title,
                   e.start_at        AS start_at,
                   e.end_at          AS end_at,
                   e.status          AS status,
                   e.subscription_id AS subscription_id,
                   s.name            AS subscription_name,
                   s.tracking_mode   AS tracking_mode,
                   e.amount          AS amount,
                   e.notes           AS notes,
                   e.recurrence_rule AS recurrence_rule,
                   e.created_at      AS created_at,
                   e.updated_at      AS updated_at
            FROM events AS e
            LEFT JOIN subscriptions AS s ON s.id = e.subscription_id
            WHERE e.start_at >= ?1 AND e.start_at < ?2
              AND e.group_id = ?3
              AND e.recurrence_rule IS NULL
            "#,
        )
        .bind(from)
        .bind(to)
        .bind(group_id)
        .fetch_all(&self.pool)
        .await?;

        let series_roots = sqlx::query_as::<_, EventWithSubscriptionRow>(
            r#"
            SELECT e.id              AS id,
                   e.title           AS title,
                   e.start_at        AS start_at,
                   e.end_at          AS end_at,
                   e.status          AS status,
                   e.subscription_id AS subscription_id,
                   s.name            AS subscription_name,
                   s.tracking_mode   AS tracking_mode,
                   e.amount          AS amount,
                   e.notes           AS notes,
                   e.recurrence_rule AS recurrence_rule,
                   e.created_at      AS created_at,
                   e.updated_at      AS updated_at
            FROM events AS e
            LEFT JOIN subscriptions AS s ON s.id = e.subscription_id
            WHERE e.start_at < ?1
              AND e.group_id = ?2
              AND e.recurrence_rule IS NOT NULL
            "#,
        )
        .bind(to)
        .bind(group_id)
        .fetch_all(&self.pool)
        .await?;

        let parent_ids: Vec<String> = series_roots.iter().map(|r| r.id.clone()).collect();
        let exceptions = self.list_exceptions_for_parents(group_id, &parent_ids).await?;
        let by_parent = group_exceptions(exceptions);

        let mut out: Vec<EventWithSubscriptionRow> = non_recurring;
        for root in series_roots {
            let rule = match &root.recurrence_rule {
                Some(r) => r.0.clone(),
                None => continue,
            };
            let instances = expand_range(root.start_at, &rule, from, to);
            let exc = by_parent.get(&root.id);
            for inst in instances {
                let inst_date = inst.date_naive();
                let status = exc
                    .and_then(|m| m.get(&inst_date))
                    .copied()
                    .unwrap_or(root.status);
                let composite_id = format!("{}:{}", root.id, inst_date);
                let end_at = root.end_at.map(|e| e + (inst - root.start_at));
                out.push(EventWithSubscriptionRow {
                    id: composite_id,
                    title: root.title.clone(),
                    start_at: inst,
                    end_at,
                    status,
                    subscription_id: root.subscription_id.clone(),
                    subscription_name: root.subscription_name.clone(),
                    tracking_mode: root.tracking_mode,
                    amount: root.amount,
                    notes: root.notes.clone(),
                    recurrence_rule: None,
                    created_at: root.created_at,
                    updated_at: root.updated_at,
                });
            }
        }

        out.sort_by(|a, b| a.start_at.cmp(&b.start_at).then_with(|| a.id.cmp(&b.id)));
        Ok(out)
    }

    async fn fetch(&self, group_id: &str, id: &str) -> Result<EventRow, AppError> {
        let sql = format!(
            "SELECT {EVENT_COLUMNS} FROM events WHERE id = ?1 AND group_id = ?2"
        );
        sqlx::query_as::<_, EventRow>(&sql)
            .bind(id)
            .bind(group_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)
    }

    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: EventWrite<'_>,
    ) -> Result<EventRow, AppError> {
        let rule_json = input
            .recurrence_rule
            .as_ref()
            .map(|r| serde_json::to_string(r).expect("RecurrenceRule serializes"));
        sqlx::query(
            r#"
            INSERT INTO events (
                id, title, start_at, end_at, status, subscription_id, amount, notes,
                recurrence_rule, group_id
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
        )
        .bind(id)
        .bind(input.title)
        .bind(input.start_at)
        .bind(input.end_at)
        .bind(input.status)
        .bind(input.subscription_id)
        .bind(input.amount)
        .bind(input.notes)
        .bind(rule_json)
        .bind(group_id)
        .execute(&self.pool)
        .await?;

        self.fetch(group_id, id).await
    }

    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: EventWrite<'_>,
    ) -> Result<EventRow, AppError> {
        let rule_json = input
            .recurrence_rule
            .as_ref()
            .map(|r| serde_json::to_string(r).expect("RecurrenceRule serializes"));
        let result = sqlx::query(
            r#"
            UPDATE events
            SET title           = ?3,
                start_at        = ?4,
                end_at          = ?5,
                status          = ?6,
                subscription_id = ?7,
                amount          = ?8,
                notes           = ?9,
                recurrence_rule = ?10,
                updated_at      = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2
            "#,
        )
        .bind(id)
        .bind(group_id)
        .bind(input.title)
        .bind(input.start_at)
        .bind(input.end_at)
        .bind(input.status)
        .bind(input.subscription_id)
        .bind(input.amount)
        .bind(input.notes)
        .bind(rule_json)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(group_id, id).await
    }

    async fn set_status(
        &self,
        group_id: &str,
        id: &str,
        status: EventStatus,
    ) -> Result<EventRow, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE events
            SET status     = ?3,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND group_id = ?2
            "#,
        )
        .bind(id)
        .bind(group_id)
        .bind(status)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        self.fetch(group_id, id).await
    }

    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError> {
        let result = sqlx::query(r#"DELETE FROM events WHERE id = ?1 AND group_id = ?2"#)
            .bind(id)
            .bind(group_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn upsert_exception(
        &self,
        group_id: &str,
        parent_id: &str,
        instance_date: NaiveDate,
        status: EventStatus,
    ) -> Result<EventExceptionRow, AppError> {
        let parent_recurs: Option<(Option<String>,)> = sqlx::query_as(
            r#"SELECT recurrence_rule FROM events WHERE id = ?1 AND group_id = ?2"#,
        )
        .bind(parent_id)
        .bind(group_id)
        .fetch_optional(&self.pool)
        .await?;
        match parent_recurs {
            None => return Err(AppError::NotFound),
            Some((None,)) => {
                return Err(AppError::BadRequest("exception_requires_recurring_parent"))
            }
            Some((Some(_),)) => {}
        }

        let new_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO event_exceptions (id, parent_id, instance_date, status, group_id)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(parent_id, instance_date)
            DO UPDATE SET status = excluded.status,
                          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
        )
        .bind(&new_id)
        .bind(parent_id)
        .bind(instance_date)
        .bind(status)
        .bind(group_id)
        .execute(&self.pool)
        .await?;

        sqlx::query_as::<_, EventExceptionRow>(
            r#"SELECT id, parent_id, instance_date, status, created_at, updated_at
               FROM event_exceptions
               WHERE parent_id = ?1 AND instance_date = ?2 AND group_id = ?3"#,
        )
        .bind(parent_id)
        .bind(instance_date)
        .bind(group_id)
        .fetch_one(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn fetch_exception(
        &self,
        group_id: &str,
        parent_id: &str,
        instance_date: NaiveDate,
    ) -> Result<Option<EventExceptionRow>, AppError> {
        sqlx::query_as::<_, EventExceptionRow>(
            r#"SELECT id, parent_id, instance_date, status, created_at, updated_at
               FROM event_exceptions
               WHERE parent_id = ?1 AND instance_date = ?2 AND group_id = ?3"#,
        )
        .bind(parent_id)
        .bind(instance_date)
        .bind(group_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn list_exceptions_for_parents(
        &self,
        group_id: &str,
        parent_ids: &[String],
    ) -> Result<Vec<EventExceptionRow>, AppError> {
        if parent_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = std::iter::repeat_n("?", parent_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, parent_id, instance_date, status, created_at, updated_at \
             FROM event_exceptions \
             WHERE group_id = ? AND parent_id IN ({placeholders})"
        );
        let mut q = sqlx::query_as::<_, EventExceptionRow>(&sql).bind(group_id);
        for id in parent_ids {
            q = q.bind(id);
        }
        q.fetch_all(&self.pool).await.map_err(Into::into)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct SeriesRoot {
    id: String,
    start_at: DateTime<Utc>,
    status: EventStatus,
    subscription_id: Option<String>,
    amount: Option<f64>,
    recurrence_rule: Option<Json<RecurrenceRule>>,
}

async fn fetch_series_roots_for_subscription(
    pool: &SqlitePool,
    group_id: &str,
    subscription_id: &str,
) -> Result<Vec<SeriesRoot>, AppError> {
    sqlx::query_as::<_, SeriesRoot>(
        r#"SELECT id, start_at, status, subscription_id, amount, recurrence_rule
           FROM events
           WHERE subscription_id = ?1
             AND group_id = ?2
             AND recurrence_rule IS NOT NULL
             AND amount IS NOT NULL"#,
    )
    .bind(subscription_id)
    .bind(group_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

async fn fetch_series_roots_for_subscriptions(
    pool: &SqlitePool,
    group_id: &str,
    subscription_ids: &[String],
) -> Result<Vec<SeriesRoot>, AppError> {
    if subscription_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", subscription_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id, start_at, status, subscription_id, amount, recurrence_rule \
         FROM events \
         WHERE recurrence_rule IS NOT NULL \
           AND amount IS NOT NULL \
           AND group_id = ? \
           AND subscription_id IN ({placeholders})"
    );
    let mut q = sqlx::query_as::<_, SeriesRoot>(&sql).bind(group_id);
    for id in subscription_ids {
        q = q.bind(id);
    }
    q.fetch_all(pool).await.map_err(Into::into)
}

fn group_exceptions(
    exceptions: Vec<EventExceptionRow>,
) -> HashMap<String, HashMap<NaiveDate, EventStatus>> {
    let mut out: HashMap<String, HashMap<NaiveDate, EventStatus>> = HashMap::new();
    for e in exceptions {
        out.entry(e.parent_id)
            .or_default()
            .insert(e.instance_date, e.status);
    }
    out
}
