import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ConfigProvider } from "antd";
import { motion } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { DashboardHeader } from "./DashboardHeader";
import { useTheme } from "@/contexts/ThemeContext";
import { getThemeVarsStyle, getAntdTheme } from "@/theme";

export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { mode } = useTheme();
  const location = useLocation();

  return (
    <ConfigProvider theme={getAntdTheme(mode)}>
      <div
        className="dashboard-shell min-h-screen bg-background flex"
        style={getThemeVarsStyle(mode)}
        data-theme={mode}
      >
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          collapsed={sidebarCollapsed}
        />

        <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
          <DashboardHeader
            onMobileMenuOpen={() => setMobileOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          />
          <main className="dashboard-content relative flex-1 overflow-y-auto p-4 sm:p-6">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: "easeOut" }} className="relative z-10">
              <Outlet />
            </motion.div>
          </main>
        </div>
      </div>
    </ConfigProvider>
  );
}
