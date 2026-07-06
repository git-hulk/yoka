//! `GET /me` + `POST /me/active-group`. Both run behind `require_auth`.

use axum::{extract::State, http::StatusCode, Extension, Json};
use axum_extra::extract::CookieJar;

use crate::{
    auth::{session::COOKIE_NAME, CurrentMember},
    error::AppError,
    http::AppState,
    schema::auth::{MeResponse, SetActiveGroupInput},
};

pub async fn show(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
) -> Result<Json<MeResponse>, AppError> {
    let me_resp = super::auth::build_me_for_member(&state, &me).await?;
    Ok(Json(me_resp))
}

pub async fn set_active_group(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    jar: CookieJar,
    Json(body): Json<SetActiveGroupInput>,
) -> Result<StatusCode, AppError> {
    // The middleware already validated the cookie; we just need the token
    // value to scope the UPDATE to this exact session row.
    let token = jar
        .get(COOKIE_NAME)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;
    state
        .sessions
        .set_active_group(&token, &me.user_id, &body.group_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
