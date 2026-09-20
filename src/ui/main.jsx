import React from "react";
import { createRoot } from "react-dom/client";
import FloatingCard from "./FloatingCard.jsx";
import Settings from "./Settings.jsx";

const params = new URLSearchParams(location.search);
const view = params.get("view") || "floating";

createRoot(document.getElementById("root")).render(
  view === "settings" ? <Settings /> : <FloatingCard />
);
