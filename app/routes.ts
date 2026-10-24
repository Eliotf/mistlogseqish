import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new.ts"),
  route("docs/:id", "routes/docs.$id.tsx"),
  route("api/title-check", "routes/api.title-check.ts"),
] satisfies RouteConfig;
