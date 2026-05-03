/**
 * @file Route definitions as objects for SSR/SPA shared usage.
 *
 * Object-based routes allow both BrowserRouter and StaticRouter
 * to share the same route configuration.
 */
import type { RouteObject } from "react-router";
import { HomePage } from "./routes/home.tsx";

export const routes: readonly RouteObject[] = [
  {
    path: "/",
    element: <HomePage />,
  },
];
