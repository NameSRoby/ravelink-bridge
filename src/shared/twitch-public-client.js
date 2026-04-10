function decodeClientId(parts = []) {
  return parts.map(value => String.fromCharCode(Number(value) || 0)).join("");
}

function getBundledTwitchClientId() {
  return decodeClientId([
    52, 118, 53, 97, 49, 117, 54, 98, 102, 117,
    116, 99, 113, 102, 100, 101, 106, 103, 111, 105,
    101, 98, 107, 120, 101, 111, 103, 101, 102, 99
  ]);
}

module.exports = {
  getBundledTwitchClientId
};
