import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App.jsx";
import { T } from "./theme.js";
import "./index.css";

const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!pk) {
  document.getElementById("root").innerHTML =
    '<div style="font-family:Outfit,sans-serif;padding:40px;color:#1B2A22">Missing VITE_CLERK_PUBLISHABLE_KEY — set it in your environment.</div>';
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

// Clerk components themed to the TOTO light identity (green primary,
// cream surfaces, Outfit). Used for the phone-OTP sign-in.
const appearance = {
  variables: {
    colorPrimary: T.green,
    colorBackground: "#FFFFFF",
    colorText: T.ink,
    colorTextSecondary: T.mut,
    colorInputBackground: "#FFFFFF",
    colorInputText: T.ink,
    borderRadius: "12px",
    fontFamily: "'Outfit', system-ui, sans-serif",
  },
  elements: {
    card: { background: "#FFFFFF", border: `1px solid ${T.line}`, boxShadow: "none" },
    formButtonPrimary: { fontWeight: 800, fontSize: "15px" },
    footer: { display: "none" },
  },
};

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={pk} appearance={appearance} afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
