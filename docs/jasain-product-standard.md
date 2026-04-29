# JASAIN Product Standard

JASAIN is the parent brand. Product apps such as CUJASA and DEXOR use one shared account, permission, billing, and API model.

## Domains

- `api.jasain.kr`: shared API
- `jasain.kr`: brand and product landing pages
- `cujasa.jasain.kr`: CUJASA app
- `app.jasain.kr`: temporary CUJASA legacy alias
- `dexor.jasain.kr`: DEXOR app

## Product Registry

Products are stored in `jasain_products`.

Required fields:

- `id`: stable product id, for example `cujasa` or `dexor`
- `name`: display name
- `description`: short product description
- `app_url`: canonical app URL
- `landing_url`: landing URL
- `status`: `active`, `inactive`, or `archived`

## User Permissions

Product access is stored in `user_products`.

Rules:

- Every CUJASA customer must have `user_products.product_id = 'cujasa'`.
- DEXOR customers should receive `product_id = 'dexor'`.
- Product apps must block customer access when the matching product grant is missing or suspended.
- Admins can assign and revoke product grants from the customer/permission page.

## Adding A New Solution

1. Add a row to `jasain_products`.
2. Add a canonical subdomain, for example `newproduct.jasain.kr`.
3. Add the subdomain to Vercel and keep API calls pointed at `https://api.jasain.kr`.
4. Ensure `CLIENT_BASE_URL` includes the new origin, or that the origin matches `https://*.jasain.kr`.
5. Add product-specific API routes under a namespaced path.
6. Store product-specific data in dedicated tables, while reusing `users`, `user_products`, and billing tables.
7. Expose the product in the admin permission UI.

## DEXOR Migration Notes

Current DEXOR uses a separate SQLite database, cookie session, and OAuth flow. The target migration is:

- Replace DEXOR direct API calls with `https://api.jasain.kr/api/dexor/*`.
- Map Naver/Google provider identities to the shared `users` table.
- Store credits, payments, analysis jobs, and blog results in Supabase tables.
- Keep OAuth providers as login methods, but issue the same JASAIN auth token after provider login.
