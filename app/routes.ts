import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new.ts"),
  route("docs/:id", "routes/docs.$id.tsx"),
  route("page/:slug", "routes/page.$slug.tsx"),
  route("journal/:date", "routes/journal.$date.tsx"),
  route("tasks", "routes/tasks.tsx"),
  route("pages", "routes/pages.tsx"),
  route("import", "routes/import.tsx"),
  route("api/rename", "routes/api.rename.ts"),
  route("api/journals", "routes/api.journals.ts"),
  route("api/pages", "routes/api.pages.ts"),
  route("api/pages/titles", "routes/api.pages.titles.ts"),
  route("api/pages/search", "routes/api.pages.search.ts"),
  route("api/search", "routes/api.search.ts"),
  route("api/index/status", "routes/api.index.status.ts"),
  route("api/pages/backlinks", "routes/api.pages.backlinks.ts"),
  route("api/pages/delete", "routes/api.pages.delete.ts"),
  route("api/import/check", "routes/api.import.check.ts"),
  route("api/import/:step", "routes/api.import.$step.ts"),
] satisfies RouteConfig;
