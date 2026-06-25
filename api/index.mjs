import {
  createAndInsertUser,
  createSession,
  deleteSession,
  deleteTemplate,
  findSession,
  findTemplate,
  findUserByEmail,
  listTemplates,
  listUsers,
  publicUser,
  upsertTemplate,
  verifyPassword,
} from "../lib/vercel-db.mjs";

const IS_PROD = process.env.NODE_ENV === "production";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const routedPath = url.searchParams.get("path");
    if (routedPath) {
      url.pathname = `/api/${routedPath.replace(/^\/+/, "")}`;
    }
    await handleApi(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Server error",
    });
  }
}

async function handleApi(req, res, url) {
  const session = await getSession(req);

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const user = await findUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password || "", user))) {
      sendJson(res, 401, { error: "邮箱或密码不正确" });
      return;
    }
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    if (session) await deleteSession(session.token);
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
    sendJson(res, 200, { templates: await listTemplates(session.user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/templates") {
    const body = await readBody(req);
    if (!body.name || !Array.isArray(body.rules)) {
      sendJson(res, 400, { error: "模板名称和指标配置不能为空" });
      return;
    }
    const existing = body.id ? await findTemplate(body.id) : null;
    if (existing && existing.ownerId !== session.user.id && session.user.role !== "admin") {
      sendJson(res, 403, { error: "无权修改这个模板" });
      return;
    }
    const template = await upsertTemplate({
      id: existing?.id,
      ownerId: existing?.ownerId || session.user.id,
      name: String(body.name).trim(),
      rules: body.rules,
    });
    sendJson(res, 200, { template });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/templates/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/templates/", ""));
    const template = await findTemplate(id);
    if (!template) {
      sendJson(res, 404, { error: "模板不存在" });
      return;
    }
    if (template.ownerId !== session.user.id && session.user.role !== "admin") {
      sendJson(res, 403, { error: "无权删除这个模板" });
      return;
    }
    await deleteTemplate(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    if (!requireAdmin(session, res)) return;
    sendJson(res, 200, { users: (await listUsers()).map(publicUser) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    if (!requireAdmin(session, res)) return;
    const body = await readBody(req);
    if (!body.email || !body.password) {
      sendJson(res, 400, { error: "邮箱和密码不能为空" });
      return;
    }
    const result = await createAndInsertUser({
      email: body.email,
      name: body.name || body.email,
      password: body.password,
      role: body.role === "admin" ? "admin" : "user",
    });
    if (result.conflict) {
      sendJson(res, 409, { error: "这个邮箱已经存在" });
      return;
    }
    sendJson(res, 200, { user: publicUser(result.user) });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function getSession(req) {
  const token = parseCookies(req.headers.cookie || "").sid;
  return token ? findSession(token) : null;
}

function requireAdmin(session, res) {
  if (session.user.role === "admin") return true;
  sendJson(res, 403, { error: "需要管理员权限" });
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  const secure = IS_PROD ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
