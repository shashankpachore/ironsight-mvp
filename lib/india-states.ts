/** Indian states and union territories — manual account requests and UI dropdowns. */
export const INDIAN_STATES_AND_UTS = [
  "Maharashtra",
  "Delhi",
  "Karnataka",
  "Tamil Nadu",
  "Uttar Pradesh",
  "Gujarat",
  "Rajasthan",
  "West Bengal",
  "Madhya Pradesh",
  "Andhra Pradesh",
  "Telangana",
  "Kerala",
  "Haryana",
  "Punjab",
  "Odisha",
  "Bihar",
  "Jharkhand",
  "Assam",
  "Chhattisgarh",
  "Himachal Pradesh",
  "Uttarakhand",
  "Goa",
  "Tripura",
  "Meghalaya",
  "Manipur",
  "Nagaland",
  "Arunachal Pradesh",
  "Mizoram",
  "Sikkim",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Lakshadweep",
  "Puducherry",
  "Ladakh",
  "Jammu and Kashmir",
] as const;

const STATE_SET = new Set<string>(INDIAN_STATES_AND_UTS);

export function isValidIndiaState(value: string): boolean {
  return STATE_SET.has(value.trim());
}
