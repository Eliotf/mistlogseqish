import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new.ts"),
  route("docs/:id", "routes/docs.$id.tsx"),
  route("page/:slug", "routes/page.$slug.tsx"),
  route("journal/:date", "routes/journal.$date.tsx"),
  route("api/rename", "routes/api.rename.ts"),
  route("api/journals", "routes/api.journals.ts"),
] satisfies RouteConfig;
