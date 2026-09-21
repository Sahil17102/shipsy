import { motion, useReducedMotion } from "framer-motion";
import { Box, CheckCircle2, MapPin, Package, Radio, Route, Truck, Zap } from "lucide-react";
import { AppLogo } from "@/components/common/AppLogo";

const stats = [
  ["2.8x", "faster dispatch"],
  ["18%", "lower freight leak"],
  ["99.9%", "live network"],
];

const checkpoints = [
  { icon: Package, label: "Packed", className: "left-[10%] top-[18%]" },
  { icon: Route, label: "Routed", className: "right-[9%] top-[27%]" },
  { icon: CheckCircle2, label: "Delivered", className: "left-[18%] bottom-[13%]" },
];

export function BrandingPanel() {
  const reduceMotion = useReducedMotion();

  return (
    <aside className="relative hidden min-h-screen overflow-hidden bg-[#08152d] lg:flex lg:w-[47%] xl:w-[45%] flex-col px-10 py-9 xl:px-14">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_18%,rgba(38,112,255,.32),transparent_28%),radial-gradient(circle_at_78%_70%,rgba(101,218,192,.18),transparent_30%),linear-gradient(145deg,#08152d_0%,#102b58_54%,#07142a_100%)]" />
      <div className="absolute inset-0 opacity-[0.16] [background-image:radial-gradient(circle_at_1px_1px,rgba(156,190,255,.75)_1px,transparent_1.4px)] [background-size:30px_30px]" />
      <motion.div
        aria-hidden="true"
        animate={reduceMotion ? undefined : { x: [0, 22, 0], y: [0, -14, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -right-24 top-16 h-72 w-72 rounded-full bg-[#2d6dff]/25 blur-[80px]"
      />
      <motion.div
        aria-hidden="true"
        animate={reduceMotion ? undefined : { x: [0, -18, 0], y: [0, 18, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -left-28 bottom-20 h-72 w-72 rounded-full bg-[#65dac0]/15 blur-[76px]"
      />

      <div className="relative z-10">
        <AppLogo size="md" textClassName="text-white" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55 }}
        className="relative z-10 mt-10"
      >
        <div className="mb-4 flex items-center gap-2 text-[11px] font-extrabold tracking-[0.2em] text-[#65dac0]">
          <span className="h-0.5 w-8 bg-[#ff7043]" /> SHIPMENT INTELLIGENCE
        </div>
        <h1 className="max-w-lg text-4xl font-extrabold leading-[1.06] tracking-normal text-white xl:text-[46px]">
          One cockpit for every order in motion.
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
          Route smarter, spot exceptions earlier, and keep buyers updated from pickup to delivery.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.12 }}
        className="relative z-10 my-7 flex min-h-[310px] flex-1 items-center"
      >
        <div className="relative mx-auto h-[330px] w-full max-w-[520px] overflow-visible">
          <div className="absolute left-1/2 top-[54%] h-[230px] w-[390px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-[#6b9cff]/25 [transform:rotateX(67deg)]" />
          <div className="absolute left-1/2 top-[54%] h-[160px] w-[285px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-dashed border-[#65dac0]/35 [transform:rotateX(67deg)]" />
          <motion.div
            aria-hidden="true"
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
            className="absolute left-1/2 top-[54%] h-[242px] w-[402px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-transparent [transform:rotateX(67deg)]"
          >
            <span className="absolute left-[18%] top-[3%] h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_18px_5px_rgba(101,218,192,.65)]" />
            <span className="absolute right-[19%] bottom-[6%] h-2 w-2 rounded-full bg-[#ff7043] shadow-[0_0_18px_5px_rgba(255,112,67,.45)]" />
          </motion.div>

          <motion.div
            animate={reduceMotion ? undefined : { y: [0, -12, 0], rotateY: [-5, 6, -5] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute left-1/2 top-[45%] z-20 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[32px] border border-white/15 bg-[linear-gradient(145deg,#2f6dff,#7b61ff)] text-white shadow-[0_30px_70px_rgba(32,91,216,.42)]"
          >
            <Box className="h-14 w-14" />
          </motion.div>

          <motion.div
            animate={reduceMotion ? undefined : { x: [-112, 112, -112], y: [34, -26, 34] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute left-1/2 top-[52%] z-30 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-2xl bg-[#ff7043] text-white shadow-[0_16px_34px_rgba(255,112,67,.38)]"
          >
            <Truck className="h-6 w-6" />
          </motion.div>

          {checkpoints.map(({ icon: Icon, label, className }, index) => (
            <motion.div
              key={label}
              animate={reduceMotion ? undefined : { y: [0, index === 1 ? -8 : -5, 0] }}
              transition={{ duration: 3.4 + index * 0.35, repeat: Infinity, ease: "easeInOut" }}
              className={`absolute z-20 ${className}`}
            >
              <div className="flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.08] px-3 py-2 text-xs font-semibold text-white shadow-[0_16px_36px_rgba(0,0,0,.22)] backdrop-blur-xl">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-[#86b3ff]">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </div>
            </motion.div>
          ))}

          <motion.div
            animate={reduceMotion ? undefined : { y: [0, -7, 0] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute right-[8%] bottom-[22%] z-20 rounded-2xl border border-[#65dac0]/20 bg-[#65dac0]/10 px-4 py-3 text-xs font-bold text-[#9ff2df] backdrop-blur-xl"
          >
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#65dac0]">
              <Radio className="h-3.5 w-3.5" /> Live SLA
            </div>
            97.4% on time
          </motion.div>

          <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07] backdrop-blur-xl">
            {stats.map(([value, label], index) => (
              <div key={label} className={`px-5 py-4 ${index ? "border-l border-white/10" : ""}`}>
                <p className="text-xl font-extrabold text-white">{value}</p>
                <p className="mt-1 text-[10px] text-white/50">{label}</p>
              </div>
            ))}
          </div>

          <div className="absolute left-[6%] top-[48%] flex items-center gap-2 rounded-full border border-white/10 bg-[#0d2348]/80 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9dbdff]">
            <Zap className="h-3.5 w-3.5 text-[#65dac0]" /> Auto-routing
          </div>
          <div className="absolute right-[16%] top-[7%] flex items-center gap-2 rounded-full border border-white/10 bg-[#0d2348]/80 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9dbdff]">
            <MapPin className="h-3.5 w-3.5 text-[#ff7043]" /> Delhi hub
          </div>
        </div>
      </motion.div>

      <p className="relative z-10 text-xs text-white/55">
        Shipsy by <strong className="text-white">Shipsy Logistics Pvt. Ltd.</strong>
      </p>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-[#65dac0] via-[#2f6dff] to-[#ff7043]" />
    </aside>
  );
}
