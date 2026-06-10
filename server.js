const fs = require("fs");
const http = require("http");
const path = require("path");

loadEnvFile(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 3000);
const csvPath = path.resolve(process.env.GRADE_CSV_PATH || "./data/grades.csv");
const publicDir = path.join(__dirname, "public");
const allowedOrigins = (process.env.GRADE_CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const LOOKUP_COLUMNS = {
  uid: "SIS User ID",
  email: "SIS Login ID"
};

const gradeStartAfterColumn = "Section";
const apiAttempts = new Map();

let gradeRows = [];
let loadedAt = null;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  if (rows[0] && rows[0][0]) {
    rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  }
  return rows;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function loadGrades() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const headers = rows[0] || [];

  const uidIndex = headers.indexOf(LOOKUP_COLUMNS.uid);
  const emailIndex = headers.indexOf(LOOKUP_COLUMNS.email);
  if (uidIndex === -1 || emailIndex === -1) {
    throw new Error("CSV must include SIS User ID and SIS Login ID columns.");
  }

  const sectionIndex = headers.indexOf(gradeStartAfterColumn);
  if (sectionIndex === -1 || sectionIndex === headers.length - 1) {
    throw new Error(`CSV must include ${gradeStartAfterColumn} followed by grade columns.`);
  }

  const gradeStartIndex = sectionIndex + 1;
  const gradeHeaders = headers.slice(gradeStartIndex);
  gradeRows = rows.slice(1).map((row) => ({
    uid: normalize(row[uidIndex]),
    email: normalize(row[emailIndex]),
    grades: gradeHeaders.map((header, offset) => ({
      assignment: header.replace(/\s*\(\d+\)\s*$/, "").trim(),
      score: row[gradeStartIndex + offset] || ""
    }))
  }));
  loadedAt = new Date();
}

function lookup(identifier) {
  const normalizedIdentifier = normalize(identifier);
  if (!normalizedIdentifier) {
    return null;
  }
  return gradeRows.find(
    (row) => row.uid === normalizedIdentifier || row.email === normalizedIdentifier
  );
}

function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...securityHeaders(req)
  });
  res.end(body);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

function securityHeaders(req = {}) {
  return {
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...corsHeaders(req)
  };
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
}

function rateLimit(req) {
  const key = getClientIp(req);
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const current = apiAttempts.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + windowMs;
  }
  current.count += 1;
  apiAttempts.set(key, current);

  return current.count <= 40;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(publicDir, normalizedPath));
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403, securityHeaders(req));
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, securityHeaders(req));
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8"
      }[extension] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      ...securityHeaders(req)
    });
    res.end(content);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204, securityHeaders(req));
    res.end();
    return;
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    return sendJson(req, res, 200, {
      ok: true,
      loadedAt: loadedAt ? loadedAt.toISOString() : null,
      rowCount: gradeRows.length
    });
  }

  if (url.pathname === "/api/lookup" && req.method === "POST") {
    if (!rateLimit(req)) {
      return sendJson(req, res, 429, { error: "Too many attempts. Please try again later." });
    }

    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const identifier = payload.identifier;
      if (typeof identifier !== "string" || identifier.trim().length < 3) {
        return sendJson(req, res, 400, { error: "Please enter a valid UID or SIS login email." });
      }

      const match = lookup(identifier);
      if (!match) {
        return sendJson(req, res, 404, { error: "No matching record was found." });
      }

      return sendJson(req, res, 200, {
        grades: match.grades,
        matchedBy: normalize(identifier).includes("@") ? "SIS Login ID" : "SIS User ID"
      });
    } catch (error) {
      return sendJson(req, res, 400, { error: "Invalid lookup request." });
    }
  }

  if (req.method === "GET") {
    return serveStatic(req, res);
  }

  return sendJson(req, res, 405, { error: "Method not allowed." });
}

try {
  loadGrades();
  http.createServer(handleRequest).listen(port, () => {
    console.log(`BE 176 grade check is running at http://localhost:${port}`);
    console.log(`Loaded ${gradeRows.length} rows from ${csvPath}`);
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
