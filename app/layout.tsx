import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import './globals.css';
const manrope = Manrope({ variable:'--font-manrope', subsets:['latin'] });
export const metadata: Metadata = { title:'Shipsy — Intelligent Commerce Logistics', description:'One connected platform for shipping, fulfillment, returns and delivery intelligence.' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className={manrope.variable}>{children}</body></html>}
