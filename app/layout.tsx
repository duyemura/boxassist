import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'GymAgents — Keep more members with less work',
  description: 'GymAgents watches your PushPress member data, finds who\'s about to cancel, and drafts personal messages from you — automatically. For CrossFit, yoga, BJJ, pilates, and more.',
  keywords: 'gym member retention, reduce gym churn, PushPress autopilot, gym automation, CrossFit retention, yoga studio software',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  )
}
