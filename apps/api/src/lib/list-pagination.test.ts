import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  resolveListPagination
} from "./list-pagination";

describe("resolveListPagination", () => {
  it("defaults to a bounded page size", () => {
    expect(resolveListPagination({})).toEqual({ take: DEFAULT_LIST_LIMIT, skip: 0 });
  });

  it("caps oversized limits", () => {
    expect(resolveListPagination({ limit: "9999" }).take).toBe(MAX_LIST_LIMIT);
  });

  it("rejects non-positive limits", () => {
    expect(resolveListPagination({ limit: "0" }).take).toBe(1);
    expect(resolveListPagination({ limit: "-5" }).take).toBe(1);
  });

  it("parses offset", () => {
    expect(resolveListPagination({ limit: 25, offset: "50" })).toEqual({ take: 25, skip: 50 });
  });
});
