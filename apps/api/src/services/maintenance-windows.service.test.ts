import { describe, expect, it } from "vitest";

const deriveStatus = (startsAt: Date, endsAt: Date, current: "SCHEDULED" | "ACTIVE" | "COMPLETED" | "CANCELLED") => {
  if (current === "CANCELLED" || current === "COMPLETED") return current;
  const now = Date.now();
  if (now < startsAt.getTime()) return "SCHEDULED";
  if (now > endsAt.getTime()) return "COMPLETED";
  return "ACTIVE";
};

describe("maintenance window status derivation", () => {
  it("marks future windows as scheduled", () => {
    const startsAt = new Date(Date.now() + 60_000);
    const endsAt = new Date(Date.now() + 120_000);
    expect(deriveStatus(startsAt, endsAt, "SCHEDULED")).toBe("SCHEDULED");
  });

  it("marks in-range windows as active", () => {
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 60_000);
    expect(deriveStatus(startsAt, endsAt, "SCHEDULED")).toBe("ACTIVE");
  });
});
