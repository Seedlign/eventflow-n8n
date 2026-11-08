// one webform submission becomes a one-event registration batch for the same engine
var f = $json;
var at = f.submittedAt || new Date().toISOString();
return {
  json: {
    processing_batch_metadata: { batch_id: 'FORM-' + at, source: 'form' },
    raw_incoming_payloads: [{
      sequence: 1, event_type: 'registration_submitted', full_name: f['Full name'] || '', email: f.Email || '',
      organization: f.Organization || '', role: f.Role || '', timestamp: at,
    }],
  },
};
