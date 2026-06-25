import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORT || 4176);
const ROOT = process.cwd();
const PUBLIC_ROOT = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const DB_PATH = join(DATA_DIR, "db.json");
const IS_PROD = process.env.NODE_ENV === "production";
const HOST = process.env.HOST || (IS_PROD ? "0.0.0.0" : "127.0.0.1");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const PUBLIC_FILES = new Set(["/index.html", "/styles.css", "/app.js", "/xlsx.full.min.js"]);

async function main() {
  await ensureDb();
  const server = createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`Excel Integration and Analysis running at http://${HOST}:${PORT}/`);
  });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

async function handleApi(req, res, url) {
  const session = await getSession(req);

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const db = await readDb();
    const user = db.users.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!user || !(await verifyPassword(body.password || "", user))) {
      sendJson(res, 401, { error: "邮箱或密码不正确" });
      return;
    }
    const token = randomId();
    db.sessions.push({
      token,
      userId: user.id,
      createdAt: new Date().toISOString(),
    });
    await writeDb(db);
    setSessionCookie(res, token);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    if (session) {
      const db = await readDb();
      db.sessions = db.sessions.filter((item) => item.token !== session.token);
      await writeDb(db);
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    sendJson(res, 200, { user: session ? publicUser(session.user) : null });
    return;
  }

  if (!session) {
    sendJson(res, 401, { error: "请先登录" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/templates") {
    const db = await readDb();
    const templates =
      session.user.role === "admin"
        ? db.templates
        : db.templates.filter((template) => template.ownerId === session.user.id);
    sendJson(res, 200, {
      templates: templates.map((template) => ({
        ...template,
        ownerEmail: db.users.find((user) => user.id === template.ownerId)?.email || "",
      })),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/templates") {
    const body = await readBody(req);
    if (!body.name || !Array.isArray(body.rules)) {
      sendJson(res, 400, { error: "模板名称和指标配置不能为空" });
      return;
    }
    const db = await readDb();
    const now = new Date().toISOString();
    const existing = body.id ? db.templates.find((template) => template.id === body.id) : null;
    if (existing) {
      if (existing.ownerId !== session.user.id && session.user.role !== "admin") {
        sendJson(res, 403, { error: "无权修改这个模板" });
        return;
      }
      existing.name = String(body.name).trim();
      existing.rules = body.rules;
      existing.updatedAt = now;
      await writeDb(db);
      sendJson(res, 200, { template: existing });
      return;
    }
    const template = {
      id: randomId(),
      ownerId: session.user.id,
      name: String(body.name).trim(),
      rules: body.rules,
      createdAt: now,
      updatedAt: now,
    };
    db.templates.push(template);
    await writeDb(db);
    sendJson(res, 200, { template });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/templates/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/templates/", ""));
    const db = await readDb();
    const template = db.templates.find((item) => item.id === id);
    if (!template) {
      sendJson(res, 404, { error: "模板不存在" });
      return;
    }
    if (template.ownerId !== session.user.id && session.user.role !== "admin") {
      sendJson(res, 403, { error: "无权删除这个模板" });
      return;
    }
    db.templates = db.templates.filter((item) => item.id !== id);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    requireAdmin(session, res);
    if (res.writableEnded) return;
    const db = await readDb();
    sendJson(res, 200, { users: db.users.map(publicUser) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    requireAdmin(session, res);
    if (res.writableEnded) return;
    const body = await readBody(req);
    if (!body.email || !body.password) {
      sendJson(res, 400, { error: "邮箱和密码不能为空" });
      return;
    }
    const db = await readDb();
    if (db.users.some((user) => user.email.toLowerCase() === String(body.email).toLowerCase())) {
      sendJson(res, 409, { error: "这个邮箱已经存在" });
      return;
    }
    const user = await createUser({
      email: body.email,
      name: body.name || body.email,
      password: body.password,
      role: body.role === "admin" ? "admin" : "user",
    });
    db.users.push(user);
    await writeDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  if (!PUBLIC_FILES.has(safePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  const filePath = normalize(join(PUBLIC_ROOT, safePath));
  if (!filePath.startsWith(PUBLIC_ROOT)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function ensureDb() {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DB_PATH)) return;

  const users = [];
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    users.push(
      await createUser({
        email: process.env.ADMIN_EMAIL,
        name: "Admin",
        password: process.env.ADMIN_PASSWORD,
        role: "admin",
      })
    );
  } else if (!IS_PROD) {
    users.push(
      await createUser({ email: "admin@example.com", name: "管理员", password: "admin123", role: "admin" }),
      await createUser({ email: "user-a@example.com", name: "用户 A", password: "user123", role: "user" }),
      await createUser({ email: "user-b@example.com", name: "用户 B", password: "user123", role: "user" })
    );
  }

  await writeDb({ users, sessions: [], templates: [] });
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(DB_PATH, "utf8"));
}

async function writeDb(db) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

async function createUser({ email, name, password, role }) {
  const salt = randomBytes(16).toString("hex");
  return {
    id: randomId(),
    email: String(email).trim(),
    name: String(name || email).trim(),
    role,
    salt,
    passwordHash: (await scrypt(String(password), salt, 64)).toString("hex"),
    createdAt: new Date().toISOString(),
  };
}

async function verifyPassword(password, user) {
  const attempted = await scrypt(String(password), user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return stored.length === attempted.length && timingSafeEqual(stored, attempted);
}

async function getSession(req) {
  const token = parseCookies(req.headers.cookie || "").sid;
  if (!token) return null;
  const db = await readDb();
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  return user ? { token, user } : null;
}

function requireAdmin(session, res) {
  if (session.user.role !== "admin") {
    sendJson(res, 403, { error: "需要管理员权限" });
  }
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((pair) => pair.trim().split("="))
      .filter(([key]) => key)
      .map(([key, value]) => [key, decodeURIComponent(value || "")])
  );
}

function setSessionCookie(res, token) {
  const secure = IS_PROD ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function randomId() {
  return randomBytes(16).toString("hex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
