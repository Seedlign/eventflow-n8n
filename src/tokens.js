// both values are keyed by the event secret, so neither can be forged from the public fields alone
function makeToken(secret, userId) {
  return 'N8NPH-' + hmacSha256Hex(secret, 'token|' + userId).slice(0, 8).toUpperCase();
}

function makeVerificationId(secret, userId, token, completedDate) {
  return 'VER-' + hmacSha256Hex(secret, 'cert|' + userId + '|' + token + '|' + completedDate).slice(0, 12).toUpperCase();
}
