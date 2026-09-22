# Delhivery B2C Integration

The Delhivery B2C APIs are proxied through the server route below so the account token is never exposed in browser code:

```text
POST /api/delhivery/b2c
GET  /api/delhivery/b2c
```

## Environment

Configure these runtime variables on the server:

```text
DELHIVERY_TOKEN=your_delhivery_token
DELHIVERY_ENV=staging
DELHIVERY_BASE_URL=
```

`DELHIVERY_ENV` accepts `staging` or `production`. If `DELHIVERY_BASE_URL` is set, it overrides the environment default.

Defaults:

```text
staging    https://staging-express.delhivery.com
production https://track.delhivery.com
```

## Request Shape

All operations use one JSON shape:

```json
{
  "operation": "pincodeServiceability",
  "params": {
    "filter_codes": "194103"
  },
  "payload": {}
}
```

`params` are converted to query/path parameters. `payload` is sent as the upstream request body.

## Supported Operations

- `pincodeServiceability`
- `heavyPincodeServiceability`
- `expectedTat`
- `fetchBulkWaybills`
- `fetchWaybill`
- `createShipment`
- `editShipment`
- `cancelShipment`
- `updateEwaybill`
- `trackShipment`
- `calculateShippingCost`
- `generateLabel`
- `createPickupRequest`
- `createWarehouse`
- `updateWarehouse`
- `downloadDocument`
- `ndrAction`
- `getNdrStatus`

`createShipment` supports forward B2C, MPS, RVP, REPL, and RVP QC payloads. The proxy sends it as Delhivery's required `application/x-www-form-urlencoded` body with `format=json&data=<manifest-json>`.

## Postman

Import:

```text
postman/delhivery-b2c.postman_collection.json
postman/delhivery-b2c.postman_environment.json
```

Set `base_url` to the running app URL, for example:

```text
http://127.0.0.1:8787
```

Real upstream calls require `DELHIVERY_TOKEN` to be set on the server. Without it, the proxy intentionally returns a configuration error.

For Postman/local testing, the collection can also send the token per request:

```text
X-Delhivery-Token: {{delhivery_token}}
X-Delhivery-Env: {{delhivery_env}}
X-Delhivery-Base-Url: {{delhivery_base_url}}
```

`X-Delhivery-Base-Url` is disabled by default in the collection. Enable it only for mocks or a deliberate endpoint override.
