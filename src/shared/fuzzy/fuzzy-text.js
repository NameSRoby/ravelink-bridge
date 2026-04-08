// [TITLE] Module: shared/fuzzy/fuzzy-text.js
// [TITLE] Purpose: typo-tolerant token matching helpers
// [TITLE] Functionality Index:
// [TITLE] - normalize lookup tokens
// [TITLE] - compute Levenshtein distance
// [TITLE] - choose best fuzzy candidate with threshold + guardrails

function normalizeLookupToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(aRaw, bRaw) {
  const a = String(aRaw || "");
  const b = String(bRaw || "");
  if (!a) return b.length;
  if (!b) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) table[i][0] = i;
  for (let j = 0; j < cols; j += 1) table[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + cost
      );
    }
  }
  return table[a.length][b.length];
}

function scoreCandidate(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) return -Infinity;
  if (queryToken === candidateToken) return 1000;

  let score = 0;
  if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) {
    score += 260;
  }
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
    score += 120;
  }

  const distance = levenshteinDistance(queryToken, candidateToken);
  const maxLen = Math.max(queryToken.length, candidateToken.length, 1);
  const lengthGap = Math.abs(queryToken.length - candidateToken.length);
  const ratio = distance / maxLen;
  score += Math.round((1 - Math.min(1, ratio)) * 300);
  score -= distance * 30;
  score -= lengthGap * 24;

  return score;
}

function findBestFuzzyMatch(query, candidates = [], options = {}) {
  const queryToken = normalizeLookupToken(query);
  if (!queryToken) return null;
  const minScore = Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : 220;
  const maxDistanceRatio = Number.isFinite(Number(options.maxDistanceRatio))
    ? Number(options.maxDistanceRatio)
    : 0.45;

  // [DEV] Candidate gating happens before scoring to avoid distant false positives.
  let best = null;
  for (const value of candidates) {
    const candidateToken = normalizeLookupToken(value);
    if (!candidateToken) continue;
    const distance = levenshteinDistance(queryToken, candidateToken);
    const ratio = distance / Math.max(queryToken.length, candidateToken.length, 1);
    const lengthGap = Math.abs(candidateToken.length - queryToken.length);
    const hardPrefixPass =
      candidateToken.startsWith(queryToken) ||
      queryToken.startsWith(candidateToken) ||
      (candidateToken.includes(queryToken) && lengthGap <= 2) ||
      (queryToken.includes(candidateToken) && lengthGap <= 2);
    if (!hardPrefixPass && ratio > maxDistanceRatio) continue;

    const score = scoreCandidate(queryToken, candidateToken);
    if (score < minScore) continue;
    if (!best || score > best.score || (score === best.score && candidateToken.length < best.token.length)) {
      best = {
        value,
        token: candidateToken,
        score,
        distance,
        distanceRatio: Number(ratio.toFixed(3))
      };
    }
  }

  if (!best) return null;
  return {
    value: best.value,
    score: best.score,
    distance: best.distance,
    distanceRatio: best.distanceRatio
  };
}

module.exports = {
  normalizeLookupToken,
  levenshteinDistance,
  findBestFuzzyMatch
};
