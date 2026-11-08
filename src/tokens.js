// both values are keyed by the event secret, so neither can be forged from the public fields alone
// attempt > 0 re-derives a different token after a collision; 0 or absent keeps the original value
function makeToken(secret, userId, attempt) {
  return 'N8NPH-' + hmacSha256Hex(secret, 'token|' + userId + (attempt ? '|' + attempt : '')).slice(0, 8).toUpperCase();
}

function makeVerificationId(secret, userId, token, completedDate) {
  return 'VER-' + hmacSha256Hex(secret, 'cert|' + userId + '|' + token + '|' + completedDate).slice(0, 12).toUpperCase();
}
