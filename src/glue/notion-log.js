// every log entry from this run becomes one page in the Notion event log
var settings = $('Event Settings').first().json;
var logs = $('Route by Action').all(1).map(function (i) { return i.json; });
return planLogAppend(logs, settings.notion_log_db).map(function (r) { return { json: r }; });
