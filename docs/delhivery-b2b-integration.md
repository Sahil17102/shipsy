# Delhivery B2B Integration

The Delhivery B2B LTL APIs are proxied through:

```text
POST /api/delhivery/b2b
GET  /api/delhivery/b2b
```

The proxy keeps B2B bearer tokens out of browser code and normalizes all calls to one JSON request shape.

## Environment

Configure these runtime variables on the server:

```text
DELHIVERY_B2B_TOKEN=your_ums_bearer_token
DELHIVERY_B2B_ENV=staging
DELHIVERY_B2B_BASE_URL=
```

`DELHIVERY_B2B_ENV` accepts `staging` or `production`. If `DELHIVERY_B2B_BASE_URL` is set, it overrides the environment default.

Defaults:

```text
staging    https://ltl-clients-api-dev.delhivery.com
production https://ltl-clients-api.delhivery.com
```

`passwordReset` and `login` do not require `DELHIVERY_B2B_TOKEN`; all other operations do.

## Request Shape

```json
{
  "operation": "serviceability",
  "params": {
    "pincode": "122001",
    "weight": 1
  },
  "payload": {}
}
```

`params` are converted to upstream path/query parameters. `payload` is sent as JSON for JSON APIs. For `createShipment` and `updateShipment`, payload keys are converted to `multipart/form-data`; object and array values are stringified as Delhivery expects.

## Supported Operations

- `passwordReset`
- `login`
- `logout`
- `serviceability`
- `expectedTat`
- `freightEstimator`
- `freightCharges`
- `createShipment`
- `getShipmentStatus`
- `updateShipment`
- `getShipmentUpdateStatus`
- `cancelShipment`
- `trackShipment`
- `bookAppointment`
- `createPickupRequest`
- `cancelPickupRequest`
- `generateLabelUrl`
- `getLrCopy`
- `generateDocument`
- `getGenerateDocumentStatus`
- `downloadDocument`
- `createWarehouse`
- `updateWarehouse`

## Postman

Import:

```text
postman/delhivery-b2b.postman_collection.json
postman/delhivery-b2b.postman_environment.json
```

Set `base_url` to the running app URL, for example:

```text
http://127.0.0.1:8787
```

For Postman/local testing, the collection sends:

```text
X-Delhivery-B2B-Token: {{delhivery_b2b_token}}
X-Delhivery-B2B-Env: {{delhivery_b2b_env}}
X-Delhivery-B2B-Base-Url: {{delhivery_b2b_base_url}}
```

`X-Delhivery-B2B-Base-Url` is disabled by default. Enable it only for mocks or a deliberate endpoint override.

## Invoice Files

Delhivery's manifest and LR update APIs support binary invoice files. This proxy supports the non-file multipart fields directly from JSON. If binary file upload is needed from the admin UI later, add a dedicated upload endpoint that accepts browser `FormData` and forwards `doc_file` / `invoice_file` streams.
