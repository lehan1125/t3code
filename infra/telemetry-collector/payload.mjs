const MAX_PROTO_FIELD_NUMBER = 0x1fffffff;

export function parseJson(body) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

export function validEvent(event) {
  return (
    event &&
    typeof event === "object" &&
    typeof event.uuid === "string" &&
    event.uuid.length > 0 &&
    event.uuid.length <= 200 &&
    typeof event.event === "string" &&
    typeof event.distinct_id === "string" &&
    event.properties &&
    typeof event.properties === "object" &&
    !Array.isArray(event.properties) &&
    typeof event.timestamp === "string"
  );
}

export function validOtlpJson(value, signal) {
  const key =
    signal === "traces"
      ? "resourceSpans"
      : signal === "metrics"
        ? "resourceMetrics"
        : "resourceLogs";
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  return (
    keys.length === 1 &&
    keys[0] === key &&
    Array.isArray(value[key]) &&
    value[key].every(
      (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry),
    )
  );
}

function readVarint(bytes, offset) {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 10; index += 1) {
    if (offset >= bytes.length) throw Object.assign(new Error("invalid protobuf"), { status: 400 });
    const byte = bytes[offset++];
    if (index === 9 && byte > 1)
      throw Object.assign(new Error("invalid protobuf"), { status: 400 });
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return [value, offset];
    multiplier *= 128;
  }
  throw Object.assign(new Error("invalid protobuf"), { status: 400 });
}

function skipProtoField(bytes, offset, wireType) {
  if (wireType === 0) return readVarint(bytes, offset)[1];
  if (wireType === 1 || wireType === 5) {
    const width = wireType === 1 ? 8 : 4;
    if (offset + width > bytes.length)
      throw Object.assign(new Error("invalid protobuf"), { status: 400 });
    return offset + width;
  }
  if (wireType === 2) {
    const [length, contentOffset] = readVarint(bytes, offset);
    if (!Number.isSafeInteger(length) || contentOffset + length > bytes.length) {
      throw Object.assign(new Error("invalid protobuf"), { status: 400 });
    }
    return contentOffset + length;
  }
  throw Object.assign(new Error("invalid protobuf"), { status: 400 });
}

function validateProtoRecord(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, offset);
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (
      tag > 0xffffffff ||
      fieldNumber < 1 ||
      fieldNumber > MAX_PROTO_FIELD_NUMBER ||
      wireType === 3 ||
      wireType === 4 ||
      wireType > 5
    ) {
      throw Object.assign(new Error("invalid protobuf"), { status: 400 });
    }
    offset = skipProtoField(bytes, afterTag, wireType);
  }
}

export function validOtlpProtobuf(body) {
  if (body.length === 0) return true;
  let offset = 0;
  while (offset < body.length) {
    const [tag, afterTag] = readVarint(body, offset);
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (
      tag > 0xffffffff ||
      fieldNumber < 1 ||
      fieldNumber > MAX_PROTO_FIELD_NUMBER ||
      wireType === 3 ||
      wireType === 4 ||
      wireType > 5
    ) {
      throw Object.assign(new Error("invalid protobuf"), { status: 400 });
    }
    if (fieldNumber === 1) {
      if (wireType !== 2) throw Object.assign(new Error("invalid protobuf"), { status: 400 });
      const [length, contentOffset] = readVarint(body, afterTag);
      if (!Number.isSafeInteger(length) || contentOffset + length > body.length) {
        throw Object.assign(new Error("invalid protobuf"), { status: 400 });
      }
      validateProtoRecord(body.subarray(contentOffset, contentOffset + length));
      offset = contentOffset + length;
    } else {
      offset = skipProtoField(body, afterTag, wireType);
    }
  }
  return true;
}
