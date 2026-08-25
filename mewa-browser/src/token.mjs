export const TOKEN_MIN_LENGTH = 32;
export const TOKEN_MAX_LENGTH = 256;

export const TOKEN_SENTINELS = Object.freeze([
  "INVALID_REPLACE_WITH_RANDOM_CONTROLLER_TOKEN",
  "INVALID_REPLACE_WITH_RANDOM_BROWSER_TOKEN",
  "replace-with-a-random-controller-token",
  "replace-with-a-random-browser-token",
  "replace-with-a-random-token",
]);

const PRINTABLE_TOKEN = /^[\x21-\x7e]+$/;

export function isStrongToken(value) {
  return (
    typeof value === "string" &&
    value.length >= TOKEN_MIN_LENGTH &&
    value.length <= TOKEN_MAX_LENGTH &&
    PRINTABLE_TOKEN.test(value) &&
    !TOKEN_SENTINELS.includes(value)
  );
}

export function assertStrongToken(value, name = "MEWA_BROWSER_TOKEN") {
  if (!value) throw new Error(`${name} is required`);
  if (!isStrongToken(value)) {
    throw new Error(`${name} must be at least ${TOKEN_MIN_LENGTH} printable random-token characters`);
  }
}
