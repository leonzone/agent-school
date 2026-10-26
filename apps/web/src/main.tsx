import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./shadcn.css";

const root = document.getElementById("root");
if (!root) throw new Error("页面根节点不存在");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
