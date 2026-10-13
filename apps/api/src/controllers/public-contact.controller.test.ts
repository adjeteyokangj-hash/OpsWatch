import { describe, expect, it } from "vitest";
import { publicContactController } from "./public-contact.controller";

const mockRes = () => {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res;
};

describe("publicContactController", () => {
  it("rejects invalid email", async () => {
    const res = mockRes();
    await publicContactController(
      {
        body: {
          name: "Ada Lovelace",
          email: "not-an-email",
          message: "We need monitoring for three applications."
        }
      } as never,
      res as never
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
  });

  it("accepts a valid enquiry", async () => {
    const res = mockRes();
    await publicContactController(
      {
        body: {
          name: "Ada Lovelace",
          email: "ada@example.com",
          company: "Analytical Engines",
          message: "We need monitoring for three applications."
        }
      } as never,
      res as never
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, delivery: "logged" });
  });
});
