# API 契約（MVP たたき台）

## 認証・セッション
- `GET /api/dashboard`: 状態集約（config / session / persistence）
- `GET /oauth/status`: OAuthステータス（簡易）
- `GET /api/gbp/oauth` → Google認可URLへ302
- `GET /api/gbp/oauth/callback` → セッション作成
- `POST /api/gbp/oauth/refresh` → アクセストークン更新

## ロケーション
- `GET /api/locations?query=&category=&status=`
  - returns: `{ items: LocationSummary[], total }`
- `GET /api/locations/:id`
  - returns: `LocationDetail`

## 変更申請（Change Requests）
- `POST /api/change-requests` (body: `{ location_id, patch, update_mask, note }`)
- `GET /api/change-requests?status=`
- `POST /api/change-requests/:id/approve`
- `POST /api/change-requests/:id/reject`

## 同期（ジョブ）
- `POST /api/sync` (body: `{ ids: string[], mode: 'immediate'|'batch' }`)
- `GET /api/sync/runs?batch_id=`

## エラーモデル
- 4xx: `{ ok:false, error:'bad_request'|'unauthorized'|'not_found'|'invalid_state'|... }`
- 5xx: `{ ok:false, error:'internal_error'|'upstream_error' }`

## 型（例）
- `LocationSummary`: `{ id, name, category, city, status, updated_at }`
- `LocationDetail`: `{ id, name, categories[], description, phones[], website, address{}, service_area{}, hours{}, special_hours[], urls{}, attributes{}, labels[], verification{}, updated_at }`

