// Request validation that reports errors exactly the way the API does: a 422 whose
// `detail` is a list of { loc, msg, type } entries (the UI joins them into one message).
import { HttpError } from "./util.js";

const PROVIDED = Symbol("provided");

/** Which keys the client actually sent (the `exclude_unset` view used by PATCH handlers). */
export const providedKeys = (data) => data[PROVIDED] ?? new Set();

const RESERVED_TLDS = new Set(["test", "invalid", "local", "localhost", "onion", "arpa"]);

/** Returns the normalised address or an error reason. Same rules the API enforces. */
export function checkEmail(raw) {
  const value = String(raw).trim();
  const at = value.lastIndexOf("@");
  if (at === -1) return { error: "An email address must have an @-sign." };
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local) return { error: "There must be something before the @-sign." };
  if (!domain) return { error: "There must be something after the @-sign." };
  if (/\s/.test(value) || /@/.test(local)) return { error: "The email address contains invalid characters." };
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    return { error: "The part after the @-sign is not valid. It should have a period." };
  }
  if (RESERVED_TLDS.has(domain.split(".").pop().toLowerCase())) {
    return { error: "The part after the @-sign is a special-use or reserved name that cannot be used with email." };
  }
  return { value: `${local}@${domain.toLowerCase()}` };
}

const err = (loc, msg, type = "value_error") => ({ loc, msg, type });
const missing = (loc) => err(loc, "Field required", "missing");

