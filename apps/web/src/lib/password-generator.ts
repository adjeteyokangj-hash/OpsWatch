const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_+=.";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export const MIN_PASSWORD_LENGTH = 16;

const randomIndex = (max: number): number => {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0]! % max;
};

const pick = (chars: string): string => chars[randomIndex(chars.length)]!;

const shuffle = (values: string[]): string[] => {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    const current = copy[index]!;
    copy[index] = copy[swapIndex]!;
    copy[swapIndex] = current;
  }
  return copy;
};

export const generatePassword = (length = 20): string => {
  const safeLength = Math.max(length, MIN_PASSWORD_LENGTH);
  const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  const remaining = Array.from({ length: safeLength - required.length }, () => pick(ALL));
  return shuffle([...required, ...remaining]).join("");
};
