// GET /webhook/verify?id=VER-... answers with a page saying whether that credential was issued
var id = String(($('Verify Credential').first().json.query || {}).id || '').trim();
var rows = $input.all().map(function (i) { return i.json; });
return [{ json: verificationPage(findCredential(rows, id), id, EVENT_NAME) }];
