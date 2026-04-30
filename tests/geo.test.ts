import { describe, expect, it } from "vitest";
import {
  canonicalDistrict,
  canonicalState,
  DISTRICTS_BY_STATE,
  STATES,
  validateStateDistrict,
} from "../lib/geo/india-states-districts";

describe("India geo canonical dataset", () => {
  it("contains all states and union territories with production-sized district coverage", () => {
    expect(STATES).toHaveLength(36);
    expect(STATES).toContain("Haryana");
    expect(STATES).toContain("Maharashtra");
    expect(STATES).toContain("Dadra and Nagar Haveli and Daman and Diu");

    const totalDistricts = STATES.reduce((sum, state) => sum + DISTRICTS_BY_STATE[state].length, 0);
    expect(totalDistricts).toBeGreaterThanOrEqual(750);
  });

  it("keeps district names normalized and duplicate-free per state", () => {
    for (const state of STATES) {
      const districts = DISTRICTS_BY_STATE[state];
      expect(districts.length).toBeGreaterThan(0);
      expect(new Set(districts).size).toBe(districts.length);
      for (const district of districts) {
        expect(district).toBe(district.trim());
        expect(district).not.toMatch(/\s{2,}/);
      }
    }
  });

  it("validates that districts belong to the selected state", () => {
    expect(validateStateDistrict("Haryana", "Gurgaon")).toEqual({
      ok: true,
      state: "Haryana",
      district: "Gurgaon",
    });
    expect(validateStateDistrict("Punjab", "Gurgaon")).toEqual({
      ok: false,
      error: "District does not belong to selected state",
    });
  });

  it("canonicalizes state and district aliases", () => {
    expect(canonicalState("MH")).toBe("Maharashtra");
    expect(canonicalDistrict("Karnataka", "bangalore")).toBe("Bengaluru");
    expect(canonicalDistrict("Haryana", "gurugram")).toBe("Gurgaon");
    expect(canonicalDistrict("Delhi", "new delhi")).toBe("Delhi");
  });
});
