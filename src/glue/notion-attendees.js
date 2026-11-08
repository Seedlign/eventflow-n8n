// runs once per execution after the summary. Sheet rows as read before the engine, plus the rows the
// engine changed, against the Notion database read once. If that read failed we cannot tell create from
// update, so skip rather than create duplicate pages
var settings = $('Event Settings').first().json;
var pages = $input.all().map(function (i) { return i.json; });
if (pages.some(function (p) { return p && p.error; })) return [];
var sheetRows = $('Read Attendees').all().map(function (i) { return i.json; });
var changedRows = $('Route by Action').all(0).map(function (i) { return i.json; });
return planAttendeeSync(sheetRows, changedRows, pages, settings.notion_attendees_db).map(function (r) { return { json: r }; });