const listOr = (vals) => {
  const q = vals.map((v) => `'${v}'`);
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} or ${q.at(-1)}` : q[0];
};

/** Validates one field spec. Returns { value } or { errors }. */
function check(spec, raw, loc) {
  const nullable = spec.nullable || spec.optional;
  if (raw === null) {
    if (nullable) return { value: null };
    return { errors: [err(loc, `Input should be a valid ${spec.type === "str" ? "string" : spec.type}`, "type_error")] };
  }

  switch (spec.type) {
    case "str": {
      if (typeof raw !== "string") return { errors: [err(loc, "Input should be a valid string", "string_type")] };
      // Length limits apply to the raw input; stripping and the blank check run afterwards.
      if (spec.min != null && raw.length < spec.min) {
        return { errors: [err(loc, `String should have at least ${spec.min} character${spec.min === 1 ? "" : "s"}`, "string_too_short")] };
      }
      if (spec.max != null && raw.length > spec.max) {
        return { errors: [err(loc, `String should have at most ${spec.max} characters`, "string_too_long")] };
      }
      let v = spec.strip ? raw.trim() : raw;
      if (spec.nonblank && !v) return { errors: [err(loc, "Value error, must not be blank")] };
      if (spec.lower) v = v.toLowerCase();
      return { value: v };
    }
    case "email": {
      if (typeof raw !== "string") return { errors: [err(loc, "Input should be a valid string", "string_type")] };
      if (spec.blankToNull && !raw.trim()) return { value: null };
      const r = checkEmail(raw);
      if (r.error) return { errors: [err(loc, `value is not a valid email address: ${r.error}`, "value_error")] };
      return { value: spec.lower ? r.value.toLowerCase() : r.value };
    }
    case "int":
    case "float": {
      let n = raw;
      if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
      if (typeof n !== "number" || Number.isNaN(n) || typeof raw === "boolean") {
        return { errors: [err(loc, spec.type === "int" ? "Input should be a valid integer" : "Input should be a valid number", spec.type === "int" ? "int_parsing" : "float_parsing")] };
      }
      if (spec.type === "int" && !Number.isInteger(n)) {
        return { errors: [err(loc, "Input should be a valid integer, got a number with a fractional part", "int_from_float")] };
      }
      if (!Number.isFinite(n)) return { errors: [err(loc, "Input should be a finite number", "finite_number")] };
      if (spec.gt != null && !(n > spec.gt)) return { errors: [err(loc, `Input should be greater than ${spec.gt}`, "greater_than")] };
      if (spec.ge != null && !(n >= spec.ge)) return { errors: [err(loc, `Input should be greater than or equal to ${spec.ge}`, "greater_than_equal")] };
      if (spec.le != null && !(n <= spec.le)) return { errors: [err(loc, `Input should be less than or equal to ${spec.le}`, "less_than_equal")] };
      return { value: n };
    }
    case "bool": {
      if (typeof raw !== "boolean") return { errors: [err(loc, "Input should be a valid boolean", "bool_type")] };
      return { value: raw };
    }
    case "enum": {
      if (!spec.values.includes(raw)) return { errors: [err(loc, `Input should be ${listOr(spec.values)}`, "literal_error")] };
      return { value: raw };
    }
    case "dict": {
      if (typeof raw !== "object" || Array.isArray(raw)) return { errors: [err(loc, "Input should be a valid dictionary", "dict_type")] };
      return { value: raw };
    }
    case "datetime": {
      const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
      if (Number.isNaN(ms)) return { errors: [err(loc, "Input should be a valid datetime", "datetime_parsing")] };
      return { value: ms };
    }
    case "list": {
      if (!Array.isArray(raw)) return { errors: [err(loc, "Input should be a valid list", "list_type")] };
      const out = [];
      const errors = [];
      raw.forEach((item, i) => {
        const r = check(spec.item, item, [...loc, i]);
        if (r.errors) errors.push(...r.errors); else out.push(r.value);
      });
      return errors.length ? { errors } : { value: out };
    }
    case "object": {
      const r = parseObject(spec.fields, raw, loc);
      return r.errors ? { errors: r.errors } : { value: r.value };
    }
    default:
      return { value: raw };
  }
}

/** Object/array defaults are cloned per request so one call can never mutate another's. */
const cloneDefault = (d) => (typeof d === "function" ? d() : d !== null && typeof d === "object" ? structuredClone(d) : d);

function parseObject(fields, input, loc) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { errors: [err(loc, "Input should be a valid dictionary or object to extract fields from", "model_attributes_type")] };
  }
  const out = {};
  const provided = new Set();
  const errors = [];
  for (const [name, spec] of Object.entries(fields)) {
    const fieldLoc = [...loc, name];
    if (!(name in input) || input[name] === undefined) {
      if ("default" in spec) out[name] = cloneDefault(spec.default);
      else if (spec.optional) out[name] = null;
      else errors.push(missing(fieldLoc));
      continue;
    }
    const r = check(spec, input[name], fieldLoc);
    if (r.errors) errors.push(...r.errors);
    else { out[name] = r.value; provided.add(name); }
  }
  if (errors.length) return { errors };
  Object.defineProperty(out, PROVIDED, { value: provided, enumerable: false });
  return { value: out };
}

/** Validate a JSON body. Throws the API's 422 shape on failure. */
export function parseBody(fields, body) {
  const r = parseObject(fields, body ?? {}, ["body"]);
  if (r.errors) throw new HttpError(422, r.errors);
  return r.value;
}

/** Validate query-string params. Values arrive as strings and are coerced per spec. */
export function parseQuery(fields, query) {
  const errors = [];
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    const raw = query[name];
    const loc = ["query", name];
    if (raw === undefined || raw === "") {
      if ("default" in spec) out[name] = spec.default;
      else if (spec.optional) out[name] = null;
      else errors.push(missing(loc));
      continue;
    }
    const r = check(spec, raw, loc);
    if (r.errors) errors.push(...r.errors); else out[name] = r.value;
  }
  if (errors.length) throw new HttpError(422, errors);
  return out;
}

export const f = {
  str: (o = {}) => ({ type: "str", ...o }),
  email: (o = {}) => ({ type: "email", ...o }),
  int: (o = {}) => ({ type: "int", ...o }),
  float: (o = {}) => ({ type: "float", ...o }),
  bool: (o = {}) => ({ type: "bool", ...o }),
  dict: (o = {}) => ({ type: "dict", ...o }),
  datetime: (o = {}) => ({ type: "datetime", ...o }),
  enumOf: (values, o = {}) => ({ type: "enum", values, ...o }),
  list: (item, o = {}) => ({ type: "list", item, ...o }),
};
