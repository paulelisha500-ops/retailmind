import { describe, expect, it } from "vitest";
import { HttpError, pyRound, parseCsv } from "../../src/engine/util.js";
import { checkEmail, f, parseBody, parseQuery, providedKeys } from "../../src/engine/validate.js";

const catchError = (fn) => { try { fn(); } catch (e) { return e; } throw new Error("expected an error"); };

describe("body validation", () => {
  const schema = {
    name: f.str({ min: 1, max: 10, strip: true, nonblank: true }),
    email: f.email({ lower: true }),
    qty: f.int({ default: 1, ge: 1, le: 999 }),
    tags: f.list(f.str(), { default: [] }),
    note: f.str({ optional: true }),
  };

  it("accepts a valid body and applies defaults", () => {
    const out = parseBody(schema, { name: " Ana ", email: "ANA@Shop.COM" });
    expect(out).toMatchObject({ name: "Ana", email: "ana@shop.com", qty: 1, tags: [], note: null });
  });

  it("reports missing fields like the API does", () => {
    const err = catchError(() => parseBody(schema, {}));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(422);
    expect(err.detail).toEqual(expect.arrayContaining([
      { loc: ["body", "name"], msg: "Field required", type: "missing" },
      { loc: ["body", "email"], msg: "Field required", type: "missing" },
    ]));
  });

  it("checks length against the raw input, then rejects blank-after-strip", () => {
    expect(catchError(() => parseBody(schema, { name: "", email: "a@b.co" })).detail[0].msg).toBe("String should have at least 1 character");
    expect(catchError(() => parseBody(schema, { name: "   ", email: "a@b.co" })).detail[0].msg).toBe("Value error, must not be blank");
    expect(catchError(() => parseBody(schema, { name: "x".repeat(11), email: "a@b.co" })).detail[0].msg).toBe("String should have at most 10 characters");
  });

  it("validates numbers, including numeric strings", () => {
    expect(parseBody(schema, { name: "a", email: "a@b.co", qty: "5" }).qty).toBe(5);
    expect(catchError(() => parseBody(schema, { name: "a", email: "a@b.co", qty: 0 })).detail[0].msg).toBe("Input should be greater than or equal to 1");
    expect(catchError(() => parseBody(schema, { name: "a", email: "a@b.co", qty: 1.5 })).detail[0].type).toBe("int_from_float");
    expect(catchError(() => parseBody(schema, { name: "a", email: "a@b.co", qty: "abc" })).detail[0].msg).toBe("Input should be a valid integer");
  });

  it("rejects a non-object body", () => {
    expect(catchError(() => parseBody(schema, [1])).detail[0].msg).toMatch(/valid dictionary/);
  });

  it("tracks which keys were actually sent (exclude_unset)", () => {
    const out = parseBody({ a: f.str({ optional: true }), b: f.str({ optional: true }) }, { a: null });
    expect([...providedKeys(out)]).toEqual(["a"]);
  });

  it("never shares a mutable default between calls", () => {
    const a = parseBody(schema, { name: "a", email: "a@b.co" });
    a.tags.push("leak");
    expect(parseBody(schema, { name: "a", email: "a@b.co" }).tags).toEqual([]);
  });

  it("supports enums with the API's error wording", () => {
    const e = catchError(() => parseBody({ s: f.enumOf(["a", "b", "c"]) }, { s: "z" }));
    expect(e.detail[0].msg).toBe("Input should be 'a', 'b' or 'c'");
  });

  it("treats a blank optional email as unset", () => {
    expect(parseBody({ e: f.email({ optional: true, blankToNull: true }) }, { e: "  " }).e).toBeNull();
    expect(catchError(() => parseBody({ e: f.email({ optional: true, blankToNull: true }) }, { e: "nope" })).detail[0].msg).toMatch(/not a valid email/);
  });
});

describe("query validation", () => {
  it("coerces types and reports the query location", () => {
    expect(parseQuery({ days: f.int({ default: 14 }), s: f.str({ optional: true }) }, { days: "30" })).toEqual({ days: 30, s: null });
    const e = catchError(() => parseQuery({ store_id: f.str() }, {}));
    expect(e.detail).toEqual([{ loc: ["query", "store_id"], msg: "Field required", type: "missing" }]);
  });
});

describe("email rules", () => {
  it.each(["a@b.co", "first.last+tag@sub.example.com", "x@retailmind.app", "orders@freshfarms.internal"])("accepts %s", (e) => {
    expect(checkEmail(e).value).toBe(e.toLowerCase());
  });
  it.each(["plain", "@no-local.com", "a@", "a@nodot", "a b@c.com", "a@b..com", "a@retailmind.local", "a@x.test", "a@x.invalid"])("rejects %s", (e) => {
    expect(checkEmail(e).error).toBeTruthy();
  });
});

describe("helpers", () => {
  it("rounds half to even like Python", () => {
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
    expect(pyRound(-2.5)).toBe(-2);
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(12.345, 1)).toBe(12.3);
  });

  it("parses CSV with quotes, embedded commas, CRLF and a BOM", () => {
    const { fieldnames, records } = parseCsv('﻿sku,name,price\r\nA1,"Milk, whole",12.5\r\nA2,"He said ""hi""",3\r\n');
    expect(fieldnames).toEqual(["sku", "name", "price"]);
    expect(records).toEqual([{ sku: "A1", name: "Milk, whole", price: "12.5" }, { sku: "A2", name: 'He said "hi"', price: "3" }]);
    expect(parseCsv("").fieldnames).toBeNull();
  });
});
