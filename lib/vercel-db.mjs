import { neon } from "@neondatabase/serverless";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

let sqlClient;
let schemaReady = false;

export function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.NEON_DATABASE_URL ||
    ""
  );
}

function getSql() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("缺少数据库连接变量。请在 Vercel Environment Variables 里配置 POSTGRES_URL 或 DATABASE_URL。");
  }
  if (!sqlClient) sqlClient = neon(databaseUrl);
  return sqlClient;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rules JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `;
  await seedAdmin(sql);
  schemaReady = true;
}

async function seedAdmin(sql) {
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
  if (count > 0) return;
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return;
  const user = await createUser({
    email: process.env.ADMIN_EMAIL,
    name: "Admin",
    password: process.env.ADMIN_PASSWORD,
    role: "admin",
  });
  await sql`
    INSERT INTO users (id, email, name, role, salt, password_hash, created_at)
    VALUES (${user.id}, ${user.email}, ${user.name}, ${user.role}, ${user.salt}, ${user.passwordHash}, ${user.createdAt})
  `;
}

export async function findUserByEmail(email) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM users WHERE LOWER(email) = LOWER(${String(email || "")}) LIMIT 1
  `;
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findSession(token) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      sessions.token,
      users.id,
      users.email,
      users.name,
      users.role,
      users.salt,
      users.password_hash,
      users.created_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ${token}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    token: rows[0].token,
    user: mapUser(rows[0]),
  };
}

export async function createSession(userId) {
  await ensureSchema();
  const sql = getSql();
  const token = randomId();
  await sql`
    INSERT INTO sessions (token, user_id, created_at)
    VALUES (${token}, ${userId}, ${new Date().toISOString()})
  `;
  return token;
}

export async function deleteSession(token) {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export async function listTemplates(user) {
  await ensureSchema();
  const sql = getSql();
  const rows =
    user.role === "admin"
      ? await sql`
          SELECT templates.*, users.email AS owner_email
          FROM templates
          JOIN users ON users.id = templates.owner_id
          ORDER BY templates.updated_at DESC
        `
      : await sql`
          SELECT templates.*, users.email AS owner_email
          FROM templates
          JOIN users ON users.id = templates.owner_id
          WHERE templates.owner_id = ${user.id}
          ORDER BY templates.updated_at DESC
        `;
  return rows.map(mapTemplate);
}

export async function findTemplate(id) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM templates WHERE id = ${id} LIMIT 1`;
  return rows[0] ? mapTemplate(rows[0]) : null;
}

export async function upsertTemplate({ id, ownerId, name, rules }) {
  await ensureSchema();
  const sql = getSql();
  const now = new Date().toISOString();
  const templateId = id || randomId();
  if (id) {
    const rows = await sql`
      UPDATE templates
      SET name = ${name}, rules = ${JSON.stringify(rules)}::jsonb, updated_at = ${now}
      WHERE id = ${id}
      RETURNING *
    `;
    if (rows[0]) return mapTemplate(rows[0]);
  }
  const rows = await sql`
    INSERT INTO templates (id, owner_id, name, rules, created_at, updated_at)
    VALUES (${templateId}, ${ownerId}, ${name}, ${JSON.stringify(rules)}::jsonb, ${now}, ${now})
    RETURNING *
  `;
  return mapTemplate(rows[0]);
}

export async function deleteTemplate(id) {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM templates WHERE id = ${id}`;
}

export async function listUsers() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM users ORDER BY created_at ASC`;
  return rows.map(mapUser);
}

export async function createAndInsertUser({ email, name, password, role }) {
  await ensureSchema();
  const sql = getSql();
  const existing = await findUserByEmail(email);
  if (existing) return { conflict: true };
  const user = await createUser({ email, name, password, role });
  await sql`
    INSERT INTO users (id, email, name, role, salt, password_hash, created_at)
    VALUES (${user.id}, ${user.email}, ${user.name}, ${user.role}, ${user.salt}, ${user.passwordHash}, ${user.createdAt})
  `;
  return { user };
}

export async function createUser({ email, name, password, role }) {
  const salt = randomBytes(16).toString("hex");
  return {
    id: randomId(),
    email: String(email).trim(),
    name: String(name || email).trim(),
    role: role === "admin" ? "admin" : "user",
    salt,
    passwordHash: (await scrypt(String(password), salt, 64)).toString("hex"),
    createdAt: new Date().toISOString(),
  };
}

export async function verifyPassword(password, user) {
  const attempted = await scrypt(String(password), user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return stored.length === attempted.length && timingSafeEqual(stored, attempted);
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    salt: row.salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function mapTemplate(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email || "",
    name: row.name,
    rules: Array.isArray(row.rules) ? row.rules : JSON.parse(row.rules || "[]"),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function randomId() {
  return randomBytes(16).toString("hex");
}
