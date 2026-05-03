/**
 * @file Root application component rendering shared route objects.
 */
import { useRoutes } from "react-router";
import { routes } from "./routes.tsx";

/**
 * Root application component.
 */
export function App() {
  const element = useRoutes([...routes]);
  return element;
}
