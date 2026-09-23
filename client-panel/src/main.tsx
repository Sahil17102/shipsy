import "./lib/dayjs"; // must run before antd pickers render — extends dayjs plugins
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ErrorBoundary } from "./components/common";
import { Toaster } from "sonner";
import App from "./App";
import { getAntdTheme, injectThemeVars } from "./theme";
import "./index.css";

const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();

injectThemeVars();

const queryClient = new QueryClient();

function Providers({ children }: { children: ReactNode }) {
  const content = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ConfigProvider theme={getAntdTheme("light")}>
          <ErrorBoundary>
            <BrowserRouter>
              <AuthProvider>
                {children}
                <Toaster position="top-center" richColors closeButton />
              </AuthProvider>
            </BrowserRouter>
          </ErrorBoundary>
        </ConfigProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  return GOOGLE_CLIENT_ID ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{content}</GoogleOAuthProvider> : content;
}

const root = document.getElementById("root");
if (!root) throw new Error("Shipsy client root element is missing");
createRoot(root).render(
  <StrictMode>
    <Providers><App /></Providers>
  </StrictMode>,
);
