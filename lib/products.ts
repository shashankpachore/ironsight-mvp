import productOptions from "./products.json";

export const PRODUCT_OPTIONS = productOptions as readonly string[];

export function isValidProduct(value: unknown): value is (typeof PRODUCT_OPTIONS)[number] {
  return typeof value === "string" && PRODUCT_OPTIONS.includes(value);
}
