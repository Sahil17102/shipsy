# DTDC production integration

The DTDC production proxy is server-side, so API keys and tracking credentials stay out of browser code. The same route is available from the deployed VPS API:

```text
GET  /api/dtdc
POST /api/dtdc
```

## Server configuration

Configure these variables in the app runtime. Do not commit real values:

```text
DTDC_PROXY_TOKEN=your_internal_proxy_token
DTDC_API_KEY=your_production_api_key
DTDC_CUSTOMER_CODE=your_customer_code
DTDC_SERVICE_TYPE_ID=PRIORITY
DTDC_ENV=production
DTDC_TRACKING_ACCESS_TOKEN=your_production_tracking_token
```

`DTDC_ENV` uses `production` unless explicitly set to `staging`. To have the server request a tracking token instead, configure `DTDC_TRACKING_USERNAME` and `DTDC_TRACKING_PASSWORD` and leave `DTDC_TRACKING_ACCESS_TOKEN` empty. `DTDC_PINCODE_TOKEN` is optional: the production pincode endpoint was verified successfully without carrier authentication on 24 October 2026.

Booking requests use the configured customer code and service type for every consignment, overriding values in the request body. The API key and customer code are required for the proxy to start requests.

Every POST requires `Authorization: Bearer $DTDC_PROXY_TOKEN`. Keep this proxy token server-side and call the route from a trusted backend or Postman. Do not put it in browser code.

## Operations

All POST calls use `{ "operation": "...", "params": {}, "payload": {} }` and the authorization header above. Omit unused `params` or `payload`.

### Pincode serviceability

```json
{
  "operation": "pincodeServiceability",
  "payload": { "orgPincode": "110046", "desPincode": "636010" }
}
```

### Book a shipment

Pass DTDC's documented `consignments` request body as `payload`. Address, parcel, COD, and reference fields follow the DTDC Order Upload API schema.

```json
{
  "operation": "createShipment",
  "payload": {
    "consignments": [
      {
        "load_type": "NON-DOCUMENT",
        "consignment_type": "Forward",
        "dimension_unit": "cm",
        "length": "10",
        "width": "10",
        "height": "10",
        "weight_unit": "kg",
        "weight": "1",
        "declared_value": "100",
        "num_pieces": "1",
        "origin_details": {},
        "destination_details": {},
        "customer_reference_number": "ORDER-123"
      }
    ]
  }
}
```

### Generate a label

```json
{
  "operation": "generateLabel",
  "params": {
    "reference_number": "DTDC_REFERENCE",
    "label_code": "SHIP_LABEL_4X6",
    "label_format": "pdf"
  }
}
```

Supported formats are `pdf` and `base64`. PDF and binary responses are returned as `{ "contentType": "...", "base64": "..." }` inside `data`.

### Cancel consignments

```json
{
  "operation": "cancelShipment",
  "params": { "AWBNo": ["DTDC_AWB"] }
}
```

### Track a consignment

```json
{
  "operation": "trackShipment",
  "params": { "trkType": "cnno", "strcnno": "DTDC_AWB", "addtnlDtl": "Y" }
}
```

Use `trkType: "reference"` to track by customer reference number.

### Retrieve ePOD

```json
{
  "operation": "generateEpod",
  "params": { "reference_number_list": ["DTDC_REFERENCE"] }
}
```

## Postman

Import `postman/dtdc.postman_collection.json` and `postman/dtdc.postman_environment.json`. Set `base_url` to the running app and configure secrets in the server environment.

The endpoint hostnames follow the DTDC-provided Postman collection and endpoint PDFs. Production pincode serviceability uses `https://smarttrack-ctbsplus.dtdc.com/ratecalapi/PincodeApiCall`; the similar dotted hostname belongs only to the staging mapping. The proxy still supports an optional `DTDC_PINCODE_TOKEN` for accounts that require it.
