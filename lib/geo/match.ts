import {
  canonicalDistrict,
  canonicalState,
  DISTRICTS_BY_STATE,
  type IndiaState,
  STATES,
} from "./india-states-districts";

export type GeoConfidence = "high" | "medium" | "low";
export type GeoImportStatus = "accepted" | "corrected" | "needs_review" | "rejected";

export type GeoImportMatch = {
  input: { state: string; district: string };
  status: GeoImportStatus;
  confidence?: GeoConfidence;
  corrected?: { state: IndiaState; district: string };
  suggestions?: string[];
  stateSuggestions?: IndiaState[];
  districtSuggestions?: string[];
  error?: string;
};

type MatchCandidate<T extends string> = {
  value: T;
  score: number;
};

export function normalizeForGeoMatch(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function confidenceFromScore(score: number): GeoConfidence {
  if (score >= 0.9) return "high";
  if (score >= 0.75) return "medium";
  return "low";
}

function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    const row = distances[i];
    if (!row) continue;
    row[0] = i;
  }
  const firstRow = distances[0];
  if (firstRow) {
    for (let j = 0; j < cols; j += 1) {
      firstRow[j] = j;
    }
  }

  for (let i = 1; i < rows; i += 1) {
    const currentRow = distances[i];
    const previousRow = distances[i - 1];
    if (!currentRow || !previousRow) continue;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const previousCell = previousRow[j];
      const leftCell = currentRow[j - 1];
      const diagonalCell = previousRow[j - 1];
      if (
        previousCell === undefined ||
        leftCell === undefined ||
        diagonalCell === undefined
      ) {
        continue;
      }
      currentRow[j] = Math.min(
        previousCell + 1,
        leftCell + 1,
        diagonalCell + cost,
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        const transposeBase = distances[i - 2]?.[j - 2];
        const currentValue = currentRow[j];
        if (transposeBase !== undefined && currentValue !== undefined) {
          currentRow[j] = Math.min(currentValue, transposeBase + 1);
        }
      }
    }
  }

  return distances[a.length]?.[b.length] ?? 0;
}

function similarity(input: string, candidate: string): number {
  if (!input || !candidate) return 0;
  if (input === candidate) return 1;

  const maxLength = Math.max(input.length, candidate.length);
  const editScore = 1 - damerauLevenshtein(input, candidate) / maxLength;
  const containmentScore =
    candidate.startsWith(input) || input.startsWith(candidate) ? 0.9 : candidate.includes(input) ? 0.8 : 0;

  return Math.max(editScore, containmentScore);
}

function bestMatches<T extends string>(input: string, candidates: readonly T[]): Array<MatchCandidate<T>> {
  const normalizedInput = normalizeForGeoMatch(input);
  return candidates
    .map((value) => ({ value, score: similarity(normalizedInput, normalizeForGeoMatch(value)) }))
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
}

function exactByNormalized<T extends string>(input: string, candidates: readonly T[]): T | null {
  const normalizedInput = normalizeForGeoMatch(input);
  return candidates.find((value) => normalizeForGeoMatch(value) === normalizedInput) ?? null;
}

function topSuggestions<T extends string>(matches: Array<MatchCandidate<T>>): T[] {
  return matches.filter((match) => match.score >= 0.75).slice(0, 5).map((match) => match.value);
}

function classifyMatches<T extends string>(matches: Array<MatchCandidate<T>>) {
  const best = matches[0];
  const suggestions = topSuggestions(matches);
  const closeMatches = matches.filter((match) => match.score >= 0.75 && best && best.score - match.score < 0.05);
  return { best, suggestions, isAmbiguous: closeMatches.length > 1 };
}

function findDistrictInOtherState(districtRaw: string, selectedState: IndiaState): boolean {
  return STATES.some((state) => {
    if (state === selectedState) return false;
    return canonicalDistrict(state, districtRaw) !== null || exactByNormalized(districtRaw, DISTRICTS_BY_STATE[state]) !== null;
  });
}

export function suggestStateDistrict(stateRaw: string, districtRaw: string): GeoImportMatch {
  const input = { state: stateRaw, district: districtRaw };
  const exactState = exactByNormalized(stateRaw, STATES);
  const aliasedState = canonicalState(stateRaw);
  let state = exactState ?? aliasedState;
  let stateWasFuzzyCorrected = false;

  if (!state) {
    const stateMatches = bestMatches(stateRaw, STATES);
    const stateClass = classifyMatches(stateMatches);
    const confidence = confidenceFromScore(stateClass.best?.score ?? 0);
    if (confidence === "low") return { input, status: "rejected", confidence, error: "State not found" };
    if (confidence === "high" && stateClass.best && !stateClass.isAmbiguous) {
      state = stateClass.best.value;
      stateWasFuzzyCorrected = true;
    } else {
      return {
        input,
        status: "needs_review",
        confidence,
        suggestions: stateClass.suggestions,
        stateSuggestions: stateClass.suggestions,
      };
    }
  }

  if (!state) {
    return {
      input,
      status: "rejected",
      confidence: "low",
      error: "State not found",
    };
  }

  const districts = DISTRICTS_BY_STATE[state];
  const exactDistrict = exactByNormalized(districtRaw, districts);
  const aliasedDistrict = canonicalDistrict(state, districtRaw);
  const district = exactDistrict ?? aliasedDistrict;

  if (district) {
    const corrected = { state, district };
    const stateChanged = normalizeForGeoMatch(stateRaw) !== normalizeForGeoMatch(state);
    const districtChanged = normalizeForGeoMatch(districtRaw) !== normalizeForGeoMatch(district);
    if (stateChanged || districtChanged || stateWasFuzzyCorrected || !exactState || !exactDistrict) {
      return { input, status: "corrected", confidence: "high", corrected };
    }
    return { input, status: "accepted", confidence: "high", corrected };
  }

  if (findDistrictInOtherState(districtRaw, state)) {
    return {
      input,
      status: "rejected",
      confidence: "low",
      corrected: { state, district: districtRaw },
      error: "District does not belong to selected state",
    };
  }

  const districtMatches = bestMatches(districtRaw, districts);
  const districtClass = classifyMatches(districtMatches);
  const confidence = confidenceFromScore(districtClass.best?.score ?? 0);

  if (confidence === "high" && districtClass.best && !districtClass.isAmbiguous) {
    return {
      input,
      status: "corrected",
      confidence,
      corrected: { state, district: districtClass.best.value },
      suggestions: [districtClass.best.value],
      districtSuggestions: [districtClass.best.value],
    };
  }

  if (confidence === "medium" || districtClass.isAmbiguous) {
    return {
      input,
      status: "needs_review",
      confidence: confidence === "low" ? "medium" : confidence,
      corrected: { state, district: districtClass.best?.value ?? districtRaw },
      suggestions: districtClass.suggestions,
      districtSuggestions: districtClass.suggestions,
    };
  }

  return {
    input,
    status: "rejected",
    confidence,
    corrected: { state, district: districtRaw },
    error: "District not found",
  };
}
