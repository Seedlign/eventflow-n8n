// live events from the webhook become a batch for the same engine: one event, a bare array, or { raw_incoming_payloads }
var body = $json.body || {};
var events = Array.isArray(body) ? body : Array.isArray(body.raw_incoming_payloads) ? body.raw_incoming_payloads : [body];
return {
  json: {
    processing_batch_metadata: { batch_id: 'LIVE-' + new Date().toISOString(), source: 'webhook' },
    raw_incoming_payloads: events.map(function (ev, i) { return Object.assign({ sequence: i + 1 }, ev); }),
  },
};
