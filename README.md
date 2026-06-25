# Excel Integration and Analysis

一个带登录和模板保存能力的 Excel / CSV 汇总工具。它会批量读取同格式文件，自动识别表头字段，并按用户定义的口径生成汇总 Excel。

## 本地使用方式

启动后端服务：

```bash
npm start
```

然后打开：

```text
http://127.0.0.1:4176/
```

开发模式会自动创建 3 个测试账号：

```text
admin@example.com / admin123
user-a@example.com / user123
user-b@example.com / user123
```

生产环境不要使用默认账号。请设置：

```text
ADMIN_EMAIL
ADMIN_PASSWORD
NODE_ENV=production
```

登录后点击“选择文件夹”，选择包含 `.xlsx`、`.xls` 或 `.csv` 的文件夹。

选择文件夹后，工具会先显示文件数量和总大小。点击“开始解析”后才会读取 Excel，避免大文件夹一选中就把浏览器卡死。

当前 MVP 支持多个汇总列，每个汇总列可以分别选择 Tab 和字段，并支持两种指标类型：

```text
百分比 / 比率 = 第 X 至第 Y 条数据的某个 Tab / 字段求和 / 第 X 至第 Y 条数据的某个 Tab / 字段求和
单指标汇总 = 第 X 至第 Y 条数据的某个 Tab / 字段求和
```

例如：

```text
前7日点击率 = 前 7 条「投放数据 / 点击」求和 / 前 7 条「投放数据 / 曝光」求和
前7日花费 = 前 7 条「成本数据 / 花费」求和
```

数据行范围里的“第 1 条数据”不包含表头，通常对应 Excel 里的第 2 行。比如起始数据行 2、结束数据行 8，表示取第 2 至第 8 条数据。

汇总列会按指标卡片的上下顺序导出。拖动卡片左上角的排序手柄，可以调整最终 Excel 的列顺序。导出的第一列文件名会自动去掉 `.xlsx`、`.xls`、`.csv` 等后缀。

## 用户和模板

- 普通用户只能看到自己保存的模板。
- 管理员可以看到所有用户保存的模板，并可以创建用户。
- 模板保存的是汇总规则配置，不保存上传的 Excel / CSV 文件内容。
- Excel 文件仍然在浏览器本地解析，不会上传到后端。

## Vercel 部署

当前线上部署使用：

```text
Vercel 静态页面 + Vercel Functions + Neon/Postgres 数据库
```

在 Vercel 里导入 GitHub 仓库后，不需要设置 Start Command。Vercel 会自动托管根目录下的静态文件，并把 `api/[...route].mjs` 作为后端接口。

请在 Vercel 项目的 Environment Variables 里配置：

```text
ADMIN_EMAIL=你的管理员邮箱
ADMIN_PASSWORD=你的管理员初始密码
NODE_ENV=production
```

数据库连接变量支持以下任意一个名称，通常 Neon/Vercel 会自动生成其中之一：

```text
DATABASE_URL
POSTGRES_URL
POSTGRES_PRISMA_URL
POSTGRES_URL_NON_POOLING
NEON_DATABASE_URL
```

第一次访问 API 时会自动创建数据库表：

```text
users
sessions
templates
```

如果数据库还是空的，并且已经配置了 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`，系统会自动创建第一个管理员账号。环境变量修改后，需要在 Vercel 里重新部署一次才会生效。

## 注意

- 每个 Excel 会读取所有工作表。
- 每个工作表会在前 25 行里自动选择最像表头的一行。
- 为降低浏览器崩溃风险，每个工作表最多保留前 500 条数据用于汇总。
- 超过 50 MB 的单个文件会被跳过。
- 同一次上传里，字段不必完全一致；如果某个文件缺少规则需要的 Tab 或字段，对应结果会留空。
- Excel 读取和导出使用项目内的 `xlsx.full.min.js`，可以离线运行。
- GitHub Pages 只能运行旧的纯静态版本，不能提供安全登录、用户隔离或模板保存。当前版本本地可用 `local-server.mjs` 后端，线上应使用 Vercel Functions 和 Neon/Postgres。
