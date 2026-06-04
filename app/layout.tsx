import type { Metadata } from 'next'
import { DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap', axes: ['opsz'] })
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-dm-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Customer Health — Flowbox CS',
  description: 'Flowbox Customer Success internal dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ height: '100%', overflow: 'hidden' }}>
      <body className={`${dmSans.variable} ${dmMono.variable}`} style={{ height: '100%', overflow: 'hidden', fontFamily: 'var(--font)' }}>
        {children}
      </body>
    </html>
  )
}
